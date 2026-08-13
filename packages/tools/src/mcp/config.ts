import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";

interface McpBaseConfig {
  id: string;
  name?: string;
  enabled?: boolean;
  metadata?: Record<string, unknown>;
}
export interface McpStdioConfig extends McpBaseConfig {
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}
export interface McpHttpConfig extends McpBaseConfig {
  transport: "streamable-http";
  url: string;
  headers?: Record<string, string>;
  authProvider?: OAuthClientProvider;
  sessionId?: string;
}
export type McpServerConfig = McpStdioConfig | McpHttpConfig;

export function normalizeMcpConfig(
  id: string,
  value: Record<string, unknown>,
): McpServerConfig {
  const common = {
    id,
    name: typeof value.name === "string" ? value.name : id,
    enabled: value.enabled !== false,
    metadata: value,
  };
  if (typeof value.url === "string")
    return {
      ...common,
      transport: "streamable-http",
      url: value.url,
      headers: stringRecord(value.headers),
    };
  if (typeof value.command !== "string")
    throw new Error(`MCP server ${id} requires command or url`);
  return {
    ...common,
    transport: "stdio",
    command: value.command,
    args: stringArray(value.args),
    env: stringRecord(value.env),
    cwd: typeof value.cwd === "string" ? value.cwd : undefined,
  };
}

export function importMcpServers(value: unknown): McpServerConfig[] {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("MCP configuration must be an object");
  const root = value as Record<string, unknown>;
  const servers = (root.mcpServers ?? root.mcp_servers ?? root.servers ?? root) as unknown;
  if (!servers || typeof servers !== "object" || Array.isArray(servers))
    throw new Error("mcpServers must be an object");
  return Object.entries(servers as Record<string, unknown>).map(
    ([id, entry]) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry))
        throw new Error(`MCP server ${id} must be an object`);
      return normalizeMcpConfig(id, entry as Record<string, unknown>);
    },
  );
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}
function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.every(([, item]) => typeof item === "string")
    ? (Object.fromEntries(entries) as Record<string, string>)
    : undefined;
}
