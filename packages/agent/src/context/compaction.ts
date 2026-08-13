import type { AgentContext } from "@midas/core";
import type { InferenceService, ModelRef } from "@midas/inference";
import type { Storage } from "@midas/storage";
import { estimateContextTokens, estimateMessageTokens } from "./tokens.js";

export interface CompactionSettings {
  enabled: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
}
export const defaultCompactionSettings: CompactionSettings = {
  enabled: true,
  reserveTokens: 16_384,
  keepRecentTokens: 20_000,
};

export class CompactionManager {
  readonly #inference: InferenceService;
  readonly #storage: Storage;
  readonly #settings: CompactionSettings;
  readonly #cached = new Map<
    string,
    { sourceCount: number; cut: number; summary: string }
  >();
  constructor(
    inference: InferenceService,
    storage: Storage,
    settings: Partial<CompactionSettings> = {},
  ) {
    this.#inference = inference;
    this.#storage = storage;
    this.#settings = { ...defaultCompactionSettings, ...settings };
  }

  async transform(
    conversationId: string,
    model: ModelRef,
    context: AgentContext,
    signal: AbortSignal,
  ): Promise<AgentContext> {
    const modelInfo = this.#inference.getModel(model);
    if (!this.#settings.enabled || !modelInfo) return context;
    const reserve = Math.min(
      this.#settings.reserveTokens,
      Math.floor(modelInfo.contextWindow / 2),
    );
    const threshold = modelInfo.contextWindow - reserve;
    const cached = this.#cached.get(conversationId);
    if (cached && context.messages.length >= cached.sourceCount) {
      const compacted = withSummary(
        context,
        cached.summary,
        context.messages.slice(cached.cut),
      );
      if (
        estimateContextTokens(compacted.messages, compacted.systemPrompt) <=
        threshold
      )
        return compacted;
    }
    if (
      estimateContextTokens(context.messages, context.systemPrompt) <= threshold
    )
      return context;
    let recentTokens = 0;
    let cut = context.messages.length;
    while (cut > 1) {
      const next = estimateMessageTokens(context.messages[cut - 1]!);
      if (
        recentTokens > 0 &&
        recentTokens + next > this.#settings.keepRecentTokens
      )
        break;
      recentTokens += next;
      cut -= 1;
    }
    if (cut <= 0) return context;
    const older = context.messages.slice(0, cut);
    const summary = await this.#summarize(model, older, signal);
    const durableMessages = this.#storage.listMessages(conversationId);
    const sequence =
      durableMessages.at(Math.min(cut - 1, durableMessages.length - 1))
        ?.sequence ?? cut;
    this.#storage.saveCompaction({
      id: crypto.randomUUID(),
      conversationId,
      throughMessageSequence: sequence,
      summary,
      tokenCount: Math.ceil(summary.length / 4),
    });
    this.#cached.set(conversationId, {
      sourceCount: context.messages.length,
      cut,
      summary,
    });
    return withSummary(context, summary, context.messages.slice(cut));
  }

  async #summarize(
    model: ModelRef,
    messages: AgentContext["messages"],
    signal: AbortSignal,
  ): Promise<string> {
    let answer = "";
    for await (const event of this.#inference.stream({
      model,
      systemPrompt:
        "Summarize the earlier conversation for another agent. Preserve decisions, user preferences, unresolved work, important results, and exact identifiers. Do not invent facts.",
      messages: [{ role: "user", content: JSON.stringify(messages) }],
      signal,
    })) {
      if (event.type === "done")
        answer = event.message.content
          .filter((item) => item.type === "text")
          .map((item) => item.text)
          .join("\n");
      if (event.type === "error")
        throw new Error(`Compaction failed: ${event.error.message}`);
    }
    if (!answer.trim()) throw new Error("Compaction produced an empty summary");
    return answer.trim();
  }
}

function withSummary(
  context: AgentContext,
  summary: string,
  recent: AgentContext["messages"],
): AgentContext {
  return {
    ...context,
    messages: [
      { role: "user", content: `Earlier conversation summary:\n${summary}` },
      ...recent,
    ],
  };
}
