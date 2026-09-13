import type { ModelRef } from "@polymux/inference";

/** Keep the last selected model when it is still available. The model catalog
 * order is an implementation detail and must not silently change what runs
 * after a provider is configured or refreshed. */
export function preferredModel<T extends ModelRef>(
  models: readonly T[],
  lastUsed: ModelRef | undefined,
): T | undefined {
  if (lastUsed) {
    const remembered = models.find(
      (model) =>
        model.provider === lastUsed.provider && model.id === lastUsed.id,
    );
    if (remembered) return remembered;
  }
  return models[0];
}
