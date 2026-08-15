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
} from "@midas/inference";

export type { ToolCallBlock } from "@midas/inference";

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
  turn: number;
  callId: string;
  signal: AbortSignal;
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
  model: ModelRef;
  context: AgentContext;
  tools?: AgentTool[];
  reasoning?: ReasoningEffort;
  temperature?: number;
  maxOutputTokens?: number;
  maxTurns?: number;
  toolExecution?: ToolExecutionMode;
  transformContext?: ContextTransformer;
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
    | { type: "turn.started"; turn: number; context: AgentContext }
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
