import {createServer, type Server} from "node:http";
import {
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  discovery,
  randomPKCECodeVerifier,
  randomState,
  refreshTokenGrant,
  customFetch,
  type Configuration,
} from "openid-client";

/**
 * Signing in to a mailbox with the provider's own account.
 *
 * The protocol is `openid-client`'s, deliberately. Everything here that is not
 * the flow itself — the loopback listener, the window, the state check — is a
 * dozen lines of plumbing, but the exchange in the middle is where a mail
 * client quietly gets things wrong, and a certified implementation of it is
 * worth more than one of ours. Discovery also means the endpoints are the
 * provider's own answer rather than a table here that goes stale.
 */

export type MailOAuthProvider = "google" | "microsoft";

/**
 * The loopback address every provider redirects back to.
 *
 * Fixed rather than ephemeral because Microsoft matches redirect URIs exactly,
 * so the address has to be registerable in advance — and distinct from the
 * drive flow's 47665, because connecting a drive and a mailbox at the same
 * moment must not collide on the port.
 */
export const MAIL_OAUTH_REDIRECT_PORT = 47666;
export const MAIL_OAUTH_REDIRECT_URI = `http://127.0.0.1:${MAIL_OAUTH_REDIRECT_PORT}/mail/callback`;

/** A window the host opened on the provider's sign-in page. */
export interface MailConsentWindow {
  close(): void;
}

/**
 * The one thing the host owns. FlareAI never sees the password — only the code
 * the provider hands back — and every decision about whether that code can be
 * trusted stays on this side, so no host can weaken the flow by implementing
 * the prompt differently.
 */
export interface MailConsentPrompt {
  open(request: {
    provider: string;
    title: string;
    url: string;
    onClosed: () => void;
  }): Promise<MailConsentWindow>;
}

interface ProviderShape {
  issuer: string;
  scopes: string[];
  /** Parameters this provider needs beyond the standard set. */
  extra?: Record<string, string>;
  imap: {host: string; port: number; encryption: "tls" | "start-tls" | "none"};
  smtp: {host: string; port: number; encryption: "tls" | "start-tls" | "none"};
}

/**
 * What each provider needs, and the servers that come with it. Signing in to
 * Google *is* the answer to which mail servers to use, so the account never has
 * to ask the user for a hostname it already knows.
 */
export const MAIL_OAUTH_PROVIDERS: Record<MailOAuthProvider, ProviderShape> = {
  google: {
    issuer: "https://accounts.google.com",
    // Google publishes no narrower scope that opens IMAP: `mail.google.com` is
    // the only one that works at all, and it is a restricted scope. The breadth
    // is Google's decision, not a shortcut taken here.
    scopes: ["openid", "email", "https://mail.google.com/"],
    // Without these Google issues no refresh token on a second sign-in, and the
    // account would be renewable exactly once.
    extra: {access_type: "offline", prompt: "consent"},
    imap: {host: "imap.gmail.com", port: 993, encryption: "tls"},
    smtp: {host: "smtp.gmail.com", port: 587, encryption: "start-tls"},
  },
  microsoft: {
    issuer: "https://login.microsoftonline.com/common/v2.0",
    // Microsoft refuses a token request mixing scopes from two resources, and
    // outlook.office.com is not Graph; the OIDC scopes are the documented
    // exception, which is why `email` may sit beside the mail ones.
    scopes: [
      "openid",
      "email",
      "offline_access",
      "https://outlook.office.com/IMAP.AccessAsUser.All",
      "https://outlook.office.com/SMTP.Send",
    ],
    imap: {host: "outlook.office365.com", port: 993, encryption: "tls"},
    smtp: {host: "smtp.office365.com", port: 587, encryption: "start-tls"},
  },
};

export function mailOAuthLabel(provider: MailOAuthProvider): string {
  return provider === "google" ? "Google" : "Microsoft";
}

/** What a completed sign-in yields. */
export interface MailAuthorization {
  provider: MailOAuthProvider;
  /** The address the provider says these tokens belong to. */
  address: string;
  accessToken: string;
  refreshToken: string;
  servers: {imap: ProviderShape["imap"]; smtp: ProviderShape["smtp"]};
}

/** How long the sign-in window may stand open before the flow gives up. */
const AUTHORIZE_TIMEOUT_MS = 5 * 60_000;

export interface MailOAuthOptions {
  clientId: string;
  /** Desktop apps are public clients; most providers issue no secret. */
  clientSecret?: string;
  consent: MailConsentPrompt;
}

/**
 * Runs the authorization-code flow for one provider and reports the tokens.
 *
 * Nothing is stored here — the caller decides what to do with an account and
 * where its secrets live, which keeps this module free of both the keychain
 * and the account file.
 */
