import type { ModelRef } from "@polymux/inference";
import {
  REASONING_EFFORTS,
  isReasoningModelId,
  isMultimodalModelId,
} from "@polymux/protocol";
import type {
  CreateCustomProviderRequest,
  DiscoverModelsRequest,
  ModelRole,
  ReasoningEffort,
  SetupLocalRuntimeRequest,
  UpdateCustomProviderRequest,
} from "@polymux/protocol";
import { required, validProviderLogo } from "./requests.js";

export { REASONING_EFFORTS, isReasoningModelId, isMultimodalModelId };

/** Returns the value when it names a supported effort, otherwise the fallback.
 * The fallback may be null when the caller needs to know whether a raw value
 * was accepted at all (update validation). */
export function reasoningEffort(
  value: unknown,
  fallback: ReasoningEffort | null,
): ReasoningEffort | null {
  return typeof value === "string" &&
    REASONING_EFFORTS.includes(value as ReasoningEffort)
    ? (value as ReasoningEffort)
    : fallback;
}

/** A role's model, plus how hard that model is asked to think in the role.
 * `reasoning` is absent for a model that takes no effort level. */
export interface RoleSelection extends ModelRef {
  reasoning?: ReasoningEffort;
}

/** A provider the user added by hand: a base URL, a name, and the models
 * they listed for it. */
export interface CustomProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  logoDataUrl?: string;
  models: Array<{
    id: string;
    name: string;
    reasoning?: boolean;
    input?: Array<"text" | "image">;
    contextWindow?: number;
    maxTokens?: number;
  }>;
}

/** Model roles, custom providers, and discovering what a provider offers. */
export function modelFromEnvironment(
  value = process.env.POLYMUX_MODEL,
): ModelRef | undefined {
  if (!value) return undefined;
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1)
    throw new Error("POLYMUX_MODEL must use provider/model format");
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

export const MODEL_ROLES: ModelRole[] = [
  "main",
  "subagent",
  "judge",
  "compaction",
  "speech",
  "image",
  "video",
];

export function modelRole(value: unknown): ModelRole {
  if (typeof value === "string" && (MODEL_ROLES as string[]).includes(value))
    return value as ModelRole;
  throw new Error(`Unknown model role: ${String(value)}`);
}

export function modelRolesPreference(
  value: unknown,
): Partial<Record<ModelRole, RoleSelection>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const roles: Partial<Record<ModelRole, RoleSelection>> = {};
  for (const role of MODEL_ROLES) {
    const ref = modelPreference(record[role]);
    if (!ref) continue;
    const stored = record[role] as Record<string, unknown>;
    const reasoning = reasoningEffort(stored.reasoning, null);
    roles[role] = reasoning ? { ...ref, reasoning } : ref;
  }
  return roles;
}

export function modelPreference(value: unknown): ModelRef | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.provider !== "string" || typeof record.id !== "string")
    return undefined;
  return { provider: record.provider, id: record.id };
}

export function customProviderPreference(
  value: unknown,
): CustomProviderConfig[] {
  if (!Array.isArray(value)) return [];
  const configs: CustomProviderConfig[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (
      typeof record.id !== "string" ||
      typeof record.name !== "string" ||
      typeof record.baseUrl !== "string" ||
      !Array.isArray(record.models)
    )
      continue;
    const models = record.models.flatMap((model) => {
      if (!model || typeof model !== "object" || Array.isArray(model))
        return [];
      const entry = model as Record<string, unknown>;
      if (typeof entry.id !== "string" || typeof entry.name !== "string")
        return [];
      const reasoning =
        typeof entry.reasoning === "boolean" ? entry.reasoning : undefined;
      const input = Array.isArray(entry.input)
        ? (entry.input as string[]).filter((t) => t === "text" || t === "image")
        : undefined;
      return [
        {
          id: entry.id,
          name: entry.name,
          ...(reasoning !== undefined ? { reasoning } : {}),
          ...(input?.length ? { input } : {}),
        },
      ];
    });
    const logoDataUrl = validProviderLogo(record.logoDataUrl);
    if (models.length)
      configs.push({
        id: record.id,
        name: record.name,
        baseUrl: record.baseUrl,
        logoDataUrl,
        models,
      });
  }
  return configs;
}

