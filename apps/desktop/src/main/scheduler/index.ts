import { randomUUID } from "node:crypto";
import type {
  JsonValue,
  ScheduleDto,
  ScheduleFrequencyDto,
  ScheduleInput,
  SchedulePatch,
  ScheduleRunDto,
} from "@polymux/protocol";
import { localTimeZone, nextRunAfter } from "./time.js";

/** Only what the scheduler needs, so tests can hand it a plain object. */
export interface SchedulePreferences {
  getPreference(key: string): {value: JsonValue} | null;
  setPreference(key: string, value: JsonValue): unknown;
}

/** What a firing actually does. The scheduler owns the clock; the backend owns
 * the agent, and hands back the account the detail panel shows. */
export type ScheduleExecutor = (schedule: ScheduleDto) => Promise<{
  summary?: string;
  conversationId?: string;
  runId?: string;
}>;

export interface SchedulerOptions {
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancelSchedule?: (timer: ReturnType<typeof setTimeout>) => void;
}

const PREFERENCE_KEY = "schedules";
/** Enough history for the detail panel to be useful without growing forever. */
const HISTORY_LIMIT = 20;
/**
 * The timer never sleeps longer than this, however far off the next run is.
 * A laptop that suspends for the night wakes with a timer that was measured
 * against a clock which stopped counting, so the loop re-checks the wall clock
 * regularly instead of trusting one long delay.
 */
const MAX_SLEEP_MS = 30_000;

export class Scheduler {
  readonly #store: SchedulePreferences;
  readonly #execute: ScheduleExecutor;
  readonly #now: () => number;
  readonly #schedule: NonNullable<SchedulerOptions["schedule"]>;
  readonly #cancelSchedule: NonNullable<SchedulerOptions["cancelSchedule"]>;
  readonly #listeners = new Set<(items: ScheduleDto[]) => void>();
  /** Ids currently executing, so a slow run is never started twice. */
  readonly #running = new Set<string>();
  #items: ScheduleDto[] = [];
  #timer?: ReturnType<typeof setTimeout>;
  #started = false;
  #stopped = false;

  constructor(
    store: SchedulePreferences,
    execute: ScheduleExecutor,
    options: SchedulerOptions = {},
  ) {
    this.#store = store;
    this.#execute = execute;
    this.#now = options.now ?? Date.now;
    this.#schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
    this.#cancelSchedule = options.cancelSchedule ?? clearTimeout;
    this.#items = this.#load();
  }

  /**
   * Begins keeping time. Runs due while the app was closed are not replayed —
   * waking to four days of backlogged briefings is noise, not diligence — but
   * a schedule that missed its slot is moved on to the next one so it is not
   * left showing a next run in the past.
   */
  start(): void {
    if (this.#started) return;
    this.#started = true;
    const now = this.#now();
    let changed = false;
    for (const item of this.#items) {
      // A run marked running is one the app died in the middle of: nothing is
      // driving it any more, so it is recorded as failed rather than left to
      // spin forever.
      if (item.status === "running") {
        this.#settle(item, {outcome: "failed", error: "Interrupted when Polymux closed"}, now);
        changed = true;
      }
      const next = this.#computeNext(item, now);
      if (next !== item.nextRunAt) {
        item.nextRunAt = next;
        if (next === undefined && item.status === "active") item.status = "done";
        changed = true;
      }
    }
    if (changed) this.#persist();
    this.#arm();
  }

  stop(): void {
    this.#stopped = true;
    if (this.#timer) this.#cancelSchedule(this.#timer);
    this.#timer = undefined;
  }

  list(): ScheduleDto[] {
    return this.#items.map((item) => ({...item, history: [...item.history]}));
  }

  subscribe(listener: (items: ScheduleDto[]) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  create(input: ScheduleInput): ScheduleDto {
    const now = this.#now();
    const item: ScheduleDto = {
      id: randomUUID(),
      title: input.title.trim() || "Untitled schedule",
      prompt: input.prompt.trim(),
      frequency: withZone(input.frequency),
      status: "active",
      createdAt: now,
      history: [],
      unread: false,
    };
    item.nextRunAt = this.#computeNext(item, now);
    if (item.nextRunAt === undefined) item.status = "done";
    this.#items = [...this.#items, item];
    this.#commit();
    return this.#require(item.id);
  }

  update(id: string, patch: SchedulePatch): ScheduleDto {
    const item = this.#find(id);
    if (patch.title !== undefined) item.title = patch.title.trim() || item.title;
    if (patch.prompt !== undefined) item.prompt = patch.prompt.trim();
    if (patch.frequency !== undefined) item.frequency = withZone(patch.frequency);
    if (patch.status !== undefined) item.status = patch.status;
    // A running schedule keeps its live status: pausing it stops the next
    // firing, not the one already in flight.
    if (this.#running.has(id)) item.status = "running";
    else if (item.status !== "paused") {
      item.nextRunAt = this.#computeNext(item, this.#now());
      item.status = item.nextRunAt === undefined ? "done" : "active";
    }
    if (item.status === "paused") item.nextRunAt = undefined;
    this.#commit();
    return this.#require(id);
  }

  remove(id: string): void {
    this.#items = this.#items.filter((item) => item.id !== id);
    this.#commit();
  }

  markRead(id: string): ScheduleDto {
    const item = this.#find(id);
    item.unread = false;
    this.#commit();
    return this.#require(id);
  }

  /** Fires now without disturbing the cadence — the next run stays where it is. */
  runNow(id: string): ScheduleDto {
    const item = this.#find(id);
    void this.#fire(item);
    return this.#require(id);
  }

  #find(id: string): ScheduleDto {
    const item = this.#items.find((entry) => entry.id === id);
    if (!item) throw new Error(`Schedule not found: ${id}`);
    return item;
  }

  #require(id: string): ScheduleDto {
    const item = this.#find(id);
    return {...item, history: [...item.history]};
  }

  #computeNext(item: ScheduleDto, now: number): number | undefined {
    if (item.status === "paused") return undefined;
    return nextRunAfter(item.frequency, now, item.createdAt);
  }

  /** Re-arms the single timer against whichever schedule is due first. */
  #arm(): void {
    if (this.#stopped) return;
    if (this.#timer) this.#cancelSchedule(this.#timer);
    const now = this.#now();
    const due = this.#items
      .filter((item) => item.status === "active" && item.nextRunAt !== undefined)
      .map((item) => item.nextRunAt!);
    const soonest = due.length ? Math.min(...due) : Infinity;
    const delay = Math.min(MAX_SLEEP_MS, Math.max(0, soonest - now));
    this.#timer = this.#schedule(() => {
      this.#timer = undefined;
      this.#tick();
    }, Number.isFinite(delay) ? delay : MAX_SLEEP_MS);
  }

