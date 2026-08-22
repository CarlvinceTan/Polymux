import type {
  AssistantInferenceMessage,
  InferenceMessage,
  InferenceModel,
  InferenceUsage,
  JsonObject,
  JsonValue,
  ModelRef,
  ReasoningEffort,
  ToolCallBlock,
} from "@flareai/inference";

export type { ToolCallBlock } from "@flareai/inference";

export type RunId = string;
export type RunStatus =
  "idle" | "running" | "executing_tools" | "completed" | "cancelled" | "failed";
export type ToolExecutionMode = "sequential" | "parallel";

export interface AgentContext {
  systemPrompt?: string;
  messages: InferenceMessage[];
}

export interface AgentToolResult {
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image"; data: string; mimeType: string }
      >;
  isError?: boolean;
  metadata?: JsonValue;
}

export interface AgentToolContext {
  runId: RunId;
  /** Stable logical work scope. A continued delegated task keeps this value so
   * bounded tool budgets cannot be reset merely by receiving a new run id. */
  budgetScope?: string;
  turn: number;
  callId: string;
  signal: AbortSignal;
  /** True while the call comes from a delegated run rather than the agent the
   * user is talking to. What is on screen belongs to the user's own run, so a
   * tool that would move it reads this rather than assuming it may. */
  subagent?: boolean;
  emitProgress(message: string, data?: JsonValue): Promise<void>;
}

/** Outcome of a pre-tool hook: block carries a message returned to the model. */
export interface ToolHookDecision {
  allow: boolean;
  message?: string;
}

/** Host-supplied lifecycle hooks around every tool call. `beforeTool` can veto
 * the call; `afterTool` observes the result and must not throw meaningfully —
 * failures are swallowed so observation never breaks a run. */
export interface ToolHooks {
  beforeTool?(call: ToolCallBlock): Promise<ToolHookDecision>;
  afterTool?(call: ToolCallBlock, result: AgentToolResult): Promise<void>;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: JsonObject;
  /**
   * Withheld from delegated runs. Several subagents work at once and none of
   * them can see the screen, so a tool that decides what the user is looking
   * at belongs to the one run the user is actually talking to.
   */
  mainAgentOnly?: boolean;
  strict?: "prefer" | "require";
  executionMode?: ToolExecutionMode;
  execute(
    input: JsonObject,
    context: AgentToolContext,
  ): Promise<AgentToolResult>;
}

export interface ContextTransformInput {
  runId: RunId;
  turn: number;
  context: Readonly<AgentContext>;
  model: ModelRef;
  signal: AbortSignal;
  reportStatus(status: 'compacting'): Promise<void>;
}

export type ContextTransformer = (
  input: ContextTransformInput,
) => AgentContext | Promise<AgentContext>;

export interface AgentRunRequest {
  runId: RunId;
  /** Stable scope inherited by tool calls for continuation-aware budgets. */
  budgetScope?: string;
  model: ModelRef;
  context: AgentContext;
  tools?: AgentTool[];
  /** Marks the whole run as delegated, which every tool call inherits. */
  subagentRun?: boolean;
  reasoning?: ReasoningEffort;
  temperature?: number;
  maxOutputTokens?: number;
  maxTurns?: number;
  /** Host-enforced evidence phase for bounded research workers. After this
   * many tool-bearing turns, every tool schema is removed and an additional
   * tool-free synthesis turn is guaranteed. */
  toolTurnBudget?: {maximum: number; synthesisPrompt: string};
  toolExecution?: ToolExecutionMode;
  transformContext?: ContextTransformer;
  /** Review a tool-free answer before it becomes the accepted final message.
   * Returning messages asks for one or more corrective turns; the host owns
   * the bound so a bad reviewer can never loop the run indefinitely. */
  reviewFinal?: (input: {
    runId: RunId;
    turn: number;
    signal: AbortSignal;
    text: string;
  }) => Promise<InferenceMessage[]>;
  /**
   * Asked once the model has stopped calling tools, before the run is allowed
   * to end. Returning messages appends them and takes another turn instead of
   * completing; returning nothing completes the run.
   *
   * It exists for work the run started and has not heard back from. A run that
   * dispatched a subagent and then wrote its answer would otherwise hang up on
   * its own team — the delegated run keeps going with nobody left to read it.
   */
  beforeComplete?: (input: {
    runId: RunId;
    turn: number;
    signal: AbortSignal;
    /** Latest user-visible answer candidate, for host quality gates that may
     * require one corrective turn before completion. */
    lastAgentMessage: string;
  }) => Promise<InferenceMessage[]>;
  signal?: AbortSignal;
}