export function customProviderRequest(
  value: unknown,
): CreateCustomProviderRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Custom provider must be an object");
  const record = value as Record<string, unknown>;
  const name = required(record.name, "provider name");
  const rawUrl = required(record.baseUrl, "base URL");
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("base URL must be a valid URL");
  }
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
    const modelName =
      typeof entry.name === "string" && entry.name.trim()
        ? entry.name.trim()
        : undefined;
    const reasoning =
      typeof entry.reasoning === "boolean" ? entry.reasoning : undefined;
    return {
      id,
      name: modelName,
      ...(reasoning !== undefined ? { reasoning } : {}),
    };
  });
  const apiKey =
    typeof record.apiKey === "string" && record.apiKey.trim()
      ? record.apiKey.trim()
      : undefined;
  const logoDataUrl = validProviderLogo(record.logoDataUrl);
  return {
    name,
    baseUrl: url.toString().replace(/\/$/, ""),
    logoDataUrl,
    apiKey,
    models,
  };
}

export function setupLocalRuntimeRequest(
  value: unknown,
): SetupLocalRuntimeRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Runtime setup must be an object");
  const record = value as Record<string, unknown>;
  const id = required(record.id, "runtime id");
  const baseUrl =
    typeof record.baseUrl === "string" && record.baseUrl.trim()
      ? discoverModelsRequest({ baseUrl: record.baseUrl }).baseUrl
      : undefined;
  return { id, baseUrl };
}

export function discoverModelsRequest(value: unknown): DiscoverModelsRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Discovery request must be an object");
  const record = value as Record<string, unknown>;
  const rawUrl = required(record.baseUrl, "base URL");
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("base URL must be a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("base URL must use HTTP or HTTPS");
  const apiKey =
    typeof record.apiKey === "string" && record.apiKey.trim()
      ? record.apiKey.trim()
      : undefined;
  return { baseUrl: url.toString().replace(/\/$/, ""), apiKey };
}

/** Read an OpenAI-compatible `/models` listing. Local runtimes (Ollama,
 * LM Studio, vLLM, llama.cpp) all serve it, so one request covers them and any
 * hosted gateway the user points at. Ollama's native `/api/tags` is the
 * fallback for the case where the base URL omits the `/v1` suffix. */

export async function discoverModels(
  request: DiscoverModelsRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (request.apiKey) headers.Authorization = `Bearer ${request.apiKey}`;

  // Try /models first (OpenAI standard). Strip any trailing slash so we don't
  // end up requesting `//models`.
  const baseUrl = request.baseUrl.replace(/\/+$/, "");
  let response = await fetchImpl(`${baseUrl}/models`, {
    headers,
    signal: AbortSignal.timeout(10_000),
  }).catch((): null => null);

  // If /models failed or 404'd, try Ollama's native /api/tags endpoint. This
  // catches users who point at http://localhost:11434 rather than /v1.
  if (!response?.ok) {
    const ollamaResponse = await fetchImpl(`${baseUrl}/api/tags`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    }).catch((): null => null);
    if (ollamaResponse?.ok) response = ollamaResponse;
  }

  if (!response)
    throw new Error(
      `Could not connect to ${request.baseUrl}. Check that the server is running.`,
    );
  if (!response.ok)
    throw new Error(
      `Server returned HTTP ${response.status} from ${response.url}`,
    );

  const payload = (await response.json()) as unknown;
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new Error("Server returned an invalid model listing");

  const record = payload as Record<string, unknown>;
  // OpenAI: {data: [{id}]}. Ollama native: {models: [{name}]}.
  const entries = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.models)
      ? record.models
      : [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const item = entry as Record<string, unknown>;
    const id =
      typeof item.id === "string" && item.id.trim()
        ? item.id.trim()
        : typeof item.name === "string" && item.name.trim()
          ? item.name.trim()
          : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids.sort((left, right) => left.localeCompare(right));
}

export function updateCustomProviderRequest(
  value: unknown,
): UpdateCustomProviderRequest {
  const request = customProviderRequest(value);
  const record = value as Record<string, unknown>;
  return { id: required(record.id, "provider id"), ...request };
}
