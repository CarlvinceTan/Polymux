import {builtinModules} from 'node:module';
import {defineConfig} from 'vite';

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
 * Everything else (the @midas/* workspace packages and their pure-JS
 * dependencies) is still bundled, so the packaged app needs no node_modules
 * shipped beside it. Nothing here is a native module — `node:sqlite` is a
 * builtin — so there is nothing that must stay unbundled.
 */
const nodeBuiltins = [
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
];

export default defineConfig({
  build: {
    rolldownOptions: {
      platform: 'node',
      external: ['electron', 'electron-squirrel-startup', ...nodeBuiltins],
    },
    lib: {
      entry: 'src/main/main.ts',
      fileName: () => 'main.js',
      formats: ['es'],
    },
  },
});
