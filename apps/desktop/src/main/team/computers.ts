import {spawn} from "node:child_process";
import {mkdir, realpath} from "node:fs/promises";
import path from "node:path";
import type {AgentTool, AgentToolContext, AgentToolResult} from "@polymux/core";
import type {JsonObject} from "@polymux/inference";
import type {TeamComputerDto, TeamComputerProvider} from "@polymux/protocol";

const IMAGE = "alpine:3.21";
const OUTPUT_LIMIT = 4 * 1024 * 1024;
const PROCESS_TIMEOUT_MS = 30_000;
const PROCESS_KILL_GRACE_MS = 2_000;

type Engine = "podman" | "docker";

interface ComputerRecord {
  state: TeamComputerDto["state"];
  detail: string | null;
}

/**
 * A persistent private OCI computer per bot.
 *
 * On macOS the engine itself runs in one managed Linux VM (Podman machine or
 * Docker Desktop), then each bot gets a hardened container inside it. On
 * Linux, rootless Podman is preferred directly. No laptop path, credential
 * directory, daemon socket, or network is mounted into the computer.
 */
export class TeamComputerManager {
  #engine: Engine | null | undefined;
  #engineDetection: Promise<Engine | null> | null = null;
  readonly #records = new Map<string, ComputerRecord>();

  constructor() {
    void this.#detectEngine();
  }

  provider(): TeamComputerProvider {
    return this.#engine ?? "unavailable";
  }

  snapshot(botId: string): TeamComputerDto {
    const record = this.#records.get(botId);
    return {
      provider: this.provider(),
      state: this.#engine ? (record?.state ?? "stopped") : "unavailable",
      detail: this.#engine
        ? (record?.detail ?? null)
        : this.#engine === undefined
          ? "Checking for a running Podman or Docker engine…"
          : "Start Podman or Docker to give this bot an isolated computer.",
      persistent: true,
      network: "none",
    };
  }

  async start(botId: string): Promise<TeamComputerDto> {
    const engine = await this.#detectEngine();
    if (!engine) return this.snapshot(botId);
    const current = this.#records.get(botId);
    if (current?.state === "running") return this.snapshot(botId);
    this.#records.set(botId, {state: "starting", detail: null});
    const name = containerName(botId);
    try {
      const exists = (await runContainerCommand(engine, ["container", "inspect", name], {allowFailure: true, timeout: 10_000})).code === 0;
      if (exists) {
        const started = await runContainerCommand(engine, ["start", name], {allowFailure: true, timeout: 60_000});
        if (started.code !== 0 && !/already running/i.test(started.output))
          throw new Error(started.output || `Could not start ${name}`);
      } else {
        const created = await runContainerCommand(engine, teamContainerCreateArgs(botId), {allowFailure: true, timeout: 120_000});
        if (created.code !== 0) throw new Error(created.output || `Could not create ${name}`);
      }
      this.#records.set(botId, {state: "running", detail: null});
    } catch (error) {
      this.#records.set(botId, {
        state: "error",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    return this.snapshot(botId);
  }

  async stop(botId: string): Promise<TeamComputerDto> {
    const engine = await this.#detectEngine();
    if (!engine) return this.snapshot(botId);
    const result = await runContainerCommand(engine, ["stop", containerName(botId)], {allowFailure: true, timeout: 30_000});
    this.#records.set(botId, result.code === 0 || /no such/i.test(result.output)
      ? {state: "stopped", detail: null}
      : {state: "error", detail: result.output});
    return this.snapshot(botId);
  }

  /** Delete only this bot's container and private volume. */
  async destroy(botId: string): Promise<void> {
    const engine = await this.#detectEngine();
    if (!engine) return;
    await runContainerCommand(engine, ["rm", "-f", containerName(botId)], {allowFailure: true, timeout: 30_000});
    await runContainerCommand(engine, ["volume", "rm", volumeName(botId)], {allowFailure: true, timeout: 30_000});
    this.#records.delete(botId);
  }

