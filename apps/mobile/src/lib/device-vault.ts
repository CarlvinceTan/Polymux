import {
  VaultSession,
  parseVaultBlob,
  planSync,
  pullAccountVault,
  syncSessionWithCloud,
  type VaultBlobStore,
  type VaultCloudStore,
  type VaultBlob,
  type VaultMeta,
} from '@polymux/vault';
import {load, type Store} from '@tauri-apps/plugin-store';
import type {JsonValue} from '@polymux/protocol';
import {autoFillEnabled, disableAutoFill, updateAutoFill} from './autofill';

const STORE_FILE = 'vault.json';
// One-time rename: the on-device store used to be called 'locker.json'.
const LEGACY_STORE_FILE = 'locker.json';
const BROWSER_KEY = 'polymux-mobile-vault';

function isTauri(): boolean {
  return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
}

let fileStore: Promise<Store> | null = null;
let migratedStore = false;

function vaultFile(): Promise<Store> {
  fileStore ??= migrateStore();
  return fileStore;
}

async function migrateStore(): Promise<Store> {
  if (!migratedStore) {
    migratedStore = true;
    try {
      const legacy = await load(LEGACY_STORE_FILE, {autoSave: false});
      const carried = await legacy.get<VaultBlob>('vault');
      if (carried) {
        const next = await load(STORE_FILE, {autoSave: true});
        await next.set('vault', carried);
        await next.save();
        return next;
      }
    } catch {
      // A missing legacy store just means a fresh vault.
    }
  }
  return load(STORE_FILE, {autoSave: true});
}

export function createMobileVaultStore(): VaultBlobStore {
  return {
    async load() {
      if (!isTauri()) {
        const raw = localStorage.getItem(BROWSER_KEY);
        if (!raw) return null;
        const parsed = parseVaultBlob(JSON.parse(raw));
        return parsed ? {bytes: decode(parsed.bytes), meta: parsed.meta} : null;
      }
      const store = await vaultFile();
      const blob = parseVaultBlob(await store.get<VaultBlob>('vault'));
      return blob ? {bytes: decode(blob.bytes), meta: blob.meta} : null;
    },
    async save(bytes, meta) {
      const blob: VaultBlob = {bytes: encode(bytes), meta};
      if (!isTauri()) {
        localStorage.setItem(BROWSER_KEY, JSON.stringify(blob));
        return;
      }
      const store = await vaultFile();
      await store.set('vault', blob);
      await store.save();
    },
  };
}

