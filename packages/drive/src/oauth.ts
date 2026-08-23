import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { DriveProviderId } from "@polymux/protocol";
import { driveProviderLabel } from "@polymux/protocol";
import type {
  DriveConsentPrompt,
  DriveConsentWindow,
  DriveSecretStore,
} from "./types.js";

/**
 * The loopback port every drive provider redirects back to.
 *
 * It is fixed rather than ephemeral because Dropbox and Microsoft match
 * redirect URIs exactly, so the address has to be one that can be written into
 * their app registration ahead of time. Google accepts any loopback port, and
 * is happy with this one too.
 */
export const OAUTH_REDIRECT_PORT = 47665;
export const OAUTH_REDIRECT_URI = `http://127.0.0.1:${OAUTH_REDIRECT_PORT}/drive/callback`;

/**
 * The account id the first connection of a provider carries.
 *
 * Builds before multi-account stored one credential per provider, with no id
 * at all. Naming that account rather than minting a uuid for it is what lets
 * the old credential be found again after the upgrade.
 */
export const LEGACY_ACCOUNT_ID = "default";

/** How long a consent window may sit unanswered before the flow gives up. */
const AUTHORIZE_TIMEOUT_MS = 5 * 60 * 1000;
/** Refresh an access token this long before it actually expires, so a call
 * never races the expiry it just checked. */
const REFRESH_BUFFER_MS = 60_000;

export interface OAuthApp {
  clientId: string;
  /** Absent for public clients using PKCE alone, which is the desktop norm. */
  clientSecret: string | null;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** Provider-specific authorize parameters, e.g. Google's offline access. */
  extraAuthParams?: Record<string, string>;
}

interface StoredTokens {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch milliseconds, or null when the provider issues no expiry. */
  expiresAt: number | null;
  scope: string | null;
}

class OAuthTokenError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = "OAuthTokenError";
  }
}

/**
 * Client credentials for one provider, read from the environment.
 *
 * Nothing is committed: a build without these variables reports the provider as
 * `unconfigured`, which is what puts "not available in this build" in the
 * settings tab instead of a connect button that could only fail.
 */
