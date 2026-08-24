import type { JsonValue } from "@polymux/storage";
import type {
  TaskCardDto,
  TaskCardInput,
  TaskCardPatch,
  TaskCardStatus,
} from "@polymux/protocol";

export type JobPriority = "background" | "normal" | "urgent" | "attention";
export type JobStatus =
  "queued" | "running" | "completed" | "cancelled" | "failed" | "blocked";

export interface ManagerJob {
  id: string;
  messageId: string;
  chatId: string;
  text: string;
  attachments: string[];
  asGoal: boolean;
  priority: JobPriority;
  dependencyIds: string[];
  /** Last durable message sequence visible when this job was accepted. */
  contextThroughSequence: number | null;
  /** Stable runtime-state namespace for this job's execution and continuations. */
  executionScopeId: string;
  /** User row this job's assistant result should be attached to. */
  replyToMessageId: string;
  status: JobStatus;
  runId: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  /** Completed work stays unread until the user reviews it in Tasks. */
  reviewed: boolean;
}

export interface EnqueueManagerJob {
  id?: string;
  chatId: string;
  text: string;
  attachments?: string[];
  asGoal?: boolean;
  priority?: JobPriority;
  dependencyIds?: string[];
  contextThroughSequence?: number | null;
  executionScopeId?: string;
  replyToMessageId?: string;
}

export interface JobBoardPreferenceStore {
  getPreference(key: string): { value: JsonValue } | null;
  setPreference(key: string, value: JsonValue): unknown;
}

const PREFERENCE_KEY = "orchestration-manager-jobs-v1";
const DEFAULT_TERMINAL_HISTORY_LIMIT = 100;
const PRIORITY: Record<JobPriority, number> = {
  background: 0,
  normal: 1,
  urgent: 2,
  attention: 3,
};

/**
 * Durable user-facing work lifecycle for orchestration.
 *
 * Every task belongs to one chat. Tasks projects that chat's
 * tasks without creating a second store or sharing chat context. The pool
 * makes no scheduling policy guesses beyond deterministic priority/FIFO order.
 */
export class ChatPool {
  readonly #store: JobBoardPreferenceStore;
  readonly #clock: () => Date;
  readonly #newId: () => string;
  readonly #newMessageId: () => string;
  readonly #terminalHistoryLimit: number;
  #jobs: ManagerJob[];
  readonly #listeners = new Set<() => void>();

