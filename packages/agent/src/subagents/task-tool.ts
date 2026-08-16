import type { AgentTool } from "@flareai/core";
import type { JsonObject } from "@flareai/inference";

export interface SubagentRequest {
  description: string;
  prompt: string;
  context: "none" | "recent";
}
export type SubagentRunner = (
  request: SubagentRequest,
  signal: AbortSignal,
) => Promise<{ runId: string; result: string; status: string }>;

export function createTaskTool(run: SubagentRunner): AgentTool {
  return {
    name: "task",
    description:
      "Delegate a concrete, bounded subtask to an independent FlareAI subagent and return its result. Multiple task calls may run concurrently.",
    executionMode: "parallel",
    parameters: {
      type: "object",
      properties: {
        description: { type: "string" },
        prompt: { type: "string" },
        context: { type: "string", enum: ["none", "recent"] },
      },
      required: ["description", "prompt"],
      additionalProperties: false,
    },
    async execute(input: JsonObject, context) {
      const request: SubagentRequest = {
        description: required(input, "description"),
        prompt: required(input, "prompt"),
        context: input.context === "recent" ? "recent" : "none",
      };
      const result = await run(request, context.signal);
      return {
        content: result.result,
        isError: result.status !== "completed",
        metadata: { childRunId: result.runId, status: result.status },
      };
    },
  };
}
function required(input: JsonObject, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${key} must be a non-empty string`);
  return value.trim();
}
