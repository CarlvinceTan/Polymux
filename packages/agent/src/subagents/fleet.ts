import type { AgentRunControl } from "@flareai/core";
import type { InferenceMessage } from "@flareai/inference";
import type { Ledger } from "./ledger.js";

/**
 * What a delegated run is doing, as the run that dispatched it sees it.
 *
 * Derived from the child's own outcome rather than self-reported: a subagent
 * that dies, is cancelled, or simply forgets to say it finished still reaches
 * a final status here, because the status is read off the run and not off
 * anything the model remembered to do.
 */
export type SubagentStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface SubagentEntry {
  /** How the parent addresses this task — short, stable, its own for the run. */
  name: string;
  description: string;
  runId: string;
  status: SubagentStatus;
  /** The child's closing message, once it has one. */
  result?: string;
  /** A `retain`ed worker's final context, kept so a follow-up dispatch can
   * resume the task instead of re-browsing. Freed when the task is continued
   * or the parent run ends; never kept for a task that did not opt in. */
  retained?: InferenceMessage[];
}

export function isFinal(status: SubagentStatus): boolean {
  return status !== "running";
}

/**
 * The delegated runs one parent run has going, and the post between them.
 *
 * Dispatch does not block: `spawn` registers a task and returns, and the
 * parent keeps working. When a task reaches a final status the fleet posts a
 * `<subagent_notification>` into the parent's steering queue, which the runner
 * drains at the next turn boundary — so a result lands in the parent's context
 * without interrupting the turn that happened to be in flight, and without the
 * parent having to ask.
 *
 * Everything else here exists so the parent can choose when to be blocked:
 * `waitForNews` says *that* there is post (never what it says — the post
 * itself carries that, and a tool result repeating it would put the same text
 * in the context twice), and `settleOutstanding` is the backstop that keeps a
 * run from ending while a task it started is still going.
 */
export class SubagentFleet {
  readonly #entries = new Map<string, SubagentEntry>();
  readonly #settled = new Map<string, Promise<void>>();
  /** Posted, not yet handed to the runner. */
  readonly #outbox: InferenceMessage[] = [];
  readonly #waiters = new Set<() => void>();
  readonly #ledger: Ledger | undefined;
  #control: AgentRunControl | undefined;
  #counter = 0;

  constructor(ledger?: Ledger) {
    this.#ledger = ledger;
  }

  /** The run's shared ledger, when the run can delegate — the dispatch passes
   * it on to the tasks that opt in. */
  get ledger(): Ledger | undefined {
    return this.#ledger;
  }

  /** The parent's control, once the runner has handed it over. Until then the
   * outbox holds; nothing is lost by a task that finishes during startup. */
  attach(control: AgentRunControl): void {
    this.#control = control;
    this.#flush();
  }

  spawn(description: string, runId: string): SubagentEntry {
    this.#counter += 1;
    const entry: SubagentEntry = {
      name: `task_${this.#counter}`,
      description,
      runId,
      status: "running",
    };
    this.#entries.set(entry.name, entry);
    return entry;
  }

  /** One task as the parent addressed it, when the dispatch needs to read its
   * retained context or decide whether it can be continued at all. */
  entry(name: string): SubagentEntry | undefined {
    return this.#entries.get(name);
  }

  /** Keeps a settled worker's final context for a later `continue` — only
   * called when the dispatch opted in with `retain`, so memory stays bounded
   * by the number of tasks the orchestrator actually means to resume. */
  storeRetained(name: string, messages: InferenceMessage[]): void {
    const entry = this.#entries.get(name);
    if (entry) entry.retained = messages;
  }

  /**
   * The `continue` path: re-arms a settled entry under a new run, so the
   * follow-up keeps the task's name and row. `settle`'s is-final guard is
   * bypassed only here; the fresh `track` that follows posts the follow-up's
   * own notification when it settles, and `settleOutstanding` picks the
   * re-tracked run up like any other.
   */
  resume(
    name: string,
    runId: string,
    retained?: InferenceMessage[],
  ): SubagentEntry | undefined {
    const entry = this.#entries.get(name);
    if (!entry) return undefined;
    entry.status = "running";
    entry.result = undefined;
    entry.runId = runId;
    if (retained) entry.retained = retained;
    else delete entry.retained;
    return entry;
  }

  /** Records a task's outcome and posts it to the parent. */
  settle(name: string, status: SubagentStatus, result: string): void {
    const entry = this.#entries.get(name);
    if (!entry || isFinal(entry.status)) return;
    entry.status = status;
    entry.result = result;
    this.#outbox.push(notification(entry, this.#ledger));
    this.#flush();
    for (const waiter of this.#waiters) waiter();
  }

  /** Follows a delegated run to its end, whatever that end turns out to be. */
  track(name: string, run: Promise<{ status: string; text: string }>): void {
    this.#settled.set(
      name,
      run
        .then(({ status, text }) => {
          this.settle(name, subagentStatus(status), text);
        })
        .catch((error: unknown) => {
          this.settle(name, "failed", errorText(error));
        }),
    );
  }

