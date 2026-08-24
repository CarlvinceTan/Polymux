import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';
import {svelte} from '@sveltejs/vite-plugin-svelte';

const appRoot = path.dirname(fileURLToPath(import.meta.url));
// node_modules, the shared packages and the .vite output all live at the repo
// root, two levels up from apps/desktop.
const projectRoot = path.join(appRoot, '..', '..');

// This config is served two ways: by Electron Forge for the app itself, and by
// a bare `vite` for working on the renderer in a browser. Forge merges its own
// settings over it (`base`, `resolve.preserveSymlinks`, its expose-renderer
// plugin), so the two disagree about the dependency optimizer's config hash —
// and sharing one cache directory, each start invalidates the other's. Vite
// answers that by re-optimizing and *full-reloading the page*, which lands on
// top of the startup splash and restarts it. A cache per driver keeps them out
// of each other's way, so a launch loads once.
const forgeDriven = process.argv.some((argument) => argument.includes('electron-forge'));

// The renderer's own root is `src/renderer`, so any relative `outDir` — including
// the one Electron Forge's Vite plugin supplies — resolves against that folder
// rather than the project. Forge only packages the project-level `.vite`, so a
// relative path silently builds the renderer somewhere the packaged app can
// never load it. Pinning the absolute path keeps both builds writing to the
// same place.
export default defineConfig({
  root: path.join(appRoot, 'src/renderer'),
  cacheDir: path.join(projectRoot, 'node_modules', forgeDriven ? '.vite-app' : '.vite-web'),
  plugins: [svelte()],
  // Forge merges `resolve.preserveSymlinks: true`, which makes the workspace's
  // own packages resolve through node_modules. Vite serves anything under
  // node_modules with a `?v=<hash>` query and `Cache-Control: immutable`, and
  // that hash only changes when the lockfile or the optimizer's config does —
  // never when packages/* is edited. So adding an export to @polymux/protocol
  // left the renderer holding a year-long cached copy without it, dying at
  // module load with "does not provide an export" and painting nothing. It
  // survived restarts because the staleness lived in the browser's HTTP cache
  // rather than in Vite's, which is why clearing cacheDir only fixed it until
  // the hash was reused again.
  //
  // Pointing the specifier straight at the source defeats all of it: the module
  // is project source, served `no-cache` and revalidated on every load, watched
  // for edits like any other file. `optimizeDeps.exclude` cannot substitute —
  // it stops the prebundling but not the immutable caching.
  resolve: {
    alias: {
      '@polymux/protocol': path.join(projectRoot, 'packages/protocol/src/index.ts'),
    },
  },
  build: {
    outDir: path.join(projectRoot, '.vite/renderer/main_window'),
    emptyOutDir: true,
    // The only chunk above Vite's default 500k warning is the already-lazy
    // Three.js voice renderer (~531k); keep warnings meaningful for regressions.
    chunkSizeWarningLimit: 550,
    // Keep the initial renderer cacheable in smaller pieces. Most workspace
    // surfaces are statically reachable from App, so dynamic-import splitting
    // alone otherwise leaves a multi-megabyte entry chunk.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{name: 'renderer', tags: ['$initial'], maxSize: 450_000}],
        },
      },
    },
    // Provider logos are globbed wholesale so any model maker resolves to its
    // real mark, but almost none are used in a given session. Inlining them as
    // data URIs put every one in the entry chunk and quadrupled it (416kB ->
    // 1.9MB); emitted as files they cost a local disk read only when shown.
    // Everything else keeps Vite's default inlining.
    assetsInlineLimit: (filePath) => (filePath.includes('icons-static-svg') ? false : undefined),
  },
});
