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
    // A summary is only safe to reuse while the turns it describes are still
    // there, so the identity of those turns is stored with it. Rows written
    // before this keep the empty default, which reads as "unknown" and simply
    // re-summarizes rather than trusting a summary it cannot check.
    version: 5,
    run: addCompactionFingerprint,
  },
  {
    // What the embedded browser remembers between launches. Downloads used to
    // live in an in-memory array that emptied on quit, and the other two had
    // nowhere to go at all.
    //
    // `saved_logins` deliberately holds no secret: the password sits in the
    // encrypted vault under this row's id, so a reader of the database learns
    // only that an account exists, never what it is.
    //
    // `IF NOT EXISTS` throughout for the same reason migration 5 checks before
    // adding its column: a store whose version was wound back by hand re-runs
    // this step, and it has to upgrade rather than fail on what is already there.
    version: 6,
    sql: `
    CREATE TABLE IF NOT EXISTS site_permissions (
      origin TEXT NOT NULL, permission TEXT NOT NULL, decision TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(origin, permission), CHECK(decision IN ('allow','deny','ask'))
    ) STRICT;

    CREATE TABLE IF NOT EXISTS browser_downloads (
      id TEXT PRIMARY KEY, url TEXT NOT NULL, filename TEXT NOT NULL, path TEXT NOT NULL,
      mime_type TEXT, received_bytes INTEGER NOT NULL DEFAULT 0, total_bytes INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
      CHECK(state IN ('progressing','paused','completed','cancelled','interrupted'))
    ) STRICT;
    CREATE INDEX IF NOT EXISTS browser_downloads_started_idx ON browser_downloads(started_at DESC);

    CREATE TABLE IF NOT EXISTS saved_logins (
      id TEXT PRIMARY KEY, origin TEXT NOT NULL, username TEXT NOT NULL, source TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_used_at TEXT,
      UNIQUE(origin, username), CHECK(source IN ('manual','import'))
    ) STRICT;
    CREATE INDEX IF NOT EXISTS saved_logins_origin_idx ON saved_logins(origin);
  `,
  },
  {
    // Browsing history, which the app had nowhere to keep: the renderer's
    // launcher list held twenty-four entries in localStorage with no times, so
    // an imported Chrome history had nothing to land in.
    //
    // One row per url rather than one per visit. A browser's own history keeps
    // every visit and aggregates on read; here the list, the search and the
    // Recent strip all want "pages, most recent first", and an import of
    // eighty thousand visits collapses to a few thousand pages. `visit_count`
    // carries what would otherwise be lost.
    version: 7,
    sql: `
    CREATE TABLE IF NOT EXISTS browser_history (
      url TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '',
      visited_at TEXT NOT NULL, visit_count INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL DEFAULT 'local',
      CHECK(source IN ('local','import'))
    ) STRICT;
    CREATE INDEX IF NOT EXISTS browser_history_visited_idx ON browser_history(visited_at DESC);
  `,
  },
  {
    // What the hub showed last time, so it can show it again before the
    // network answers. One JSON payload per key — the status, the chat list, a
    // folder's envelopes, a message body — because the shapes are the
    // protocol's DTOs and this table's job is to hand them back unchanged, not
    // to model mail a second time.
    //
    // Nothing here is authoritative, so there are no foreign keys and no
    // constraints beyond the key: a row is a copy of something the network
    // owns, and the worst a stale or dropped one costs is a wait.
    version: 8,
    sql: `
    CREATE TABLE IF NOT EXISTS comms_cache (
      key TEXT PRIMARY KEY, value TEXT NOT NULL, fetched_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS comms_cache_fetched_idx ON comms_cache(fetched_at DESC);
  `,
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
