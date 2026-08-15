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
  listRuns(conversationId: Id): AgentRun[];
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
  upsertMemory(input: NewMemory): MemoryRecord;
  getMemory(id: Id): MemoryRecord | null;
  listMemories(filter?: {
    scope?: MemoryScope;
    scopeId?: Id | null;
    includeDeleted?: boolean;
  }): MemoryRecord[];
  deleteMemory(id: Id): boolean;
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

export interface Storage
  extends ConversationStore, RunStore, MemoryStore, ResourceStore, GoalStore {
  transaction<T>(work: () => T): T;
  close(): void;
}
