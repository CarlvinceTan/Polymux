import { GenerationRate } from "./generation-rate.js";
import type { RunEventDto } from "@polymux/protocol";

export interface TranscriptRow {
  id: string;
  kind: "user" | "assistant" | "thought" | "tool" | "notice";
  text: string;
  detail?: string;
  toolName?: string;
  manualShell?: boolean;
  toolPath?: string;
  childRunId?: string;
  childSequence?: number;
  childSettled?: boolean;
  agentName?: string;
  startedAt?: number;
  endedAt?: number;
  status?: "running" | "completed" | "failed" | "cancelled";
  expanded?: boolean;
}

export function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

export function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  return Array.isArray(value)
    ? value
        .filter((block) => block?.type === "text")
        .map((block) => block.text ?? "")
        .join("\n")
    : "";
}

/** Durable event replay and live updates share one reducer and stable row IDs. */
export class Transcript {
  rows: TranscriptRow[] = [];
  sequence = 0;
  runId = "";
  status: "idle" | "running" | "completed" | "failed" | "cancelled" = "idle";
  model = "";
  contextWindow = 0;
  contextTokens: number | null = null;
  rate: number | null = null;
  working = false;
  private generationRate = new GenerationRate();
  private activeThought?: TranscriptRow;
  private settledTurns = new Set<string>();

  begin(runId: string): void {
    this.runId = runId;
    this.sequence = 0;
    this.status = "running";
    this.working = true;
    this.activeThought = undefined;
  }

  private settleThought(now: number): void {
    if (!this.activeThought) return;
    this.activeThought.endedAt = now;
    this.activeThought.status = "completed";
    this.activeThought = undefined;
  }

  draft(value: { turn: number; text: string; timestamp: number }): void {
    if (this.settledTurns.has(`${this.runId}:${value.turn}`)) return;
    if (value.text) this.working = false;
    this.settleThought(value.timestamp);
    const id = `${this.runId}:${value.turn}:text`;
    const existing = this.rows.find((row) => row.id === id);
    const previousText = existing?.text ?? "";
    if (value.text.startsWith(previousText)) {
      this.generationRate.add(
        value.text.slice(previousText.length),
        value.timestamp,
      );
      this.rate = this.generationRate.rate;
    }
    if (existing) existing.text = value.text;
    else if (value.text)
      this.rows.push({
        id,
        kind: "assistant",
        text: value.text,
        status: "running",
        startedAt: value.timestamp,
      });
  }

