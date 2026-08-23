import type {InferenceEvent, InferenceModel, InferenceRequest, InferenceService, ModelRef} from "@polymux/inference";

export interface InferenceKeyPool {
  candidates(providerId: string): Promise<Array<{id: string; key: string}>>;
  markSuccess(providerId: string, keyId: string): Promise<void>;
  markFailure(providerId: string, keyId: string, reason: "rate_limit" | "auth"): Promise<void>;
}

/** Rotates credentials only when a provider rejects an attempt before any
 * response content is emitted, avoiding duplicate partial replies. */
export class RotatingInference implements InferenceService {
  readonly #base: InferenceService;
  readonly #keys: InferenceKeyPool;

  constructor(base: InferenceService, keys: InferenceKeyPool) {
    this.#base = base;
    this.#keys = keys;
  }

  listModels(provider?: string): InferenceModel[] { return this.#base.listModels(provider); }
  getModel(ref: ModelRef): InferenceModel | null { return this.#base.getModel(ref); }
  listAvailableModels(provider?: string): Promise<InferenceModel[]> { return this.#base.listAvailableModels(provider); }

  async *stream(request: InferenceRequest): AsyncIterable<InferenceEvent> {
    const candidates = await this.#keys.candidates(request.model.provider);
    if (!candidates.length) {
      yield* this.#base.stream(request);
      return;
    }
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index]!;
      const buffered: InferenceEvent[] = [];
      let committed = false;
      for await (const event of this.#base.stream({...request, apiKey: candidate.key})) {
        if (!committed && event.type === "start") {
          buffered.push(event);
          continue;
        }
        if (!committed && event.type === "error" && (event.error.code === "rate_limit" || event.error.code === "auth")) {
          await this.#keys.markFailure(request.model.provider, candidate.id, event.error.code);
          if (index < candidates.length - 1) break;
          for (const pending of buffered) yield pending;
          yield event.error.code === "auth"
            ? {
                ...event,
                error: {
                  ...event.error,
                  message: `The selected provider rejected its saved API key (${event.error.message}). Remove it or add a valid key in Settings → Provider.`,
                },
              }
            : event;
          return;
        }
        if (!committed) {
          committed = true;
          await this.#keys.markSuccess(request.model.provider, candidate.id);
          for (const pending of buffered) yield pending;
        }
        yield event;
      }
      if (committed) return;
    }
  }
}
