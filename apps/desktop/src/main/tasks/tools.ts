import type { AgentTool } from "@flareai/core";
import type { TaskCardDto, TaskCardInput, TaskCardPatch } from "@flareai/protocol";

export interface TaskBook {
  list(chatId?: string): TaskCardDto[];
  create(input: TaskCardInput): TaskCardDto;
  update(id: string, patch: TaskCardPatch): TaskCardDto;
  remove(id: string): void;
  claim(id: string, owner: string): TaskCardDto;
  complete(id: string, owner: string): TaskCardDto;
  recycle(id: string): TaskCardDto;
}

function summarise(card: TaskCardDto) {
  return {
    id: card.id,
    title: card.title,
    detail: card.detail,
    status: card.status,
    owner: card.owner,
    reviewed: card.reviewed,
  };
}

function fail(message: string) {
  return {content: JSON.stringify({error: message}), isError: true as const};
}

export function createTasksTool(
  book: TaskBook,
  chatForRun: (runId: string) => string | null,
): AgentTool {
  return {
    name: "tasks",
    description: [
      "Manage this chat's task pool.",
      "Actions: 'list' shows all cards with their ids and status;",
      "'create' adds a new card to the To Do column — give it a title and optionally a detail;",
      "'claim' takes a To Do card and moves it to In Progress under your ownership;",
      "'complete' marks a claimed card as Done;",
      "'recycle' moves a completed card back to To Do for another pass;",
      "'update' changes a card's title or detail;",
      "'remove' deletes a card.",
      "Cards and claims never cross into another chat.",
      "Claim a card before working on it to avoid conflicts with sibling agents.",
    ].join(" "),
    executionMode: "sequential",
    parameters: {
      type: "object",
      properties: {
        action: {type: "string", enum: ["list", "create", "claim", "complete", "recycle", "update", "remove"]},
        id: {type: "string"},
        title: {type: "string"},
        detail: {type: "string"},
      },
      required: ["action"],
      additionalProperties: false,
    },
    async execute(input, context) {
      const action = String(input.action ?? "");
      const chatId = chatForRun(context?.runId ?? "");
      if (!chatId) return fail("Tasks needs a chat-scoped run");
      if (action === "list") return {content: JSON.stringify({cards: book.list(chatId).map(summarise)})};

      if (action === "create") {
        const title = typeof input.title === "string" ? input.title.trim() : "";
        if (!title) return fail("create needs a title");
        return {content: JSON.stringify(summarise(book.create({
          chatId,
          title,
          detail: typeof input.detail === "string" ? input.detail.trim() || undefined : undefined,
        })))};
      }

      const id = typeof input.id === "string" ? input.id : "";
      if (!id) return fail(`${action} needs an id`);
      if (!book.list(chatId).some((card) => card.id === id))
        return fail(`Task ${id} is not in this chat`);
      const owner = context?.runId ?? "agent";

      if (action === "claim") return {content: JSON.stringify(summarise(book.claim(id, owner)))};
      if (action === "complete") return {content: JSON.stringify(summarise(book.complete(id, owner)))};
      if (action === "recycle") return {content: JSON.stringify(summarise(book.recycle(id)))};

      if (action === "update") {
        const patch: TaskCardPatch = {};
        if (typeof input.title === "string") patch.title = input.title.trim();
        if (typeof input.detail === "string") patch.detail = input.detail.trim();
        return {content: JSON.stringify(summarise(book.update(id, patch)))};
      }

      if (action === "remove") {
        book.remove(id);
        return {content: JSON.stringify({removed: id})};
      }

      return fail(`Unknown action: ${action}`);
    },
  };
}