export function oauthAppFromEnv(
  provider: DriveProviderId,
  defaults: Omit<OAuthApp, "clientId" | "clientSecret">,
): OAuthApp | null {
  const prefix = `POLYMUX_${provider.replace(/-/g, "_").toUpperCase()}`;
  const clientId = process.env[`${prefix}_CLIENT_ID`]?.trim();
  if (!clientId) return null;
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`]?.trim();
  return {
    ...defaults,
    clientId,
    clientSecret: clientSecret ? clientSecret : null,
  };
}

/**
 * Runs the authorization-code flow for one provider and holds the resulting
 * tokens.
 *
 * The user signs in on the provider's own page in a dedicated window — Polymux
 * never sees the password, only the code the provider hands back. PKCE is
 * always used, so a build shipping a public client id is still safe against an
 * intercepted code.
 */
export class OAuthClient {
  readonly #provider: DriveProviderId;
  readonly #app: OAuthApp | null;
  readonly #secrets: DriveSecretStore;
  readonly #consent: DriveConsentPrompt;
  /** In-flight refreshes are shared: several list calls landing at once must
   * not each spend the refresh token, which some providers rotate. */
  #refreshing: Promise<StoredTokens> | null = null;

  /** Which of the provider's accounts these tokens belong to. Scoping the
   * credential id by account is what lets two Google Drives be signed in at
   * once instead of the second sign-in overwriting the first. */
  readonly #accountId: string;

  constructor(
    provider: DriveProviderId,
    app: OAuthApp | null,
    secrets: DriveSecretStore,
    consent: DriveConsentPrompt,
    accountId = LEGACY_ACCOUNT_ID,
  ) {
    this.#provider = provider;
    this.#app = app;
    this.#secrets = secrets;
    this.#consent = consent;
    this.#accountId = accountId;
  }

  /** False when this build has no client credentials for the provider. */
  configured(): boolean {
    return this.#app !== null;
  }

  async connected(): Promise<boolean> {
    return (await this.#read()) !== null;
  }

  /** Opens the provider's consent page and stores what comes back. */
  async authorize(): Promise<void> {
    const app = this.#require();
    const verifier = base64Url(randomBytes(32));
    const challenge = base64Url(createHash("sha256").update(verifier).digest());
    const state = base64Url(randomBytes(16));

    const url = new URL(app.authorizeUrl);
    url.searchParams.set("client_id", app.clientId);
    url.searchParams.set("redirect_uri", OAUTH_REDIRECT_URI);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", app.scopes.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    for (const [key, value] of Object.entries(app.extraAuthParams ?? {}))
      url.searchParams.set(key, value);

    const code = await this.#awaitCode(url.toString(), state);
    const tokens = await this.#exchange({
      grant_type: "authorization_code",
      code,
      redirect_uri: OAUTH_REDIRECT_URI,
      code_verifier: verifier,
    });
    // A provider that returns no refresh token has handed us a session that
    // will simply die; saying so now beats a mystery sign-out later.
    if (!tokens.refreshToken)
      console.warn(
        `${driveProviderLabel(this.#provider)} returned no refresh token; the connection will need renewing when the access token expires.`,
      );
    await this.#write(tokens);
  }

  /**
   * A usable access token, refreshing first if the stored one is spent.
   * Throws when the account is not connected, which callers surface as a
   * "reconnect" state rather than a failed file operation.
   */
  async accessToken(): Promise<string> {
    const stored = await this.#read();
    if (!stored)
      throw new Error(
        `${driveProviderLabel(this.#provider)} is not connected.`,
      );
    if (
      stored.expiresAt === null ||
      stored.expiresAt - Date.now() > REFRESH_BUFFER_MS
    )
      return stored.accessToken;
    if (!stored.refreshToken)
      throw new Error(
        `The ${driveProviderLabel(this.#provider)} session has expired. Connect it again.`,
      );
    this.#refreshing ??= this.#refresh(stored.refreshToken).finally(() => {
      this.#refreshing = null;
    });
    return (await this.#refreshing).accessToken;
  }

  async clear(): Promise<void> {
    await this.#secrets.clear(this.#credentialId());
    // The pre-accounts credential has to go with it, or the first account
    // would read it back on the next probe and appear still connected.
    if (this.#accountId === LEGACY_ACCOUNT_ID)
      await this.#secrets.clear(`drive:${this.#provider}`);
  }

  async #refresh(refreshToken: string): Promise<StoredTokens> {
    let tokens: StoredTokens;
    try {
      tokens = await this.#exchange({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      });
    } catch (cause) {
      // Only an explicit invalid_grant proves the refresh token can never work
      // again. Network failures and provider 5xx responses leave it intact so
      // a temporary outage does not sign the user out.
      if (cause instanceof OAuthTokenError && cause.code === "invalid_grant")
        await this.clear();
      throw new Error(
        cause instanceof OAuthTokenError && cause.code === "invalid_grant"
          ? `The ${driveProviderLabel(this.#provider)} connection was rejected. Connect it again. (${cause.message})`
          : `The ${driveProviderLabel(this.#provider)} connection could not be refreshed. The saved connection was kept. (${cause instanceof Error ? cause.message : String(cause)})`,
      );
    }
    // Providers that rotate refresh tokens send a new one; those that do not
    // omit it, and the original stays valid.
    const merged: StoredTokens = {
      ...tokens,
      refreshToken: tokens.refreshToken ?? refreshToken,
    };
    await this.#write(merged);
    return merged;
  }

  async #exchange(params: Record<string, string>): Promise<StoredTokens> {
    const app = this.#require();
    const body = new URLSearchParams({ ...params, client_id: app.clientId });
    if (app.clientSecret) body.set("client_secret", app.clientSecret);
    const response = await fetch(app.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(60_000),
    });
    const text = await response.text();
    if (!response.ok) {
      let code: string | null = null;
      try {
        const payload = JSON.parse(text) as { error?: string };
        code = typeof payload.error === "string" ? payload.error : null;
      } catch {
        // The status and truncated body remain enough to diagnose the failure.
      }
      throw new OAuthTokenError(
        response.status,
        code,
        `Token request failed (${response.status}): ${text.slice(0, 300)}`,
      );
    }
    const payload = JSON.parse(text) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };
    if (!payload.access_token)
      throw new Error("The provider returned no access token.");
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? null,
      expiresAt:
        typeof payload.expires_in === "number"
          ? Date.now() + payload.expires_in * 1000
          : null,
      scope: payload.scope ?? null,
    };
  }

  /**
   * Shows the consent page and waits for the provider to redirect back to the
   * loopback listener with a code.
   *
   * The listener is a real HTTP server rather than a navigation intercept
   * because that is what the providers' desktop redirect URIs expect, and it
   * lets the browser land on a page that says the flow is done instead of a
   * connection error.
   *
   * Only the window itself is the host's to open. Everything that decides
   * whether a code is trustworthy — the state check, the timeout, the port —
   * stays here, so no host can weaken the flow by implementing the prompt
   * differently.
   */
  async #awaitCode(url: string, expectedState: string): Promise<string> {
    let server: Server | undefined;
    let window: DriveConsentWindow | undefined;
    // The flow can end while the window is still opening — a timeout, or a
    // provider that redirects before the page paints. Remembering that is what
    // stops the window from being left on screen with nothing listening.
    let done = false;
    try {
      return await new Promise<string>((resolve, reject) => {
        const finish = (error: Error | null, code?: string): void => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          server?.close();
          window?.close();
          if (error) reject(error);
          else resolve(code!);
        };

        const timer = setTimeout(
          () => finish(new Error("The sign-in window timed out.")),
          AUTHORIZE_TIMEOUT_MS,
        );

        server = createServer((request, response) => {
          const incoming = new URL(
            request.url ?? "/",
            `http://127.0.0.1:${OAUTH_REDIRECT_PORT}`,
          );
          if (incoming.pathname !== "/drive/callback") {
            response.writeHead(404).end();
            return;
          }
          const code = incoming.searchParams.get("code");
          const state = incoming.searchParams.get("state");
          const failure = incoming.searchParams.get("error");
          response.writeHead(200, { "content-type": "text/html" });
          response.end(
            `<!doctype html><meta charset="utf-8"><title>Polymux</title><body style="font:15px -apple-system,sans-serif;display:grid;place-items:center;height:100vh;margin:0"><p>${
              code && state === expectedState
                ? "Connected. You can close this window."
                : "Sign-in failed. Return to Polymux and try again."
            }</p></body>`,
          );
          // State is what ties the response to the request this flow started;
          // a mismatch means the code belongs to someone else's.
          if (failure) finish(new Error(`The provider refused: ${failure}`));
          else if (!code) finish(new Error("The provider returned no code."));
          else if (state !== expectedState)
            finish(
              new Error("The sign-in response did not match the request."),
            );
          else finish(null, code);
        });

        server.on("error", (cause: NodeJS.ErrnoException) =>
          finish(
            new Error(
              cause.code === "EADDRINUSE"
                ? `Port ${OAUTH_REDIRECT_PORT} is already in use, so the sign-in cannot complete.`
                : `The sign-in listener failed: ${cause.message}`,
            ),
          ),
        );

        server.listen(OAUTH_REDIRECT_PORT, "127.0.0.1", () => {
          this.#consent
            .open({
              provider: this.#provider,
              title: `Connect ${driveProviderLabel(this.#provider)}`,
              url,
              // Closing the window is a cancel, not an error worth a dialog —
              // but the promise still has to settle or connect hangs forever.
              onClosed: () =>
                finish(new Error("The sign-in window was closed.")),
            })
            .then((opened) => {
              window = opened;
              if (done) opened.close();
            })
            .catch((cause: unknown) =>
              finish(cause instanceof Error ? cause : new Error(String(cause))),
            );
        });
      });
    } finally {
      server?.close();
      window?.close();
    }
  }

  #require(): OAuthApp {
    if (!this.#app)
      throw new Error(
        `This build has no ${driveProviderLabel(this.#provider)} credentials, so it cannot connect.`,
      );
    return this.#app;
  }

  #credentialId(): string {
    return `drive:${this.#provider}:${this.#accountId}`;
  }

  async #read(): Promise<StoredTokens | null> {
    const raw =
      (await this.#secrets.read(this.#credentialId())) ??
      // Before accounts were scoped there was one credential per provider.
      // The first account inherits it, so an existing connection survives the
      // upgrade rather than silently signing the user out.
      (this.#accountId === LEGACY_ACCOUNT_ID
        ? await this.#secrets.read(`drive:${this.#provider}`)
        : undefined);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredTokens;
    } catch {
      return null;
    }
  }

  async #write(tokens: StoredTokens): Promise<void> {
    await this.#secrets.write(this.#credentialId(), JSON.stringify(tokens));
  }
}

function base64Url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
