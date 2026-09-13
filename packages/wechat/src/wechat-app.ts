import {execFile} from "node:child_process";
import {createHash} from "node:crypto";
import {access} from "node:fs/promises";
import {homedir} from "node:os";
import path from "node:path";
import {promisify} from "node:util";

type Run = (
  file: string,
  args: string[],
  options: {timeout: number},
) => Promise<{stdout: string; stderr: string}>;

const run: Run = promisify(execFile);
const WECHAT_APP_PATHS = [
  "/Applications/WeChat.app",
  `${homedir()}/Applications/WeChat.app`,
];

/** Explicit user action only. Passive detection never calls Launch Services. */
export async function openWeChatDesktop(options: Pick<EnsureWeChatAppOptions, "platform" | "appPaths" | "exists" | "run"> = {}): Promise<void> {
  if ((options.platform ?? process.platform) !== "darwin")
    throw new Error("WeChat Desktop is only supported on Mac.");
  const appPath = await first(options.appPaths ?? WECHAT_APP_PATHS, options.exists ??
    (async candidate => access(candidate).then(() => true, () => false)));
  if (!appPath) throw new Error("Install WeChat Desktop first.");
  await (options.run ?? run)("/usr/bin/open", ["-a", appPath], {timeout: 10_000});
}

export interface EnsureWeChatAppOptions {
  platform?: NodeJS.Platform;
  appPaths?: readonly string[];
  /** Exact native launcher used for a cold start. When supplied, a failed
   * guarded launch is terminal: falling back to Launch Services could expose
   * WeChat in the foreground. */
  launchHelperPath?: string;
  nativeTaskScriptPath?: string;
  primeLibraryPath?: string;
  run?: Run;
  exists?: (candidate: string) => Promise<boolean>;
  waitMs?: number;
}

export interface PrimeWeChatAppOptions {
  platform?: NodeJS.Platform;
  helperPath?: string;
  /** Read-only native account check when Qt hides its AX window tree. */
  nativeSessionHelperPath?: string;
  accountId?: string;
  run?: Run;
}

export type WeChatSessionState =
  | "signed_in"
  | "signed_out"
  | "remembered_login"
  | "interactive_login"
  | "locked"
  | "launching"
  | "unavailable";

/** Exact executable match: a helper, updater, or a stale command mentioning
 * the bundle is not evidence that the desktop app is already running. */
export function weChatAppIsRunning(processes: string, executable: string): boolean {
  return processes
    .split("\n")
    .map((line) => line.trim())
    .some((line) => line === executable || line.startsWith(`${executable} `));
}

/** Read-only identity discovery for hosts whose relay omits its target PID.
 * Require exactly one matching application executable. The native lease then
 * captures its birth identity and the writer revalidates it before attaching. */
export async function weChatAppProcessId(
  options: Pick<EnsureWeChatAppOptions, "platform" | "appPaths" | "run"> = {},
): Promise<number | null> {
  if ((options.platform ?? process.platform) !== "darwin") return null;
  const executables = new Set((options.appPaths ?? WECHAT_APP_PATHS)
    .map(appPath => path.join(appPath, "Contents/MacOS/WeChat")));
  const result = await (options.run ?? run)("/bin/ps", ["-axo", "pid=,comm="],
    {timeout: 2_000}).catch((): null => null);
  if (!result) return null;
  const matches = result.stdout.split("\n").flatMap(line => {
    const match = /^\s*(\d+)\s+(.+?)\s*$/.exec(line);
    const pid = Number(match?.[1]);
    return match && executables.has(match[2]) && Number.isSafeInteger(pid) && pid > 1
      ? [pid] : [];
  });
  return matches.length === 1 ? matches[0] : null;
}

/** Starts an absent WeChat only through the verified pre-main guard. A
 * background Launch Services flag alone cannot prevent later activation. */
