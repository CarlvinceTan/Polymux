import crypto from "node:crypto";
import type {
  BrowserPermissionDto,
  BrowserPermissionPromptDto,
  PermissionDecisionDto,
  SitePermissionDto,
} from "@polymux/protocol";
import type { Session, WebContents } from "electron";

/**
 * What the embedded browser lets a site ask for, and what it remembers of the
 * answer.
 *
 * Both of Electron's handlers hang off one session, which is also the app
 * window's own session. So every decision starts by asking who is requesting:
 * the app window keeps the narrow grant it has always had, a browser tab is
 * negotiated on the user's behalf, and anything else is refused. Without that
 * split the window's rule ("only my own webContents") denied every page in
 * every tab, silently and with no way to grant.
 */

/** Electron names more capabilities than are worth surfacing. Anything absent
 * from this map is denied outright rather than given a prompt nobody designed
 * an answer for. */
const SUPPORTED: Record<string, BrowserPermissionDto> = {
  geolocation: "geolocation",
  media: "media",
  notifications: "notifications",
  "clipboard-read": "clipboard-read",
  pointerLock: "pointerLock",
  fullscreen: "fullscreen",
  openExternal: "openExternal",
};

/** Where a permission stands before the user has said anything about it.
 * Fullscreen and pointer lock follow a click the user just made and are undone
 * by pressing Escape, so prompting for them is noise; the rest are worth a
 * question. */
const DEFAULTS: Record<BrowserPermissionDto, PermissionDecisionDto> = {
  geolocation: "ask",
  media: "ask",
  notifications: "ask",
  "clipboard-read": "ask",
  openExternal: "ask",
  pointerLock: "allow",
  fullscreen: "allow",
};

export interface PermissionRecords {
  setSitePermission(
    origin: string,
    permission: string,
    decision: PermissionDecisionDto,
  ): { updatedAt: string };
  getSitePermission(
    origin: string,
    permission: string,
  ): { decision: PermissionDecisionDto } | null;
  listSitePermissions(
    origin?: string,
  ): { origin: string; permission: string; decision: PermissionDecisionDto; updatedAt: string }[];
  clearSitePermissions(origin?: string): number;
}

interface Pending {
  prompt: BrowserPermissionPromptDto;
  settle: (granted: boolean) => void;
}

/** The origin a permission is filed under. Ports and schemes are part of it —
 * a grant to `http://` is not a grant to `https://` — but paths are not. */
export function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const origin = new URL(url).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

export class SitePermissions {
  readonly #records: PermissionRecords;
  readonly #tabIdFor: (contents: WebContents | null) => string | null;
  readonly #prompt: (prompt: BrowserPermissionPromptDto) => void;
  readonly #pending = new Map<string, Pending>();
  #appContents: WebContents | null = null;

  constructor(options: {
    records: PermissionRecords;
    /** The tab a webContents belongs to, or null when it is not a browser tab. */
    tabIdFor: (contents: WebContents | null) => string | null;
    prompt: (prompt: BrowserPermissionPromptDto) => void;
  }) {
    this.#records = options.records;
    this.#tabIdFor = options.tabIdFor;
    this.#prompt = options.prompt;
  }

  /**
   * Takes over the session's two permission handlers. `appContents` is the app
   * window's own webContents, which keeps the grant it has always had:
   * geolocation for the location setting, and audio-only media for dictation.
   */
  install(session: Session, appContents: WebContents): void {
    this.#appContents = appContents;
    session.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
      if (contents && contents === this.#appContents)
        return permission === "geolocation" ||
          (permission === "media" && details.mediaType === "audio");
      if (!this.#tabIdFor(contents)) return false;
      const supported = SUPPORTED[permission];
      if (!supported) return false;
      // Synchronous: this asks whether a page already holds a permission, so
      // an unanswered one is "no" rather than a prompt.
      const origin = requestingOrigin || originOf(details.requestingUrl);
      return origin ? this.decision(origin, supported) === "allow" : false;
    });
    session.setPermissionRequestHandler((contents, permission, callback, details) => {
      if (contents === this.#appContents) {
        const mediaTypes = "mediaTypes" in details ? details.mediaTypes : undefined;
        const audioOnly =
          permission === "media" && mediaTypes?.length === 1 && mediaTypes[0] === "audio";
        callback(permission === "geolocation" || audioOnly);
        return;
      }
      const tabId = this.#tabIdFor(contents);
      const supported = SUPPORTED[permission];
      const origin = originOf(details.requestingUrl);
      if (!tabId || !supported || !origin) {
        callback(false);
        return;
      }
      const decision = this.decision(origin, supported);
      if (decision !== "ask") {
        callback(decision === "allow");
        return;
      }
      this.#ask(tabId, origin, supported, callback, contents);
    });
  }

