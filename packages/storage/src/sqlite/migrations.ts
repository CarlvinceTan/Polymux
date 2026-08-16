import type { DatabaseSync } from "node:sqlite";

/** A step is plain `sql`, or a `run` for work SQL cannot express on its own —
 * reading a JSON column and deciding row by row. Both kinds apply inside the
 * same transaction as the version bump. */
type Migration = { version: number; sql: string; run?: undefined } | { version: number; sql?: undefined; run: (database: DatabaseSync) => void };

const migrations: Migration[] = [
  {
    version: 1,
    sql: `
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      archived_at TEXT, metadata_json TEXT NOT NULL DEFAULT '{}'
    ) STRICT;
    CREATE INDEX conversations_updated_idx ON conversations(updated_at DESC);

    CREATE TABLE runs (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      status TEXT NOT NULL, model TEXT, started_at TEXT, finished_at TEXT, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, error_json TEXT, usage_json TEXT,
      CHECK(status IN ('queued','running','completed','cancelled','failed','interrupted'))
    ) STRICT;
    CREATE INDEX runs_conversation_idx ON runs(conversation_id, created_at);

    CREATE TABLE messages (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      run_id TEXT REFERENCES runs(id) ON DELETE SET NULL, role TEXT NOT NULL, content_json TEXT NOT NULL,
      created_at TEXT NOT NULL, sequence INTEGER NOT NULL,
      UNIQUE(conversation_id, sequence), CHECK(role IN ('system','user','assistant','tool'))
    ) STRICT;
    CREATE INDEX messages_conversation_idx ON messages(conversation_id, sequence);

    CREATE TABLE attachments (
      id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE, name TEXT NOT NULL,
      path TEXT NOT NULL, mime_type TEXT, size INTEGER, sha256 TEXT, created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE run_events (
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, sequence INTEGER NOT NULL, type TEXT NOT NULL,
      payload_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(run_id, sequence)
    ) STRICT;

    CREATE TABLE compactions (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      through_message_sequence INTEGER NOT NULL, summary TEXT NOT NULL, token_count INTEGER, created_at TEXT NOT NULL,
      UNIQUE(conversation_id, through_message_sequence)
    ) STRICT;

    CREATE TABLE memories (
      id TEXT PRIMARY KEY, scope TEXT NOT NULL, scope_id TEXT, kind TEXT NOT NULL, content TEXT NOT NULL,
      source_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL, confidence REAL NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, metadata_json TEXT NOT NULL DEFAULT '{}',
      CHECK(scope IN ('user','conversation')), CHECK(confidence >= 0 AND confidence <= 1),
      CHECK((scope = 'user' AND scope_id IS NULL) OR (scope != 'user' AND scope_id IS NOT NULL))
    ) STRICT;
    CREATE INDEX memories_scope_idx ON memories(scope, scope_id, updated_at DESC);

    CREATE TABLE preferences (
      key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE artifacts (
      id TEXT PRIMARY KEY, conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
      run_id TEXT REFERENCES runs(id) ON DELETE SET NULL, kind TEXT NOT NULL, name TEXT NOT NULL, path TEXT NOT NULL,
      mime_type TEXT, size INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}',
      CHECK(kind IN ('document','slides','sheet','photo','video','other'))
    ) STRICT;
    CREATE INDEX artifacts_conversation_idx ON artifacts(conversation_id, created_at DESC);

    CREATE TABLE refs (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      run_id TEXT REFERENCES runs(id) ON DELETE SET NULL, kind TEXT NOT NULL, title TEXT NOT NULL, uri TEXT NOT NULL,
      created_at TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}', CHECK(kind IN ('web','file','other'))
    ) STRICT;
    CREATE INDEX refs_conversation_idx ON refs(conversation_id, created_at);

    CREATE TRIGGER messages_run_conversation_guard BEFORE INSERT ON messages
    WHEN NEW.run_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM runs WHERE id = NEW.run_id AND conversation_id = NEW.conversation_id
    ) BEGIN SELECT RAISE(ABORT, 'message run belongs to another conversation'); END;

    CREATE TRIGGER refs_run_conversation_guard BEFORE INSERT ON refs
    WHEN NEW.run_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM runs WHERE id = NEW.run_id AND conversation_id = NEW.conversation_id
    ) BEGIN SELECT RAISE(ABORT, 'reference run belongs to another conversation'); END;

    CREATE TRIGGER artifacts_run_conversation_guard BEFORE INSERT ON artifacts
    WHEN NEW.run_id IS NOT NULL AND NEW.conversation_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM runs WHERE id = NEW.run_id AND conversation_id = NEW.conversation_id
    ) BEGIN SELECT RAISE(ABORT, 'artifact run belongs to another conversation'); END;
  `,
  },
  {
    version: 2,
    sql: `
    ALTER TABLE runs ADD COLUMN parent_run_id TEXT REFERENCES runs(id) ON DELETE SET NULL;
    CREATE INDEX runs_parent_idx ON runs(parent_run_id);
    CREATE TABLE goals (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
      objective TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      CHECK(length(trim(objective)) > 0),
      CHECK(status IN ('active','paused','completed','blocked'))
    ) STRICT;
  `,
  },
  {
    version: 3,
    sql: `
    ALTER TABLE messages ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';
  `,
  },
  {
    // References used to be recorded for every page a run opened, which filled
    // the Summary panel with search-result pages the reply never cited. The
    // rule is now "a link the assistant put in its readable text", so drop the
    // rows the old rule collected that the new one would not have kept.
    version: 4,
    run: dropUncitedWebReferences,
  },
  {
    // A summary is only safe to reuse while the turns it describes are still
    // there, so the identity of those turns is stored with it. Rows written
    // before this keep the empty default, which reads as "unknown" and simply
    // re-summarizes rather than trusting a summary it cannot check.
    version: 5,
    run: addCompactionFingerprint,
  },
];