  #tick(): void {
    const now = this.#now();
    for (const item of this.#items) {
      if (item.status !== "active" || item.nextRunAt === undefined) continue;
      if (item.nextRunAt > now) continue;
      void this.#fire(item);
    }
    this.#arm();
  }

  async #fire(item: ScheduleDto): Promise<void> {
    if (this.#running.has(item.id)) return;
    this.#running.add(item.id);
    const startedAt = this.#now();
    const run: ScheduleRunDto = {id: randomUUID(), startedAt, outcome: "running"};
    item.history = [run, ...item.history].slice(0, HISTORY_LIMIT);
    item.status = "running";
    item.lastRunAt = startedAt;
    // The cadence advances before the run rather than after it: a long run
    // must not push every later firing back by its own duration.
    item.nextRunAt = nextRunAfter(item.frequency, startedAt, item.createdAt);
    this.#commit();

    const snapshot = this.#require(item.id);
    try {
      const result = await this.#execute(snapshot);
      this.#settle(item, {outcome: "succeeded", ...result}, this.#now());
    } catch (error) {
      this.#settle(
        item,
        {outcome: "failed", error: error instanceof Error ? error.message : String(error)},
        this.#now(),
      );
    } finally {
      this.#running.delete(item.id);
      this.#commit();
      this.#arm();
    }
  }

  /** Closes out the newest history entry and settles the row's status. */
  #settle(
    item: ScheduleDto,
    result: Partial<ScheduleRunDto> & {outcome: "succeeded" | "failed"},
    now: number,
  ): void {
    const run = item.history[0];
    if (run && run.outcome === "running") Object.assign(run, result, {finishedAt: now});
    item.unread = true;
    if (result.outcome === "failed") item.status = "failed";
    else item.status = item.nextRunAt === undefined ? "done" : "active";
  }

  /**
   * Saves, then tells whoever is listening. A listener is a courtesy — the
   * renderer redrawing its table — and it is isolated accordingly: `#fire`
   * commits before it runs anything, so a subscriber that throws (sending to a
   * window that closed half a millisecond ago) would otherwise stop the run
   * from ever starting. Closing the window must not stop the clock.
   */
  #commit(): void {
    this.#persist();
    const items = this.list();
    for (const listener of this.#listeners) {
      try {
        listener(items);
      } catch (error) {
        console.warn("[scheduler] a schedule listener threw", error);
      }
    }
  }

  #persist(): void {
    this.#store.setPreference(PREFERENCE_KEY, this.#items as unknown as JsonValue);
  }

  #load(): ScheduleDto[] {
    const value = this.#store.getPreference(PREFERENCE_KEY)?.value;
    if (!Array.isArray(value)) return [];
    // Stored rows come from an older build as readily as this one, so each
    // field is checked rather than trusted.
    return value.flatMap((entry) => {
      const item = readSchedule(entry);
      return item ? [item] : [];
    });
  }
}

function withZone(frequency: ScheduleFrequencyDto): ScheduleFrequencyDto {
  return {...frequency, timeZone: frequency.timeZone || localTimeZone()};
}

const STATUSES = new Set(["active", "paused", "running", "failed", "done"]);
const KINDS = new Set(["once", "hourly", "daily", "weekly", "monthly", "yearly"]);

function readSchedule(value: unknown): ScheduleDto | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const frequency = input.frequency as ScheduleFrequencyDto | undefined;
  if (typeof input.id !== "string" || !frequency || !KINDS.has(frequency.kind)) return null;
  return {
    id: input.id,
    title: typeof input.title === "string" ? input.title : "Untitled schedule",
    prompt: typeof input.prompt === "string" ? input.prompt : "",
    frequency,
    status: STATUSES.has(input.status as string) ? (input.status as ScheduleDto["status"]) : "active",
    createdAt: typeof input.createdAt === "number" ? input.createdAt : Date.now(),
    nextRunAt: typeof input.nextRunAt === "number" ? input.nextRunAt : undefined,
    lastRunAt: typeof input.lastRunAt === "number" ? input.lastRunAt : undefined,
    history: Array.isArray(input.history) ? (input.history as ScheduleRunDto[]).slice(0, HISTORY_LIMIT) : [],
    unread: input.unread === true,
  };
}
