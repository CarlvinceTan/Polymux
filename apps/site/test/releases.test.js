import assert from 'node:assert/strict';
import test from 'node:test';
import windowsHandler from '../api/updates/win32/x64/RELEASES.js';
import linuxHandler from '../api/updates/linux/x64/latest-linux.yml.js';

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    send(value) { this.body = value; return this; },
  };
}

test('serves a Squirrel.Windows manifest with absolute GitHub asset URLs', async (context) => {
  const assets = [
    {name: 'RELEASES', browser_download_url: 'https://files/RELEASES'},
    {name: 'polymux_desktop-0.3.0-full.nupkg', browser_download_url: 'https://files/full.nupkg'},
  ];
  context.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).endsWith('/releases/latest')) {
      return {ok: true, json: async () => ({assets})};
    }
    return {ok: true, text: async () => 'ABC polymux_desktop-0.3.0-full.nupkg 123\r\n'};
  });

  const result = response();
  await windowsHandler({}, result);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body, 'ABC https://files/full.nupkg 123\n');
  assert.equal(result.headers['Content-Type'], 'text/plain; charset=utf-8');
});

test('serves Linux updater metadata with an absolute AppImage URL', async (context) => {
  const assets = [
    {name: 'latest-linux.yml', browser_download_url: 'https://files/latest-linux.yml'},
    {name: 'Polymux-0.3.0-x86_64.AppImage', browser_download_url: 'https://files/Polymux.AppImage'},
  ];
  context.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).endsWith('/releases/latest')) {
      return {ok: true, json: async () => ({assets})};
    }
    return {
      ok: true,
      text: async () => 'version: 0.3.0\nfiles:\n  - url: Polymux-0.3.0-x86_64.AppImage\n    sha512: abc\n    size: 123\n',
    };
  });

  const result = response();
  await linuxHandler({}, result);
  assert.equal(result.statusCode, 200);
  assert.match(result.body, /url: https:\/\/files\/Polymux\.AppImage/);
});
