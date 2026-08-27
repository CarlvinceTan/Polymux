import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { writeFileAtomicSync } from "@polymux/core";
import type { MemoryRecord } from "@polymux/storage";

const notePrefix = "<!-- polymux-memory:";
const noteSuffix = " -->";

export interface MemoryManagerOptions {
  directory: string;
  clock?: () => Date;
  id?: () => string;
}

export interface MemoryPromptContext {
  enabled: boolean;
  summary: string;
  registryPath: string;
  conversationMemories: MemoryRecord[];
}

/**
 * Progress of the background consolidation job, mirroring the watermark and
 * retry bookkeeping Codex keeps in its own memory job table.
 */
export interface MemoryConsolidationState {
  /** updatedAt of the newest memory folded into the current summary. */
  watermark: string | null;
  consolidatedAt: string | null;
  consecutiveFailures: number;
  /** Earliest time a failed job may run again; null when healthy. */
  retryAfter: string | null;
  lastError: string | null;
}

/**
 * Failures back off but never stop permanently. Consolidation only runs after
 * a turn that completed, so the model was working moments earlier and any
 * failure is transient by construction. Backoff exists only so a deterministic
 * failure — memories that overflow the model's context, say — costs one
 * request per window instead of one per turn.
 */
const retryBaseMinutes = 10;
const retryCapMinutes = 360;

const emptyConsolidation: MemoryConsolidationState = {
  watermark: null,
  consolidatedAt: null,
  consecutiveFailures: 0,
  retryAfter: null,
  lastError: null,
};

export interface MemoryVaultStatus {
  enabled: boolean;
  directory: string;
  storedBytes: number;
  registryPath: string;
  summaryPath: string;
  memories: number;
  userMemories: number;
  conversationMemories: number;
  latestMemoryAt: string | null;
  /** When the consolidation job last succeeded, null if it never has. */
  consolidatedAt: string | null;
  /** Why the last consolidation attempt failed, null when healthy. */
  consolidationError: string | null;
  /** When a failed consolidation will retry itself, null when healthy. */
  consolidationRetryAfter: string | null;
  /** Memories waiting for the next consolidation run. */
  pendingMemories: number;
}

/**
 * A local, reviewable vault for durable memories the agent saves. Computer
 * history has its own store and retrieval tools; it never becomes a memory by
 * passing through this manager. SQLite remains responsible for conversation
 * state and compaction, while memory lives in plain Markdown files that can be
 * opened, searched, diffed, backed up, and edited outside Polymux.
 */
