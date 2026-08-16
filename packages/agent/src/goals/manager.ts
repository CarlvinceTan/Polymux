import type { AgentTool } from "@flareai/core";
import type { JsonObject } from "@flareai/inference";
import type { Goal, GoalStatus, Storage } from "@flareai/storage";

export type GoalCommand =
  | { action: "view" | "clear" | "pause" | "resume" }
  | { action: "create"; objective: string };

export class GoalManager {
  constructor(readonly storage: Storage) {}
  get(conversationId: string): Goal | null {
    return this.storage.getGoal(conversationId);
  }
  execute(conversationId: string, command: GoalCommand): Goal | null {
    if (command.action === "view") return this.get(conversationId);
    if (command.action === "clear") {
      this.storage.clearGoal(conversationId);
      return null;
    }
    if (command.action === "create")
      return this.storage.createGoal({
        id: crypto.randomUUID(),
        conversationId,
        objective: command.objective,
      });
    const goal = this.storage.getGoal(conversationId);
    if (!goal) throw new Error("No goal exists for this conversation");
    return this.storage.updateGoal(conversationId, {
      status: command.action === "pause" ? "paused" : "active",
    });
  }

  /** Terminal status writes owned by the goal loop's judge, not the agent. */
  setStatus(conversationId: string, status: GoalStatus): Goal | null {
    return this.storage.updateGoal(conversationId, { status });
  }

  tools(conversationId: string): AgentTool[] {
    const result = (value: unknown) => ({ content: JSON.stringify(value) });
    return [
      {
        name: "get_goal",
        description: "Get the durable goal for this conversation.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        execute: async () => result(this.get(conversationId)),
      },
      {
        name: "create_goal",
        description:
          "Create a durable goal only when the user explicitly requests one. Fails while an unfinished goal exists.",
        parameters: {
          type: "object",
          properties: { objective: { type: "string" } },
          required: ["objective"],
          additionalProperties: false,
        },
        execute: async (input) =>
          result(
            this.storage.createGoal({
              id: crypto.randomUUID(),
              conversationId,
              objective: requiredString(input, "objective"),
            }),
          ),
      },
      {
        name: "update_goal",
        description:
          "Revise the current goal's objective, or pause it when the user asks. Completion is not yours to declare: a judge reads your closing message after every turn and sets the final status, so state plainly in your reply when the goal is finished and what verifies it, or what is blocking you.",
        parameters: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["active", "paused", "completed", "blocked"],
            },
            objective: { type: "string" },
          },
          additionalProperties: false,
        },
        execute: async (input) => {
          const status = input.status as GoalStatus | undefined;
          if (
            status &&
            !["active", "paused", "completed", "blocked"].includes(status)
          )
            throw new Error("Invalid goal status");
          const objective =
            typeof input.objective === "string" ? input.objective : undefined;
          const goal = this.storage.updateGoal(conversationId, {
            status,
            objective,
          });
          if (!goal) throw new Error("No goal exists for this conversation");
          return result(goal);
        },
      },
    ];
  }
}

function requiredString(input: JsonObject, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${key} must be a non-empty string`);
  return value.trim();
}
