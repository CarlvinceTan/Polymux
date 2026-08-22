import type { Skill } from "../skills/types.js";

const STOP: ReadonlySet<string> = new Set<string>([
  "about", "actual", "after", "agent", "also", "and", "anything", "app", "are",
  "asks", "before", "being", "best", "can", "connected", "could", "create",
  "current", "default", "does", "explicit", "find", "for", "from", "got", "have", "her",
  "him", "his", "how", "into", "its", "just", "local", "manage", "may", "might",
  "more", "most", "not", "one", "only", "our", "out", "over", "page", "plus", "rank", "recent", "relevant",
  "shortlist", "should", "task", "than", "that", "the", "their", "them", "then", "there", "these",
  "they", "this", "through", "too", "two", "under", "use", "user", "was", "were",
  "what", "when", "whenever", "where", "whether", "which", "who", "why", "will", "with", "work",
  "would", "you", "your",
]);

const TOPICS = [
  ["browser", "website", "page", "site", "web", "search", "research", "events", "form", "fill", "url", "live"],
  ["email", "mail", "inbox", "application", "booking", "receipt"],
  ["message", "reply", "chat", "email", "mail", "dad", "father", "parent", "mum", "mother", "whatsapp", "wechat"],
  ["changed", "change", "update", "updates", "browser", "web", "search", "research", "email", "mail", "inbox", "message", "whatsapp", "wechat"],
  ["computerHistory", "screen", "switched", "doing", "recent", "before"],
  ["window", "tab", "open", "focus", "foreground", "gui", "app"],
  ["document", "docx", "word", "pdf", "spreadsheet", "xlsx", "csv", "slides", "presentation", "pptx"],
  ["skill", "workflow", "record", "demonstration"],
  ["reminder", "remind", "scheduled", "schedule"],
];

