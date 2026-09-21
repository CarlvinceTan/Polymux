import {resolveAccountConfig, type AccountConfig} from "./config.js";

export const ACCOUNT_SESSION_KEY = "polymux-account:session";
const PKCE_KEY = "polymux-account:pkce";

export type AccountOAuthProvider = "google" | "apple";

export interface AccountProfile {
  userId: string;
  email: string;
  name: string;
  avatarUrl: string;
}

export interface AccountStatus {
  signedIn: boolean;
  available: boolean;
  profile: AccountProfile | null;
}

export interface AccountSignInResult extends AccountStatus {
  error?: string;
}

export interface AccountStorage {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem(key: string): Promise<void> | void;
}

export type AccountFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface PolymuxAccountClientOptions {
  url: string | null;
  anonKey: string | null;
  storage: AccountStorage;
  fetch?: AccountFetch;
}

interface StoredSession {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  user: {
    id: string;
    email?: string;
    user_metadata?: Record<string, unknown>;
  };
}

/**
 * Browser/phone account session against the same Supabase project as desktop.
 * Tokens stay in the provided store; the master password never belongs here.
 */
export class PolymuxAccountClient {
  readonly #config: AccountConfig | null;
  readonly #storage: AccountStorage;
  readonly #fetch: AccountFetch;
  #session: StoredSession | null = null;
  #status: AccountStatus;

  constructor(options: PolymuxAccountClientOptions) {
    this.#config = resolveAccountConfig(options);
    this.#storage = options.storage;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#status = {signedIn: false, available: Boolean(this.#config), profile: null};
  }

  available(): boolean {
    return this.#status.available;
  }

  status(): AccountStatus {
    return this.#status;
  }

