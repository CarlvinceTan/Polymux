import type {
  InferenceEvent,
  InferenceModel,
  InferenceRequest,
  ModelRef,
} from "./types.js";

export interface InferenceService {
  listModels(provider?: string): InferenceModel[];
  getModel(ref: ModelRef): InferenceModel | null;
  listAvailableModels(provider?: string): Promise<InferenceModel[]>;
  stream(request: InferenceRequest): AsyncIterable<InferenceEvent>;
}
