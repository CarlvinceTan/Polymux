import {spawn} from "node:child_process";
import type {WeChatWriteRequest, WeChatWriteResult, WeChatWriter} from "./wechat-bridge.js";

/**
 * Stable stdin/stdout boundary for the version-sensitive native WeChat layer.
 * One JSON request goes in and one verified result comes out. Keeping this out
 * of Electron means a driver crash or a changed WeChat build cannot take the
 * Hub down with it.
 */
export class ProcessWeChatWriter implements WeChatWriter {
  readonly #executable: string;
  readonly #prefixArgs: readonly string[];
  readonly #environment: NodeJS.ProcessEnv;
  readonly #timeoutMs: number;

  constructor(
    executable: string,
    options:
      | number
      | {
          prefixArgs?: readonly string[];
          environment?: NodeJS.ProcessEnv;
          timeoutMs?: number;
        } = {},
  ) {
    this.#executable = executable;
    this.#prefixArgs = typeof options === "number" ? [] : (options.prefixArgs ?? []);
    this.#environment =
      typeof options === "number" ? process.env : (options.environment ?? process.env);
    this.#timeoutMs = typeof options === "number" ? options : (options.timeoutMs ?? 300_000);
  }

  async write(request: WeChatWriteRequest): Promise<WeChatWriteResult> {
    return await new Promise<WeChatWriteResult>((resolve, reject) => {
      const child = spawn(this.#executable, [...this.#prefixArgs, "write", "--json"], {
        env: this.#environment,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let settled = false;
      let timedOut = false;
      let forceTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: Error, result?: WeChatWriteResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (forceTimer) clearTimeout(forceTimer);
        if (error) reject(error);
        else resolve(result ?? {deliveredVerified: false, reason: "native writer returned no result"});
      };
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        // The driver pauses wechatd and may have LLDB attached. Give its signal
        // handler time to detach, remove its arm files, and restart the daemon
        // before escalating a genuinely stuck process.
        forceTimer = setTimeout(() => child.kill("SIGKILL"), 20_000);
        forceTimer.unref?.();
      }, this.#timeoutMs);
      child.once("error", (error) => finish(error));
      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.once("close", (code) => {
        if (timedOut) {
          finish(new Error(`native WeChat writer timed out after ${this.#timeoutMs}ms`));
          return;
        }
        if (code !== 0) {
          const detail = Buffer.concat(stderr).toString("utf8").trim();
          finish(new Error(detail || `native WeChat writer exited with ${code}`));
          return;
        }
        try {
          const answer = JSON.parse(Buffer.concat(stdout).toString("utf8")) as {
            deliveredVerified?: boolean;
            delivered_verified?: boolean;
            messageId?: string;
            message_id?: string;
            reason?: string;
          };
          finish(undefined, {
            deliveredVerified: answer.deliveredVerified === true || answer.delivered_verified === true,
            ...(answer.messageId || answer.message_id ? {messageId: answer.messageId ?? answer.message_id} : {}),
            ...(answer.reason ? {reason: answer.reason} : {}),
          });
        } catch {
          finish(new Error("native WeChat writer returned invalid JSON"));
        }
      });
      child.stdin.end(`${JSON.stringify(request)}\n`);
    });
  }
}
