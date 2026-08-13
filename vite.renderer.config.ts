import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';
import {svelte} from '@sveltejs/vite-plugin-svelte';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

// The renderer's own root is `src/renderer`, so any relative `outDir` — including
// the one Electron Forge's Vite plugin supplies — resolves against that folder
// rather than the project. Forge only packages the project-level `.vite`, so a
// relative path silently builds the renderer somewhere the packaged app can
// never load it. Pinning the absolute path keeps both builds writing to the
// same place.
export default defineConfig({
  root: 'src/renderer',
  plugins: [svelte()],
  build: {
    outDir: path.join(projectRoot, '.vite/renderer/main_window'),
    emptyOutDir: true,
    // Provider logos are globbed wholesale so any model maker resolves to its
    // real mark, but almost none are used in a given session. Inlining them as
    // data URIs put every one in the entry chunk and quadrupled it (416kB ->
    // 1.9MB); emitted as files they cost a local disk read only when shown.
    // Everything else keeps Vite's default inlining.
    assetsInlineLimit: (filePath) => (filePath.includes('icons-static-svg') ? false : undefined),
  },
});
