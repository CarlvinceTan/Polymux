import {createServer, type Server} from "node:http";
import {createClient, type SupabaseClient} from "@supabase/supabase-js";
import type {AccountOAuthProvider, AccountProfileDto, AccountSignInResult, AccountStatusDto} from "@polymux/protocol";
import type {CredentialStore} from "@earendil-works/pi-ai";

const SESSION_CREDENTIAL_ID = "polymux-account:session";
const SESSION_INDEX_ID = "polymux-account:index";

function sessionStoreId(userId: string): string {
  return `polymux-account:session:${userId}`;
}
export const ACCOUNT_OAUTH_REDIRECT_PORT = 47667;
export const ACCOUNT_OAUTH_REDIRECT_URI = `http://127.0.0.1:${ACCOUNT_OAUTH_REDIRECT_PORT}/auth/callback`;
const OAUTH_TIMEOUT_MS = 5 * 60_000;

export interface AccountServiceOptions {
  url: string | null;
  anonKey: string | null;
  credentials: CredentialStore;
  /** Opens the provider consent page in the user's own browser. */
  openExternal: (url: string) => void | Promise<void>;
  onSignedIn: () => void | Promise<void>;
  onSignedOut: () => void | Promise<void>;
  /** Runs before outgoing credentials are replaced or removed. */
  onBeforeSessionChange?: () => void | Promise<void>;
  fetch?: typeof fetch;
}

interface AccountSessionUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}

/**
 * Optional Polymux account sign-in backed by Supabase. Sessions persist in the
 * encrypted credential store; only non-secret profile fields ever cross IPC.
 */
export class AccountService {
  readonly #credentials: CredentialStore;
  readonly #openExternal: AccountServiceOptions["openExternal"];
  readonly #onSignedIn: AccountServiceOptions["onSignedIn"];
  readonly #onSignedOut: AccountServiceOptions["onSignedOut"];
  readonly #client: SupabaseClient | null;
  #status: AccountStatusDto;
  #remembered: AccountProfileDto[] = [];
  #oauth: Promise<AccountSignInResult> | null = null;
  #unsubscribe?: () => void;
  #transition: Promise<unknown> = Promise.resolve();
  readonly #authStorageKeys = new Set<string>();
  readonly #beforeSessionChange: AccountServiceOptions["onBeforeSessionChange"];

