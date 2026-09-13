import {fetch as nativeFetch} from '@tauri-apps/plugin-http';
import {load, type Store} from '@tauri-apps/plugin-store';
import {createPhoneAccountStorage, isApplePhone} from './account';
import {
  HOST_PAIRING_CODE_LENGTH,
  isHostPairingCode,
  sanitizeHostPairingCodeInput,
  hostRelayCodePairEndpoint,
  hostRelayPublicEndpoint,
  type JsonValue,
} from '@polymux/protocol';

const CONNECTION_KEY = 'active';
const DEVICE_KEY = 'device-id';
const BROWSER_STORE_KEY = 'polymux-phone-connection';

export interface SavedConnection {
  accountUserId?: string;
  endpoint: string;
  secret: string;
  hostId: string;
  deviceName: string;
  phoneId: string;
  pairedAt: string;
}

export async function pairAccountHost(host: import('./account-devices').AccountHost): Promise<SavedConnection> {
  const {availableAccountHosts} = await import('./account-devices');
  if (!availableAccountHosts([host], host.user_id).length) throw new Error('This account device is no longer available.');
  const phoneId = await getOrCreateDeviceId();
  const response = await transport()(`${host.public_endpoint}/polymux-host/v1/pair`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({accountSecret: host.pairing_secret, desktopId: phoneId, deviceName: phoneDeviceName(), deviceType: phoneDeviceType()}),
    signal: AbortSignal.timeout(12_000),
  });
  const value = await response.json() as PairResponse;
  if (!response.ok) throw new Error(value.error ?? 'Your device could not be connected.');
  if (value.hostId !== host.host_id || !value.secret || !/^[\w-]{43}$/.test(value.secret)) throw new Error('The device returned an invalid pairing identity.');
  const connection: SavedConnection = {
    endpoint: host.public_endpoint, hostId: host.host_id, secret: value.secret,
    phoneId, deviceName: host.device_name, pairedAt: value.pairedAt ?? new Date().toISOString(), accountUserId: host.user_id,
  };
  await saveConnection(connection);
  return connection;
}

export interface HostHealth {
  ok: boolean;
  hostId: string;
  deviceName: string;
  paired: boolean;
  apiVersion?: number;
  capabilities?: string[];
}

type FetchLike = typeof fetch;

let connectionStore: Promise<Store> | null = null;

function isTauri(): boolean {
  return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
}

function transport(): FetchLike {
  return (isTauri() ? nativeFetch : globalThis.fetch).bind(globalThis) as FetchLike;
}

function store(): Promise<Store> {
  connectionStore ??= load('connection.json', {autoSave: true});
  return connectionStore;
}

export function normalizeEndpoint(value: string): string {
  const input = value.trim();
  if (!input) throw new Error('Enter the Host address shown by Polymux Desktop.');
  const withScheme = /^https?:\/\//i.test(input)
    ? input
    : `https://${input}`;
  const url = new URL(withScheme);
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('The Host address must use HTTP or HTTPS.');
  if (url.protocol === 'https:' && url.hostname.toLowerCase() !== 'connect.polymux.com')
    throw new Error('Use the connect.polymux.com address shown by the Host.');
  if (url.protocol === 'http:' && !plainHttpHost(url.hostname))
    throw new Error('Use the secure Polymux Connect address shown by the Host.');
  if (url.username || url.password) throw new Error('Do not put credentials in the Host address.');
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function plainHttpHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true;
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
    return false;
  return parts[0] === 127;
}

export async function hostHealth(endpoint: string): Promise<HostHealth> {
  const response = await transport()(`${normalizeEndpoint(endpoint)}/polymux-host/v1/health`, {
    method: 'GET',
    signal: AbortSignal.timeout(8_000),
  });
  const value = await response.json() as HostHealth & {error?: string};
  if (!response.ok) throw new Error(value.error ?? `The Host returned ${response.status}.`);
  return value;
}