export class MemoryManager {
  readonly directory: string;
  readonly registryPath: string;
  readonly summaryPath: string;
  readonly notesDirectory: string;
  readonly archiveDirectory: string;
  readonly settingsPath: string;
  readonly consolidationPath: string;
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
    this.archiveDirectory = path.join(this.directory, "archive");
    this.settingsPath = path.join(this.directory, "settings.json");
    this.consolidationPath = path.join(this.directory, "consolidation.json");
    this.#clock = options.clock ?? (() => new Date());
    this.#id = options.id ?? (() => crypto.randomUUID());
    this.#initialize();
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
    const enabled = this.enabled();
    return {
      enabled,
      summary: enabled ? this.#promptSummary() : "",
      registryPath: this.registryPath,
      conversationMemories: enabled && conversationId
        ? this.#all().filter(
            (memory) =>
              memory.scope === "conversation" &&
              memory.scopeId === conversationId,
          )
        : [],
    };
  }

  /**
   * The consolidated summary plus anything remembered since it last ran, so a
   * new memory still reaches the prompt while the next job is pending.
   */
  #promptSummary(): string {
    const summary = readFile(this.summaryPath).trim();
    // Before the first consolidation the summary is the mechanical dump, which
    // already lists everything; appending would duplicate it.
    if (this.consolidationState().watermark === null) return summary;
    const pending = this.pendingMemories();
    if (!pending.length) return summary;
    return [
      summary,
      `## Not yet consolidated\n\n${pending
        .map((memory) => `- ${memory.content.replaceAll("\n", " ")}`)
        .join("\n")}`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  consolidationState(): MemoryConsolidationState {
    try {
      return {
        ...emptyConsolidation,
        ...(JSON.parse(
          readFileSync(this.consolidationPath, "utf8"),
        ) as Partial<MemoryConsolidationState>),
      };
    } catch {
      return { ...emptyConsolidation };
    }
  }

  /** User memories not yet folded into the consolidated summary. */
  pendingMemories(): MemoryRecord[] {
    const { watermark } = this.consolidationState();
    return this.#all().filter(
      (memory) =>
        memory.scope === "user" &&
        (watermark === null || memory.updatedAt > watermark),
    );
  }

  userMemories(): MemoryRecord[] {
    return this.#all().filter((memory) => memory.scope === "user");
  }

  saveConsolidation(
    text: string,
    watermark: string,
  ): MemoryConsolidationState {
    writeFileAtomicSync(this.summaryPath, `${text.trim()}\n`);
    return this.#writeConsolidation({
      watermark,
      consolidatedAt: this.#clock().toISOString(),
      consecutiveFailures: 0,
      retryAfter: null,
      lastError: null,
    });
  }

  recordConsolidationFailure(message: string): MemoryConsolidationState {
    const state = this.consolidationState();
    const failures = state.consecutiveFailures + 1;
    const minutes = Math.min(
      retryBaseMinutes * 2 ** (failures - 1),
      retryCapMinutes,
    );
    return this.#writeConsolidation({
      ...state,
      consecutiveFailures: failures,
      retryAfter: new Date(
        this.#clock().getTime() + minutes * 60_000,
      ).toISOString(),
      lastError: message,
    });
  }

  /** False only while a failed job is still inside its backoff window. */
  consolidationReady(): boolean {
    const { retryAfter } = this.consolidationState();
    return !retryAfter || this.#clock().toISOString() >= retryAfter;
  }


  #writeConsolidation(
    state: MemoryConsolidationState,
  ): MemoryConsolidationState {
    writeFileAtomicSync(
      this.consolidationPath,
      `${JSON.stringify(state, null, 2)}\n`,
    );
    return state;
  }

  status(): MemoryVaultStatus {
    const memories = this.#all();
    const consolidation = this.consolidationState();
    return {
      enabled: this.enabled(),
      directory: this.directory,
      storedBytes: directoryBytes(this.directory),
      registryPath: this.registryPath,
      summaryPath: this.summaryPath,
      memories: memories.length,
      userMemories: memories.filter((memory) => memory.scope === "user").length,
      conversationMemories: memories.filter((memory) => memory.scope === "conversation").length,
      latestMemoryAt: memories[0]?.updatedAt ?? null,
      consolidatedAt: consolidation.consolidatedAt,
      consolidationError: consolidation.lastError,
      consolidationRetryAfter: consolidation.retryAfter,
      pendingMemories: this.pendingMemories().length,
    };
  }

  enabled(): boolean {
    try {
      return (JSON.parse(readFileSync(this.settingsPath, "utf8")) as {enabled?: unknown}).enabled !== false;
    } catch {
      return true;
    }
  }

  setEnabled(enabled: boolean): MemoryVaultStatus {
    writeFileAtomicSync(this.settingsPath, `${JSON.stringify({enabled}, null, 2)}\n`);
    return this.status();
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

  #initialize(): void {
    for (const directory of [
      this.directory,
      this.notesDirectory,
      this.archiveDirectory,
    ])
      mkdirSync(directory, { recursive: true });
    if (!existsSync(this.registryPath)) writeFileAtomicSync(this.registryPath, registry([]));
    if (!existsSync(this.summaryPath)) writeFileAtomicSync(this.summaryPath, summary([]));
    if (!existsSync(this.settingsPath)) writeFileAtomicSync(this.settingsPath, `${JSON.stringify({enabled: true}, null, 2)}\n`);
    if (this.#archiveLegacyScreenMemories()) {
      // Older builds copied distilled Computer History into this vault as
      // `screen` notes. Preserve those source files in the archive, then make
      // every active index describe only genuine saved memories.
      this.#writeConsolidation({ ...emptyConsolidation });
      this.#rebuildIndexes();
    }
  }

  #archiveLegacyScreenMemories(): boolean {
    let migrated = false;
    for (const file of this.#noteFiles()) {
      if (readNote(file)?.kind !== "screen") continue;
      renameSync(
        file,
        uniquePath(
          this.archiveDirectory,
          `${path.basename(file, ".md")}.computer-history.md`,
        ),
      );
      migrated = true;
    }
    return migrated;
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
    writeFileAtomicSync(
      target,
      `${notePrefix}${metadata}${noteSuffix}\n${memory.content.trim()}\n`,
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
    writeFileAtomicSync(this.registryPath, registry(memories));
    // Once consolidation owns the summary, the mechanical dump must not
    // overwrite it. New memories reach the prompt through pendingMemories()
    // until the next job runs.
    if (this.consolidationState().watermark === null)
      writeFileAtomicSync(this.summaryPath, summary(memories));
  }
}

