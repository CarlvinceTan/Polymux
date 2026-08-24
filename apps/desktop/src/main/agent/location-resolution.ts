import type {AgentTool} from "@polymux/core";
import type {GeneralSettingsDto} from "@polymux/protocol";

const MAX_LOCATION_AGE_MS = 30 * 60 * 1_000;
const MAX_PROXIMITY_ACCURACY_METRES = 1_000;

type Location = NonNullable<GeneralSettingsDto["location"]>;

export interface ResolvedLocality {
  locality: string;
  region?: string;
  country?: string;
  displayName?: string;
  source: string;
}

export interface CurrentLocationResolverOptions {
  current(): {enabled: boolean; location: Location | null};
  resolve(location: Location, signal: AbortSignal): Promise<ResolvedLocality>;
  now?: () => number;
}

/** Resolve an already-authorised fresh device fix into a human locality once.
 * Raw coordinates stay inside the host; the model receives only the locality,
 * accuracy, timestamps and resolver identity needed to ground nearby research. */
export function createCurrentLocationResolutionTool(
  options: CurrentLocationResolverOptions,
): AgentTool {
  let cached: {key: string; at: number; value: ResolvedLocality} | undefined;
  return {
    name: "resolve_current_location",
    description:
      "Resolve the user's currently authorised location fix into an approximate locality for a genuinely location-dependent request. Call once before searching for nearby places or local conditions. Takes no coordinates and never reveals raw latitude/longitude. It refuses disabled, missing, stale, future, or city-scale fixes rather than guessing. Do not use for a locality the user already named.",
    parameters: {type: "object", properties: {}, additionalProperties: false},
    // OpenCode Go and some local/OpenAI-compatible routes can use the schema
    // as guidance but do not implement hard constrained sampling. Requiring it
    // makes every turn fail before the model can call this zero-argument tool.
    strict: "prefer",
    async execute(_input, context) {
      const state = options.current();
      if (!state.enabled)
        return {content: JSON.stringify({status: "disabled", guidance: "Ask the user for an area or landmark; do not infer it from memory or timezone."})};
      if (!state.location)
        return {content: JSON.stringify({status: "unavailable", guidance: "No current fix is available. Ask for an area or landmark; do not guess."})};
      const now = options.now?.() ?? Date.now();
      const capturedAt = Date.parse(state.location.updatedAt);
      if (!Number.isFinite(capturedAt) || capturedAt > now + 60_000 || now - capturedAt > MAX_LOCATION_AGE_MS)
        return {content: JSON.stringify({status: "stale", capturedAt: state.location.updatedAt, guidance: "Ask for an area or refresh location; do not rank nearby results."})};
      if (state.location.accuracy > MAX_PROXIMITY_ACCURACY_METRES)
        return {content: JSON.stringify({status: "too_coarse", accuracyMeters: Math.round(state.location.accuracy), guidance: "This city-scale fix cannot support nearby or walking-distance ranking. Ask for an area or landmark."})};

      const key = `${state.location.latitude.toFixed(4)}:${state.location.longitude.toFixed(4)}:${state.location.updatedAt}`;
      let resolved: ResolvedLocality;
      if (cached && cached.key === key && now - cached.at <= 10 * 60_000) {
        resolved = cached.value;
      } else {
        try {
          resolved = await options.resolve(state.location, context.signal);
          cached = {key, at: now, value: resolved};
        } catch (error) {
          return {
            content: JSON.stringify({
              status: "unavailable",
              capturedAt: state.location.updatedAt,
              accuracyMeters: Math.round(state.location.accuracy),
              reason: error instanceof Error ? error.message : String(error),
              guidance: "The locality resolver failed. Ask for an area or landmark; do not guess.",
            }),
          };
        }
      }
      return {
        content: JSON.stringify({
          status: "resolved",
          locality: resolved.locality,
          region: resolved.region,
          country: resolved.country,
          displayName: resolved.displayName,
          accuracyMeters: Math.round(state.location.accuracy),
          capturedAt: state.location.updatedAt,
          resolvedAt: new Date(now).toISOString(),
          source: resolved.source,
        }),
      };
    },
  };
}

export async function reverseGeocodeCurrentLocation(
  location: Location,
  signal: AbortSignal,
): Promise<ResolvedLocality> {
  const timeout = AbortSignal.timeout(4_000);
  const combined = AbortSignal.any([signal, timeout]);
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(location.latitude));
  url.searchParams.set("lon", String(location.longitude));
  url.searchParams.set("zoom", "16");
  url.searchParams.set("addressdetails", "1");
  const response = await fetch(url, {
    signal: combined,
    headers: {
      accept: "application/json",
      "accept-language": "en",
      "user-agent": "Polymux/0.1 current-location-resolver",
    },
  });
  if (!response.ok) throw new Error(`Locality service returned HTTP ${response.status}`);
  const body = await response.json() as {display_name?: unknown; address?: Record<string, unknown>};
  const address = body.address ?? {};
  const string = (...keys: string[]) => keys.map((key) => address[key]).find((value): value is string =>
    typeof value === "string" && Boolean(value.trim()));
  const locality = string("university", "amenity", "neighbourhood", "suburb", "quarter", "city_district", "city", "town", "village");
  if (!locality) throw new Error("Locality service returned no usable locality");
  return {
    locality,
    region: string("state", "region"),
    country: string("country"),
    displayName: typeof body.display_name === "string" ? body.display_name : undefined,
    source: "OpenStreetMap Nominatim",
  };
}
