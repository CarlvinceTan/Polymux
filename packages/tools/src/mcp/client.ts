import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolResultSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { AgentTool, AgentToolResult } from "../types.js";
import type { JsonValue } from "@flareai/inference";
import type { McpServerConfig } from "./config.js";

export interface McpConnectionSnapshot {
  id: string;
  status: "disconnected" | "connecting" | "connected" | "error";
  error?: string;
  toolNames: string[];
  resourceUris: string[];
  promptNames: string[];
}

export class McpConnection {
  readonly config: McpServerConfig;
  readonly #client: Client;
  #transport?: Transport;
  #status: McpConnectionSnapshot["status"] = "disconnected";
  #error?: string;
  #tools: AgentTool[] = [];
  #resourceUris: string[] = [];
  #promptNames: string[] = [];

  constructor(config: McpServerConfig) {
    this.config = config;
    this.#client = new Client(
      { name: "flareai", version: "0.1.0" },
      {
        capabilities: {},
        listChanged: {
          tools: {
            onChanged: (_error, tools) => {
              if (tools) this.#tools = tools.map((tool) => this.#adapt(tool));
            },
          },
          resources: {
            onChanged: (_error, resources) => {
              if (resources)
                this.#resourceUris = resources.map((resource) => resource.uri);
            },
          },
          prompts: {
            onChanged: (_error, prompts) => {
              if (prompts)
                this.#promptNames = prompts.map((prompt) => prompt.name);
            },
          },
        },
      },
    );
  }

  snapshot(): McpConnectionSnapshot {
    return {
      id: this.config.id,
      status: this.#status,
      error: this.#error,
      toolNames: this.#tools.map((tool) => tool.name),
      resourceUris: [...this.#resourceUris],
      promptNames: [...this.#promptNames],
    };
  }
  tools(): AgentTool[] {
    return [...this.#tools];
  }
  async connect(): Promise<void> {
    if (this.#status === "connected" || this.config.enabled === false) return;
    this.#status = "connecting";
    this.#error = undefined;
    try {
      this.#transport =
        this.config.transport === "stdio"
          ? new StdioClientTransport({
              command: this.config.command,
              args: this.config.args,
              env: this.config.env
                ? {...getDefaultEnvironment(), ...this.config.env}
                : undefined,
              cwd: this.config.cwd,
              stderr: "pipe",
            })
          : new StreamableHTTPClientTransport(new URL(this.config.url), {
              requestInit: { headers: this.config.headers },
              authProvider: this.config.authProvider,
              sessionId: this.config.sessionId,
            });
      await this.#client.connect(this.#transport);
      const capabilities = this.#client.getServerCapabilities();
      if (capabilities?.tools)
        this.#tools = (await this.#client.listTools()).tools.map((tool) =>
          this.#adapt(tool),
        );
      if (capabilities?.resources)
        this.#resourceUris = (await this.#client.listResources()).resources.map(
          (resource) => resource.uri,
        );
      if (capabilities?.prompts)
        this.#promptNames = (await this.#client.listPrompts()).prompts.map(
          (prompt) => prompt.name,
        );
      this.#status = "connected";
    } catch (error) {
      this.#status = "error";
      this.#error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.#client.close();
    this.#status = "disconnected";
    this.#tools = [];
    this.#resourceUris = [];
    this.#promptNames = [];
    this.#transport = undefined;
  }

  #adapt(
    tool: Awaited<ReturnType<Client["listTools"]>>["tools"][number],
  ): AgentTool {
    const exposedName = `${this.config.id}.${tool.name}`;
    // `execute` is invoked with the tool object as `this`, so the connection's
    // private client must be captured here rather than read off `this`.
    const client = this.#client;
    return {
      name: exposedName,
      description:
        tool.description ??
        `MCP tool ${tool.name} from ${this.config.name ?? this.config.id}`,
      parameters: tool.inputSchema as AgentTool["parameters"],
      async execute(input, context) {
        const result =
          tool.execution?.taskSupport === "required"
            ? await callTaskTool(client, tool.name, input, context.signal)
            : await client.callTool(
                { name: tool.name, arguments: input },
                CallToolResultSchema,
                { signal: context.signal },
              );
        // callTool's declared return includes a legacy `toolResult` shape the
        // passed CallToolResultSchema has already ruled out at runtime.
        return mcpResult(result as CallToolResult);
      },
    };
  }
}

async function callTaskTool(
  client: Client,
  name: string,
  input: Record<string, unknown>,
  signal: AbortSignal,
): Promise<CallToolResult> {
  for await (const message of client.experimental.tasks.callToolStream(
    { name, arguments: input },
    CallToolResultSchema,
    { signal },
  )) {
    if (message.type === "result") return message.result;
    if (message.type === "error") throw new Error(message.error.message);
  }
  throw new Error(`MCP task tool ${name} ended without a result`);
}

function mcpResult(result: CallToolResult): AgentToolResult {
  const content: AgentToolResult["content"] = [];
  for (const item of result.content ?? []) {
    if (item.type === "text") content.push({ type: "text", text: item.text });
    else if (item.type === "image")
      content.push({ type: "image", data: item.data, mimeType: item.mimeType });
    else content.push({ type: "text", text: JSON.stringify(item) });
  }
  return {
    content: content.length
      ? content
      : [
          {
            type: "text",
            text: result.structuredContent
              ? JSON.stringify(result.structuredContent)
              : "",
          },
        ],
    isError: Boolean(result.isError),
    metadata: { structuredContent: jsonValue(result.structuredContent) },
  };
}

function jsonValue(value: unknown): JsonValue {
  return value === undefined ? null : JSON.parse(JSON.stringify(value));
}
