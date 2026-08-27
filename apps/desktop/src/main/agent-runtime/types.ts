import type {ActiveAgentRun} from "@polymux/core";
import type {ReasoningEffort} from "@polymux/inference";

/** The host-facing contract shared by the bundled agent and external agents. */
export interface AgentRuntime {
  readonly id: string;
  readonly name: string;
  start(input: AgentRuntimeStartInput): ActiveAgentRun;
  close?(): Promise<void> | void;
}

export interface AgentRuntimeStartInput {
  conversationId: string;
  text: string;
  runId: string;
  userMessageId?: string;
  attachments?: string[];
  reasoning?: ReasoningEffort;
  speechMode?: boolean;
  asGoal?: boolean;
  reuseUserMessage?: boolean;
  contextThroughSequence?: number;
  executionScopeId?: string;
  replyToMessageId?: string;
  maxTaskDispatches?: number;
  goalProgressContext?: boolean;
}

export interface AcpRuntimeConfig {
  kind: "acp";
  name: string;
  command: string;
  args: string[];
  cwd?: string;
  /** Preferred ACP session options, applied whenever a new session is made. */
  config?: Record<string, string | boolean>;
}

export type AgentRuntimeConfig = {kind: "polymux"} | AcpRuntimeConfig;
