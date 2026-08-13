import type { GoalCommandRequest, StartRunRequest } from "./types.js";

export function validateStartRun(value: unknown): StartRunRequest {
  const input = record(value, "start run");
  return {
    conversationId: text(input.conversationId, "conversationId"),
    text: text(input.text, "text"),
    messageId:
      input.messageId === undefined
        ? undefined
        : text(input.messageId, "messageId"),
    attachments:
      input.attachments === undefined
        ? undefined
        : stringArray(input.attachments, "attachments"),
    asGoal:
      input.asGoal === undefined ? undefined : boolean(input.asGoal, "asGoal"),
  };
}

export function validateGoalCommand(value: unknown): GoalCommandRequest {
  const input = record(value, "goal command");
  const action = text(input.action, "action");
  if (
    !["view", "create", "update", "pause", "resume", "clear"].includes(action)
  )
    throw new Error("Invalid goal action");
  const objective =
    input.objective === undefined
      ? undefined
      : text(input.objective, "objective");
  if ((action === "create" || action === "update") && !objective?.trim())
    throw new Error("Goal objective is required");
  return {
    conversationId: text(input.conversationId, "conversationId"),
    action: action as GoalCommandRequest["action"],
    objective,
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${label} must be a non-empty string`);
  return value;
}
function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
    throw new Error(`${label} must be an array of strings`);
  return value;
}
function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}
