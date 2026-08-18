export type Id = string;
export type Timestamp = string;
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface Conversation {
  id: Id;
  title: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  archivedAt: Timestamp | null;
  metadata: JsonValue;
}

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface StoredMessage {
  id: Id;
  conversationId: Id;
  runId: Id | null;
  role: MessageRole;
  content: JsonValue;
  createdAt: Timestamp;
  sequence: number;
  metadata: JsonValue;
}

/** One match from a history search, carrying enough to locate and read it. */
export interface MessageSearchHit {
  conversationId: Id;
  conversationTitle: string;
  messageId: Id;
  role: MessageRole;
  sequence: number;
  createdAt: Timestamp;
  /** The matched message rendered as plain text. */
  text: string;
}

export type RunStatus =
  "queued" | "running" | "completed" | "cancelled" | "failed" | "interrupted";

export interface AgentRun {
  id: Id;
  conversationId: Id;
  status: RunStatus;
  model: string | null;
  startedAt: Timestamp | null;
  finishedAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  error: JsonValue | null;
  usage: JsonValue | null;
  parentRunId: Id | null;
}

export type GoalStatus = "active" | "paused" | "completed" | "blocked";
export interface Goal {
  id: Id;
  conversationId: Id;
  objective: string;
  status: GoalStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  completedAt: Timestamp | null;
}

export interface RunEvent {
  runId: Id;
  sequence: number;
  type: string;
  payload: JsonValue;
  createdAt: Timestamp;
}

export interface Compaction {
  id: Id;
  conversationId: Id;
  throughMessageSequence: number;
  summary: string;
  tokenCount: number | null;
  /**
   * Identity of the messages this summary replaced, so a later session can tell
   * whether it still describes the conversation it was written for. Empty on
   * rows saved before this was recorded, which are never reused.
   */
  prefixFingerprint: string;
  createdAt: Timestamp;
}

export type MemoryScope = "user" | "conversation";

export interface MemoryRecord {
  id: Id;
  scope: MemoryScope;
  scopeId: Id | null;
  kind: string;
  content: string;
  sourceConversationId: Id | null;
  confidence: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  deletedAt: Timestamp | null;
  metadata: JsonValue;
}

export interface Preference {
  key: string;
  value: JsonValue;
  updatedAt: Timestamp;
}

export type ArtifactKind =
  "document" | "slides" | "sheet" | "photo" | "video" | "other";

export interface Artifact {
  id: Id;
  conversationId: Id | null;
  runId: Id | null;
  kind: ArtifactKind;
  name: string;
  path: string;
  mimeType: string | null;
  size: number | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  metadata: JsonValue;
}

export type ReferenceKind = "web" | "file" | "other";

export interface StoredReference {
  id: Id;
  conversationId: Id;
  runId: Id | null;
  kind: ReferenceKind;
  title: string;
  uri: string;
  createdAt: Timestamp;
  metadata: JsonValue;
}

export interface Attachment {
  id: Id;
  messageId: Id;
  name: string;
  path: string;
  mimeType: string | null;
  size: number | null;
  sha256: string | null;
  createdAt: Timestamp;
}

/** What a site is allowed to ask the embedded browser for. `ask` is stored
 * rather than implied by absence, so a site the user has explicitly reset is
 * distinguishable from one that has never come up. */
export type PermissionDecision = "allow" | "deny" | "ask";

export interface SitePermission {
  origin: string;
  permission: string;
  decision: PermissionDecision;
  updatedAt: Timestamp;
}

export type DownloadState =
  "progressing" | "paused" | "completed" | "cancelled" | "interrupted";

export interface BrowserDownload {
  id: Id;
  url: string;
  filename: string;
  path: string;
  mimeType: string | null;
  receivedBytes: number;
  totalBytes: number;
  state: DownloadState;
  startedAt: Timestamp;
  finishedAt: Timestamp | null;
}

/** The public half of a saved login. The password lives in the encrypted
 * vault under this row's `id` and never enters the database. */
/** One page in the browsing history: a url, not a visit. `visitCount` is what
 * survives from collapsing repeat visits into a single row. */
export interface HistoryEntry {
  url: string;
  title: string;
  visitedAt: string;
  visitCount: number;
  source: "local" | "import";
}

export type NewHistoryEntry = Pick<HistoryEntry, "url"> &
  Partial<Pick<HistoryEntry, "title" | "visitedAt" | "visitCount" | "source">>;

export interface SavedLogin {
  id: Id;
  origin: string;
  username: string;
  source: "manual" | "import";
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastUsedAt: Timestamp | null;
}

export type NewConversation = Pick<Conversation, "id" | "title"> &
  Partial<Pick<Conversation, "metadata">>;
export type NewMessage = Pick<
  StoredMessage,
  "id" | "conversationId" | "role" | "content"
> &
  Partial<Pick<StoredMessage, "runId" | "metadata">>;
export type NewRun = Pick<AgentRun, "id" | "conversationId"> &
  Partial<Pick<AgentRun, "model" | "status" | "parentRunId">>;
export type NewGoal = Pick<Goal, "id" | "conversationId" | "objective"> &
  Partial<Pick<Goal, "status">>;
export type NewCompaction = Omit<Compaction, "createdAt">;
export type NewMemory = Pick<
  MemoryRecord,
  "id" | "scope" | "kind" | "content"
> &
  Partial<
    Pick<
      MemoryRecord,
      "scopeId" | "sourceConversationId" | "confidence" | "metadata"
    >
  >;
export type NewArtifact = Pick<Artifact, "id" | "kind" | "name" | "path"> &
  Partial<
    Pick<
      Artifact,
      "conversationId" | "runId" | "mimeType" | "size" | "metadata"
    >
  >;
export type NewReference = Pick<
  StoredReference,
  "id" | "conversationId" | "kind" | "title" | "uri"
> &
  Partial<Pick<StoredReference, "runId" | "metadata">>;
export type NewAttachment = Omit<Attachment, "createdAt">;
export type NewBrowserDownload = Pick<
  BrowserDownload,
  "id" | "url" | "filename" | "path"
> &
  Partial<Pick<BrowserDownload, "mimeType" | "totalBytes" | "state">>;
export type NewSavedLogin = Pick<SavedLogin, "id" | "origin" | "username"> &
  Partial<Pick<SavedLogin, "source">>;
