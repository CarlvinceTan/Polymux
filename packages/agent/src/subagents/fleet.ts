import type { AgentRunControl } from "@flareai/core";
import type { InferenceMessage } from "@flareai/inference";

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
   * resume the task instead of re-browsing. Freed when the task is continued;
   * the experimental host may carry a bounded clone into the next user turn
   * in this conversation. Never kept for a task that did not opt in. */
  retained?: InferenceMessage[];
  /** When retained context was last produced, for bounded cross-turn reuse. */
  retainedAt?: number;
}

export type RetainedSubagentEntry = Pick<
  SubagentEntry,
  "name" | "description" | "runId" | "status" | "result" | "retained" | "retainedAt"
>;

const STRONG_FOLLOW_UP_REFERENCE = /\b(?:which one|those|them|the top|the first|the second|tell me more|more detail|follow[- ]?up|what (?:do|should|would|about)|and (?:what|which|why|how))\b/i;
const WEAK_FOLLOW_UP_REFERENCE = /\b(?:that one|it|actually)\b/i;
const RETAINED_STOP_WORDS = new Set<string>([
  "about", "after", "again", "anything", "check", "could", "from", "have",
  "into", "latest", "more", "should", "that", "their", "them", "this",
  "what", "when", "which", "with", "would",
]);

const OUTCOME_STOP_WORDS = new Set<string>([
  "check", "find", "handle", "latest", "lookup", "remind", "research",
  "result", "summary", "task", "verify", "worker",
]);

function normalizedOutcomeTerms(value: string): string[] {
  const matched: string[] = value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return matched.filter((term: string) =>
    term.length >= 3 && !OUTCOME_STOP_WORDS.has(term));
}

function retainedTerms(value: string): Set<string> {
  const matched: string[] = value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return new Set<string>(matched.filter((word: string) =>
    word.length >= 4 && !RETAINED_STOP_WORDS.has(word)));
}

/** Show retained workers only when the next user turn refers back naturally or
 * shares a concrete topic. Unrelated turns pay no prompt or attention cost. */
export function selectRetainedForPrompt(
  entries: RetainedSubagentEntry[],
  prompt: string,
  maximum = 4,
): RetainedSubagentEntry[] {
  const ordered = [...entries]
    .sort((left, right) => (right.retainedAt ?? 0) - (left.retainedAt ?? 0));
  const query = retainedTerms(prompt);
  const matching = ordered.filter((entry) => {
    const candidate = retainedTerms(`${entry.description} ${entry.result ?? ""}`);
    return [...query].some((word) => candidate.has(word));
  });
  if (STRONG_FOLLOW_UP_REFERENCE.test(prompt))
    return (matching.length ? matching : ordered).slice(0, maximum);
  if (WEAK_FOLLOW_UP_REFERENCE.test(prompt))
    return (matching.length ? matching : ordered).slice(0, 1);
  return matching.slice(0, maximum);
}

export function freshRetainedEntries(
  entries: RetainedSubagentEntry[],
  now = Date.now(),
  maximum = 4,
  ttlMs = 30 * 60_000,
): RetainedSubagentEntry[] {
  const cutoff = now - ttlMs;
  return [...entries]
    .filter((entry) => (entry.retainedAt ?? 0) >= cutoff)
    .sort((left, right) => (right.retainedAt ?? 0) - (left.retainedAt ?? 0))
    .slice(0, maximum);
}

export function isFinal(status: SubagentStatus): boolean {
  return status !== "running";
}

/** Cancellation is a destructive interpretation of steering. Additive user
 * messages must never authorize it; require language that explicitly points
 * back at existing work and redirects, removes, or replaces it. */
