/**
 * Application credentials Polymux registers once and ships, so the user does
 * not have to register one of their own before they can sign in.
 *
 * These are *app* identities, not user credentials: they say "mautrix-telegram
 * running inside Polymux" to the network, and grant nothing on their own. The
 * user still authenticates as themselves afterwards, by QR or by code, and
 * that is what produces a session.
 *
 * The tradeoff is deliberate and worth stating plainly, because it is the
 * reason this file did not exist for a long time: one registration carries
 * every install's traffic. Networks rate-limit and ban exactly that pattern,
 * and when it goes it goes for everybody at once, fixable only by shipping a
 * new build. What it buys is the difference between "scan this QR" and "go
 * register an application on another website first", which is the difference
 * between a user linking Telegram and a user giving up.
 *
 * A user who supplies their own pair still wins: values recorded in a bridge's
 * own config always take precedence over these.
 *
 * Nothing here is committed. The values are injected at build time from the
 * environment (see `vite.main.config.ts`), and an unset key leaves the network
 * exactly as it was before this file — asking the user for their own pair.
 */

import {readFile, writeFile, mkdir} from "node:fs/promises";
import path from "node:path";

declare const __POLYMUX_TELEGRAM_API_ID__: string | undefined;
declare const __POLYMUX_TELEGRAM_API_HASH__: string | undefined;

/**
 * Build-time value first, then the ambient environment. The environment is the
 * development path: `tsx` and the tests run this module unbundled, where the
 * `__…__` globals were never substituted.
 */
function injected(bundled: string | undefined, variable: string): string {
  return (bundled ?? "") || (process.env[variable] ?? "");
}

/**
 * `network:` values written into a bridge's config when the user has not
 * supplied their own. Keyed by platform; an empty entry means the platform
 * still asks.
 */
export function shippedNetworkConfig(platform: string): Readonly<Record<string, string>> {
  const served = remote[platform];
  if (served) return served;
  if (platform !== "telegram") return {};
  const apiId = injected(
    typeof __POLYMUX_TELEGRAM_API_ID__ === "undefined" ? undefined : __POLYMUX_TELEGRAM_API_ID__,
    "POLYMUX_TELEGRAM_API_ID",
  );
  const apiHash = injected(
    typeof __POLYMUX_TELEGRAM_API_HASH__ === "undefined" ? undefined : __POLYMUX_TELEGRAM_API_HASH__,
    "POLYMUX_TELEGRAM_API_HASH",
  );
  // Half a pair is no pair: Telegram rejects the login and the bridge dies on
  // startup, which is a worse outcome than the setup form it replaced.
  if (!apiId || !apiHash) return {};
  return {api_id: apiId, api_hash: apiHash};
}

/**
 * The pair served from the update host, which outranks the built-in one.
 *
 * This exists for one failure: a network bans the shipped registration. Baked
 * into the bundle, the fix is a release — build, notarise, and wait for every
 * machine to update, with Telegram dead for all of them meanwhile. Served from
 * the same bucket the update feed already lives in, the fix is overwriting one
 * small file, and machines pick it up on their next launch.
 *
 * It is emphatically not a config channel. The only thing it can say is which
 * application a bridge identifies itself as, and `readPairs` refuses anything
 * that is not exactly that.
 */
let remote: Record<string, Readonly<Record<string, string>>> = {};

/** Where the last good document is kept, so a launch offline still has it. */
function cachePath(directory: string): string {
  return path.join(directory, "shipped-credentials.json");
}

/**
 * Shapes accepted from the served document, deliberately narrow. A value that
 * is merely a string is not enough: these are written into a bridge's config
 * file, so anything that could carry YAML structure, a path, or a shell
 * fragment out of a network response and into that file is rejected here.
 */
const PAIR_RULES: Record<string, Record<string, RegExp>> = {
  telegram: {api_id: /^[0-9]{1,12}$/, api_hash: /^[a-zA-Z0-9]{8,64}$/},
};

/** Every platform/key pair in `document` that matches its rule, and nothing else. */
export function readPairs(document: unknown): Record<string, Record<string, string>> {
  if (typeof document !== "object" || document === null) return {};
  const out: Record<string, Record<string, string>> = {};
  for (const [platform, rules] of Object.entries(PAIR_RULES)) {
    const entry = (document as Record<string, unknown>)[platform];
    if (typeof entry !== "object" || entry === null) continue;
    const values: Record<string, string> = {};
    for (const [key, rule] of Object.entries(rules)) {
      const value = (entry as Record<string, unknown>)[key];
      if (typeof value !== "string" || !rule.test(value)) break;
      values[key] = value;
    }
    // All of a platform's keys or none: a half pair is worse than no pair.
    if (Object.keys(values).length === Object.keys(rules).length) out[platform] = values;
  }
  return out;
}

/**
 * Loads the cached document, then refreshes it from the update host. The cache
 * is applied first and on its own timeline: a machine that is offline, or one
 * whose fetch is slow, must not wait on the network before its bridges know
 * which application they are.
 *
 * Failure at any point is silent and total — the built-in pair keeps working,
 * which is the whole reason it is still compiled in.
 */
export async function loadShippedCredentials(options: {
  directory: string;
  host: string;
  channel?: string;
  fetch?: typeof globalThis.fetch;
  log?: (message: string) => void;
}): Promise<void> {
  const file = cachePath(options.directory);
  const cached = await readFile(file, "utf8")
    .then((raw): unknown => JSON.parse(raw))
    .catch((): null => null);
  if (cached) remote = readPairs(cached);

  const url = `${options.host}/${options.channel ?? "stable"}/credentials.json`;
  const response = await (options.fetch ?? globalThis.fetch)(url, {
    // The document is tiny and rotation has to take effect promptly; a cached
    // copy of a banned pair is the exact thing this exists to route around.
    cache: "no-cache",
    signal: AbortSignal.timeout(10_000),
  }).catch((): null => null);
  if (!response?.ok) return;
  const served = await response.json().catch((): null => null);
  const pairs = readPairs(served);
  if (Object.keys(pairs).length === 0) {
    options.log?.("served credentials document had nothing usable in it; keeping what we have");
    return;
  }
  remote = pairs;
  await mkdir(options.directory, {recursive: true}).catch((): undefined => undefined);
  await writeFile(file, JSON.stringify(served), "utf8").catch((): undefined => undefined);
}

/** Test seam: drops anything loaded, so a case starts from the built-in pair. */
export function resetShippedCredentials(): void {
  remote = {};
}
