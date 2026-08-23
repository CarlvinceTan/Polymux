import type { EnvironmentContext } from "../runtime.js";

const EXTENSION_BROWSER_APP = /\b(?:arc|brave|chrome|chromium|dia|edge|opera|vivaldi)\b/i;

/** The deictic page fast path is safe only when current state proves there is
 * a browser surface the exact read tool can bind. Otherwise an IDE error,
 * document or dialog described as "this" keeps full orchestration. */
export function currentPageFastPathAvailable(
  environment: EnvironmentContext | undefined,
): boolean {
  const frontmost = environment?.windows?.find((window) => window.frontmost);
  if (frontmost && EXTENSION_BROWSER_APP.test(frontmost.app)) return true;
  return Boolean(
    frontmost &&
    /\bpolymux\b/i.test(frontmost.app) &&
    environment?.browserTabs?.length,
  );
}

const OPEN_STATE_REFERENCE = /\b(?:what (?:this|that) is|(?:explain|review|check|fix|use|read|fill|move|continue|finish|summari[sz]e) (?:what )?(?:this|that)|(?:this|that) (?:tab|page|window|document|doc|file|form)|the (?:tab|page|window) i(?:'m| am) (?:on|using)|on my screen|i (?:have|had) open|currently open|current (?:tab|page|window)|what(?:'s| is) open|before i switched|where i left off|what i was (?:doing|working on)|the thing i was working on)\b/i;
const PROXIMITY_LOCATION_REFERENCE = /\b(?:near me|nearby|my location|closest|around me|walking distance|where i am|in my area|local to me|somewhere (?:close|near))\b/i;
const EXPLICIT_REMOTE_PROXIMITY_ANCHOR = /\b(?:closest|walking distance|somewhere (?:close|near))\b[^.?!\n]{0,80}\b(?:from|to|near|around|in)\s+(?!(?:me|my|here|where i am|my location)\b)(?:the\s+)?[a-z0-9]/i;
const LOCAL_WEATHER_REFERENCE = /\b(?:weather|forecast|temperature)\s+(?:here|near me|where i am)\b|\b(?:weather|forecast|temperature)\s+(?:for|at)\s+my location\b/i;
const MAX_LOCATION_AGE_MS = 30 * 60 * 1_000;
// Device fixes are normally tens of metres. City-scale IP fallbacks are useful
// for local weather, but cannot honestly rank a cafe within walking distance.
const MAX_PROXIMITY_ACCURACY_METRES = 1_000;
const STOP: ReadonlySet<string> = new Set<string>([
  "anything", "affects", "before", "changed", "continue", "could", "explain",
  "find", "from", "have", "into", "latest", "might", "open", "right", "that",
  "this", "what", "whether", "with",
]);
const TOPIC_GROUPS: ReadonlyArray<ReadonlyArray<string>> = [
  ["nus", "nusync", "singapore", "exchange", "campus", "student"],
  ["message", "reply", "email", "mail", "whatsapp", "wechat"],
  ["file", "folder", "document", "form", "drive", "upload"],
];
const READINESS_REFERENCE = /\b(?:(?:get|make|help) me ready|prepare me|set me up)\b/i;
const MAX_EXTERNAL_PROMPT_TABS = 20;

function boundedExternalTabs<T extends {active: boolean}>(tabs: T[] | undefined): T[] | undefined {
  if (!tabs) return undefined;
  return [...tabs]
    .sort((left, right) => Number(right.active) - Number(left.active))
    .slice(0, MAX_EXTERNAL_PROMPT_TABS);
}

function terms(value: string): Set<string> {
  const matched: string[] = value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return new Set(matched.filter((word) => (word.length >= 4 || word === "nus") && !STOP.has(word)));
}

function overlaps(prompt: Set<string>, value: string): boolean {
  const candidate = terms(decodeURIComponentSafe(value));
  return [...prompt].some((word) => candidate.has(word));
}

function promptTerms(value: string): Set<string> {
  const selected = terms(value);
  if (!READINESS_REFERENCE.test(value)) return selected;
  const raw = new Set(value.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  for (const group of TOPIC_GROUPS) {
    if (group.some((word) => raw.has(word)))
      for (const word of group) selected.add(word);
  }
  return selected;
}

/**
 * Current state is high-value routing evidence only when the request points at
 * it. Vague deictic work receives the full prepared snapshot; ordinary work
 * receives only tabs/windows whose own title or URL matches the request. Time
 * remains global because "latest", dates and deadlines need it. Location is
 * kept only when the user refers to where they are.
 */
export function selectEnvironmentForPrompt(
  environment: EnvironmentContext | undefined,
  prompt: string,
  now = Date.now(),
): EnvironmentContext | undefined {
  if (!environment) return undefined;
  const openStateReference = OPEN_STATE_REFERENCE.test(prompt);
  const selectedPromptTerms = promptTerms(prompt);
  const browserTabs = openStateReference
    ? environment.browserTabs
    : environment.browserTabs?.filter((tab) =>
      overlaps(selectedPromptTerms, `${tab.title} ${tab.url}`),
    );
  const externalBrowserTabs = boundedExternalTabs(openStateReference
    ? environment.externalBrowserTabs
    : environment.externalBrowserTabs?.filter((tab) =>
      overlaps(selectedPromptTerms, `${tab.title} ${tab.url}`),
    ));
  const windows = openStateReference
    ? environment.windows
    : environment.windows?.filter((entry) =>
      overlaps(selectedPromptTerms, `${entry.app} ${entry.title}`),
    );
  // A broad readiness request is explicitly asking the assistant to connect
  // the user's current work with upcoming commitments. Keep the single
  // frontmost window as a weak routing cue even when its title does not share
  // literal prompt terms; never widen this to background windows or tabs.
  if (READINESS_REFERENCE.test(prompt)) {
    const frontmost = environment.windows?.find((entry) => entry.frontmost);
    if (frontmost && !windows?.includes(frontmost)) windows?.unshift(frontmost);
  }
  // "Closest" with no anchor naturally means closest to the user. Once the
  // prompt names a different anchor ("closest to Tokyo", "walking distance
  // from NUS"), current coordinates are unrelated private context.
  const proximityLocation =
    PROXIMITY_LOCATION_REFERENCE.test(prompt) &&
    !EXPLICIT_REMOTE_PROXIMITY_ANCHOR.test(prompt);
  const keepLocation = proximityLocation || LOCAL_WEATHER_REFERENCE.test(prompt);
  const locationUpdatedAt = environment.location
    ? Date.parse(environment.location.updatedAt)
    : Number.NaN;
  const freshLocation =
    keepLocation &&
    environment.location &&
    Number.isFinite(locationUpdatedAt) &&
    locationUpdatedAt <= now + 60_000 &&
    now - locationUpdatedAt <= MAX_LOCATION_AGE_MS &&
    (!proximityLocation || environment.location.accuracy <= MAX_PROXIMITY_ACCURACY_METRES)
      ? environment.location
      : undefined;
  return {
    windowsCapturedAt: windows?.length ? environment.windowsCapturedAt : undefined,
    browserTabsCapturedAt: browserTabs?.length ? environment.browserTabsCapturedAt : undefined,
    externalBrowserCapturedAt: externalBrowserTabs?.length
      ? environment.externalBrowserCapturedAt
      : undefined,
    time: environment.time,
    locationEnabled: keepLocation ? environment.locationEnabled : false,
    locationResolverAvailable: keepLocation
      ? environment.locationResolverAvailable
      : undefined,
    location: freshLocation,
    browserTabs,
    externalBrowserTabs,
    windows,
  };
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
