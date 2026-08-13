import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { MemoryRecord, Storage } from "@midas/storage";

const notePrefix = "<!-- midas-memory:";
const noteSuffix = " -->";

export interface MemoryManagerOptions {
  directory: string;
  legacyStorage?: Storage;
  clock?: () => Date;
  id?: () => string;
}

export interface MemoryPromptContext {
  summary: string;
  registryPath: string;
  conversationMemories: MemoryRecord[];
}

export interface MemoryVaultStatus {
  directory: string;
  registryPath: string;
  summaryPath: string;
  memories: number;
  userMemories: number;
  conversationMemories: number;
  rolloutSummaries: number;
  latestMemoryAt: string | null;
  latestRolloutAt: string | null;
}

export interface RolloutSummaryInput {
  conversationId: string;
  runId: string;
  userText: string;
  assistantText: string;
}

/**
 * A local, reviewable memory vault modelled after Codex Desktop's memory
 * layout. SQLite remains responsible for conversation state and compaction;
 * durable memory lives in plain Markdown files that can be opened, searched,
 * diffed, backed up, and edited outside Midas.
 */
export class MemoryManager {
  readonly directory: string;
  readonly registryPath: string;
  readonly summaryPath: string;
  readonly notesDirectory: string;
  readonly rolloutsDirectory: string;
  readonly archiveDirectory: string;
  readonly #clock: () => Date;
  readonly #id: () => string;

  constructor(options: MemoryManagerOptions) {
    this.directory = path.resolve(options.directory);
    this.registryPath = path.join(this.directory, "MEMORY.md");
    this.summaryPath = path.join(this.directory, "memory_summary.md");
    this.notesDirectory = path.join(
      this.directory,
      "extensions",
      "ad_hoc",
      "notes",
    );
    this.rolloutsDirectory = path.join(this.directory, "rollout_summaries");
    this.archiveDirectory = path.join(this.directory, "archive");
    this.#clock = options.clock ?? (() => new Date());
    this.#id = options.id ?? (() => crypto.randomUUID());
    this.#initialize();
    if (options.legacyStorage) this.#migrateLegacy(options.legacyStorage);
  }

  list(conversationId?: string): MemoryRecord[] {
    return this.#all().filter(
      (memory) =>
        memory.scope === "user" ||
        (conversationId !== undefined &&
          memory.scope === "conversation" &&
          memory.scopeId === conversationId),
    );
  }

  promptContext(conversationId?: string): MemoryPromptContext {
    const summary = readFile(this.summaryPath).trim();
    return {
      summary,
      registryPath: this.registryPath,
      conversationMemories: conversationId
        ? this.#all().filter(
            (memory) =>
              memory.scope === "conversation" &&
              memory.scopeId === conversationId,
          )
        : [],
    };
  }

  status(): MemoryVaultStatus {
    const memories = this.#all();
    const rollouts = readdirSync(this.rolloutsDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => statSync(path.join(this.rolloutsDirectory, entry.name)).mtime.toISOString())
      .sort((a, b) => b.localeCompare(a));
    return {
      directory: this.directory,
      registryPath: this.registryPath,
      summaryPath: this.summaryPath,
      memories: memories.length,
      userMemories: memories.filter((memory) => memory.scope === "user").length,
      conversationMemories: memories.filter((memory) => memory.scope === "conversation").length,
      rolloutSummaries: rollouts.length,
      latestMemoryAt: memories[0]?.updatedAt ?? null,
      latestRolloutAt: rollouts[0] ?? null,
    };
  }

  remember(
    content: string,
    options: {
      conversationId?: string;
      kind?: string;
      confidence?: number;
    } = {},
  ): MemoryRecord {
    const trimmed = content.trim();
    if (!trimmed) throw new Error("Memory content cannot be empty");
    const existing = this.#all().find(
      (memory) =>
        normalize(memory.content) === normalize(trimmed) &&
        memory.scopeId === (options.conversationId ?? null),
    );
    if (existing) return existing;
    const now = this.#clock().toISOString();
    const memory: MemoryRecord = {
      id: this.#id(),
      scope: options.conversationId ? "conversation" : "user",
      scopeId: options.conversationId ?? null,
      kind: options.kind?.trim() || "learning",
      content: trimmed,
      sourceConversationId: options.conversationId ?? null,
      confidence: clamp(options.confidence ?? 1, 0, 1),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      metadata: {},
    };
    this.#write(memory);
    this.#rebuildIndexes();
    return memory;
  }

  forget(id: string): boolean {
    const file = this.#noteFiles().find((candidate) => readNote(candidate)?.id === id);
    if (!file) return false;
    const destination = uniquePath(
      this.archiveDirectory,
      `${path.basename(file, ".md")}.deleted.md`,
    );
    renameSync(file, destination);
    this.#rebuildIndexes();
    return true;
  }

  recordRollout(input: RolloutSummaryInput): string {
    const timestamp = this.#clock().toISOString();
    const filename = `${fileTimestamp(timestamp)}-${safeStem(input.runId)}.md`;
    const target = uniquePath(this.rolloutsDirectory, filename);
    writeFileSync(
      target,
      [
        "# Conversation rollout",
        "",
        `conversation_id: ${input.conversationId}`,
        `run_id: ${input.runId}`,
        `updated_at: ${timestamp}`,
        "",
        "## User",
        "",
        bounded(input.userText),
        "",
        "## Assistant",
        "",
        bounded(input.assistantText),
        "",
      ].join("\n"),
      "utf8",
    );
    return target;
  }

  #initialize(): void {
    for (const directory of [
      this.directory,
      this.notesDirectory,
      this.rolloutsDirectory,
      this.archiveDirectory,
    ])
      mkdirSync(directory, { recursive: true });
    if (!existsSync(this.registryPath)) writeFileSync(this.registryPath, registry([]));
    if (!existsSync(this.summaryPath)) writeFileSync(this.summaryPath, summary([]));
  }

  #migrateLegacy(storage: Storage): void {
    const marker = path.join(this.directory, ".sqlite-memory-migrated-v1");
    if (existsSync(marker)) return;
    for (const memory of storage.listMemories({ includeDeleted: false })) {
      if (this.#all().some((item) => item.id === memory.id)) continue;
      this.#write(memory);
    }
    this.#rebuildIndexes();
    writeFileSync(marker, `${this.#clock().toISOString()}\n`, "utf8");
  }

  #write(memory: MemoryRecord): void {
    const filename = `${fileTimestamp(memory.createdAt)}-${safeStem(memory.id)}.md`;
    const target = uniquePath(this.notesDirectory, filename);
    const metadata = JSON.stringify({
      id: memory.id,
      scope: memory.scope,
      scopeId: memory.scopeId,
      kind: memory.kind,
      sourceConversationId: memory.sourceConversationId,
      confidence: memory.confidence,
      createdAt: memory.createdAt,
      updatedAt: memory.updatedAt,
    });
    writeFileSync(
      target,
      `${notePrefix}${metadata}${noteSuffix}\n${memory.content.trim()}\n`,
      "utf8",
    );
  }

  #all(): MemoryRecord[] {
    return this.#noteFiles()
      .map(readNote)
      .filter((memory): memory is MemoryRecord => memory !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  #noteFiles(): string[] {
    return readdirSync(this.notesDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => path.join(this.notesDirectory, entry.name));
  }

  #rebuildIndexes(): void {
    const memories = this.#all();
    writeFileSync(this.registryPath, registry(memories), "utf8");
    writeFileSync(this.summaryPath, summary(memories), "utf8");
  }
}