/**
 * Adds the column only when it is absent, so a store whose schema already has
 * it — one whose version was wound back by hand, or a step re-applied —
 * upgrades instead of failing on a duplicate column.
 */
function addCompactionFingerprint(database: DatabaseSync): void {
  const columns = database
    .prepare("PRAGMA table_info(compactions)")
    .all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === "prefix_fingerprint")) return;
  database.exec(
    "ALTER TABLE compactions ADD COLUMN prefix_fingerprint TEXT NOT NULL DEFAULT ''",
  );
}

function dropUncitedWebReferences(database: DatabaseSync): void {
  // Only agent-recorded web rows are in question: a file the user attached has
  // no run, and is theirs to remove.
  const rows = database
    .prepare("SELECT id, conversation_id, uri FROM refs WHERE kind='web' AND run_id IS NOT NULL")
    .all() as Array<{ id: string; conversation_id: string; uri: string }>;
  if (!rows.length) return;

  const cited = new Map<string, Set<string>>();
  const citedIn = (conversationId: string): Set<string> => {
    const known = cited.get(conversationId);
    if (known) return known;
    const messages = database
      .prepare("SELECT content_json FROM messages WHERE conversation_id=? AND role='assistant'")
      .all(conversationId) as Array<{ content_json: string }>;
    const urls = new Set<string>();
    for (const message of messages)
      for (const url of urlsInReply(message.content_json)) urls.add(url);
    cited.set(conversationId, urls);
    return urls;
  };

  const remove = database.prepare("DELETE FROM refs WHERE id=?");
  for (const row of rows) if (!citedIn(row.conversation_id).has(normalizeUri(row.uri))) remove.run(row.id);
}

/** Urls in an assistant message's readable text. Tool-call arguments and
 * reasoning are not the reply, so a page merely opened stays uncited. */
function urlsInReply(contentJson: string): string[] {
  let content: unknown;
  try {
    content = JSON.parse(contentJson);
  } catch {
    return [];
  }
  const blocks = Array.isArray(content) ? content : [];
  const text = typeof content === "string"
    ? content
    : blocks
        .map((block) => {
          const item = block as { type?: unknown; text?: unknown };
          return item.type === "text" && typeof item.text === "string" ? item.text : "";
        })
        .filter(Boolean)
        .join("\n");
  return [...text.matchAll(/https?:\/\/[^\s<>()[\]"']+/g)]
    .map((match) => normalizeUri(match[0]!.replace(/[).,;:!?'"]+$/, "")));
}

/** Stored uris went through `new URL()` when they were recorded; cited ones
 * have not, so both sides are normalised before they are compared. */
function normalizeUri(value: string): string {
  try {
    return new URL(value).toString();
  } catch {
    return value;
  }
}

export function migrate(database: DatabaseSync): void {
  const current = Number(
    database.prepare("PRAGMA user_version").get()?.user_version ?? 0,
  );
  for (const migration of migrations) {
    if (migration.version <= current) continue;
    database.exec("BEGIN IMMEDIATE");
    try {
      if (migration.sql !== undefined) database.exec(migration.sql);
      else migration.run(database);
      database.exec(`PRAGMA user_version = ${migration.version}`);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}
