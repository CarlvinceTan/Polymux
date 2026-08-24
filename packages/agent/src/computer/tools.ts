import type {AgentTool} from "@polymux/core";
import type {Computer} from "@polymux/computer";
import type {ControlOperation, ControlScope, SurfaceView} from "@polymux/computer";

export function createComputerTools(computer: Computer): AgentTool[] {
  const result = (value: unknown) => ({content: JSON.stringify(value, null, 2)});
  return [
    {
      name: "computer_state",
      mainAgentOnly: true,
      description:
        "Read the complete compact live inventory for the requested surface types. Every result also identifies the surface the user currently controls. Request tabs for browser references, windows for app/window references, or all three when the prompt is genuinely broad or ambiguous. Titles and sanitized URLs are routing context, not authorization to inspect or mutate content.",
      parameters: {
        type: "object",
        properties: {
          surfaces: {type: "array", items: {type: "string", enum: ["apps", "windows", "tabs"]}},
          app: {type: "string", description: "Optional app-name filter; omit to return every requested surface."},
        },
        required: [],
        additionalProperties: false,
      },
      async execute(input) {
        const surfaces = Array.isArray(input.surfaces)
          ? input.surfaces.filter((value): value is SurfaceView => value === "apps" || value === "windows" || value === "tabs")
          : undefined;
        return result(computer.State.query({surfaces, app: typeof input.app === "string" ? input.app : undefined}));
      },
    },
    {
      name: "computer_arbiter",
      mainAgentOnly: true,
      executionMode: "sequential",
      description:
        "Request, validate, or release exact-surface UI control. Request before any mutation; read-only inspection may use operation=read. A granted token is scoped safety permission only, never authorization to send, submit, pay, delete, disclose, or make another consequential change.",
      parameters: {
        type: "object",
        properties: {
          action: {type: "string", enum: ["request", "validate", "release"]},
          surfaceId: {type: "string"},
          operation: {type: "string", enum: ["read", "press", "type", "scroll", "navigate", "close", "reorganize"]},
          scope: {type: "string", enum: ["element", "tab", "window", "app"]},
          explicitlyRequested: {type: "boolean"},
          token: {type: "string"},
        },
        required: ["action"],
        additionalProperties: false,
      },
      async execute(input, context) {
        const action = String(input.action);
        if (action === "release")
          return result({released: typeof input.token === "string" && computer.Arbiter.release(input.token)});
        if (action === "validate")
          return result({valid: typeof input.token === "string" && typeof input.surfaceId === "string" && computer.Arbiter.validate(
            input.token,
            input.surfaceId,
            typeof input.operation === "string" ? input.operation as ControlOperation : undefined,
            typeof input.scope === "string" ? input.scope as ControlScope : undefined,
          )});
        if (typeof input.surfaceId !== "string" || typeof input.operation !== "string" || typeof input.scope !== "string")
          return {content: "request requires surfaceId, operation, and scope", isError: true};
        return result(computer.Arbiter.request({
          ownerId: context.runId,
          surfaceId: input.surfaceId,
          operation: input.operation as ControlOperation,
          scope: input.scope as ControlScope,
          explicitlyRequested: input.explicitlyRequested === true,
        }));
      },
    },
  ];
}
