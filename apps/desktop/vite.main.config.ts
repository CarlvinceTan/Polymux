import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {builtinModules} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineConfig, type Alias} from 'vite';

// Resolved from this file rather than the working directory: Electron Forge
// runs from the repo root, a bare `vite` run does not, and the entry is the
// same file either way.
const appRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(appRoot, '..', '..');

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function exportFile(value: unknown): string | undefined {
  return typeof value === 'string' && !value.includes('*') ? value : undefined;
}

/**
 * The account key is inlined into the shipped main bundle, so a server-only
 * `sb_secret_` key must never be accepted in its place.
 */
function assertPublishableSupabaseKey(): void {
  const key = process.env.POLYMUX_SUPABASE_ANON_KEY?.trim() ?? '';
  if (key.startsWith('sb_secret_')) {
    throw new Error(
      'POLYMUX_SUPABASE_ANON_KEY must be the publishable key, not a server-only sb_secret_ key.',
    );
  }
}

assertPublishableSupabaseKey();

/**
 * Exact aliases from each workspace package's `exports` map to its source.
 * Rolldown's Node platform leaves bare specifiers external; a first watch
 * build that then fails to resolve one never calls `closeBundle`, and Forge
 * hangs on "Building main.ts target". Pointing at the file keeps the package
 * in the bundle even before `node_modules/@polymux/*` is linked.
 */
export function workspacePackageAliases(): Alias[] {
  const packagesDir = path.join(projectRoot, 'packages');
  const aliases: Alias[] = [];
  for (const name of readdirSync(packagesDir)) {
    const dir = path.join(packagesDir, name);
    const manifestPath = path.join(dir, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const pkg = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      name?: string;
      exports?: string | Record<string, unknown>;
    };
    if (!pkg.name?.startsWith('@polymux/')) continue;
    const exports = typeof pkg.exports === 'string'
      ? [['.', pkg.exports] as const]
      : Object.entries(pkg.exports ?? {});
    for (const [key, value] of exports) {
      const target = exportFile(value);
      if (!target) continue;
      const spec = key === '.' ? pkg.name : `${pkg.name}/${key.replace(/^\.\//, '')}`;
      aliases.push({
        find: new RegExp(`^${escapeRegExp(spec)}$`),
        replacement: path.join(dir, target),
      });
    }
  }
  return aliases;
}

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
  root: projectRoot,
  resolve: {
    // Rolldown's Node platform externalises bare package specifiers even when
    // they are absent from the explicit external list. Resolve these to files
    // so they are actually included in app.asar.
    alias: [
      {
        find: 'electron-squirrel-startup',
        replacement: path.join(
          projectRoot,
          'node_modules/electron-squirrel-startup/index.js',
        ),
      },
      ...workspacePackageAliases(),
    ],
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
    __POLYMUX_SUPABASE_URL__: JSON.stringify(process.env.POLYMUX_SUPABASE_URL ?? ''),
    __POLYMUX_SUPABASE_ANON_KEY__: JSON.stringify(process.env.POLYMUX_SUPABASE_ANON_KEY ?? ''),
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
