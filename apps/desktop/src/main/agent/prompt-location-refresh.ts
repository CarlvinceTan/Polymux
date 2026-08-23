import {selectEnvironmentForPrompt} from "@polymux/agent";
import type {GeneralSettingsDto} from "@polymux/protocol";

type Location = NonNullable<GeneralSettingsDto["location"]>;

export interface PromptLocationRefreshOptions {
  current(): {enabled: boolean; location: Location | null};
  permission(): Promise<"granted" | "denied" | "prompt" | "unsupported">;
  position(signal: AbortSignal): Promise<Location>;
  persist(location: Location): void;
  now?: () => number;
  timeoutMs?: number;
}

export type PromptLocationRefreshResult =
  | "unrelated"
  | "disabled"
  | "fresh"
  | "permission-unavailable"
  | "refreshed"
  | "failed";

/** Refresh a location only when the current prompt genuinely needs it and the
 * renderer already has an OS grant. Merely asking never opens a permission
 * prompt; absent consent degrades to the agent's normal ask-for-an-area path. */
export async function refreshLocationForPrompt(
  prompt: string,
  options: PromptLocationRefreshOptions,
): Promise<PromptLocationRefreshResult> {
  const state = options.current();
  if (!state.enabled) return "disabled";
  const now = options.now?.() ?? Date.now();
  const selected = selectEnvironmentForPrompt({
    locationEnabled: true,
    locationResolverAvailable: true,
    location: state.location ?? undefined,
  }, prompt, now);
  if (!selected?.locationEnabled) return "unrelated";
  if (selected.location) return "fresh";
  // A prior precise fix is evidence that the device location route has worked
  // before. A missing or city-scale IP fix is not: attempting browser
  // geolocation there may surface a new OS privacy prompt behind the user's
  // current window. Leave those cases to an explicit Settings handoff.
  if (!state.location || state.location.accuracy > 1_000) return "permission-unavailable";
  let permission: Awaited<ReturnType<PromptLocationRefreshOptions["permission"]>>;
  try { permission = await options.permission(); } catch { return "permission-unavailable"; }
  if (permission !== "granted") return "permission-unavailable";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(250, Math.min(options.timeoutMs ?? 4_500, 8_000)));
  try {
    const location = await options.position(controller.signal);
    const valid = Number.isFinite(location.latitude) && location.latitude >= -90 && location.latitude <= 90 &&
      Number.isFinite(location.longitude) && location.longitude >= -180 && location.longitude <= 180 &&
      Number.isFinite(location.accuracy) && location.accuracy >= 0 &&
      Number.isFinite(Date.parse(location.updatedAt));
    if (!valid) return "failed";
    options.persist(location);
    return "refreshed";
  } catch {
    return "failed";
  } finally {
    clearTimeout(timeout);
  }
}
