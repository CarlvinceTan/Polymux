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
const nodeBuiltins = [
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
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
   * rather than committed. Unset in a normal checkout, which is the point: a
   * build without them falls back to asking the user for their own pair, so
   * nothing breaks, it just asks. Release builds set them in the environment.
   */
  define: {
    __POLYMUX_TELEGRAM_API_ID__: JSON.stringify(process.env.POLYMUX_TELEGRAM_API_ID ?? ''),
    __POLYMUX_TELEGRAM_API_HASH__: JSON.stringify(process.env.POLYMUX_TELEGRAM_API_HASH ?? ''),
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
