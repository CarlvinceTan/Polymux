import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';

const bundle = await build({
  entryPoints: ['apps/desktop/src/main/backend/settings.ts'], bundle: true,
  write: false, platform: 'node', format: 'esm',
  plugins: [{name: 'settings-without-electron', setup(builder) {
    builder.onResolve({filter: /^(electron|\.\.\/browser\/favicon\.js)$/}, args => ({path: args.path, namespace: 'fixture'}));
    builder.onLoad({filter: /.*/, namespace: 'fixture'}, args => ({
      contents: args.path === 'electron'
        ? 'export const app = {getPath: () => "/Downloads"}; export const nativeTheme = {themeSource: "light"};'
        : 'export const clearFaviconCache = () => {};',
    }));
  }}],
});
const settings = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString('base64')}`);

test('retired permission switches cannot hide a granted OS capability', () => {
  const current = settings.generalSettingsPreference({
    permissions: {microphone: false, accessibility: false, 'screen-recording': false, calendars: false},
    appPermissionsEnabled: false, timeEnabled: false, locationEnabled: false,
  });
  assert.ok(Object.values(current.permissions).every(value => value === true));
  assert.equal(Object.hasOwn(current, 'appPermissionsEnabled'), false);
  assert.equal(current.timeEnabled, false);
  assert.equal(current.locationEnabled, false);
});

test('settings updates keep OS grants authoritative while retaining sharing choices', () => {
  const current = settings.generalSettingsPreference({});
  const updated = settings.generalSettingsUpdate({
    permissions: {microphone: false}, appPermissionsEnabled: false,
    timeEnabled: false, locationEnabled: false,
  }, current);
  assert.ok(Object.values(updated.permissions).every(value => value === true));
  assert.equal(Object.hasOwn(updated, 'appPermissionsEnabled'), false);
  assert.equal(updated.timeEnabled, false);
  assert.equal(updated.locationEnabled, false);
});
