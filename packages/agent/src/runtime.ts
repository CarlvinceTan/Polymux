import type {
  AgentRunEvent,
  AgentRunResult,
  ActiveAgentRun,
  AgentTool,
} from "@polymux/core";
import { AgentRunControl, AgentRunner, type ToolHooks } from "@polymux/core";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type {
  InferenceMessage,
  InferenceService,
  ModelRef,
  ReasoningEffort,
} from "@polymux/inference";
import type { JsonValue, Storage, StoredMessage } from "@polymux/storage";
import { ToolRegistry } from "@polymux/tools";
import { buildSystemPrompt } from "./prompts/system-prompt.js";
import { memorySummarySelectionForPrompt } from "./memory/prompt-summary.js";
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
  goalProgressPrompt,
  readGoalProgress,
  recordGoalProgress,
} from "./goals/progress-receipts.js";
import {
  GoalLoop,
  type GoalLoopDecision,
  type GoalLoopSettings,
} from "./goals/loop.js";
import {
  MemoryConsolidator,
  type MemoryConsolidationSettings,
} from "./memory/consolidator.js";
import type { ComputerHistoryAccess } from "./memory/computer-history-access.js";
import { createComputerHistoryTools } from "./memory/computer-history-tools.js";
import { createHistoryTools } from "./memory/history-tools.js";
import { MemoryManager } from "./memory/manager.js";
import { createMemoryTools } from "./memory/tools.js";
import {
  createCheckTasksTool,
  createCancelTasksTool,
  continuationDispatchError,
  createTaskTool,
  dependentDispatchError,
  createWaitAllTasksTool,
  createWaitTaskTool,
  type SubagentRequest,
} from "./subagents/task-tool.js";
import {
  isFinal,
  freshRetainedEntries,
  SubagentFleet,
  type RetainedSubagentEntry,
  selectRetainedForPrompt,
} from "./subagents/fleet.js";
import {
  boundedResearchToolTurnBudget,
  selectTaskSkills,
  selectTaskTools,
  taskGroupEnabled,
  type TaskToolGroup,
} from "./subagents/tool-routing.js";
import type { AgentPrompts } from "./prompts/agent-prompts.js";
import type { AgentToolContext } from "@polymux/core";
import {
  currentPageFastPathAvailable,
  selectEnvironmentForPrompt,
} from "./context/environment-selection.js";
import {
  directFastPathGroup,
  type DirectToolGroup,
} from "./context/delegation-strategy.js";
import { finalAnswerQualityIssues } from "./context/final-answer-quality.js";
import { selectSkillsForPrompt } from "./context/skill-selection.js";
import type { Skill } from "./skills/types.js";

export type { ComputerHistoryAccess } from "./memory/computer-history-access.js";

const MAX_PRELOADED_SKILL_BYTES = 12_000;

function preloadSingleOfficialSkill(
  skills: Skill[],
): { name: string; filePath: string; instructions: string } | undefined {
  const official = skills.filter((skill) => skill.source === "official");
  if (official.length !== 1) return undefined;
  const skill = official[0]!;
  try {
    const instructions = readFileSync(skill.filePath, "utf8").trim();
    if (
      !instructions ||
      Buffer.byteLength(instructions, "utf8") > MAX_PRELOADED_SKILL_BYTES
    )
      return undefined;
    return { name: skill.name, filePath: skill.filePath, instructions };
  } catch {
    // Missing or unreadable is lossless: the catalogue entry remains visible
    // and the model follows the ordinary read-and-report-failure path.
    return undefined;
  }
}

/**
 * Kept as the historical name for what the runtime asks of ComputerHistory. It is
 * now the wider reading surface in `ComputerHistoryAccess`: the prompt line the
 * runtime always used, plus the queries the retrieval tools run. The reading
 * surface is optional, so a host supplying only a prompt context still
 * satisfies it.
 */
