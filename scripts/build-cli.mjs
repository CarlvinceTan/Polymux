import {copyFile} from "node:fs/promises";
import {build} from "esbuild";
import {loadEnv} from 'vite';
import {piTuiFixes} from './pi-tui-fixes.mjs';

const account = loadEnv('production', process.cwd(), 'POLYMUX_SUPABASE_');

await build({
  entryPoints: ["apps/cli/src/index.ts"],
  bundle: true,
  plugins: [piTuiFixes],
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: "apps/cli/dist/polymux.mjs",
  define: {
    __POLYMUX_CLI_SUPABASE_URL__: JSON.stringify(process.env.POLYMUX_SUPABASE_URL ?? account.POLYMUX_SUPABASE_URL ?? ''),
    __POLYMUX_CLI_SUPABASE_ANON_KEY__: JSON.stringify(process.env.POLYMUX_SUPABASE_ANON_KEY ?? account.POLYMUX_SUPABASE_ANON_KEY ?? ''),
  },
  banner: {
    js: "import {createRequire as __polymuxCreateRequire} from 'node:module'; const require = __polymuxCreateRequire(import.meta.url);",
  },
});

await copyFile("node_modules/grok-mermaid/LICENSE", "apps/cli/dist/LICENSE.grok-mermaid.txt");

await build({
  entryPoints: ['apps/desktop/src/main/usage/usage-worker.ts'],
  bundle: true, platform: 'node', format: 'esm', target: 'node22',
  outfile: 'apps/cli/dist/usage-worker.js',
  banner: {js: "import {createRequire as __polymuxUsageRequire} from 'node:module'; const require = __polymuxUsageRequire(import.meta.url);"},
});