  constructor(options: AccountServiceOptions) {
    this.#credentials = options.credentials;
    this.#openExternal = options.openExternal;
    this.#onSignedIn = options.onSignedIn;
    this.#onSignedOut = options.onSignedOut;
    this.#beforeSessionChange = options.onBeforeSessionChange;
    const available = Boolean(options.url && options.anonKey);
    this.#status = {signedIn: false, available, profile: null, accounts: []};
    this.#client = available
      ? createClient(options.url!, options.anonKey!, {
          ...(options.fetch ? {global: {fetch: options.fetch}} : {}),
          auth: {
            flowType: "pkce",
            detectSessionInUrl: false,
            autoRefreshToken: true,
            persistSession: true,
            storage: {
              getItem: async (key) => {
                this.#authStorageKeys.add(key);
                try {
                  const credential = await this.#credentials.read(key);
                  return typeof credential?.key === "string" ? credential.key : null;
                } catch {
                  // Encryption may be unavailable before the first unlock;
                  // treat the session as absent rather than failing startup.
                  return null;
                }
              },
              setItem: async (key, value) => {
                this.#authStorageKeys.add(key);
                await this.#credentials.modify(key, async () => ({type: "api_key", key: value}));
              },
              removeItem: async (key) => {
                this.#authStorageKeys.add(key);
                await this.#credentials.delete(key);
              },
            },
          },
        })
      : null;
    if (this.#client) {
      const {data} = this.#client.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
          this.#applySession(session?.user ?? null);
          if (session?.user && session.access_token && session.refresh_token) {
            void this.#writeSession(session.user.id, {
              access_token: session.access_token,
              refresh_token: session.refresh_token,
            });
          }
        } else if (event === "SIGNED_OUT") {
          this.#applySession(null);
        }
      });
      this.#unsubscribe = () => data.subscription.unsubscribe();
    }
  }

  get client(): SupabaseClient | null {
    return this.#client;
  }

  status(): AccountStatusDto {
    return this.#status;
  }

  #changeSession<T>(change: () => Promise<T>, signingOut = false): Promise<T> {
    const pending = this.#transition.then(async () => {
      try {
        if (this.#status.signedIn) {
          try { await this.#beforeSessionChange?.(); }
          catch (error) {
            if (!signingOut) throw error;
            // Remote registry availability must never keep local credentials
            // signed in. The hook revokes the local pairing gate first.
            console.warn("Account device withdrawal could not finish:", error instanceof Error ? error.message : error);
          }
        }
        return await change();
      } finally {
        // Failed sign-in/switch and same-account reauthentication may not emit
        // SIGNED_IN. Restart discovery for whichever session remains active.
        if (this.#status.signedIn) await this.#onSignedIn();
      }
    });
    this.#transition = pending.catch(() => {});
    return pending;
  }

  /** Waits for the persisted session to be restored from the credential store. */
  async restore(): Promise<void> {
    if (!this.#client) return;
    await this.#loadIndex();
    try {
      const {data} = await this.#client.auth.getSession();
      this.#applySession(data.session?.user ?? null);
    } catch (error) {
      console.warn("Account session restore failed:", error instanceof Error ? error.message : error);
    }
    await this.#pruneMissingSessions();
  }

  signInWithPassword(email: string, password: string): Promise<AccountSignInResult> {
    return this.#changeSession(() => this.#signInWithPassword(email, password));
  }

  async #signInWithPassword(email: string, password: string): Promise<AccountSignInResult> {
    if (!this.#client) return {...this.#status, error: "Account sign-in is not available in this build."};
    await this.#stashCurrentIfSignedIn();
    try {
      const {error} = await this.#client.auth.signInWithPassword({email, password});
      if (error) return {...this.#status, error: accountError(error.message)};
      await this.restore();
      return this.#result();
    } catch (error) {
      return {...this.#status, error: accountError(error instanceof Error ? error.message : String(error))};
    }
  }

  signUp(email: string, password: string): Promise<AccountSignInResult> {
    return this.#changeSession(() => this.#signUp(email, password));
  }

  async #signUp(email: string, password: string): Promise<AccountSignInResult> {
    if (!this.#client) return {...this.#status, error: "Account sign-up is not available in this build."};
    await this.#stashCurrentIfSignedIn();
    try {
      const {data, error} = await this.#client.auth.signUp({
        email,
        password,
        options: {emailRedirectTo: `${ACCOUNT_OAUTH_REDIRECT_URI}?next=confirm`},
      });
      if (error) return {...this.#status, error: accountError(error.message)};
      // With email confirmation on, signUp does not start a session; the user
      // confirms from the email link, which redirects into the loopback flow.
      if (!data.session) {
        return {...this.#status, error: undefined};
      }
      await this.restore();
      return this.#result();
    } catch (error) {
      return {...this.#status, error: accountError(error instanceof Error ? error.message : String(error))};
    }
  }

  async resendConfirmation(email: string): Promise<{ok: boolean; error?: string}> {
    if (!this.#client) return {ok: false, error: "Account sign-in is not available in this build."};
    try {
      const {error} = await this.#client.auth.resend({
        type: "signup",
        email,
        options: {emailRedirectTo: `${ACCOUNT_OAUTH_REDIRECT_URI}?next=confirm`},
      });
      return error ? {ok: false, error: accountError(error.message)} : {ok: true};
    } catch (error) {
      return {ok: false, error: accountError(error instanceof Error ? error.message : String(error))};
    }
  }

  async requestPasswordReset(email: string): Promise<{ok: boolean; error?: string}> {
    if (!this.#client) return {ok: false, error: "Account sign-in is not available in this build."};
    try {
      const {error} = await this.#client.auth.resetPasswordForEmail(email, {
        redirectTo: ACCOUNT_OAUTH_REDIRECT_URI,
      });
      if (error) return {ok: false, error: accountError(error.message)};
      void this.#awaitPasswordReset();
      return {ok: true};
    } catch (error) {
      return {ok: false, error: accountError(error instanceof Error ? error.message : String(error))};
    }
  }

  async updatePassword(password: string): Promise<AccountSignInResult> {
    if (!this.#client) return {...this.#status, error: "Account sign-in is not available in this build."};
    try {
      const {error} = await this.#client.auth.updateUser({password});
      if (error) return {...this.#status, error: accountError(error.message)};
      await this.restore();
      return this.#result();
    } catch (error) {
      return {...this.#status, error: accountError(error instanceof Error ? error.message : String(error))};
    }
  }

  async #awaitPasswordReset(): Promise<void> {
    if (this.#oauth) return;
    const flow = (async (): Promise<AccountSignInResult> => {
      try {
        const code = await waitForOAuthCode({
          timeoutMs: 15 * 60_000,
          successMessage: "Return to Polymux to choose a new password.",
        });
        return await this.completeOAuth(code);
      } catch (error) {
        return {...this.#status, error: accountError(error instanceof Error ? error.message : String(error))};
      } finally {
        if (this.#oauth === flow) this.#oauth = null;
      }
    })();
    this.#oauth = flow;
    await flow;
  }

  async signInWithOAuth(provider: AccountOAuthProvider): Promise<AccountSignInResult> {
    if (!this.#client) return {...this.#status, error: "Account sign-in is not available in this build."};
    await this.#stashCurrentIfSignedIn();
    this.#oauth?.catch(() => {});
    const flow = this.#startOAuth(provider);
    this.#oauth = flow;
    return flow;
  }

  /** The CLI owns its local callback listener; the Host keeps the PKCE verifier. */
  async beginOAuth(provider: AccountOAuthProvider): Promise<string> {
    if (!this.#client) throw new Error('Account sign-in is not available in this build.');
    const {data, error} = await this.#client.auth.signInWithOAuth({provider, options: {
      redirectTo: ACCOUNT_OAUTH_REDIRECT_URI, skipBrowserRedirect: true,
    }});
    if (error || !data.url) throw new Error(accountError(error?.message ?? 'Could not start sign-in.'));
    return data.url;
  }

  completeOAuth(code: string): Promise<AccountSignInResult> {
    return this.#changeSession(() => this.#completeOAuth(code));
  }

  async #completeOAuth(code: string): Promise<AccountSignInResult> {
    if (!this.#client) throw new Error('Account sign-in is not available in this build.');
    const {error} = await this.#client.auth.exchangeCodeForSession(code);
    if (error) return {...this.#status, error: accountError(error.message)};
    await this.restore();
    return this.#result();
  }

  async close(): Promise<void> {
    this.#unsubscribe?.();
    await this.#client?.auth.stopAutoRefresh();
  }

  async #startOAuth(provider: AccountOAuthProvider): Promise<AccountSignInResult> {
    let flow: Promise<AccountSignInResult> | null = null;
    flow = (async () => {
      try {
        const {data, error} = await this.#client!.auth.signInWithOAuth({
          provider,
          options: {redirectTo: ACCOUNT_OAUTH_REDIRECT_URI, skipBrowserRedirect: true},
        });
        if (error || !data.url) {
          return {...this.#status, error: accountError(error?.message ?? "The sign-in page could not be opened.")};
        }
        await this.#openExternal(data.url);
        const code = await waitForOAuthCode({});
        return await this.completeOAuth(code);
      } catch (error) {
        return {...this.#status, error: accountError(error instanceof Error ? error.message : String(error))};
      } finally {
        if (this.#oauth === flow) this.#oauth = null;
      }
    })();
    return flow;
  }

  switchTo(userId: string): Promise<AccountSignInResult> {
    return this.#changeSession(() => this.#switchTo(userId));
  }

  async #switchTo(userId: string): Promise<AccountSignInResult> {
    if (!this.#client) return {...this.#status, error: "Account sign-in is not available in this build."};
    if (this.#status.profile?.userId === userId) return this.#result();
    await this.#stashCurrentIfSignedIn();
    const stored = await this.#readSession(userId);
    if (!stored) return {...this.#status, error: "That account is no longer signed in on this device."};
    try {
      const {error} = await this.#client.auth.setSession({
        access_token: stored.access_token,
        refresh_token: stored.refresh_token,
      });
      if (error) return {...this.#status, error: accountError(error.message)};
      await this.restore();
      return this.#result();
    } catch (error) {
      return {...this.#status, error: accountError(error instanceof Error ? error.message : String(error))};
    }
  }

  signOut(scope: 'local' | 'global' = 'global'): Promise<AccountStatusDto> {
    return this.#changeSession(() => this.#signOut(scope), true);
  }

  async #signOut(scope: 'local' | 'global' = 'global'): Promise<AccountStatusDto> {
    if (!this.#client) return this.#status;
    const currentId = this.#status.profile?.userId ?? null;
    try {
      const {error} = await this.#client.auth.signOut({scope});
      if (error) throw error;
    } catch (error) {
      console.warn("Account sign-out failed:", error instanceof Error ? error.message : error);
    }
    // Clear the SDK's actual storage keys as well as remembered-account
    // tokens, even if signOut returned early during an offline refresh failure.
    const keys = new Set([...this.#authStorageKeys, SESSION_CREDENTIAL_ID]);
    if (currentId) keys.add(sessionStoreId(currentId));
    const cleanup = await Promise.allSettled([...keys].map((key) => this.#credentials.delete(key)));
    for (const result of cleanup) {
      if (result.status === "rejected")
        console.warn("Account local credential removal failed:", result.reason instanceof Error ? result.reason.message : result.reason);
    }
    if (currentId) {
      this.#remembered = this.#remembered.filter((entry) => entry.userId !== currentId);
      await this.#saveIndex();
    }
    this.#applySession(null);
    return this.#status;
  }

  #result(): AccountSignInResult {
    return {...this.#status};
  }

  #applySession(user: AccountSessionUser | null): void {
    const wasSignedIn = this.#status.signedIn;
    const previousId = this.#status.profile?.userId ?? null;
    if (!user) {
      this.#status = this.#dto(null);
      if (wasSignedIn) void this.#onSignedOut();
      return;
    }
    const meta = user.user_metadata ?? {};
    const email = typeof user.email === "string" ? user.email : "";
    const name = typeof meta.full_name === "string" && meta.full_name
      ? meta.full_name
      : typeof meta.name === "string" && meta.name
        ? meta.name
        : email.split("@")[0] ?? "";
    const avatarUrl = typeof meta.avatar_url === "string"
      ? meta.avatar_url
      : typeof meta.picture === "string"
        ? meta.picture
        : "";
    const profile = {userId: user.id, email, name, avatarUrl};
    this.#upsertRemembered(profile);
    this.#status = this.#dto(profile);
    void this.#saveIndex();
    const switched = wasSignedIn && previousId !== profile.userId;
    if (switched) {
      void this.#onSignedOut();
      void this.#onSignedIn();
    } else if (!wasSignedIn) {
      void this.#onSignedIn();
    }
  }

  #dto(profile: AccountProfileDto | null): AccountStatusDto {
    return {
      signedIn: Boolean(profile),
      available: this.#status.available,
      profile,
      accounts: this.#remembered.filter((entry) => entry.userId !== profile?.userId),
    };
  }

  #upsertRemembered(profile: AccountProfileDto): void {
    const index = this.#remembered.findIndex((entry) => entry.userId === profile.userId);
    if (index >= 0) this.#remembered[index] = profile;
    else this.#remembered.push(profile);
  }

  async #stashCurrentIfSignedIn(): Promise<void> {
    if (!this.#client || !this.#status.profile) return;
    const {data} = await this.#client.auth.getSession();
    const session = data.session;
    if (!session?.access_token || !session.refresh_token) return;
    await this.#writeSession(this.#status.profile.userId, {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
    this.#upsertRemembered(this.#status.profile);
    await this.#saveIndex();
  }

  async #writeSession(userId: string, tokens: {access_token: string; refresh_token: string}): Promise<void> {
    try {
      await this.#credentials.modify(sessionStoreId(userId), async () => ({
        type: "api_key",
        key: JSON.stringify(tokens),
      }));
    } catch (error) {
      console.warn("Account session save failed:", error instanceof Error ? error.message : error);
    }
  }

  async #readSession(userId: string): Promise<{access_token: string; refresh_token: string} | null> {
    try {
      const credential = await this.#credentials.read(sessionStoreId(userId));
      if (typeof credential?.key !== "string") return null;
      const parsed = JSON.parse(credential.key) as {access_token?: unknown; refresh_token?: unknown};
      if (typeof parsed.access_token !== "string" || typeof parsed.refresh_token !== "string") return null;
      return {access_token: parsed.access_token, refresh_token: parsed.refresh_token};
    } catch {
      return null;
    }
  }

  async #loadIndex(): Promise<void> {
    try {
      const credential = await this.#credentials.read(SESSION_INDEX_ID);
      if (typeof credential?.key !== "string") return;
      const parsed = JSON.parse(credential.key) as {accounts?: unknown};
      if (!Array.isArray(parsed.accounts)) return;
      this.#remembered = parsed.accounts.flatMap((entry) => {
        const profile = asProfile(entry);
        return profile ? [profile] : [];
      });
    } catch {
      this.#remembered = [];
    }
  }

  async #saveIndex(): Promise<void> {
    try {
      await this.#credentials.modify(SESSION_INDEX_ID, async () => ({
        type: "api_key",
        key: JSON.stringify({accounts: this.#remembered}),
      }));
    } catch (error) {
      console.warn("Account list save failed:", error instanceof Error ? error.message : error);
    }
  }

  async #pruneMissingSessions(): Promise<void> {
    const currentId = this.#status.profile?.userId ?? null;
    const kept: AccountProfileDto[] = [];
    for (const entry of this.#remembered) {
      if (entry.userId === currentId) {
        kept.push(entry);
        continue;
      }
      if (await this.#readSession(entry.userId)) kept.push(entry);
    }
    if (kept.length === this.#remembered.length) {
      this.#status = this.#dto(this.#status.profile);
      return;
    }
    this.#remembered = kept;
    await this.#saveIndex();
    this.#status = this.#dto(this.#status.profile);
  }
}

