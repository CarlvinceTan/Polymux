import type {InferenceModel, ModelRef} from "@polymux/inference";
import type {ModelRole} from "@polymux/protocol";

/**
 * What a model is for, inferred from its id and name. Only well-known
 * generation-model markers classify a model away from `text`: a wrong `text`
 * merely leaves a role following the main model, while a text model misread
 * as `speech` would silently switch speech mode on, so unknown ids always
 * stay `text`.
 */
export type ModelPurpose = "text" | "speech" | "image" | "video";

const SPEECH_MARKERS = [/(^|[-_./ ])tts([-_./ ]|$)/, /audio-speech/, /text-to-speech/];
/** Transcription models mention audio too; they cannot speak, so they stay text. */
const TRANSCRIPTION_MARKERS = [/whisper/, /transcribe/, /parakeet/, /scribe/];
const IMAGE_MARKERS = [
  /dall-?e/, /gpt-image/, /imagen/, /(^|[-_./ ])flux([-_./ .\d]|$)/, /stable-diffusion/,
  /(^|[-_./ ])sdxl/, /recraft/, /ideogram/, /seedream/, /(^|[-_./ ])image([-_./ ]|$)/,
];
const VIDEO_MARKERS = [
  /(^|[-_./ ])sora([-_./ ]|$)/, /(^|[-_./ ])veo([-_./ .\d]|$)/, /kling/, /runway/,
  /seedance/, /hunyuan-video/, /(^|[-_./ ])video([-_./ ]|$)/,
];

export function modelPurpose(model: Pick<InferenceModel, "id" | "name">): ModelPurpose {
  const key = `${model.id} ${model.name}`.toLocaleLowerCase();
  if (TRANSCRIPTION_MARKERS.some((marker) => marker.test(key))) return "text";
  if (SPEECH_MARKERS.some((marker) => marker.test(key))) return "speech";
  if (VIDEO_MARKERS.some((marker) => marker.test(key))) return "video";
  if (IMAGE_MARKERS.some((marker) => marker.test(key))) return "image";
  return "text";
}

/** Roles the picker fills. `main` stays the user's own choice. */
export type AutoRole = Exclude<ModelRole, "main">;

/** Cost per token pair used to order models; output dominates real spend. */
function blendedCost(model: InferenceModel): number | undefined {
  if (!model.cost) return undefined;
  return model.cost.input * 0.3 + model.cost.output * 0.7;
}

function byPreference(main: ModelRef | undefined) {
  return (a: InferenceModel, b: InferenceModel): number => {
    if (main && a.provider !== b.provider) {
      if (a.provider === main.provider) return -1;
      if (b.provider === main.provider) return 1;
    }
    const costA = blendedCost(a) ?? 0;
    const costB = blendedCost(b) ?? 0;
    if (costA !== costB) return costB - costA;
    return b.id.localeCompare(a.id);
  };
}

/**
 * Automatic assignments for every role without a stored override, used while
 * advanced mode hides the roles UI. The picks are deterministic and computed
 * on demand, never persisted: they follow the available models and vanish the
 * moment advanced mode hands control back to the user.
 *
 * Generation roles take the best classified candidate — main's provider
 * first, then price as the capability proxy. Subagent and compaction take
 * the strongest text model priced clearly below the main one from the same
 * provider, when there is one; the judge follows the main model, whose
 * judgement quality is the point.
 */
export function autoRolePicks(
  models: InferenceModel[],
  main: ModelRef | undefined,
): Partial<Record<AutoRole, ModelRef>> {
  const picks: Partial<Record<AutoRole, ModelRef>> = {};
  const byPurpose = new Map<ModelPurpose, InferenceModel[]>();
  for (const model of models) {
    const purpose = modelPurpose(model);
    byPurpose.set(purpose, [...(byPurpose.get(purpose) ?? []), model]);
  }
  const prefer = byPreference(main);
  for (const role of ["speech", "image", "video"] as const) {
    const best = (byPurpose.get(role) ?? []).sort(prefer)[0];
    if (best) picks[role] = {provider: best.provider, id: best.id};
  }
  const efficient = efficientTextPick(byPurpose.get("text") ?? [], main);
  if (efficient) {
    picks.subagent = efficient;
    picks.compaction = efficient;
  }
  return picks;
}

/** The most capable text model clearly cheaper than main, same provider only:
 * cross-provider price comparisons say nothing about relative quality. The
 * 10% floor keeps a token-priced micro model from winning the slot. */
function efficientTextPick(
  models: InferenceModel[],
  main: ModelRef | undefined,
): ModelRef | undefined {
  if (!main) return undefined;
  const mainModel = models.find((model) => model.provider === main.provider && model.id === main.id);
  const mainCost = mainModel ? blendedCost(mainModel) : undefined;
  if (!mainCost) return undefined;
  const best = models
    .filter((model) => {
      if (model.provider !== main.provider || model.id === main.id) return false;
      const cost = blendedCost(model);
      return cost !== undefined && cost < mainCost && cost >= mainCost * 0.1;
    })
    .sort((a, b) => (blendedCost(b) ?? 0) - (blendedCost(a) ?? 0))[0];
  return best ? {provider: best.provider, id: best.id} : undefined;
}
