import type { InferenceMessage, InputBlock } from "@midas/inference";

/**
 * Rough cost of one image once the provider tiles it. Images never reach the
 * text tokenizer, so they are counted per block rather than by payload size.
 */
const imageTokens = 1_200;

/**
 * CJK symbols, kana, ideographs (including extension A), Hangul, compatibility
 * ideographs, and fullwidth forms.
 */
const cjkPattern =
  /[　-〿぀-ヿ㐀-䶿一-鿿가-힯豈-﫿＀-￯]/g;

/**
 * Latin-ish text averages about four characters per token, but CJK sits closer
 * to one, so a flat divide-by-four under-counts Chinese, Japanese, and Korean
 * by roughly 4x and lets a context overflow before compaction ever fires.
 */
export function estimateTextTokens(value: string): number {
  const cjk = value.match(cjkPattern)?.length ?? 0;
  return Math.ceil(cjk + (value.length - cjk) / 4);
}

export function estimateMessageTokens(message: InferenceMessage): number {
  if (message.role === "user") return estimateInputTokens(message.content);
  if (message.role === "toolResult")
    return (
      estimateTextTokens(message.toolName) +
      estimateInputTokens(message.content)
    );
  return message.content.reduce(
    (total, block) =>
      total +
      (block.type === "toolCall"
        ? estimateTextTokens(block.name) +
          estimateTextTokens(JSON.stringify(block.arguments))
        : estimateTextTokens(block.text)),
    0,
  );
}

export function estimateContextTokens(
  messages: InferenceMessage[],
  systemPrompt = "",
): number {
  return (
    estimateTextTokens(systemPrompt) +
    messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0)
  );
}

function estimateInputTokens(content: string | InputBlock[]): number {
  if (typeof content === "string") return estimateTextTokens(content);
  return content.reduce(
    (total, block) =>
      total +
      (block.type === "image" ? imageTokens : estimateTextTokens(block.text)),
    0,
  );
}