export async function pairHost(endpointInput: string, codeInput: string, onPending?: (number: string) => void, signal?: AbortSignal): Promise<SavedConnection> {
  const endpoint = normalizeEndpoint(endpointInput);
  const code = pairingCode(codeInput);
  const phoneId = await getOrCreateDeviceId();
  const value = await requestPair(`${endpoint}/polymux-host/v1/pair`, code, phoneId, onPending, signal);
  return persistPairing(value, endpoint, phoneId);
}

export async function pairHostByCode(
  codeInput: string,
  relayOrigin = 'https://connect.polymux.com',
  onPending?: (number: string) => void,
  signal?: AbortSignal,
): Promise<SavedConnection> {
  const code = pairingCode(codeInput);
  const phoneId = await getOrCreateDeviceId();
  const value = await requestPair(hostRelayCodePairEndpoint(relayOrigin), code, phoneId, onPending, signal);
  if (!value.hostId) throw new Error('The Host returned an incomplete identity.');
  return persistPairing(value, hostRelayPublicEndpoint(relayOrigin, value.hostId), phoneId);
}

async function requestPair(url: string, code: string, phoneId: string, onPending?: (number: string) => void, signal?: AbortSignal): Promise<PairResponse> {
  const response = await transport()(url, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({code, desktopId: phoneId, deviceName: phoneDeviceName(), deviceType: phoneDeviceType()}),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000),
  });
  const value = await response.json() as PairResponse;
  if (!response.ok)
    throw new Error(value.error ?? `Pairing failed (${response.status}).`);
  if (response.status !== 202 || !value.endpoint || !value.id || !value.token || !value.number || !value.expiresAt)
    throw new Error('The other device must support connection approval.');
  const endpoint = normalizeEndpoint(value.endpoint);
  onPending?.(value.number);
  try {
    while (Date.now() < Date.parse(value.expiresAt)) {
      signal?.throwIfAborted();
      await new Promise(resolve => setTimeout(resolve, 1000));
      const result = await transport()(`${endpoint}/polymux-host/v1/pair/status`, {
        method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({id: value.id, token: value.token}),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
      });
      const state = await result.json() as {status: string; credentials?: PairResponse; error?: string};
      if (!result.ok) throw new Error(state.error ?? 'Pairing expired.');
      if (state.status === 'rejected') throw new Error('Connection declined or number did not match.');
      if (state.status === 'approved') {
        if (!state.credentials?.secret || state.credentials.hostId !== value.hostId) throw new Error('Device identity changed during pairing.');
        return {...state.credentials, acknowledgement: {endpoint, id: value.id, token: value.token}};
      }
    }
    throw new Error('Connection expired. Try again.');
  } catch (error) {
    await transport()(`${endpoint}/polymux-host/v1/pair/cancel`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({id: value.id, token: value.token}), signal: AbortSignal.timeout(4000)}).catch(() => {});
    throw error;
  }
}

interface PairResponse {
  acknowledgement?: {endpoint: string; id: string; token: string};
  endpoint?: string; id?: string; token?: string; number?: string; expiresAt?: string;
  hostId?: string;
  deviceName?: string;
  pairedAt?: string;
  secret?: string;
  error?: string;
}

async function persistPairing(value: PairResponse, endpoint: string, phoneId: string): Promise<SavedConnection> {
  const connection: SavedConnection = {
    endpoint,
    secret: value.secret!,
    hostId: value.hostId!,
    deviceName: value.deviceName || 'Polymux Host',
    phoneId,
    pairedAt: value.pairedAt || new Date().toISOString(),
  };
  await saveConnection(connection);
  if (value.acknowledgement) {
    const {endpoint: pairedEndpoint, id, token} = value.acknowledgement;
    await transport()(`${pairedEndpoint}/polymux-host/v1/pair/ack`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({id, token}), signal: AbortSignal.timeout(4000)}).catch(() => {});
  }
  return connection;
}