  apply(event: RunEventDto): void {
    if (
      event.runId !== this.runId ||
      event.parentRunId ||
      event.sequence <= this.sequence
    )
      return;
    this.sequence = event.sequence;
    const p = record(event.payload);
    const now = event.timestamp;
    const key = `${event.runId}:${p.turn ?? 0}`;
    if (event.type === "model.started" || event.type === "run.started") {
      const model = record(p.model);
      if (model.id) this.model = `${model.provider}/${model.id}`;
      if (model.contextWindow) this.contextWindow = model.contextWindow;
      this.working = true;
      this.generationRate.start(this.model);
      this.rate = this.generationRate.rate;
    } else if (event.type === "message.reasoning.delta") {
      this.working = false;
      this.generationRate.add(typeof p.delta === "string" ? p.delta : "", now);
      this.rate = this.generationRate.rate;
      if (!this.activeThought) {
        this.activeThought = {
          id: `${key}:thought:${event.sequence}`,
          kind: "thought",
          text: "",
          startedAt: now,
          status: "running",
        };
        this.rows.push(this.activeThought);
      }
      this.activeThought.text += typeof p.delta === "string" ? p.delta : "";
    } else if (event.type === "message.text.delta") {
      this.working = false;
      this.generationRate.add(typeof p.delta === "string" ? p.delta : "", now);
      this.rate = this.generationRate.rate;
      this.settleThought(now);
      const id = `${key}:text`;
      let row = this.rows.find((row) => row.id === id);
      if (!row) {
        row = {
          id,
          kind: "assistant",
          text: "",
          status: "running",
          startedAt: now,
        };
        this.rows.push(row);
      }
      row.text += typeof p.delta === "string" ? p.delta : "";
    } else if (event.type === "message.completed") {
      this.working = false;
      this.settledTurns.add(key);
      this.settleThought(now);
      const message = record(p.message);
      const text = contentText(message.content);
      const row = this.rows.find((row) => row.id === `${key}:text`);
      if (row) {
        row.text = text;
        row.status = "completed";
        row.endedAt = now;
      } else if (text)
        this.rows.push({
          id: `${key}:text`,
          kind: "assistant",
          text,
          status: "completed",
          startedAt: now,
          endedAt: now,
        });
      const usage = record(message.usage);
      if (typeof usage.inputTokens === "number")
        this.contextTokens =
          usage.inputTokens +
          (usage.cacheReadTokens ?? 0) +
          (usage.cacheWriteTokens ?? 0) +
          (usage.outputTokens ?? 0);
      // Host reasoning may be a summary: do not calibrate from total usage.
      this.rate = this.generationRate.rate;
    } else if (event.type === "message.final_rejected") {
      this.settledTurns.add(key);
      this.rows = this.rows.filter((row) => row.id !== `${key}:text`);
    } else if (event.type.startsWith("tool.")) {
      this.working = false;
      this.settleThought(now);
      const call = record(p.toolCall);
      const id = `${event.runId}:tool:${call.id ?? p.toolCallId}`;
      let row = this.rows.find((row) => row.id === id);
      if (!row) {
        row = {
          id,
          kind: "tool",
          text: toolLabel(call.name ?? "Tool", call.arguments),
          toolName: call.name,
          toolPath: fileToolPath(call.name, call.arguments),
          startedAt: now,
          status: "running",
        };
        this.rows.push(row);
      }
      if (event.type === "tool.progress") {
        row.detail = typeof p.message === "string" ? p.message : row.detail;
        const progress = record(p.data);
        if (
          row.toolName === "subagent" &&
          typeof progress.childRunId === "string"
        )
          row.childRunId = progress.childRunId;
      }
      if (event.type === "tool.completed" || event.type === "tool.failed") {
        const result = record(p.result);
        // A fast worker can finish before the dispatch response is replayed.
        // That later receipt must not restart or overwrite the worker's result.
        if (row.toolName === "subagent" && row.childSettled) {
          const name = record(result.metadata).subagent;
          if (typeof name === "string") row.agentName = name;
          return;
        }
        row.status =
          event.type === "tool.failed" || result.isError
            ? "failed"
            : "completed";
        row.endedAt = now;
        row.detail =
          event.type === "tool.failed"
            ? String(record(p.error).message ?? "Tool failed")
            : contentText(result.content);
        if (row.toolName === "subagent" && row.status === "completed") {
          const metadata = record(result.metadata);
          if (typeof metadata.subagent === "string")
            row.agentName = metadata.subagent;
          if (row.childRunId && metadata.status === "running") {
            row.status = "running";
            row.endedAt = undefined;
            row.detail = undefined;
          }
        }
      }
    } else if (event.type === "agent.notice") {
      this.rows.push({
        id: `${key}:notice:${event.sequence}`,
        kind: "notice",
        startedAt: now,
        text: String(p.message ?? ""),
      });
    } else if (
      ["run.completed", "run.failed", "run.cancelled"].includes(event.type)
    ) {
      this.settleThought(now);
      this.working = false;
      this.status = event.type.slice(4) as "completed" | "failed" | "cancelled";
      for (const row of this.rows)
        if (row.status === "running" && !row.childRunId && !row.manualShell) {
          row.status = this.status === "completed" ? "failed" : this.status;
          row.endedAt = now;
        }
      const error = record(record(p.result).error).message;
      if (error)
        this.rows.push({
          id: `${key}:error`,
          kind: "notice",
          text: String(error),
        });
    }
  }

  applyChild(row: TranscriptRow, events: RunEventDto[]): void {
    for (const event of events) {
      if (
        event.runId !== row.childRunId ||
        event.sequence <= (row.childSequence ?? 0)
      )
        continue;
      row.childSequence = event.sequence;
      const payload = record(event.payload);
      if (event.type === "message.completed")
        row.detail = contentText(record(payload.message).content);
      if (
        ["run.completed", "run.failed", "run.cancelled"].includes(event.type)
      ) {
        row.status = event.type.slice(4) as
          "completed" | "failed" | "cancelled";
        row.endedAt = event.timestamp;
        row.childSettled = true;
        const error = record(record(payload.result).error).message;
        if (error) row.detail = String(error);
      }
    }
  }
}

export function toolLabel(name: string, args: unknown): string {
  if (name === "subagent")
    return String(record(args).description ?? "Subagent task");
  if (name.includes("__")) {
    const [server, ...tool] = name.replace(/^mcp__/, "").split("__");
    return `${mcpDisplayName(server)}: ${mcpDisplayName(tool.join(" "))}`;
  }
  const a = record(args);
  const value =
    a.command ??
    a.cmd ??
    a.path ??
    a.file_path ??
    a.query ??
    a.pattern ??
    a.description;
  const labels: Record<string, string> = {
    bash: "Run",
    exec_command: "Run",
    read: "Read",
    read_file: "Read",
    write: "Write",
    write_file: "Write",
    edit: "Edit",
    apply_patch: "Edit",
    grep: "Search",
    search: "Search",
  };
  const label =
    labels[name] ??
    name
      .replace(/^mcp__/, "")
      .replace(/__/g, " · ")
      .replace(/_/g, " ");
  return value
    ? `${label} ${String(value).replace(/\s+/g, " ").slice(0, 500)}`
    : label;
}

function mcpDisplayName(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function fileToolPath(name: string, args: unknown): string | undefined {
  if (!["read", "read_file", "write", "write_file", "edit"].includes(name))
    return;
  const a = record(args);
  const value = a.path ?? a.file_path;
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").slice(0, 500)
    : undefined;
}
