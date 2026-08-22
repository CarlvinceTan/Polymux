import type { AgentTool } from "@flareai/core";
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
        name: "update_goal",
        description:
          "Pause or resume the user's existing goal only when the user asks. You cannot create, replace, revise, complete, or block a goal; the user owns its objective and the host judge owns terminal status.",
        parameters: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["active", "paused"],
            },
          },
          required: ["status"],
          additionalProperties: false,
        },
        execute: async (input) => {
          const status = input.status as GoalStatus | undefined;
          if (status !== "active" && status !== "paused")
            throw new Error("Invalid goal status");
          const goal = this.storage.updateGoal(conversationId, {
            status,
          });
          if (!goal) throw new Error("No goal exists for this conversation");
          return result(goal);
        },
      },
    ];
  }
}
