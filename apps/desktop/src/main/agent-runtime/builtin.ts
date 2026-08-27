import type {PolymuxAgent} from "@polymux/agent";
import type {AgentRuntime, AgentRuntimeStartInput} from "./types.js";

/** Keeps the first-party agent behind the same boundary as external runtimes. */
export class BuiltinAgentRuntime implements AgentRuntime {
  readonly id = "polymux";
  readonly name = "Polymux Agent";

  constructor(private readonly agent: PolymuxAgent) {}

  start(input: AgentRuntimeStartInput) {
    return this.agent.start(input);
  }
}