export async function signInToMailbox(
  provider: MailOAuthProvider,
  options: MailOAuthOptions,
): Promise<MailAuthorization> {
  const shape = MAIL_OAUTH_PROVIDERS[provider];
  const config = await discovery(
    new URL(shape.issuer),
    options.clientId,
    options.clientSecret ? {client_secret: options.clientSecret} : undefined,
  );
  const verifier = randomPKCECodeVerifier();
  const challenge = await calculatePKCECodeChallenge(verifier);
  const state = randomState();
  const url = buildAuthorizationUrl(config, {
    redirect_uri: MAIL_OAUTH_REDIRECT_URI,
    scope: shape.scopes.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    ...(shape.extra ?? {}),
  });
  const landed = await awaitRedirect(url.href, state, provider, options.consent);
  const tokens = await authorizationCodeGrant(config, landed, {
    pkceCodeVerifier: verifier,
    expectedState: state,
  });
  if (!tokens.refresh_token)
    throw new Error(
      `${mailOAuthLabel(provider)} returned no refresh token, so the mailbox could not stay signed in.`,
    );
  const claims = tokens.claims();
  const address = typeof claims?.email === "string" ? claims.email : "";
  if (!address)
    throw new Error(`${mailOAuthLabel(provider)} did not say which address was signed in.`);
  return {
    provider,
    address,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    servers: {imap: shape.imap, smtp: shape.smtp},
  };
}

/** Exchanges a refresh token for a fresh access token. */
export async function renewMailToken(
  provider: MailOAuthProvider,
  options: {
    clientId: string;
    clientSecret?: string;
    refreshToken: string;
    /** Swapped in tests; the provider is the only thing reached. */
    fetch?: typeof fetch;
  },
): Promise<{accessToken: string; refreshToken?: string}> {
  const config = await discovery(
    new URL(MAIL_OAUTH_PROVIDERS[provider].issuer),
    options.clientId,
    options.clientSecret ? {client_secret: options.clientSecret} : undefined,
  );
  if (options.fetch) config[customFetch] = options.fetch as unknown as typeof config[typeof customFetch];
  const tokens = await refreshTokenGrant(config, options.refreshToken);
  return {
    accessToken: tokens.access_token,
    // A provider that rotates its refresh token returns a new one, and losing
    // it means the account can never renew again.
    ...(tokens.refresh_token ? {refreshToken: tokens.refresh_token} : {}),
  };
}

/**
 * Opens the provider's sign-in page and waits for the redirect back.
 *
 * A real HTTP server rather than a navigation intercept, because that is what
 * the providers' desktop redirect URIs expect, and it lets the browser land on
 * a page saying the flow is done instead of a connection error.
 */
async function awaitRedirect(
  url: string,
  expectedState: string,
  provider: MailOAuthProvider,
  consent: MailConsentPrompt,
): Promise<URL> {
  let server: Server | undefined;
  let window: MailConsentWindow | undefined;
  // The flow can end while the window is still opening — a timeout, or a
  // provider that redirects before the page paints. Remembering that is what
  // stops the window being left on screen with nothing listening.
  let done = false;
  try {
    return await new Promise<URL>((resolve, reject) => {
      const finish = (error: Error | null, landed?: URL): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        server?.close();
        window?.close();
        if (error) reject(error);
        else resolve(landed!);
      };
      const timer = setTimeout(
        () => finish(new Error("The sign-in window timed out.")),
        AUTHORIZE_TIMEOUT_MS,
      );
      server = createServer((request, response) => {
        const incoming = new URL(
          request.url ?? "/",
          `http://127.0.0.1:${MAIL_OAUTH_REDIRECT_PORT}`,
        );
        if (incoming.pathname !== "/mail/callback") {
          response.writeHead(404).end();
          return;
        }
        const failure = incoming.searchParams.get("error");
        const matched = incoming.searchParams.get("state") === expectedState;
        response.writeHead(200, {"content-type": "text/html"});
        response.end(
          `<!doctype html><meta charset="utf-8"><title>FlareAI</title><body style="font:15px -apple-system,sans-serif;display:grid;place-items:center;height:100vh;margin:0"><p>${
            !failure && matched
              ? "Signed in. You can close this window."
              : "Sign-in failed. Return to FlareAI and try again."
          }</p></body>`,
        );
        if (failure) finish(new Error(`${mailOAuthLabel(provider)} refused: ${failure}`));
        // The library checks state again when the code is exchanged; this one
        // decides what the browser is told, and settles the wait either way.
        else if (!matched)
          finish(new Error("The sign-in response did not match the request."));
        else finish(null, incoming);
      });
      server.on("error", (cause: NodeJS.ErrnoException) =>
        finish(
          new Error(
            cause.code === "EADDRINUSE"
              ? `Port ${MAIL_OAUTH_REDIRECT_PORT} is already in use, so the sign-in cannot complete.`
              : `The sign-in listener failed: ${cause.message}`,
          ),
        ),
      );
      server.listen(MAIL_OAUTH_REDIRECT_PORT, "127.0.0.1", () => {
        consent
          .open({
            provider,
            title: `Sign in to ${mailOAuthLabel(provider)}`,
            url,
            // Closing the window is a cancel, not an error worth a dialog — but
            // the promise still has to settle, or signing in hangs forever.
            onClosed: () => finish(new Error("The sign-in window was closed.")),
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