export interface AgentRunResult {
  runId: RunId;
  status: Extract<RunStatus, "completed" | "cancelled" | "failed">;
  context: AgentContext;
  turns: number;
  usage: InferenceUsage;
  /** Wall-clock time of the whole run, for "Worked for Ns" presentation. */
  durationMs: number;
  /** True when any tool was invoked. A run without work is a plain reply and
   * a client should show no activity group for it. */
  hadWorkActivity: boolean;
  /** Text of the run's final assistant message — the answer a client keeps
   * visible while everything before it collapses into the activity group. */
  lastAgentMessage: string;
  error?: AgentRunError;
}

export interface AgentRunError {
  code:
    | "aborted"
    | "inference"
    | "max_turns"
    | "invalid_tool_call"
    | "tool_blocked_by_hook"
    | "internal";
  message: string;
  retryable: boolean;
  cause?: unknown;
}

export interface BaseRunEvent {
  runId: RunId;
  sequence: number;
  timestamp: number;
}

export type AgentRunEvent = BaseRunEvent &
  (
    | { type: "run.started"; model: ModelRef }
    | { type: "run.state"; status: RunStatus }
    | {
        type: "turn.started";
        turn: number;
        context: AgentContext;
        /** Byte counts of exactly what this inference turn was offered. The
         * values make context-routing performance auditable without copying
         * tool schemas into the event log. */
        footprint: {
          systemPromptBytes: number;
          messageBytes: number;
          toolSchemaBytes: number;
          toolCount: number;
          toolNames: string[];
          /** Markdown H2 section names offered to the model. Contents stay out
           * of footprint telemetry so personal context is not duplicated. */
          systemSections: string[];
          /** Names only of skills already embedded in the system prompt. */
          activeSkillNames: string[];
          /** Count only; personal skill names and descriptions stay in the prompt. */
          availableSkillCount: number;
          /** Counts only; titles, URLs, and window names remain exclusively in
           * the inference prompt and are not duplicated into telemetry. */
          ambientContextCounts: {
            memoryBlocks: number;
            memoryCandidateBlocks: number;
            flareBrowserTabs: number;
            externalBrowserTabs: number;
            openWindows: number;
          };
          /** Capture timestamps only; source contents stay in the prompt. */
          ambientContextCapturedAt: {
            windows?: string;
            flareBrowser?: string;
            externalBrowser?: string;
          };
          totalBytes: number;
        };
      }
    | { type: "model.started"; turn: number; model: InferenceModel }
    | { type: "context.compacting"; turn: number }
    | { type: "context.compacted"; turn: number }
    | { type: "message.text.delta"; turn: number; index: number; delta: string }
    | {
        type: "message.reasoning.delta";
        turn: number;
        index: number;
        delta: string;
      }
    | {
        type: "message.tool_call.delta";
        turn: number;
        index: number;
        delta: string;
      }
    | {
        type: "message.completed";
        turn: number;
        message: AssistantInferenceMessage;
        /** "commentary" = mid-run narration (tool calls follow); "final" = the
         * turn produced no tool calls, so this text is the run's answer unless
         * late steering starts another turn. Mirrors codex's MessagePhase. */
        phase: "commentary" | "final";
      }
    | {
        /** A host quality gate rejected a tool-free draft before persistence. */
        type: "message.final_rejected";
        turn: number;
        repairMessageCount: number;
      }
    | { type: "tool.started"; turn: number; toolCall: ToolCallBlock }
    | {
        type: "tool.progress";
        turn: number;
        toolCallId: string;
        message: string;
        data?: JsonValue;
      }
    | {
        type: "tool.completed";
        turn: number;
        toolCall: ToolCallBlock;
        result: AgentToolResult;
        durationMs: number;
      }
    | {
        type: "tool.failed";
        turn: number;
        toolCall: ToolCallBlock;
        error: AgentRunError;
        durationMs: number;
      }
    | { type: "steer.accepted"; message: InferenceMessage }
    | { type: "run.completed"; result: AgentRunResult }
    | { type: "run.cancelled"; result: AgentRunResult }
    | { type: "run.failed"; result: AgentRunResult }
  );

export interface RunEventSink {
  append(event: AgentRunEvent): void | Promise<void>;
}

export interface RunObserver {
  onEvent?(event: AgentRunEvent): void | Promise<void>;
}
