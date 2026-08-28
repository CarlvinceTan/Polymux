import {existsSync, readdirSync, readFileSync} from "node:fs";
import {homedir} from "node:os";
import path from "node:path";
import type {AcpRegistryEntryDto} from "@polymux/protocol";

const REGISTRY_URL = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

/** Reads the official ACP registry. Package and platform binary distributions
 * both become runnable presets; only the separate Custom card needs a command
 * supplied by the user. */
export async function listAcpRegistry(): Promise<AcpRegistryEntryDto[]> {
  const response = await fetch(REGISTRY_URL, {headers: {Accept: "application/json"}});
  if (!response.ok) throw new Error(`ACP Registry returned ${response.status}`);
  return parseAcpRegistry(await response.json(), packageInstalled);
}

export function parseAcpRegistry(
  value: unknown,
  isInstalled: (command: string, packageSpec: string) => boolean = () => false,
  platform = registryPlatform(),
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
      ?? packageLaunch(distribution.uvx, "uvx", [])
      ?? binaryLaunch(distribution.binary, platform);
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

function binaryLaunch(value: unknown, platform: string): {command: string; args: string[]; packageSpec: string} | undefined {
  if (!value || typeof value !== "object" || !platform) return undefined;
  const candidate = (value as Record<string, unknown>)[platform];
  if (!candidate || typeof candidate !== "object") return undefined;
  const record = candidate as Record<string, unknown>;
  if (typeof record.cmd !== "string") return undefined;
  const command = standardBinaryCommand(record.cmd);
  if (!command) return undefined;
  const args = Array.isArray(record.args) ? record.args.filter((item): item is string => typeof item === "string") : [];
  return {command, args, packageSpec: ""};
}

/** Archive commands are relative paths such as `./bin/devin` or
 * `./pool-darwin-arm64`. An already installed CLI is addressed by its normal
 * PATH name instead of an archive-internal location. */
function standardBinaryCommand(value: string): string {
  const leaf = value.trim().replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? "";
  return leaf
    .replace(/\.(?:exe|cmd|bat|par)$/i, "")
    .replace(/-(?:darwin|linux|windows)-(?:aarch64|arm64|amd64|x64|x86_64)$/i, "");
}

function registryPlatform(): string {
  const operatingSystem = process.platform === "darwin"
    ? "darwin"
    : process.platform === "win32"
      ? "windows"
      : process.platform === "linux"
        ? "linux"
        : "";
  const architecture = process.arch === "arm64"
    ? "aarch64"
    : process.arch === "x64"
      ? "x86_64"
      : "";
  return operatingSystem && architecture ? `${operatingSystem}-${architecture}` : "";
}

function packageInstalled(command: string, packageSpec: string): boolean {
  if (command === "uvx") return executableExists(pythonPackageCommand(packageSpec));
  const identity = packageIdentity(packageSpec);
  if (!identity) return executableExists(command);
  if (command !== "npx") return false;
  const roots = new Set([
    path.join(process.cwd(), "node_modules"),
    path.join(path.dirname(path.dirname(process.execPath)), "lib", "node_modules"),
  ]);
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    roots.add(path.resolve(directory, "..", "lib", "node_modules"));
  }
  const cache = process.env.npm_config_cache?.trim() || path.join(homedir(), ".npm");
  const npxCache = path.join(cache, "_npx");
  try {
    for (const entry of readdirSync(npxCache)) roots.add(path.join(npxCache, entry, "node_modules"));
  } catch {
    // A machine that has never used npx simply has no cached packages yet.
  }
  return [...roots].some((root) => packageMatches(root, identity));
}

function pythonPackageCommand(spec: string): string {
  return spec.trim().split(/==|@/u, 1)[0] ?? "";
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
