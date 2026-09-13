import {randomBytes, randomUUID} from "node:crypto";
import {createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse} from "node:http";
import {Server} from "@modelcontextprotocol/sdk/server/index.js";
import {StreamableHTTPServerTransport} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {CallToolRequestSchema, ListToolsRequestSchema} from "@modelcontextprotocol/sdk/types.js";
import type {AgentTool, AgentToolContext, AgentToolResult} from "@polymux/core";
import type {JsonObject} from "@polymux/inference";

export interface ToolMcpServerDescriptor {
  type: "http";
  name: string;
  url: string;
  headers: Array<{name: string; value: string}>;
}

export interface ToolMcpServerOptions {
  name: string;
  version: string;
  instructions?: string;
  tools(): Iterable<AgentTool>;
  /** Resolves the active run each time a tool is called. ACP sessions outlive
   * one turn, so capturing the run id when the session is created is stale. */
  context(scope: string): Pick<AgentToolContext, "runId"> &
    Partial<Pick<AgentToolContext, "budgetScope" | "subagent">>;
}

/**
 * A loopback-only MCP view over host-owned AgentTools.
 *
 * ACP agents receive MCP server descriptors rather than the bundled agent's
 * ToolRegistry. A bearer capability binds each descriptor to one conversation
 * scope, while the context callback binds calls to the currently active run.
 */
export class ToolMcpServer {
  readonly #options: ToolMcpServerOptions;
  readonly #tokens = new Map<string, string>();
  readonly #scopeTokens = new Map<string, string>();
  #server?: HttpServer;
  #starting?: Promise<void>;
  #port = 0;

  constructor(options: ToolMcpServerOptions) {
    this.#options = options;
  }

  async descriptor(scope: string): Promise<ToolMcpServerDescriptor> {
    const normalized = scope.trim();
    if (!normalized) throw new Error("MCP tool scope cannot be empty");
    await this.start();
    let token = this.#scopeTokens.get(normalized);
    if (!token) {
      token = randomBytes(32).toString("base64url");
      this.#scopeTokens.set(normalized, token);
      this.#tokens.set(token, normalized);
    }
    return {
      type: "http",
      name: this.#options.name,
      url: `http://127.0.0.1:${this.#port}/mcp`,
      headers: [{name: "Authorization", value: `Bearer ${token}`}],
    };
  }

  /** Retire a discarded ACP session's bearer before a replacement is issued. */
  revoke(scope: string): void {
    const token = this.#scopeTokens.get(scope);
    if (token) this.#tokens.delete(token);
    this.#scopeTokens.delete(scope);
  }

  start(): Promise<void> {
    if (this.#server?.listening) return Promise.resolve();
    if (this.#starting) return this.#starting;
    const server = createServer((request, response) => {
      void this.#handle(request, response);
    });
    this.#server = server;
    const starting = new Promise<void>((resolve, reject) => {
      const failed = (error: Error) => {
        if (this.#server === server) this.#server = undefined;
        reject(error);
      };
      server.once("error", failed);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", failed);
        const address = server.address();
        if (!address || typeof address === "string") {
          server.close();
          reject(new Error("Polymux tool server did not bind a TCP port"));
          return;
        }
        this.#port = address.port;
        resolve();
      });
    }).finally(() => {
      if (this.#starting === starting) this.#starting = undefined;
    });
    this.#starting = starting;
    return starting;
  }

  async close(): Promise<void> {
    const pending = this.#starting;
    await pending?.catch(() => {});
    const server = this.#server;
    this.#server = undefined;
    this.#port = 0;
    this.#tokens.clear();
    this.#scopeTokens.clear();
    if (!server?.listening) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const scope = this.#authorizedScope(request);
    if (!scope) {
      jsonError(response, 401, -32001, "Unauthorized");
      return;
    }
    if (request.method !== "POST" || request.url?.split("?", 1)[0] !== "/mcp") {
      jsonError(response, 405, -32000, "Method not allowed");
      return;
    }

    const tools = new Map([...this.#options.tools()].map((tool) => [tool.name, tool]));
    const server = new Server(
      {name: this.#options.name, version: this.#options.version},
      {
        capabilities: {tools: {}},
        instructions: this.#options.instructions,
      },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [...tools.values()].map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.parameters as never,
      })),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (call, extra) => {
      const tool = tools.get(call.params.name);
      if (!tool)
        return {content: [{type: "text" as const, text: `Unknown tool: ${call.params.name}`}], isError: true};
      const current = this.#options.context(scope);
      const context: AgentToolContext = {
        runId: current.runId,
        budgetScope: current.budgetScope,
        turn: 0,
        callId: randomUUID(),
        signal: extra.signal,
        subagent: current.subagent ?? false,
        emitProgress: async () => {},
      };
      try {
        return mcpResult(await tool.execute((call.params.arguments ?? {}) as JsonObject, context));
      } catch (error) {
        return {
          content: [{type: "text" as const, text: error instanceof Error ? error.message : String(error)}],
          isError: true,
        };
      }
    });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      allowedHosts: [`127.0.0.1:${this.#port}`],
      enableDnsRebindingProtection: true,
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response);
    } catch (error) {
      if (!response.headersSent)
        jsonError(response, 500, -32603, error instanceof Error ? error.message : "Internal server error");
    } finally {
      await transport.close().catch(() => {});
      await server.close().catch(() => {});
    }
  }

  #authorizedScope(request: IncomingMessage): string | undefined {
    const remote = request.socket.remoteAddress;
    if (remote !== "127.0.0.1" && remote !== "::1" && remote !== "::ffff:127.0.0.1") return undefined;
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) return undefined;
    return this.#tokens.get(authorization.slice("Bearer ".length));
  }
}

function mcpResult(result: AgentToolResult) {
  const content = typeof result.content === "string"
    ? [{type: "text" as const, text: result.content}]
    : result.content.map((item) => item.type === "text"
      ? {type: "text" as const, text: item.text}
      : {type: "image" as const, data: item.data, mimeType: item.mimeType});
  return {content, ...(result.isError ? {isError: true} : {})};
}

function jsonError(
  response: ServerResponse,
  status: number,
  code: number,
  message: string,
): void {
  response.writeHead(status, {"Content-Type": "application/json"});
  response.end(JSON.stringify({jsonrpc: "2.0", error: {code, message}, id: null}));
}
