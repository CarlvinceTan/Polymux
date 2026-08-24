const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "anything",
  "are",
  "before",
  "can",
  "explain",
  "find",
  "for",
  "from",
  "has",
  "have",
  "i",
  "in",
  "is",
  "it",
  "me",
  "my",
  "next",
  "of",
  "on",
  "or",
  "plans",
  "request",
  "send",
  "sending",
  "that",
  "the",
  "thing",
  "this",
  "to",
  "two",
  "was",
  "what",
  "with",
  "work",
  "you",
  "whether",
  "matters",
]);

const TOPIC_GROUPS = [
  [
    "reply",
    "message",
    "email",
    "draft",
    "send",
    "sending",
    "recipient",
    "contact",
    "dad",
    "father",
    "parent",
    "mum",
    "mother",
    "whatsapp",
    "wechat",
    "mail",
  ],
  [
    "career",
    "job",
    "application",
    "role",
    "interview",
    "graduate",
    "internship",
    "work-authorisation",
    "sponsorship",
  ],
  ["singapore", "nus", "nusync", "exchange", "student", "pass", "housing"],
  ["travel", "flight", "hotel", "visa", "itinerary", "booking"],
  [
    "event",
    "events",
    "club",
    "clubs",
    "society",
    "societies",
    "interest",
    "interested",
  ],
  ["form", "fill", "submit", "field"],
  ["file", "folder", "move", "document", "drive", "upload"],
  [
    "screen",
    "window",
    "tab",
    "page",
    "foreground",
    "computerHistory",
    "switched",
    "recent",
    "earlier",
    "left-off",
  ],
  [
    "memory",
    "remember",
    "history",
    "previous",
    "recall",
    "preference",
    "preferences",
    "interested",
    "usual",
    "normally",
  ],
  [
    "request",
    "client",
    "model",
    "api",
    "endpoint",
    "provider",
    "opencode",
    "server",
    "inference",
  ],
];
const ROUTE_INTENT =
  /\b(?:send|make|try|run) (?:it )?(?:a |one )?request\b|\b(?:client|model|api|endpoint|provider|inference)\b/i;
const COMMUNICATION_REFERENCE =
  /\b(?:reply|message|email|draft|recipient|contact|dad|father|parent|mum|mother|whatsapp|wechat|mail|inbox)\b/i;
const PERSONALIZATION_REFERENCE =
  /\b(?:i might be interested|i might (?:like|enjoy)|might i (?:like|enjoy)|would i (?:like|enjoy)|pick(?: one)? for me|choose(?: one)? for me|recommend(?: something| one|ations?)? for me|suggest(?: something| one)? for me|based on my (?:interests|preferences)|my (?:interests|preferences|hobbies))\b/i;
const PERSONAL_MEMORY_BLOCK =
  /\b(?:interests?|preferences?|hobbies|likes?|enjoys?|favourites?|favorites?|passions?)\b/i;
const MAX_MATCHED_BLOCKS_PER_SECTION = 2;

function words(value: string): Set<string> {
  const matched: string[] =
    value.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [];
  return new Set(
    matched.filter((word) => word.length > 2 && !STOP_WORDS.has(word)),
  );
}

function queryWords(prompt: string): Set<string> {
  const selected = words(prompt);
  for (let index = 0; index < TOPIC_GROUPS.length; index++) {
    const group = TOPIC_GROUPS[index]!;
    const intentMatch =
      index === 0
        ? COMMUNICATION_REFERENCE.test(prompt)
        : index === TOPIC_GROUPS.length - 1
          ? ROUTE_INTENT.test(prompt)
          : group.some((word) => selected.has(word));
    if (intentMatch) for (const word of group) selected.add(word);
  }
  return selected;
}

