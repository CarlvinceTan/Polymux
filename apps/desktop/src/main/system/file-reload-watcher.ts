import { existsSync, mkdirSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";

export interface FileReloadWatcherOptions {
  debounceMs?: number;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancelSchedule?: (timer: ReturnType<typeof setTimeout>) => void;
}

/** Watches the containing directory so atomic file replacements are observed. */
export class FileReloadWatcher {
  readonly #filePath: string;
  readonly #onChange: () => void;
  readonly #debounceMs: number;
  readonly #schedule: NonNullable<FileReloadWatcherOptions["schedule"]>;
  readonly #cancelSchedule: NonNullable<FileReloadWatcherOptions["cancelSchedule"]>;
  #watcher?: FSWatcher;
  #timer?: ReturnType<typeof setTimeout>;

  constructor(
    filePath: string,
    onChange: () => void,
    options: FileReloadWatcherOptions = {},
  ) {
    this.#filePath = path.resolve(filePath);
    this.#onChange = onChange;
    this.#debounceMs = options.debounceMs ?? 250;
    this.#schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
    this.#cancelSchedule = options.cancelSchedule ?? clearTimeout;
  }

  start(): void {
    if (this.#watcher) return;
    const filename = path.basename(this.#filePath);
    const directory = path.dirname(this.#filePath);
    // The file is watched through its directory, and on a fresh instance that
    // directory does not exist yet — nothing has written state. `watch` throws
    // ENOENT for it, from inside whatever async start called this, so it
    // surfaced as an unhandled rejection at launch rather than as a missing
    // reload. Created rather than skipped: the file arrives later, and a
    // watcher that gave up here would never see it.
    if (!existsSync(directory)) {
      try {
        mkdirSync(directory, { recursive: true });
      } catch {
        return;
      }
    }
    try {
      this.#watcher = watch(directory, (event, changed) => {
        if (changed !== null && changed.toString() !== filename) return;
        if (event !== "change" && event !== "rename") return;
        this.#debounce();
      });
    } catch {
      // Losing live reload is a degradation, not a failure: the file is still
      // read whenever it is next asked for.
    }
  }

  stop(): void {
    this.#watcher?.close();
    this.#watcher = undefined;
    if (this.#timer) this.#cancelSchedule(this.#timer);
    this.#timer = undefined;
  }

  #debounce(): void {
    if (this.#timer) this.#cancelSchedule(this.#timer);
    this.#timer = this.#schedule(() => {
      this.#timer = undefined;
      this.#onChange();
    }, this.#debounceMs);
  }
}
