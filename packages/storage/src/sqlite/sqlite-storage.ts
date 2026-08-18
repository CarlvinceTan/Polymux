import { DatabaseSync } from "node:sqlite";
import type { CommsCacheEntry, Storage } from "../contracts.js";
import type {
  AgentRun,
  Artifact,
  Attachment,
  Compaction,
  Conversation,
  Id,
  JsonValue,
  MemoryRecord,
  MemoryScope,
  MessageRole,
  MessageSearchHit,
  NewArtifact,
  NewAttachment,
  NewCompaction,
  NewConversation,
  NewMemory,
  NewMessage,
  NewReference,
  NewRun,
  Preference,
  RunEvent,
  RunStatus,
  StoredMessage,
  StoredReference,
  Goal,
  GoalStatus,
  NewGoal,
  BrowserDownload,
  DownloadState,
  NewBrowserDownload,
  HistoryEntry,
  NewHistoryEntry,
  NewSavedLogin,
  PermissionDecision,
  SavedLogin,
  SitePermission,
} from "../types.js";
import { migrate } from "./migrations.js";

type Row = Record<string, unknown>;
type Clock = () => string;

const emptyObject: JsonValue = {};
const terminalStatuses = new Set<RunStatus>([
  "completed",
  "cancelled",
  "failed",
  "interrupted",
]);

function encode(value: JsonValue): string {
  return JSON.stringify(value);
}
function decode(value: unknown): JsonValue {
  return JSON.parse(String(value)) as JsonValue;
}
function nullableJson(value: unknown): JsonValue | null {
  return value == null ? null : decode(value);
}
function text(value: unknown): string {
  return String(value);
}
function nullableText(value: unknown): string | null {
  return value == null ? null : String(value);
}
function nullableNumber(value: unknown): number | null {
  return value == null ? null : Number(value);
}

function conversation(row: Row): Conversation {
  return {
    id: text(row.id),
    title: text(row.title),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    archivedAt: nullableText(row.archived_at),
    metadata: decode(row.metadata_json),
  };
}
/** Keeps a user's literal % or _ from behaving as a LIKE wildcard. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** Message content is JSON; searches and hits work in the text inside it. */
function plainText(content: JsonValue): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((block) => {
        const item = block as { type?: unknown; text?: unknown };
        if (item.type === "image") return "[image]";
        return typeof item.text === "string" ? item.text : "";
      })
      .filter(Boolean)
      .join("\n");
  return "";
}

function message(row: Row): StoredMessage {
  return {
    id: text(row.id),
    conversationId: text(row.conversation_id),
    runId: nullableText(row.run_id),
    role: text(row.role) as StoredMessage["role"],
    content: decode(row.content_json),
    createdAt: text(row.created_at),
    sequence: Number(row.sequence),
    metadata: decode(row.metadata_json),
  };
}
function run(row: Row): AgentRun {
  return {
    id: text(row.id),
    conversationId: text(row.conversation_id),
    status: text(row.status) as RunStatus,
    model: nullableText(row.model),
    startedAt: nullableText(row.started_at),
    finishedAt: nullableText(row.finished_at),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    error: nullableJson(row.error_json),
    usage: nullableJson(row.usage_json),
    parentRunId: nullableText(row.parent_run_id),
  };
}
function event(row: Row): RunEvent {
  return {
    runId: text(row.run_id),
    sequence: Number(row.sequence),
    type: text(row.type),
    payload: decode(row.payload_json),
    createdAt: text(row.created_at),
  };
}
function compaction(row: Row): Compaction {
  return {
    id: text(row.id),
    conversationId: text(row.conversation_id),
    throughMessageSequence: Number(row.through_message_sequence),
    summary: text(row.summary),
    tokenCount: nullableNumber(row.token_count),
    prefixFingerprint: text(row.prefix_fingerprint),
    createdAt: text(row.created_at),
  };
}
function memory(row: Row): MemoryRecord {
  return {
    id: text(row.id),
    scope: text(row.scope) as MemoryScope,
    scopeId: nullableText(row.scope_id),
    kind: text(row.kind),
    content: text(row.content),
    sourceConversationId: nullableText(row.source_conversation_id),
    confidence: Number(row.confidence),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    deletedAt: nullableText(row.deleted_at),
    metadata: decode(row.metadata_json),
  };
}
function artifact(row: Row): Artifact {
  return {
    id: text(row.id),
    conversationId: nullableText(row.conversation_id),
    runId: nullableText(row.run_id),
    kind: text(row.kind) as Artifact["kind"],
    name: text(row.name),
    path: text(row.path),
    mimeType: nullableText(row.mime_type),
    size: nullableNumber(row.size),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    metadata: decode(row.metadata_json),
  };
}
function reference(row: Row): StoredReference {
  return {
    id: text(row.id),
    conversationId: text(row.conversation_id),
    runId: nullableText(row.run_id),
    kind: text(row.kind) as StoredReference["kind"],
    title: text(row.title),
    uri: text(row.uri),
    createdAt: text(row.created_at),
    metadata: decode(row.metadata_json),
  };
}
function attachment(row: Row): Attachment {
  return {
    id: text(row.id),
    messageId: text(row.message_id),
    name: text(row.name),
    path: text(row.path),
    mimeType: nullableText(row.mime_type),
    size: nullableNumber(row.size),
    sha256: nullableText(row.sha256),
    createdAt: text(row.created_at),
  };
}