  async restore(): Promise<AccountStatus> {
    if (!this.#config) return this.#status;
    const raw = await this.#storage.getItem(ACCOUNT_SESSION_KEY);
    const stored = parseSession(raw);
    if (!stored) {
      this.#apply(null);
      return this.#status;
    }
    this.#session = stored;
    this.#apply(stored.user);
    try {
      await this.accessToken();
    } catch {
      await this.#clearLocal();
    }
    return this.#status;
  }

  async signInWithPassword(email: string, password: string): Promise<AccountSignInResult> {
    if (!this.#config) return {...this.#status, error: unavailable()};
    try {
      const payload = await this.#authJson("/token?grant_type=password", {
        method: "POST",
        body: {email, password},
      });
      const session = asSession(payload);
      if (!session) return {...this.#status, error: "The sign-in response was incomplete."};
      await this.#save(session);
      return this.#status;
    } catch (error) {
      return {...this.#status, error: accountError(error)};
    }
  }

  /**
   * PKCE OAuth against the same authorize/token endpoints desktop uses.
   * `openUrl` must return the redirect URL that contains `code`.
   */
  async signInWithOAuth(
    provider: AccountOAuthProvider,
    options: {redirectTo: string; openUrl: (url: string) => Promise<string>},
  ): Promise<AccountSignInResult> {
    if (!this.#config) return {...this.#status, error: unavailable()};
    try {
      const verifier = generatePkceVerifier();
      const challenge = await generatePkceChallenge(verifier);
      await this.#storage.setItem(PKCE_KEY, verifier);
      const authorize = new URL("/auth/v1/authorize", this.#config.url);
      authorize.searchParams.set("provider", provider);
      authorize.searchParams.set("redirect_to", options.redirectTo);
      authorize.searchParams.set("code_challenge", challenge);
      authorize.searchParams.set("code_challenge_method", "S256");
      const redirected = await options.openUrl(authorize.href);
      const code = authCodeFromUrl(redirected);
      if (!code) {
        await this.#storage.removeItem(PKCE_KEY);
        return {...this.#status, error: "The sign-in response did not include a code."};
      }
      const payload = await this.#authJson("/token?grant_type=pkce", {
        method: "POST",
        body: {auth_code: code, code_verifier: verifier},
      });
      await this.#storage.removeItem(PKCE_KEY);
      const session = asSession(payload);
      if (!session) return {...this.#status, error: "The sign-in response was incomplete."};
      await this.#save(session);
      return this.#status;
    } catch (error) {
      try {
        await this.#storage.removeItem(PKCE_KEY);
      } catch {
        // The verifier is useless without a successful exchange.
      }
      return {...this.#status, error: accountError(error)};
    }
  }

  async signOut(): Promise<AccountStatus> {
    const token = this.#session?.access_token;
    if (this.#config && token) {
      try {
        await this.#request(`${this.#config.url}/auth/v1/logout`, {
          method: "POST",
          token,
        });
      } catch {
        // Server-side cookies may already be gone; local sign-out still proceeds.
      }
    }
    await this.#clearLocal();
    return this.#status;
  }

  async signInWithAppleIdentity(identityToken: string, nonce: string): Promise<AccountSignInResult> {
    if (!this.#config) return {...this.#status, error: unavailable()};
    try {
      const payload = await this.#authJson('/token?grant_type=id_token', {
        method: 'POST', body: {provider: 'apple', id_token: identityToken, nonce},
      });
      const session = asSession(payload);
      if (!session) throw new Error('The sign-in response was incomplete.');
      await this.#save(session);
      return this.#status;
    } catch (error) {
      return {...this.#status, error: accountError(error)};
    }
  }

  async signUp(email: string, password: string): Promise<AccountSignInResult> {
    if (!this.#config) return {...this.#status, error: unavailable()};
    try {
      const payload = await this.#authJson('/signup', {method: 'POST', body: {email, password}});
      const session = asSession(payload);
      if (session) await this.#save(session);
      return this.#status;
    } catch (error) {
      return {...this.#status, error: accountError(error)};
    }
  }

  async requestPasswordReset(email: string): Promise<{ok: boolean; error?: string}> {
    try {
      await this.#authJson('/recover', {method: 'POST', body: {email}});
      return {ok: true};
    } catch (error) {
      return {ok: false, error: accountError(error)};
    }
  }

  async accessToken(): Promise<string | null> {
    if (!this.#config || !this.#session) return null;
    if (!sessionExpired(this.#session)) return this.#session.access_token;
    const payload = await this.#authJson("/token?grant_type=refresh_token", {
      method: "POST",
      body: {refresh_token: this.#session.refresh_token},
    });
    const session = asSession(payload);
    if (!session) throw new Error("The account session could not be refreshed.");
    await this.#save(session);
    return session.access_token;
  }

  userId(): string | null {
    return this.#status.profile?.userId ?? null;
  }

  /** Authenticated fetch against the same project. Never logs the token. */
  async authorizedFetch(url: string, init: RequestInit = {}): Promise<Response> {
    if (!this.#config) throw new Error(unavailable());
    const token = await this.accessToken();
    if (!token) throw new Error("Sign in to sync this vault.");
    const headers = new Headers(init.headers);
    headers.set("apikey", this.#config.anonKey);
    headers.set("Authorization", `Bearer ${token}`);
    return this.#fetch(url, {...init, headers, cache: init.cache ?? "no-store"});
  }

  restUrl(path: string, query?: Record<string, string>): string {
    if (!this.#config) throw new Error(unavailable());
    const url = new URL(path, `${this.#config.url}/`);
    if (query) {
      for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
    }
    return url.href;
  }

  async #save(session: StoredSession): Promise<void> {
    this.#session = session;
    await this.#storage.setItem(ACCOUNT_SESSION_KEY, JSON.stringify(session));
    this.#apply(session.user);
  }

  async #clearLocal(): Promise<void> {
    this.#session = null;
    try {
      await this.#storage.removeItem(ACCOUNT_SESSION_KEY);
      await this.#storage.removeItem(PKCE_KEY);
    } catch {
      // A stale blob must not block signing out.
    }
    this.#apply(null);
  }

  #apply(user: StoredSession["user"] | null): void {
    this.#status = {
      signedIn: Boolean(user),
      available: Boolean(this.#config),
      profile: user ? profileFromUser(user) : null,
    };
  }

  async #authJson(
    path: string,
    options: {method: string; body: Record<string, unknown>},
  ): Promise<unknown> {
    if (!this.#config) throw new Error(unavailable());
    return this.#request(`${this.#config.url}/auth/v1${path}`, {
      method: options.method,
      json: options.body,
    });
  }

  async #request(
    url: string,
    options: {method: string; json?: Record<string, unknown>; token?: string; binary?: boolean},
  ): Promise<unknown> {
    if (!this.#config) throw new Error(unavailable());
    const headers: Record<string, string> = {
      apikey: this.#config.anonKey,
    };
    if (options.json) headers["Content-Type"] = "application/json;charset=UTF-8";
    const token = options.token;
    if (token) headers.Authorization = `Bearer ${token}`;
    else if (!isPublishableKey(this.#config.anonKey))
      headers.Authorization = `Bearer ${this.#config.anonKey}`;
    const response = await this.#fetch(url, {
      method: options.method,
      headers,
      body: options.json ? JSON.stringify(options.json) : undefined,
      cache: "no-store",
    });
    if (options.binary) return response;
    let value: unknown = {};
    try {
      value = await response.json();
    } catch {
      value = {};
    }
    if (!response.ok) throw new Error(messageFromBody(value) || `Account request failed (${response.status})`);
    return value;
  }
}

export function profileFromUser(user: {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}): AccountProfile {
  const meta = user.user_metadata ?? {};
  const email = typeof user.email === "string" ? user.email : "";
  const name =
    typeof meta.full_name === "string" && meta.full_name
      ? meta.full_name
      : typeof meta.name === "string" && meta.name
        ? meta.name
        : email.split("@")[0] ?? "";
  const avatarUrl =
    typeof meta.avatar_url === "string"
      ? meta.avatar_url
      : typeof meta.picture === "string"
        ? meta.picture
        : "";
  return {userId: user.id, email, name, avatarUrl};
}

export function authCodeFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.searchParams.get("code") || new URLSearchParams(url.hash.replace(/^#/, "")).get("code");
  } catch {
    return null;
  }
}

function unavailable(): string {
  return "Account sign-in is not available in this build.";
}

function isPublishableKey(key: string): boolean {
  return key.startsWith("sb_publishable_");
}

function sessionExpired(session: StoredSession): boolean {
  if (!session.expires_at) return false;
  return session.expires_at * 1000 < Date.now() + 60_000;
}

function parseSession(raw: string | null): StoredSession | null {
  if (!raw) return null;
  try {
    return asSession(JSON.parse(raw));
  } catch {
    return null;
  }
}

function asSession(value: unknown): StoredSession | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const nested = row.session && typeof row.session === "object" ? (row.session as Record<string, unknown>) : row;
  const access = nested.access_token;
  const refresh = nested.refresh_token;
  const user = (nested.user ?? row.user) as StoredSession["user"] | undefined;
  if (typeof access !== "string" || typeof refresh !== "string" || !user?.id) return null;
  const expiresIn = typeof nested.expires_in === "number" ? nested.expires_in : 0;
  const expiresAt =
    typeof nested.expires_at === "number" ? nested.expires_at : expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : undefined;
  return {
    access_token: access,
    refresh_token: refresh,
    expires_at: expiresAt,
    user: {id: user.id, email: user.email, user_metadata: user.user_metadata},
  };
}

function messageFromBody(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const row = value as Record<string, unknown>;
  for (const key of ["error_description", "msg", "message", "error"]) {
    if (typeof row[key] === "string" && row[key]) return String(row[key]);
  }
  return "";
}

function accountError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^(AuthApiError|AuthRetryableFetchError):\s*/i, "");
}

function generatePkceVerifier(): string {
  const bytes = new Uint32Array(56);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function generatePkceChallenge(verifier: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const bytes = new Uint8Array(hash);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
