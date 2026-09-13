import {execFile} from "node:child_process";
import {promisify} from "node:util";
import type {WeChatRelayNativeTarget} from "./wechat-relay-lease.js";
import {weChatDaemonCaptureProcessIds} from "../../../scripts/wechat/wechat-daemon-coordination.mjs";

type Run = (file: string, args: string[], options: {timeout: number}) => Promise<{stdout: string; stderr: string}>;

/** The caller holds relay ownership. Stopping wechatd alone can leave its
 * exact target stopped after debugger detachment, making AX look signed out.
 * Use the provider's cleanup operation and verify identity and running state
 * before probing login or submitting any native work. */
export async function recoverWeChatSession(
  cli: string,
  options: {target?: WeChatRelayNativeTarget; run?: Run; waitMs?: number; quietMs?: number} = {},
): Promise<void> {
  const run = options.run ?? promisify(execFile);
  const target = options.target;
  if (!target) {
    await run(cli, ["daemon", "stop"], {timeout: 5_000});
    return;
  }
  const identify = async () => (await run("/bin/ps", ["-p", String(target.pid), "-o", "lstart=,comm="], {timeout: 2_000})).stdout.trim();
  if (await identify() !== target.identity) throw new Error("WeChat changed before session recovery");
  try {
    await run(cli, ["unfreeze", "--pid", String(target.pid)], {timeout: 20_000});
    const deadline = Date.now() + (options.waitMs ?? 65_000);
    let quietSince: number | undefined;
    do {
      if (await identify() !== target.identity) throw new Error("WeChat changed during session recovery");
      const state = (await run("/bin/ps", ["-p", String(target.pid), "-o", "stat="], {timeout: 2_000})).stdout.trim();
      const processes = await run("/bin/ps", ["-ax", "-o", "pid=,ppid=,command="], {timeout: 2_000});
      if (await identify() !== target.identity) throw new Error("WeChat changed during session recovery");
      if (state && !/[TXtZ]/.test(state) && !weChatDaemonCaptureProcessIds(processes.stdout).length) {
        quietSince ??= Date.now();
        // The CLI can return while its debugger is still releasing the task.
        // Match the native writer's continuous quiet interval before probing AX.
        if (Date.now() - quietSince >= (options.quietMs ?? 1_000)) return;
      } else {
        quietSince = undefined;
      }
      if (Date.now() >= deadline) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    throw new Error("WeChat is still stopped or attached after session recovery");
  } catch (error) {
    const launchError = error as NodeJS.ErrnoException & {path?: string};
    if (launchError?.code === "ENOENT" && launchError.path === cli) throw error;
    // Do not restore the relay over an unconfirmed cleanup.
    throw Object.assign(new Error(error instanceof Error ? error.message : String(error), {cause: error}), {
      nativeDetachUnconfirmed: true,
      relayRecoverySafe: false,
    });
  }
}
