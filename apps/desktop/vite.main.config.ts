import {builtinModules} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';

// Resolved from this file rather than the working directory: Electron Forge
// runs from the repo root, a bare `vite` run does not, and the entry is the
// same file either way.
const appRoot = path.dirname(fileURLToPath(import.meta.url));

/**
 * The main process runs as an ES module inside Electron, where `require` does
 * not exist. Left to itself the bundler inlines Node's builtins and emits a
 * `require()` shim for them, which throws at load ("Calling `require` for
 * child_process in an environment that doesn't expose the `require` function").
 * Declaring the platform as Node — and listing the builtins explicitly —
 * keeps them as real `import ... from "node:..."` statements that Electron
 * resolves at runtime.
 *
 * This has to go through `rolldownOptions`: Vite 8 bundles with Rolldown, and
 * `rollupOptions.external` alone does not reach it.
 *
 * Everything else (the @polymux/* workspace packages and their pure-JS
 * dependencies) is still bundled, so the packaged app needs no node_modules
 * shipped beside it. Nothing here is a native module — `node:sqlite` is a
 * builtin — so there is nothing that must stay unbundled.
 */
export const nodeBuiltins = [
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
  // Node 22 exposes the experimental SQLite module but omits it from
  // `builtinModules`. Without the explicit entry Vite replaces it with its
  // browser-compatibility stub and a packaged app crashes before onboarding.
  'node:sqlite',
];

export default defineConfig({
  resolve: {
    // Rolldown's Node platform externalises bare package specifiers even when
    // they are absent from the explicit external list. Resolve this tiny
    // pure-JS startup shim to its file so it is actually included in app.asar.
    alias: {
      'electron-squirrel-startup': path.join(
        appRoot,
        '../../node_modules/electron-squirrel-startup/index.js',
      ),
    },
  },
  /**
   * Application credentials Polymux ships on the user's behalf, baked in here
   * rather than committed. They identify the app, not the signed-in user, and
   * release builds are required to provide them. A local build may omit them;
   * its affected provider is then shown honestly as unavailable.
   */
  define: {
    __POLYMUX_TELEGRAM_API_ID__: JSON.stringify(process.env.POLYMUX_TELEGRAM_API_ID ?? ''),
    __POLYMUX_TELEGRAM_API_HASH__: JSON.stringify(process.env.POLYMUX_TELEGRAM_API_HASH ?? ''),
    __POLYMUX_GOOGLE_DRIVE_CLIENT_ID__: JSON.stringify(process.env.POLYMUX_GOOGLE_DRIVE_CLIENT_ID ?? ''),
    __POLYMUX_GOOGLE_DRIVE_CLIENT_SECRET__: JSON.stringify(process.env.POLYMUX_GOOGLE_DRIVE_CLIENT_SECRET ?? ''),
    __POLYMUX_DROPBOX_CLIENT_ID__: JSON.stringify(process.env.POLYMUX_DROPBOX_CLIENT_ID ?? ''),
    __POLYMUX_DROPBOX_CLIENT_SECRET__: JSON.stringify(process.env.POLYMUX_DROPBOX_CLIENT_SECRET ?? ''),
    __POLYMUX_ONEDRIVE_CLIENT_ID__: JSON.stringify(process.env.POLYMUX_ONEDRIVE_CLIENT_ID ?? ''),
    __POLYMUX_ONEDRIVE_CLIENT_SECRET__: JSON.stringify(process.env.POLYMUX_ONEDRIVE_CLIENT_SECRET ?? ''),
    __POLYMUX_GOOGLE_MAIL_CLIENT_ID__: JSON.stringify(process.env.POLYMUX_GOOGLE_MAIL_CLIENT_ID ?? ''),
    __POLYMUX_GOOGLE_MAIL_CLIENT_SECRET__: JSON.stringify(process.env.POLYMUX_GOOGLE_MAIL_CLIENT_SECRET ?? ''),
    __POLYMUX_MICROSOFT_MAIL_CLIENT_ID__: JSON.stringify(process.env.POLYMUX_MICROSOFT_MAIL_CLIENT_ID ?? ''),
    __POLYMUX_MICROSOFT_MAIL_CLIENT_SECRET__: JSON.stringify(process.env.POLYMUX_MICROSOFT_MAIL_CLIENT_SECRET ?? ''),
  },
  build: {
    rolldownOptions: {
      platform: 'node',
      // Squirrel's startup shim is pure JavaScript and must be bundled. Forge
      // ships no production node_modules beside app.asar, so externalising it
      // makes every packaged main process fail before creating a window.
      external: ['electron', ...nodeBuiltins],
    },
    lib: {
      entry: path.join(appRoot, 'src/main/main.ts'),
      fileName: () => 'main.js',
      formats: ['es'],
    },
  },
});
