export type AddressRowKind = "history" | "search";

export type AddressRow = {
  id: string;
  kind: AddressRowKind;
  title: string;
  detail: string;
  value: string;
};

export function displayUrl(value: string): string {
  try {
    const parsed = new URL(value);
    return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}${parsed.search}`;
  } catch {
    return value;
  }
}

export function looksLikeAddress(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return (
    /^[a-z]+:\/\//i.test(trimmed) ||
    trimmed.startsWith("localhost") ||
    /^[^\s/$.?#].[^\s]*\.[a-z]{2,}(?::\d+)?(?:[/?#]|$)/i.test(trimmed)
  );
}

export function getInlineCompletion(
  typed: string,
  row: AddressRow | undefined,
): string | null {
  if (!row) return null;
  const query = typed.trimStart();
  if (!query) return null;
  const queryLower = query.toLowerCase();

  if (row.kind === "history") {
    let host = "";
    let pathname = "";
    let search = "";
    try {
      const parsed = new URL(row.value);
      host = parsed.host.replace(/^www\./i, "");
      pathname = parsed.pathname;
      search = parsed.search;
    } catch {
      host =
        row.value
          .replace(/^https?:\/\//i, "")
          .replace(/^www\./i, "")
          .split("/")[0] ?? "";
    }

    const hostLower = host.toLowerCase();

    // 1. If user hasn't typed a slash yet, check host prefix match first
    if (host && !query.includes("/") && hostLower.startsWith(queryLower)) {
      if (hostLower === queryLower) return null;
      return query + host.slice(query.length);
    }

    // 2. Check displayUrl (without www.)
    const display = displayUrl(row.value).replace(/^www\./i, "");
    const displayLower = display.toLowerCase();
    if (displayLower.startsWith(queryLower)) {
      if (displayLower === queryLower) return null;
      return query + display.slice(query.length);
    }

    // 3. Check raw row.value (for when user typed https://...)
    const fullLower = row.value.toLowerCase();
    if (fullLower.startsWith(queryLower)) {
      if (fullLower === queryLower) return null;
      return query + row.value.slice(query.length);
    }

    return null;
  }

  if (row.kind === "search") {
    const val = row.value.trim();
    const valLower = val.toLowerCase();
    if (valLower.startsWith(queryLower) && valLower !== queryLower) {
      return query + val.slice(query.length);
    }
    return null;
  }

  return null;
}

export function addressRowRank(query: string, row: AddressRow): number {
  const text = query.trim().toLowerCase();
  if (!text) return 0;

  if (row.kind === "history") {
    let host = "";
    try {
      const parsed = new URL(row.value);
      host = parsed.host.replace(/^www\./i, "").toLowerCase();
    } catch {
      host =
        row.value
          .replace(/^https?:\/\//i, "")
          .replace(/^www\./i, "")
          .split("/")[0]
          ?.toLowerCase() ?? "";
    }

    const display = displayUrl(row.value)
      .replace(/^www\./i, "")
      .toLowerCase();
    const full = row.value.toLowerCase();

    // Exact host match
    if (host === text) return 100;
    // Host prefix match (e.g. typing "po" matches "polymux.com")
    if (host.startsWith(text)) return 90;
    // Display URL prefix match (e.g. typing "polymux.com/s" matches "polymux.com/settings")
    if (display.startsWith(text)) return 80;
    // Full URL prefix match (e.g. typing "https://po")
    if (full.startsWith(text)) return 70;
    // Host substring match
    if (host.includes(text)) return 50;
    // Path substring match
    if (display.includes(text)) return 40;
    // Title substring match (e.g. GitHub repo with Polymux in title)
    if (row.title.toLowerCase().includes(text)) return 30;
    return 10;
  }

  if (row.kind === "search") {
    const val = row.value.trim().toLowerCase();
    // Raw query row ("po - Search with Google")
    if (val === text) return 25;
    // Search suggestion starting with query
    if (val.startsWith(text)) return 20;
    return 5;
  }

  return 0;
}

export function rankAddressRows(
  rows: AddressRow[],
  query: string,
): AddressRow[] {
  const text = query.trim();
  if (!text) return rows;

  return [...rows].sort((a, b) => {
    const rankA = addressRowRank(text, a);
    const rankB = addressRowRank(text, b);
    return rankB - rankA;
  });
}

/** Synchronously finds the best candidate for inline autocomplete from currently loaded rows or cache. */
export function findInlineCompletionCandidate(
  query: string,
  rows: AddressRow[],
  cachedHistoryRows: AddressRow[] = [],
): { row: AddressRow; completion: string } | null {
  const text = query.trimStart();
  if (!text) return null;

  // 1. Check if top row of rows matches
  if (rows.length > 0) {
    const comp = getInlineCompletion(text, rows[0]);
    if (comp) return { row: rows[0], completion: comp };
  }

  // 2. Check other current rows
  for (const row of rows) {
    const comp = getInlineCompletion(text, row);
    if (comp) return { row, completion: comp };
  }

  // 3. Check cached history rows ranked by query
  if (cachedHistoryRows.length > 0) {
    const ranked = rankAddressRows(cachedHistoryRows, text);
    if (ranked.length > 0) {
      const comp = getInlineCompletion(text, ranked[0]);
      if (comp) return { row: ranked[0], completion: comp };
    }
  }

  return null;
}
