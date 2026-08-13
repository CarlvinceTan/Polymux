import type {
  AssistantMessage,
  Context,
  ImageContent,
  Message,
  Model,
  TextContent,
  ThinkingContent,
  Tool,
  ToolCall,
  Usage,
} from "@earendil-works/pi-ai";
import type {
  AssistantBlock,
  AssistantInferenceMessage,
  InferenceMessage,
  InferenceModel,
  InferenceStopReason,
  InferenceTool,
  InferenceUsage,
  InputBlock,
  JsonObject,
  ToolCallBlock,
} from "../types.js";

const emptyUsage: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function providerSignature(data: JsonObject | undefined): string | undefined {
  const signature = data?.signature;
  return typeof signature === "string" ? signature : undefined;
}

function toPiInputBlock(block: InputBlock): TextContent | ImageContent {
  return block.type === "text"
    ? {
        type: "text",
        text: block.text,
        textSignature: providerSignature(block.providerData),
      }
    : { type: "image", data: block.data, mimeType: block.mimeType };
}

function toPiAssistantBlock(
  block: AssistantBlock,
): TextContent | ThinkingContent | ToolCall {
  if (block.type === "text")
    return {
      type: "text",
      text: block.text,
      textSignature: providerSignature(block.providerData),
    };
  if (block.type === "reasoning")
    return {
      type: "thinking",
      thinking: block.text,
      thinkingSignature: providerSignature(block.providerData),
      redacted: block.redacted,
    };
  return {
    type: "toolCall",
    id: block.id,
    name: block.name,
    arguments: block.arguments,
    thoughtSignature: providerSignature(block.providerData),
  };
}

function toPiUsage(usage: InferenceUsage | undefined): Usage {
  if (!usage) return emptyUsage;
  return {
    input: usage.inputTokens,
    output: usage.outputTokens,
    cacheRead: usage.cacheReadTokens,
    cacheWrite: usage.cacheWriteTokens,
    reasoning: usage.reasoningTokens,
    totalTokens: usage.totalTokens,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: usage.costUsd,
    },
  };
}

function toPiMessage(
  message: InferenceMessage,
  model: Model<string>,
  now: () => number,
): Message {
  const timestamp = message.timestamp ?? now();
  if (message.role === "user") {
    return {
      role: "user",
      content:
        typeof message.content === "string"
          ? message.content
          : message.content.map(toPiInputBlock),
      timestamp,
    };
  }
  if (message.role === "toolResult") {
    return {
      role: "toolResult",
      toolCallId: message.toolCallId,
      toolName: message.toolName,
      content: message.content.map(toPiInputBlock),
      isError: message.isError,
      addedToolNames: message.addedToolNames,
      timestamp,
    };
  }
  return {
    role: "assistant",
    content: message.content.map(toPiAssistantBlock),
    api: model.api,
    provider: message.provider ?? model.provider,
    model: message.model ?? model.id,
    responseId: message.responseId,
    usage: toPiUsage(message.usage),
    stopReason: message.stopReason ?? "stop",
    timestamp,
  };
}

function toPiTool(tool: InferenceTool): Tool {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters as Tool["parameters"],
    constrainedSampling: tool.strict
      ? { type: "json_schema", strict: tool.strict }
      : undefined,
  };
}

export function toPiContext(
  systemPrompt: string | undefined,
  messages: InferenceMessage[],
  tools: InferenceTool[] | undefined,
  model: Model<string>,
  now: () => number,
): Context {
  return {
    systemPrompt,
    messages: messages.map((message) => toPiMessage(message, model, now)),
    tools: tools?.map(toPiTool),
  };
}

function signatureData(signature: string | undefined): JsonObject | undefined {
  return signature ? { signature } : undefined;
}

export function fromPiToolCall(block: ToolCall): ToolCallBlock {
  return {
    type: "toolCall",
    id: block.id,
    name: block.name,
    arguments: block.arguments as JsonObject,
    providerData: signatureData(block.thoughtSignature),
  };
}

function fromPiBlock(
  block: AssistantMessage["content"][number],
): AssistantBlock {
  if (block.type === "text")
    return {
      type: "text",
      text: block.text,
      providerData: signatureData(block.textSignature),
    };
  if (block.type === "thinking")
    return {
      type: "reasoning",
      text: block.thinking,
      redacted: block.redacted,
      providerData: signatureData(block.thinkingSignature),
    };
  return fromPiToolCall(block);
}

export function fromPiUsage(usage: Usage): InferenceUsage {
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    cacheReadTokens: usage.cacheRead,
    cacheWriteTokens: usage.cacheWrite,
    reasoningTokens: usage.reasoning,
    totalTokens: usage.totalTokens,
    costUsd: usage.cost.total,
  };
}

export function fromPiMessage(
  message: AssistantMessage,
): AssistantInferenceMessage {
  return {
    role: "assistant",
    content: message.content.map(fromPiBlock),
    provider: message.provider,
    model: message.responseModel ?? message.model,
    responseId: message.responseId,
    usage: fromPiUsage(message.usage),
    stopReason: message.stopReason as InferenceStopReason,
    timestamp: message.timestamp,
  };
}

export function fromPiModel(model: Model<string>): InferenceModel {
  return {
    provider: model.provider,
    id: model.id,
    name: model.name,
    contextWindow: model.contextWindow,
    maxOutputTokens: model.maxTokens,
    reasoning: model.reasoning,
    input: [...model.input],
    cost: {
      input: model.cost.input,
      output: model.cost.output,
      cacheRead: model.cost.cacheRead,
      cacheWrite: model.cost.cacheWrite,
    },
  };
}
