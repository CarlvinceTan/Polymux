import type {
  AgentRunEvent,
  AgentRunResult,
  ActiveAgentRun,
  AgentTool,
} from "@flareai/core";
import { AgentRunner, type ToolHooks } from "@flareai/core";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type {
  InferenceMessage,
  InferenceService,
  ModelRef,
  ReasoningEffort,
} from "@flareai/inference";
import type { JsonValue, Storage, StoredMessage } from "@flareai/storage";
import { ToolRegistry } from "@flareai/tools";
import { buildSystemPrompt } from "./prompts/system-prompt.js";
import {
  CompactionManager,
  type CompactionSettings,
} from "./context/compaction.js";
import {
  SkillLoader,
  parseSkillCommand,
  type SkillLoaderOptions,
} from "./skills/loader.js";
import { GoalManager } from "./goals/manager.js";
import { GoalJudge } from "./goals/judge.js";
import {
  GoalLoop,
  type GoalLoopDecision,
  type GoalLoopSettings,
} from "./goals/loop.js";
import {
  MemoryConsolidator,
  type MemoryConsolidationSettings,
} from "./memory/consolidator.js";
import type { ChronicleAccess } from "./memory/chronicle-access.js";
import {
  ChronicleDistiller,
  type ChronicleDistillationSettings,
} from "./memory/chronicle-distiller.js";
import { createChronicleTools } from "./memory/chronicle-tools.js";
import { createHistoryTools } from "./memory/history-tools.js";
import { MemoryManager } from "./memory/manager.js";
import { createMemoryTools } from "./memory/tools.js";
import { createTaskTool, type SubagentRequest } from "./subagents/task-tool.js";
import type { AgentToolContext } from "@flareai/core";

export type { ChronicleAccess } from "./memory/chronicle-access.js";

/**
 * Kept as the historical name for what the runtime asks of Chronicle. It is
 * now the wider reading surface in `ChronicleAccess`: the prompt line the
 * runtime always used, plus the queries the retrieval tools and the distiller
 * run. Both additions are optional, so a host supplying only a prompt context
 * still satisfies it.
 */
export type ChronicleContextProvider = ChronicleAccess;

export interface DriveContextProvider {
  promptContext(): DriveContext | undefined;
}

export interface DriveContext {
  defaultSource: string;
  order: string[];
  connected: string[];
  reach: string[];
}

export interface EnvironmentContextProvider {
  promptContext(): EnvironmentContext;
}

export interface EnvironmentContext {
  time?: { local: string; timeZone: string; utcOffset: string };
  locationEnabled: boolean;
  location?: {
    latitude: number;
    longitude: number;
    accuracy: number;
    updatedAt: string;
  };
  /** Tabs open in FlareAI's own browser, newest last. */
  browserTabs?: Array<{ tabId: string; url: string; title: string }>;
  /** Titled windows open on the desktop, frontmost first. */
  windows?: Array<{ app: string; title: string; frontmost: boolean }>;
}