  async exportWorkspace(botId: string, workspacePath: string, outputRoot: string, outputPath?: string): Promise<string> {
    const computer = await this.start(botId);
    if (computer.state !== "running") throw new Error(computer.detail ?? "The Team computer is unavailable");
    if (!this.#engine) throw new Error("No container engine is available");
    const source = teamWorkspaceTarget(workspacePath);
    const relativeDestination = outputPath?.trim() || path.posix.basename(workspacePath.replaceAll("\\", "/"));
    const destination = await writablePathWithin(outputRoot, relativeDestination);
    const result = await runContainerCommand(
      this.#engine,
      ["cp", `${containerName(botId)}:${source}`, destination],
      {allowFailure: true, timeout: 60_000},
    );
    if (result.code !== 0) throw new Error(result.output || `Could not export ${workspacePath}`);
    return destination;
  }

  async importWorkspace(botId: string, outputRoot: string, sourcePath: string, workspacePath: string): Promise<string> {
    const computer = await this.start(botId);
    if (computer.state !== "running") throw new Error(computer.detail ?? "The Team computer is unavailable");
    if (!this.#engine) throw new Error("No container engine is available");
    const source = await readablePathWithin(outputRoot, sourcePath);
    const destination = teamWorkspaceTarget(workspacePath);
    const directory = path.posix.dirname(destination);
    const prepare = await runContainerCommand(
      this.#engine,
      ["exec", containerName(botId), "mkdir", "-p", directory],
      {allowFailure: true, timeout: 30_000},
    );
    if (prepare.code !== 0) throw new Error(prepare.output || `Could not prepare ${directory}`);
    const result = await runContainerCommand(
      this.#engine,
      ["cp", source, `${containerName(botId)}:${destination}`],
      {allowFailure: true, timeout: 60_000},
    );
    if (result.code !== 0) throw new Error(result.output || `Could not import ${sourcePath}`);
    return destination;
  }

  /**
   * Keeps the existing native tools for Assistant chats, but routes Team file
   * and shell calls into that bot's computer. If no engine is available the
   * call fails closed; it never falls back to executing on the laptop.
   */
  wrapNativeTool(
    tool: AgentTool,
    botForRun: (runId: string) => string | null,
  ): AgentTool {
    return {
      ...tool,
      execute: async (input, context) => {
        const botId = botForRun(context.runId);
        if (!botId) return tool.execute(input, context);
        const computer = await this.start(botId);
        if (computer.state !== "running")
          return {
            content: computer.detail ?? "This bot's isolated computer is unavailable.",
            isError: true,
            metadata: {provider: computer.provider, state: computer.state},
          };
        return this.#execute(botId, tool.name, input, context);
      },
    };
  }

  async #execute(
    botId: string,
    tool: string,
    input: JsonObject,
    context: AgentToolContext,
  ): Promise<AgentToolResult> {
    if (!this.#engine) throw new Error("No container engine is available");
    const path = typeof input.path === "string" ? input.path : "";
    if (tool === "bash") {
      const command = typeof input.command === "string" ? input.command : "";
      if (!command) throw new Error("bash.command must be a string");
      const timeout = typeof input.timeout === "number"
        ? Math.max(1_000, Math.min(input.timeout * 1_000, 600_000))
        : 120_000;
      const seconds = Math.ceil(timeout / 1_000);
      const result = await runContainerCommand(
        this.#engine,
        teamBashExecArgs(botId, command, seconds),
        {signal: context.signal, timeout: timeout + 10_000},
      );
      return commandResult(result);
    }
    if (tool === "read") {
      if (!path) throw new Error("read.path must be a string");
      const offset = Math.max(1, Math.floor(typeof input.offset === "number" ? input.offset : 1));
      const limit = Math.max(1, Math.min(2_000, Math.floor(typeof input.limit === "number" ? input.limit : 2_000)));
      const script = "test -f \"$1\" && awk -v first=\"$2\" -v count=\"$3\" 'NR>=first && NR<first+count {print NR \": \" $0}' \"$1\"";
      const result = await runContainerCommand(this.#engine, [
        "exec", containerName(botId), "sh", "-c", script, "polymux-read", path, String(offset), String(limit),
      ], {signal: context.signal});
      return commandResult(result, {path, offset, limit});
    }
    if (tool === "write") {
      if (!path || typeof input.content !== "string")
        throw new Error("write.path and write.content must be strings");
      const script = "mkdir -p \"$(dirname \"$1\")\" && base64 -d > \"$1\"";
      const result = await runContainerCommand(this.#engine, [
        "exec", "-i", containerName(botId), "sh", "-c", script, "polymux-write", path,
      ], {signal: context.signal, stdin: Buffer.from(input.content).toString("base64")});
      return result.code === 0
        ? {content: `Wrote ${Buffer.byteLength(input.content)} bytes to ${path}`, metadata: {path, bytes: Buffer.byteLength(input.content)}}
        : commandResult(result);
    }
    if (tool === "edit") {
      if (!path || !Array.isArray(input.edits))
        throw new Error("edit.path and edit.edits are required");
      const readResult = await runContainerCommand(this.#engine, ["exec", containerName(botId), "cat", path], {signal: context.signal});
      if (readResult.code !== 0) return commandResult(readResult);
      let content = readResult.output;
      for (const [index, raw] of input.edits.entries()) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw))
          throw new Error(`edit.edits[${index}] must be an object`);
        const edit = raw as JsonObject;
        if (typeof edit.oldText !== "string" || typeof edit.newText !== "string" || !edit.oldText)
          throw new Error(`edit.edits[${index}] must contain non-empty oldText and string newText`);
        const first = content.indexOf(edit.oldText);
        if (first < 0) throw new Error(`edit.edits[${index}].oldText was not found`);
        if (content.indexOf(edit.oldText, first + edit.oldText.length) >= 0)
          throw new Error(`edit.edits[${index}].oldText is not unique`);
        content = content.slice(0, first) + edit.newText + content.slice(first + edit.oldText.length);
      }
      const script = "base64 -d > \"$1\"";
      const result = await runContainerCommand(this.#engine, [
        "exec", "-i", containerName(botId), "sh", "-c", script, "polymux-edit", path,
      ], {signal: context.signal, stdin: Buffer.from(content).toString("base64")});
      return result.code === 0
        ? {content: `Applied ${input.edits.length} edit${input.edits.length === 1 ? "" : "s"} to ${path}`, metadata: {path, edits: input.edits.length}}
        : commandResult(result);
    }
    return {content: `Tool ${tool} is not available inside the Team computer.`, isError: true};
  }

  async #detectEngine(): Promise<Engine | null> {
    if (this.#engineDetection) return this.#engineDetection;
    this.#engineDetection = (async () => {
      for (const engine of ["podman", "docker"] as const) {
        try {
          const result = await runContainerCommand(engine, ["info"], {allowFailure: true, timeout: 5_000});
          if (result.code === 0) return this.#engine = engine;
        } catch {
          // A missing CLI, stopped daemon, or hung engine all move on to the
          // other provider without blocking Desktop startup.
        }
      }
      this.#engine = null;
      return null;
    })();
    try {
      return await this.#engineDetection;
    } finally {
      this.#engineDetection = null;
    }
  }
}