  constructor(
    store: JobBoardPreferenceStore,
    options: {
      clock?: () => Date;
      newId?: () => string;
      newMessageId?: () => string;
      terminalHistoryLimit?: number;
    } = {},
  ) {
    this.#store = store;
    this.#clock = options.clock ?? (() => new Date());
    this.#newId = options.newId ?? (() => crypto.randomUUID());
    this.#newMessageId = options.newMessageId ?? (() => crypto.randomUUID());
    this.#terminalHistoryLimit =
      options.terminalHistoryLimit ?? DEFAULT_TERMINAL_HISTORY_LIMIT;
    const stored = store.getPreference(PREFERENCE_KEY)?.value;
    const parsed = parseJobs(stored);
    this.#jobs = parsed.jobs;
    this.#recoverInterruptedJobs();
    if (parsed.migrated || this.#pruneTerminalJobs()) this.#persist();
  }

  enqueue(input: EnqueueManagerJob): ManagerJob {
    const chatId = input.chatId.trim();
    const text = input.text.trim();
    if (!chatId) throw new Error("A manager job requires a chat");
    if (!text && !input.attachments?.length)
      throw new Error("A manager job requires text or an attachment");
    const id = input.id?.trim() || this.#newId();
    if (this.#jobs.some((job) => job.id === id))
      throw new Error(`Manager job already exists: ${id}`);
    const dependencyIds = [...new Set(input.dependencyIds ?? [])];
    if (dependencyIds.includes(id))
      throw new Error("A manager job cannot depend on itself");
    for (const dependencyId of dependencyIds)
      if (!this.#jobs.some((job) => job.id === dependencyId))
        throw new Error(`Unknown manager dependency: ${dependencyId}`);
    const now = this.#now();
    const messageId = this.#newMessageId();
    const job: ManagerJob = {
      id,
      messageId,
      chatId,
      text,
      attachments: [...(input.attachments ?? [])],
      asGoal: input.asGoal ?? false,
      priority: input.priority ?? "normal",
      dependencyIds,
      contextThroughSequence: input.contextThroughSequence ?? null,
      executionScopeId: input.executionScopeId?.trim() || id,
      replyToMessageId: input.replyToMessageId?.trim() || messageId,
      status: "queued",
      runId: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
      error: null,
      reviewed: false,
    };
    this.#jobs.push(job);
    this.#persist();
    return clone(job);
  }

  list(chatId?: string): ManagerJob[] {
    return this.#jobs
      .filter((job) => !chatId || job.chatId === chatId)
      .map(clone);
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  cards(chatId?: string): TaskCardDto[] {
    const columnOrder = new Map<TaskCardStatus, number>();
    return this.#jobs
      .filter((job) => !chatId || job.chatId === chatId)
      .map((job) => {
        const status = cardStatus(job.status);
        const order = columnOrder.get(status) ?? 0;
        columnOrder.set(status, order + 1);
        const title =
          job.text.split("\n", 1)[0]?.trim() ||
          job.attachments[0] ||
          "Untitled task";
        const detail = job.text.trim() === title ? undefined : job.text.trim();
        return {
          id: job.id,
          chatId: job.chatId,
          title,
          detail,
          status,
          owner: job.runId ?? undefined,
          reviewed: job.reviewed,
          order,
          createdAt: Date.parse(job.createdAt),
          updatedAt: Date.parse(job.updatedAt),
        };
      });
  }

  createCard(input: TaskCardInput): TaskCardDto {
    const title = input.title.trim();
    const detail = input.detail?.trim();
    const job = this.enqueue({
      chatId: input.chatId,
      text: detail ? `${title}\n${detail}` : title,
    });
    return this.#card(job.id);
  }

  updateCard(id: string, patch: TaskCardPatch): TaskCardDto {
    const job = this.#required(id);
    const previousTitle = job.text.split("\n", 1)[0]?.trim() || "Untitled task";
    const previousDetail =
      job.text.trim() === previousTitle
        ? ""
        : job.text.slice(job.text.indexOf("\n") + 1).trim();
    const title =
      patch.title === undefined ? previousTitle : patch.title.trim();
    const detail =
      patch.detail === undefined ? previousDetail : patch.detail.trim();
    if (!title) throw new Error("A task requires a title");
    job.text = detail ? `${title}\n${detail}` : title;
    if (patch.reviewed !== undefined) job.reviewed = patch.reviewed;
    if (patch.status !== undefined)
      this.#moveToCardStatus(job, patch.status, patch.owner);
    job.updatedAt = this.#now();
    this.#persist();
    return this.#card(id);
  }

  removeCard(id: string): void {
    const job = this.#required(id);
    if (job.status === "running")
      throw new Error("Stop an in-progress task before deleting it");
    this.#jobs = this.#jobs.filter((candidate) => candidate.id !== id);
    this.#persist();
  }

  markCardRead(id: string): TaskCardDto {
    return this.updateCard(id, { reviewed: true });
  }

  claimCard(id: string, owner: string): TaskCardDto {
    const job = this.#required(id);
    if (job.status === "running" && job.runId !== owner)
      throw new Error(
        `Task already claimed by ${job.runId ?? "another worker"}`,
      );
    if (job.status !== "queued" && job.status !== "running")
      throw new Error(`Cannot claim a ${job.status} task`);
    this.#moveToCardStatus(job, "in_progress", owner);
    job.updatedAt = this.#now();
    this.#persist();
    return this.#card(id);
  }

  completeCard(id: string, owner: string): TaskCardDto {
    const job = this.#required(id);
    if (job.runId && job.runId !== owner)
      throw new Error(`Task owned by ${job.runId}, not ${owner}`);
    this.#moveToCardStatus(job, "done");
    job.updatedAt = this.#now();
    this.#persist();
    return this.#card(id);
  }

  recycleCard(id: string): TaskCardDto {
    const job = this.#required(id);
    this.#moveToCardStatus(job, "todo");
    job.updatedAt = this.#now();
    this.#persist();
    return this.#card(id);
  }

  #card(id: string): TaskCardDto {
    const card = this.cards().find((candidate) => candidate.id === id);
    if (!card) throw new Error(`Task not found: ${id}`);
    return card;
  }

  #moveToCardStatus(
    job: ManagerJob,
    status: TaskCardStatus,
    owner?: string,
  ): void {
    const now = this.#now();
    if (status === "todo") {
      job.status = "queued";
      job.runId = null;
      job.startedAt = null;
      job.finishedAt = null;
      job.error = null;
      job.reviewed = false;
    } else if (status === "in_progress") {
      job.status = "running";
      job.runId = owner?.trim() || "user";
      job.startedAt ??= now;
      job.finishedAt = null;
      job.error = null;
    } else {
      job.status = "completed";
      job.runId = null;
      job.finishedAt = now;
      job.error = null;
      job.reviewed = false;
    }
  }

  removeChat(chatId: string): number {
    const before = this.#jobs.length;
    this.#jobs = this.#jobs.filter((job) => job.chatId !== chatId);
    const removed = before - this.#jobs.length;
    if (removed) this.#persist();
    return removed;
  }

  nextReady(chatId?: string): ManagerJob | null {
    this.#refreshBlockedJobs();
    const job = this.#ready(chatId)[0];
    return job ? clone(job) : null;
  }

  forRun(runId: string): ManagerJob | null {
    const job = this.#jobs.find((candidate) => candidate.runId === runId);
    return job ? clone(job) : null;
  }

  /** Claim the highest-priority ready job. Dependencies are completion gates;
   * unrelated chats remain isolated but may compete by priority. */
  claimNext(
    runId: string,
    chatId?: string,
    options: { contextThroughSequence?: number } = {},
  ): ManagerJob | null {
    this.#refreshBlockedJobs();
    const ready = this.#ready(chatId);
    const job = ready[0];
    if (!job) return null;
    const now = this.#now();
    job.status = "running";
    job.runId = runId;
    if (options.contextThroughSequence !== undefined)
      job.contextThroughSequence = options.contextThroughSequence;
    job.startedAt = now;
    job.updatedAt = now;
    this.#persist();
    return clone(job);
  }

  #ready(chatId?: string): ManagerJob[] {
    return (
      this.#jobs
        .filter(
          (job) =>
            job.status === "queued" &&
            (!chatId || job.chatId === chatId) &&
            job.dependencyIds.every(
              (id) =>
                this.#jobs.find((candidate) => candidate.id === id)?.status ===
                "completed",
            ),
        )
        // Array order is the durable FIFO order. Stable sort preserves it inside
        // each priority lane, including after an explicit user reorder.
        .sort(
          (left, right) => PRIORITY[right.priority] - PRIORITY[left.priority],
        )
    );
  }

  complete(id: string): ManagerJob {
    return this.#settle(id, "completed", null);
  }

  fail(id: string, error: string): ManagerJob {
    return this.#settle(id, "failed", error.trim() || "Job failed");
  }

  cancel(id: string): ManagerJob {
    const job = this.#required(id);
    if (["completed", "cancelled", "failed", "blocked"].includes(job.status))
      return clone(job);
    return this.#settle(id, "cancelled", null);
  }

  reprioritize(id: string, priority: JobPriority): ManagerJob {
    const job = this.#required(id);
    if (job.status !== "queued")
      throw new Error("Only queued manager jobs can be reprioritized");
    job.priority = priority;
    job.updatedAt = this.#now();
    this.#persist();
    return clone(job);
  }

  reorder(id: string, targetId: string): ManagerJob[] {
    const job = this.#required(id);
    const target = this.#required(targetId);
    if (job.status !== "queued" || target.status !== "queued")
      throw new Error("Only queued manager jobs can be reordered");
    if (job.chatId !== target.chatId)
      throw new Error("Tasks can only be reordered inside one chat");
    if (job.priority !== target.priority)
      throw new Error(
        "Manager jobs with different priorities cannot be manually reordered",
      );
    const from = this.#jobs.indexOf(job);
    const to = this.#jobs.indexOf(target);
    if (from === to) return this.list(job.chatId);
    this.#jobs.splice(to, 0, ...this.#jobs.splice(from, 1));
    job.updatedAt = this.#now();
    this.#persist();
    return this.list(job.chatId);
  }

  #settle(
    id: string,
    status: Extract<JobStatus, "completed" | "cancelled" | "failed">,
    error: string | null,
  ): ManagerJob {
    const job = this.#required(id);
    if (
      job.status !== "running" &&
      !(status === "cancelled" && job.status === "queued")
    )
      throw new Error(`Cannot mark ${job.status} manager job ${status}`);
    const now = this.#now();
    job.status = status;
    job.error = error;
    if (status === "completed") job.reviewed = false;
    job.finishedAt = now;
    job.updatedAt = now;
    this.#refreshBlockedJobs(now);
    this.#pruneTerminalJobs();
    this.#persist();
    return clone(job);
  }