function encode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decode(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

const HOST_CRUD = new Set([
  'vault.create',
  'vault.unlock',
  'vault.lock',
  'vault.list',
  'vault.reveal',
  'vault.totp',
  'vault.codes',
  'vault.otpauth',
  'vault.save',
  'vault.remove',
  'vault.restore',
  'vault.purge',
  'vault.emptyTrash',
  'vault.pin',
  'vault.reorder',
  'vault.changePassword',
  'vault.copy',
  'vault.sync',
  'vault.setStorage',
]);

export function createDeviceVault(options: {
  host?: (method: string, args?: JsonValue[]) => Promise<unknown>;
  online?: () => boolean;
  cloud?: VaultCloudStore | null;
}) {
  const session = new VaultSession(createMobileVaultStore());
  let ready: Promise<void> | null = null;
  let autoFillNeedsRefresh = false;

  function ensure(): Promise<void> {
    ready ??= session.hydrate().then(() => undefined);
    return ready;
  }

  async function syncCloud(): Promise<void> {
    if (!options.cloud?.signedIn()) return;
    const before = session.exportBlob()?.meta.checksum;
    await syncSessionWithCloud(session, options.cloud);
    if (before !== session.exportBlob()?.meta.checksum) autoFillNeedsRefresh = true;
  }

  function overlay(status: ReturnType<VaultSession['status']>) {
    const cloud = options.cloud;
    if (!cloud) return status;
    return {
      ...status,
      sync: {
        ...status.sync,
        signedIn: cloud.signedIn(),
        available: cloud.available(),
      },
    };
  }

  async function syncHost(): Promise<void> {
    if (!options.host || !options.online?.()) return;
    try {
      const remote = parseVaultBlob(await options.host('vault.export'));
      const local = session.exportBlob();
      const plan = planSync(revision(local?.meta ?? null), revision(remote?.meta ?? null));
      if (plan.action === 'pull' && remote) {
        await session.importBlob(remote);
        autoFillNeedsRefresh = true;
      }
      if (plan.action === 'push' && local) await options.host('vault.import', [local as unknown as JsonValue]);
    } catch {
      // Older Hosts or a dropped connection still leave the on-device vault usable.
    }
  }

  async function cacheHost(): Promise<void> {
    if (!options.host || !options.online?.()) return;
    try {
      const remote = parseVaultBlob(await options.host('vault.export'));
      if (remote) await session.importBlob(remote);
    } catch {
      // Keep the last on-device copy.
    }
  }

  async function call(method: string, args: JsonValue[] = []): Promise<unknown> {
    await ensure();
    const live = Boolean(options.host && options.online?.());
    if (live && method === 'vault.status') await syncHost();
    if (live && (HOST_CRUD.has(method) || method === 'vault.status')) {
      try {
        const result = await options.host!(method, args);
        if (method === 'vault.create' || method === 'vault.save' || method === 'vault.remove' || method === 'vault.restore' || method === 'vault.purge' || method === 'vault.emptyTrash' || method === 'vault.pin' || method === 'vault.reorder' || method === 'vault.changePassword' || method === 'vault.setStorage')
          await cacheHost();
        if (method === 'vault.status' && session.status().exists !== (result as {exists?: boolean}).exists)
          await cacheHost();
        if (method === 'vault.unlock') {
          try {
            await session.unlock(String(args[0] ?? ''));
          } catch {
            // Host unlocked; the cached blob can wait until the next export.
          }
        }
        if (method === 'vault.lock') session.lock();
        return result;
      } catch (error) {
        if (!session.status().exists && method !== 'vault.create' && method !== 'vault.status')
          throw error;
      }
    }
    if (!live && options.cloud?.signedIn() && (method === 'vault.status' || method === 'vault.sync' || method === 'vault.unlock')) {
      try {
        if (method === 'vault.unlock' && !session.status().exists) await pullAccountVault(session, options.cloud);
        else await syncCloud();
      } catch (error) {
        if (method === 'vault.unlock' && !session.status().exists) throw error;
      }
    }
    const result = await localCall(method, args);
    if (!live && (method === 'vault.create' || method === 'vault.save' || method === 'vault.remove'))
      await syncCloud().catch(() => {});
    return overlayStatus(result);
  }

  function overlayStatus(result: unknown): unknown {
    if (!result || typeof result !== 'object' || !('sync' in result) || !('exists' in result)) return result;
    return overlay(result as ReturnType<VaultSession['status']>);
  }

  async function localCall(method: string, args: JsonValue[]): Promise<unknown> {
    switch (method) {
      case 'vault.status':
        return overlay(session.status());
      case 'vault.create':
        return session.create(String(args[0] ?? ''));
      case 'vault.unlock':
        return session.unlock(String(args[0] ?? ''));
      case 'vault.lock':
        return session.lock();
      case 'vault.list':
        return session.list();
      case 'vault.reveal':
        return session.reveal(String(args[0] ?? ''));
      case 'vault.totp':
        return session.totp(String(args[0] ?? ''));
      case 'vault.codes':
        return session.codes();
      case 'vault.otpauth':
        return session.otpauth(String(args[0] ?? ''));
      case 'vault.save':
        return session.save((args[0] ?? {}) as unknown as Parameters<VaultSession['save']>[0]);
      case 'vault.remove':
        return session.remove(String(args[0] ?? ''));
      case 'vault.restore':
        return session.restore((Array.isArray(args[0]) ? args[0] : [args[0]]).map(String));
      case 'vault.purge':
        return session.purge((Array.isArray(args[0]) ? args[0] : [args[0]]).map(String));
      case 'vault.emptyTrash':
        return session.emptyTrash();
      case 'vault.pin':
        return session.pin((Array.isArray(args[0]) ? args[0] : [args[0]]).map(String), args[1] === true);
      case 'vault.reorder':
        return session.reorder((Array.isArray(args[0]) ? args[0] : []).map(String));
      case 'vault.changePassword':
        return session.changePassword(String(args[0] ?? ''), String(args[1] ?? ''));
      case 'vault.copy':
        return session.copyText(String(args[0] ?? ''), String(args[1] ?? ''), typeof args[2] === 'number' ? args[2] : undefined);
      case 'vault.sync':
        await syncHost();
        await syncCloud().catch(() => {});
        return overlay(session.status());
      case 'vault.setStorage':
        return session.setStorage(args[0] === 'local' ? 'local' : 'account');
      default:
        throw new Error(`Unsupported vault method: ${method}`);
    }
  }

  return {call: async (method: string, args: JsonValue[] = []) => {
    const result = await call(method, args);
    if (autoFillEnabled() && (autoFillNeedsRefresh || ['vault.unlock', 'vault.save', 'vault.remove', 'vault.restore', 'vault.purge', 'vault.emptyTrash', 'vault.changePassword', 'vault.setStorage'].includes(method))) {
      autoFillNeedsRefresh = false;
      try { await updateAutoFill(call); }
      catch (error) {
        // A failed refresh must not leave a deleted or changed password offered by iOS.
        await disableAutoFill();
        throw new Error(`Vault was updated, but AutoFill needs to be enabled again: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return result;
  }};
}

function revision(meta: VaultMeta | null) {
  return meta
    ? {
        revision: meta.revision,
        updatedAt: meta.updatedAt,
        checksum: meta.checksum,
        dirty: meta.dirty,
        lastSyncedAt: meta.lastSyncedAt,
      }
    : null;
}
