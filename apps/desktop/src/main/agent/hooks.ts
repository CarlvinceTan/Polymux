import { readFileSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { polymuxPath } from "../system/paths.js";
import type {
  AgentToolResult,
  ToolCallBlock,
  ToolHookDecision,
  ToolHooks,
} from "@polymux/core";

/**
 * User-configured tool lifecycle hooks, read from `~/.polymux/hooks.json`.
 *
 * ```json
 * {
 *   "version": 1,
 *   "hooks": [
 *     {
 *       "event": "pre-tool",
 *       "tools": ["write", "edit", "bash"],
 *       "command": "python3 ~/.polymux/hooks/guard.py",
 *       "timeoutMs": 10000
 *     }
 *   ]
 * }
 * ```
 *
 * `tools` is a list of tool names or a single regular expression string; omit
 * it to match every tool. Each command receives one JSON object on stdin:
 * `{event, tool, arguments}` for pre-tool and `{event, tool, arguments,
 * result}` for post-tool. A pre-tool command that exits non-zero blocks the
 * call, and its stderr (or stdout) becomes the message shown to the model.
 * Post-tool commands are observation only; their exit codes are ignored.
 *
 * The config is re-read when its mtime changes, so edits apply to the next
 * tool call without restarting Polymux. A missing file means no hooks.
 */

export interface HookRule {
  event: "pre-tool" | "post-tool";
  tools?: string[] | string;
  command: string;
  timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;

export class HookEngine implements ToolHooks {
  readonly #configPath: string;
  #rules: HookRule[] = [];
  #loadedMtime = -1;
  #loadError: string | null = null;

  constructor(configPath = polymuxPath("hooks.json")) {
    this.#configPath = configPath;
  }

  /** Parse problems from the last load, surfaced for diagnostics. */
  get loadError(): string | null {
    this.#reload();
    return this.#loadError;
  }


  async beforeTool(call: ToolCallBlock): Promise<ToolHookDecision> {
    for (const rule of this.#matching("pre-tool", call.name)) {
      const outcome = await runHookCommand(rule, {
        event: "pre-tool",
        tool: call.name,
        arguments: call.arguments,
      });
      if (!outcome.ok)
        return {
          allow: false,
          message: outcome.message
            ? `Blocked by hook: ${outcome.message}`
            : `A configured pre-tool hook blocked the ${call.name} call.`,
        };
    }
    return { allow: true };
  }

  async afterTool(call: ToolCallBlock, result: AgentToolResult): Promise<void> {
    for (const rule of this.#matching("post-tool", call.name))
      await runHookCommand(rule, {
        event: "post-tool",
        tool: call.name,
        arguments: call.arguments,
        result: {
          isError: result.isError ?? false,
          content:
            typeof result.content === "string"
              ? result.content
              : result.content
                  .map((block) => (block.type === "text" ? block.text : `[${block.type}]`))
                  .join("\n"),
        },
      }).catch(() => {});
  }

  #matching(event: HookRule["event"], tool: string): HookRule[] {
    this.#reload();
    return this.#rules.filter(
      (rule) => rule.event === event && matchesTool(rule.tools, tool),
    );
  }

  #reload(): void {
    let mtime: number;
    try {
      mtime = statSync(this.#configPath).mtimeMs;
    } catch {
      this.#rules = [];
      this.#loadedMtime = -1;
      this.#loadError = null;
      return;
    }
    if (mtime === this.#loadedMtime) return;
    this.#loadedMtime = mtime;
    try {
      this.#rules = parseHookConfig(
        JSON.parse(readFileSync(this.#configPath, "utf8")),
      );
      this.#loadError = null;
    } catch (reason) {
      // A malformed config disables hooks rather than blocking every tool.
      this.#rules = [];
      this.#loadError = reason instanceof Error ? reason.message : String(reason);
    }
  }
}

export function parseHookConfig(value: unknown): HookRule[] {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("hooks.json must contain an object");
  const entries = (value as Record<string, unknown>).hooks;
  if (entries === undefined) return [];
  if (!Array.isArray(entries)) throw new Error("hooks must be an array");
  return entries.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new Error(`hooks[${index}] must be an object`);
    const record = entry as Record<string, unknown>;
    if (record.event !== "pre-tool" && record.event !== "post-tool")
      throw new Error(`hooks[${index}].event must be pre-tool or post-tool`);
    if (typeof record.command !== "string" || !record.command.trim())
      throw new Error(`hooks[${index}].command must be a non-empty string`);
    if (
      record.tools !== undefined &&
      typeof record.tools !== "string" &&
      !(Array.isArray(record.tools) && record.tools.every((item) => typeof item === "string"))
    )
      throw new Error(`hooks[${index}].tools must be a string or string array`);
    const timeout =
      typeof record.timeoutMs === "number" && record.timeoutMs > 0
        ? Math.min(record.timeoutMs, MAX_TIMEOUT_MS)
        : DEFAULT_TIMEOUT_MS;
    return {
      event: record.event,
      tools: record.tools as HookRule["tools"],
      command: record.command,
      timeoutMs: timeout,
    };
  });
}

export function matchesTool(tools: HookRule["tools"], name: string): boolean {
  if (tools === undefined) return true;
  if (Array.isArray(tools)) return tools.includes(name);
  if (tools === "*") return true;
  try {
    return new RegExp(`^(?:${tools})$`).test(name);
  } catch {
    return tools === name;
  }
}

interface HookOutcome {
  ok: boolean;
  message: string;
}

function runHookCommand(rule: HookRule, payload: unknown): Promise<HookOutcome> {
  return new Promise((resolve) => {
    const child = spawn(rule.command, {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (outcome: HookOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      // A hung pre-tool hook fails closed: the guarded call stays blocked.
      finish({ ok: false, message: `hook timed out after ${rule.timeoutMs}ms` });
    }, rule.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", (reason) =>
      finish({ ok: false, message: reason.message }),
    );
    child.on("close", (code) =>
      finish({
        ok: code === 0,
        message: (stderr.trim() || stdout.trim()).slice(0, 2000),
      }),
    );
    // A hook is free to ignore its stdin — `exit 0` never reads a byte — and a
    // child that exits first leaves this write with nowhere to go. Without a
    // listener that EPIPE is an unhandled stream error, which throws out of the
    // promise instead of resolving the hook; with one, the exit code decides
    // the outcome as it should, and an undelivered payload is just dropped.
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(payload));
  });
}