export interface FlareAIAgentOptions {
  inference: InferenceService;
  storage: Storage;
  memory: MemoryManager;
  chronicle?: ChronicleContextProvider;
  drive?: DriveContextProvider;
  environment?: EnvironmentContextProvider;
  tools: ToolRegistry;
  model: ModelRef;
  /** Model subagent (Task tool) runs use. Falls back to `model`. */
  taskModel?: ModelRef;
  /** Model the goal judge reads with. Falls back to `model`. */
  judgeModel?: ModelRef;
  /** Model that writes compaction summaries. Falls back to `model`. */
  compactionModel?: ModelRef;
  /** Effort subagent runs think at. Falls back to the parent run's level. */
  taskReasoning?: ReasoningEffort;
  /** Effort the goal judge thinks at. Falls back to the run's level. */
  judgeReasoning?: ReasoningEffort;
  /** Effort the compaction summary is written at. Falls back to the run's. */
  compactionReasoning?: ReasoningEffort;
  reasoning?: ReasoningEffort;
  basePrompt?: string;
  communicationPrompt?: string;
  skills?: SkillLoaderOptions;
  compaction?: Partial<CompactionSettings>;
  memoryConsolidation?: Partial<MemoryConsolidationSettings>;
  chronicleDistillation?: Partial<ChronicleDistillationSettings>;
  maxTurns?: number;
  /** Host lifecycle hooks that can veto or observe every tool call. */
  hooks?: ToolHooks;
  goalLoop?: Partial<GoalLoopSettings>;
  /**
   * Called when a standing goal drives another run. The host owns run
   * plumbing, so it needs the continuation run to forward its events and to
   * keep it cancellable.
   */
  onGoalContinuation?: (continuation: GoalContinuation) => void;
  /**
   * Called when the `task` tool starts a subagent. Subagent runs are started
   * inside the runtime rather than by the host, so without this the host never
   * sees them — and their events, which is what a task's transcript is made
   * of, would reach storage and nothing else.
   */
  onSubagentRun?: (subagent: SubagentRun) => void;
}

export interface SubagentRun {
  conversationId: string;
  parentRunId: string;
  runId: string;
  description: string;
  run: ActiveAgentRun;
}

export interface GoalContinuation {
  conversationId: string;
  previousRunId: string;
  runId: string;
  run: ActiveAgentRun;
  decision: GoalLoopDecision;
}

export interface StartFlareAIRunInput {
  conversationId: string;
  text: string;
  userMessageId?: string;
  runId?: string;
  signal?: AbortSignal;
  includeSubagents?: boolean;
  parentRunId?: string;
  contextMode?: "conversation" | "none" | "recent";
  attachments?: string[];
  asGoal?: boolean;
  maxTurns?: number;
  reasoning?: ReasoningEffort;
  /**
   * Set when the goal loop started this run rather than the user. Such a run
   * does not reset the turn budget and its prompt is hidden from the
   * transcript.
   */
  goalContinuation?: boolean;
  /** Overrides the agent's main model for this run only. */
  model?: ModelRef;
  /**
   * Set while the user is speaking rather than typing. Transcribed speech is
   * indistinguishable from typed text, so the prompt has to say which it is.
   */
  speechMode?: boolean;
}

