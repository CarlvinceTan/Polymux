import type { AgentTool } from "@midas/core";
import type { Storage } from "@midas/storage";

/** Bound on how much of one message a hit carries back. */
const snippetLimit = 600;

/**
 * Search-then-read over stored conversations, the same shape as grep followed
 * by opening the file. History is the record of what was actually said, so it
 * is queried on demand rather than distilled ahead of time into memory: nothing
 * is spent until a question needs it, and nothing is lost to summarizing.
 */
export function createHistoryTools(
  storage: Storage,
  conversationId: string,
): AgentTool[] {
  const result = (value: unknown) => ({ content: JSON.stringify(value) });
  const failure = (message: string) => ({ content: message, isError: true });
  return [
    {
      name: "search_history",
      description:
        "Search earlier conversations for a word or phrase. Use this when the user refers to something discussed before, or when what was already decided matters, instead of guessing or asking them to repeat it. Returns matches newest first with the conversation they came from; follow up with read_conversation to see the surrounding turns.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
        },
        required: ["query"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const query = typeof input.query === "string" ? input.query.trim() : "";
        if (!query) return failure("A search needs a query.");
        const hits = storage.searchMessages(query, {
          limit: typeof input.limit === "number" ? input.limit : undefined,
        });
        return result(
          hits.map((hit) => ({
            conversationId: hit.conversationId,
            conversation: hit.conversationTitle,
            role: hit.role,
            sequence: hit.sequence,
            at: hit.createdAt,
            text: snippet(hit.text),
          })),
        );
      },
    },
    {
      name: "read_conversation",
      description:
        "Read the turns of one earlier conversation, by the conversationId a search returned. Use afterSequence to page through a long one. This is how you get the context around a search hit.",
      parameters: {
        type: "object",
        properties: {
          conversationId: { type: "string" },
          afterSequence: { type: "number" },
          limit: { type: "number" },
        },
        required: ["conversationId"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const target =
          typeof input.conversationId === "string"
            ? input.conversationId.trim()
            : "";
        if (!target) return failure("A conversationId is required.");
        if (target === conversationId)
          return failure(
            "That is the current conversation, which you can already see.",
          );
        const messages = storage.listMessages(target, {
          afterSequence:
            typeof input.afterSequence === "number"
              ? input.afterSequence
              : undefined,
          limit: typeof input.limit === "number" ? input.limit : 50,
        });
        if (!messages.length)
          return failure(`No conversation has id ${target}.`);
        return result(
          messages
            .filter(
              (item) => item.role === "user" || item.role === "assistant",
            )
            .map((item) => ({
              sequence: item.sequence,
              role: item.role,
              at: item.createdAt,
              text: snippet(plainText(item.content)),
            })),
        );
      },
    },
  ];
}

function snippet(value: string): string {
  return value.length <= snippetLimit
    ? value
    : `${value.slice(0, snippetLimit)}…`;
}

function plainText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((block) => {
        const item = block as { type?: unknown; text?: unknown };
        if (item.type === "image") return "[image]";
        return typeof item.text === "string" ? item.text : "";
      })
      .filter(Boolean)
      .join("\n");
  return "";
}