  #recoverInterruptedJobs(): void {
    let changed = false;
    const now = this.#now();
    for (const job of this.#jobs) {
      if (job.status !== "running") continue;
      job.status = "queued";
      job.runId = null;
      job.startedAt = null;
      job.updatedAt = now;
      changed = true;
    }
    this.#refreshBlockedJobs(now);
    if (changed) this.#persist();
  }

  #refreshBlockedJobs(now = this.#now()): void {
    for (const job of this.#jobs) {
      if (job.status !== "queued") continue;
      const failedDependency = job.dependencyIds
        .map((id) => this.#jobs.find((candidate) => candidate.id === id))
        .find(
          (dependency) =>
            dependency &&
            ["cancelled", "failed", "blocked"].includes(dependency.status),
        );
      if (!failedDependency) continue;
      job.status = "blocked";
      job.error = `Dependency ${failedDependency.id} ${failedDependency.status}`;
      job.finishedAt = now;
      job.updatedAt = now;
    }
  }

  #pruneTerminalJobs(): boolean {
    const activeDependencies = new Set(
      this.#jobs
        .filter((job) => job.status === "queued" || job.status === "running")
        .flatMap((job) => job.dependencyIds),
    );
    const retainedTerminal = new Map<string, number>();
    const keep = new Set<string>();
    for (let index = this.#jobs.length - 1; index >= 0; index -= 1) {
      const job = this.#jobs[index];
      if (
        job.status === "queued" ||
        job.status === "running" ||
        activeDependencies.has(job.id)
      ) {
        keep.add(job.id);
        continue;
      }
      const retained = retainedTerminal.get(job.chatId) ?? 0;
      if (retained < this.#terminalHistoryLimit) keep.add(job.id);
      retainedTerminal.set(job.chatId, retained + 1);
    }
    if (keep.size === this.#jobs.length) return false;
    this.#jobs = this.#jobs.filter((job) => keep.has(job.id));
    return true;
  }

  #required(id: string): ManagerJob {
    const job = this.#jobs.find((candidate) => candidate.id === id);
    if (!job) throw new Error(`Manager job not found: ${id}`);
    return job;
  }

  #now(): string {
    return this.#clock().toISOString();
  }

  #persist(): void {
    this.#store.setPreference(
      PREFERENCE_KEY,
      this.#jobs as unknown as JsonValue,
    );
    for (const listener of this.#listeners) listener();
  }
}

