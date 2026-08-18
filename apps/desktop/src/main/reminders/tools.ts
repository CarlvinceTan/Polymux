import type { AgentTool } from "@flareai/core";
import type { Reminders } from "./index.js";

/**
 * Agent tools for the user's Apple Reminders.
 *
 * These exist so the permission gate can be exact. Reached through a command
 * line, the only evidence that Reminders is about to be touched is the text of
 * the command — which misses a wrapper script and misfires on a `grep`. A tool
 * *is* the point of use, so the grant is checked, and asked for, exactly when
 * it is needed and never otherwise.
 */
export function createRemindersTools(reminders: Reminders): AgentTool[] {
  return [
    createListsTool(reminders),
    createListTool(reminders),
    createCreateTool(reminders),
    createCompleteTool(reminders),
    createDeleteTool(reminders),
  ];
}

function ok(value: unknown): {content: string} {
  return {content: JSON.stringify(value, null, 2)};
}

function failed(error: unknown): {content: string; isError: true} {
  return {
    content: error instanceof Error ? error.message : String(error),
    isError: true,
  };
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${field} is required`);
  return value.trim();
}

function createListsTool(reminders: Reminders): AgentTool {
  return {
    name: "reminders_lists",
    description:
      "List the user's Reminders lists, with their ids and which is the default for new reminders. Use a returned id or name as the `list` argument of the other reminders tools.",
    parameters: {type: "object", properties: {}, additionalProperties: false},
    async execute() {
      try {
        return ok(await reminders.lists());
      } catch (error) {
        return failed(error);
      }
    },
  };
}

function createListTool(reminders: Reminders): AgentTool {
  return {
    name: "reminders_list",
    description:
      "Read the user's reminders, soonest due first and undated ones last. Returns incomplete reminders unless `completed` is true. Each carries the id the other reminders tools take.",
    parameters: {
      type: "object",
      properties: {
        list: {type: "string", description: "Limit to one list, by id or name"},
        completed: {type: "boolean", description: "Read completed reminders instead"},
        limit: {type: "number", description: "1-200, default 50"},
      },
      additionalProperties: false,
    },
    async execute(input) {
      try {
        const limit = typeof input.limit === "number" ? input.limit : 50;
        return ok(
          await reminders.list({
            list: typeof input.list === "string" ? input.list : undefined,
            completed: input.completed === true,
            limit: Math.max(1, Math.min(200, limit)),
          }),
        );
      } catch (error) {
        return failed(error);
      }
    },
  };
}

function createCreateTool(reminders: Reminders): AgentTool {
  return {
    name: "reminders_create",
    description:
      "Create a reminder in the user's Reminders app, so it syncs to their iPhone the way one added by hand does. A `due` carrying a time also sets an alarm; a date alone is due that day without alerting.",
    parameters: {
      type: "object",
      properties: {
        title: {type: "string"},
        notes: {type: "string"},
        due: {
          type: "string",
          description: "ISO 8601, e.g. 2026-08-20 or 2026-08-20T09:00:00",
        },
        list: {type: "string", description: "Target list, by id or name; the default list otherwise"},
        priority: {type: "number", description: "0 none, 1 high, 5 medium, 9 low"},
      },
      required: ["title"],
      additionalProperties: false,
    },
    async execute(input) {
      try {
        return ok(
          await reminders.create({
            title: requireString(input.title, "title"),
            notes: typeof input.notes === "string" ? input.notes : undefined,
            due: typeof input.due === "string" ? input.due : undefined,
            list: typeof input.list === "string" ? input.list : undefined,
            priority: typeof input.priority === "number" ? input.priority : undefined,
          }),
        );
      } catch (error) {
        return failed(error);
      }
    },
  };
}

function createCompleteTool(reminders: Reminders): AgentTool {
  return {
    name: "reminders_complete",
    description:
      "Mark one reminder as done. Pass the exact id from reminders_list.",
    parameters: {
      type: "object",
      properties: {id: {type: "string"}},
      required: ["id"],
      additionalProperties: false,
    },
    async execute(input) {
      try {
        return ok(await reminders.complete(requireString(input.id, "id")));
      } catch (error) {
        return failed(error);
      }
    },
  };
}

function createDeleteTool(reminders: Reminders): AgentTool {
  return {
    name: "reminders_delete",
    description:
      "Delete one reminder outright. Completing is what the user usually means, so prefer reminders_complete unless they asked for it to be removed.",
    parameters: {
      type: "object",
      properties: {id: {type: "string"}},
      required: ["id"],
      additionalProperties: false,
    },
    async execute(input) {
      try {
        return ok(await reminders.remove(requireString(input.id, "id")));
      } catch (error) {
        return failed(error);
      }
    },
  };
}
