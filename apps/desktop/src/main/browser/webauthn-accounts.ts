import crypto from "node:crypto";
import type { BrowserWebAuthnPromptDto } from "@polymux/protocol";
import type {
  Event,
  SelectWebauthnAccountDetails,
  Session,
  WebFrameMain,
} from "electron";

interface PendingAccountSelection {
  tabId: string;
  credentialIds: Set<string>;
  callback: (credentialId?: string | null) => void;
}

type AccountSelectionListener = (
  event: Event,
  details: SelectWebauthnAccountDetails,
  callback: (credentialId?: string | null) => void,
) => void;

/**
 * Owns Electron's discoverable-passkey account callback.
 *
 * The callback is deliberately kept in the main process. The renderer gets a
 * random prompt id and the exact opaque credential ids it may choose from;
 * anything stale, invented, or from a non-browser webContents cancels rather
 * than selecting an account on a page's behalf.
 */
export class WebAuthnAccounts {
  readonly #tabIdForFrame: (frame: WebFrameMain | null) => string | null;
  readonly #prompt: (prompt: BrowserWebAuthnPromptDto) => void;
  readonly #pending = new Map<string, PendingAccountSelection>();
  #session: Session | null = null;

  readonly #select: AccountSelectionListener = (_event, details, callback) => {
    const tabId = this.#tabIdForFrame(details.frame);
    if (!tabId || !details.accounts.length) {
      callback();
      return;
    }

    // Chromium normally permits only one request per page, but replacing one
    // explicitly keeps an unexpected repeat from stacking two account bars.
    this.dismissTab(tabId);
    const id = crypto.randomUUID();
    const accounts = details.accounts.map((account) => ({
      credentialId: account.credentialId,
      ...(account.displayName ? { displayName: account.displayName } : {}),
      ...(account.name ? { name: account.name } : {}),
    }));
    this.#pending.set(id, {
      tabId,
      credentialIds: new Set(accounts.map((account) => account.credentialId)),
      callback,
    });
    this.#prompt({
      id,
      tabId,
      relyingPartyId: details.relyingPartyId,
      accounts,
    });
  };

  constructor(options: {
    tabIdForFrame: (frame: WebFrameMain | null) => string | null;
    prompt: (prompt: BrowserWebAuthnPromptDto) => void;
  }) {
    this.#tabIdForFrame = options.tabIdForFrame;
    this.#prompt = options.prompt;
  }

  install(session: Session): void {
    if (session === this.#session) return;
    this.close();
    this.#session = session;
    session.on("select-webauthn-account", this.#select);
  }

  respond(id: string, credentialId?: string): void {
    const waiting = this.#pending.get(id);
    if (!waiting) return;
    this.#pending.delete(id);
    waiting.callback(
      credentialId && waiting.credentialIds.has(credentialId)
        ? credentialId
        : undefined,
    );
  }

  /** Navigation, tab closure and renderer teardown all cancel rather than
   * leaving Chromium waiting on a callback that is no longer visible. */
  dismissTab(tabId: string): void {
    for (const [id, waiting] of [...this.#pending]) {
      if (waiting.tabId !== tabId) continue;
      this.#pending.delete(id);
      waiting.callback();
    }
  }

  close(): void {
    for (const waiting of this.#pending.values()) waiting.callback();
    this.#pending.clear();
    this.#session?.off("select-webauthn-account", this.#select);
    this.#session = null;
  }
}