/** Explicit bridge between a bot's private /workspace and Polymux's
 * managed output folder. It never accepts arbitrary laptop paths. */
export function createTeamWorkspaceTool(
  computers: TeamComputerManager,
  botForRun: (runId: string) => string | null,
  outputRoot: () => string,
): AgentTool {
  return {
    name: "team_workspace",
    description:
      "Export a file or folder from this bot's private /workspace into the user's managed Polymux output folder, " +
      "or import a file from that same managed folder. Use it only when the user requests a handoff or the work needs an explicit artifact transfer.",
    mainAgentOnly: true,
    parameters: {
      type: "object",
      properties: {
        action: {type: "string", enum: ["export", "import"]},
        source: {type: "string", description: "Source path relative to /workspace or the managed output folder"},
        destination: {type: "string", description: "Destination path relative to the managed output folder or /workspace"},
      },
      required: ["action", "source"],
      additionalProperties: false,
    },
    async execute(input, context) {
      const botId = botForRun(context.runId);
      if (!botId) throw new Error("team_workspace is available only inside a Team run");
      if (typeof input.source !== "string" || !input.source.trim())
        throw new Error("team_workspace.source is required");
      if (input.destination !== undefined && typeof input.destination !== "string")
        throw new Error("team_workspace.destination must be a string");
      const requestedDestination = typeof input.destination === "string" ? input.destination : undefined;
      if (input.action === "export") {
        const destination = await computers.exportWorkspace(
          botId,
          input.source,
          outputRoot(),
          requestedDestination,
        );
        return {content: `Exported ${input.source} to ${destination}.`, metadata: {path: destination, action: "export"}};
      }
      if (input.action === "import") {
        if (typeof input.destination !== "string" || !input.destination.trim())
          throw new Error("team_workspace.import requires a destination inside /workspace");
        const destination = await computers.importWorkspace(
          botId,
          outputRoot(),
          input.source,
          input.destination,
        );
        return {content: `Imported ${input.source} to ${destination}.`, metadata: {path: destination, action: "import"}};
      }
      throw new Error("team_workspace.action must be export or import");
    },
  };
}

function safeId(botId: string): string {
  return botId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 32) || "member";
}
function containerName(botId: string): string {
  return `polymux-team-${safeId(botId)}`;
}
function volumeName(botId: string): string {
  return `polymux-team-${safeId(botId)}-workspace`;
}

export function teamWorkspaceTarget(value: string): string {
  const normalized = value.trim().replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").some((part) => part === ".."))
    throw new Error("Team workspace paths must stay relative to /workspace");
  const target = path.posix.normalize(`/workspace/${normalized}`);
  if (target !== "/workspace" && !target.startsWith("/workspace/"))
    throw new Error("Team workspace paths must stay relative to /workspace");
  return target;
}