function sitePermission(row: Row): SitePermission {
  return {
    origin: text(row.origin),
    permission: text(row.permission),
    decision: text(row.decision) as PermissionDecision,
    updatedAt: text(row.updated_at),
  };
}
function browserDownload(row: Row): BrowserDownload {
  return {
    id: text(row.id),
    url: text(row.url),
    filename: text(row.filename),
    path: text(row.path),
    mimeType: nullableText(row.mime_type),
    receivedBytes: Number(row.received_bytes),
    totalBytes: Number(row.total_bytes),
    state: text(row.state) as DownloadState,
    startedAt: text(row.started_at),
    finishedAt: nullableText(row.finished_at),
  };
}
function historyEntry(row: Row): HistoryEntry {
  return {
    url: text(row.url),
    title: text(row.title),
    visitedAt: text(row.visited_at),
    visitCount: Number(row.visit_count ?? 1),
    source: text(row.source) as HistoryEntry["source"],
  };
}

function savedLogin(row: Row): SavedLogin {
  return {
    id: text(row.id),
    origin: text(row.origin),
    username: text(row.username),
    source: text(row.source) as SavedLogin["source"],
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    lastUsedAt: nullableText(row.last_used_at),
  };
}

function commsCacheEntry(row: Row): CommsCacheEntry {
  return {
    key: text(row.key),
    value: text(row.value),
    fetchedAt: text(row.fetched_at),
  };
}

/** A key is caller-supplied and can hold `%` or `_`, which LIKE would read as
 * wildcards — escaping them keeps a prefix a prefix. */
