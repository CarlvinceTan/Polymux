import {randomUUID} from "node:crypto";
import {required, optionalStringArray} from "../backend/requests.js";
import {externalAgentId} from "./configuration.js";
import type {AgentRuntimeConfig} from "./types.js";

export function agentRuntimeRequest(value: unknown): AgentRuntimeConfig {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Agent runtime must be an object");
  const input = value as Record<string, unknown>;
  if (input.kind === "polymux") return {kind: "polymux"};
  if (input.kind !== "acp") throw new Error("Unknown agent runtime");
  const command = required(input.command, "ACP command").trim();
  if (!command) throw new Error("ACP command cannot be empty");
  const name = typeof input.name === "string" && input.name.trim()
    ? input.name.trim()
    : "ACP Agent";
  const args = optionalStringArray(input.args, "ACP arguments");
  const cwd = input.cwd == null ? undefined : required(input.cwd, "ACP working directory").trim() || undefined;
  const partial = {
    kind: "acp" as const,
    name,
    command,
    args,
    ...(cwd ? {cwd} : {}),
    config: agentRuntimeConfigValues(input.config),
    registryEnvironment: agentRegistryEnvironment(input.registryEnvironment),
  };
  const requestedAgentId = typeof input.agentId === "string" ? input.agentId.trim() : "";
  const agentId = requestedAgentId && /^[a-z0-9][a-z0-9-]*$/i.test(requestedAgentId)
    ? requestedAgentId.toLowerCase()
    : externalAgentId(partial);
  const requestedConfigId = typeof input.configId === "string" ? input.configId.trim() : "";
  const configId = requestedConfigId && /^[a-z0-9][a-z0-9-]*$/i.test(requestedConfigId)
    ? requestedConfigId
    : randomUUID();
  return {...partial, agentId, configId};
}

export function agentRuntimeConfigValues(value: unknown): Record<string, string | boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string | boolean] =>
    typeof entry[1] === "string" || typeof entry[1] === "boolean",
  ));
}

export function agentRegistryEnvironment(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => {
    const [key, item] = entry;
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) &&
      typeof item === "string" &&
      item.length <= 4_096 &&
      !item.includes("\0") &&
      !isReservedRegistryEnvironmentKey(key);
  }));
}

function isReservedRegistryEnvironmentKey(key: string): boolean {
  return /(?:TOKEN|SECRET|PASSWORD|PASS|KEY|CREDENTIAL|AUTH|COOKIE)/i.test(key) ||
    /^(?:HOME|USERPROFILE|PATH|PATHEXT|NODE_OPTIONS|ELECTRON_RUN_AS_NODE)$/i.test(key) ||
    /^(?:XDG_|DYLD_|LD_|POLYMUX_|npm_|NPM_)/.test(key);
}

