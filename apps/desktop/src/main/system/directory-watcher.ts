import { existsSync, mkdirSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { DebouncedCallback } from "./debounced-callback.js";

export interface DirectoryWatcherOptions {
  debounceMs?: number;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancelSchedule?: (timer: ReturnType<typeof setTimeout>) => void;
}

/**
 * Watches a whole tree, not one file. `FileReloadWatcher` exists for a config
 * file replaced atomically beside itself; a skill is a *directory* holding a
 * SKILL.md, so the change that matters arrives as a new subdirectory and a
 * filename filter would drop exactly the event worth having.
 *
 * A burst — a skill written as several files — is one callback.
 */
export class DirectoryWatcher {
  readonly #directory: string;
  readonly #onChange: DebouncedCallback;
  #watcher?: FSWatcher;

  constructor(directory: string, onChange: () => void, options: DirectoryWatcherOptions = {}) {
    this.#directory = path.resolve(directory);
    this.#onChange = new DebouncedCallback(onChange, {
      delayMs: options.debounceMs ?? 500,
      schedule: options.schedule,
      cancelSchedule: options.cancelSchedule,
    });
  }

  start(): void {
    if (this.#watcher) return;
    // Watching cannot begin on a directory that is not there yet, and this one
    // legitimately may not be until the first skill is saved.
    if (!existsSync(this.#directory)) {
      try {
        mkdirSync(this.#directory, { recursive: true });
      } catch {
        return;
      }
    }
    try {
      this.#watcher = watch(this.#directory, { recursive: true }, () => this.#onChange.trigger());
    } catch {
      // A platform without recursive watch loses live refresh, nothing more:
      // the tab still lists correctly whenever it asks.
    }
  }

  stop(): void {
    this.#onChange.cancel();
    this.#watcher?.close();
    this.#watcher = undefined;
  }
}