  /** What is stored for a site, falling back to the permission's own default. */
  decision(origin: string, permission: BrowserPermissionDto): PermissionDecisionDto {
    return (
      this.#records.getSitePermission(origin, permission)?.decision ?? DEFAULTS[permission]
    );
  }

  /** Stored rows whose permission this build still understands. One dropped
   * from `DEFAULTS` in a later version stays in the database but is not shown,
   * rather than appearing as a row the UI cannot label. */
  list(): SitePermissionDto[] {
    const rows: SitePermissionDto[] = [];
    for (const row of this.#records.listSitePermissions()) {
      const permission = SUPPORTED[row.permission];
      if (permission)
        rows.push({
          origin: row.origin,
          permission,
          decision: row.decision,
          updatedAt: row.updatedAt,
        });
    }
    return rows;
  }

  set(
    origin: string,
    permission: BrowserPermissionDto,
    decision: PermissionDecisionDto,
  ): SitePermissionDto[] {
    this.#records.setSitePermission(origin, permission, decision);
    return this.list();
  }

  clear(origin?: string): SitePermissionDto[] {
    this.#records.clearSitePermissions(origin);
    return this.list();
  }

  /**
   * Settles a prompt the renderer put to the user. An id that is no longer
   * pending is ignored rather than treated as an error: the page may have
   * navigated away while the prompt was up.
   */
  respond(id: string, decision: "allow" | "deny", remember: boolean): void {
    const waiting = this.#pending.get(id);
    if (!waiting) return;
    this.#pending.delete(id);
    if (remember)
      this.#records.setSitePermission(
        waiting.prompt.origin,
        waiting.prompt.permission,
        decision,
      );
    waiting.settle(decision === "allow");
  }

  /** Denies everything still outstanding for a tab. Called as a tab navigates
   * or closes, so a prompt for a page that is gone cannot sit there holding a
   * callback the page will never receive. */
  dismissTab(tabId: string): void {
    for (const [id, waiting] of [...this.#pending])
      if (waiting.prompt.tabId === tabId) {
        this.#pending.delete(id);
        waiting.settle(false);
      }
  }

  #ask(
    tabId: string,
    origin: string,
    permission: BrowserPermissionDto,
    callback: (granted: boolean) => void,
    contents: WebContents,
  ): void {
    // The page can die between the question and the answer, and calling back
    // into destroyed contents throws.
    const guarded = (granted: boolean) => {
      if (!contents.isDestroyed()) callback(granted);
    };
    // One question per site and capability at a time. A page that asks twice
    // before the user answers rides on the first prompt rather than stacking a
    // second one behind it.
    for (const waiting of this.#pending.values())
      if (waiting.prompt.origin === origin && waiting.prompt.permission === permission) {
        const first = waiting.settle;
        waiting.settle = (granted) => {
          first(granted);
          guarded(granted);
        };
        return;
      }
    const prompt: BrowserPermissionPromptDto = {
      id: crypto.randomUUID(),
      tabId,
      origin,
      permission,
    };
    let settled = false;
    this.#pending.set(prompt.id, {
      prompt,
      settle: (granted) => {
        if (settled) return;
        settled = true;
        guarded(granted);
      },
    });
    this.#prompt(prompt);
  }
}
