import type {
  ChronicleEntry,
  ChronicleFrame,
  ChronicleFrameSource,
  ChroniclePromptContext,
  ChronicleSettings,
  ChronicleStatus,
  ChronicleSystemStateSource,
  InteractionEvent,
  InteractionEventSource,
} from "./types.js";
import { ChronicleStore } from "./store.js";

export interface ChronicleManagerOptions {
  directory: string;
  frames: ChronicleFrameSource;
  system: ChronicleSystemStateSource;
  /** Optional; without one the interaction stream simply stays empty. */
  interactions?: InteractionEventSource;
  clock?: () => Date;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancelSchedule?: (timer: ReturnType<typeof setTimeout>) => void;
}

type PreviousFrame = { signature: Uint8Array; savedAt: number };

export class ChronicleManager {
  readonly store: ChronicleStore;
  readonly #frames: ChronicleFrameSource;
  readonly #system: ChronicleSystemStateSource;
  readonly #interactions?: InteractionEventSource;
  /** Events are buffered and flushed together rather than written per click. */
  #pendingEvents: InteractionEvent[] = [];
  #flushTimer?: ReturnType<typeof setTimeout>;
  #interactionsRunning = false;
  readonly #clock: () => Date;
  readonly #schedule: NonNullable<ChronicleManagerOptions["schedule"]>;
  readonly #cancelSchedule: NonNullable<ChronicleManagerOptions["cancelSchedule"]>;
  readonly #previous = new Map<string, PreviousFrame>();
  #timer?: ReturnType<typeof setTimeout>;
  #running = false;
  #capturing = false;
  #unchangedSamples = 0;
  #lastError: string | null = null;
  #lastPrunedAt = 0;

  constructor(options: ChronicleManagerOptions) {
    this.store = new ChronicleStore(options.directory);
    this.#frames = options.frames;
    this.#system = options.system;
    this.#interactions = options.interactions;
    this.#clock = options.clock ?? (() => new Date());
    this.#schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
    this.#cancelSchedule = options.cancelSchedule ?? clearTimeout;
  }

  settings(): ChronicleSettings {
    return this.store.readSettings();
  }

