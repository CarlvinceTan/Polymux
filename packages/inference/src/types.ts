export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface ModelRef {
  provider: string;
  id: string;
}

export interface InferenceModel extends ModelRef {
  name: string;
  contextWindow: number;
  maxOutputTokens: number;
  reasoning: boolean;
  input: Array<"text" | "image">;
  cost?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
}

export interface InferenceUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens?: number;
  totalTokens: number;
  costUsd: number;
}

export interface TextBlock {
  type: "text";
  text: string;
  providerData?: JsonObject;
}

export interface ReasoningBlock {
  type: "reasoning";
  text: string;
  redacted?: boolean;
  providerData?: JsonObject;
}

export interface ImageBlock {
  type: "image";
  data: string;
  mimeType: string;
}

export interface ToolCallBlock {
  type: "toolCall";
  id: string;
  name: string;
  arguments: JsonObject;
  providerData?: JsonObject;
}

export type InputBlock = TextBlock | ImageBlock;
export type AssistantBlock = TextBlock | ReasoningBlock | ToolCallBlock;

export interface UserInferenceMessage {
  role: "user";
  content: string | InputBlock[];
  timestamp?: number;
}

export interface AssistantInferenceMessage {
  role: "assistant";
  content: AssistantBlock[];
  provider?: string;
  model?: string;
  responseId?: string;
  usage?: InferenceUsage;
  stopReason?: InferenceStopReason;
  timestamp?: number;
}

export interface ToolResultInferenceMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: InputBlock[];
  isError: boolean;
  addedToolNames?: string[];
  timestamp?: number;
}

export type InferenceMessage =
  UserInferenceMessage | AssistantInferenceMessage | ToolResultInferenceMessage;

export interface InferenceTool {
  name: string;
  description: string;
  parameters: JsonObject;
  strict?: "prefer" | "require";
}

export type ReasoningEffort =
  "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type InferenceStopReason =
  "stop" | "length" | "toolUse" | "deferred" | "error" | "aborted";

export interface InferenceRequest {
  model: ModelRef;
  /** Request-scoped credential used by app-owned key rotation. */
  apiKey?: string;
  systemPrompt?: string;
  messages: InferenceMessage[];
  tools?: InferenceTool[];
  reasoning?: ReasoningEffort;
  temperature?: number;
  maxOutputTokens?: number;
  cacheRetention?: "none" | "short" | "long";
  sessionId?: string;
  timeoutMs?: number;
  maxRetries?: number;
  signal?: AbortSignal;
}

export interface InferenceError {
  code:
    | "model_not_found"
    | "auth"
    | "rate_limit"
    | "context_overflow"
    | "aborted"
    | "provider_error"
    | "unknown";
  message: string;
  retryable: boolean;
  provider?: string;
  model?: string;
}

export type InferenceEvent =
  | { type: "start"; model: InferenceModel }
  | { type: "textStart"; index: number }
  | { type: "textDelta"; index: number; delta: string }
  | { type: "textEnd"; index: number; text: string }
  | { type: "reasoningStart"; index: number }
  | { type: "reasoningDelta"; index: number; delta: string }
  | { type: "reasoningEnd"; index: number; text: string }
  | { type: "toolCallStart"; index: number }
  | { type: "toolCallDelta"; index: number; delta: string }
  | { type: "toolCallEnd"; index: number; toolCall: ToolCallBlock }
  | {
      type: "done";
      reason: Exclude<InferenceStopReason, "error" | "aborted">;
      message: AssistantInferenceMessage;
    }
  | {
      type: "error";
      error: InferenceError;
      message?: AssistantInferenceMessage;
    };