function pairingCode(value: string): string {
  const code = sanitizeHostPairingCodeInput(value);
  if (!isHostPairingCode(code))
    throw new Error(`Enter the ${HOST_PAIRING_CODE_LENGTH}-character connect code.`);
  return code;
}

export async function rpc<T>(
  connection: SavedConnection,
  method: string,
  args: JsonValue[] = [],
): Promise<T> {
  const response = await transport()(`${connection.endpoint}/polymux-host/v1/rpc`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${connection.secret}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({method, args, deviceType: phoneDeviceType()}),
    signal: AbortSignal.timeout(method === 'runs.events' ? 15_000 : 30_000),
  });
  const value = await response.json() as {result?: T; error?: string};
  if (!response.ok) {
    const error = new Error(value.error ?? `The Host returned ${response.status}.`);
    if (response.status === 401) error.name = 'AuthenticationError';
    throw error;
  }
  return value.result as T;
}

export async function loadConnection(): Promise<SavedConnection | null> {
  if (isApplePhone()) {
    const secure = createPhoneAccountStorage();
    const value = await secure.getItem('polymux-account:phone-connection');
    if (value) return JSON.parse(value) as SavedConnection;
    const legacy = await store();
    const connection = await legacy.get<SavedConnection>(CONNECTION_KEY);
    if (connection) {
      await secure.setItem('polymux-account:phone-connection', JSON.stringify(connection));
      await legacy.delete(CONNECTION_KEY);
      await legacy.save();
    }
    return connection ?? null;
  }
  if (!isTauri()) {
    const value = localStorage.getItem(BROWSER_STORE_KEY);
    return value ? JSON.parse(value) as SavedConnection : null;
  }
  const target = await store();
  return (await target.get<SavedConnection>(CONNECTION_KEY)) ?? null;
}

export async function saveConnection(connection: SavedConnection): Promise<void> {
  if (isApplePhone()) {
    await createPhoneAccountStorage().setItem('polymux-account:phone-connection', JSON.stringify(connection));
    const legacy = await store();
    await legacy.delete(CONNECTION_KEY);
    await legacy.save();
    return;
  }
  if (!isTauri()) {
    localStorage.setItem(BROWSER_STORE_KEY, JSON.stringify(connection));
    return;
  }
  const target = await store();
  await target.set(CONNECTION_KEY, connection);
  await target.save();
}

export async function clearConnection(): Promise<void> {
  if (isApplePhone()) {
    await createPhoneAccountStorage().removeItem('polymux-account:phone-connection');
    const legacy = await store();
    await legacy.delete(CONNECTION_KEY);
    await legacy.save();
    return;
  }
  if (!isTauri()) {
    localStorage.removeItem(BROWSER_STORE_KEY);
    return;
  }
  const target = await store();
  await target.delete(CONNECTION_KEY);
  await target.save();
}

async function getOrCreateDeviceId(): Promise<string> {
  if (!isTauri()) {
    const stored = localStorage.getItem(DEVICE_KEY);
    if (stored) return stored;
    const created = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, created);
    return created;
  }
  const target = await store();
  const stored = await target.get<string>(DEVICE_KEY);
  if (stored) return stored;
  const created = crypto.randomUUID();
  await target.set(DEVICE_KEY, created);
  await target.save();
  return created;
}

function phoneDeviceName(): string {
  if (typeof navigator === 'undefined') return 'Polymux Phone';
  if (/iPad/i.test(navigator.userAgent)) return 'Polymux on iPad';
  if (/iPhone|iPod/i.test(navigator.userAgent)) return 'Polymux on iPhone';
  if (/Android/i.test(navigator.userAgent)) return 'Polymux on Android';
  return 'Polymux Phone';
}

export function phoneDeviceType(userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent, touchPoints = typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints): 'phone' | 'tablet' {
  return /iPad|Tablet/i.test(userAgent) || /Macintosh/.test(userAgent) && touchPoints > 1 || /Android/.test(userAgent) && !/Mobile/.test(userAgent) ? 'tablet' : 'phone';
}