function blocks(body: string): string[] {
  const result: string[] = [];
  let current: string[] = [];
  const flush = () => {
    const value = current.join("\n").trim();
    if (value) result.push(value);
    current = [];
  };
  for (const line of body.split("\n")) {
    if (/^-\s/.test(line) || /^###\s/.test(line)) flush();
    if (!line.trim() && current.length && !current[0]?.startsWith("- "))
      flush();
    else current.push(line);
  }
  flush();
  return result;
}

/** Privacy-safe size of the selected durable context. This counts semantic
 * blocks, never their text, so evaluation can distinguish useful recall from
 * an empty Memory heading or profile boilerplate. */
export function memorySummaryBlockCount(summary: string | undefined): number {
  if (!summary?.trim()) return 0;
  const matches = [...summary.matchAll(/^##\s+([^\n]+)\n/gm)];
  if (!matches.length) return 1;
  let count = 0;
  for (let index = 0; index < matches.length; index++) {
    const start = matches[index]!.index! + matches[index]![0].length;
    const end = matches[index + 1]?.index ?? summary.length;
    count += Math.max(1, blocks(summary.slice(start, end).trim()).length);
  }
  return count;
}

function relevanceScore(block: string, query: Set<string>): number {
  const candidate = words(block);
  return [...query].filter((word) => candidate.has(word)).length;
}

/** A main-agent prompt needs durable identity and relevant preferences, not
 * every historical operating note on every turn. The full registry and recall
 * tools remain available when a detail is absent. */
export function selectRelevantMemorySummary(
  summary: string,
  prompt: string,
): string {
  const query = queryWords(prompt);
  const personalization = PERSONALIZATION_REFERENCE.test(prompt);
  if (!summary.trim()) return summary;
  const matches = [...summary.matchAll(/^##\s+([^\n]+)\n/gm)];
  if (!matches.length) return summary;
  const preamble = summary.slice(0, matches[0]!.index).trim();
  const sections: string[] = [];
  for (let index = 0; index < matches.length; index++) {
    const match = matches[index]!;
    const title = match[1]!.trim();
    const start = match.index! + match[0].length;
    const end = matches[index + 1]?.index ?? summary.length;
    const body = summary.slice(start, end).trim();
    if (title === "User Profile") {
      sections.push(`## ${title}\n\n${body}`);
      continue;
    }
    const candidates = blocks(body).map((block) => ({
      block,
      score: relevanceScore(block, query),
    }));
    const strongest = Math.max(
      0,
      ...candidates.map((candidate) => candidate.score),
    );
    // A named host often has many remembered services. For request-route
    // questions, one shared machine word must not make an unrelated detailed
    // service compete equally with a block that also matches client/model/API
    // concepts. This narrows only historical setup blocks; profile and user
    // preferences retain their ordinary one-match behavior.
    const routeFloor =
      ROUTE_INTENT.test(prompt) &&
      title === "What's in Memory" &&
      strongest >= 3
        ? strongest - 1
        : 1;
    const selectedIndexes = new Set(
      candidates
        .map((candidate, candidateIndex) => ({ ...candidate, candidateIndex }))
        .filter(
          ({ block, score }) =>
            score >= routeFloor ||
            (personalization && PERSONAL_MEMORY_BLOCK.test(block)),
        )
        .sort(
          (a, b) => b.score - a.score || a.candidateIndex - b.candidateIndex,
        )
        .slice(0, MAX_MATCHED_BLOCKS_PER_SECTION)
        .map(({ candidateIndex }) => candidateIndex),
    );
    // Restore source order after relevance ranking so the selected summary
    // remains coherent while one broad topic cannot flood the prompt with
    // every historical note that happens to share a single word.
    const kept = candidates
      .filter((_, candidateIndex) => selectedIndexes.has(candidateIndex))
      .map(({ block }) => block);
    if (kept.length) sections.push(`## ${title}\n\n${kept.join("\n")}`);
  }
  return [preamble, ...sections].filter(Boolean).join("\n\n");
}

export function memorySummaryForPrompt(options: {
  summary: string;
  prompt: string;
  subagent: boolean;
}): string | undefined {
  if (options.subagent) return undefined;
  return selectRelevantMemorySummary(options.summary, options.prompt);
}

/** Privacy-safe accounting for benchmark telemetry. Candidate and retained
 * counts reveal selection efficiency without duplicating durable context. */
export function memorySummarySelectionForPrompt(options: {
  summary: string;
  prompt: string;
  subagent: boolean;
}): {
  summary: string | undefined;
  candidateBlocks: number;
  retainedBlocks: number;
} {
  const selected = memorySummaryForPrompt(options);
  return {
    summary: selected,
    candidateBlocks: options.subagent
      ? 0
      : memorySummaryBlockCount(options.summary),
    retainedBlocks: memorySummaryBlockCount(selected),
  };
}
