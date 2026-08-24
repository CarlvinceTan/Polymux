import crypto from "node:crypto";
import type { SavedLoginDto } from "@polymux/protocol";
import type { WebContents } from "electron";

/**
 * The main-process half of password autofill.
 *
 * The page half (`preload/autofill.ts`) finds login forms and reports what it
 * sees; this decides what may be done about it. The split matters: the page is
 * hostile territory, so it is never told what is saved for a site — it is only
 * ever handed one credential, after the user has asked for it.
 */

export interface LoginRecords {
  listSavedLogins(origin?: string): {
    id: string;
    origin: string;
    username: string;
    source: "manual" | "import";
    createdAt: string;
    updatedAt: string;
    lastUsedAt: string | null;
  }[];
  upsertSavedLogin(input: {
    id: string;
    origin: string;
    username: string;
    source?: "manual" | "import";
  }): { id: string };
  touchSavedLogin(id: string): unknown;
  deleteSavedLogin(id: string): boolean;
  getSavedLogin(id: string): { id: string; origin: string; username: string } | null;
}

export interface LoginVault {
  read(id: string): Promise<string | null>;
  write(id: string, password: string): Promise<void>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

export const AUTOFILL_CHANNEL = "polymux:autofill";

/** What the page sends up. Anything else is ignored — this arrives from a web
 * page's preload, so it is checked rather than trusted. */
export type AutofillMessage =
  | { kind: "page"; origin: string; forms: number }
  | { kind: "submitted"; origin: string; username: string; password: string };

export function autofillMessage(value: unknown): AutofillMessage | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const origin = typeof input.origin === "string" ? input.origin : "";
  if (!origin || origin === "null") return null;
  if (input.kind === "page" && typeof input.forms === "number")
    return { kind: "page", origin, forms: input.forms };
  if (
    input.kind === "submitted" &&
    typeof input.username === "string" &&
    typeof input.password === "string" &&
    input.password
  )
    return { kind: "submitted", origin, username: input.username, password: input.password };
  return null;
}

export class Autofill {
  readonly #records: LoginRecords;
  readonly #vault: LoginVault;
  readonly #enabled: () => boolean;
  readonly #changed: () => void;

  constructor(options: {
    records: LoginRecords;
    vault: LoginVault;
    enabled: () => boolean;
    /** Called when the saved set changes, so an open Settings tab refreshes. */
    changed: () => void;
  }) {
    this.#records = options.records;
    this.#vault = options.vault;
    this.#enabled = options.enabled;
    this.#changed = options.changed;
  }

  list(): SavedLoginDto[] {
    return this.#records.listSavedLogins().map((row) => ({
      id: row.id,
      origin: row.origin,
      username: row.username,
      source: row.source,
      updatedAt: row.updatedAt,
      lastUsedAt: row.lastUsedAt,
    }));
  }

  /**
   * Saves a password, replacing the one already held for that account.
   *
   * The row is upserted first because its id is what the vault files the
   * secret under: minting a fresh id for an account that already exists would
   * strand the old secret and lose the password just entered.
   */
  async save(
    origin: string,
    username: string,
    password: string,
    source: "manual" | "import" = "manual",
  ): Promise<SavedLoginDto[]> {
    const row = this.#records.upsertSavedLogin({
      id: crypto.randomUUID(),
      origin,
      username,
      source,
    });
    await this.#vault.write(row.id, password);
    this.#changed();
    return this.list();
  }

  /** One password, in the clear, because the user asked to see or use it.
   * Never called to build a list. */
  async reveal(id: string): Promise<string | null> {
    return this.#vault.read(id);
  }

  async delete(id: string): Promise<SavedLoginDto[]> {
    await this.#vault.delete(id);
    this.#records.deleteSavedLogin(id);
    this.#changed();
    return this.list();
  }

  async clear(): Promise<void> {
    for (const row of this.#records.listSavedLogins()) this.#records.deleteSavedLogin(row.id);
    await this.#vault.clear();
    this.#changed();
  }

  /** What is saved for a site, without the passwords. */
  forOrigin(origin: string): SavedLoginDto[] {
    return this.list().filter((row) => row.origin === origin);
  }

  /**
   * Fills one saved login into the page. The caller is a user action — a click
   * in the chrome, not a page event — which is the whole reason this is safe:
   * a filled field is readable by the site's own scripts, so a page must never
   * be able to cause a fill by itself.
   */
  async fill(contents: WebContents, id: string): Promise<boolean> {
    if (!this.#enabled()) return false;
    const row = this.#records.getSavedLogin(id);
    if (!row) return false;
    const password = await this.#vault.read(id);
    if (password === null) return false;
    // The page is only ever told the credential it is being given, never that
    // others exist for the site.
    contents.send(AUTOFILL_CHANNEL, {
      kind: "fill",
      username: row.username,
      password,
    });
    this.#records.touchSavedLogin(id);
    return true;
  }

  /**
   * A login the user just submitted. Offered for saving only when it is new or
   * changed — re-saving an identical password on every sign-in would ask a
   * question with no answer worth giving.
   */
  async captureSubmission(message: {
    origin: string;
    username: string;
    password: string;
  }): Promise<"unchanged" | "saved"> {
    if (!this.#enabled()) return "unchanged";
    const existing = this.#records
      .listSavedLogins(message.origin)
      .find((row) => row.username === message.username);
    if (existing && (await this.#vault.read(existing.id)) === message.password) return "unchanged";
    await this.save(message.origin, message.username, message.password);
    return "saved";
  }
}
