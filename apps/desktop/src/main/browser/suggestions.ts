const SUGGESTIONS_ENDPOINT = "https://suggestqueries.google.com/complete/search";
const MAX_QUERY_LENGTH = 200;
const MAX_SUGGESTIONS = 6;

type SuggestionFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "json">>;

/**
 * Search completions for the browser address bar. The renderer already owns
 * local history; this deliberately returns only provider suggestions so a
 * network failure never takes recent pages away with it.
 */
export async function searchSuggestions(
  query: string,
  send: SuggestionFetch = fetch,
): Promise<string[]> {
  const text = query.trim().slice(0, MAX_QUERY_LENGTH);
  if (!text || looksLikeAddress(text)) return [];

  const url = new URL(SUGGESTIONS_ENDPOINT);
  url.searchParams.set("client", "firefox");
  url.searchParams.set("q", text);

  try {
    const response = await send(url, {
      headers: {Accept: "application/json"},
      signal: AbortSignal.timeout(2_500),
    });
    if (!response.ok) return [];
    const payload: unknown = await response.json();
    if (!Array.isArray(payload) || !Array.isArray(payload[1])) return [];

    const seen = new Set<string>();
    const suggestions: string[] = [];
    for (const candidate of payload[1]) {
      if (typeof candidate !== "string") continue;
      const value = candidate.trim().slice(0, MAX_QUERY_LENGTH);
      const key = value.toLocaleLowerCase();
      if (!value || seen.has(key)) continue;
      seen.add(key);
      suggestions.push(value);
      if (suggestions.length === MAX_SUGGESTIONS) break;
    }
    return suggestions;
  } catch {
    // Suggestions are opportunistic. Typing, local history and direct
    // navigation continue normally when the provider is offline or slow.
    return [];
  }
}

function looksLikeAddress(value: string): boolean {
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) return true;
  return !/\s/.test(value) && /^[\w.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(value);
}
