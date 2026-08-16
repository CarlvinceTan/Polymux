import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { AgentTool } from "@flareai/core";
import type { AgentSurfaceServer } from "./agent-surface.js";

/**
 * Agent tools backed by the FlareAI browser extension: `browser_tabs` reads the
 * tab snapshot the extension streams to disk, and `browser_control` drives a
 * leased tab through the agent-surface command channel (with the ChatGPT-style
 * cursor presented in-page while it works).
 */

const TABS_PATH = path.join(
  homedir(),
  "Library",
  "Application Support",
  "flareai-tab-context",
  "tabs.json",
);

export function createBrowserControlTools(
  surface: AgentSurfaceServer,
): AgentTool[] {
  return [createTabsTool(), createControlTool(surface)];
}

function createTabsTool(): AgentTool {
  return {
    name: "browser_tabs",
    description:
      "List the tabs currently open in the user's browser (title, url, active state), as streamed by the FlareAI browser extension. Returns a staleness age; treat an old snapshot as history, not current state.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async execute() {
      let raw: string;
      try {
        raw = await readFile(TABS_PATH, "utf8");
      } catch {
        return {
          content:
            "No tab snapshot is available. The FlareAI browser extension is not installed or has not reported yet.",
          isError: true,
        };
      }
      const payload = JSON.parse(raw) as {
        captured_at?: string;
        tabs?: Array<Record<string, unknown>>;
      };
      const capturedAt = Date.parse(payload.captured_at ?? "");
      const age = Number.isFinite(capturedAt)
        ? Math.round((Date.now() - capturedAt) / 1000)
        : null;
      return {
        content: JSON.stringify(
          {
            captured_at: payload.captured_at ?? null,
            age_seconds: age,
            tabs: (payload.tabs ?? []).map((tab) => ({
              title: tab.title,
              url: tab.url,
              active: tab.active,
              window_id: tab.window_id,
            })),
          },
          null,
          2,
        ),
      };
    },
  };
}

function createControlTool(surface: AgentSurfaceServer): AgentTool {
  return {
    name: "browser_control",
    description: [
      "Control a tab in the user's browser through the FlareAI extension.",
      "Actions: 'focus' binds a lease to the tab matching url and/or title (use browser_tabs first) and returns a leaseId used by every later action;",
      "'navigate' loads a url; 'click' clicks a CSS selector or viewport x/y;",
      "'type' types text into a selector (submit: true presses Enter);",
      "'scroll' scrolls by deltaY pixels; 'read' returns the page title, url, and visible text;",
      "Input pacing defaults to calm, unhurried human movement; pass pace: 'fast' when speed matters more than subtlety.",
      "'release' ends the lease. Pointer actions animate the in-page cursor before acting.",
      "This controls the exact leased tab only; it never raises the browser or switches the user's focus.",
    ].join(" "),
    executionMode: "sequential",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["focus", "navigate", "click", "type", "scroll", "read", "release"],
        },
        leaseId: { type: "string" },
        url: { type: "string" },
        title: { type: "string" },
        selector: { type: "string" },
        text: { type: "string" },
        x: { type: "number" },
        y: { type: "number" },
        deltaY: { type: "number" },
        submit: { type: "boolean" },
        pace: { type: "string", enum: ["fast", "calm"] },
        maxChars: { type: "number" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    async execute(input) {
      const action = String(input.action ?? "");
      if (action === "focus") {
        const url = typeof input.url === "string" ? input.url : "";
        const title = typeof input.title === "string" ? input.title : "";
        if (!url && !title)
          return {
            content: "focus requires url and/or title to identify the exact tab",
            isError: true,
          };
        const lease = surface.createLease({ url, title });
        // Confirm the extension actually matched a tab before reporting bound.
        const probe = await surface.runCommand(lease.id, { kind: "read", maxChars: 200 }, 8_000);
        if (!probe.ok) {
          surface.releaseLease(lease.id);
          return {
            content: `Could not bind to that tab: ${probe.error ?? "no matching tab responded"}`,
            isError: true,
          };
        }
        return {
          content: JSON.stringify({
            leaseId: lease.id,
            pageUrl: probe.pageUrl,
            pageTitle: probe.pageTitle,
          }),
        };
      }

      const leaseId = typeof input.leaseId === "string" ? input.leaseId : "";
      if (!leaseId)
        return { content: `${action} requires the leaseId from focus`, isError: true };
      if (action === "release") {
        surface.releaseLease(leaseId);
        return { content: "released" };
      }

      const command =
        action === "navigate"
          ? { kind: "navigate" as const, url: String(input.url ?? "") }
          : action === "click"
            ? {
                kind: "click" as const,
                selector: typeof input.selector === "string" ? input.selector : undefined,
                x: typeof input.x === "number" ? input.x : undefined,
                y: typeof input.y === "number" ? input.y : undefined,
              }
            : action === "type"
              ? {
                  kind: "type" as const,
                  selector: typeof input.selector === "string" ? input.selector : undefined,
                  text: String(input.text ?? ""),
                  submit: input.submit === true,
                }
              : action === "scroll"
                ? {
                    kind: "scroll" as const,
                    deltaY: typeof input.deltaY === "number" ? input.deltaY : 600,
                  }
                : action === "read"
                  ? {
                      kind: "read" as const,
                      maxChars:
                        typeof input.maxChars === "number" ? input.maxChars : 20_000,
                    }
                  : null;
      if (!command)
        return { content: `Unknown action: ${action}`, isError: true };
      if (command.kind === "navigate" && !command.url)
        return { content: "navigate requires url", isError: true };
      if (command.kind === "click" && !command.selector && command.x === undefined)
        return { content: "click requires selector or x/y", isError: true };
      if (command.kind === "type" && !command.selector)
        return { content: "type requires selector", isError: true };

      const pace = input.pace === "fast" ? ("fast" as const) : undefined;
      const result = await surface.runCommand(
        leaseId,
        pace ? { ...command, pace } : command,
      );
      if (!result.ok)
        return { content: result.error ?? "command failed", isError: true };
      return {
        content: JSON.stringify({
          ok: true,
          pageUrl: result.pageUrl,
          pageTitle: result.pageTitle,
          ...(result.content !== undefined ? { content: result.content } : {}),
        }),
      };
    },
  };
}
