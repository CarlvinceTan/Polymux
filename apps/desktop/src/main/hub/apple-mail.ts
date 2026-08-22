import {existsSync, readdirSync} from "node:fs";
import {homedir} from "node:os";
import path from "node:path";

export interface AppleMailEnvelope {
  account: string; email: string; id: string; subject: string | null;
  from: {name: string | null; address: string} | null; date: string | null;
  preview: string; hasAttachment: boolean;
}

export interface AppleMailSearchResult {
  messages: AppleMailEnvelope[];
  errors: Array<{account: string; email: string; query: string; error: string}>;
}

interface MailIndexRow {
  rowid: number; document_id: string | null; subject: string | null;
  address: string | null; comment: string | null; summary: string | null;
  date_received: number | null;
}

/** Search Apple Mail's envelope index directly in read-only mode. This neither
 * launches nor controls Mail and covers institutional accounts that cannot use
 * FlareAI's direct IMAP route. Only compact envelope/summary evidence leaves
 * the index. */
export function createAppleMailSearcher(options: {
  platform?: NodeJS.Platform; home?: string; indexPath?: string;
} = {}): (search: {queries: string[]; maxResults: number; timeoutMs: number}) => Promise<AppleMailSearchResult> {
  const platform = options.platform ?? process.platform;
  return async (search) => {
    if (platform !== "darwin") return {messages: [], errors: []};
    const indexPath = options.indexPath ?? findMailIndex(options.home ?? homedir());
    if (!indexPath) return {messages: [], errors: []};

    const {DatabaseSync} = await import("node:sqlite");
    const database = new DatabaseSync(indexPath, {readOnly: true});
    try {
      const terms = searchTerms(search.queries);
      if (!terms.length) return {messages: [], errors: []};
      const cutoff = Math.floor(earliestCutoff(search.queries).valueOf() / 1000);
      const predicates = terms.map(() =>
        "(lower(s.subject) LIKE ? ESCAPE '\\' OR lower(a.address) LIKE ? ESCAPE '\\' OR lower(a.comment) LIKE ? ESCAPE '\\' OR lower(z.summary) LIKE ? ESCAPE '\\')"
      ).join(" OR ");
      const parameters = terms.flatMap((term) => Array(4).fill(`%${escapeLike(term.toLowerCase())}%`));
      const candidateLimit = Math.max(40, Math.min(search.maxResults * 10, 120));
      const rows = database.prepare(`
        SELECT m.ROWID AS rowid, m.document_id, s.subject, a.address, a.comment,
               z.summary, m.date_received
        FROM messages m
        JOIN subjects s ON s.ROWID = m.subject
        LEFT JOIN addresses a ON a.ROWID = m.sender
        LEFT JOIN summaries z ON z.ROWID = m.summary
        JOIN mailboxes mb ON mb.ROWID = m.mailbox
        WHERE m.deleted = 0 AND m.date_received >= ?
          AND lower(mb.url) LIKE '%inbox%'
          AND (${predicates})
        ORDER BY m.date_received DESC LIMIT ?
      `).all(cutoff, ...parameters, candidateLimit) as unknown as MailIndexRow[];
      const messages = rows
        .filter((row) => search.queries.some((query) => queryMatches(query, [
          row.subject, row.address, row.comment, row.summary,
        ].filter(Boolean).join("\n").toLowerCase())))
        .slice(0, Math.max(1, Math.min(search.maxResults, 12)))
        .map((row): AppleMailEnvelope => ({
          account: "apple-mail", email: "Apple Mail",
          id: row.document_id || `apple-mail:${row.rowid}`,
          subject: row.subject,
          from: row.address ? {name: row.comment || null, address: row.address} : null,
          date: row.date_received ? new Date(row.date_received * 1000).toISOString() : null,
          preview: (row.summary ?? "").replace(/\s+/g, " ").trim().slice(0, 240),
          hasAttachment: false,
        }));
      return {messages, errors: []};
    } finally { database.close(); }
  };
}

function findMailIndex(home: string): string | null {
  const root = path.join(home, "Library", "Mail");
  if (!existsSync(root)) return null;
  const versions = readdirSync(root).filter((entry) => /^V\d+$/.test(entry))
    .sort((left, right) => Number(right.slice(1)) - Number(left.slice(1)));
  for (const version of versions) {
    const candidate = path.join(root, version, "MailData", "Envelope Index");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function earliestCutoff(queries: string[]): Date {
  let earliest = new Date(Date.now() - 31 * 86_400_000);
  for (const query of queries) {
    const match = query.match(/\b(?:since|after)\s+(\d{1,2}-[A-Za-z]{3}-\d{4}|\d{4}-\d{2}-\d{2})/i);
    if (!match) continue;
    const parsed = new Date(match[1]!);
    if (!Number.isNaN(parsed.valueOf()) && parsed < earliest) earliest = parsed;
  }
  return earliest;
}

function searchTerms(queries: string[]): string[] {
  const ignored = new Set(["since", "after", "before", "subject", "from", "to", "body", "or", "and"]);
  const terms: string[] = [];
  for (const query of queries) {
    const cleaned = query.replace(/\b(?:since|after|before)\s+\S+/gi, " ");
    for (const term of cleaned.match(/[\p{L}\p{N}@._-]{2,}/gu) ?? []) {
      if (ignored.has(term.toLowerCase()) || terms.includes(term)) continue;
      terms.push(term);
    }
  }
  return terms.slice(0, 8);
}

function queryMatches(query: string, haystack: string): boolean {
  const cleaned = query.replace(/\b(?:since|after|before)\s+\S+/gi, " ")
    .replace(/\b(?:subject|from|to|body)\b/gi, " ").replace(/[()\"]/g, " ");
  return cleaned.split(/\s+OR\s+/i).some((part) => {
    const terms = part.toLowerCase().match(/[\p{L}\p{N}@._-]{2,}/gu) ?? [];
    return terms.length > 0 && terms.every((term) => haystack.includes(term));
  });
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
