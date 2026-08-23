import type { AgentTool } from "@polymux/core";
import type { MemoryManager } from "./manager.js";

/** A memory is a fact, not a document. Codex's own notes top out near this. */
const contentLimit = 4_000;

/**
 * The vault's read and write surface. Memory is meant to work the way it does
 * in Codex and ChatGPT Desktop: the agent recalls and remembers on its own as
 * the conversation gives it reason to, rather than waiting to be told. The
 * system prompt sets that policy; these tools carry it out, and because each
 * one is a tool call it also shows up in the activity trail, so remembering is
 * something the user watches happen rather than something done behind their
 * back.
 *
 * Follows Codex's semantics: notes are authoritative once written, forgetting
 * archives rather than destroys, and stored content is data the agent may read
 * later — never instructions it should obey.
 */
export function createMemoryTools(
  memory: MemoryManager,
  conversationId: string,
): AgentTool[] {
  if (!memory.enabled()) return [];
  const result = (value: unknown) => ({ content: JSON.stringify(value) });
  const failure = (message: string) => ({ content: message, isError: true });
  return [
    {
      name: "recall",
      description:
        "Search saved memories: every user memory plus any scoped to this conversation. Use it whenever the answer depends on something durable about the user — their setup, preferences, projects, history — instead of guessing or asking them to repeat it, and before remembering something, to avoid duplicates and to find the id needed to forget one. Omit query to list everything.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Words to match against memory content. All of them must appear, in any order.",
          },
        },
        additionalProperties: false,
      },
      execute: async (input) => {
        const terms = typeof input.query === "string"
          ? input.query.toLocaleLowerCase().split(/\s+/).filter(Boolean)
          : [];
        const matches = memory
          .list(conversationId)
          .filter((item) => {
            const content = item.content.toLocaleLowerCase();
            return terms.every((term) => content.includes(term));
          })
          .map((item) => ({
            id: item.id,
            scope: item.scope,
            kind: item.kind,
            content: item.content,
            updatedAt: item.updatedAt,
          }));
        // A query that matches nothing is a real answer, not an error: it means
        // the vault has nothing on the subject, so the agent should ask rather
        // than keep digging.
        return result(matches);
      },
    },
    {
      name: "remember",
      description:
        "Save a durable memory. Use it whenever something worth knowing next week surfaces — how the user works, what they prefer, what a project of theirs is and where it stands — not only when they ask you to remember. Store one self-contained fact about the user or their work, in plain language, not an instruction to follow. Skip anything that only matters inside this turn. Use scope 'conversation' for something true only of this chat, otherwise 'user'.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string" },
          kind: {
            type: "string",
            description:
              "Short category, such as preference, profile, project, or learning.",
          },
          scope: { type: "string", enum: ["user", "conversation"] },
        },
        required: ["content"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const content = typeof input.content === "string" ? input.content.trim() : "";
        if (!content) return failure("A memory needs content.");
        if (content.length > contentLimit)
          return failure(
            `A memory must be at most ${contentLimit} characters; this one is ${content.length}. Save the durable fact rather than the whole passage.`,
          );
        const saved = memory.remember(content, {
          kind: typeof input.kind === "string" ? input.kind : undefined,
          conversationId:
            input.scope === "conversation" ? conversationId : undefined,
        });
        return result({
          id: saved.id,
          scope: saved.scope,
          kind: saved.kind,
          content: saved.content,
        });
      },
    },
    {
      name: "forget",
      description:
        "Forget a saved memory by id, only when the user explicitly asks. The note is moved to the vault's archive rather than destroyed. Use recall first to find the id.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const id = typeof input.id === "string" ? input.id.trim() : "";
        if (!id) return failure("A memory id is required.");
        return memory.forget(id)
          ? result({ forgotten: id })
          : failure(`No memory has id ${id}. Use recall to find it.`);
      },
    },
  ];
}