function readNote(file: string): MemoryRecord | null {
  const source = readFile(file);
  const newline = source.indexOf("\n");
  const header = newline < 0 ? source : source.slice(0, newline);
  if (!header.startsWith(notePrefix) || !header.endsWith(noteSuffix)) return null;
  try {
    const value = JSON.parse(
      header.slice(notePrefix.length, -noteSuffix.length),
    ) as Omit<MemoryRecord, "content" | "deletedAt" | "metadata">;
    if (!value.id || !value.scope || !value.createdAt) return null;
    return {
      ...value,
      scopeId: value.scopeId ?? null,
      sourceConversationId: value.sourceConversationId ?? null,
      confidence: clamp(value.confidence ?? 1, 0, 1),
      content: (newline < 0 ? "" : source.slice(newline + 1)).trim(),
      deletedAt: null,
      metadata: {},
    };
  } catch {
    return null;
  }
}

function registry(memories: MemoryRecord[]): string {
  const user = memories.filter((memory) => memory.scope === "user");
  const conversations = memories.filter(
    (memory) => memory.scope === "conversation",
  );
  return [
    "# Midas Memory",
    "",
    "Local memory registry built from reviewable Markdown source notes.",
    "",
    "## User memory",
    "",
    ...registryLines(user),
    "",
    "## Conversation memory",
    "",
    ...registryLines(conversations),
    "",
  ].join("\n");
}

function registryLines(memories: MemoryRecord[]): string[] {
  if (!memories.length) return ["No memories yet."];
  return memories.map((memory) => {
    const scope = memory.scopeId ? ` conversation:${memory.scopeId}` : "";
    return `- ${memory.content.replaceAll("\n", " ")}  \n  \`${memory.kind}${scope}\` · confidence ${memory.confidence.toFixed(2)} · updated ${memory.updatedAt}`;
  });
}

function summary(memories: MemoryRecord[]): string {
  const top = memories
    .filter((memory) => memory.scope === "user")
    .sort(
      (a, b) =>
        b.confidence - a.confidence || b.updatedAt.localeCompare(a.updatedAt),
    )
    .slice(0, 40);
  return [
    "# Memory Summary",
    "",
    "Reviewable local context maintained by Midas.",
    "",
    ...(top.length
      ? top.map((memory) => `- ${memory.content.replaceAll("\n", " ")}`)
      : ["No user memories yet."]),
    "",
  ].join("\n");
}

function readFile(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function uniquePath(directory: string, filename: string): string {
  const extension = path.extname(filename);
  const stem = path.basename(filename, extension);
  let target = path.join(directory, filename);
  let suffix = 2;
  while (existsSync(target)) target = path.join(directory, `${stem}-${suffix++}${extension}`);
  return target;
}

function fileTimestamp(value: string): string {
  return value.replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
}

function safeStem(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "memory";
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function bounded(value: string, limit = 12_000): string {
  const trimmed = value.trim();
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit)}\n\n[truncated]`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
