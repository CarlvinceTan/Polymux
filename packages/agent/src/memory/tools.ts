import type { AgentTool } from "@midas/core";
import type { MemoryManager } from "./manager.js";

/** A memory is a fact, not a document. Codex's own notes top out near this. */
const contentLimit = 4_000;

/**
 * Lets the agent act on the instruction the system prompt already gives it:
 * add or remove durable memories when the user explicitly asks. Without these
 * the vault is read-only, so nothing new is ever remembered and consolidation
 * never runs again.
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
      name: "list_memory",
      description:
        "List durable memories already saved: every user memory plus any scoped to this conversation. Read this before remembering something, to avoid duplicates and to find the id needed to forget one.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async () =>
        result(
          memory.list(conversationId).map((item) => ({
            id: item.id,
            scope: item.scope,
            kind: item.kind,
            content: item.content,
            updatedAt: item.updatedAt,
          })),
        ),
    },
    {
      name: "remember",
      description:
        "Save a durable memory, only when the user explicitly asks you to remember something. Store one self-contained fact about the user or their work, in plain language, not an instruction to follow. Use scope 'conversation' for something true only of this chat, otherwise 'user'.",
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
        "Forget a saved memory by id, only when the user explicitly asks. The note is moved to the vault's archive rather than destroyed. Use list_memory first to find the id.",
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
          : failure(`No memory has id ${id}. Use list_memory to find it.`);
      },
    },
  ];
}