async function writablePathWithin(root: string, relative: string): Promise<string> {
  if (!relative.trim() || path.isAbsolute(relative))
    throw new Error("Export destinations must be relative to the managed output folder");
  const realRoot = await realpath(root);
  const destination = path.resolve(realRoot, relative);
  if (!isWithin(realRoot, destination))
    throw new Error("Export destinations must stay in the managed output folder");
  await mkdir(path.dirname(destination), {recursive: true});
  const realParent = await realpath(path.dirname(destination));
  if (!isWithin(realRoot, realParent))
    throw new Error("Export destinations must stay in the managed output folder");
  return destination;
}

async function readablePathWithin(root: string, relative: string): Promise<string> {
  if (!relative.trim() || path.isAbsolute(relative))
    throw new Error("Import sources must be relative to the managed output folder");
  const realRoot = await realpath(root);
  const source = await realpath(path.resolve(realRoot, relative));
  if (!isWithin(realRoot, source))
    throw new Error("Import sources must stay in the managed output folder");
  return source;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Pure command construction kept public so the isolation boundary is tested
 * without starting a real Docker Desktop or Podman machine. */
export function teamContainerCreateArgs(botId: string): string[] {
  return [
    "run", "-d",
    "--name", containerName(botId),
    "--label", "app.polymux.bot=true",
    "--label", `app.polymux.member-id=${botId}`,
    "--restart", "unless-stopped",
    "--network", "none",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--pids-limit", "512",
    "--memory", "2g",
    "--cpus", "2",
    "--read-only",
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=268435456",
    "--mount", `type=volume,src=${volumeName(botId)},dst=/workspace`,
    "--workdir", "/workspace",
    "--env", "HOME=/workspace",
    IMAGE,
    "sh", "-lc", "chmod 700 /workspace && exec tail -f /dev/null",
  ];
}

export function teamBashExecArgs(botId: string, command: string, timeoutSeconds: number): string[] {
  return [
    "exec", containerName(botId),
    "timeout", "-s", "TERM", "-k", "5", `${timeoutSeconds}s`,
    "sh", "-lc", command,
  ];
}

export interface ContainerCommandOptions {
  allowFailure?: boolean;
  signal?: AbortSignal;
  stdin?: string;
  timeout?: number;
}

export async function runContainerCommand(
  command: string,
  args: string[],
  options: ContainerCommandOptions = {},
): Promise<{code: number; output: string}> {
  const child = spawn(command, args, {stdio: ["pipe", "pipe", "pipe"]});
  const chunks: Buffer[] = [];
  let bytes = 0;
  const collect = (chunk: Buffer) => {
    if (bytes >= OUTPUT_LIMIT) return;
    const remaining = OUTPUT_LIMIT - bytes;
    const kept = chunk.subarray(0, remaining);
    chunks.push(kept);
    bytes += kept.byteLength;
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  if (options.stdin !== undefined) child.stdin.end(options.stdin);
  else child.stdin.end();
  let timedOut = false;
  let forceTimer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    child.kill("SIGTERM");
    forceTimer ??= setTimeout(() => child.kill("SIGKILL"), PROCESS_KILL_GRACE_MS);
    forceTimer.unref?.();
  };
  options.signal?.addEventListener("abort", stop, {once: true});
  if (options.signal?.aborted) stop();
  const timeout = options.timeout ?? PROCESS_TIMEOUT_MS;
  const timer = setTimeout(() => {
    timedOut = true;
    stop();
  }, timeout);
  timer.unref?.();
  try {
    const code = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (value) => resolve(value ?? 1));
    });
    if (options.signal?.aborted) throw options.signal.reason;
    if (timedOut) throw new Error(`${command} timed out after ${timeout}ms`);
    const output = Buffer.concat(chunks).toString("utf8").trimEnd();
    if (code !== 0 && !options.allowFailure) throw new Error(output || `${command} exited with code ${code}`);
    return {code, output};
  } finally {
    clearTimeout(timer);
    if (forceTimer) clearTimeout(forceTimer);
    options.signal?.removeEventListener("abort", stop);
  }
}

function commandResult(
  result: {code: number; output: string},
  metadata: Record<string, unknown> = {},
): AgentToolResult {
  return {
    content: `${result.output}${result.output ? "\n\n" : ""}Process exited with code ${result.code}`,
    isError: result.code !== 0,
    metadata: {...metadata, exitCode: result.code},
  };
}
