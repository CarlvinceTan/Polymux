import type {McpRegistryEntryDto} from "@midas/protocol";

const REGISTRY_URL = "https://registry.modelcontextprotocol.io/v0/servers";

/** Searches the official MCP Registry and returns the latest remote-capable
 * servers. Package-only entries are omitted because Midas cannot install them
 * without first resolving their runtime and environment requirements. */
export async function searchMcpRegistry(query: string): Promise<McpRegistryEntryDto[]> {
  const url = new URL(REGISTRY_URL);
  const search = query.trim();
  if (search) url.searchParams.set("search", search);
  url.searchParams.set("version", "latest");
  url.searchParams.set("limit", "50");
  const response = await fetch(url, {headers: {Accept: "application/json"}});
  if (!response.ok) throw new Error(`MCP Registry returned ${response.status}`);
  return parseMcpRegistry(await response.json());
}

export function parseMcpRegistry(value: unknown): McpRegistryEntryDto[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as {servers?: unknown}).servers)) return [];
  const seen = new Set<string>();
  const entries: McpRegistryEntryDto[] = [];
  for (const row of (value as {servers: unknown[]}).servers) {
    if (!row || typeof row !== "object") continue;
    const server = (row as {server?: unknown}).server;
    if (!server || typeof server !== "object") continue;
    const record = server as Record<string, unknown>;
    if (typeof record.name !== "string" || seen.has(record.name)) continue;
    const remotes = Array.isArray(record.remotes) ? record.remotes : [];
    const remote = remotes.find((item) => item && typeof item === "object"
      && (item as Record<string, unknown>).type === "streamable-http"
      && typeof (item as Record<string, unknown>).url === "string") as Record<string, unknown> | undefined;
    if (!remote) continue;
    const headers = Array.isArray(remote.headers) ? remote.headers : [];
    const requiredHeaders = headers
      .filter((item) => item && typeof item === "object" && (item as Record<string, unknown>).isRequired !== false)
      .map((item) => (item as Record<string, unknown>).name)
      .filter((name): name is string => typeof name === "string");
    const repository = record.repository && typeof record.repository === "object"
      ? (record.repository as Record<string, unknown>).url
      : undefined;
    seen.add(record.name);
    entries.push({
      id: record.name,
      name: typeof record.title === "string" ? record.title : record.name,
      description: typeof record.description === "string" ? record.description : "No description provided.",
      url: remote.url as string,
      repository: typeof repository === "string" ? repository : undefined,
      requiredHeaders,
    });
  }
  return entries;
}
