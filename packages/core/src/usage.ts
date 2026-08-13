import type { InferenceUsage } from "@midas/inference";

export function emptyUsage(): InferenceUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    costUsd: 0,
  };
}

export function addUsage(
  total: InferenceUsage,
  next?: InferenceUsage,
): InferenceUsage {
  if (!next) return total;
  return {
    inputTokens: total.inputTokens + next.inputTokens,
    outputTokens: total.outputTokens + next.outputTokens,
    cacheReadTokens: total.cacheReadTokens + next.cacheReadTokens,
    cacheWriteTokens: total.cacheWriteTokens + next.cacheWriteTokens,
    reasoningTokens: (total.reasoningTokens ?? 0) + (next.reasoningTokens ?? 0),
    totalTokens: total.totalTokens + next.totalTokens,
    costUsd: total.costUsd + next.costUsd,
  };
}
