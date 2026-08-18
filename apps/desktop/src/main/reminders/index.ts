import { permissionUsagePlist } from "../system/permission-usage.js";

/** What the helper reports when macOS has not granted Reminders. Matched
 * rather than shown: it is a signal to ask, not a sentence for anyone. */
const NOT_AUTHORIZED = "not-authorized";

import { SwiftHelper } from "../system/swift-helper.js";

/** What a reminder looks like to the agent and to anything reading one back. */
export interface Reminder {
  id: string;
  title: string;
  list: string;
  list_id: string;
  completed: boolean;
  priority: number;
  notes?: string;
  due?: string;
  completed_at?: string;
}

export interface ReminderList {
  id: string;
  name: string;
  default: boolean;
}

/**
 * Whether Reminders may be used right now, asked at the moment of use.
 *
 * This is the whole reason Reminders is a tool rather than a command line. The
 * host owns the two things that decide the answer — the switches the user set,
 * and whether macOS has been asked yet — and it can raise the prompt and wait
 * for it here, because *this* is the point where the capability is genuinely
 * needed. A shelled-out CLI has no such point: the only thing to inspect is
 * the text of a command.
 */
export interface RemindersAccess {
  /** Null when Reminders may be used, and why not when it may not. */
  ensure(): Promise<string | null>;
}

export interface RemindersOptions {
  /** Path to native/reminders.swift (bundled with the app). */
  sourcePath: string;
  /** Writable directory for the compiled helper, e.g. `<userData>/bin`. */
  cacheDirectory: string;
  access: RemindersAccess;
}

export interface ReminderQuery {
  list?: string;
  completed?: boolean;
  limit?: number;
}

export interface ReminderDraft {
  title: string;
  notes?: string;
  /** ISO 8601. A date alone is due that day; one carrying a time also alarms. */
  due?: string;
  list?: string;
  priority?: number;
}

/** The user's reminders, through EventKit. */
export class Reminders {
  readonly #helper: SwiftHelper;
  readonly #access: RemindersAccess;

  constructor(options: RemindersOptions) {
    this.#access = options.access;
    this.#helper = new SwiftHelper({
      name: "reminders",
      sourcePath: options.sourcePath,
      cacheDirectory: options.cacheDirectory,
      // The helper touches EventKit, so it carries the same usage description
      // the app does. Without one macOS terminates it rather than refusing it.
      infoPlist: permissionUsagePlist(),
      missingCompilerMessage:
        "Reminders needs the Swift compiler. Install the Xcode Command Line Tools: xcode-select --install",
      missingSourceMessage: (path) => `Reminders helper source is missing at ${path}`,
    });
  }

  lists(): Promise<ReminderList[]> {
    return this.#run<ReminderList[]>("lists", {});
  }

  list(query: ReminderQuery = {}): Promise<Reminder[]> {
    return this.#run<Reminder[]>("list", {
      list: query.list,
      completed: query.completed ?? false,
      limit: query.limit ?? 50,
    });
  }

  create(draft: ReminderDraft): Promise<Reminder> {
    return this.#run<Reminder>("create", {...draft});
  }

  complete(id: string): Promise<Reminder> {
    return this.#run<Reminder>("complete", {id});
  }

  remove(id: string): Promise<{ id: string; deleted: boolean }> {
    return this.#run<{ id: string; deleted: boolean }>("delete", {id});
  }

  /**
   * One call, with the grant settled first and once more if it turns out to
   * have gone since. The retry is not paranoia: the check and the use are two
   * moments, and the interesting case — a grant that was never decided — is
   * settled by a dialog in between.
   */
  async #run<T>(action: string, payload: Record<string, unknown>): Promise<T> {
    const refused = await this.#access.ensure();
    if (refused) throw new Error(refused);
    const first = await this.#invoke<T>(action, payload);
    if (!first.error) return first.result as T;
    if (first.error !== NOT_AUTHORIZED) throw new Error(first.error);
    const refusedAgain = await this.#access.ensure();
    if (refusedAgain) throw new Error(refusedAgain);
    const second = await this.#invoke<T>(action, payload);
    if (!second.error) return second.result as T;
    throw new Error(
      second.error === NOT_AUTHORIZED
        ? "FlareAI has not been given access to Reminders. Allow it in System Settings → Privacy & Security → Reminders."
        : second.error,
    );
  }

  async #invoke<T>(
    action: string,
    payload: Record<string, unknown>,
  ): Promise<{result?: T; error?: string}> {
    const stripped = Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined),
    );
    const line = await this.#helper.run([action, JSON.stringify(stripped)], 30_000);
    const parsed = JSON.parse(line) as {ok?: boolean; result?: T; error?: string};
    if (parsed.ok) return {result: parsed.result};
    return {error: parsed.error ?? "Reminders reported no reason"};
  }
}