export type ComputerHistoryContextProvider = ComputerHistoryAccess;

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
  /** When the desktop-window portion of this context was last verified. */
  windowsCapturedAt?: string;
  /** When Polymux read its own live tab registry for this turn. */
  browserTabsCapturedAt?: string;
  /** When the connected external-browser extension captured its snapshot. */
  externalBrowserCapturedAt?: string;
  time?: {
    local: string;
    timeZone: string;
    utcOffset: string;
    instant?: string;
  };
  locationEnabled: boolean;
  /** The host can convert an authorised fix into a locality without exposing
   * raw coordinates to the model. */
  locationResolverAvailable?: boolean;
  location?: {
    latitude: number;
    longitude: number;
    accuracy: number;
    updatedAt: string;
  };
  /** Tabs open in Polymux's own browser, newest last. */
  browserTabs?: Array<{ tabId: string; url: string; title: string }>;
  /** Fresh tabs reported by the connected external-browser extension. */
  externalBrowserTabs?: Array<{
    tabId: number;
    windowId: number | null;
    url: string;
    title: string;
    active: boolean;
  }>;
  /** Titled windows open on the desktop, frontmost first. */
  windows?: Array<{ app: string; title: string; frontmost: boolean }>;
}

export interface PolymuxAgentOptions {
  /** Independent benchmark flag for preloading one trusted official skill.
   * Remains off until paired latency and quality gates pass. */
  preloadSingleOfficialSkill?: boolean;
  inference: InferenceService;
  storage: Storage;
  memory: MemoryManager;
  computerHistory?: ComputerHistoryContextProvider;
  drive?: DriveContextProvider;
  environment?: EnvironmentContextProvider;
  tools: ToolRegistry;
  model: ModelRef;
  /** Model subagent (Task tool) runs use. Falls back to `model`. */
  subagentModel?: ModelRef;
  /** Model the goal judge reads with. Falls back to `model`. */
  judgeModel?: ModelRef;
  /** Model that writes compaction summaries. Falls back to `model`. */
  compactionModel?: ModelRef;
  /** Effort subagent runs think at. Falls back to the parent run's level. */
  subagentReasoning?: ReasoningEffort;
  /** Effort the goal judge thinks at. Falls back to the run's level. */
  judgeReasoning?: ReasoningEffort;
  /** Effort the compaction summary is written at. Falls back to the run's. */
  compactionReasoning?: ReasoningEffort;
  reasoning?: ReasoningEffort;
  basePrompt?: string;
  /**
   * Polymux's own prompts, read from `resources/prompts` by the host.
   * `main` is loaded into every run that can delegate and `task` into every
   * delegated run; the rest belong to the internal agents and fall back
   * to the wording in this package.
   */
  prompts?: AgentPrompts;
  skills?: SkillLoaderOptions;
  compaction?: Partial<CompactionSettings>;
  memoryConsolidation?: Partial<MemoryConsolidationSettings>;
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

export interface StartPolymuxRunInput {
  conversationId: string;
  text: string;
  userMessageId?: string;
  /** Reuse the prompt already stored for a durable job recovered after exit. */
  reuseUserMessage?: boolean;
  runId?: string;
  signal?: AbortSignal;
  includeSubagents?: boolean;
  parentRunId?: string;
  /** Stable logical task scope shared by same-turn retained continuations. */
  budgetScope?: string;
  contextMode?: "conversation" | "none" | "recent";
  /** Inclusive durable-history boundary captured when scheduler work was queued. */
  contextThroughSequence?: number;
  /** Namespace for ephemeral routing and retained-worker state. Defaults to the conversation. */
  executionScopeId?: string;
  /** User message that owns this run's eventual assistant reply. */
  replyToMessageId?: string;
  attachments?: string[];
  asGoal?: boolean;
  maxTurns?: number;
  /** Optional per-run ceiling for successful delegated dispatches. Used for a
   * bounded increment of a durable goal, never as a global concurrency cap. */
  maxTaskDispatches?: number;
  /** The user turn is advancing the conversation's durable goal. Unlike an
   * automatic goalContinuation this remains a normal visible user turn. */
  goalProgressContext?: boolean;
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
  /**
   * A continued worker's retained context, seeded ahead of its new
   * instruction so it resumes where it settled instead of re-browsing. The
   * rows have no stored sequences, so compaction re-summarises a continued
   * run from scratch — the accepted cost of resuming a long arc.
   */
  seedMessages?: InferenceMessage[];
  /** Task-declared subset of host work capabilities. */
  toolGroups?: TaskToolGroup[];
  /** Exact names from the worker's visible skill catalogue. */
  skillNames?: string[];
}

export class PolymuxAgent {
  readonly goals: GoalManager;
  readonly goalLoop: GoalLoop;
  readonly memory: MemoryManager;
  readonly #options: PolymuxAgentOptions;
  readonly #compaction: CompactionManager;
  readonly #consolidator: MemoryConsolidator;
  readonly #skillLoader: SkillLoader;
  readonly #goalWork = new Set<Promise<void>>();
  /** Bounded worker context available to the next user turn in
   * the same conversation. It is never shared across conversations or saved
   * to durable memory. */
  readonly #retainedTasks = new Map<string, RetainedSubagentEntry[]>();
  /** The immediately preceding direct route, used only to keep a concise
   * follow-up on the same bounded capability surface. */
  readonly #lastDirectToolGroup = new Map<string, DirectToolGroup>();
  constructor(options: PolymuxAgentOptions) {
    this.#options = options;
    this.goals = new GoalManager(options.storage);
    this.goalLoop = new GoalLoop(
      this.goals,
      new GoalJudge(options.inference, options.prompts?.judge),
      options.goalLoop,
    );
    this.memory = options.memory;
    this.#compaction = new CompactionManager(
      options.inference,
      options.storage,
      options.compaction,
      options.prompts?.compaction,
    );
    this.#consolidator = new MemoryConsolidator(
      options.inference,
      options.memory,
      options.memoryConsolidation,
      options.prompts?.consolidation,
    );
    this.#skillLoader = new SkillLoader(options.skills);
  }

  start(input: StartPolymuxRunInput): ActiveAgentRun {
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
    const goalAtRunStartId = this.goals.get(input.conversationId)?.id;
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
    const executionScopeId = input.executionScopeId ?? input.conversationId;
    let runPromptMessage: InferenceMessage | undefined;
    if (!input.parentRunId && !input.reuseUserMessage) {
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
      runPromptMessage =
        toInferenceMessage(
          message,
          this.#options.storage
            .listAttachments(message.id)
            .map((attachment) => attachment.path),
        ) ?? undefined;
    } else if (!input.parentRunId && input.userMessageId) {
      const message = this.#options.storage
        .listMessages(input.conversationId)
        .find((candidate) => candidate.id === input.userMessageId);
      if (message)
        runPromptMessage =
          toInferenceMessage(
            message,
            this.#options.storage
              .listAttachments(message.id)
              .map((attachment) => attachment.path),
          ) ?? undefined;
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
    const boundedDurable =
      input.contextThroughSequence === undefined
        ? durable
        : durable.filter(
            (item) => item.sequence <= input.contextThroughSequence!,
          );
    const selected = selectContext(
      boundedDurable,
      input.contextMode ?? "conversation",
    );
    const messages = selected.map((item) => item.message);
    const durableSequences: Array<number | null> = selected.map(
      (item) => item.sequence,
    );
    // A subagent's instruction is context for this run alone and is never
    // stored, so it has no sequence of its own. A continued subagent is seeded
    // with its retained context first: everything it gathered, then the new
    // instruction last, as the message it acts on.
    if (input.parentRunId) {
      for (const seed of input.seedMessages ?? []) {
        messages.push(seed);
        durableSequences.push(null);
      }
      messages.push({ role: "user", content: text });
      durableSequences.push(null);
    } else if (
      input.contextThroughSequence !== undefined ||
      input.contextMode === "none"
    ) {
      // A scheduler-owned run intentionally reads a frozen prefix. Its own
      // prompt is newer than that prefix, so add it explicitly as run-local
      // context rather than widening the durable boundary.
      messages.push(runPromptMessage ?? { role: "user", content: text });
      durableSequences.push(null);
    }
    // One flag drives both the tool and the policy that describes it, so a
    // subagent is never told to delegate with no `task` tool to delegate with.
    // The screen is the user's own run's to move: a delegated run never gets
    // the tools that decide what is on it, and says so in its answer instead.
    const subagentRun = Boolean(input.parentRunId);
    const rawEnvironment = this.#options.environment?.promptContext();
    // Privacy and relevance minimisation are invariants: precise location and
    // unrelated open state must never enter a prompt without a relevant need.
    const environment = selectEnvironmentForPrompt(rawEnvironment, text);
    const directToolGroup =
      !subagentRun &&
      input.includeSubagents === undefined &&
      directFastPathGroup(text, {
        hasAttachments: Boolean(input.attachments?.length),
        asGoal: input.asGoal,
        currentPageAvailable: currentPageFastPathAvailable(rawEnvironment),
        hasPriorAssistant: messages.some(
          (message) => message.role === "assistant",
        ),
        previousDirectGroup: this.#lastDirectToolGroup.get(executionScopeId),
      });
    if (!subagentRun && input.includeSubagents === undefined) {
      if (directToolGroup)
        this.#lastDirectToolGroup.set(executionScopeId, directToolGroup);
      else this.#lastDirectToolGroup.delete(executionScopeId);
    }
    const delegation = input.includeSubagents ?? !directToolGroup;
    // The coordinator resolves what is already in its prompt and
    // delegates missing source work through capability-routed tasks. Giving it
    // the same memory/history/ComputerHistory retrieval schemas as those workers
    // duplicates context and tempts it to perform serial evidence gathering.
    // Direct fast paths keep the tools because there is deliberately no worker.
    const coordinatorOnly = delegation && !subagentRun;
    const routedTask =
      subagentRun &&
      Boolean(input.toolGroups?.length) &&
      !input.toolGroups?.includes("all");
    const taskMayUse = (group: TaskToolGroup): boolean =>
      directToolGroup
        ? group === "memory" ||
          group === "history" ||
          (directToolGroup === "resume" && group === "computerHistory")
        : !routedTask || taskGroupEnabled(input.toolGroups, group);
    const memory = this.memory.promptContext(input.conversationId);
    const memorySelection = memory.enabled
      ? memorySummarySelectionForPrompt({
          summary: memory.summary,
          prompt: text,
          subagent: subagentRun,
        })
      : { summary: undefined, candidateBlocks: 0, retainedBlocks: 0 };
    const computerHistory = this.#options.computerHistory?.promptContext();
    const selectedSkills = subagentRun
      ? selectTaskSkills(skillResult.skills, input.skillNames)
      : directToolGroup === "resume"
        ? []
        : selectSkillsForPrompt(skillResult.skills, text);
    const preloadedSkill =
      this.#options.preloadSingleOfficialSkill === true
        ? preloadSingleOfficialSkill(selectedSkills)
        : undefined;
    const systemPrompt = buildSystemPrompt({
      // A prompt the host passes directly still wins: the files are the
      // shipped wording, not a lock on it.
      basePrompt: this.#options.basePrompt ?? this.#options.prompts?.base,
      preferences: this.#options.storage.listPreferences(),
      // The whole memory index is the conversation's to hold, and it is most of
      // the prompt. A delegated run is given a bounded task and the tools to
      // look anything else up, so it carries the registry's location rather
      // than its contents — which is what keeps a short task fast now that
      // every task is delegated.
      memorySummary: memorySelection.summary,
      // Report privacy-safe accounting without exposing the selected memory.
      memorySummaryBlockCount: memorySelection.retainedBlocks,
      memorySummaryCandidateBlockCount: memorySelection.candidateBlocks,
      memoryRegistryPath:
        memory.enabled && !coordinatorOnly && taskMayUse("memory")
          ? memory.registryPath
          : undefined,
      historySearch: !coordinatorOnly && taskMayUse("history"),
      memories:
        memory.enabled && taskMayUse("memory")
          ? memory.conversationMemories
          : [],
      computerHistory:
        computerHistory?.enabled &&
        !coordinatorOnly &&
        taskMayUse("computerHistory")
          ? computerHistory
          : undefined,
      drive: taskMayUse("drive")
        ? this.#options.drive?.promptContext()
        : undefined,
      environment: routedTask ? undefined : environment,
      skills: selectedSkills,
      preloadedSkill,
      // The goal belongs to the conversation, not to the errand: a subagent
      // that reads it starts working towards the whole objective instead of
      // the piece it was sent for.
      goal: subagentRun ? null : this.goals.get(input.conversationId),
      speechMode: input.speechMode,
    });
    // What the run the user is talking to may do with its own hands.
    //
    // An orchestrator that holds the work tools uses them: the delegation
    // policy was in the prompt and lost to the browser being right there. So a
    // run that can delegate keeps only what cannot be delegated — the tools
    // that decide what is on screen (`mainAgentOnly`), plus the coordination
    // and conversation-state tools added below. Everything else is work, and
    // work goes out. That is also what keeps the coordinator's context free for
    // the whole picture instead of one subtask's implementation detail.
    const availableHostTools = this.#options.tools
      .list()
      .filter((tool) =>
        subagentRun
          ? !tool.mainAgentOnly
          : !delegation || Boolean(tool.mainAgentOnly),
      );
    const hostTools = directToolGroup
      ? selectTaskTools(availableHostTools, [directToolGroup])
      : availableHostTools;
    const tools = [
      ...(subagentRun
        ? selectTaskTools(hostTools, input.toolGroups)
        : hostTools),
      ...(!directToolGroup && (!subagentRun || !routedTask)
        ? this.goals.tools(input.conversationId)
        : []),
      ...(!coordinatorOnly && taskMayUse("memory")
        ? createMemoryTools(this.memory, input.conversationId)
        : []),
      ...(!coordinatorOnly && taskMayUse("history")
        ? createHistoryTools(this.#options.storage, input.conversationId)
        : []),
      ...(!coordinatorOnly &&
      taskMayUse("computerHistory") &&
      computerHistory?.enabled &&
      this.#options.computerHistory
        ? createComputerHistoryTools(this.#options.computerHistory)
        : []),
    ];
    // One fleet per run: the tasks a run dispatched, the post between them,
    // and the reason the run cannot end while one of them is still out.
    const carriedTasks =
      delegation && !subagentRun
        ? this.#retainedForConversation(executionScopeId, text)
        : [];
    const fleet = new SubagentFleet(carriedTasks);
    const useGoalReceipts = true;
    if (delegation)
      tools.push(
        createTaskTool(
          (request, context) => {
            const currentGoal = this.goals.get(input.conversationId);
            const createdThisRun = Boolean(
              currentGoal && currentGoal.id !== goalAtRunStartId,
            );
            return this.#runSubagent(
              input.conversationId,
              runId,
              fleet,
              request,
              context,
              useGoalReceipts &&
                (input.goalContinuation ||
                  input.goalProgressContext ||
                  input.asGoal ||
                  createdThisRun)
                ? currentGoal?.id
                : undefined,
            );
          },
          {
            capabilityRouting: true,
            maxDispatches: input.maxTaskDispatches,
          },
        ),
        createWaitTaskTool(fleet),
        createWaitAllTasksTool(fleet),
        createCancelTasksTool(fleet),
        createCheckTasksTool(fleet),
      );
    const runner = new AgentRunner({
      inference: this.#options.inference,
      // A top-level run's assistant messages are written as they complete, so
      // the conversation already holds them whether the run ends, is stopped,
      // is steered, or the app dies mid-turn. A subagent's are context for its
      // parent alone and are never stored.
      eventSink: {
        append: (event) =>
          this.#persistEvent(event, subagentRun ? null : input.conversationId),
      },
      hooks: this.#options.hooks,
    });
    // The coordinator's own instructions, loaded rather than built in.
    //
    // A skill left in the catalogue is one line the model has to choose to
    // open — which, on a browsing request, it does not: it opens computer-use
    // and starts browsing. `agents/main.md` is loaded into every run that can
    // delegate, so the policy is in front of the coordinator before it decides
    // anything, without becoming a section of the system prompt that every
    // subagent then carries too.
    // Every run gets the brief for the job it is doing: the coordinator's, or
    // the one written for a run that was sent out and has nobody to ask.
    const standingPrompt = subagentRun
      ? this.#options.prompts?.task?.trim()
      : directToolGroup
        ? this.#options.prompts?.direct?.trim()
        : delegation
          ? this.#options.prompts?.main?.trim()
          : "";
    if (standingPrompt) {
      // Placed just before the turn it governs, never at the head. Two reasons,
      // and the first is not cosmetic: `cutThrough` stops at the first message
      // with no stored row, so a prompt at index 0 would make every compaction
      // re-summarise the whole conversation instead of reusing the summary it
      // already has. Second, standing instructions read last are the ones a
      // model actually follows.
      const at = Math.max(0, messages.length - 1);
      messages.splice(at, 0, {
        role: "user",
        content: `<agent_prompt name="${subagentRun ? "subagent" : directToolGroup ? "direct" : "main"}">\n${standingPrompt}\n</agent_prompt>`,
      });
      durableSequences.splice(at, 0, null);
    }
    if (carriedTasks.length) {
      const at = Math.max(0, messages.length - 1);
      messages.splice(at, 0, {
        role: "user",
        content: `<retained_tasks>\nWorkers from the immediately preceding conversation turns are available for strict continuation when the new request builds on their gathered evidence. Continue only a relevant worker; otherwise ignore them.\n${carriedTasks.map((entry) => `- ${entry.name}: ${entry.description}`).join("\n")}\n</retained_tasks>`,
      });
      durableSequences.splice(at, 0, null);
    }
    const progressGoal =
      useGoalReceipts &&
      (input.goalContinuation || input.goalProgressContext || input.asGoal)
        ? this.goals.get(input.conversationId)
        : null;
    if (progressGoal) {
      const progress = goalProgressPrompt(
        readGoalProgress(this.#options.storage, progressGoal.id),
      );
      if (progress) {
        const at = Math.max(0, messages.length - 1);
        messages.splice(at, 0, { role: "user", content: progress });
        durableSequences.splice(at, 0, null);
      }
    }

    // The control is made here rather than by the runner, so the fleet can post
    // into it from the moment the run exists — a task that finishes before
    // `start` returns has somewhere to put its result.
    const control = new AgentRunControl();
    fleet.attach(control);
    let completionRepairIssued = false;
    let finalQualityRepairs = 0;
    const active = runner.start(
      {
        runId,
        budgetScope: input.budgetScope,
        model,
        reasoning: input.reasoning ?? this.#options.reasoning,
        maxTurns: input.maxTurns ?? this.#options.maxTurns,
        context: { systemPrompt, messages },
        tools,
        subagentRun,
        toolTurnBudget: subagentRun
          ? boundedResearchToolTurnBudget(input.toolGroups)
          : undefined,
        toolExecution: "parallel",
        signal: input.signal,
        transformContext: ({ context, signal, reportStatus }) =>
          this.#compaction.transform(
            input.conversationId,
            model,
            context,
            signal,
            () => reportStatus("compacting"),
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
        reviewFinal: async ({ text: answer }) => {
          const issues = finalAnswerQualityIssues(
            text,
            answer,
            environment?.time,
            {
              resolvedCurrentLocation: Boolean(environment?.location),
            },
          );
          if (!issues.length) return [];
          if (finalQualityRepairs >= 2)
            throw new Error(
              "The model repeatedly produced a final answer that failed observable quality requirements",
            );
          finalQualityRepairs += 1;
          return [
            {
              role: "user",
              content: `<final_quality_check>\nThe proposed final answer violates these observable output requirements:\n${issues.map((issue) => `- ${issue}`).join("\n")}\nOutput only the corrected user-facing answer. Begin with the result or material limitation, never a planning/considering heading or self-talk. Use only evidence already in this conversation. Do not call tools, add facts, expose reasoning, or mention this check.\n</final_quality_check>`,
            },
          ];
        },
        // A run that dispatched work and then wrote its answer would be hanging
        // up mid-errand: nobody is left to read what the subagent comes back
        // with. So the run waits its team out and takes another turn with what
        // they said, rather than ending on an answer written without them.
        beforeComplete: async ({ signal, lastAgentMessage }) => {
          if (fleet.outstanding().length)
            await fleet.settleOutstandingOrSteered(signal);
          const post = fleet.takePost();
          if (post.length) return post;
          if (!subagentRun && !completionRepairIssued) {
            const missing = fleet.missingOutcomes(lastAgentMessage);
            if (missing.length) {
              completionRepairIssued = true;
              return [
                {
                  role: "user",
                  content: `<completion_check>\nYour proposed final answer omitted attributable outcomes for these completed delegated tasks:\n${missing.map((entry) => `- ${entry.description}: ${entry.status}${entry.result ? ` — ${entry.result}` : ""}`).join("\n")}\nReturn one concise self-contained final answer covering every original request. Do not call more tools or omit results already reported.\n</completion_check>`,
                },
              ];
            }
          }
          return [];
        },
      },
      control,
    );
    const settled = active.result
      .then(async (result) => {
        if (!subagentRun)
          this.#rememberRetained(executionScopeId, fleet.retainedRoster());
        this.#finish(input, result);
        await this.#driveGoal(input, result);
      })
      .catch((error: unknown) => {
        console.error("Polymux post-run bookkeeping failed", error);
      });
    this.#goalWork.add(settled);
    void settled.finally(() => this.#goalWork.delete(settled));
    return active;
  }

  #retainedForConversation(
    conversationId: string,
    prompt: string,
  ): RetainedSubagentEntry[] {
    this.#pruneRetainedTasks();
    const retained = this.#retainedTasks.get(conversationId) ?? [];
    if (retained.length) this.#retainedTasks.set(conversationId, retained);
    else this.#retainedTasks.delete(conversationId);
    return selectRetainedForPrompt(retained, prompt);
  }

  #rememberRetained(
    conversationId: string,
    entries: RetainedSubagentEntry[],
  ): void {
    this.#pruneRetainedTasks();
    const retained = freshRetainedEntries(entries);
    if (retained.length) this.#retainedTasks.set(conversationId, retained);
    else this.#retainedTasks.delete(conversationId);
  }

  #pruneRetainedTasks(): void {
    for (const [conversationId, entries] of this.#retainedTasks) {
      const retained = freshRetainedEntries(entries);
      if (retained.length) this.#retainedTasks.set(conversationId, retained);
      else this.#retainedTasks.delete(conversationId);
    }
  }

  /**
   * Resolves once every judged turn, the continuations it started, and the
   * post-turn memory work have settled. A run's own `result` resolves before
   * the goal loop has judged it, so callers that need the background quiet —
   * tests, shutdown — wait here.
   */
  async settleGoalWork(): Promise<void> {
    while (this.#goalWork.size) await Promise.allSettled([...this.#goalWork]);
  }

  /**
   * Judges the standing goal once a run settles and, while the objective is
   * unmet, starts the next run itself. Only top-level runs drive the loop: a
   * subagent finishing says nothing about the conversation's goal.
   */
  async #driveGoal(
    input: StartPolymuxRunInput,
    result: AgentRunResult,
  ): Promise<void> {
    if (input.parentRunId || result.status !== "completed") return;
    const decision = await this.goalLoop.afterRun({
      conversationId: input.conversationId,
      model: this.#options.judgeModel ?? this.#options.model,
      reasoning:
        this.#options.judgeReasoning ??
        input.reasoning ??
        this.#options.reasoning,
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

  /**
   * Starts a delegated run and hands its address back at once. Nothing here
   * waits: the fleet follows the run to its end and posts the result to the
   * parent, which is free to keep working — or to say it has nothing better to
   * do, by calling `wait_subagent`.
   */
  async #runSubagent(
    conversationId: string,
    parentRunId: string,
    fleet: SubagentFleet,
    request: SubagentRequest,
    context: AgentToolContext,
    receiptGoalId?: string,
  ) {
    const dependencyError = dependentDispatchError(fleet, request);
    if (dependencyError) throw new Error(dependencyError);
    const continuationError = continuationDispatchError(fleet, request);
    if (continuationError) throw new Error(continuationError);
    const runId = crypto.randomUUID();
    // Strict continuation prevents a requested resume from disguising a fresh
    // worker and repeating its evidence gathering.
    const prior = request.continue ? fleet.entry(request.continue) : undefined;
    const seed = prior && isFinal(prior.status) ? prior.retained : undefined;
    // Spawned (or re-armed) before start(): the runId is already known, and
    // if start throws the entry exists to be settled as failed rather than
    // left running forever with no track() behind it.
    const entry =
      seed && prior
        ? fleet.resume(prior.name, runId)!
        : fleet.spawn(request.description, runId);
    entry.description = request.description;
    try {
      const progress = receiptGoalId
        ? goalProgressPrompt(
            readGoalProgress(this.#options.storage, receiptGoalId),
          )
        : "";
      const active = this.start({
        conversationId,
        // The coordinator sees the receipts while choosing the unresolved
        // delta, and the worker sees them too so a concise standalone dispatch
        // cannot accidentally omit the exact sources already exhausted.
        text: progress ? `${progress}\n\n${request.prompt}` : request.prompt,
        runId,
        parentRunId,
        budgetScope: `${parentRunId}:${entry.name}`,
        includeSubagents: false,
        model: this.#options.subagentModel,
        reasoning: this.#options.subagentReasoning,
        signal: context.signal,
        contextMode: request.context,
        seedMessages: seed,
        toolGroups: request.toolGroups,
        skillNames: request.skillNames,
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
      // run belongs to which task row, while the task is still running. A
      // continuation also names the task it resumes, so the UI relinks the new
      // run to the existing row instead of appending a second one.
      await context.emitProgress(
        "",
        seed
          ? { childRunId: runId, continueFrom: entry.name }
          : { childRunId: runId },
      );
      fleet.track(
        entry.name,
        active.result.then((result) => {
          // Retention is opt-in: only a dispatch that asked for it leaves its
          // context behind for a follow-up to resume from.
          if (request.retain)
            fleet.storeRetained(entry.name, result.context.messages);
          const text =
            result.status === "completed"
              ? assistantText(result) || "Subagent returned no text."
              : result.error?.message || "Subagent did not complete.";
          if (receiptGoalId && result.status === "completed")
            recordGoalProgress(
              this.#options.storage,
              receiptGoalId,
              request.description,
              text,
              result.context.messages,
            );
          return {
            status: result.status,
            text,
          };
        }),
        () =>
          active.control.cancel(
            new Error(`Task ${entry.name} cancelled by coordinator`),
          ),
      );
      return { name: entry.name, continuedFrom: seed ? entry.name : undefined };
    } catch (error) {
      fleet.settle(
        entry.name,
        "failed",
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  #persistEvent(event: AgentRunEvent, conversationId: string | null): void {
    // These fragments already stream live to the renderer. Durably storing one
    // row per provider chunk made an ordinary research task write thousands of
    // events, although replay reconstructs the finished text and tool calls
    // from message.completed and tool lifecycle events. Reasoning deltas stay:
    // they are the only durable source for the activity row's optional detail.
    if (
      event.type === "message.text.delta" ||
      event.type === "message.tool_call.delta"
    )
      return;
    this.#options.storage.appendRunEvent(event.runId, event.type, json(event));
    // Persist at the moment the message completes, not when the run settles:
    // work the agent has already done is the user's, and stopping to read it
    // must not be what erases it. Only an edited-and-resent user message takes
    // a turn back.
    if (!conversationId || event.type !== "message.completed") return;
    this.#options.storage.appendMessage({
      id: crypto.randomUUID(),
      conversationId,
      runId: event.runId,
      role: "assistant",
      content: json(event.message.content),
      // Mirrors the run's phases: a client nests commentary inside the run's
      // activity group and reads the last message carrying text as the answer.
      metadata: { phase: event.phase },
    });
  }
  #finish(input: StartPolymuxRunInput, result: AgentRunResult): void {
    this.#options.storage.updateRun(result.runId, {
      status: result.status,
      error: result.error ? json(result.error) : null,
      usage: json(result.usage),
    });
    // The run's assistant messages are already stored — `#persistEvent` writes
    // each one as it completes. All that is left here is the bookkeeping a
    // finished turn earns, which a stopped or failed one does not.
    if (input.parentRunId || result.status !== "completed") return;
    // Watermark-gated memory consolidation runs alongside the goal loop rather
    // than before it, so it never delays the turn, but it is tracked so
    // shutdown and tests can wait for it. maybeConsolidate absorbs failures.
    const memoryWork = this.#consolidator
      .maybeConsolidate(
        this.#options.model,
        new AbortController().signal,
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
  mode: NonNullable<StartPolymuxRunInput["contextMode"]>,
): T[] {
  if (mode === "none") return [];
  if (mode === "recent") return messages.slice(-8);
  return messages;
}
