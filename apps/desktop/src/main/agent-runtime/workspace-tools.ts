import type {AgentTool} from "@polymux/core";
import type {AgentRun} from "@polymux/storage";

/**
 * The Polymux-owned app capabilities an external agent receives over its
 * conversation-scoped MCP bridge. Keep this composition explicit: leaving a
 * family out makes ACP agents look connected while silently losing that app.
 */
export function hostWorkspaceTools(input: {
  workspace: AgentTool;
  hubDraft: AgentTool;
  mobile: AgentTool;
  browser: AgentTool[];
  communications: AgentTool[];
  drive: AgentTool[];
  reminders: AgentTool[];
  schedule: AgentTool;
  tasks: AgentTool;
  agentMessage: AgentTool;
  teamSetup: AgentTool;
}): AgentTool[] {
  return [
    input.workspace,
    input.hubDraft,
    input.mobile,
    ...input.browser,
    ...input.communications,
    ...input.drive,
    ...input.reminders,
    input.schedule,
    input.tasks,
    input.agentMessage,
    input.teamSetup,
  ];
}

/** Team bots get their existing scoped primitives, never Assistant app tools. */
export function teamWorkspaceTools(input: {
  agentMessage: AgentTool;
  workspace: AgentTool;
  connections: AgentTool;
}): AgentTool[] {
  return [input.agentMessage, input.workspace, input.connections];
}

export function teamToolContext(
  scope: string,
  memberConversationId: string | undefined,
  activeRuns: ReadonlyArray<Pick<AgentRun, "id" | "conversationId" | "parentRunId" | "status">>,
): {runId: string; budgetScope: string; subagent: false} {
  if (!memberConversationId || scope !== memberConversationId) throw new Error("Team MCP scope no longer belongs to a bot");
  const run = [...activeRuns].reverse().find((run) => run.conversationId === scope && !run.parentRunId && run.status === "running");
  if (!run) throw new Error("Team tools require an active run for this bot");
  return {runId: run.id, budgetScope: run.id, subagent: false};
}
