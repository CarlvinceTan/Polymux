import {
  DESKTOP_OFFLINE,
  FetchVaultCloud,
  VaultSession,
  PolymuxAccountClient,
  parseVaultBlob,
  preferDesktopLoopback,
  pullAccountVault,
  resolveAccountConfig,
  syncSessionWithCloud,
} from "./offline.js";
import {POLYMUX_SUPABASE_ANON_KEY, POLYMUX_SUPABASE_URL} from "./config.js";

const VAULT_ORIGIN = "http://127.0.0.1:47654";
const CACHE_KEY = "polymux-vault-vault";

let localConfig = null;
try {
  localConfig = await import("./config.local.js");
} catch {
  localConfig = null;
}

const credentials = {
  url: localConfig?.POLYMUX_SUPABASE_URL || POLYMUX_SUPABASE_URL,
  anonKey: localConfig?.POLYMUX_SUPABASE_ANON_KEY || POLYMUX_SUPABASE_ANON_KEY,
};

function vaultUrl(path, query) {
  const url = new URL(path, VAULT_ORIGIN);
  if (url.origin !== VAULT_ORIGIN || !url.pathname.startsWith("/v1/vault/"))
    throw new Error("Invalid Vault endpoint");
  if (query) {
    for (const [name, value] of Object.entries(query))
      if (value != null) url.searchParams.set(name, String(value));
  }
  return url.href;
}

function desktopOffline() {
  return Object.assign(new Error("Open Polymux to use Vault"), {code: DESKTOP_OFFLINE});
}

export function desktopVaultUnavailableReason() {
  return chrome.runtime.getURL("").startsWith("safari-web-extension:")
    ? "Safari uses the vault saved in this browser or your account vault. Desktop Vault connection is not available."
    : "";
}

let desktopCapability = null;
async function vaultCapability() {
  if (desktopVaultUnavailableReason()) throw desktopOffline();
  if (!desktopCapability) {
    desktopCapability = chrome.runtime.sendNativeMessage("com.polymux.tab_context", {type: "polymux:vault-connection"})
      .then((reply) => {
        if (!reply?.ok || !/^[a-f0-9]{64}$/.test(reply.token ?? "")) throw desktopOffline();
        return reply.token;
      }).catch((error) => { desktopCapability = null; throw error; });
  }
  return desktopCapability;
}

