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
const RELAY_PORT = Number(process.env.POLYMUX_WECHAT_RELAY_PORT ?? 18400);
const RELAY_URL = `http://127.0.0.1:${RELAY_PORT}/health`;
/**
 * A relay that has not answered in this long is not going to. The probe runs
 * on every status read, and the whole point of a loopback call is that a
 * healthy one returns in single-digit milliseconds.
 */
const PROBE_TIMEOUT_MS = 1_500;

/** Where `wechat-use` installs, in the order worth trying. */
const CLI_PATHS = [
  process.env.POLYMUX_WECHAT_CLI,
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
  /** Official installer page when WeChat itself is the missing dependency. */
  installUrl: string | null;
}

/** Official desktop download pages. The Mac constant remains exported for
 * existing callers; setup guidance chooses the current operating system. */
export const WECHAT_DOWNLOAD_URL = "https://mac.weixin.qq.com/en";
export const WECHAT_DOWNLOAD_URLS = Object.freeze({
  darwin: WECHAT_DOWNLOAD_URL,
  win32: "https://pc.weixin.qq.com/",
  linux: "https://linux.weixin.qq.com/",
  other: "https://www.wechat.com/",
});

export function weChatDownloadUrl(platform: NodeJS.Platform): string {
  if (platform === "darwin") return WECHAT_DOWNLOAD_URLS.darwin;
  if (platform === "win32") return WECHAT_DOWNLOAD_URLS.win32;
  if (platform === "linux") return WECHAT_DOWNLOAD_URLS.linux;
  return WECHAT_DOWNLOAD_URLS.other;
}

/** Where WeChat for Mac installs. Checked rather than assumed, because the
 * first thing to tell someone setting this up is which piece is missing. */
function weChatAppPaths(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  if (platform === "darwin")
    return [
      "/Applications/WeChat.app",
      `${homedir()}/Applications/WeChat.app`,
    ];
  if (platform === "win32")
    return [
      environment.LOCALAPPDATA && `${environment.LOCALAPPDATA}/Tencent/WeChat/WeChat.exe`,
      environment.LOCALAPPDATA && `${environment.LOCALAPPDATA}/Tencent/Weixin/Weixin.exe`,
      environment.ProgramFiles && `${environment.ProgramFiles}/Tencent/WeChat/WeChat.exe`,
      environment["ProgramFiles(x86)"] &&
        `${environment["ProgramFiles(x86)"]}/Tencent/WeChat/WeChat.exe`,
    ].filter((entry): entry is string => Boolean(entry));
  if (platform === "linux")
    return [
      "/usr/bin/wechat",
      "/usr/bin/weixin",
      "/opt/wechat/wechat",
      "/opt/weixin/weixin",
    ];
  return [];
}

/**
 * What is missing, in the order a person has to fix it. WeChat itself comes
 * first: telling someone their relay is not answering, when what they actually
 * lack is the app the relay drives, sends them looking in the wrong place.
 */
/**
 * What to tell someone whose WeChat is not working. Only ever about WeChat
 * itself: how Polymux reaches it — a local relay, a daemon, a loopback port —
 * is the app's own plumbing, and naming it hands the user a chore they cannot
 * act on in place of the one thing they can.
 */
export function setupHint(
  present: {wechat: boolean; relay: boolean},
  platform: NodeJS.Platform = process.platform,
): string | null {
  return setupGuidance(present, platform).error;
}

/** Keeps the visible explanation and its action derived from the same check. */
export function setupGuidance(
  present: {wechat: boolean; relay: boolean},
  platform: NodeJS.Platform = process.platform,
): {
  error: string | null;
  installUrl: string | null;
} {
  const edition =
    platform === "darwin"
      ? "WeChat for Mac"
      : platform === "win32"
        ? "WeChat for Windows"
        : platform === "linux"
          ? "WeChat for Linux"
          : "WeChat";
  const device =
    platform === "darwin"
      ? "this Mac"
      : platform === "win32"
        ? "this PC"
        : "this computer";
  if (!present.wechat)
    return {
      error: `${edition} is not installed. Install it and sign in — Polymux reads WeChat from the desktop app on ${device} rather than through a sign-in of its own.`,
      installUrl: weChatDownloadUrl(platform),
    };
  if (!present.relay)
    return {
      error: `Polymux cannot reach WeChat on ${device} yet. Make sure WeChat is open and signed in.`,
      installUrl: null,
    };
  return {error: null, installUrl: null};
}

async function missingPiece(): Promise<{error: string | null; installUrl: string | null}> {
  const installed = await Promise.all(
    weChatAppPaths().map((entry) =>
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
  return setupGuidance({wechat: installed.some(Boolean), relay: cli.some(Boolean)});
}

/**
 * Asks the relay how it is doing. Never throws: a WeChat relay that is not
 * installed is the ordinary case for most people, not a failure that should
 * take the rest of the platform list down with it.
 */
export async function probeWeChatRelay(): Promise<WeChatRelayStatus> {
  // Installation is the source of truth even if an orphaned relay process is
  // still answering from an earlier run. Otherwise that stale health response
  // would hide the one action that can make WeChat usable again.
  const missing = await missingPiece();
  if (missing.installUrl)
    return {
      running: false,
      account: null,
      error: missing.error,
      installUrl: missing.installUrl,
    };
  const health = await fetchHealth();
  if (!health) {
    return {
      running: false,
      account: null,
      // Naming the piece that is actually absent, rather than reporting the
      // last thing that failed. Someone with no WeChat at all does not need to
      // hear about a relay they have never installed.
      error:
        missing.error ??
        "Polymux cannot reach WeChat yet. Open WeChat and sign in, then try again.",
      installUrl: missing.installUrl,
    };
  }
  if (health.status !== "connected")
    return {
      running: false,
      account: null,
      error: "Polymux cannot reach WeChat yet. Open WeChat and sign in, then try again.",
      installUrl: null,
    };
  return {running: true, account: await defaultAccount(), error: null, installUrl: null};
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
  // The registry's alias is something the user set here, and almost nobody
  // has; the name they know themselves by lives in WeChat's own contact list.
  const profile = await profileName(wxid);
  return {id: wxid, name: profile ?? (alias && alias !== "-" ? alias : wxid)};
}

/**
 * The signed-in account's own display name, read from WeChat's contact store.
 * A `wxid_…` is an internal handle nobody recognises as themselves, so the row
 * only falls back to it when the store cannot be read.
 */
async function profileName(wxid: string): Promise<string | null> {
  for (const path of CLI_PATHS) {
    const result = await run(path, ["contacts", "--query", wxid, "--json", "-n", "1"], {
      timeout: PROBE_TIMEOUT_MS,
    }).catch((): null => null);
    if (!result) continue;
    const rows = parseRows(result.stdout);
    const match = rows.find((row) => row.username === wxid) ?? rows[0];
    if (!match) return null;
    // A remark is what the user chose to call this account; the nickname is
    // what WeChat shows everyone else. Either beats the handle.
    for (const candidate of [match.remark, match.display_name, match.nick_name]) {
      const name = typeof candidate === "string" ? candidate.trim() : "";
      if (name && name !== wxid) return name;
    }
    return null;
  }
  return null;
}

interface ContactRow {
  username?: unknown;
  remark?: unknown;
  nick_name?: unknown;
  display_name?: unknown;
}

/** The CLI prints JSON on success and prose on failure; only the first is rows. */
function parseRows(stdout: string): ContactRow[] {
  try {
    const parsed = JSON.parse(stdout || "[]") as unknown;
    return Array.isArray(parsed) ? (parsed as ContactRow[]) : [];
  } catch {
    return [];
  }
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
