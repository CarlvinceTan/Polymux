import type {
  AgentRun,
  Artifact,
  Attachment,
  Compaction,
  Conversation,
  Id,
  JsonValue,
  MessageRole,
  MessageSearchHit,
  NewArtifact,
  NewAttachment,
  NewCompaction,
  NewConversation,
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
} from "./types.js";

export interface ConversationStore {
  createConversation(input: NewConversation): Conversation;
  getConversation(id: Id): Conversation | null;
  listConversations(options?: {
    includeArchived?: boolean;
    limit?: number;
    offset?: number;
  }): Conversation[];
  updateConversation(
    id: Id,
    patch: { title?: string; archived?: boolean; metadata?: JsonValue },
  ): Conversation | null;
  deleteConversation(id: Id): boolean;
  appendMessage(input: NewMessage): StoredMessage;
  getMessage(id: Id): StoredMessage | null;
  updateMessage(
    id: Id,
    patch: { content?: JsonValue; metadata?: JsonValue },
  ): StoredMessage | null;
  listMessages(
    conversationId: Id,
    options?: { afterSequence?: number; limit?: number },
  ): StoredMessage[];
  /**
   * Substring search across stored messages, newest first. Conversation history
   * is the record of what was actually said, so it is searched on demand rather
   * than distilled ahead of time into memory.
   */
  searchMessages(
    query: string,
    options?: { limit?: number; conversationId?: Id; roles?: MessageRole[] },
  ): MessageSearchHit[];
  addAttachment(input: NewAttachment): Attachment;
  listAttachments(messageId: Id): Attachment[];
}

export interface RunStore {
  createRun(input: NewRun): AgentRun;
  getRun(id: Id): AgentRun | null;
  updateRun(
    id: Id,
    patch: {
      status?: RunStatus;
      error?: JsonValue | null;
      usage?: JsonValue | null;
    },
  ): AgentRun | null;
  appendRunEvent(runId: Id, type: string, payload: JsonValue): RunEvent;
  listRunEvents(runId: Id, afterSequence?: number): RunEvent[];
}

export interface MemoryStore {
  saveCompaction(input: NewCompaction): Compaction;
  getLatestCompaction(conversationId: Id): Compaction | null;
  setPreference(key: string, value: JsonValue): Preference;
  getPreference(key: string): Preference | null;
  listPreferences(): Preference[];
}

export interface ResourceStore {
  createArtifact(input: NewArtifact): Artifact;
  getArtifact(id: Id): Artifact | null;
  listArtifacts(conversationId?: Id): Artifact[];
  createReference(input: NewReference): StoredReference;
  listReferences(conversationId: Id): StoredReference[];
}

export interface GoalStore {
  createGoal(input: NewGoal): Goal;
  getGoal(conversationId: Id): Goal | null;
  updateGoal(
    conversationId: Id,
    patch: { objective?: string; status?: GoalStatus },
  ): Goal | null;
  clearGoal(conversationId: Id): boolean;
}

/** What the embedded browser keeps between launches. Secrets are not part of
 * it: a saved login's password lives in the encrypted vault, keyed by the id
 * of the row this store returns. */
export interface BrowserStore {
  setSitePermission(
    origin: string,
    permission: string,
    decision: PermissionDecision,
  ): SitePermission;
  getSitePermission(origin: string, permission: string): SitePermission | null;
  listSitePermissions(origin?: string): SitePermission[];
  clearSitePermissions(origin?: string): number;
  startDownload(input: NewBrowserDownload): BrowserDownload;
  updateDownload(
    id: Id,
    patch: {
      state?: DownloadState;
      receivedBytes?: number;
      totalBytes?: number;
      path?: string;
    },
  ): BrowserDownload | null;
  listDownloads(options?: { limit?: number }): BrowserDownload[];
  deleteDownload(id: Id): boolean;
  clearDownloads(): number;
  /** Records one visit of a page. A url already present keeps its earliest
   * source and takes the newer time and title.
   *
   * How the count merges depends on the source: a `local` visit adds one, a
   * browser's exported `visit_count` is that browser's running total and so
   * replaces the stored one only when larger. Importing the same profile twice
   * therefore lands on the same number rather than double it. */
  recordVisit(input: NewHistoryEntry): HistoryEntry;
  /** Most recent first. `query` matches url or title, case-insensitively. */
  listHistory(options?: {query?: string; limit?: number}): HistoryEntry[];
  /** Records many visits in one transaction — an import is tens of thousands
   * of rows, and one statement each is minutes rather than seconds. */
  recordVisits(entries: NewHistoryEntry[]): number;
  deleteHistoryEntry(url: string): boolean;
  /** Everything, or just what was imported. Returns how many rows went. */
  clearHistory(options?: {source?: HistoryEntry["source"]}): number;

  upsertSavedLogin(input: NewSavedLogin): SavedLogin;
  getSavedLogin(id: Id): SavedLogin | null;
  listSavedLogins(origin?: string): SavedLogin[];
  /** Stamps `last_used_at`, so the picker can lead with the account the user
   * actually signs in with when a site has several. */
  touchSavedLogin(id: Id): SavedLogin | null;
  deleteSavedLogin(id: Id): boolean;
}

/** One row of what the hub already knew: a JSON payload under a key, with the
 * time it was fetched. */
export interface CommsCacheEntry {
  key: string;
  value: string;
  fetchedAt: string;
}

/** What the hub shows before it has asked anything.
 *
 * The hub's panes are network-bound — IMAP for a mailbox, the homeserver for a
 * conversation — so a cold start used to be a skeleton for as long as the
 * slowest of them took. This keeps the last answer for each pane across
 * quitting, so the hub opens on what the user last saw and the fetch behind it
 * only corrects what changed. Nothing here is authoritative: every row is a
 * copy of something the network owns, and dropping the table costs a wait, not
 * data. Secrets are not part of it for the same reason they are not part of
 * `BrowserStore` — bodies and conversations are cached, credentials never. */
export interface CommsCacheStore {
  readCommsCache(key: string): CommsCacheEntry | null;
  /** Every row whose key starts with `prefix`, newest first. */
  listCommsCache(prefix: string): CommsCacheEntry[];
  writeCommsCache(key: string, value: string): CommsCacheEntry;
  /** Drops every row under `prefix`. Returns how many went. */
  deleteCommsCache(prefix: string): number;
  /** Keeps the `keep` newest rows under `prefix` and drops the rest, so a
   * cache of message bodies stays a head rather than a history. */
  trimCommsCache(prefix: string, keep: number): number;
}

export interface Storage
  extends ConversationStore,
    RunStore,
    MemoryStore,
    ResourceStore,
    GoalStore,
    BrowserStore,
    CommsCacheStore {
  transaction<T>(work: () => T): T;
  close(): void;
}
