import type { InferenceMessage } from "@midas/inference";

export function estimateMessageTokens(message: InferenceMessage): number {
  if (message.role === "user") return Math.ceil(textSize(message.content) / 4);
  if (message.role === "toolResult")
    return Math.ceil((message.toolName.length + textSize(message.content)) / 4);
  return Math.ceil(
    message.content.reduce(
      (size, block) =>
        size +
        (block.type === "toolCall"
          ? block.name.length + JSON.stringify(block.arguments).length
          : block.text.length),
      0,
    ) / 4,
  );
}
export function estimateContextTokens(
  messages: InferenceMessage[],
  systemPrompt = "",
): number {
  return (
    Math.ceil(systemPrompt.length / 4) +
    messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0)
  );
}
function textSize(
  content: string | Array<{ type: string; text?: string; data?: string }>,
): number {
  return typeof content === "string"
    ? content.length
    : content.reduce(
        (sum, item) => sum + (item.text?.length ?? (item.data ? 4_800 : 0)),
        0,
      );
}
