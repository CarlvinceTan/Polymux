import {execFile} from "node:child_process";
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

export interface EnsureWeChatAppOptions {
  platform?: NodeJS.Platform;
  appPaths?: readonly string[];
  run?: Run;
  exists?: (candidate: string) => Promise<boolean>;
  waitMs?: number;
}

export interface PrimeWeChatAppOptions {
  platform?: NodeJS.Platform;
  helperPath?: string;
  run?: Run;
}

/** Exact executable match: a helper, updater, or a stale command mentioning
 * the bundle is not evidence that the desktop app is already running. */
export function weChatAppIsRunning(processes: string, executable: string): boolean {
  return processes
    .split("\n")
    .map((line) => line.trim())
    .some((line) => line === executable || line.startsWith(`${executable} `));
}

/**
 * Starts WeChat without activation when a linked local bridge needs it.
 *
 * `open -g -j` is deliberately used only when the exact app process is absent:
 * it launches a remembered session in the background, but never hides or
 * relaunches the copy a person is already using. It also does not change the
 * app's activation policy, so clicking WeChat later opens its ordinary window.
 */
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
  const launched = await execute("/usr/bin/open", ["-g", "-j", appPath], {
    timeout: 10_000,
  })
    .then(() => true)
    .catch(() => false);
  if (!launched) return false;
  const deadline = Date.now() + (options.waitMs ?? 10_000);
  while (Date.now() < deadline) {
    if (await running()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
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
  const result = await execute(options.helperPath, [], {timeout: 5_000}).catch(
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

async function first(
  candidates: readonly string[],
  exists: (candidate: string) => Promise<boolean>,
): Promise<string | null> {
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  return null;
}
