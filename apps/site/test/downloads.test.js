import assert from 'node:assert/strict';
import test from 'node:test';
import handler from '../api/downloads.js';

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

test('maps the latest release to native installers for each platform', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => ({
      tag_name: 'v0.3.0',
      published_at: '2026-08-23T00:00:00Z',
      html_url: 'https://github.com/CarlvinceTan/Polymux/releases/tag/v0.3.0',
      assets: [
        {name: 'Polymux-0.3.0-arm64.dmg', browser_download_url: 'https://files/mac', size: 1},
        {name: 'Polymux-0.3.0-Setup.exe', browser_download_url: 'https://files/windows', size: 2},
        {name: 'Polymux-0.3.0-x86_64.AppImage', browser_download_url: 'https://files/appimage', size: 3},
      ],
    }),
  }));
  const result = response();
  await handler({}, result);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.version, '0.3.0');
  assert.equal(result.body.platforms.macos.url, 'https://files/mac');
  assert.equal(result.body.platforms.windows.url, 'https://files/windows');
  assert.equal(result.body.platforms.linux.url, 'https://files/appimage');
});

test('returns a bounded unavailable response before the first public release', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => ({ok: false}));
  const result = response();
  await handler({}, result);
  assert.equal(result.statusCode, 503);
  assert.deepEqual(result.body, {error: 'No public Polymux release is available yet.'});
  assert.equal(result.headers['Cache-Control'], 'no-store');
});
