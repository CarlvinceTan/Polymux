import {existsSync, readdirSync, readFileSync} from "node:fs";
import {homedir} from "node:os";
import path from "node:path";
import type {AcpRegistryEntryDto} from "@polymux/protocol";

const REGISTRY_URL = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

/** Reads the official ACP registry. Package distributions become runnable
 * presets; binary-only agents remain visible for a custom installed command. */
export async function listAcpRegistry(): Promise<AcpRegistryEntryDto[]> {
  const response = await fetch(REGISTRY_URL, {headers: {Accept: "application/json"}});
  if (!response.ok) throw new Error(`ACP Registry returned ${response.status}`);
  return parseAcpRegistry(await response.json(), packageInstalled);
}

export function parseAcpRegistry(
  value: unknown,
  isInstalled: (command: string, packageSpec: string) => boolean = () => false,
): AcpRegistryEntryDto[] {
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
      installed: launch ? isInstalled(launch.command, launch.packageSpec) : false,
      command: launch?.command ?? "",
      args: launch?.args ?? [],
    });
  }
  return entries;
}

function packageLaunch(value: unknown, command: string, prefix: string[]): {command: string; args: string[]; packageSpec: string} | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.package !== "string" || !record.package.trim()) return undefined;
  const args = Array.isArray(record.args) ? record.args.filter((item): item is string => typeof item === "string") : [];
  return {command, args: [...prefix, record.package, ...args], packageSpec: record.package};
}

function packageInstalled(command: string, packageSpec: string): boolean {
  const identity = packageIdentity(packageSpec);
  if (!identity) return false;
  if (command === "uvx") return executableExists(identity.name.split("/").at(-1) ?? identity.name);
  if (command !== "npx") return false;
  const roots = [
    path.join(process.cwd(), "node_modules"),
    path.join(path.dirname(path.dirname(process.execPath)), "lib", "node_modules"),
  ];
  const cache = process.env.npm_config_cache?.trim() || path.join(homedir(), ".npm");
  const npxCache = path.join(cache, "_npx");
  try {
    for (const entry of readdirSync(npxCache)) roots.push(path.join(npxCache, entry, "node_modules"));
  } catch {
    // A machine that has never used npx simply has no cached packages yet.
  }
  return roots.some((root) => packageMatches(root, identity));
}

function packageIdentity(spec: string): {name: string; version: string} | undefined {
  const trimmed = spec.trim();
  if (!trimmed) return undefined;
  const separator = trimmed.lastIndexOf("@");
  if (trimmed.startsWith("@")) {
    if (separator <= 0) return {name: trimmed, version: ""};
    return {name: trimmed.slice(0, separator), version: trimmed.slice(separator + 1)};
  }
  if (separator < 0) return {name: trimmed, version: ""};
  return {name: trimmed.slice(0, separator), version: trimmed.slice(separator + 1)};
}

function packageMatches(root: string, identity: {name: string; version: string}): boolean {
  const manifest = path.join(root, ...identity.name.split("/"), "package.json");
  if (!existsSync(manifest)) return false;
  try {
    const value = JSON.parse(readFileSync(manifest, "utf8")) as {name?: unknown; version?: unknown};
    return value.name === identity.name
      && (!identity.version || identity.version === "latest" || value.version === identity.version);
  } catch {
    return false;
  }
}

function executableExists(name: string): boolean {
  return (process.env.PATH ?? "").split(path.delimiter).some((directory) =>
    directory.length > 0 && existsSync(path.join(directory, name)),
  );
}