  roster(): SubagentEntry[] {
    return [...this.#entries.values()];
  }

  outstanding(): SubagentEntry[] {
    return this.roster().filter((entry) => !isFinal(entry.status));
  }

  /**
   * Resolves when any task has news the parent has not been handed yet, when
   * the wait times out, or when the run is cancelled. Reports which tasks
   * moved, never what they said.
   */
  async waitForNews(
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<{ updated: string[]; timedOut: boolean }> {
    const before = new Set(
      this.roster()
        .filter((entry) => isFinal(entry.status))
        .map((entry) => entry.name),
    );
    const moved = (): string[] =>
      this.roster()
        .filter((entry) => isFinal(entry.status) && !before.has(entry.name))
        .map((entry) => entry.name);

    // Nothing to wait for is not a timeout: a parent that waits with every
    // task already home should be told so and get straight back to work.
    if (moved().length || !this.outstanding().length)
      return { updated: moved(), timedOut: false };

    const timedOut = await new Promise<boolean>((resolve) => {
      const finish = (value: boolean) => {
        clearTimeout(timer);
        this.#waiters.delete(wake);
        signal.removeEventListener("abort", abort);
        resolve(value);
      };
      const wake = () => finish(false);
      const abort = () => finish(false);
      const timer = setTimeout(() => finish(true), timeoutMs);
      this.#waiters.add(wake);
      signal.addEventListener("abort", abort, { once: true });
    });
    return { updated: moved(), timedOut };
  }

  /** Waits out every task still running, so the parent never ends a run in the
   * middle of an errand it sent someone on. */
  async settleOutstanding(): Promise<void> {
    while (this.outstanding().length)
      await Promise.allSettled([...this.#settled.values()]);
  }

  /** Post the parent has not been handed, taken in one go. The steering queue
   * comes with it: anything the user said while the fleet was being waited on
   * belongs in the same batch, and dropping it here would lose it. */
  takePost(): InferenceMessage[] {
    const control = this.#control;
    const queued = control ? control.drainSteering() : [];
    return [...queued, ...this.#outbox.splice(0)];
  }

  #flush(): void {
    const control = this.#control;
    if (!control || control.aborted) return;
    for (const message of this.#outbox.splice(0)) control.steer(message);
  }
}

/**
 * A finished task, as the parent reads it: one tagged fragment carrying the
 * address, the outcome and the closing message. Tagged rather than prose so a
 * result the subagent read off a web page cannot pass itself off as the user
 * speaking — everything inside the markers is a report to weigh, not an
 * instruction to follow.
 */
/** How much of a ledger-using task's closing message its notification may
 * carry. The data itself lives in the ledger; this is just the verdict. */
const NOTIFICATION_RESULT_CAP = 1_000;

function notification(entry: SubagentEntry, ledger?: Ledger): InferenceMessage {
  let result = entry.result ?? "";
  // A task that coordinated through the ledger reports compactly: its counts
  // travel with the notification, its full data stays in the ledger for the
  // parent to read with ledger_list / ledger_stats — so a chatty task cannot
  // dump a whole item list into the parent's context.
  let ledgerSummary:
    | { wrote: { posted: number; claimed: number; resolved: number }; pool: number }
    | undefined;
  if (ledger) {
    const tally = ledger.byTask(entry.name);
    if (tally.posted + tally.claimed + tally.updated > 0) {
      // What *this* task did, not the whole board: the board is the parent's
      // to read with ledger_stats whenever it wants it, and repeating it in
      // every notification would say the same thing once per task.
      ledgerSummary = {
        wrote: {
          posted: tally.posted,
          claimed: tally.claimed,
          resolved: tally.updated,
        },
        pool: ledger.stats().total,
      };
      result = `${
        result.length > NOTIFICATION_RESULT_CAP
          ? `${result.slice(0, NOTIFICATION_RESULT_CAP)}…`
          : result
      }\n[Full data in the shared ledger — read it with ledger_list / ledger_stats.]`;
    }
  }
  return {
    role: "user",
    content: [
      "<subagent_notification>",
      JSON.stringify({
        task: entry.name,
        description: entry.description,
        status: entry.status,
        ...(ledgerSummary ? { ledger: ledgerSummary } : {}),
        result,
      }),
      "</subagent_notification>",
    ].join("\n"),
  };
}

function subagentStatus(status: string): SubagentStatus {
  if (status === "completed") return "completed";
  if (status === "cancelled") return "cancelled";
  return "failed";
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
