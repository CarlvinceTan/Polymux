const DELIBERATION_VERBS = "searching|identifying|considering|planning|curating|reviewing|checking|thinking|clarifying|analysing|analyzing|filtering|listing|selecting|verifying|refining|summarising|summarizing|assessing|confirming|compiling|highlighting";
const DELIBERATION_HEADING = new RegExp(`^(?:#{1,6}\\s+|\\*\\*)?(?:${DELIBERATION_VERBS})\\b[^\\n]*(?:\\*\\*)?\\s*\\n`, "i");
const FORMATTED_DELIBERATION_HEADING = new RegExp(`^(?:#{1,6}\\s+|\\*\\*)(?:${DELIBERATION_VERBS})\\b[^\\n]*(?:\\*\\*)?\\s*\\n`, "i");
const REPEATED_DELIBERATION_HEADINGS = new RegExp(`^(?:\\*\\*|#{1,6}\\s+)?(?:${DELIBERATION_VERBS})\\b[^\\n]*(?:\\*\\*)?\\s*\\n\\s*(?:\\*\\*|#{1,6}\\s+)?(?:${DELIBERATION_VERBS})\\b`, "i");
const FIRST_PERSON_SCRATCH = /\bI\s+(?:think|should|need|want|might|could|will|have to|must)\b/i;
const LIVE_RECOMMENDATION = /\b(?:events?|roles?|jobs?|deadlines?|appointments?|sessions?|workshops?|activities|opportunities|options?|recommendations?|upcoming|latest)\b/i;
const RANKED_BACKUP_REQUEST = /\b(?:best|top|pick|recommend)[\s\S]{0,120}\b(?:backup|alternative|second option)\b|\b(?:backup|alternative|second option)[\s\S]{0,120}\b(?:best|top|pick|recommend)\b/i;
const NAMED_RECOMMENDATION = /(?:^|\n)\s*(?:#{1,6}\s*)?\*{0,2}(?:best(?:\s+option)?|backup|alternative|second option)(?:\*{1,2}\s*:|\s*:\s*\*{0,2})/gi;
const INFEASIBLE_RECOMMENDATION = /\b(?:already closed|closed now|couldn['’]?t verify|cannot verify|not usable|not available|unavailable|unverified|unknown hours?|will close before|does not satisfy|doesn['’]?t satisfy)\b/i;
const QUIET_REQUEST = /\bquiet(?:er|ness)?\b/i;
const QUIET_CONTRADICTION = /\b(?:constant buzz|noisy|loud|less quiet|less (?:likely|guaranteed) to be quiet|not quiet|may not be quiet|might not be quiet)\b/i;
const NEARBY_REQUEST = /\b(?:nearby|near me|close by|closest|walking distance)\b/i;
const TRAVEL_EVIDENCE = /\b\d+(?:\.\d+)?\s*(?:m|km|metres?|meters?|minutes?|mins?)\b|\b(?:walk|walking|travel time|away)\b/i;
const RECOMMENDATION_TITLE = /(?:^|\n)\s*(?:#{1,6}\s*)?\*{0,2}(best(?:\s+option)?|backup|alternative|second option)(?:\*{1,2}\s*:|\s*:\s*\*{0,2})\s*([^\n]+)/gi;
const URL = /https?:\/\/[^\s)\]]+/gi;
const DISCOVERY_ONLY_URL = /^https?:\/\/(?:www\.)?(?:google\.[^/]+\/(?:maps|search)|maps\.google\.[^/]+|search\.brave\.com\/)/i;
const PERSONALIZED_DISCOVERY = /\b(?:might be interested|relevant to me|suit me|match(?:es)? my interests?|based on my interests?|I['’]d (?:like|enjoy))\b/i;
const PERSONAL_RELEVANCE_RATIONALE = /\b(?:because|matches?|fits?|given your|your (?:interest|goal|course|work|study|preference|background)|relevant (?:because|for)|useful for your)\b/i;
const INCIDENTAL_CONTEXT_RATIONALE = /\b(?:relevant|match(?:es)?)\b[^\n]{0,80}\b(?:because|to|for)\b[^\n]{0,220}\b(?:stud(?:y|ies|ying)|attend(?:s|ing)?|exchange|located|liv(?:e|es|ing)|based|university|school|city|country)\b/i;
const ACTIVITY_VALUE_RATIONALE = /\b(?:interest|goal|career|course|work|project|skill|hobby|enjoy|need|learn|practise|practice|build|create|network|meet|explore|solve|prepare you|helps? you|useful for)\b/i;
const NEGATED_RECOMMENDATION = /\b(?:not|isn['’]?t|aren['’]?t|no strong match|omit(?:ted)?|exclude[ds]?|reject(?:ed)?|weak|insufficient|coincidental|merely|only shares?)\b/i;
const SPECULATIVE_PERSONAL_MATCH = /\b(?:plausible|possible|potential|tentative|maybe|might|could|may|likely)\b[^\n]{0,100}\b(?:fit|match|relevant|appeal|interest(?:ing)?)\b|\b(?:fit|match|relevant|appeal|interest(?:ing)?)\b[^\n]{0,100}\b(?:plausible|possible|potential|tentative|maybe|might|could|may|likely)\b/i;
const UNKNOWN_ELIGIBILITY_RESTRICTION = /\b(?:restricted to|members? only|only (?:open|available) to|invite[- ]only)\b/i;
const VERIFIED_ELIGIBILITY = /\b(?:you are|you['’]re|your membership|eligible|confirmed access|already a member)\b/i;

/** Small deterministic checks for failures that must never become the final
 * user answer. It does not judge prose quality or factual correctness; it
 * catches only observable contract violations that can be repaired from the
 * evidence already in context. */
export function finalAnswerQualityIssues(
  prompt: string,
  answer: string,
  time?: {instant?: string; timeZone: string},
  context?: {resolvedCurrentLocation?: boolean},
): string[] {
  const issues: string[] = [];
  const opening = answer.slice(0, 900);
  if (FORMATTED_DELIBERATION_HEADING.test(opening) ||
    (DELIBERATION_HEADING.test(opening) && FIRST_PERSON_SCRATCH.test(opening)) ||
    REPEATED_DELIBERATION_HEADINGS.test(opening))
    issues.push("Remove the visible internal deliberation and begin directly with the result.");

  if (LIVE_RECOMMENDATION.test(prompt)) {
    const lower = answer.toLowerCase();
    const ongoing = lower.indexOf("ongoing");
    const upcoming = lower.indexOf("upcoming");
    if (ongoing >= 0 && upcoming >= 0 && ongoing < upcoming)
      issues.push(
        "Rank future actionable candidates before ongoing ones. Keep an ongoing item only if the verified remaining time and access make acting now genuinely useful.",
      );
  }
  if (PERSONALIZED_DISCOVERY.test(prompt)) {
    if (recommendationBlocks(answer).some((block) =>
      SPECULATIVE_PERSONAL_MATCH.test(block) && !NEGATED_RECOMMENDATION.test(block)
    ))
      issues.push(
        "Do not promote a candidate whose personal relevance is only plausible, possible, or inferred from its title, host, or label. Recommend it only when verified subject or activity details demonstrate the match; otherwise remove it and return fewer or no matches.",
      );
    if (UNKNOWN_ELIGIBILITY_RESTRICTION.test(answer) && !VERIFIED_ELIGIBILITY.test(answer))
      issues.push(
        "Do not recommend an item whose eligibility is restricted unless the evidence establishes that the user qualifies. Exclude it or label it only as an ineligible/unverified lead, not a recommendation.",
      );
    if (/^\s*\d+[.)]\s+/m.test(answer) && !PERSONAL_RELEVANCE_RATIONALE.test(answer))
      issues.push(
        "For a personalized discovery request, state the concrete user-context reason each retained recommendation is relevant. Remove generic or weak candidates rather than calling them relevant without a demonstrated match.",
      );
    if (INCIDENTAL_CONTEXT_RATIONALE.test(answer.replace(/\n\s*/g, " "))) {
      const weakRationale = recommendationBlocks(answer)
        .find((block) =>
          INCIDENTAL_CONTEXT_RATIONALE.test(block) &&
          !ACTIVITY_VALUE_RATIONALE.test(block) &&
          !NEGATED_RECOMMENDATION.test(block)
        );
      if (weakRationale)
        issues.push(
          "Do not treat shared identity, institution, location, or logistics as personal interest by itself. Keep a recommendation only when its actual activity or subject demonstrably serves a known interest, goal, skill, or need; otherwise remove it.",
        );
    }
  }
  if (RANKED_BACKUP_REQUEST.test(prompt)) {
    for (const match of answer.matchAll(NAMED_RECOMMENDATION)) {
      const section = answer.slice(match.index, match.index + 900);
      if (INFEASIBLE_RECOMMENDATION.test(section)) {
        issues.push(
          "Do not present a named best option, backup, or alternative that the answer itself says is closed, unusable, unavailable, or unverified against a material requirement. Return fewer verified candidates, including none, rather than filling the requested quota with a caveated non-match.",
        );
        break;
      }
      if (QUIET_REQUEST.test(prompt) && QUIET_CONTRADICTION.test(section)) {
        issues.push(
          "Do not rank a named option that the answer itself describes as noisy, loud, less quiet, or otherwise contrary to the user's explicit quietness requirement. Remove it or state that no verified quiet match is available.",
        );
        break;
      }
      const urls = section.match(URL) ?? [];
      if (!urls.length || urls.every((url) => DISCOVERY_ONLY_URL.test(url))) {
        issues.push(
          "A named best option, backup, or alternative has no current authoritative detail URL; map and search-result links are discovery only. Remove it from the ranking or replace it only with a candidate already verified from authoritative evidence in the conversation.",
        );
        break;
      }
    }
    const titles = [...answer.matchAll(RECOMMENDATION_TITLE)].map((match) => ({
      role: match[1].toLowerCase(),
      base: match[2]
        .replace(/\*+/g, "")
        .split(/\s+[—–-]\s+/)[0]!
        .trim()
        .toLowerCase(),
    }));
    const best = titles.find((item) => item.role.startsWith("best"));
    const backup = titles.find((item) => /backup|alternative|second/.test(item.role));
    if (best?.base && backup?.base && best.base === backup.base)
      issues.push("Use a genuinely distinct backup location, not another room or area in the same named venue.");
  }
  if (context?.resolvedCurrentLocation && NEARBY_REQUEST.test(prompt) && !TRAVEL_EVIDENCE.test(answer))
    issues.push("Include verified travel distance or time from the resolved current locality before calling an option nearby.");
  const durationMinutes = requestedDurationMinutes(prompt);
  const currentMinutes = localMinutes(time);
  if (durationMinutes !== undefined && currentMinutes !== undefined) {
    for (const match of answer.matchAll(NAMED_RECOMMENDATION)) {
      const section = answer.slice(match.index, match.index + 900);
      const closes = /\b(?:open|hours?)[^\n.]{0,80}\buntil\s+(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?\b/i.exec(section);
      if (!closes) continue;
      let hour = Number(closes[1]) % 12;
      if (closes[3].toLowerCase() === "p") hour += 12;
      let closingMinutes = hour * 60 + Number(closes[2] ?? 0);
      // After-evening hours such as 1 am conventionally belong to the next
      // calendar day; 9 pm at 10 pm is already closed, not tomorrow night.
      if (currentMinutes >= 18 * 60 && closingMinutes < 6 * 60) closingMinutes += 24 * 60;
      if (closingMinutes < currentMinutes + durationMinutes) {
        issues.push(
          "A named recommendation's stated closing time does not cover the user's requested time window from the current local time. Remove it from the ranking or state that no verified match is available; do not claim the hours fit.",
        );
        break;
      }
    }
  }
  return issues;
}

/** Preserve recommendation boundaries while joining Markdown-wrapped prose.
 * Checking physical lines alone lets a model evade the rule by wrapping the
 * rationale after “relevant to your University of Melbourne”. */
function recommendationBlocks(answer: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  const flush = () => {
    const value = current.join(" ").replace(/\s+/g, " ").trim();
    if (value) blocks.push(value);
    current = [];
  };
  for (const line of answer.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      continue;
    }
    if (current.length && /^(?:#{1,6}\s+|\d+[.)]\s+|[-*]\s+\*{0,2}\S)/.test(trimmed)) flush();
    current.push(trimmed);
  }
  flush();
  return blocks;
}

function requestedDurationMinutes(prompt: string): number | undefined {
  const match = /\b(?:about|roughly|around|next|for)?\s*(one|two|three|four|\d+(?:\.\d+)?)\s+hours?\b/i.exec(prompt);
  if (!match) return undefined;
  const words: Record<string, number> = {one: 1, two: 2, three: 3, four: 4};
  const hours = words[match[1].toLowerCase()] ?? Number(match[1]);
  return Number.isFinite(hours) && hours > 0 && hours <= 24 ? hours * 60 : undefined;
}

function localMinutes(time: {instant?: string; timeZone: string} | undefined): number | undefined {
  const instant = Date.parse(time?.instant ?? "");
  if (!Number.isFinite(instant) || !time?.timeZone) return undefined;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: time.timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(instant));
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : undefined;
  } catch {
    return undefined;
  }
}