function likePrefix(prefix: string): string {
  return prefix.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export interface SqliteStorageOptions {
  clock?: Clock;
  readonly?: boolean;
}

export class SqliteStorage implements Storage {
  readonly database: DatabaseSync;
  readonly #clock: Clock;
  #transactionDepth = 0;

  constructor(path: string, options: SqliteStorageOptions = {}) {
    this.database = new DatabaseSync(path, {
      readOnly: options.readonly ?? false,
    });
    this.#clock = options.clock ?? (() => new Date().toISOString());
    this.database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    if (!options.readonly) {
      if (path !== ":memory:")
        this.database.exec(
          "PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;",
        );
      migrate(this.database);
    }
  }

  close(): void {
    this.database.close();
  }

  transaction<T>(work: () => T): T {
    const savepoint = `flareai_nested_${this.#transactionDepth}`;
    this.database.exec(
      this.#transactionDepth === 0
        ? "BEGIN IMMEDIATE"
        : `SAVEPOINT ${savepoint}`,
    );
    this.#transactionDepth += 1;
    try {
      const result = work();
      this.#transactionDepth -= 1;
      this.database.exec(
        this.#transactionDepth === 0
          ? "COMMIT"
          : `RELEASE SAVEPOINT ${savepoint}`,
      );
      return result;
    } catch (error) {
      this.#transactionDepth -= 1;
      this.database.exec(
        this.#transactionDepth === 0
          ? "ROLLBACK"
          : `ROLLBACK TO SAVEPOINT ${savepoint}; RELEASE SAVEPOINT ${savepoint}`,
      );
      throw error;
    }
  }

  createConversation(input: NewConversation): Conversation {
    const now = this.#clock();
    this.database
      .prepare(
        "INSERT INTO conversations (id,title,created_at,updated_at,metadata_json) VALUES (?,?,?,?,?)",
      )
      .run(
        input.id,
        input.title,
        now,
        now,
        encode(input.metadata ?? emptyObject),
      );
    return this.getConversation(input.id)!;
  }

  getConversation(id: Id): Conversation | null {
    const row = this.database
      .prepare("SELECT * FROM conversations WHERE id = ?")
      .get(id) as Row | undefined;
    return row ? conversation(row) : null;
  }

  listConversations(
    options: {
      includeArchived?: boolean;
      limit?: number;
      offset?: number;
    } = {},
  ): Conversation[] {
    const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
    const offset = Math.max(0, options.offset ?? 0);
    const sql = `SELECT * FROM conversations ${options.includeArchived ? "" : "WHERE archived_at IS NULL"} ORDER BY updated_at DESC LIMIT ? OFFSET ?`;
    return (this.database.prepare(sql).all(limit, offset) as Row[]).map(
      conversation,
    );
  }

  updateConversation(
    id: Id,
    patch: { title?: string; archived?: boolean; metadata?: JsonValue },
  ): Conversation | null {
    const current = this.getConversation(id);
    if (!current) return null;
    const now = this.#clock();
    const archivedAt =
      patch.archived === undefined
        ? current.archivedAt
        : patch.archived
          ? now
          : null;
    this.database
      .prepare(
        "UPDATE conversations SET title=?, updated_at=?, archived_at=?, metadata_json=? WHERE id=?",
      )
      .run(
        patch.title ?? current.title,
        now,
        archivedAt,
        encode(patch.metadata ?? current.metadata),
        id,
      );
    return this.getConversation(id);
  }

  deleteConversation(id: Id): boolean {
    return (
      Number(
        this.database.prepare("DELETE FROM conversations WHERE id=?").run(id)
          .changes,
      ) > 0
    );
  }

  appendMessage(input: NewMessage): StoredMessage {
    return this.transaction(() => {
      const next = Number(
        (
          this.database
            .prepare(
              "SELECT COALESCE(MAX(sequence),0)+1 AS sequence FROM messages WHERE conversation_id=?",
            )
            .get(input.conversationId) as Row
        ).sequence,
      );
      const now = this.#clock();
      this.database
        .prepare(
          "INSERT INTO messages (id,conversation_id,run_id,role,content_json,created_at,sequence,metadata_json) VALUES (?,?,?,?,?,?,?,?)",
        )
        .run(
          input.id,
          input.conversationId,
          input.runId ?? null,
          input.role,
          encode(input.content),
          now,
          next,
          encode(input.metadata ?? emptyObject),
        );
      this.database
        .prepare("UPDATE conversations SET updated_at=? WHERE id=?")
        .run(now, input.conversationId);
      return message(
        this.database
          .prepare("SELECT * FROM messages WHERE id=?")
          .get(input.id) as Row,
      );
    });
  }

  getMessage(id: Id): StoredMessage | null {
    const row = this.database
      .prepare("SELECT * FROM messages WHERE id=?")
      .get(id) as Row | undefined;
    return row ? message(row) : null;
  }

  updateMessage(
    id: Id,
    patch: { content?: JsonValue; metadata?: JsonValue },
  ): StoredMessage | null {
    const current = this.getMessage(id);
    if (!current) return null;
    this.database
      .prepare("UPDATE messages SET content_json=?,metadata_json=? WHERE id=?")
      .run(
        encode(patch.content ?? current.content),
        encode(patch.metadata ?? current.metadata),
        id,
      );
    return this.getMessage(id);
  }

  listMessages(
    conversationId: Id,
    options: { afterSequence?: number; limit?: number } = {},
  ): StoredMessage[] {
    const limit = Math.max(1, Math.min(options.limit ?? 500, 2000));
    return (
      this.database
        .prepare(
          "SELECT * FROM messages WHERE conversation_id=? AND sequence>? ORDER BY sequence LIMIT ?",
        )
        .all(conversationId, options.afterSequence ?? 0, limit) as Row[]
    ).map(message);
  }

  searchMessages(
    query: string,
    options: {
      limit?: number;
      conversationId?: Id;
      roles?: MessageRole[];
    } = {},
  ): MessageSearchHit[] {
    const term = query.trim();
    if (!term) return [];
    const roles = options.roles?.length
      ? options.roles
      : (["user", "assistant"] as MessageRole[]);
    const limit = Math.max(1, Math.min(options.limit ?? 20, 200));
    // LIKE over content_json also matches the JSON scaffolding around the text,
    // so hits are rendered to plain text before they are returned.
    const rows = this.database
      .prepare(
        `SELECT m.*, c.title AS conversation_title FROM messages m
           JOIN conversations c ON c.id = m.conversation_id
          WHERE m.content_json LIKE ? ESCAPE '\\'
            AND m.role IN (${roles.map(() => "?").join(",")})
            ${options.conversationId ? "AND m.conversation_id = ?" : ""}
          ORDER BY m.created_at DESC, m.sequence DESC
          LIMIT ?`,
      )
      .all(
        `%${escapeLike(term)}%`,
        ...roles,
        ...(options.conversationId ? [options.conversationId] : []),
        limit,
      ) as Array<Row & { conversation_title: unknown }>;
    return rows.map((row) => {
      const stored = message(row);
      return {
        conversationId: stored.conversationId,
        conversationTitle: text(row.conversation_title),
        messageId: stored.id,
        role: stored.role,
        sequence: stored.sequence,
        createdAt: stored.createdAt,
        text: plainText(stored.content),
      };
    });
  }

  addAttachment(input: NewAttachment): Attachment {
    const now = this.#clock();
    this.database
      .prepare(
        "INSERT INTO attachments (id,message_id,name,path,mime_type,size,sha256,created_at) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(
        input.id,
        input.messageId,
        input.name,
        input.path,
        input.mimeType,
        input.size,
        input.sha256,
        now,
      );
    return attachment(
      this.database
        .prepare("SELECT * FROM attachments WHERE id=?")
        .get(input.id) as Row,
    );
  }

  listAttachments(messageId: Id): Attachment[] {
    return (
      this.database
        .prepare(
          "SELECT * FROM attachments WHERE message_id=? ORDER BY created_at,id",
        )
        .all(messageId) as Row[]
    ).map(attachment);
  }

  createRun(input: NewRun): AgentRun {
    const now = this.#clock();
    const status = input.status ?? "queued";
    this.database
      .prepare(
        "INSERT INTO runs (id,conversation_id,status,model,started_at,finished_at,created_at,updated_at,parent_run_id) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .run(
        input.id,
        input.conversationId,
        status,
        input.model ?? null,
        status === "running" ? now : null,
        terminalStatuses.has(status) ? now : null,
        now,
        now,
        input.parentRunId ?? null,
      );
    return this.getRun(input.id)!;
  }

  getRun(id: Id): AgentRun | null {
    const row = this.database
      .prepare("SELECT * FROM runs WHERE id=?")
      .get(id) as Row | undefined;
    return row ? run(row) : null;
  }

  updateRun(
    id: Id,
    patch: {
      status?: RunStatus;
      error?: JsonValue | null;
      usage?: JsonValue | null;
    },
  ): AgentRun | null {
    const current = this.getRun(id);
    if (!current) return null;
    const now = this.#clock();
    const status = patch.status ?? current.status;
    const startedAt = current.startedAt ?? (status === "running" ? now : null);
    const finishedAt = terminalStatuses.has(status)
      ? (current.finishedAt ?? now)
      : null;
    this.database
      .prepare(
        "UPDATE runs SET status=?,started_at=?,finished_at=?,updated_at=?,error_json=?,usage_json=? WHERE id=?",
      )
      .run(
        status,
        startedAt,
        finishedAt,
        now,
        patch.error === undefined
          ? current.error == null
            ? null
            : encode(current.error)
          : patch.error == null
            ? null
            : encode(patch.error),
        patch.usage === undefined
          ? current.usage == null
            ? null
            : encode(current.usage)
          : patch.usage == null
            ? null
            : encode(patch.usage),
        id,
      );
    return this.getRun(id);
  }

  appendRunEvent(runId: Id, type: string, payload: JsonValue): RunEvent {
    return this.transaction(() => {
      const next = Number(
        (
          this.database
            .prepare(
              "SELECT COALESCE(MAX(sequence),0)+1 AS sequence FROM run_events WHERE run_id=?",
            )
            .get(runId) as Row
        ).sequence,
      );
      const now = this.#clock();
      this.database
        .prepare(
          "INSERT INTO run_events (run_id,sequence,type,payload_json,created_at) VALUES (?,?,?,?,?)",
        )
        .run(runId, next, type, encode(payload), now);
      return { runId, sequence: next, type, payload, createdAt: now };
    });
  }

  listRunEvents(runId: Id, afterSequence = 0): RunEvent[] {
    return (
      this.database
        .prepare(
          "SELECT * FROM run_events WHERE run_id=? AND sequence>? ORDER BY sequence",
        )
        .all(runId, afterSequence) as Row[]
    ).map(event);
  }

  saveCompaction(input: NewCompaction): Compaction {
    const now = this.#clock();
    this.database
      .prepare(
        // Recompacting the same prefix replaces its summary: the history it
        // described can change underneath it, and the pair is unique.
        `INSERT INTO compactions (id,conversation_id,through_message_sequence,summary,token_count,prefix_fingerprint,created_at) VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(conversation_id,through_message_sequence) DO UPDATE SET
           id=excluded.id, summary=excluded.summary, token_count=excluded.token_count,
           prefix_fingerprint=excluded.prefix_fingerprint, created_at=excluded.created_at`,
      )
      .run(
        input.id,
        input.conversationId,
        input.throughMessageSequence,
        input.summary,
        input.tokenCount,
        input.prefixFingerprint,
        now,
      );
    return compaction(
      this.database
        .prepare("SELECT * FROM compactions WHERE id=?")
        .get(input.id) as Row,
    );
  }

  getLatestCompaction(conversationId: Id): Compaction | null {
    const row = this.database
      .prepare(
        "SELECT * FROM compactions WHERE conversation_id=? ORDER BY through_message_sequence DESC LIMIT 1",
      )
      .get(conversationId) as Row | undefined;
    return row ? compaction(row) : null;
  }

  upsertMemory(input: NewMemory): MemoryRecord {
    const existing = this.getMemory(input.id);
    const now = this.#clock();
    this.database
      .prepare(
        `INSERT INTO memories (id,scope,scope_id,kind,content,source_conversation_id,confidence,created_at,updated_at,deleted_at,metadata_json)
      VALUES (?,?,?,?,?,?,?,?,?,NULL,?) ON CONFLICT(id) DO UPDATE SET scope=excluded.scope,scope_id=excluded.scope_id,kind=excluded.kind,content=excluded.content,source_conversation_id=excluded.source_conversation_id,confidence=excluded.confidence,updated_at=excluded.updated_at,deleted_at=NULL,metadata_json=excluded.metadata_json`,
      )
      .run(
        input.id,
        input.scope,
        input.scopeId ?? null,
        input.kind,
        input.content,
        input.sourceConversationId ?? null,
        input.confidence ?? 1,
        existing?.createdAt ?? now,
        now,
        encode(input.metadata ?? emptyObject),
      );
    return this.getMemory(input.id)!;
  }

  getMemory(id: Id): MemoryRecord | null {
    const row = this.database
      .prepare("SELECT * FROM memories WHERE id=?")
      .get(id) as Row | undefined;
    return row ? memory(row) : null;
  }

  listMemories(
    filter: {
      scope?: MemoryScope;
      scopeId?: Id | null;
      includeDeleted?: boolean;
    } = {},
  ): MemoryRecord[] {
    const clauses: string[] = [];
    const params: Array<string | null> = [];
    if (filter.scope) {
      clauses.push("scope=?");
      params.push(filter.scope);
    }
    if (filter.scopeId !== undefined) {
      clauses.push("scope_id IS ?");
      params.push(filter.scopeId);
    }
    if (!filter.includeDeleted) clauses.push("deleted_at IS NULL");
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return (
      this.database
        .prepare(`SELECT * FROM memories ${where} ORDER BY updated_at DESC,id`)
        .all(...params) as Row[]
    ).map(memory);
  }

  deleteMemory(id: Id): boolean {
    const now = this.#clock();
    return (
      Number(
        this.database
          .prepare(
            "UPDATE memories SET deleted_at=?,updated_at=? WHERE id=? AND deleted_at IS NULL",
          )
          .run(now, now, id).changes,
      ) > 0
    );
  }

  setPreference(key: string, value: JsonValue): Preference {
    const now = this.#clock();
    this.database
      .prepare(
        "INSERT INTO preferences (key,value_json,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",
      )
      .run(key, encode(value), now);
    return { key, value, updatedAt: now };
  }

  getPreference(key: string): Preference | null {
    const row = this.database
      .prepare("SELECT * FROM preferences WHERE key=?")
      .get(key) as Row | undefined;
    return row
      ? {
          key: text(row.key),
          value: decode(row.value_json),
          updatedAt: text(row.updated_at),
        }
      : null;
  }

  listPreferences(): Preference[] {
    return (
      this.database
        .prepare("SELECT * FROM preferences ORDER BY key")
        .all() as Row[]
    ).map((row) => ({
      key: text(row.key),
      value: decode(row.value_json),
      updatedAt: text(row.updated_at),
    }));
  }

  createArtifact(input: NewArtifact): Artifact {
    const now = this.#clock();
    this.database
      .prepare(
        "INSERT INTO artifacts (id,conversation_id,run_id,kind,name,path,mime_type,size,created_at,updated_at,metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        input.id,
        input.conversationId ?? null,
        input.runId ?? null,
        input.kind,
        input.name,
        input.path,
        input.mimeType ?? null,
        input.size ?? null,
        now,
        now,
        encode(input.metadata ?? emptyObject),
      );
    return this.getArtifact(input.id)!;
  }

  getArtifact(id: Id): Artifact | null {
    const row = this.database
      .prepare("SELECT * FROM artifacts WHERE id=?")
      .get(id) as Row | undefined;
    return row ? artifact(row) : null;
  }

  listArtifacts(conversationId?: Id): Artifact[] {
    const rows =
      conversationId === undefined
        ? this.database
            .prepare("SELECT * FROM artifacts ORDER BY created_at DESC")
            .all()
        : this.database
            .prepare(
              "SELECT * FROM artifacts WHERE conversation_id=? ORDER BY created_at DESC",
            )
            .all(conversationId);
    return (rows as Row[]).map(artifact);
  }

  createReference(input: NewReference): StoredReference {
    const now = this.#clock();
    this.database
      .prepare(
        "INSERT INTO refs (id,conversation_id,run_id,kind,title,uri,created_at,metadata_json) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(
        input.id,
        input.conversationId,
        input.runId ?? null,
        input.kind,
        input.title,
        input.uri,
        now,
        encode(input.metadata ?? emptyObject),
      );
    return reference(
      this.database
        .prepare("SELECT * FROM refs WHERE id=?")
        .get(input.id) as Row,
    );
  }

  listReferences(conversationId: Id): StoredReference[] {
    return (
      this.database
        .prepare(
          "SELECT * FROM refs WHERE conversation_id=? ORDER BY created_at",
        )
        .all(conversationId) as Row[]
    ).map(reference);
  }

  createGoal(input: NewGoal): Goal {
    const objective = input.objective.trim();
    if (!objective) throw new Error("Goal objective cannot be empty");
    const existing = this.getGoal(input.conversationId);
    if (existing && existing.status !== "completed")
      throw new Error("Conversation already has an unfinished goal");
    const now = this.#clock();
    this.database
      .prepare(
        `INSERT INTO goals (id,conversation_id,objective,status,created_at,updated_at,completed_at)
      VALUES (?,?,?,?,?,?,NULL) ON CONFLICT(conversation_id) DO UPDATE SET id=excluded.id,objective=excluded.objective,status=excluded.status,created_at=excluded.created_at,updated_at=excluded.updated_at,completed_at=NULL`,
      )
      .run(
        input.id,
        input.conversationId,
        objective,
        input.status ?? "active",
        now,
        now,
      );
    return this.getGoal(input.conversationId)!;
  }

  getGoal(conversationId: Id): Goal | null {
    const row = this.database
      .prepare("SELECT * FROM goals WHERE conversation_id=?")
      .get(conversationId) as Row | undefined;
    return row
      ? {
          id: text(row.id),
          conversationId: text(row.conversation_id),
          objective: text(row.objective),
          status: text(row.status) as GoalStatus,
          createdAt: text(row.created_at),
          updatedAt: text(row.updated_at),
          completedAt: nullableText(row.completed_at),
        }
      : null;
  }

  updateGoal(
    conversationId: Id,
    patch: { objective?: string; status?: GoalStatus },
  ): Goal | null {
    const current = this.getGoal(conversationId);
    if (!current) return null;
    const objective = patch.objective?.trim() ?? current.objective;
    if (!objective) throw new Error("Goal objective cannot be empty");
    const status = patch.status ?? current.status;
    const now = this.#clock();
    this.database
      .prepare(
        "UPDATE goals SET objective=?,status=?,updated_at=?,completed_at=? WHERE conversation_id=?",
      )
      .run(
        objective,
        status,
        now,
        status === "completed" ? (current.completedAt ?? now) : null,
        conversationId,
      );
    return this.getGoal(conversationId);
  }

  clearGoal(conversationId: Id): boolean {
    return (
      Number(
        this.database
          .prepare("DELETE FROM goals WHERE conversation_id=?")
          .run(conversationId).changes,
      ) > 0
    );
  }

  setSitePermission(
    origin: string,
    permission: string,
    decision: PermissionDecision,
  ): SitePermission {
    const now = this.#clock();
    this.database
      .prepare(
        "INSERT INTO site_permissions (origin,permission,decision,updated_at) VALUES (?,?,?,?) ON CONFLICT(origin,permission) DO UPDATE SET decision=excluded.decision,updated_at=excluded.updated_at",
      )
      .run(origin, permission, decision, now);
    return { origin, permission, decision, updatedAt: now };
  }

  getSitePermission(origin: string, permission: string): SitePermission | null {
    const row = this.database
      .prepare("SELECT * FROM site_permissions WHERE origin=? AND permission=?")
      .get(origin, permission) as Row | undefined;
    return row ? sitePermission(row) : null;
  }

  listSitePermissions(origin?: string): SitePermission[] {
    const rows =
      origin === undefined
        ? this.database
            .prepare(
              "SELECT * FROM site_permissions ORDER BY origin, permission",
            )
            .all()
        : this.database
            .prepare(
              "SELECT * FROM site_permissions WHERE origin=? ORDER BY permission",
            )
            .all(origin);
    return (rows as Row[]).map(sitePermission);
  }

  clearSitePermissions(origin?: string): number {
    return Number(
      origin === undefined
        ? this.database.prepare("DELETE FROM site_permissions").run().changes
        : this.database
            .prepare("DELETE FROM site_permissions WHERE origin=?")
            .run(origin).changes,
    );
  }

  startDownload(input: NewBrowserDownload): BrowserDownload {
    const now = this.#clock();
    this.database
      .prepare(
        "INSERT INTO browser_downloads (id,url,filename,path,mime_type,received_bytes,total_bytes,state,started_at,finished_at) VALUES (?,?,?,?,?,0,?,?,?,NULL)",
      )
      .run(
        input.id,
        input.url,
        input.filename,
        input.path,
        input.mimeType ?? null,
        input.totalBytes ?? 0,
        input.state ?? "progressing",
        now,
      );
    return this.#download(input.id)!;
  }

  updateDownload(
    id: Id,
    patch: {
      state?: DownloadState;
      receivedBytes?: number;
      totalBytes?: number;
      path?: string;
    },
  ): BrowserDownload | null {
    const current = this.#download(id);
    if (!current) return null;
    const state = patch.state ?? current.state;
    // A download reaches its end once and stays there: the first terminal
    // state stamps the time, and a later progress event cannot unstamp it.
    const settled = state === "progressing" || state === "paused";
    this.database
      .prepare(
        "UPDATE browser_downloads SET state=?,received_bytes=?,total_bytes=?,path=?,finished_at=? WHERE id=?",
      )
      .run(
        state,
        patch.receivedBytes ?? current.receivedBytes,
        patch.totalBytes ?? current.totalBytes,
        patch.path ?? current.path,
        settled ? null : (current.finishedAt ?? this.#clock()),
        id,
      );
    return this.#download(id);
  }

  listDownloads(options: { limit?: number } = {}): BrowserDownload[] {
    const rows =
      options.limit === undefined
        ? this.database
            .prepare("SELECT * FROM browser_downloads ORDER BY started_at DESC")
            .all()
        : this.database
            .prepare(
              "SELECT * FROM browser_downloads ORDER BY started_at DESC LIMIT ?",
            )
            .all(options.limit);
    return (rows as Row[]).map(browserDownload);
  }

  deleteDownload(id: Id): boolean {
    return (
      Number(
        this.database
          .prepare("DELETE FROM browser_downloads WHERE id=?")
          .run(id).changes,
      ) > 0
    );
  }

  clearDownloads(): number {
    return Number(
      this.database.prepare("DELETE FROM browser_downloads").run().changes,
    );
  }

  recordVisit(input: NewHistoryEntry): HistoryEntry {
    const row = this.#writeVisit(input);
    return historyEntry(row);
  }

  recordVisits(entries: NewHistoryEntry[]): number {
    if (!entries.length) return 0;
    // One transaction for the lot. An imported history is tens of thousands of
    // rows, and a statement each commits separately — minutes instead of the
    // second this takes.
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const entry of entries) this.#writeVisit(entry);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return entries.length;
  }

  #writeVisit(input: NewHistoryEntry): Row {
    const visitedAt = input.visitedAt ?? this.#clock();
    const count = Math.max(1, Math.trunc(input.visitCount ?? 1));
    const source = input.source ?? "local";
    // The two sources count differently, and conflating them is what made a
    // repeated import inflate a page's total.
    //
    // A local visit is a *delta*: this page, once more, so it adds. A browser's
    // exported `visit_count` is an *absolute* — the running total it has kept
    // for that url since the profile was made — so importing the same profile
    // twice must land on the same number, not twice it. Hence MAX, which makes
    // a re-import idempotent and still lets a later, larger export raise it.
    //
    // The visited time takes whichever is newer either way: an import carries
    // times from years ago and must not drag a page the user opened this
    // morning back down the list.
    const merge =
      source === "import"
        ? "visit_count = MAX(visit_count, excluded.visit_count)"
        : "visit_count = visit_count + excluded.visit_count";
    this.database
      .prepare(
        `INSERT INTO browser_history (url,title,visited_at,visit_count,source)
         VALUES (?,?,?,?,?)
         ON CONFLICT(url) DO UPDATE SET
           ${merge},
           visited_at = MAX(visited_at, excluded.visited_at),
           title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE title END`,
      )
      .run(input.url, input.title ?? "", visitedAt, count, source);
    return this.database
      .prepare("SELECT * FROM browser_history WHERE url=?")
      .get(input.url) as Row;
  }

  listHistory(options: {query?: string; limit?: number} = {}): HistoryEntry[] {
    const limit = Math.max(1, Math.trunc(options.limit ?? 200));
    const query = options.query?.trim();
    const rows = query
      ? (this.database
          .prepare(
            `SELECT * FROM browser_history
             WHERE url LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\'
             ORDER BY visited_at DESC LIMIT ?`,
          )
          .all(`%${escapeLike(query)}%`, `%${escapeLike(query)}%`, limit) as Row[])
      : (this.database
          .prepare("SELECT * FROM browser_history ORDER BY visited_at DESC LIMIT ?")
          .all(limit) as Row[]);
    return rows.map(historyEntry);
  }

  deleteHistoryEntry(url: string): boolean {
    return (
      Number(
        this.database.prepare("DELETE FROM browser_history WHERE url=?").run(url)
          .changes ?? 0,
      ) > 0
    );
  }

  clearHistory(options: {source?: HistoryEntry["source"]} = {}): number {
    const result = options.source
      ? this.database
          .prepare("DELETE FROM browser_history WHERE source=?")
          .run(options.source)
      : this.database.prepare("DELETE FROM browser_history").run();
    return Number(result.changes ?? 0);
  }

  upsertSavedLogin(input: NewSavedLogin): SavedLogin {
    const now = this.#clock();
    // Re-saving an account the user already has keeps the original row and its
    // id, because the id is what the vault files the password under: a new one
    // would strand the old secret and lose the password that was just updated.
    this.database
      .prepare(
        "INSERT INTO saved_logins (id,origin,username,source,created_at,updated_at,last_used_at) VALUES (?,?,?,?,?,?,NULL) ON CONFLICT(origin,username) DO UPDATE SET updated_at=excluded.updated_at",
      )
      .run(
        input.id,
        input.origin,
        input.username,
        input.source ?? "manual",
        now,
        now,
      );
    return savedLogin(
      this.database
        .prepare("SELECT * FROM saved_logins WHERE origin=? AND username=?")
        .get(input.origin, input.username) as Row,
    );
  }

  getSavedLogin(id: Id): SavedLogin | null {
    const row = this.database
      .prepare("SELECT * FROM saved_logins WHERE id=?")
      .get(id) as Row | undefined;
    return row ? savedLogin(row) : null;
  }

  listSavedLogins(origin?: string): SavedLogin[] {
    const rows =
      origin === undefined
        ? this.database
            .prepare("SELECT * FROM saved_logins ORDER BY origin, username")
            .all()
        : this.database
            .prepare(
              "SELECT * FROM saved_logins WHERE origin=? ORDER BY last_used_at DESC, username",
            )
            .all(origin);
    return (rows as Row[]).map(savedLogin);
  }

  touchSavedLogin(id: Id): SavedLogin | null {
    const now = this.#clock();
    this.database
      .prepare("UPDATE saved_logins SET last_used_at=? WHERE id=?")
      .run(now, id);
    return this.getSavedLogin(id);
  }

  deleteSavedLogin(id: Id): boolean {
    return (
      Number(
        this.database
          .prepare("DELETE FROM saved_logins WHERE id=?")
          .run(id).changes,
      ) > 0
    );
  }

  readCommsCache(key: string): CommsCacheEntry | null {
    const row = this.database
      .prepare("SELECT * FROM comms_cache WHERE key=?")
      .get(key) as Row | undefined;
    return row ? commsCacheEntry(row) : null;
  }

  listCommsCache(prefix: string): CommsCacheEntry[] {
    return (
      this.database
        .prepare(
          "SELECT * FROM comms_cache WHERE key LIKE ? ESCAPE '\\' ORDER BY fetched_at DESC",
        )
        .all(`${likePrefix(prefix)}%`) as Row[]
    ).map(commsCacheEntry);
  }

  writeCommsCache(key: string, value: string): CommsCacheEntry {
    const fetchedAt = this.#clock();
    this.database
      .prepare(
        `INSERT INTO comms_cache (key,value,fetched_at) VALUES (?,?,?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, fetched_at=excluded.fetched_at`,
      )
      .run(key, value, fetchedAt);
    return { key, value, fetchedAt };
  }

  deleteCommsCache(prefix: string): number {
    return Number(
      this.database
        .prepare("DELETE FROM comms_cache WHERE key LIKE ? ESCAPE '\\'")
        .run(`${likePrefix(prefix)}%`).changes,
    );
  }

  trimCommsCache(prefix: string, keep: number): number {
    return Number(
      this.database
        .prepare(
          `DELETE FROM comms_cache WHERE key IN (
             SELECT key FROM comms_cache WHERE key LIKE ? ESCAPE '\\'
             ORDER BY fetched_at DESC LIMIT -1 OFFSET ?
           )`,
        )
        .run(`${likePrefix(prefix)}%`, Math.max(0, Math.trunc(keep))).changes,
    );
  }

  #download(id: Id): BrowserDownload | null {
    const row = this.database
      .prepare("SELECT * FROM browser_downloads WHERE id=?")
      .get(id) as Row | undefined;
    return row ? browserDownload(row) : null;
  }
}