function cardStatus(status: JobStatus): TaskCardStatus {
  if (status === "queued") return "todo";
  if (status === "running") return "in_progress";
  return "done";
}

function clone(job: ManagerJob): ManagerJob {
  return {
    ...job,
    attachments: [...job.attachments],
    dependencyIds: [...job.dependencyIds],
    reviewed: job.reviewed ?? false,
  };
}

function parseJobs(value: JsonValue | undefined): {
  jobs: ManagerJob[];
  migrated: boolean;
} {
  if (!Array.isArray(value)) return { jobs: [], migrated: false };
  let migrated = false;
  const jobs = value.flatMap((entry) => {
    if (!validJob(entry)) return [];
    const stored = entry as unknown as ManagerJob & { conversationId?: string };
    if (!stored.chatId && stored.conversationId) {
      stored.chatId = stored.conversationId;
      delete stored.conversationId;
      migrated = true;
    }
    return [clone(stored)];
  });
  return { jobs, migrated };
}

function validJob(value: JsonValue): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const job = value as Record<string, JsonValue>;
  return (
    typeof job.id === "string" &&
    typeof job.messageId === "string" &&
    (typeof job.chatId === "string" ||
      typeof job.conversationId === "string") &&
    typeof job.text === "string" &&
    Array.isArray(job.attachments) &&
    job.attachments.every((item) => typeof item === "string") &&
    typeof job.asGoal === "boolean" &&
    typeof job.priority === "string" &&
    job.priority in PRIORITY &&
    Array.isArray(job.dependencyIds) &&
    job.dependencyIds.every((item) => typeof item === "string") &&
    (job.contextThroughSequence === null ||
      typeof job.contextThroughSequence === "number") &&
    typeof job.executionScopeId === "string" &&
    typeof job.replyToMessageId === "string" &&
    typeof job.status === "string" &&
    [
      "queued",
      "running",
      "completed",
      "cancelled",
      "failed",
      "blocked",
    ].includes(job.status) &&
    (job.runId === null || typeof job.runId === "string") &&
    typeof job.createdAt === "string" &&
    typeof job.updatedAt === "string" &&
    (job.startedAt === null || typeof job.startedAt === "string") &&
    (job.finishedAt === null || typeof job.finishedAt === "string") &&
    (job.error === null || typeof job.error === "string") &&
    (job.reviewed === undefined || typeof job.reviewed === "boolean")
  );
}
