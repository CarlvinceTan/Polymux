import { existsSync, mkdirSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { DebouncedCallback } from "./debounced-callback.js";

export interface FileReloadWatcherOptions {
  debounceMs?: number;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancelSchedule?: (timer: ReturnType<typeof setTimeout>) => void;
}

/** Watches the containing directory so atomic file replacements are observed. */
export class FileReloadWatcher {
  readonly #filePath: string;
  readonly #onChange: DebouncedCallback;
  #watcher?: FSWatcher;

  constructor(
    filePath: string,
    onChange: () => void,
    options: FileReloadWatcherOptions = {},
  ) {
    this.#filePath = path.resolve(filePath);
    this.#onChange = new DebouncedCallback(onChange, {
      delayMs: options.debounceMs ?? 250,
      schedule: options.schedule,
      cancelSchedule: options.cancelSchedule,
    });
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
        this.#onChange.trigger();
      });
    } catch {
      // Losing live reload is a degradation, not a failure: the file is still
      // read whenever it is next asked for.
    }
  }

  stop(): void {
    this.#watcher?.close();
    this.#watcher = undefined;
    this.#onChange.cancel();
  }
}