export async function ensureWeChatAppRunningHidden(
  options: EnsureWeChatAppOptions = {},
): Promise<boolean> {
  if ((options.platform ?? process.platform) !== "darwin") return false;
  const execute = options.run ?? run;
  const exists =
    options.exists ??
    (async (candidate: string): Promise<boolean> =>
      access(candidate)
        .then(() => true)
        .catch(() => false));
  const candidates = options.appPaths ?? WECHAT_APP_PATHS;
  const appPath = await first(candidates, exists);
  if (!appPath) return false;
  const executable = path.join(appPath, "Contents", "MacOS", "WeChat");
  const running = async (): Promise<boolean> => {
    const processes = await execute("/bin/ps", ["-axo", "command="], {
      timeout: 5_000,
    }).catch((): null => null);
    return Boolean(processes && weChatAppIsRunning(processes.stdout, executable));
  };
  if (await running()) return true;
  const primeLibraryPath = options.primeLibraryPath &&
      (await exists(options.primeLibraryPath))
    ? options.primeLibraryPath
    : null;
  const launchHelperReady = options.launchHelperPath &&
      options.nativeTaskScriptPath && primeLibraryPath &&
      (await exists(options.launchHelperPath)) &&
      (await exists(options.nativeTaskScriptPath));
  if (launchHelperReady) {
    const guarded = await execute(
      options.launchHelperPath!,
      [
        appPath,
        options.nativeTaskScriptPath!,
        primeLibraryPath!,
      ],
      // The child must publish a current guard proof before it is admitted.
      {timeout: Math.max(20_000, options.waitMs ?? 0)},
    ).catch((): null => null);
    if (!guarded) return false;
    try {
      const answer = JSON.parse(guarded.stdout) as {ok?: unknown; guarded?: unknown; alreadyRunning?: unknown; pid?: unknown};
      return answer.ok === true && Number.isSafeInteger(answer.pid) && Number(answer.pid) > 1 &&
        (answer.guarded === true || answer.alreadyRunning === true);
    } catch {
      return false;
    }
  }
  return false; // Missing guard resources must never fall back to open -g.
}

/**
 * Selects one existing WeChat chat through its accessibility tree without
 * activating the app. WeChat 4 needs this after it rebuilds the current chat
 * view before its daemon-owned background send signal can fire again.
 *
 * The native helper refuses to act while WeChat itself is frontmost, so a
 * person using the ordinary app always wins over automatic bridge recovery.
 */
export async function primeWeChatAppHidden(
  options: PrimeWeChatAppOptions = {},
): Promise<boolean> {
  if ((options.platform ?? process.platform) !== "darwin") return false;
  if (!options.helperPath) return false;
  const execute = options.run ?? run;
  const result = await execute(options.helperPath, [], {timeout: 25_000}).catch(
    (): null => null,
  );
  if (!result) return false;
  try {
    const answer = JSON.parse(result.stdout) as {ok?: boolean; primed?: boolean};
    return answer.ok === true && answer.primed === true;
  } catch {
    return false;
  }
}

/** Read-only companion to the primer. A remembered-account button press is
 * merely a request; this reports ready only after WeChat exposes its signed-in
 * session list, so the relay cannot freeze the login transition halfway. */
export async function weChatSessionReadyHidden(
  options: PrimeWeChatAppOptions = {},
): Promise<boolean> {
  return (await weChatSessionStateHidden(options)) === "signed_in";
}

/** The exact read-only session state lets the bridge distinguish ordinary
 * startup from a remembered-account action that must use the guarded native
 * fallback. */
export async function weChatSessionStateHidden(
  options: PrimeWeChatAppOptions = {},
): Promise<WeChatSessionState> {
  if ((options.platform ?? process.platform) !== "darwin")
    return "unavailable";
  if (!options.helperPath) return "unavailable";
  const execute = options.run ?? run;
  const result = await execute(options.helperPath, ["--status-only"], {
    // The helper bounds its AX query at one second; allow process startup and
    // JSON output to finish instead of killing it at that same deadline.
    timeout: 2_000,
  }).catch((): null => null);
  if (!result) return "unavailable";
  try {
    const answer = JSON.parse(result.stdout) as {ok?: boolean; state?: unknown; pid?: unknown};
    if (answer.ok !== true || typeof answer.state !== "string")
      return "unavailable";
    // Explicit logout, QR, remembered-login and screen-lock states always win.
    // A fingerprint binds this fallback to the one selected keyed account.
    if (answer.state === "unavailable" && options.nativeSessionHelperPath && options.accountId &&
        Number.isSafeInteger(answer.pid) && Number(answer.pid) > 1) {
      const native = await execute(options.nativeSessionHelperPath,
        ["--pid", String(answer.pid)], {timeout: 3_000}).catch((): null => null);
      if (!native) return "unavailable";
      const observed = JSON.parse(native.stdout) as {ok?: boolean; state?: string; pid?: number; accountFingerprint?: string};
      if (observed.ok === true && observed.state === "locked") return "locked";
      if (observed.ok === true && observed.state === "signed_in" && observed.pid === answer.pid &&
          observed.accountFingerprint === createHash("sha256").update(options.accountId).digest("hex")) return "signed_in";
      return "unavailable";
    }
    if (
      [
        "signed_in",
        "signed_out",
        "remembered_login",
        "interactive_login",
        "locked",
        "launching",
        "unavailable",
      ].includes(answer.state)
    )
      return answer.state as WeChatSessionState;
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

async function first(
  candidates: readonly string[],
  exists: (candidate: string) => Promise<boolean>,
): Promise<string | null> {
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  return null;
}
