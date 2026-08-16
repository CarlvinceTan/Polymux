import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentTool, ToolEnvironment } from "../types.js";
import { stringInput } from "../types.js";
import { boundOutput } from "../output.js";

export function createBashTool(environment: ToolEnvironment): AgentTool {
  return {
    name: "bash",
    description:
      "Execute a shell command in the current working directory. Returns stdout, stderr, and exit status.",
    executionMode: "parallel",
    parameters: {
      type: "object",
      properties: { command: { type: "string" }, timeout: { type: "number" } },
      required: ["command"],
      additionalProperties: false,
    },
    async execute(input, context) {
      const command = stringInput(input, "command", "bash");
      const timeoutMs =
        typeof input.timeout === "number" && input.timeout > 0
          ? input.timeout * 1_000
          : undefined;
      const child = spawn(
        environment.shell ?? process.env.SHELL ?? "/bin/sh",
        ["-lc", command],
        {
          cwd: environment.cwd,
          env: { ...process.env, ...environment.env },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const chunks: Buffer[] = [];
      child.stdout.on("data", (value: Buffer) =>
        chunks.push(Buffer.from(value)),
      );
      child.stderr.on("data", (value: Buffer) =>
        chunks.push(Buffer.from(value)),
      );
      const abort = () => child.kill("SIGTERM");
      context.signal.addEventListener("abort", abort, { once: true });
      const timer = timeoutMs ? setTimeout(abort, timeoutMs) : undefined;
      const code = await new Promise<number | null>((resolveCode, reject) => {
        child.once("error", reject);
        child.once("close", resolveCode);
      });
      if (timer) clearTimeout(timer);
      context.signal.removeEventListener("abort", abort);
      if (context.signal.aborted) throw context.signal.reason;
      const full = Buffer.concat(chunks).toString("utf8");
      const bounded = boundOutput(
        full,
        environment.outputLimitBytes,
        environment.outputLimitLines,
      );
      let logPath: string | undefined;
      if (bounded.truncated) {
        const directory =
          environment.temporaryDirectory ?? join(tmpdir(), "flareai-tool-output");
        await mkdir(directory, { recursive: true });
        logPath = join(directory, `${context.runId}-${context.callId}.log`);
        await writeFile(logPath, full, "utf8");
      }
      const prefix = bounded.truncated
        ? `[Output truncated; full log: ${logPath}]\n`
        : "";
      return {
        content:
          `${prefix}${bounded.visible}\n\nProcess exited with code ${code ?? "unknown"}`.trim(),
        isError: code !== 0,
        metadata: {
          exitCode: code,
          truncated: bounded.truncated,
          logPath: logPath ?? null,
        },
      };
    },
  };
}
