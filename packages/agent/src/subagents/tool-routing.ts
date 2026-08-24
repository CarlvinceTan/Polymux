import type { AgentTool } from "@polymux/core";
import type { Skill } from "../skills/types.js";

export const TASK_TOOL_GROUPS = [
  "browser",
  "browser-research",
  "browser-read",
  "email-triage",
  "email-read",
  "email",
  "messages-read",
  "messages",
  "communications",
  "drive",
  "drive-read",
  "files",
  "files-read",
  "reminders",
  "schedule",
  "recording",
  "workspace",
  "memory",
  "history",
  "computerHistory",
  "resume",
  "all",
] as const;

export type TaskToolGroup = (typeof TASK_TOOL_GROUPS)[number];

const BOUNDED_RESEARCH_GROUPS = new Set<TaskToolGroup>([
  "browser-research",
  "browser-read",
  "email-triage",
  "email-read",
  "messages-read",
  "drive-read",
  "files-read",
  "memory",
  "history",
  "computerHistory",
]);

/** A deterministic evidence ceiling is safe only for explicitly routed,
 * read-only research. Requiring browser-research keeps local-only reads and
 * action/coding/ambiguous routes on the ordinary lossless runner path. */
export function boundedResearchToolTurnBudget(
  groups: TaskToolGroup[] | undefined,
): {maximum: number; synthesisPrompt: string} | undefined {
  if (
    !groups?.includes("browser-research") ||
    groups.includes("all") ||
    groups.some((group) => !BOUNDED_RESEARCH_GROUPS.has(group))
  ) return undefined;
  const singleSource = groups.length === 1;
  return {
    maximum: singleSource ? 4 : 6,
    synthesisPrompt:
      "The bounded evidence phase is complete. Return a concise, self-contained answer using only the evidence already gathered. Distinguish verified facts from uncertainty, mention any important source limitation, and do not call tools or describe internal reasoning.",
  };
}

/**
 * Lossless fallback routing for a coordinator that omits route
 * metadata. Only explicit read-only evidence work is narrowed; ambiguous or
 * mutating work returns undefined and keeps the complete tool catalogue.
 */
