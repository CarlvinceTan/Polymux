import { watch, type FSWatcher } from "node:fs";
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
    this.#watcher = watch(path.dirname(this.#filePath), (event, changed) => {
      if (changed !== null && changed.toString() !== filename) return;
      if (event !== "change" && event !== "rename") return;
      this.#debounce();
    });
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
