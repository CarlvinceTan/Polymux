import type { AgentTool } from "../types.js";
import type { McpServerConfig } from "./config.js";
import { McpConnection, type McpConnectionSnapshot } from "./client.js";

export class McpManager {
  readonly #connections = new Map<string, McpConnection>();

  configure(configs: Iterable<McpServerConfig>): void {
    const next = new Set<string>();
    for (const config of configs) {
      next.add(config.id);
      const existing = this.#connections.get(config.id);
      if (!existing || configKey(existing.config) !== configKey(config)) {
        if (existing) void existing.close().catch((): undefined => undefined);
        this.#connections.set(config.id, new McpConnection(config));
      }
    }
    for (const [id, connection] of this.#connections) {
      if (!next.has(id)) {
        this.#connections.delete(id);
        void connection.close().catch((): undefined => undefined);
      }
    }
  }

  async connectEnabled(): Promise<McpConnectionSnapshot[]> {
    await Promise.allSettled(
      [...this.#connections.values()]
        .filter((item) => item.config.enabled !== false)
        .map((item) => item.connect()),
    );
    return this.snapshots();
  }

  tools(): AgentTool[] {
    return [...this.#connections.values()].flatMap((connection) =>
      connection.tools(),
    );
  }
  snapshots(): McpConnectionSnapshot[] {
    return [...this.#connections.values()].map((connection) =>
      connection.snapshot(),
    );
  }
  async close(): Promise<void> {
    await Promise.all(
      [...this.#connections.values()].map((connection) => connection.close()),
    );
  }
}

function configKey(config: McpServerConfig): string {
  if (config.transport === "stdio")
    return JSON.stringify([
      config.transport,
      config.command,
      config.args,
      config.env,
      config.cwd,
      config.enabled,
    ]);
  return JSON.stringify([
    config.transport,
    config.url,
    config.headers,
    config.sessionId,
    config.enabled,
  ]);
}
