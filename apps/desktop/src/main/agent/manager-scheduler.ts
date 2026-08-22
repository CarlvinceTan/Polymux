import type {ManagerJob} from "./chat-pool.js";

export const MANAGER_CHAT_RUN_LIMIT = 2;
export const MANAGER_GLOBAL_RUN_LIMIT = 4;

const DESTRUCTIVE_OR_EXTERNAL_COMMIT = /\b(?:send|submit|post|publish|purchase|buy|book|pay|transfer|delete|remove|archive|unlink|disconnect|cancel|sign|approve|reject|accept)\b/i;
const CONTINUATION_OPENING = /^(?:and\s+)?(?:after\s+that|afterwards|once\s+(?:that|this|it)(?:'s|\s+is)\s+done|when\s+(?:that|this|it)(?:'s|\s+is)\s+done|continue|then|next|now|follow\s+up|retry|try\s+again|revise|update|change|fix|do\s+that|use\s+that|based\s+on|from\s+that|the\s+same)\b/i;

/**
 * Work which can observe or mutate a shared prior state stays serialized.
 * The heuristic deliberately errs toward exclusivity: parallelism is an
 * optimisation, while ordering a goal, dependency, continuation, or external
 * commit incorrectly is a correctness bug.
 */
type SchedulableJob = Pick<ManagerJob, "text"> & Partial<Pick<ManagerJob, "asGoal" | "dependencyIds">>;

export function managerJobRequiresExclusiveRun(job: SchedulableJob): boolean {
  return job.asGoal === true
    || (job.dependencyIds?.length ?? 0) > 0
    || DESTRUCTIVE_OR_EXTERNAL_COMMIT.test(job.text)
    || CONTINUATION_OPENING.test(job.text.trim());
}

/** Independent siblings accepted while work is already queued/running share
 * the same settled-history boundary. Using the latest database sequence for
 * every enqueue lets a fast first startup append its prompt before the second
 * job is accepted, contaminating the second job despite separate run IDs. */
export function managerContextThroughSequence(input: {
  jobs: readonly ManagerJob[];
  chatId: string;
  job: SchedulableJob;
  latestSequence: number;
}): number {
  if (managerJobRequiresExclusiveRun(input.job)) return input.latestSequence;
  const siblingBoundaries = input.jobs
    .filter((job) =>
      job.chatId === input.chatId
      && (job.status === "queued" || job.status === "running")
      && !managerJobRequiresExclusiveRun(job)
      && job.contextThroughSequence !== null,
    )
    .map((job) => job.contextThroughSequence!);
  return siblingBoundaries.length
    ? Math.min(input.latestSequence, ...siblingBoundaries)
    : input.latestSequence;
}

/** Exclusive work begins only after the lane ahead of it settles. Refresh its
 * view at claim time so natural continuations such as "After that..." receive
 * the result they waited for even when no explicit dependency id exists. */
export function managerClaimContextThroughSequence(
  job: SchedulableJob,
  latestSequence: number,
): number | undefined {
  return managerJobRequiresExclusiveRun(job) ? latestSequence : undefined;
}

export interface ManagerRunCapacityInput {
  jobs: readonly ManagerJob[];
  activeTopLevelRuns: readonly {runId: string; conversationId: string}[];
  chatId: string;
}

/**
 * Number of independent scheduler jobs which may start immediately. Running
 * durable claims count before agent startup finishes, closing the race between
 * simultaneous drains in different chats.
 */
export function managerRunCapacity(input: ManagerRunCapacityInput): number {
  const running = input.jobs.filter((job) => job.status === "running" && job.runId);
  const activeIds = new Set(input.activeTopLevelRuns.map((run) => run.runId));
  // A cancelled run remains active until its agent actually settles. Retain
  // its exclusivity during that short shutdown window.
  const activeManager = input.jobs.filter((job) => job.runId && activeIds.has(job.runId));
  const runningIds = new Set(running.map((job) => job.runId!));
  const unmanagedActive = input.activeTopLevelRuns
    .filter((run) => !runningIds.has(run.runId));
  const globalOccupancy = running.length + unmanagedActive.length;
  const chatRunning = running.filter((job) => job.chatId === input.chatId);
  const chatUnmanaged = unmanagedActive.filter((run) =>
    run.conversationId === input.chatId);
  const chatOccupancy = chatRunning.length + chatUnmanaged.length;
  if (activeManager.some((job) =>
    job.chatId === input.chatId && managerJobRequiresExclusiveRun(job))) return 0;
  return Math.max(0, Math.min(
    MANAGER_GLOBAL_RUN_LIMIT - globalOccupancy,
    MANAGER_CHAT_RUN_LIMIT - chatOccupancy,
  ));
}
