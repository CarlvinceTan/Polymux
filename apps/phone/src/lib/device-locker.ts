import {
  LockerSession,
  parseLockerVaultBlob,
  planSync,
  pullAccountVault,
  syncSessionWithCloud,
  type LockerBlobStore,
  type LockerCloudStore,
  type LockerVaultBlob,
  type VaultMeta,
} from '@polymux/locker';
import {load, type Store} from '@tauri-apps/plugin-store';
import type {JsonValue} from '@polymux/protocol';
import {autoFillEnabled, disableAutoFill, updateAutoFill} from './autofill';

const STORE_FILE = 'locker.json';
const BROWSER_KEY = 'polymux-phone-locker';

function isTauri(): boolean {
  return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
}

let fileStore: Promise<Store> | null = null;

function lockerFile(): Promise<Store> {
  fileStore ??= load(STORE_FILE, {autoSave: true});
  return fileStore;
}

export function createPhoneVaultStore(): LockerBlobStore {
  return {
    async load() {
      if (!isTauri()) {
        const raw = localStorage.getItem(BROWSER_KEY);
        if (!raw) return null;
        const parsed = parseLockerVaultBlob(JSON.parse(raw));
        return parsed ? {bytes: decode(parsed.bytes), meta: parsed.meta} : null;
      }
      const store = await lockerFile();
      const blob = parseLockerVaultBlob(await store.get<LockerVaultBlob>('vault'));
      return blob ? {bytes: decode(blob.bytes), meta: blob.meta} : null;
    },
    async save(bytes, meta) {
      const blob: LockerVaultBlob = {bytes: encode(bytes), meta};
      if (!isTauri()) {
        localStorage.setItem(BROWSER_KEY, JSON.stringify(blob));
        return;
      }
      const store = await lockerFile();
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
  'locker.create',
  'locker.unlock',
  'locker.lock',
  'locker.list',
  'locker.reveal',
  'locker.totp',
  'locker.codes',
  'locker.otpauth',
  'locker.save',
  'locker.remove',
  'locker.restore',
  'locker.purge',
  'locker.emptyTrash',
  'locker.pin',
  'locker.reorder',
  'locker.changePassword',
  'locker.copy',
  'locker.sync',
  'locker.setStorage',
]);

export function createDeviceLocker(options: {
  host?: (method: string, args?: JsonValue[]) => Promise<unknown>;
  online?: () => boolean;
  cloud?: LockerCloudStore | null;
}) {
  const session = new LockerSession(createPhoneVaultStore());
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

  function overlay(status: ReturnType<LockerSession['status']>) {
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
      const remote = parseLockerVaultBlob(await options.host('locker.export'));
      const local = session.exportBlob();
      const plan = planSync(revision(local?.meta ?? null), revision(remote?.meta ?? null));
      if (plan.action === 'pull' && remote) {
        await session.importBlob(remote);
        autoFillNeedsRefresh = true;
      }
      if (plan.action === 'push' && local) await options.host('locker.import', [local as unknown as JsonValue]);
    } catch {
      // Older Hosts or a dropped connection still leave the on-device vault usable.
    }
  }

  async function cacheHost(): Promise<void> {
    if (!options.host || !options.online?.()) return;
    try {
      const remote = parseLockerVaultBlob(await options.host('locker.export'));
      if (remote) await session.importBlob(remote);
    } catch {
      // Keep the last on-device copy.
    }
  }

  async function call(method: string, args: JsonValue[] = []): Promise<unknown> {
    await ensure();
    const live = Boolean(options.host && options.online?.());
    if (live && method === 'locker.status') await syncHost();
    if (live && (HOST_CRUD.has(method) || method === 'locker.status')) {
      try {
        const result = await options.host!(method, args);
        if (method === 'locker.create' || method === 'locker.save' || method === 'locker.remove' || method === 'locker.restore' || method === 'locker.purge' || method === 'locker.emptyTrash' || method === 'locker.pin' || method === 'locker.reorder' || method === 'locker.changePassword' || method === 'locker.setStorage')
          await cacheHost();
        if (method === 'locker.status' && session.status().exists !== (result as {exists?: boolean}).exists)
          await cacheHost();
        if (method === 'locker.unlock') {
          try {
            await session.unlock(String(args[0] ?? ''));
          } catch {
            // Host unlocked; the cached blob can wait until the next export.
          }
        }
        if (method === 'locker.lock') session.lock();
        return result;
      } catch (error) {
        if (!session.status().exists && method !== 'locker.create' && method !== 'locker.status')
          throw error;
      }
    }
    if (!live && options.cloud?.signedIn() && (method === 'locker.status' || method === 'locker.sync' || method === 'locker.unlock')) {
      try {
        if (method === 'locker.unlock' && !session.status().exists) await pullAccountVault(session, options.cloud);
        else await syncCloud();
      } catch (error) {
        if (method === 'locker.unlock' && !session.status().exists) throw error;
      }
    }
    const result = await localCall(method, args);
    if (!live && (method === 'locker.create' || method === 'locker.save' || method === 'locker.remove'))
      await syncCloud().catch(() => {});
    return overlayStatus(result);
  }

  function overlayStatus(result: unknown): unknown {
    if (!result || typeof result !== 'object' || !('sync' in result) || !('exists' in result)) return result;
    return overlay(result as ReturnType<LockerSession['status']>);
  }

  async function localCall(method: string, args: JsonValue[]): Promise<unknown> {
    switch (method) {
      case 'locker.status':
        return overlay(session.status());
      case 'locker.create':
        return session.create(String(args[0] ?? ''));
      case 'locker.unlock':
        return session.unlock(String(args[0] ?? ''));
      case 'locker.lock':
        return session.lock();
      case 'locker.list':
        return session.list();
      case 'locker.reveal':
        return session.reveal(String(args[0] ?? ''));
      case 'locker.totp':
        return session.totp(String(args[0] ?? ''));
      case 'locker.codes':
        return session.codes();
      case 'locker.otpauth':
        return session.otpauth(String(args[0] ?? ''));
      case 'locker.save':
        return session.save((args[0] ?? {}) as unknown as Parameters<LockerSession['save']>[0]);
      case 'locker.remove':
        return session.remove(String(args[0] ?? ''));
      case 'locker.restore':
        return session.restore((Array.isArray(args[0]) ? args[0] : [args[0]]).map(String));
      case 'locker.purge':
        return session.purge((Array.isArray(args[0]) ? args[0] : [args[0]]).map(String));
      case 'locker.emptyTrash':
        return session.emptyTrash();
      case 'locker.pin':
        return session.pin((Array.isArray(args[0]) ? args[0] : [args[0]]).map(String), args[1] === true);
      case 'locker.reorder':
        return session.reorder((Array.isArray(args[0]) ? args[0] : []).map(String));
      case 'locker.changePassword':
        return session.changePassword(String(args[0] ?? ''), String(args[1] ?? ''));
      case 'locker.copy':
        return session.copyText(String(args[0] ?? ''), String(args[1] ?? ''), typeof args[2] === 'number' ? args[2] : undefined);
      case 'locker.sync':
        await syncHost();
        await syncCloud().catch(() => {});
        return overlay(session.status());
      case 'locker.setStorage':
        return session.setStorage(args[0] === 'local' ? 'local' : 'account');
      default:
        throw new Error(`Unsupported locker method: ${method}`);
    }
  }

  return {call: async (method: string, args: JsonValue[] = []) => {
    const result = await call(method, args);
    if (autoFillEnabled() && (autoFillNeedsRefresh || ['locker.unlock', 'locker.save', 'locker.remove', 'locker.restore', 'locker.purge', 'locker.emptyTrash', 'locker.changePassword', 'locker.setStorage'].includes(method))) {
      autoFillNeedsRefresh = false;
      try { await updateAutoFill(call); }
      catch (error) {
        // A failed refresh must not leave a deleted or changed password offered by iOS.
        await disableAutoFill();
        throw new Error(`Locker was updated, but AutoFill needs to be enabled again: ${error instanceof Error ? error.message : String(error)}`);
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