const CORE_RULES: Record<string, RegExp> = {
  "apple-reminders": /\b(?:remind|reminder|reminders)\b|\b(?:don['’]?t|do not) forget\b/i,
  "browser-use": /\b(?:browse|browser|events?|find|form|fill|latest|live|page|research|search|site|url|web|website|changed|change)\b/i,
  "chat-style": /\b(?:chat|dad|father|message|mum|mother|parent|reply|respond|text)\b/i,
  computerHistory: /\b(?:computerHistory|doing|screen|switched)\b/i,
  documents: /\b(?:docx|document|word)\b/i,
  "email-use": /\b(?:application|booking|changed|change|email|inbox|mail|receipt|reply|respond)\b/i,
  "message-use": /\b(?:changed|change|chat|dad|father|message|mum|mother|parent|reply|respond|whatsapp|wechat)\b/i,
  "computer-use": /\b(?:app|fill|focus|form|foreground|gui|open|screen|tab|window)\b|\bthis\s+(?:document|file|form|page|pdf|presentation|spreadsheet|tab|window)\b/i,
  "skill-record": /\b(?:demonstrate|demonstration|mimic|record workflow|watch me)\b/i,
  pdf: /\bpdf\b/i,
  presentations: /\b(?:powerpoint|pptx|presentation|slides?)\b/i,
  "skill-creator": /\b(?:create|author|build|write) (?:a )?skill\b/i,
  "skill-maintenance": /\b(?:(?:edit|install|merge|promote|remov(?:e|ing|al)|review|update)\s+(?:an? |the |my )?(?:installed |personal )?skills?|look over\s+(?:an? |the |my )?(?:installed |personal )?skills?)\b/i,
  spreadsheets: /\b(?:csv|excel|spreadsheet|workbook|xlsx)\b/i,
};

const EXPLICIT_COMMUNICATION_SOURCE = /\b(?:dad|email|father|inbox|mail|message|mum|mother|parent|whatsapp|wechat)\b/i;
const EXPLICIT_EMAIL_SOURCE = /\b(?:email|inbox|mail)\b/i;
const EXPLICIT_MESSAGE_SOURCE = /\b(?:dad|father|message|mum|mother|parent|whatsapp|wechat)\b/i;
const EXPLICIT_PUBLIC_WEB = /\b(?:browse|browser|online|page|research|search|site|url|web|website)\b/i;
const REMINDER_INTENT = /\b(?:remind|reminder|reminders)\b|\b(?:don['’]?t|do not) forget\b/i;
const EXPLICIT_SURFACE_ACTION = /\b(?:browse|browser|fill|open|page|site|tab|web|website|window)\b/i;
const OFFICIAL_COUNTERPART: Record<string, string> = {
  email: "email-use",
  message: "message-use",
  "window-control": "computer-use",
};

function words(value: string): Set<string> {
  const matched: string[] = value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return new Set(matched
    .filter((word) => word.length >= 3 && !STOP.has(word))
    .map(normalizeWord));
}

function normalizeWord(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 5 && word.endsWith("ing")) {
    let base = word.slice(0, -3);
    if (base.length >= 3 && base.at(-1) === base.at(-2)) base = base.slice(0, -1);
    return base;
  }
  if (word.length > 4 && word.endsWith("ed")) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith("s") && !/(?:is|ss|us)$/.test(word))
    return word.slice(0, -1);
  return word;
}

function expanded(prompt: string): Set<string> {
  const original = words(prompt);
  const result = new Set(original);
  for (const topic of TOPICS) {
    if (topic.some((word) => original.has(word)))
      for (const word of topic) result.add(word);
  }
  return result;
}

/**
 * The coordinator needs enough catalogue to name an obvious workflow, not
 * every installed skill on every turn. False negatives are lossless: when it
 * sees no exact relevant skill it omits `skill_names`, and the delegated run's
 * routing contract restores the complete catalogue.
 */
export function selectSkillsForPrompt(skills: Skill[], prompt: string): Skill[] {
  if (
    /\bthis\b/i.test(prompt) &&
    words(prompt).size <= 1 &&
    !/\bthis\s+(?:afternoon|evening|month|morning|semester|term|time|week|weekend|year)\b/i.test(prompt) &&
    !/\b(?:browser|computerHistory|doing|document|docx|events?|file|fill|form|pages?|pdf|presentation|slides?|spreadsheet|switched|tab|website|window|xlsx)\b/i.test(prompt)
  )
    return [];
  const query = expanded(prompt);
  const exact = words(prompt);
  const officialNames = new Set(skills
    .filter((skill) => skill.source === "official")
    .map((skill) => skill.name));
  const candidateWords = new Map(skills.map((skill) => [
    skill,
    words(`${skill.name} ${skill.description}`),
  ]));
  const nameWords = new Map(skills.map((skill) => [skill, words(skill.name)]));
  const ownersByWord = new Map<string, number>();
  for (const candidate of candidateWords.values())
    for (const word of candidate) ownersByWord.set(word, (ownersByWord.get(word) ?? 0) + 1);
  const nameOwnersByWord = new Map<string, number>();
  for (const names of nameWords.values())
    for (const word of names) nameOwnersByWord.set(word, (nameOwnersByWord.get(word) ?? 0) + 1);
  if (!query.size) return [];
  const directOverlap = (skill: Skill): string[] => {
    const candidate = candidateWords.get(skill)!;
    const ownNames = nameWords.get(skill)!;
    return [...exact].filter((word) =>
      candidate.has(word)
      && (ownNames.has(word) || (nameOwnersByWord.get(word) ?? 0) === 0),
    );
  };
  const strongestConfiguredOverlap = Math.max(0, ...skills
    .filter((skill) => !CORE_RULES[skill.name])
    .map((skill) => directOverlap(skill).length));
  return skills.filter((skill) => {
    const counterpart = OFFICIAL_COUNTERPART[skill.name];
    if (
      counterpart
      && skill.source !== "official"
      && officialNames.has(counterpart)
      && !new RegExp(`\\b${skill.name.replace(/-/g, "[- ]")}\\s+(?:skill|workflow)\\b`, "i").test(prompt)
    ) return false;
    const coreName = skill.name;
    const coreRule = CORE_RULES[coreName];
    if (coreRule) {
      if (
        (coreName === "browser-use" || coreName === "computer-use")
        && REMINDER_INTENT.test(prompt)
        && !EXPLICIT_SURFACE_ACTION.test(prompt)
      ) return false;
      if (
        coreName === "browser-use"
        && EXPLICIT_COMMUNICATION_SOURCE.test(prompt)
        && !EXPLICIT_PUBLIC_WEB.test(prompt)
      ) return false;
      if (
        coreName === "message-use"
        && EXPLICIT_EMAIL_SOURCE.test(prompt)
        && !EXPLICIT_MESSAGE_SOURCE.test(prompt)
      ) return false;
      if (
        coreName === "email-use"
        && EXPLICIT_MESSAGE_SOURCE.test(prompt)
        && !EXPLICIT_EMAIL_SOURCE.test(prompt)
      ) return false;
      return coreRule.test(prompt);
    }
    // Verbose personal and plugin descriptions must not inherit every alias
    // from a broad topic such as "events" or "latest". Match their own words
    // against what the user actually said; a delegated worker still receives
    // the complete catalogue when the coordinator cannot name an exact skill.
    const ownNames = nameWords.get(skill)!;
    const overlapping = directOverlap(skill);
    const named = [...ownNames].some((word) => exact.has(word));
    const distinctiveSingle = overlapping.length === 1
      && strongestConfiguredOverlap === 1
      && overlapping[0]!.length >= 6
      && ownersByWord.get(overlapping[0]!) === 1;
    return named || overlapping.length >= 2 || distinctiveSingle;
  });
}
