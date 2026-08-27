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
  readonly #timeoutMs: number;

  constructor(executable: string, timeoutMs = 130_000) {
    this.#executable = executable;
    this.#timeoutMs = timeoutMs;
  }

  async write(request: WeChatWriteRequest): Promise<WeChatWriteResult> {
    return await new Promise<WeChatWriteResult>((resolve, reject) => {
      const child = spawn(this.#executable, ["write", "--json"], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let settled = false;
      const finish = (error?: Error, result?: WeChatWriteResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(result ?? {deliveredVerified: false, reason: "native writer returned no result"});
      };
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        finish(new Error(`native WeChat writer timed out after ${this.#timeoutMs}ms`));
      }, this.#timeoutMs);
      child.once("error", (error) => finish(error));
      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.once("close", (code) => {
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
