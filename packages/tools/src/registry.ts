import type { AgentTool } from "./types.js";

export class ToolRegistry {
  readonly #tools = new Map<string, AgentTool>();

  constructor(tools: Iterable<AgentTool> = []) {
    for (const tool of tools) this.register(tool);
  }

  register(tool: AgentTool): void {
    if (!tool.name.trim()) throw new Error("Tool name cannot be empty");
    this.#tools.set(tool.name, tool);
  }

  remove(name: string): boolean {
    return this.#tools.delete(name);
  }
  get(name: string): AgentTool | undefined {
    return this.#tools.get(name);
  }
  list(): AgentTool[] {
    return [...this.#tools.values()];
  }
}