function directoryBytes(directory: string): number {
  return readdirSync(directory, {withFileTypes: true}).reduce((total, entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return total + directoryBytes(target);
    if (entry.isFile()) return total + statSync(target).size;
    return total;
  }, 0);
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
    "# Polymux Memory",
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

/**
 * Every user memory, grouped by kind, followed by a "What's in Memory" index.
 * Modelled after Codex Desktop: nothing is truncated, so a memory can never be
 * dropped without leaving a trace, and the index gives a structural read of the
 * vault before the agent decides whether to open the registry.
 */
function summary(memories: MemoryRecord[]): string {
  const header = [
    "# Memory Summary",
    "",
    "Reviewable local context maintained by Polymux.",
    "",
  ];
  const groups = groupByKind(memories.filter((memory) => memory.scope === "user"));
  if (!groups.length) return [...header, "No user memories yet.", ""].join("\n");
  const total = groups.reduce((count, group) => count + group.entries.length, 0);
  return [
    ...header,
    ...groups.flatMap((group) => [
      `## ${capitalize(group.kind)}`,
      "",
      ...group.entries.map((memory) => `- ${memory.content.replaceAll("\n", " ")}`),
      "",
    ]),
    "## What's in Memory",
    "",
    ...groups.map(
      (group) =>
        `- ${group.kind}: ${group.entries.length} ${group.entries.length === 1 ? "entry" : "entries"}, latest ${group.latest.slice(0, 10)}`,
    ),
    "",
    `All ${total} user ${total === 1 ? "memory is" : "memories are"} listed above in full. \`MEMORY.md\` holds the same entries with kind, confidence, and timestamps, plus any conversation-scoped memory.`,
    "",
  ].join("\n");
}

interface KindGroup {
  kind: string;
  entries: MemoryRecord[];
  confidence: number;
  latest: string;
}

/** Strongest kind first; within a kind, most confident then most recent. */
function groupByKind(memories: MemoryRecord[]): KindGroup[] {
  const groups = new Map<string, MemoryRecord[]>();
  for (const memory of memories) {
    const entries = groups.get(memory.kind);
    if (entries) entries.push(memory);
    else groups.set(memory.kind, [memory]);
  }
  return [...groups]
    .map(([kind, entries]) => {
      entries.sort(
        (a, b) =>
          b.confidence - a.confidence || b.updatedAt.localeCompare(a.updatedAt),
      );
      return {
        kind,
        entries,
        confidence: entries.reduce(
          (top, memory) => Math.max(top, memory.confidence),
          0,
        ),
        latest: entries.reduce(
          (newest, memory) =>
            memory.updatedAt > newest ? memory.updatedAt : newest,
          "",
        ),
      };
    })
    .sort(
      (left, right) =>
        right.confidence - left.confidence || left.kind.localeCompare(right.kind),
    );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
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


function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
