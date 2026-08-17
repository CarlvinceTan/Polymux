import {execFile} from "node:child_process";
import {access} from "node:fs/promises";
import {homedir} from "node:os";
import {promisify} from "node:util";

const run: (
  file: string,
  args: string[],
  options: {timeout: number},
) => Promise<{stdout: string; stderr: string}> = promisify(execFile);

/**
 * WeChat is the one platform with no mautrix bridge behind it. It arrives
 * instead through a relay running on this Mac: `wechat-bridge` serves a
 * loopback HTTP/SSE port against the WeChat desktop app the user is already
 * signed in to, and a small appservice carries that traffic into the hub.
 *
 * That shape has no login to drive — the account is whichever one WeChat.app
 * holds — so this module answers the only two questions the tab can ask: is
 * the relay up, and whose account is it carrying.
 */

/** Loopback port `wechat-bridge` binds. Overridable for a non-default run. */
const RELAY_PORT = Number(process.env.FLAREAI_WECHAT_RELAY_PORT ?? 18400);
const RELAY_URL = `http://127.0.0.1:${RELAY_PORT}/health`;
/**
 * A relay that has not answered in this long is not going to. The probe runs
 * on every status read, and the whole point of a loopback call is that a
 * healthy one returns in single-digit milliseconds.
 */
const PROBE_TIMEOUT_MS = 1_500;

/** Where `wechat-use` installs, in the order worth trying. */
const CLI_PATHS = [
  process.env.FLAREAI_WECHAT_CLI,
  `${homedir()}/.local/bin/wechat-use`,
  "/opt/homebrew/bin/wechat-use",
  "/usr/local/bin/wechat-use",
].filter((path): path is string => Boolean(path));

export interface WeChatRelayStatus {
  /** The relay answered and reports itself connected to the WeChat app. */
  running: boolean;
  /** The signed-in account, when the CLI could name one. */
  account: {id: string; name: string} | null;
  /** Why it is not usable, written for the person reading the tab. */
  error: string | null;
}

/** Where WeChat for Mac installs. Checked rather than assumed, because the
 * first thing to tell someone setting this up is which piece is missing. */
const WECHAT_APP_PATHS = [
  "/Applications/WeChat.app",
  `${homedir()}/Applications/WeChat.app`,
];

/**
 * What is missing, in the order a person has to fix it. WeChat itself comes
 * first: telling someone their relay is not answering, when what they actually
 * lack is the app the relay drives, sends them looking in the wrong place.
 */
/**
 * What to tell someone whose WeChat is not working. Only ever about WeChat
 * itself: how FlareAI reaches it — a local relay, a daemon, a loopback port —
 * is the app's own plumbing, and naming it hands the user a chore they cannot
 * act on in place of the one thing they can.
 */
export function setupHint(present: {wechat: boolean; relay: boolean}): string | null {
  if (!present.wechat)
    return "WeChat for Mac is not installed. Install it from wechat.com and sign in — FlareAI reads WeChat from the desktop app on this Mac rather than through a sign-in of its own.";
  if (!present.relay)
    return "FlareAI cannot reach WeChat on this Mac yet. Make sure WeChat is open and signed in.";
  return null;
}

async function missingPiece(): Promise<string | null> {
  const installed = await Promise.all(
    WECHAT_APP_PATHS.map((entry) =>
      access(entry)
        .then(() => true)
        .catch(() => false),
    ),
  );
  const cli = await Promise.all(
    CLI_PATHS.map((entry) =>
      access(entry)
        .then(() => true)
        .catch(() => false),
    ),
  );
  return setupHint({wechat: installed.some(Boolean), relay: cli.some(Boolean)});
}

/**
 * Asks the relay how it is doing. Never throws: a WeChat relay that is not
 * installed is the ordinary case for most people, not a failure that should
 * take the rest of the platform list down with it.
 */
export async function probeWeChatRelay(): Promise<WeChatRelayStatus> {
  const health = await fetchHealth();
  if (!health)
    return {
      running: false,
      account: null,
      // Naming the piece that is actually absent, rather than reporting the
      // last thing that failed. Someone with no WeChat at all does not need to
      // hear about a relay they have never installed.
      error:
        (await missingPiece()) ??
        "FlareAI cannot reach WeChat yet. Open WeChat and sign in, then try again.",
    };
  if (health.status !== "connected")
    return {
      running: false,
      account: null,
      error: "FlareAI cannot reach WeChat yet. Open WeChat and sign in, then try again.",
    };
  return {running: true, account: await defaultAccount(), error: null};
}

async function fetchHealth(): Promise<{status: string} | null> {
  try {
    const response = await fetch(RELAY_URL, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {status?: unknown};
    return {status: typeof body.status === "string" ? body.status : "unknown"};
  } catch {
    return null;
  }
}

/**
 * The account the relay sends as, named as well as it can be. The CLI prints
 * a table rather than JSON, so this reads the row it marks default — falling
 * back to the only row when nothing is marked, which is the single-account
 * case almost everyone is in.
 */
async function defaultAccount(): Promise<{id: string; name: string} | null> {
  const table = await accountsTable();
  if (!table) return null;
  const rows = table
    .split("\n")
    .slice(1) // header
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/));
  const named = rows.filter((columns) => columns.length >= 2);
  if (named.length === 0) return null;
  const row = named.find((columns) => columns.includes("*")) ?? named[0];
  const [alias, wxid] = row;
  if (!wxid) return null;
  return {id: wxid, name: alias && alias !== "-" ? alias : wxid};
}

async function accountsTable(): Promise<string | null> {
  for (const path of CLI_PATHS) {
    const result = await run(path, ["accounts", "list"], {
      timeout: PROBE_TIMEOUT_MS,
    }).catch((): null => null);
    if (result) return result.stdout;
  }
  return null;
}
