import type { AgentTool, AgentToolContext } from "@flareai/core";
import type { JsonObject } from "@flareai/inference";

export interface SubagentRequest {
  description: string;
  prompt: string;
  context: "none" | "recent";
}
/** The tool's own call context is handed straight through: the runtime needs
 * it to announce the child run's id on the parent's event stream, which is
 * what lets the UI open a task's transcript while it is still working. */
export type SubagentRunner = (
  request: SubagentRequest,
  context: AgentToolContext,
) => Promise<{ runId: string; result: string; status: string }>;

export function createTaskTool(run: SubagentRunner): AgentTool {
  return {
    name: "task",
    description: [
      "Delegate a bounded piece of work to an independent FlareAI subagent and return its result.",
      "",
      "## When to use",
      "Use this whenever the user asks for work to be done rather than explained: research, diagnosis, drafting, building, multi-step execution. Call it instead of doing the work yourself. Send one call per independent piece of work in the same turn and they run in parallel.",
      "",
      "Do the work yourself only for a short factual answer, a clarifying question, or safety triage.",
      "",
      "- The subagent's result is not shown to the user — relay what matters.",
      "- Subagents cannot delegate further; split the work yourself.",
      "- Keep dependent, irreversible, paid, or outward-facing steps sequential, and get approval before them.",
    ].join("\n"),
    executionMode: "parallel",
    parameters: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description:
            "Short label for the subtask, shown to the user in the activity trail.",
        },
        prompt: {
          type: "string",
          description:
            "The complete standalone instruction. The subagent does not see the conversation, so include everything it needs.",
        },
        context: {
          type: "string",
          enum: ["none", "recent"],
          description:
            'Defaults to "none". Use "recent" only when the subtask genuinely depends on what was just discussed.',
        },
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
      const result = await run(request, context);
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