function asProfile(value: unknown): AccountProfileDto | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.userId !== "string" || !row.userId) return null;
  return {
    userId: row.userId,
    email: typeof row.email === "string" ? row.email : "",
    name: typeof row.name === "string" ? row.name : "",
    avatarUrl: typeof row.avatarUrl === "string" ? row.avatarUrl : "",
  };
}

function accountError(message: string): string {
  // Supabase auth messages are already user-facing; trim the noise.
  return message.replace(/^(AuthApiError|AuthRetryableFetchError):\s*/i, "");
}

/** One loopback listener per OAuth flow; resolves with the authorization code. */
function waitForOAuthCode(options: {timeoutMs?: number; successMessage?: string}): Promise<string> {
  let server: Server | undefined;
  let done = false;
  const timeoutMs = options.timeoutMs ?? OAUTH_TIMEOUT_MS;
  const successMessage = options.successMessage ?? "Signed in. You can close this window.";
  return new Promise<string>((resolve, reject) => {
    const finish = (error: Error | null, code?: string): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      server?.close();
      if (error) reject(error);
      else resolve(code!);
    };
    const timer = setTimeout(() => finish(new Error("The sign-in window timed out.")), timeoutMs);
    server = createServer((request, response) => {
      const incoming = new URL(request.url ?? "/", `http://127.0.0.1:${ACCOUNT_OAUTH_REDIRECT_PORT}`);
      if (incoming.pathname !== "/auth/callback") {
        response.writeHead(404).end();
        return;
      }
      const failure = incoming.searchParams.get("error_description") ?? incoming.searchParams.get("error");
      const code = incoming.searchParams.get("code");
      response.writeHead(200, {"content-type": "text/html"});
      response.end(
        `<!doctype html><meta charset="utf-8"><title>Polymux</title><body style="font:15px -apple-system,sans-serif;display:grid;place-items:center;height:100vh;margin:0"><p>${
          !failure && code ? successMessage : "Sign-in failed. Return to Polymux and try again."
        }</p></body>`,
      );
      if (failure) finish(new Error(failure));
      else if (!code) finish(new Error("The sign-in response did not include a code."));
      else finish(null, code);
    });
    server.on("error", (cause: NodeJS.ErrnoException) =>
      finish(
        new Error(
          cause.code === "EADDRINUSE"
            ? `Port ${ACCOUNT_OAUTH_REDIRECT_PORT} is already in use, so the sign-in cannot complete.`
            : `The sign-in listener failed: ${cause.message}`,
        ),
      ),
    );
    server.listen(ACCOUNT_OAUTH_REDIRECT_PORT, "127.0.0.1", () => {
      // The browser is already on its way; the listener just catches the leg back.
    });
  });
}