export class FlareAIAgent {
  readonly goals: GoalManager;
  readonly goalLoop: GoalLoop;
  readonly memory: MemoryManager;
  readonly #options: FlareAIAgentOptions;
  readonly #compaction: CompactionManager;
  readonly #consolidator: MemoryConsolidator;
  readonly #distiller?: ChronicleDistiller;
  readonly #skillLoader: SkillLoader;
  readonly #goalWork = new Set<Promise<void>>();
  constructor(options: FlareAIAgentOptions) {
    this.#options = options;
    this.goals = new GoalManager(options.storage);
    this.goalLoop = new GoalLoop(
      this.goals,
      new GoalJudge(options.inference),
      options.goalLoop,
    );
    this.memory = options.memory;
    this.#compaction = new CompactionManager(
      options.inference,
      options.storage,
      options.compaction,
    );
    this.#consolidator = new MemoryConsolidator(
      options.inference,
      options.memory,
      options.memoryConsolidation,
    );
    this.#distiller = options.chronicle
      ? new ChronicleDistiller(
          options.inference,
          options.memory,
          options.chronicle,
          options.chronicleDistillation,
        )
      : undefined;
    this.#skillLoader = new SkillLoader(options.skills);
  }

  start(input: StartFlareAIRunInput): ActiveAgentRun {
    const conversation = this.#options.storage.getConversation(
      input.conversationId,
    );
    if (!conversation)
      throw new Error(`Conversation not found: ${input.conversationId}`);
    const skillResult = this.#skillLoader.load();
    const skillCommand = parseSkillCommand(input.text, skillResult.skills);
    const text = skillCommand
      ? `${readSkill(skillCommand.skill.filePath)}${skillCommand.arguments ? `\n\nUser: ${skillCommand.arguments}` : ""}`
      : input.text;
    // A user-driven turn is the goal loop's preemption point: the budget starts
    // over so a fresh instruction is never starved by turns an earlier one
    // spent.
    if (!input.parentRunId && !input.goalContinuation)
      this.goalLoop.resetBudget(input.conversationId);
    if (input.asGoal) {
      const existing = this.goals.get(input.conversationId);
      if (existing && existing.status !== "completed")
        this.goals.execute(input.conversationId, { action: "clear" });
      this.goals.execute(input.conversationId, {
        action: "create",
        objective: input.text,
      });
    }
    const runId = input.runId ?? crypto.randomUUID();
    if (!input.parentRunId) {
      const message = this.#options.storage.appendMessage({
        id: input.userMessageId ?? crypto.randomUUID(),
        conversationId: input.conversationId,
        runId: null,
        role: "user",
        content: text,
        metadata: input.asGoal
          ? { asGoal: true }
          : input.goalContinuation
            ? { goalContinuation: true }
            : {},
      });
      for (const attachmentPath of input.attachments ?? []) {
        this.#options.storage.addAttachment({
          id: crypto.randomUUID(),
          messageId: message.id,
          name: basename(attachmentPath),
          path: attachmentPath,
          mimeType: null,
          size: null,
          sha256: null,
        });
      }
    }
    const model = input.model ?? this.#options.model;
    this.#options.storage.createRun({
      id: runId,
      conversationId: input.conversationId,
      parentRunId: input.parentRunId,
      model: `${model.provider}/${model.id}`,
      status: "running",
    });
    const stored = this.#options.storage.listMessages(input.conversationId);
    // Each converted message stays paired with the row it came from: not every
    // stored row converts, so position in one list says nothing about the
    // other, and compaction needs the real mapping to record how far a summary
    // reaches.
    const durable: Array<{ message: InferenceMessage; sequence: number }> = [];
    for (const message of stored) {
      const converted = toInferenceMessage(
        message,
        this.#options.storage
          .listAttachments(message.id)
          .map((attachment) => attachment.path),
      );
      if (converted)
        durable.push({ message: converted, sequence: message.sequence });
    }
    const selected = selectContext(
      durable,
      input.contextMode ?? "conversation",
    );
    const messages = selected.map((item) => item.message);
    const durableSequences: Array<number | null> = selected.map(
      (item) => item.sequence,
    );
    // A subagent's instruction is context for this run alone and is never
    // stored, so it has no sequence of its own.
    if (input.parentRunId) {
      messages.push({ role: "user", content: text });
      durableSequences.push(null);
    }
    // One flag drives both the tool and the policy that describes it, so a
    // subagent is never told to delegate with no `task` tool to delegate with.
    const delegation = input.includeSubagents !== false;
    const memory = this.memory.promptContext(input.conversationId);
    const chronicle = this.#options.chronicle?.promptContext();
    const environment = this.#options.environment?.promptContext();
    const systemPrompt = buildSystemPrompt({
      basePrompt: this.#options.basePrompt,
      communicationPrompt: this.#options.communicationPrompt,
      preferences: this.#options.storage.listPreferences(),
      memorySummary: memory.enabled ? memory.summary : undefined,
      memoryRegistryPath: memory.enabled ? memory.registryPath : undefined,
      historySearch: true,
      delegation,
      memories: memory.enabled ? memory.conversationMemories : [],
      chronicle: chronicle?.enabled ? chronicle : undefined,
      drive: this.#options.drive?.promptContext(),
      environment,
      skills: skillResult.skills,
      goal: this.goals.get(input.conversationId),
      speechMode: input.speechMode,
    });
    // The screen is the user's own run's to move: a delegated run never gets
    // the tools that decide what is on it, and says so in its answer instead.
    const subagentRun = Boolean(input.parentRunId);
    const tools = [
      ...this.#options.tools
        .list()
        .filter((tool) => !subagentRun || !tool.mainAgentOnly),
      ...this.goals.tools(input.conversationId),
      ...createMemoryTools(this.memory, input.conversationId),
      ...createHistoryTools(this.#options.storage, input.conversationId),
      ...(chronicle?.enabled && this.#options.chronicle
        ? createChronicleTools(this.#options.chronicle)
        : []),
    ];
    if (delegation)
      tools.push(
        createTaskTool((request, context) =>
          this.#runSubagent(input.conversationId, runId, request, context),
        ),
      );
    const runner = new AgentRunner({
      inference: this.#options.inference,
      eventSink: { append: (event) => this.#persistEvent(event) },
      hooks: this.#options.hooks,
    });
    const active = runner.start({
      runId,
      model,
      reasoning: input.reasoning ?? this.#options.reasoning,
      maxTurns: input.maxTurns ?? this.#options.maxTurns,
      context: { systemPrompt, messages },
      tools,
      subagentRun,
      toolExecution: "parallel",
      signal: input.signal,
      transformContext: ({ context, signal, reportStatus }) =>
        this.#compaction.transform(
          input.conversationId,
          model,
          context,
          signal,
          () => reportStatus('compacting'),
          durableSequences,
          // Whether to compact is still the run model's question — it is its
          // window that overflows — so only the summarising call moves.
          this.#options.compactionModel || this.#options.compactionReasoning
            ? {
                model: this.#options.compactionModel ?? model,
                reasoning:
                  this.#options.compactionReasoning ??
                  input.reasoning ??
                  this.#options.reasoning,
              }
            : undefined,
        ),
    });
    // The runner appends new messages onto the context it was started with, so
    // the run's additions begin at this index — not at the stored row count,
    // which drifts whenever toInferenceMessage or selectContext drops rows.
    const initialContextLength = messages.length;
    const settled = active.result
      .then(async (result) => {
        this.#finish(input, result, initialContextLength);
        await this.#driveGoal(input, result);
      })
      .catch((error: unknown) => {
        console.error("FlareAI post-run bookkeeping failed", error);
      });
    this.#goalWork.add(settled);
    void settled.finally(() => this.#goalWork.delete(settled));
    return active;
  }

  /**
   * Resolves once every judged turn, the continuations it started, and the
   * post-turn memory work have settled. A run's own `result` resolves before
   * the goal loop has judged it, so callers that need the background quiet —
   * tests, shutdown — wait here.
   */
  async settleGoalWork(): Promise<void> {
    while (this.#goalWork.size)
      await Promise.allSettled([...this.#goalWork]);
  }

  /**
   * Judges the standing goal once a run settles and, while the objective is
   * unmet, starts the next run itself. Only top-level runs drive the loop: a
   * subagent finishing says nothing about the conversation's goal.
   */
  async #driveGoal(
    input: StartFlareAIRunInput,
    result: AgentRunResult,
  ): Promise<void> {
    if (input.parentRunId || result.status !== "completed") return;
    const decision = await this.goalLoop.afterRun({
      conversationId: input.conversationId,
      model: this.#options.judgeModel ?? this.#options.model,
      reasoning:
        this.#options.judgeReasoning ?? input.reasoning ?? this.#options.reasoning,
      lastAgentMessage: result.lastAgentMessage,
      signal: input.signal,
    });
    if (decision.action !== "continue" || !decision.prompt) return;
    const runId = crypto.randomUUID();
    const run = this.start({
      conversationId: input.conversationId,
      text: decision.prompt,
      reasoning: input.reasoning,
      goalContinuation: true,
      runId,
    });
    this.#options.onGoalContinuation?.({
      conversationId: input.conversationId,
      previousRunId: result.runId,
      runId,
      run,
      decision,
    });
  }

  async #runSubagent(
    conversationId: string,
    parentRunId: string,
    request: SubagentRequest,
    context: AgentToolContext,
  ) {
    const runId = crypto.randomUUID();
    const active = this.start({
      conversationId,
      text: request.prompt,
      runId,
      parentRunId,
      includeSubagents: false,
      model: this.#options.taskModel,
      reasoning: this.#options.taskReasoning,
      signal: context.signal,
      contextMode: request.context,
    });
    this.#options.onSubagentRun?.({
      conversationId,
      parentRunId,
      runId,
      description: request.description,
      run: active,
    });
    // Announced on the *parent* stream, and carrying no message of its own so
    // no step row appears: the only job of this event is to tell the UI which
    // run belongs to which task row, while the task is still running.
    await context.emitProgress("", { childRunId: runId });
    const result = await active.result;
    return {
      runId: result.runId,
      status: result.status,
      result:
        assistantText(result) ||
        result.error?.message ||
        "Subagent returned no text.",
    };
  }

  #persistEvent(event: AgentRunEvent): void {
    this.#options.storage.appendRunEvent(event.runId, event.type, json(event));
  }
  #finish(
    input: StartFlareAIRunInput,
    result: AgentRunResult,
    initialMessages: number,
  ): void {
    this.#options.storage.updateRun(result.runId, {
      status: result.status,
      error: result.error ? json(result.error) : null,
      usage: json(result.usage),
    });
    if (input.parentRunId || result.status !== "completed") return;
    const additions = result.context.messages
      .slice(initialMessages)
      .filter((message) => message.role === "assistant");
    additions.forEach((message, index) =>
      this.#options.storage.appendMessage({
        id: crypto.randomUUID(),
        conversationId: input.conversationId,
        runId: result.runId,
        role: "assistant",
        content: json(message.content),
        // Mirrors the run's message.completed phases: only the run's last
        // assistant message is the answer; earlier ones are mid-run narration
        // that a client nests inside the run's activity group.
        metadata: {
          phase: index === additions.length - 1 ? "final" : "commentary",
        },
      }),
    );
    // Watermark-gated background work: it runs alongside the goal loop rather
    // than before it, so it never delays the turn, but it is tracked so
    // shutdown and tests can wait for it. maybeConsolidate absorbs failures.
    // Distillation runs before consolidation and is awaited by it, because
    // what it writes is exactly what the summary should then fold in — the
    // other order leaves a screen memory waiting a whole turn for its place in
    // the briefing.
    const memoryWork = (this.#distiller
      ? this.#distiller
          .maybeDistill(this.#options.model, new AbortController().signal)
          .then((): void => undefined)
      : Promise.resolve()
    )
      .then(() =>
        this.#consolidator.maybeConsolidate(
          this.#options.model,
          new AbortController().signal,
        ),
      )
      .then((): void => undefined);
    this.#goalWork.add(memoryWork);
    void memoryWork.finally(() => this.#goalWork.delete(memoryWork));
  }
}

function toInferenceMessage(
  message: StoredMessage,
  attachments: string[],
): InferenceMessage | null {
  if (message.role === "user") {
    const content =
      typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content);
    return {
      role: "user",
      content: attachments.length
        ? `${content}\n\nAttached files:\n${attachments.map((path) => `- ${path}`).join("\n")}`
        : content,
    };
  }
  if (message.role === "assistant" && Array.isArray(message.content))
    return { role: "assistant", content: message.content as never };
  return null;
}
function assistantText(result: AgentRunResult): string {
  const message = [...result.context.messages]
    .reverse()
    .find((item) => item.role === "assistant");
  return message?.role === "assistant"
    ? message.content
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n")
    : "";
}
function json(value: unknown): JsonValue {
  return JSON.parse(
    JSON.stringify(value, (_key, item) =>
      item instanceof Error ? { name: item.name, message: item.message } : item,
    ),
  ) as JsonValue;
}
function readSkill(path: string): string {
  return readFileSync(path, "utf8");
}

function selectContext<T>(
  messages: T[],
  mode: NonNullable<StartFlareAIRunInput["contextMode"]>,
): T[] {
  if (mode === "none") return [];
  if (mode === "recent") return messages.slice(-8);
  return messages;
}
