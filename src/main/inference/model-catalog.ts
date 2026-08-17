import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ModelMetadataDto } from "@flareai/protocol";

/**
 * Model facts that pi-ai does not carry — descriptions, dates, capability
 * flags and the lab that built the model — sourced from models.dev, the open
 * catalogue behind OpenCode.
 *
 * pi-ai stays the authority on what can actually be called: this only
 * decorates models that already exist. Anything the catalogue does not know
 * about simply has no entry, so the UI degrades to what it showed before.
 */

const API_URL = "https://models.dev/api.json";
const MODELS_URL = "https://models.dev/models.json";
/** Model metadata changes on the order of days, and a stale entry is a wrong
 * release date rather than a broken call, so a long refresh is right. */
const TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20_000;

interface CatalogModel {
  id?: string;
  name?: string;
  description?: string;
  family?: string;
  knowledge?: string;
  release_date?: string;
  last_updated?: string;
  open_weights?: boolean;
  reasoning?: boolean;
  tool_call?: boolean;
  structured_output?: boolean;
  temperature?: boolean;
  attachment?: boolean;
  limit?: { context?: number; output?: number };
}

interface CatalogProvider {
  models?: Record<string, CatalogModel>;
}

interface CachedCatalog {
  fetchedAt: number;
  providers: Record<string, CatalogProvider>;
  /** Keyed `<lab>/<model-id>` — the only place lab attribution is published. */
  labModels: Record<string, CatalogModel>;
}

export interface ModelCatalogOptions {
  /** Where the on-disk copy lives, normally Electron's userData directory. */
  cacheDir: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export class ModelCatalog {
  readonly #cacheFile: string;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  #cache: CachedCatalog | null = null;
  #inFlight: Promise<CachedCatalog | null> | null = null;

  constructor(options: ModelCatalogOptions) {
    this.#cacheFile = path.join(options.cacheDir, "models-dev-catalog.json");
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#now = options.now ?? Date.now;
  }

  /**
   * Metadata for exactly the models passed in, keyed `<provider>:<id>`, so the
   * renderer receives only what it can display rather than the catalogue's
   * several megabytes. Returns an empty map when the catalogue is unreachable
   * and nothing has been cached — never throws, because decoration failing
   * must not take the model list down with it.
   */
  async metadataFor(
    models: ReadonlyArray<{ provider: string; id: string }>,
  ): Promise<Record<string, ModelMetadataDto>> {
    const catalog = await this.#load();
    if (!catalog) return {};

    const byBareId = new Map<string, CatalogModel>();
    for (const provider of Object.values(catalog.providers)) {
      for (const [id, model] of Object.entries(provider.models ?? {})) {
        if (!byBareId.has(id)) byBareId.set(id, model);
      }
    }
    const labById = new Map<string, string>();
    for (const key of Object.keys(catalog.labModels)) {
      const slash = key.indexOf("/");
      if (slash < 1) continue;
      const bare = key.slice(slash + 1);
      if (!labById.has(bare)) labById.set(bare, key.slice(0, slash));
    }

    const result: Record<string, ModelMetadataDto> = {};
    for (const { provider, id } of models) {
      // An exact provider match is the trustworthy one. Gateways and regional
      // variants ("qwen-token-plan-cn", "openai-codex") are absent from the
      // catalogue, so their models fall back to the same id under whichever
      // provider does publish it — the model is the same artefact either way.
      const direct = catalog.providers[provider]?.models?.[id];
      const entry = direct ?? byBareId.get(id) ?? byBareId.get(stripNamespace(id));
      const lab = labById.get(id) ?? labById.get(stripNamespace(id));
      if (!entry && !lab) continue;
      result[`${provider}:${id}`] = {
        description: entry?.description,
        family: entry?.family,
        lab,
        knowledgeCutoff: entry?.knowledge,
        releaseDate: entry?.release_date,
        lastUpdated: entry?.last_updated,
        openWeights: entry?.open_weights,
        toolCall: entry?.tool_call,
        structuredOutput: entry?.structured_output,
        temperature: entry?.temperature,
        attachment: entry?.attachment,
        contextLimit: entry?.limit?.context,
        outputLimit: entry?.limit?.output,
      };
    }
    return result;
  }

  /** Serves the cached copy while fresh, refreshes it when stale, and keeps
   * serving a stale copy if the network is down. */
  async #load(): Promise<CachedCatalog | null> {
    if (this.#cache && this.#now() - this.#cache.fetchedAt < TTL_MS) return this.#cache;
    if (!this.#cache) this.#cache = await this.#readDisk();
    if (this.#cache && this.#now() - this.#cache.fetchedAt < TTL_MS) return this.#cache;

    // One refresh at a time: several tabs opening Options at once must not
    // each pull the whole catalogue.
    this.#inFlight ??= this.#refresh().finally(() => { this.#inFlight = null; });
    const fresh = await this.#inFlight;
    return fresh ?? this.#cache;
  }

  async #refresh(): Promise<CachedCatalog | null> {
    try {
      const [providers, labModels] = await Promise.all([
        this.#getJson<Record<string, CatalogProvider>>(API_URL),
        this.#getJson<Record<string, CatalogModel>>(MODELS_URL),
      ]);
      const next: CachedCatalog = { fetchedAt: this.#now(), providers, labModels };
      this.#cache = next;
      await this.#writeDisk(next);
      return next;
    } catch {
      return null;
    }
  }

  async #getJson<T>(url: string): Promise<T> {
    const response = await this.#fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`${url} responded ${response.status}`);
    return (await response.json()) as T;
  }

  async #readDisk(): Promise<CachedCatalog | null> {
    try {
      const raw = await readFile(this.#cacheFile, "utf8");
      const parsed = JSON.parse(raw) as CachedCatalog;
      if (!parsed?.providers || typeof parsed.fetchedAt !== "number") return null;
      return { ...parsed, labModels: parsed.labModels ?? {} };
    } catch {
      return null;
    }
  }

  async #writeDisk(catalog: CachedCatalog): Promise<void> {
    try {
      await mkdir(path.dirname(this.#cacheFile), { recursive: true });
      await writeFile(this.#cacheFile, JSON.stringify(catalog), "utf8");
    } catch {
      // A cache that cannot be written is a slower next launch, not a failure.
    }
  }
}

/** OpenRouter-style ids arrive namespaced (`anthropic/claude-…`); the
 * catalogue keys the same model bare under its own provider. */
function stripNamespace(id: string): string {
  const slash = id.lastIndexOf("/");
  return slash === -1 ? id : id.slice(slash + 1);
}
