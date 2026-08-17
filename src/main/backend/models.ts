import type {ModelRef} from "@flareai/inference";
import type {CreateCustomProviderRequest, DiscoverModelsRequest, ModelRole, SetupLocalRuntimeRequest, UpdateCustomProviderRequest} from "@flareai/protocol";
import {json, required, validProviderLogo} from "./requests.js";

/** A provider the user added by hand: a base URL, a name, and the models
 * they listed for it. */
export interface CustomProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  logoDataUrl?: string;
  models: Array<{id: string; name: string}>;
}

/** Model roles, custom providers, and discovering what a provider offers. */
export function modelFromEnvironment(
  value = process.env.FLAREAI_MODEL,
): ModelRef | undefined {
  if (!value) return undefined;
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1)
    throw new Error("FLAREAI_MODEL must use provider/model format");
  return {
    provider: value.slice(0, separator),
    id: value.slice(separator + 1),
  };
}

/**
 * City-level position from the network. Chromium's own geolocation needs a
 * Google API key (or a CoreLocation grant the dev bundle rarely holds), so
 * the renderer falls back to this whenever the platform service fails; for
 * agent context — weather, local time, nearby places — city-level is enough.
 */

export const MODEL_ROLES: ModelRole[] = ["main", "task", "judge", "speech", "image", "video"];

export function modelRole(value: unknown): ModelRole {
  if (typeof value === "string" && (MODEL_ROLES as string[]).includes(value))
    return value as ModelRole;
  throw new Error(`Unknown model role: ${String(value)}`);
}

export function modelRolesPreference(value: unknown): Partial<Record<ModelRole, ModelRef>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const roles: Partial<Record<ModelRole, ModelRef>> = {};
  for (const role of MODEL_ROLES) {
    if (role === "main") continue;
    const ref = modelPreference(record[role]);
    if (ref) roles[role] = ref;
  }
  return roles;
}

export function modelPreference(value: unknown): ModelRef | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.provider !== "string" || typeof record.id !== "string")
    return undefined;
  return { provider: record.provider, id: record.id };
}

export function customProviderPreference(value: unknown): CustomProviderConfig[] {
  if (!Array.isArray(value)) return [];
  const configs: CustomProviderConfig[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.name !== "string" || typeof record.baseUrl !== "string" || !Array.isArray(record.models)) continue;
    const models = record.models.flatMap((model) => {
      if (!model || typeof model !== "object" || Array.isArray(model)) return [];
      const entry = model as Record<string, unknown>;
      return typeof entry.id === "string" && typeof entry.name === "string" ? [{id: entry.id, name: entry.name}] : [];
    });
    const logoDataUrl = validProviderLogo(record.logoDataUrl);
    if (models.length) configs.push({id: record.id, name: record.name, baseUrl: record.baseUrl, logoDataUrl, models});
  }
  return configs;
}

export function customProviderRequest(value: unknown): CreateCustomProviderRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Custom provider must be an object");
  const record = value as Record<string, unknown>;
  const name = required(record.name, "provider name");
  const rawUrl = required(record.baseUrl, "base URL");
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new Error("base URL must be a valid URL"); }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("base URL must use HTTP or HTTPS");
  if (!Array.isArray(record.models) || record.models.length === 0)
    throw new Error("at least one model is required");
  const seen = new Set<string>();
  const models = record.models.map((model) => {
    if (!model || typeof model !== "object" || Array.isArray(model))
      throw new Error("each model must be an object");
    const entry = model as Record<string, unknown>;
    const id = required(entry.id, "model id");
    if (seen.has(id)) throw new Error(`duplicate model id: ${id}`);
    seen.add(id);
    const modelName = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : undefined;
    return {id, name: modelName};
  });
  const apiKey = typeof record.apiKey === "string" && record.apiKey.trim() ? record.apiKey.trim() : undefined;
  const logoDataUrl = validProviderLogo(record.logoDataUrl);
  return {name, baseUrl: url.toString().replace(/\/$/, ""), logoDataUrl, apiKey, models};
}

export function setupLocalRuntimeRequest(value: unknown): SetupLocalRuntimeRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Runtime setup must be an object");
  const record = value as Record<string, unknown>;
  const id = required(record.id, "runtime id");
  const baseUrl = typeof record.baseUrl === "string" && record.baseUrl.trim()
    ? discoverModelsRequest({baseUrl: record.baseUrl}).baseUrl
    : undefined;
  return {id, baseUrl};
}

export function discoverModelsRequest(value: unknown): DiscoverModelsRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Discovery request must be an object");
  const record = value as Record<string, unknown>;
  const rawUrl = required(record.baseUrl, "base URL");
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new Error("base URL must be a valid URL"); }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("base URL must use HTTP or HTTPS");
  const apiKey = typeof record.apiKey === "string" && record.apiKey.trim() ? record.apiKey.trim() : undefined;
  return {baseUrl: url.toString().replace(/\/$/, ""), apiKey};
}

/** Read an OpenAI-compatible `/models` listing. Local runtimes (Ollama,
 * LM Studio, vLLM, llama.cpp) all serve it, so one request covers them and any
 * hosted gateway the user points at. Ollama's native `/api/tags` is the
 * fallback for the case where the base URL omits the `/v1` suffix. */

export async function discoverModels(
  request: DiscoverModelsRequest,
): Promise<Array<{id: string; name?: string}>> {
  const headers: Record<string, string> = {accept: "application/json"};
  if (request.apiKey) headers.authorization = `Bearer ${request.apiKey}`;
  const attempts = [`${request.baseUrl}/models`, `${request.baseUrl}/api/tags`];
  let lastError = "";
  for (const endpoint of attempts) {
    let response: Response;
    try {
      response = await fetch(endpoint, {headers, signal: AbortSignal.timeout(8_000)});
    } catch (cause) {
      lastError = cause instanceof Error ? cause.message : String(cause);
      continue;
    }
    if (!response.ok) {
      lastError = `${response.status} ${response.statusText}`.trim();
      continue;
    }
    let payload: unknown;
    try { payload = await response.json(); } catch { lastError = "response was not JSON"; continue; }
    const ids = modelIdsFromListing(payload);
    if (ids.length) return ids.map((id) => ({id}));
    lastError = "the endpoint listed no models";
  }
  throw new Error(`Could not read models from ${request.baseUrl}: ${lastError || "no response"}`);
}

export function modelIdsFromListing(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  // OpenAI: {data: [{id}]}. Ollama native: {models: [{name}]}.
  const entries = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.models) ? record.models : [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const item = entry as Record<string, unknown>;
    const id = typeof item.id === "string" && item.id.trim()
      ? item.id.trim()
      : typeof item.name === "string" && item.name.trim() ? item.name.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids.sort((left, right) => left.localeCompare(right));
}

export function updateCustomProviderRequest(value: unknown): UpdateCustomProviderRequest {
  const request = customProviderRequest(value);
  const record = value as Record<string, unknown>;
  return {id: required(record.id, "provider id"), ...request};
}
