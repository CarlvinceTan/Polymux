import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {defineConfig} from 'vite';
import {svelte} from '@sveltejs/vite-plugin-svelte';

const mobileHost = process.env.TAURI_DEV_HOST;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  envDir: repoRoot,
  envPrefix: ['VITE_', 'POLYMUX_SUPABASE_URL', 'POLYMUX_SUPABASE_ANON_KEY'],
  server: {
    host: mobileHost || '0.0.0.0',
    port: 1420,
    strictPort: true,
    hmr: mobileHost
      ? {protocol: 'ws', host: mobileHost, port: 1421}
      : undefined,
    watch: {ignored: ['**/src-tauri/**']},
  },
  build: {
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari15',
    minify: process.env.TAURI_ENV_DEBUG ? false : 'esbuild',
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
  },
});
