import type {
  ChronicleEntry,
  ChronicleFrameSource,
  ChroniclePromptContext,
  ChronicleSettings,
  ChronicleStatus,
  ChronicleSystemStateSource,
} from "./types.js";
import { ChronicleStore } from "./store.js";

export interface ChronicleManagerOptions {
  directory: string;
  frames: ChronicleFrameSource;
  system: ChronicleSystemStateSource;
  clock?: () => Date;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancelSchedule?: (timer: ReturnType<typeof setTimeout>) => void;
}

type PreviousFrame = { signature: Uint8Array; savedAt: number };

export class ChronicleManager {
  readonly store: ChronicleStore;
  readonly #frames: ChronicleFrameSource;
  readonly #system: ChronicleSystemStateSource;
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
  }

  stop(): void {
    this.#running = false;
    if (this.#timer) this.#cancelSchedule(this.#timer);
    this.#timer = undefined;
  }

  setEnabled(enabled: boolean): ChronicleStatus {
    this.store.writeSettings({ ...this.settings(), enabled });
    if (enabled) this.start();
    else this.stop();
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
      const frames = await this.#frames.capture();
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
