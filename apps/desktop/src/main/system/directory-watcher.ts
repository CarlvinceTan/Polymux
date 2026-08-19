import { existsSync, mkdirSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";

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
  readonly #onChange: () => void;
  readonly #debounceMs: number;
  readonly #schedule: NonNullable<DirectoryWatcherOptions["schedule"]>;
  readonly #cancelSchedule: NonNullable<DirectoryWatcherOptions["cancelSchedule"]>;
  #watcher?: FSWatcher;
  #timer?: ReturnType<typeof setTimeout>;

  constructor(directory: string, onChange: () => void, options: DirectoryWatcherOptions = {}) {
    this.#directory = path.resolve(directory);
    this.#onChange = onChange;
    this.#debounceMs = options.debounceMs ?? 500;
    this.#schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
    this.#cancelSchedule = options.cancelSchedule ?? clearTimeout;
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
      this.#watcher = watch(this.#directory, { recursive: true }, () => this.#debounce());
    } catch {
      // A platform without recursive watch loses live refresh, nothing more:
      // the tab still lists correctly whenever it asks.
    }
  }

  stop(): void {
    if (this.#timer) this.#cancelSchedule(this.#timer);
    this.#timer = undefined;
    this.#watcher?.close();
    this.#watcher = undefined;
  }

  #debounce(): void {
    if (this.#timer) this.#cancelSchedule(this.#timer);
    this.#timer = this.#schedule(() => {
      this.#timer = undefined;
      this.#onChange();
    }, this.#debounceMs);
  }
}
