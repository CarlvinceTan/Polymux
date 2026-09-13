import { readFileSync } from "node:fs";
import {
  createProvider,
  type CredentialStore,
  type Model,
  type Api,
} from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";

/** Declarative custom providers; no extension evaluation or API-key shell commands. */
export function hostModels(credentials: CredentialStore, file: string) {
  const catalog = builtinModels({ credentials });
  let source: string;
  try {
    source = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return catalog;
    throw error;
  }
  const value = JSON.parse(source);
  if (
    !value.providers ||
    typeof value.providers !== "object" ||
    Array.isArray(value.providers)
  )
    throw new Error("models.json must contain a providers object.");
  for (const [id, raw] of Object.entries(value.providers)) {
    const entry = raw as Record<string, any>;
    if (
      !entry ||
      typeof entry.baseUrl !== "string" ||
      !Array.isArray(entry.models)
    )
      throw new Error(`Invalid custom provider ${id}.`);
    const endpoint = new URL(entry.baseUrl);
    if (
      !["https:", "http:"].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password
    )
      throw new Error(`Invalid endpoint for ${id}.`);
    const apis = {
      "openai-completions": openAICompletionsApi,
      "openai-responses": openAIResponsesApi,
      "anthropic-messages": anthropicMessagesApi,
    };
    const api = entry.api as keyof typeof apis;
    if (!apis[api]) throw new Error(`Unsupported API for ${id}: ${entry.api}`);
    const models = entry.models.map((model: Record<string, any>) => {
      if (
        !model ||
        typeof model.id !== "string" ||
        !Number.isFinite(model.contextWindow) ||
        !Number.isFinite(model.maxTokens)
      )
        throw new Error(`Invalid model for ${id}.`);
      return {
        ...model,
        api,
        provider: id,
        baseUrl: entry.baseUrl,
        name: model.name || model.id,
        reasoning: Boolean(model.reasoning),
        input: model.input ?? ["text"],
        cost: model.cost ?? {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
      } as Model<Api>;
    });
    catalog.setProvider(
      createProvider({
        id,
        name: entry.name || id,
        baseUrl: entry.baseUrl,
        models,
        api: apis[api](),
        auth: {
          apiKey: {
            name: `${id} API key`,
            async resolve({ credential, ctx }) {
              const key =
                credential?.key ||
                (typeof entry.apiKeyEnv === "string"
                  ? await ctx.env(entry.apiKeyEnv)
                  : undefined) ||
                (entry.apiKey === "local" ? "local" : undefined);
              return key
                ? {
                    auth: { apiKey: key },
                    source: credential?.key
                      ? "stored credential"
                      : "custom provider",
                  }
                : undefined;
            },
          },
        },
      }),
    );
  }
  return catalog;
}
