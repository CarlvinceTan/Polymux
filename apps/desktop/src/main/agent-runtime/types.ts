import type {ActiveAgentRun} from "@polymux/core";
import type {ReasoningEffort} from "@polymux/inference";

/** The host-facing contract shared by the bundled agent and external agents. */
export interface AgentRuntime {
  readonly id: string;
  readonly name: string;
  start(input: AgentRuntimeStartInput): ActiveAgentRun;
  /** Called after active runs settle when durable conversation history changes. */
  resetHistory(conversationId: string): Promise<void> | void;
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
  /** Persistent identity attached by the Team host, never accepted from IPC. */
  identity?: {
    name: string;
    role: string;
    bots: Array<{name: string; role: string}>;
  };
}

export interface AcpRuntimeConfig {
  kind: "acp";
  name: string;
  command: string;
  args: string[];
  cwd?: string;
  agentId?: string;
  configId?: string;
  /** Non-secret launch defaults declared by the registry distribution. */
  registryEnvironment?: Record<string, string>;
  /** Host-computed isolation variables; never accepted directly from IPC. */
  environment?: NodeJS.ProcessEnv;
  /** Preferred ACP session options, applied whenever a new session is made. */
  config?: Record<string, string | boolean>;
}

export type AgentRuntimeConfig = {kind: "polymux"} | AcpRuntimeConfig;
