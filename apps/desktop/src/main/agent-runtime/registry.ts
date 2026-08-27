import type {AcpRegistryEntryDto} from "@polymux/protocol";

const REGISTRY_URL = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

/** Reads the official ACP registry. Package distributions become runnable
 * presets; binary-only agents remain visible for a custom installed command. */
export async function listAcpRegistry(): Promise<AcpRegistryEntryDto[]> {
  const response = await fetch(REGISTRY_URL, {headers: {Accept: "application/json"}});
  if (!response.ok) throw new Error(`ACP Registry returned ${response.status}`);
  return parseAcpRegistry(await response.json());
}

export function parseAcpRegistry(value: unknown): AcpRegistryEntryDto[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as {agents?: unknown}).agents)) return [];
  const entries: AcpRegistryEntryDto[] = [];
  for (const item of (value as {agents: unknown[]}).agents) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.name !== "string") continue;
    const distribution = row.distribution && typeof row.distribution === "object"
      ? row.distribution as Record<string, unknown>
      : {};
    const launch = packageLaunch(distribution.npx, "npx", ["-y"])
      ?? packageLaunch(distribution.uvx, "uvx", []);
    entries.push({
      id: row.id,
      name: row.name,
      description: typeof row.description === "string" ? row.description : "",
      version: typeof row.version === "string" ? row.version : "",
      icon: typeof row.icon === "string" ? row.icon : "",
      command: launch?.command ?? "",
      args: launch?.args ?? [],
    });
  }
  return entries;
}

function packageLaunch(value: unknown, command: string, prefix: string[]): {command: string; args: string[]} | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.package !== "string" || !record.package.trim()) return undefined;
  const args = Array.isArray(record.args) ? record.args.filter((item): item is string => typeof item === "string") : [];
  return {command, args: [...prefix, record.package, ...args]};
}
