import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentTool, ToolEnvironment } from "../types.js";
import { stringInput, workingDirectory } from "../types.js";
import { boundOutput } from "../output.js";

/** Applied when the model does not ask for a timeout, which is most calls. */
const DEFAULT_TIMEOUT_MS = 120_000;
/** Ceiling on what the model may ask for. */
const MAX_TIMEOUT_MS = 600_000;
/** Grace between SIGTERM and SIGKILL for a process group that ignores the first. */
const KILL_GRACE_MS = 3_000;
/** How much output is held in memory before the oldest is dropped. */
const BUFFER_LIMIT_BYTES = 4 * 1024 * 1024;

export function createBashTool(environment: ToolEnvironment): AgentTool {
  return {
    name: "bash",
    description:
      "Execute a shell command in the current working directory. Returns stdout, stderr, and exit status.\n" +
      `Commands are killed after ${DEFAULT_TIMEOUT_MS / 1_000}s unless a longer \`timeout\` (seconds, max ${MAX_TIMEOUT_MS / 1_000}) is given, so keep every command bounded.\n` +
      "Narrow before you search: `ls` a directory to see what is in it, then search only the subdirectories that look relevant. " +
      "Never run a recursive search from a home directory, a mount point, or `/` — it will time out without an answer. " +
      "Scope searches with an explicit directory, `--include`/`-name` filters, `-maxdepth`, and pipe long output through `head`.",
    executionMode: "parallel",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
        timeout: {
          type: "number",
          description: `Seconds before the command is killed. Defaults to ${DEFAULT_TIMEOUT_MS / 1_000}, capped at ${MAX_TIMEOUT_MS / 1_000}.`,
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
    async execute(input, context) {
      const command = stringInput(input, "command", "bash");
      const timeoutMs =
        typeof input.timeout === "number" && input.timeout > 0
          ? Math.min(input.timeout * 1_000, MAX_TIMEOUT_MS)
          : DEFAULT_TIMEOUT_MS;
      const child = spawn(
        environment.shell ?? process.env.SHELL ?? "/bin/sh",
        ["-lc", command],
        {
          cwd: workingDirectory(environment, context),
          env: { ...process.env, ...environment.env },
          stdio: ["ignore", "pipe", "pipe"],
          // Its own process group, so a runaway child of the shell — a
          // recursive `grep` or `find` — is killed along with the shell
          // rather than outliving it.
          detached: true,
        },
      );
      let escalation: NodeJS.Timeout | undefined;
      const stop = () => {
        killGroup(child, "SIGTERM");
        escalation ??= setTimeout(() => killGroup(child, "SIGKILL"), KILL_GRACE_MS);
        escalation.unref?.();
      };

      const chunks: Buffer[] = [];
      let buffered = 0;
      let dropped = 0;
      const collect = (value: Buffer) => {
        const chunk = Buffer.from(value);
        chunks.push(chunk);
        buffered += chunk.byteLength;
        // Keep the tail only; `boundOutput` shows the tail as well, so the
        // visible result is unchanged and memory stays bounded no matter how
        // much a runaway command writes.
        while (buffered > BUFFER_LIMIT_BYTES && chunks.length > 1) {
          const oldest = chunks.shift();
          if (!oldest) break;
          buffered -= oldest.byteLength;
          dropped += oldest.byteLength;
        }
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);

      context.signal.addEventListener("abort", stop, { once: true });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        stop();
      }, timeoutMs);
      let code: number | null;
      try {
        code = await new Promise<number | null>((resolveCode, reject) => {
          child.once("error", reject);
          child.once("close", resolveCode);
        });
      } finally {
        clearTimeout(timer);
        if (escalation) clearTimeout(escalation);
        context.signal.removeEventListener("abort", stop);
      }
      if (context.signal.aborted) throw context.signal.reason;
      const full = Buffer.concat(chunks).toString("utf8");
      const bounded = boundOutput(
        full,
        environment.outputLimitBytes,
        environment.outputLimitLines,
      );
      let logPath: string | undefined;
      if (bounded.truncated || dropped > 0) {
        const directory =
          environment.temporaryDirectory ?? join(tmpdir(), "flareai-tool-output");
        await mkdir(directory, { recursive: true });
        logPath = join(directory, `${context.runId}-${context.callId}.log`);
        await writeFile(logPath, full, "utf8");
      }
      const prefix = logPath
        ? `[Output truncated${dropped > 0 ? ` (${dropped} early bytes discarded)` : ""}; partial log: ${logPath}]\n`
        : "";
      const status = timedOut
        ? `Command timed out after ${Math.round(timeoutMs / 1_000)}s and was killed. Re-run something narrower — list the directory first, or scope the search to one subdirectory — rather than repeating this command.`
        : `Process exited with code ${code ?? "unknown"}`;
      return {
        content: `${prefix}${bounded.visible}\n\n${status}`.trim(),
        isError: timedOut || code !== 0,
        metadata: {
          exitCode: code,
          timedOut,
          truncated: bounded.truncated || dropped > 0,
          logPath: logPath ?? null,
        },
      };
    },
  };
}

/**
 * Signal the whole process group. Falls back to the shell itself if the group
 * is already gone, and ignores the resulting ESRCH.
 */
function killGroup(
  child: { pid?: number; kill: (signal: NodeJS.Signals) => boolean },
  signal: NodeJS.Signals,
): void {
  try {
    if (child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Already exited.
    }
  }
}
