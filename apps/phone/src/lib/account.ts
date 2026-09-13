import {
  FetchLockerCloud,
  PolymuxAccountClient,
  resolveAccountConfig,
  type AccountFetch,
  type AccountStorage,
} from '@polymux/locker';
import {fetch as nativeFetch} from '@tauri-apps/plugin-http';
import {load, type Store} from '@tauri-apps/plugin-store';
import {invoke} from '@tauri-apps/api/core';

export function isApplePhone(): boolean {
  return isTauri() && (/iPhone|iPad|iPod/.test(navigator.userAgent) || /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

const STORE_FILE = 'account.json';
const BROWSER_PREFIX = 'polymux-phone-account:';

function isTauri(): boolean {
  return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
}

let fileStore: Promise<Store> | null = null;

function accountFile(): Promise<Store> {
  fileStore ??= load(STORE_FILE, {autoSave: true});
  return fileStore;
}

function transport(): AccountFetch {
  return (isTauri() ? nativeFetch : globalThis.fetch).bind(globalThis) as AccountFetch;
}

export function createPhoneAccountStorage(): AccountStorage {
  return {
    async getItem(key) {
      if (isApplePhone()) {
        const result = await invoke<{value: string | null}>('plugin:polymux-apple|secureGet', {key});
        if (result.value === null) {
          const legacy = await accountFile();
          const value = await legacy.get<string>(key);
          if (typeof value === 'string') {
            await invoke('plugin:polymux-apple|secureSet', {key, value});
            await legacy.delete(key);
            await legacy.save();
            return value;
          }
        }
        return result.value;
      }
      if (!isTauri()) return localStorage.getItem(`${BROWSER_PREFIX}${key}`);
      const store = await accountFile();
      const value = await store.get<string>(key);
      return typeof value === 'string' ? value : null;
    },
    async setItem(key, value) {
      if (isApplePhone()) return invoke<void>('plugin:polymux-apple|secureSet', {key, value});
      if (!isTauri()) {
        localStorage.setItem(`${BROWSER_PREFIX}${key}`, value);
        return;
      }
      const store = await accountFile();
      await store.set(key, value);
      await store.save();
    },
    async removeItem(key) {
      if (isApplePhone()) return invoke<void>('plugin:polymux-apple|secureRemove', {key});
      if (!isTauri()) {
        localStorage.removeItem(`${BROWSER_PREFIX}${key}`);
        return;
      }
      const store = await accountFile();
      await store.delete(key);
      await store.save();
    },
  };
}

let sharedAccount: ReturnType<typeof createPhoneAccount> | undefined;
export function phoneAccount() {
  return sharedAccount ??= createPhoneAccount();
}

export async function signInWithApple() {
  const account = phoneAccount();
  if (!account || !isApplePhone()) throw new Error('Apple sign-in requires the iOS app.');
  const identity = await invoke<{identityToken: string; nonce: string}>('plugin:polymux-apple|signIn');
  return account.client.signInWithAppleIdentity(identity.identityToken, identity.nonce);
}

export async function signInWithGoogle() {
  const account = phoneAccount();
  if (!account || !isApplePhone()) throw new Error('Google sign-in requires the iOS app.');
  return account.client.signInWithOAuth('google', {
    redirectTo: 'polymux-phone://auth/callback',
    openUrl: async url => (await invoke<{url: string}>('plugin:polymux-apple|oauth', {url})).url,
  });
}

export async function signOutPhoneAccount() {
  const {disableAutoFill} = await import('./autofill');
  await disableAutoFill();
  const {loadConnection, clearConnection, rpc} = await import('./host');
  const connection = await loadConnection();
  if (connection?.accountUserId) {
    await rpc(connection, 'notifications.unregister').catch(() => {});
    await clearConnection();
  }
  const status = await phoneAccount()?.client.signOut();
  window.dispatchEvent(new Event('polymux-account-signed-out'));
  return status;
}

export function createPhoneAccount(options: {
  url?: string | null;
  anonKey?: string | null;
  fetch?: AccountFetch;
  storage?: AccountStorage;
} = {}) {
  const config = resolveAccountConfig({
    url: options.url ?? import.meta.env.POLYMUX_SUPABASE_URL,
    anonKey: options.anonKey ?? import.meta.env.POLYMUX_SUPABASE_ANON_KEY,
  });
  if (!config) return null;
  const client = new PolymuxAccountClient({
    url: config.url,
    anonKey: config.anonKey,
    storage: options.storage ?? createPhoneAccountStorage(),
    fetch: options.fetch ?? transport(),
  });
  return {
    client,
    cloud: new FetchLockerCloud(client),
    ready: client.restore().then(() => undefined),
  };
}
