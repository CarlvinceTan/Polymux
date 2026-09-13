import assert from 'node:assert/strict';
import test from 'node:test';
import {normalizeEndpoint, pairHostByCode, phoneDeviceType} from './host.js';

test('Host endpoints default to HTTPS and allow cleartext loopback only', () => {
  assert.equal(
    normalizeEndpoint('connect.polymux.com/h/86c92dd5-5042-4aa4-a33f-b656bf641e28'),
    'https://connect.polymux.com/h/86c92dd5-5042-4aa4-a33f-b656bf641e28',
  );
  assert.equal(normalizeEndpoint('http://127.0.0.1:47680'), 'http://127.0.0.1:47680');
  assert.throws(() => normalizeEndpoint('https://host.example.test/path/'), /connect\.polymux\.com/);
  assert.throws(() => normalizeEndpoint('http://host.example.test'), /secure Polymux Connect/);
  assert.throws(() => normalizeEndpoint('http://100.90.80.70:47680'), /secure Polymux Connect/);
  assert.throws(() => normalizeEndpoint('http://192.168.1.20:47680'), /secure Polymux Connect/);
});

test('connect code pairs through the Polymux domain and saves the stable Host endpoint', async () => {
  const values = new Map<string, string>();
  const originalFetch = globalThis.fetch;
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith('/pair/ack')) return Response.json({ok: true});
    if (String(input).endsWith('/pair/status')) return Response.json({status: 'approved', credentials: {
      hostId: '86c92dd5-5042-4aa4-a33f-b656bf641e28', deviceName: 'Test Mac', secret: 'paired-secret-that-is-long-enough-for-use',
    }});
    assert.equal(String(input), 'https://connect.polymux.com/connect');
    assert.equal(init?.method, 'POST');
    const body = JSON.parse(String(init?.body)) as {code: string; desktopId: string};
    assert.equal(body.code, '318204771');
    assert.ok(body.desktopId);
    return Response.json({
      status: 'pending', id: 'request', token: 'temporary-session', number: '42', expiresAt: new Date(Date.now()+60000).toISOString(),
      endpoint: 'https://connect.polymux.com/h/86c92dd5-5042-4aa4-a33f-b656bf641e28',
      hostId: '86c92dd5-5042-4aa4-a33f-b656bf641e28',
      deviceName: 'Carlvince’s Mac',
      pairedAt: '2026-08-31T10:00:00.000Z',
    }, {status: 202});
  };

  try {
    let confirmation = '';
    const paired = await pairHostByCode('318 204 771', undefined, number => confirmation = number);
    assert.equal(confirmation, '42');
    assert.equal(
      paired.endpoint,
      'https://connect.polymux.com/h/86c92dd5-5042-4aa4-a33f-b656bf641e28',
    );
    assert.equal(paired.secret, 'paired-secret-that-is-long-enough-for-use');
    assert.equal(JSON.parse(values.get('polymux-phone-connection') ?? '{}').hostId, paired.hostId);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('an old immediate-grant response and a cancelled request never save a connection', async () => {
  const originalFetch = globalThis.fetch;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const saved: string[] = [];
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {getItem: () => 'test-device', setItem: (key: string) => saved.push(key)}});
  try {
    globalThis.fetch = async () => Response.json({hostId: 'device', secret: 'old-automatic-secret'});
    await assert.rejects(pairHostByCode('123456789'), /support connection approval/);
    const controller = new AbortController(); let cancelled = false;
    globalThis.fetch = async input => {
      if (String(input).endsWith('/pair/cancel')) { cancelled = true; return Response.json({ok: true}); }
      return Response.json({hostId: 'device', endpoint: 'https://connect.polymux.com/h/device', id: 'pending', token: 'temporary', number: '42', expiresAt: new Date(Date.now()+60000).toISOString()}, {status: 202});
    };
    await assert.rejects(pairHostByCode('123456789', undefined, () => controller.abort(), controller.signal));
    assert.equal(cancelled, true);
    assert.equal(saved.includes('polymux-phone-connection'), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('phone metadata distinguishes phones, Android tablets and iPad desktop-mode browsers', () => {
  assert.equal(phoneDeviceType('iPhone', 5), 'phone');
  assert.equal(phoneDeviceType('Android Mobile', 5), 'phone');
  assert.equal(phoneDeviceType('Android', 5), 'tablet');
  assert.equal(phoneDeviceType('iPad', 5), 'tablet');
  assert.equal(phoneDeviceType('Macintosh', 5), 'tablet');
});