function authorizesCancellation(message: InferenceMessage): boolean {
  if (message.role !== "user") return false;
  const content = typeof message.content === "string"
    ? message.content
    : Array.isArray(message.content)
      ? message.content.map((part) =>
          part && typeof part === "object" && "text" in part && typeof part.text === "string"
            ? part.text
            : "").join(" ")
      : "";
  const text = content.toLowerCase().replace(/\s+/g, " ").trim();
  return /\b(?:cancel|drop|skip|ignore|remove)\s+(?:it|that|this|the\s+(?:task|work|request|search)|task_\d+)\b/.test(text) ||
    /\b(?:do|handle|work on|focus on)\s+(?:this|that|the new (?:task|request))\s+instead\b/.test(text) ||
    /\binstead\s+of\s+(?:that|this|the\s+(?:task|work|request|search))\b/.test(text) ||
    /\b(?:do not|don't|no longer)\s+(?:continue|do|handle|work on|need)\b/.test(text) ||
    /\breplace\s+(?:it|that|this|the\s+(?:task|work|request|search))\b/.test(text);
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
  readonly #cancel = new Map<string, () => void>();
  /** Posted, not yet handed to the runner. */
  readonly #outbox: InferenceMessage[] = [];
  readonly #fleetPost = new WeakSet<InferenceMessage>();
  readonly #waiters = new Set<() => void>();
  #control: AgentRunControl | undefined;
  #cancellationSteeringAvailable = false;
  #counter = 0;

  constructor(retained: RetainedSubagentEntry[] = []) {
    for (const source of retained) {
      if (source.status !== "completed" || !source.retained?.length) continue;
      this.#entries.set(source.name, {
        ...source,
        retained: source.retained.map((message) => structuredClone(message)),
      });
      const match = /^subagent_(\d+)$/.exec(source.name);
      if (match) this.#counter = Math.max(this.#counter, Number(match[1]));
    }
  }

  /** The parent's control, once the runner has handed it over. Until then the
   * outbox holds; nothing is lost by a task that finishes during startup. */
  attach(control: AgentRunControl): void {
    this.#control = control;
    if (control.peekSteering().some((message) =>
      !this.#fleetPost.has(message) && authorizesCancellation(message)))
      this.#cancellationSteeringAvailable = true;
    control.onSteer((message) => {
      if (!this.#fleetPost.has(message) && authorizesCancellation(message))
        this.#cancellationSteeringAvailable = true;
    });
    this.#flush();
  }

  /** A model-initiated cancellation is legitimate only after the user has
   * actually redirected this run. Consume the signal once so one steering
   * message cannot become a standing licence to cancel later useful work. */
  consumeExternalSteering(): boolean {
    if (!this.#cancellationSteeringAvailable) return false;
    this.#cancellationSteeringAvailable = false;
    return true;
  }

  /** Terminal delegated work whose user-facing label is absent from the
   * coordinator's proposed final answer. This catches dropped burst items
   * without attempting to judge the substance of an answer. */
  missingOutcomes(answer: string): SubagentEntry[] {
    const terminal = this.roster().filter((entry) => isFinal(entry.status));
    if (terminal.length < 2) return [];
    const haystack = new Set(normalizedOutcomeTerms(answer));
    return terminal.filter((entry) => {
      const terms = normalizedOutcomeTerms(entry.description);
      return terms.length > 0 && !terms.some((term) => haystack.has(term));
    });
  }

  spawn(description: string, runId: string): SubagentEntry {
    this.#counter += 1;
    const entry: SubagentEntry = {
      name: `subagent_${this.#counter}`,
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
    if (entry) {
      entry.retained = messages;
      entry.retainedAt = Date.now();
    }
  }

  /** Completed retained workers safe to carry into the next user turn. */
  retainedRoster(): RetainedSubagentEntry[] {
    return this.roster()
      .filter((entry) => entry.status === "completed" && Boolean(entry.retained?.length))
      .map((entry) => ({
        ...entry,
        retained: entry.retained!.map((message) => structuredClone(message)),
      }));
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
    this.#outbox.push(notification(entry));
    this.#flush();
    for (const waiter of this.#waiters) waiter();
  }

  /** Follows a delegated run to its end, whatever that end turns out to be. */
  track(
    name: string,
    run: Promise<{ status: string; text: string }>,
    cancel?: () => void,
  ): void {
    if (cancel) this.#cancel.set(name, cancel);
    this.#settled.set(
      name,
      run
        .then(({ status, text }) => {
          this.settle(name, subagentStatus(status), text);
        })
        .catch((error: unknown) => {
          this.settle(name, "failed", errorText(error));
        })
        .finally(() => this.#cancel.delete(name)),
    );
  }

  /** Cancel only explicitly named running tasks. The run itself settles the
   * final status and notification, so cancellation cannot forge completion. */
  cancel(names: string[]): { cancelled: string[]; unavailable: string[] } {
    const cancelled: string[] = [];
    const unavailable: string[] = [];
    for (const name of [...new Set(names)]) {
      const entry = this.#entries.get(name);
      const cancel = this.#cancel.get(name);
      if (!entry || entry.status !== "running" || !cancel) {
        unavailable.push(name);
        continue;
      }
      this.#cancel.delete(name);
      cancel();
      cancelled.push(name);
    }
    return {cancelled, unavailable};
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
  ): Promise<{ updated: string[]; timedOut: boolean; steered: boolean }> {
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
      return { updated: moved(), timedOut: false, steered: false };

    const control = this.#control;
    const externallySteered = () =>
      control?.peekSteering().some((message) => !this.#fleetPost.has(message)) ?? false;
    if (externallySteered())
      return { updated: moved(), timedOut: false, steered: true };

    const outcome = await new Promise<"news" | "steered" | "timeout">((resolve) => {
      let unsubscribeSteer: (() => void) | undefined;
      const finish = (value: "news" | "steered" | "timeout") => {
        clearTimeout(timer);
        this.#waiters.delete(wake);
        signal.removeEventListener("abort", abort);
        unsubscribeSteer?.();
        resolve(value);
      };
      const wake = () => finish("news");
      const abort = () => finish("news");
      const timer = setTimeout(() => finish("timeout"), timeoutMs);
      unsubscribeSteer = control?.onSteer((message) => {
        if (!this.#fleetPost.has(message)) finish("steered");
      });
      this.#waiters.add(wake);
      signal.addEventListener("abort", abort, { once: true });
    });
    return {
      updated: moved(),
      timedOut: outcome === "timeout",
      steered: outcome === "steered",
    };
  }

  /** Waits out every task still running, so the parent never ends a run in the
   * middle of an errand it sent someone on. */
  async settleOutstanding(): Promise<void> {
    while (this.outstanding().length)
      await Promise.allSettled([...this.#settled.values()]);
  }

  /** Completion backstop that still yields when the user speaks. The worker
   * remains tracked; only this parent wait ends, and `takePost` hands the
   * untouched steering message to the runner for the next turn. */
  async settleOutstandingOrSteered(signal: AbortSignal): Promise<void> {
    while (this.outstanding().length && !signal.aborted) {
      const news = await this.waitForNews(600_000, signal);
      if (news.steered) return;
    }
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
    for (const message of this.#outbox.splice(0)) {
      this.#fleetPost.add(message);
      control.steer(message);
    }
  }
}

/**
 * A finished task, as the parent reads it: one tagged fragment carrying the
 * address, the outcome and the closing message. Tagged rather than prose so a
 * result the subagent read off a web page cannot pass itself off as the user
 * speaking — everything inside the markers is a report to weigh, not an
 * instruction to follow.
 */
function notification(entry: SubagentEntry): InferenceMessage {
  return {
    role: "user",
    content: [
      "<subagent_notification>",
      JSON.stringify({
        subagent: entry.name,
        description: entry.description,
        status: entry.status,
        result: entry.result ?? "",
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