  status(): ChronicleStatus {
    return this.store.status(this.settings(), this.#running, this.#lastError);
  }

  promptContext(): ChroniclePromptContext {
    return {
      directory: this.store.directory,
      instructionsPath: this.store.instructionsPath,
      enabled: this.settings().enabled,
    };
  }

  start(): void {
    if (this.#running || !this.settings().enabled) return;
    this.#running = true;
    this.#queue(0);
    this.#startInteractions();
  }

  stop(): void {
    this.#running = false;
    if (this.#timer) this.#cancelSchedule(this.#timer);
    this.#timer = undefined;
    this.#stopInteractions();
    this.flushEvents();
  }

  /**
   * Capture policy, applied to one source's identity. The frame source cannot
   * decide this itself: the same window is in or out depending on settings the
   * user changes while the loop runs.
   */
  allows(source: {
    app?: string;
    bundleId?: string;
    url?: string;
    privateBrowsing?: boolean;
  }): boolean {
    const settings = this.settings();
    if (source.privateBrowsing && !settings.recordPrivateBrowsing) return false;
    if (settings.capturePolicy === "all") return true;
    const listed = matchesList(source, settings);
    return settings.capturePolicy === "only" ? listed : !listed;
  }

  /** Records one interaction event, subject to the same policy as a frame. */
  record(event: InteractionEvent): void {
    const settings = this.settings();
    if (!settings.enabled || !settings.interactionEvents) return;
    if (!this.allows(event)) return;
    this.#pendingEvents.push(event);
    // A burst of clicks is one write rather than one per click, and the delay
    // is bounded so a quiet stream still lands within a couple of seconds.
    if (this.#pendingEvents.length >= 64) this.flushEvents();
    else if (!this.#flushTimer)
      this.#flushTimer = this.#schedule(() => {
        this.#flushTimer = undefined;
        this.flushEvents();
      }, 2_000);
  }

  flushEvents(): void {
    if (this.#flushTimer) {
      this.#cancelSchedule(this.#flushTimer);
      this.#flushTimer = undefined;
    }
    if (!this.#pendingEvents.length) return;
    const batch = this.#pendingEvents;
    this.#pendingEvents = [];
    try {
      this.store.saveEvents(batch);
    } catch (error) {
      this.#lastError = error instanceof Error ? error.message : String(error);
    }
  }

  #startInteractions(): void {
    if (!this.#interactions || this.#interactionsRunning) return;
    if (!this.settings().interactionEvents) return;
    this.#interactionsRunning = true;
    void this.#interactions.start((event) => this.record(event)).catch((error: unknown) => {
      this.#interactionsRunning = false;
      this.#lastError = error instanceof Error ? error.message : String(error);
    });
  }

  #stopInteractions(): void {
    if (!this.#interactionsRunning) return;
    this.#interactionsRunning = false;
    this.#interactions?.stop();
  }

  setEnabled(enabled: boolean): ChronicleStatus {
    this.store.writeSettings({ ...this.settings(), enabled });
    if (enabled) this.start();
    else this.stop();
    return this.status();
  }

  /**
   * Applies a settings patch and brings the interaction stream into line with
   * it, so switching events off stops the helper rather than only stopping the
   * writes.
   */
  update(patch: Partial<ChronicleSettings>): ChronicleStatus {
    this.store.writeSettings({ ...this.settings(), ...patch });
    const settings = this.settings();
    if (this.#running && settings.interactionEvents) this.#startInteractions();
    if (!settings.interactionEvents) {
      this.#stopInteractions();
      this.flushEvents();
    }
    return this.status();
  }

  forget(since: Date, until: Date): ChronicleStatus {
    // Buffered events from inside the window would otherwise land after it.
    this.flushEvents();
    this.store.forget(since, until);
    // A capture the user has deleted must not come back as a heartbeat
    // duplicate, so the change baseline goes with it.
    this.#previous.clear();
    return this.status();
  }

  async captureOnce(): Promise<ChronicleEntry[]> {
    if (this.#capturing) return [];
    this.#capturing = true;
    try {
      const settings = this.settings();
      const state = this.#system.current();
      if (
        state.locked ||
        state.idleSeconds >= settings.idleAfterSeconds ||
        state.thermalState === "serious" ||
        state.thermalState === "critical"
      )
        return [];
      const now = this.#clock();
      const frames = (await this.#frames.capture()).filter((frame) => this.allows(frame));
      const saved = frames.flatMap((frame) => {
        const previous = this.#previous.get(frame.sourceId);
        const change = previous ? signatureDifference(previous.signature, frame.signature) : 1;
        const heartbeat = previous
          ? now.getTime() - previous.savedAt >= settings.heartbeatMs
          : false;
        const reason: ChronicleEntry["reason"] | null = !previous
          ? "initial"
          : change >= settings.minimumChange
            ? "change"
            : heartbeat
              ? "heartbeat"
              : null;
        this.#previous.set(frame.sourceId, {
          signature: frame.signature.slice(),
          savedAt: reason ? now.getTime() : previous?.savedAt ?? now.getTime(),
        });
        return reason ? [this.store.save(frame, now, change, reason)] : [];
      });
      this.#unchangedSamples = saved.length ? 0 : this.#unchangedSamples + 1;
      this.#lastError = null;
      if (now.getTime() - this.#lastPrunedAt >= 60_000) {
        this.store.prune(now, settings);
        this.#lastPrunedAt = now.getTime();
      }
      return saved;
    } catch (error) {
      this.#lastError = error instanceof Error ? error.message : String(error);
      return [];
    } finally {
      this.#capturing = false;
    }
  }

  #queue(delay: number): void {
    if (!this.#running) return;
    this.#timer = this.#schedule(() => {
      void this.captureOnce().finally(() => this.#queue(this.#nextInterval()));
    }, delay);
  }

  #nextInterval(): number {
    const settings = this.settings();
    const state = this.#system.current();
    const quiet = this.#unchangedSamples >= 3 || state.onBattery || state.thermalState === "fair";
    return quiet ? settings.quietIntervalMs : settings.activeIntervalMs;
  }
}

export function signatureDifference(left: Uint8Array, right: Uint8Array): number {
  if (!left.length || left.length !== right.length) return 1;
  let difference = 0;
  for (let index = 0; index < left.length; index++)
    difference += Math.abs(left[index]! - right[index]!);
  return difference / (left.length * 255);
}

/**
 * Fixed-length signature for a text snapshot, comparable with
 * `signatureDifference` just like a downscaled frame. Character trigrams are
 * hashed into a bucket histogram: a small edit shifts a handful of buckets,
 * while a different document lands on largely different trigrams and moves
 * the signature past the change threshold.
 */
export function textSignature(text: string): Uint8Array {
  const buckets = new Float64Array(256);
  const normalized = text.toLowerCase();
  for (let index = 0; index + 2 < normalized.length; index += 1) {
    const hash =
      normalized.charCodeAt(index) * 961 +
      normalized.charCodeAt(index + 1) * 31 +
      normalized.charCodeAt(index + 2);
    buckets[hash % 256] += 1;
  }
  const peak = Math.max(1, ...buckets);
  const signature = new Uint8Array(256);
  for (let index = 0; index < 256; index += 1)
    signature[index] = Math.round((buckets[index]! / peak) * 255);
  return signature;
}

export function frameSignature(bitmap: Uint8Array): Uint8Array {
  const signature = new Uint8Array(Math.floor(bitmap.length / 4));
  for (let source = 0, target = 0; source + 3 < bitmap.length; source += 4, target++) {
    const blue = bitmap[source]!;
    const green = bitmap[source + 1]!;
    const red = bitmap[source + 2]!;
    signature[target] = Math.round(red * 0.299 + green * 0.587 + blue * 0.114);
  }
  return signature;
}

/**
 * A source matches the list when its bundle id or app name matches an entry,
 * or when its URL's host is an entry or a subdomain of one. One list covers
 * both apps and sites because the same window can be either: a browser is an
 * app the user may want blocked wholesale, and a site inside it is not.
 */
function matchesList(
  source: { app?: string; bundleId?: string; url?: string },
  settings: ChronicleSettings,
): boolean {
  const apps = settings.apps.map((item) => item.toLowerCase());
  const identity = [source.bundleId, source.app]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());
  if (identity.some((value) => apps.includes(value))) return true;
  const host = hostOf(source.url);
  if (!host) return false;
  return settings.sites.some((site) => {
    const candidate = site.toLowerCase().replace(/^\.+|\.+$/g, "");
    return candidate === host || host.endsWith(`.${candidate}`);
  });
}

export function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}
