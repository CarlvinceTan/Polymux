import type {NotificationKind} from "@flareai/protocol";

/** What the user is told, once the switches have agreed it is worth telling. */
export interface NotificationRequest {
  kind: NotificationKind;
  title: string;
  body: string;
  /** Posted even when the window is focused. Reserved for the test
   * notification, whose whole job is to appear on demand. */
  force?: boolean;
}

/** The half of the decision the switches make. */
export interface NotificationPreferences {
  enabled: boolean;
  kinds: Record<NotificationKind, boolean>;
}

export interface NotifierOptions {
  preferences: () => NotificationPreferences;
  /** Hands the notification to the OS. Injected so the gating below can be
   * tested without Electron, which is also why this module imports none. */
  present: (request: NotificationRequest) => void;
  /** False on a machine or build where the OS will not show one at all. */
  supported?: () => boolean;
  /** True while the app window is in front. */
  focused?: () => boolean;
}

/** Why a notification was not posted, for the caller that wants to say so. */
export type NotificationOutcome =
  | "posted"
  | "unsupported"
  | "disabled"
  | "kind-disabled"
  | "focused";

/**
 * Decides whether an event earns a system notification, and posts it.
 *
 * A notification is an interruption, so it is suppressed while the user is
 * already looking at the window: a run that finishes under their eyes has
 * nothing to announce. The test notification passes `force` past that, since
 * it is sent from Settings and would otherwise never be seen by the person
 * who asked for it.
 */
export class Notifier {
  readonly #options: NotifierOptions;

  constructor(options: NotifierOptions) {
    this.#options = options;
  }

  notify(request: NotificationRequest): NotificationOutcome {
    if (this.#options.supported && !this.#options.supported()) return "unsupported";
    const preferences = this.#options.preferences();
    if (!preferences.enabled) return "disabled";
    if (!preferences.kinds[request.kind]) return "kind-disabled";
    if (!request.force && this.#options.focused?.()) return "focused";
    this.#options.present(request);
    return "posted";
  }
}

/** Trims a body to something a notification bubble will actually show, so a
 * long agent summary is not handed to the OS to cut mid-word. */
export function notificationBody(text: string, limit = 180): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= limit) return collapsed;
  const cut = collapsed.slice(0, limit);
  const boundary = cut.lastIndexOf(" ");
  return `${(boundary > limit * 0.6 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}