export async function vaultRequest(path, options = {}, retry = true) {
  const url = vaultUrl(path, options.query);
  let response;
  try {
    const capability = await vaultCapability();
    response = await fetch(url, {
      method: options.method ?? "GET",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
        Authorization: `Bearer ${capability}`,
      },
      body: options.body == null ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw desktopOffline();
  }
  if (response.status === 403) {
    desktopCapability = null;
    if (retry) return vaultRequest(path, options, false);
    throw Object.assign(new Error("Reconnect the Polymux browser host to use desktop Vault"), {code: "client_authentication"});
  }
  let value = {};
  try {
    value = await response.json();
  } catch {
    value = {};
  }
  if (response.status === 503) throw desktopOffline();
  if (!response.ok)
    throw Object.assign(new Error(value.error || `Vault returned ${response.status}`), {
      code: response.status === 401 ? "locked" : "error",
    });
  return value;
}

export async function cacheVault(blob) {
  if (!blob?.bytes || !chrome?.storage?.local) return;
  await chrome.storage.local.set({[CACHE_KEY]: blob});
}

export async function loadCachedVault() {
  if (!chrome?.storage?.local) return null;
  const value = await chrome.storage.local.get(CACHE_KEY);
  return value[CACHE_KEY] ?? null;
}

export async function syncCachedVault() {
  try {
    const blob = await vaultRequest("/v1/vault/export");
    if (blob?.bytes) await cacheVault(blob);
    return blob;
  } catch {
    return null;
  }
}

export async function pushCachedVault() {
  const blob = await loadCachedVault();
  if (!blob?.bytes || !blob.meta?.dirty) return false;
  await vaultRequest("/v1/vault/import", {method: "POST", body: blob});
  blob.meta.dirty = false;
  await cacheVault(blob);
  return true;
}

function extensionAccountStorage() {
  return {
    async getItem(key) {
      if (!chrome?.storage?.local) return null;
      const value = await chrome.storage.local.get(key);
      const stored = value[key];
      return typeof stored === "string" ? stored : stored == null ? null : JSON.stringify(stored);
    },
    async setItem(key, value) {
      if (!chrome?.storage?.local) return;
      await chrome.storage.local.set({[key]: value});
    },
    async removeItem(key) {
      if (!chrome?.storage?.local) return;
      await chrome.storage.local.remove(key);
    },
  };
}

let accountClient = null;
let accountReady = null;

export function accountAvailable() {
  return Boolean(resolveAccountConfig(credentials));
}

export async function getAccount() {
  if (!accountAvailable()) return null;
  if (accountClient) return accountClient;
  if (!accountReady) {
    accountReady = (async () => {
      const client = new PolymuxAccountClient({
        url: credentials.url,
        anonKey: credentials.anonKey,
        storage: extensionAccountStorage(),
      });
      await client.restore();
      accountClient = client;
      return client;
    })();
  }
  return accountReady;
}

export function canOAuth() {
  return Boolean(chrome?.identity?.launchWebAuthFlow && chrome?.identity?.getRedirectURL);
}

export async function signInWithPassword(email, password) {
  const account = await getAccount();
  if (!account) return {signedIn: false, available: false, profile: null, error: "Account sign-in is not available in this build."};
  return account.signInWithPassword(email, password);
}

export async function signInWithOAuth(provider) {
  const account = await getAccount();
  if (!account) return {signedIn: false, available: false, profile: null, error: "Account sign-in is not available in this build."};
  if (!canOAuth()) return {...account.status(), error: "Sign in with email on this browser."};
  return account.signInWithOAuth(provider, {
    redirectTo: chrome.identity.getRedirectURL(),
    openUrl: async (url) => {
      const redirect = await chrome.identity.launchWebAuthFlow({url, interactive: true});
      if (!redirect) throw new Error("Sign-in was cancelled.");
      return redirect;
    },
  });
}

export async function signOutAccount() {
  const account = await getAccount();
  if (!account) return {signedIn: false, available: accountAvailable(), profile: null};
  return account.signOut();
}

export async function accountCloud() {
  const account = await getAccount();
  if (!account?.status().signedIn) return null;
  return new FetchVaultCloud(account);
}

export function createDeviceSession() {
  return new VaultSession({
    async load() {
      const current = parseVaultBlob(await loadCachedVault());
      return current ? {bytes: decode(current.bytes), meta: current.meta} : null;
    },
    async save(bytes, meta) {
      await cacheVault({bytes: encode(bytes), meta});
    },
  });
}

export async function syncDeviceCloud(session) {
  const cloud = await accountCloud();
  if (!cloud) return {status: session.status(), missing: false};
  return syncSessionWithCloud(session, cloud);
}

export async function pullDeviceCloud(session) {
  const cloud = await accountCloud();
  if (!cloud) return session.status();
  return pullAccountVault(session, cloud);
}

let backgroundSession = null;

export async function backgroundDeviceSession() {
  if (!backgroundSession) {
    backgroundSession = createDeviceSession();
    await backgroundSession.hydrate();
  }
  return backgroundSession;
}

export async function unlockDeviceSession(password) {
  const session = await backgroundDeviceSession();
  if (!session.status().exists && (await getAccount())?.status().signedIn) {
    try {
      await pullDeviceCloud(session);
    } catch {
      // Unlock still proceeds against whatever ciphertext is cached.
    }
  }
  await session.unlock(password);
  return session.status();
}

function asWebAuthnRequest(payload) {
  const origin = typeof payload.origin === "string" ? payload.origin : "";
  const rpId = typeof payload.rpId === "string" ? payload.rpId : "";
  const challenge = typeof payload.challenge === "string" ? payload.challenge : "";
  return {
    origin,
    rpId,
    challenge,
    allowCredentialIds: Array.isArray(payload.allowCredentialIds)
      ? payload.allowCredentialIds.filter((id) => typeof id === "string")
      : undefined,
    excludeCredentialIds: Array.isArray(payload.excludeCredentialIds)
      ? payload.excludeCredentialIds.filter((id) => typeof id === "string")
      : undefined,
    itemId: typeof payload.itemId === "string" ? payload.itemId : undefined,
    rpName: typeof payload.rpName === "string" ? payload.rpName : undefined,
    userName: typeof payload.userName === "string" ? payload.userName : "",
    userDisplayName: typeof payload.userDisplayName === "string" ? payload.userDisplayName : undefined,
    userId: typeof payload.userId === "string" ? payload.userId : "",
  };
}

function webauthnError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const locked = /locked|wrong master password/i.test(message);
  return {
    locked,
    error: message,
    invalidState: /already saved/i.test(message),
  };
}

async function webauthnDesktop(payload) {
  const request = asWebAuthnRequest(payload);
  if (payload.action === "status") {
    const status = await vaultRequest("/v1/vault/status");
    return {unlocked: Boolean(status.unlocked), exists: Boolean(status.exists), locked: !status.unlocked};
  }
  if (payload.action === "offers") {
    const value = await vaultRequest("/v1/vault/passkeys", {method: "POST", body: request});
    return {offers: value.offers ?? []};
  }
  if (payload.action === "get") {
    const value = await vaultRequest("/v1/vault/passkey/get", {method: "POST", body: request});
    return {credential: value};
  }
  if (payload.action === "create") {
    const value = await vaultRequest("/v1/vault/passkey/create", {method: "POST", body: request});
    return {credential: value};
  }
  return {error: "Unknown passkey request"};
}

async function webauthnDevice(payload) {
  const session = await backgroundDeviceSession();
  const request = asWebAuthnRequest(payload);
  if (payload.action === "status") {
    const status = session.status();
    return {unlocked: status.unlocked, exists: status.exists, locked: !status.unlocked};
  }
  if (!session.status().unlocked) return {locked: true, error: "Vault is locked"};
  if (payload.action === "offers") {
    return {offers: session.listPasskeys(request)};
  }
  if (payload.action === "get") {
    return {credential: await session.getPasskey(request)};
  }
  if (payload.action === "create") {
    const credential = await session.createPasskey(request);
    try {
      await syncDeviceCloud(session);
    } catch {
      // Ciphertext is already on this device; cloud can catch up later.
    }
    return {credential};
  }
  return {error: "Unknown passkey request"};
}

export async function handleWebAuthn(payload) {
  if (!["status", "offers", "get", "create"].includes(payload?.action)) return {error: "Unknown passkey request"};
  try {
    const routed = await preferDesktopLoopback(
      () => webauthnDesktop(payload),
      () => webauthnDevice(payload),
    );
    return routed.value;
  } catch (error) {
    return webauthnError(error);
  }
}

export {preferDesktopLoopback, DESKTOP_OFFLINE};

function encode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decode(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