export function inferTaskToolGroups(description: string, prompt: string): TaskToolGroup[] | undefined {
  const text = `${description}\n${prompt}`.toLowerCase();
  const readOnly = /\b(?:read[- ]only|do not (?:send|submit|modify|change|write|book|pay)|investigate|research|review|verify|check|find|look up)\b/.test(text);
  const affirmative = text.replace(/\b(?:do not|don't|never)\b[^.;\n]*/g, "");
  const mutation = /\b(?:send|submit|modify|change|write|delete|remove|book|pay|purchase|upload|fill|edit|create)\b/.test(affirmative);
  if (!readOnly || mutation) return undefined;

  const groups: TaskToolGroup[] = [];
  if (/\b(?:official|web|website|browser|page|online|source|url|portal)\b/.test(text))
    groups.push("browser-research");
  if (/\b(?:email|mail|inbox|correspondence)\b/.test(text)) groups.push("email-triage");
  if (/\b(?:drive|cloud|records?|documents?|files?|folders?)\b/.test(text)) groups.push("drive-read");
  if (/\b(?:message|chat|whatsapp|telegram|discord|imessage|wechat)\b/.test(text))
    groups.push("messages-read");
  return groups.length ? [...new Set(groups)] : undefined;
}

export function taskGroupEnabled(
  groups: TaskToolGroup[] | undefined,
  group: TaskToolGroup,
): boolean {
  return !groups?.length || groups.includes("all") || groups.includes(group);
}

/** Connector tool names are provider-defined and namespaced after MCP import.
 * Match bounded read semantics rather than enumerating the user's providers;
 * mutation verbs remain excluded from the read-only route. */
function isExternalMessageReadTool(name: string): boolean {
  const leaf = name.split("__").at(-1) ?? name;
  const words = leaf.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const hasMessageSubject = words.some((word) =>
    ["message", "messages", "chat", "chats", "room", "rooms", "channel", "channels", "contact", "contacts", "conversation", "conversations"].includes(word),
  );
  const hasReadVerb = words.some((word) =>
    ["read", "get", "list", "search", "find", "unread", "history"].includes(word),
  );
  const hasMutationVerb = words.some((word) =>
    ["send", "post", "reply", "create", "update", "edit", "delete", "remove", "archive", "mark", "react"].includes(word),
  );
  return name.includes("__") && hasMessageSubject && hasReadVerb && !hasMutationVerb;
}

/**
 * Selects only the host capabilities a delegated task was explicitly given.
 * An absent/empty route and `all` are deliberately lossless fallbacks: this
 * routing may save context, but it may never silently make an ambiguous
 * task impossible. `read` remains available so a routed worker can load the
 * complete SKILL.md it was instructed to follow.
 */
export function selectTaskTools(
  tools: AgentTool[],
  groups?: TaskToolGroup[],
): AgentTool[] {
  if (!groups?.length || groups.includes("all")) return tools;
  const selected = new Set(groups);
  return tools.filter((tool) => {
    const name = tool.name;
    if (name === "read") return true;
    if (
      selected.has("browser-research") &&
      ["browser", "browser_read", "browser_snapshot_many", "resolve_current_location"].includes(name)
    ) return true;
    if (
      selected.has("browser-read") &&
      ["browser_current_read", "computer_state"].includes(name)
    ) return true;
    if (selected.has("browser") && (name.startsWith("browser") || ["computer_state", "computer_arbiter"].includes(name))) return true;
    if (selected.has("email-triage") && ["email_search_all", "email_read"].includes(name)) return true;
    if (selected.has("email-read") && ["email_accounts", "email_folders", "email_list", "email_read", "email_search", "email_search_all"].includes(name)) return true;
    if (selected.has("email") && name.startsWith("email_")) return true;
    if (
      selected.has("messages-read") &&
      (["message_chats", "message_read", "message_search", "message_unread"].includes(name) ||
        isExternalMessageReadTool(name))
    ) return true;
    if (selected.has("messages") && name.startsWith("message_")) return true;
    if (selected.has("communications") && (name.startsWith("email_") || name.startsWith("message_"))) return true;
    if (selected.has("drive") && name.startsWith("drive_")) return true;
    if (selected.has("drive-read") && ["drive_sources", "drive_list", "drive_read"].includes(name))
      return true;
    if (selected.has("files") && ["read", "write", "edit", "bash"].includes(name))
      return true;
    if (selected.has("files-read") && name === "read") return true;
    if (selected.has("reminders") && name.startsWith("reminders_")) return true;
    if (selected.has("schedule") && name === "schedule") return true;
    if (selected.has("recording") && name === "record_workflow") return true;
    if (selected.has("workspace") && name === "hub_draft") return true;
    if (
      selected.has("resume") &&
      (
        [
          "bash", "edit", "read", "write",
          "computer_state", "computer_arbiter",
          "browser", "browser_tabs", "browser_current_read", "browser_read",
          "browser_snapshot_many", "browser_control",
          "email_accounts", "email_folders", "email_list", "email_read",
          "email_search", "email_search_all", "email_draft",
          "message_chats", "message_read", "message_search", "message_unread",
          "reminders_create", "reminders_list", "reminders_update", "schedule",
          "workspace_show", "record_workflow",
        ].includes(name)
      )
    ) return true;
    return false;
  });
}

/** Exact-name routing from the catalogue already visible to the coordinator.
 * Any unknown name falls back to the full catalogue so a typo costs context,
 * never capability. */
export function selectTaskSkills(
  skills: Skill[],
  names?: string[],
): Skill[] {
  if (names?.length === 0) return [];
  if (!names) return skills;
  const wanted = new Set(names);
  const selected = skills.filter((skill) => wanted.has(skill.name));
  return selected.length === wanted.size ? selected : skills;
}
