import {execFile, spawn} from "node:child_process";
import type {ChatGroupInfoDto} from "@polymux/protocol";
import {WeChatDeliveryUnconfirmedError} from "./wechat-delivery.js";
import type {
  WeChatNativeSticker,
  WeChatNativeReadState,
  WeChatMediaReadRequest,
  WeChatNativeMedia,
  WeChatWriteRequest,
  WeChatWriteResult,
  WeChatWriter,
} from "./wechat-bridge.js";

function writerResult(answer: {
  deliveredVerified?: boolean;
  delivered_verified?: boolean;
  deliveryUnconfirmed?: boolean;
  messageId?: string;
  message_id?: string;
  clientMessageId?: string;
  client_message_id?: string;
  reason?: string;
  relayRecoverySafe?: boolean;
}): WeChatWriteResult {
  if (!answer || typeof answer !== "object" || Array.isArray(answer) ||
      (typeof answer.deliveredVerified !== "boolean" && typeof answer.delivered_verified !== "boolean") ||
      (["deliveredVerified", "delivered_verified"] as const).some(field =>
        answer[field] !== undefined && typeof answer[field] !== "boolean") ||
      (answer.deliveredVerified !== undefined && answer.delivered_verified !== undefined &&
        answer.deliveredVerified !== answer.delivered_verified) ||
      (["messageId", "message_id", "clientMessageId", "client_message_id", "reason"] as const).some(field =>
        answer[field] !== undefined && typeof answer[field] !== "string") ||
      (answer.relayRecoverySafe !== undefined && typeof answer.relayRecoverySafe !== "boolean") ||
      (answer.deliveryUnconfirmed !== undefined && typeof answer.deliveryUnconfirmed !== "boolean") ||
      (answer.deliveryUnconfirmed === true && (answer.deliveredVerified === true || answer.delivered_verified === true)))
    throw new Error("Invalid native WeChat writer response");
  return {
    deliveredVerified:
      answer.deliveredVerified === true || answer.delivered_verified === true,
    ...(answer.messageId || answer.message_id
      ? {messageId: answer.messageId ?? answer.message_id}
      : {}),
    ...(answer.clientMessageId || answer.client_message_id
      ? {clientMessageId: answer.clientMessageId ?? answer.client_message_id}
      : {}),
    ...(answer.reason ? {reason: answer.reason} : {}),
    ...(answer.deliveryUnconfirmed === true ? {deliveryUnconfirmed: true} : {}),
    ...(answer.relayRecoverySafe === false ? {relayRecoverySafe: false} : {}),
  };
}

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
  readonly #cleanupGraceMs: number;
  readonly #checkCompatibility: boolean;
  #readinessFailure: string | null = null;
  #readinessRecoverySafe = true;
  #nativeTarget: {pid: number; identity: string} | null | undefined;

  constructor(
    executable: string,
    options:
      | number
      | {
          prefixArgs?: readonly string[];
          checkCompatibility?: boolean;
          environment?: NodeJS.ProcessEnv;
          timeoutMs?: number;
          /** Bounded detach grace before SIGKILL; overridable for fixtures. */
          cleanupGraceMs?: number;
        } = {},
  ) {
    this.#executable = executable;
    this.#checkCompatibility = typeof options !== "number" && options.checkCompatibility === true;
    this.#prefixArgs = typeof options === "number" ? [] : (options.prefixArgs ?? []);
    this.#environment =
      typeof options === "number" ? process.env : (options.environment ?? process.env);
    this.#timeoutMs = typeof options === "number" ? options : (options.timeoutMs ?? 300_000);
    this.#cleanupGraceMs = typeof options === "number" ? 20_000 : (options.cleanupGraceMs ?? 20_000);
  }

  /** Bind subsequent helpers to the exact process captured by the owner. */
  setNativeTarget(target: {pid: number; identity: string} | null): void {
    if (target && (!Number.isSafeInteger(target.pid) || target.pid <= 0 || !target.identity))
      throw new Error("The native WeChat target must identify one exact process");
    this.#nativeTarget = target ? {...target} : null;
  }

  #spawnEnvironment(): NodeJS.ProcessEnv {
    const environment = {...this.#environment};
    // Standalone explicit environments retain their pins until the owner
    // starts managing them. Clearing a captured target must not resurrect
    // stale values from the environment inherited at construction.
    if (this.#nativeTarget !== undefined) {
      delete environment.POLYMUX_WECHAT_TARGET_PID;
      delete environment.POLYMUX_WECHAT_TARGET_IDENTITY;
      if (this.#nativeTarget) {
        environment.POLYMUX_WECHAT_TARGET_PID = String(this.#nativeTarget.pid);
        environment.POLYMUX_WECHAT_TARGET_IDENTITY = this.#nativeTarget.identity;
        // The lease owner is responsible for recovery. A custom executable
        // must not restart the daemon while its relay is still guarded.
        environment.POLYMUX_WECHAT_RELAY_MANAGED = "1";
      }
    }
    return environment;
  }

  /** Readiness probe. The driver checks its pinned WeChat build and may ask
   * that exact background process to resume a remembered account or select an
   * existing chat. It never opens a window, enters credentials, or sends. */
  /** Hash-only preflight; it never launches or attaches to WeChat. */
  async compatible(): Promise<boolean> {
    if (!this.#checkCompatibility) return true;
    return await new Promise(resolve => {
      const child = execFile(this.#executable, [...this.#prefixArgs, "compatibility", "--json"], {
        env: this.#spawnEnvironment(), timeout: 5_000, maxBuffer: 65536, windowsHide: true, encoding: "utf8",
      }, (error, stdout) => {
        try {
          if (error) throw new Error("WeChat compatibility could not be checked. Try again after updating Polymux.");
          const result = JSON.parse(stdout) as {supported?: unknown; reason?: unknown};
          if (result.supported !== true) throw new Error(typeof result.reason === "string" ? result.reason : "This WeChat version needs a Polymux update before sending.");
          this.#readinessFailure = null;
          resolve(true);
        } catch (failure) {
          this.#readinessFailure = failure instanceof Error ? failure.message : "WeChat compatibility could not be checked.";
          resolve(false);
        }
      });
      child.stdin?.end();
    });
  }

  async ready(): Promise<boolean> {
    this.#readinessFailure = null;
    this.#readinessRecoverySafe = true;
    return await new Promise<boolean>((resolve) => {
      const child = spawn(this.#executable, [...this.#prefixArgs, "ready", "--json"], {
        env: this.#spawnEnvironment(),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let settled = false;
      let timedOut = false;
      let spawned = false;
      let forceTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = (ready: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(forceTimer);
        resolve(ready);
      };
      const timer = setTimeout(() => {
        timedOut = true;
        if (spawned) this.#readinessRecoverySafe = false;
        child.kill("SIGTERM");
        this.#readinessFailure = "Native WeChat preparation timed out";
        // Wait for the driver's detach cleanup before releasing its owner.
        forceTimer = setTimeout(() => child.kill("SIGKILL"), this.#cleanupGraceMs);
        forceTimer.unref?.();
      }, Math.min(this.#timeoutMs, 90_000));
      timer.unref?.();
      child.once("spawn", () => {
        spawned = true;
        // A process may have attached before it failed. Only a complete,
        // successful protocol response can establish safe cleanup again.
        this.#readinessRecoverySafe = false;
      });
      child.once("error", (error) => {
        this.#readinessFailure = error.message;
        finish(false);
      });
      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.once("close", (code) => {
        if (settled) return;
        if (timedOut) return finish(false);
        if (code !== 0) {
          this.#readinessFailure = Buffer.concat(stderr).toString("utf8").trim() ||
            `Native WeChat preparation exited with ${code}`;
          return finish(false);
        }
        try {
          const answer = JSON.parse(Buffer.concat(stdout).toString("utf8")) as {
            ready?: boolean;
            reason?: string;
            relayRecoverySafe?: boolean;
          };
          if (!answer || typeof answer !== "object" || Array.isArray(answer) ||
              typeof answer.ready !== "boolean" ||
              (answer.reason !== undefined && typeof answer.reason !== "string") ||
              (answer.relayRecoverySafe !== undefined && typeof answer.relayRecoverySafe !== "boolean"))
            throw new Error("Invalid native WeChat readiness response");
          this.#readinessRecoverySafe = answer.relayRecoverySafe !== false;
          this.#readinessFailure = answer.ready === true ? null :
            (answer.reason || "Native WeChat preparation is unavailable");
          finish(answer.ready === true);
        } catch {
          this.#readinessFailure = "Native WeChat preparation returned an invalid response";
          finish(false);
        }
      });
    });
  }

  readinessFailure(): string | null { return this.#readinessFailure; }
  readinessRecoverySafe(): boolean { return this.#readinessRecoverySafe; }

  async readStates(): Promise<WeChatNativeReadState[]> {
    return await new Promise((resolve, reject) => {
      const child = spawn(this.#executable, [...this.#prefixArgs, "read-state", "--json"], {
        env: this.#spawnEnvironment(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let settled = false;
      const finish = (error?: Error, result?: WeChatNativeReadState[]): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve(result ?? []);
      };
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        finish(new Error("Native WeChat unread state timed out"));
      }, Math.min(this.#timeoutMs, 15_000));
      timer.unref?.();
      child.once("error", (error) => finish(error));
      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.once("close", (code) => {
        try {
          if (code !== 0) throw new Error(Buffer.concat(stderr).toString("utf8").trim() ||
            `Native WeChat unread state exited with ${code}`);
          const answer = JSON.parse(Buffer.concat(stdout).toString("utf8")) as {sessions?: unknown};
          if (!Array.isArray(answer.sessions)) throw new Error("Native WeChat unread state returned no list");
          const seen = new Set<string>();
          const sessions = answer.sessions.map((row: unknown): WeChatNativeReadState => {
            const state = row as Partial<WeChatNativeReadState> | null;
            if (!state || typeof state.chatId !== "string" || !state.chatId || seen.has(state.chatId) ||
                typeof state.unreadCount !== "number" || !Number.isSafeInteger(state.unreadCount) || state.unreadCount < 0 ||
                typeof state.markedUnread !== "boolean") throw new Error("Native WeChat unread state returned an invalid item");
            seen.add(state.chatId);
            return {chatId: state.chatId, unreadCount: state.unreadCount, markedUnread: state.markedUnread};
          });
          finish(undefined, sessions);
        } catch (error) {finish(error instanceof Error ? error : new Error("Invalid native WeChat unread state"));}
      });
    });
  }

  async stickers(): Promise<WeChatNativeSticker[]> {
    return await new Promise<WeChatNativeSticker[]>((resolve, reject) => {
      const child = spawn(
        this.#executable,
        [...this.#prefixArgs, "stickers", "--json"],
        {
          env: this.#spawnEnvironment(),
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        },
      );
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let settled = false;
      const finish = (error?: Error, result?: WeChatNativeSticker[]): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(result ?? []);
      };
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        finish(new Error("native WeChat sticker catalog timed out"));
      }, Math.min(this.#timeoutMs, 15_000));
      timer.unref?.();
      child.once("error", (error) => finish(error));
      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.once("close", (code) => {
        if (code !== 0) {
          const detail = Buffer.concat(stderr).toString("utf8").trim();
          finish(new Error(detail || `native WeChat sticker catalog exited with ${code}`));
          return;
        }
        try {
          const answer = JSON.parse(Buffer.concat(stdout).toString("utf8")) as {
            stickers?: unknown;
            reason?: unknown;
          };
          if (!Array.isArray(answer.stickers)) {
            if (typeof answer.reason === "string" && answer.reason.trim())
              throw new Error(answer.reason.trim());
            throw new Error("native WeChat sticker catalog returned no list");
          }
          const stickers = answer.stickers.map((entry): WeChatNativeSticker => {
            if (
              !entry ||
              typeof entry !== "object" ||
              !("id" in entry) ||
              !("xml" in entry) ||
              typeof entry.id !== "string" ||
              !/^[a-f0-9]{32}$/.test(entry.id) ||
              typeof entry.xml !== "string" ||
              !entry.xml.includes(entry.id)
            )
              throw new Error("native WeChat sticker catalog returned an invalid item");
            return {id: entry.id, xml: entry.xml};
          });
          finish(undefined, stickers);
        } catch (error) {
          finish(
            error instanceof Error
              ? error
              : new Error("native WeChat sticker catalog returned invalid JSON"),
          );
        }
      });
    });
  }

  async readMedia(request: WeChatMediaReadRequest): Promise<WeChatNativeMedia | null> {
    return await new Promise((resolve, reject) => {
      const child = spawn(this.#executable, [...this.#prefixArgs, "read-media", "--json"], {
        env: this.#spawnEnvironment(), stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let length = 0, errorLength = 0, settled = false;
      const finish = (error?: Error, result: WeChatNativeMedia | null = null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve(result);
      };
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        finish(new Error("Native WeChat media read timed out"));
      }, Math.min(this.#timeoutMs, 30_000));
      timer.unref?.();
      child.once("error", error => finish(error));
      child.stdin.on("error", error => finish(error));
      child.stdout.on("data", (chunk: Buffer) => {
        length += chunk.length;
        if (length > 12 * 1024 * 1024) {
          child.kill("SIGTERM"); finish(new Error("Native WeChat media response is too large"));
        } else stdout.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        errorLength += chunk.length;
        if (errorLength <= 16_384) stderr.push(chunk);
      });
      child.once("close", code => {
        if (settled) return;
        try {
          if (code !== 0) throw new Error(Buffer.concat(stderr).toString("utf8").trim() || "Native WeChat media read failed");
          const {media, reason} = JSON.parse(Buffer.concat(stdout).toString("utf8")) as {media?: WeChatNativeMedia | null; reason?: unknown};
          if (media === undefined && typeof reason === "string" && reason.trim())
            throw new Error(reason.slice(0, 1024));
          if (media === null) {finish(); return;}
          if (!media || typeof media.name !== "string" || !media.name || media.name.length > 1024 ||
              typeof media.mimeType !== "string" || !/^[\w.+-]+\/[\w.+-]+$/.test(media.mimeType) ||
              !Number.isSafeInteger(media.size) || media.size <= 0 || media.size > 200 * 1024 * 1024 ||
              Boolean(media.bodyBase64) === Boolean(media.localPath)) throw new Error("Invalid native WeChat media response");
          if (media.bodyBase64) {
            if (typeof media.bodyBase64 !== "string" || media.size > 8 * 1024 * 1024 + 44 ||
                media.mimeType !== "audio/wav" || Buffer.from(media.bodyBase64, "base64").toString("base64") !== media.bodyBase64 ||
                Buffer.from(media.bodyBase64, "base64").length !== media.size)
              throw new Error("Invalid native WeChat audio response");
          } else if (typeof media.localPath !== "string" || !media.localPath.startsWith("/") ||
              typeof media.md5 !== "string" || !/^[a-f\d]{32}$/.test(media.md5))
            throw new Error("Invalid native WeChat file response");
          if (media.durationMs != null && (!Number.isFinite(media.durationMs) || media.durationMs <= 0))
            throw new Error("Invalid native WeChat media duration");
          finish(undefined, {name: media.name, mimeType: media.mimeType, size: media.size,
            ...(media.bodyBase64 ? {bodyBase64: media.bodyBase64} : {localPath: media.localPath, md5: media.md5}),
            ...(media.durationMs != null ? {durationMs: media.durationMs} : {}),
          });
        } catch (error) {finish(error instanceof Error ? error : new Error("Invalid native WeChat media response"));}
      });
      child.stdin.end(`${JSON.stringify(request)}\n`);
    });
  }

  async readMentions(request: Omit<WeChatMediaReadRequest, "kind">): Promise<string[] | null> {
    return await new Promise((resolve, reject) => {
      const child = execFile(this.#executable, [...this.#prefixArgs, "read-mentions", "--json"], {
        env: this.#spawnEnvironment(), timeout: Math.min(this.#timeoutMs, 30_000),
        maxBuffer: 65536, windowsHide: true, encoding: "utf8",
      }, (error, stdout) => {
        if (error) {reject(new Error("Native WeChat mention read failed")); return;}
        try {
          const {mentionedIds, reason} = JSON.parse(stdout) as {mentionedIds?: unknown; reason?: unknown};
          if (mentionedIds === undefined && typeof reason === "string" && reason.trim())
            throw new Error(reason.slice(0, 1024));
          if (mentionedIds === null) {resolve(null); return;}
          if (!Array.isArray(mentionedIds) || mentionedIds.length > 2048 ||
              mentionedIds.some(id => typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id)))
            throw new Error("Invalid native WeChat mention response");
          resolve([...new Set(mentionedIds)]);
        } catch (failure) {reject(failure);}
      });
      child.stdin?.on("error", reject);
      child.stdin?.end(`${JSON.stringify(request)}\n`);
    });
  }

  async groupInfo(chatId: string): Promise<ChatGroupInfoDto & {chatId: string}> {
    return await new Promise((resolve, reject) => {
      const child = execFile(this.#executable, [...this.#prefixArgs, "group-info", "--json"], {
        env: this.#spawnEnvironment(), timeout: Math.min(this.#timeoutMs, 15_000),
        maxBuffer: 65536, windowsHide: true, encoding: "utf8",
      }, (error, stdout) => {
        if (error) {reject(new Error("Could not read the current group name from WeChat Desktop")); return;}
        try {
          const {group} = JSON.parse(stdout) as {group?: Partial<ChatGroupInfoDto & {chatId: string}>};
          if (!group || group.chatId !== chatId || typeof group.name !== "string" ||
              Buffer.byteLength(group.name) > 4096 || typeof group.isMember !== "boolean")
            throw new Error("WeChat returned invalid group settings");
          resolve({chatId, name: group.name, isMember: group.isMember});
        } catch (failure) {reject(failure);}
      });
      child.stdin?.on("error", reject);
      child.stdin?.end(`${JSON.stringify({chatId})}\n`);
    });
  }

  async write(request: WeChatWriteRequest): Promise<WeChatWriteResult> {
    return await new Promise<WeChatWriteResult>((resolve, reject) => {
      const child = spawn(this.#executable, [...this.#prefixArgs, "write", "--json"], {
        env: this.#spawnEnvironment(),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let settled = false;
      let timedOut = false;
      let spawned = false;
      let stopping = false;
      let transportError: Error | undefined;
      let forceTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: Error, result?: WeChatWriteResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (forceTimer) clearTimeout(forceTimer);
        if (error) {
          // Once a sending helper starts, losing its response cannot prove
          // rejection. Preserve the bubble and the cleanup hold; never turn
          // a possibly submitted message back into a ready-to-resend draft.
          const failure = spawned && (request.kind === "text" || request.kind === "media")
            ? new WeChatDeliveryUnconfirmedError(error.message) : error;
          reject(spawned ? Object.assign(failure, {relayRecoverySafe: false as const}) : failure);
        }
        else resolve(result ?? {deliveredVerified: false, reason: "native writer returned no result"});
      };
      const terminate = (): void => {
        if (stopping || settled) return;
        stopping = true;
        forceTimer = setTimeout(() => child.kill("SIGKILL"), this.#cleanupGraceMs);
        forceTimer.unref?.();
        child.kill("SIGTERM");
      };
      const timer = setTimeout(() => {
        timedOut = true;
        // The driver pauses wechatd and may have LLDB attached. Give its signal
        // handler time to detach, remove its arm files, and restart the daemon
        // before escalating a genuinely stuck process.
        terminate();
      }, this.#timeoutMs);
      child.once("spawn", () => {spawned = true;});
      child.once("error", (error) => {
        if (!spawned) return finish(error);
        transportError ??= error;
        terminate();
      });
      child.stdin.on("error", (error) => {
        if (settled) return;
        transportError ??= error;
        terminate();
      });
      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.once("close", (code) => {
        if (settled) return;
        if (timedOut) {
          finish(new Error(`native WeChat writer timed out after ${this.#timeoutMs}ms`));
          return;
        }
        if (transportError) return finish(transportError);
        if (code !== 0) {
          const detail = Buffer.concat(stderr).toString("utf8").trim();
          finish(new Error(detail || `native WeChat writer exited with ${code}`));
          return;
        }
        try {
          if (this.#environment.POLYMUX_WECHAT_READY_TRACE === "1") {
            for (const line of Buffer.concat(stderr).toString("utf8").split("\n"))
              if (line.startsWith("[wechat coordination] ")) console.log(line);
          }
          const answer = JSON.parse(Buffer.concat(stdout).toString("utf8"));
          finish(undefined, writerResult(answer));
        } catch {
          finish(new Error("native WeChat writer returned invalid JSON"));
        }
      });
      child.stdin.end(`${JSON.stringify(request)}\n`);
    });
  }
}
