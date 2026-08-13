import type { DatabaseSync } from "node:sqlite";

type Migration = { version: number; sql: string };

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
];

export function migrate(database: DatabaseSync): void {
  const current = Number(
    database.prepare("PRAGMA user_version").get()?.user_version ?? 0,
  );
  for (const migration of migrations) {
    if (migration.version <= current) continue;
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(migration.sql);
      database.exec(`PRAGMA user_version = ${migration.version}`);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}
