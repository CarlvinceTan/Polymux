const COMPLEX = /\b(?:analyse|analyze|benchmark|changed|compare|comprehensive|coordinate|deep|evaluate|everything|find|investigate|multiple|plan|research|review|search|several|strategy|summari[sz]e)\b/i;
const IMPLICIT_GUI = /\b(?:this|that (?:app|page|tab|window)|on my screen|i (?:have|had) open|currently open|what(?:'s| is) open|where i left off|what i was doing)\b/i;
const REMOTE_OR_CROSS_SURFACE = /\b(?:browser|dropbox|google drive|icloud|onedrive|site|url|web|website)\b/i;

export type DirectToolGroup = "resume" | "browser-research" | "browser-read" | "communications" | "email-read" | "email" | "messages-read" | "messages" | "reminders" | "schedule" | "files";

const DOMAINS: ReadonlyArray<{ group: DirectToolGroup; pattern: RegExp }> = [
  { group: "email", pattern: /\b(?:emails?|inbox|mail|message subject)\b/i },
  { group: "messages", pattern: /\b(?:chats?|messages?|text|whatsapp|wechat)\b/i },
  { group: "reminders", pattern: /\b(?:remind|reminders?)\b/i },
  { group: "schedule", pattern: /\b(?:calendars?|schedules?)\b/i },
  { group: "files", pattern: /\b(?:files?|folders?|documents?|pdfs?|spreadsheets?|slides?)\b/i },
];
const PERSON_MESSAGE = /\b(?:dad|father|mum|mother|parent)\b/i;
const IMPLICIT_PERSON_MESSAGE_READ = /\bwhat did (?:dad|father|mum|mother|(?:my )?parent) (?:message|say|send)(?: me)?\b/i;
const COMMUNICATION_WRITE = /\b(?:draft|reply|respond|send|tell|text|write)\b/i;
const IMPLICIT_REMINDER = /\b(?:don['’]?t|do not) forget to\b/i;
const CONTEXTUAL_COMMUNICATION_FOLLOW_UP = /\b(?:draft|repl(?:y|ies)|respond)\b[\s\S]*\b(?:ones|those|them)\b|\b(?:ones|those|them)\b[\s\S]*\b(?:draft|repl(?:y|ies)|respond)\b/i;

const ACTION = /\b(?:add|archive|check|complete|create|draft|list|mark|move|open|read|remind|reply|save|send|show|tell|text|write)\b/i;
const CURRENT_PAGE_READ = /\b(?:explain|read|check|tell me|what (?:is|does)|whether|matter(?:s)?)\b/i;
const CURRENT_PAGE_REFERENCE = /\b(?:this|that (?:page|tab|window)|current(?:ly open)? (?:page|tab|window)|on my screen)\b/i;
const PAGE_MUTATION = /\b(?:accept|book|buy|change|click|close|delete|download|edit|fill|navigate|open|pay|purchase|send|submit|type|upload)\b/i;
const HISTORICAL_SCREEN = /\b(?:before|earlier|history|left off|recent|switched|was doing)\b/i;
const SINGLE_SITE_DISCOVERY_ACTION = /\b(?:check|find|look for|search|show)\b/i;
const SINGLE_SITE_DISCOVERY_OBJECT = /\b(?:activities|events?|opportunities|sessions?|things to do|workshops?)\b/i;
const SINGLE_SOURCE_FACT_OBJECT = /\b(?:address|availability|deadline|eligibility|hours?|location|opening times?|price|registration|requirements?|status)\b/i;
const SINGLE_SITE_SOURCE = /\b(?:from|on)\s+(?:the\s+)?[\p{L}\p{N}][\p{L}\p{N}._-]*(?:\s+(?:site|website|portal))?\b/iu;
// Natural requests often name an institution instead of saying "from its
// website". This is still one bounded official-source lookup, not work that
// benefits from a coordinator round trip.
const SINGLE_ORGANISATION_SOURCE = /\b(?:university|college|school|museum|library|conference|festival|club|society|company|organisation|organization)\b/i;
const MULTI_SOURCE_DISCOVERY = /\b(?:across|and (?:also |then )?(?:check|compare|search)|compare|email|inbox|messages?|whatsapp|wechat)\b/i;
const LOCAL_DISCOVERY_REFERENCE = /\b(?:near me|nearby|my location|closest|around me|walking distance|where i am|in my area|local to me|somewhere (?:close|near))\b/i;
const LOCAL_DISCOVERY_OBJECT = /\b(?:cafes?|coffee shops?|librar(?:y|ies)|places?|restaurants?|shops?|spaces?|spots?|venues?|workspaces?)\b/i;
const LOCAL_CROSS_SURFACE = /\b(?:calendar|email|file|inbox|message|schedule|whatsapp|wechat)\b/i;
const LOCAL_RESULT_MUTATION = /\b(?:accept|book|buy|change|click|close|delete|download|edit|fill|navigate|pay|purchase|send|submit|type|upload)\b/i;
const DISCOVERY_FOLLOW_UP = /\b(?:which one|what (?:would|should) (?:i|you)|what (?:do|would) i need|need to bring|pick for me)\b/i;
const RESUME_VERB = /\b(?:carry on|continue|finish|go back|pick up|resume)\b/i;
const PRIOR_WORK_REFERENCE = /\b(?:before (?:(?:i )?(?:changed|opened|switched|moved)|(?:changing|opening|switching|moving))|last task|previous task|task i was on|what i was (?:doing|working on)|where i left off)\b/i;

/**
 * A coordinator is valuable when it must split, research, reconcile or infer
 * a surface. A short, explicit action in exactly one well-known domain is
 * faster and clearer when the conversational run uses the tool itself.
 *
 * False negatives only cost the existing coordinator turn. False positives
 * would remove orchestration, so the boundary is deliberately narrow.
 */
export function shouldUseDirectFastPath(
  prompt: string,
  options: { hasAttachments?: boolean; asGoal?: boolean; currentPageAvailable?: boolean; hasPriorAssistant?: boolean; previousDirectGroup?: DirectToolGroup } = {},
): boolean {
  return directFastPathGroup(prompt, options) !== undefined;
}

export function directFastPathGroup(
  prompt: string,
  options: { hasAttachments?: boolean; asGoal?: boolean; currentPageAvailable?: boolean; hasPriorAssistant?: boolean; previousDirectGroup?: DirectToolGroup } = {},
): DirectToolGroup | undefined {
  const trimmed = prompt.trim();
  if (!trimmed || options.hasAttachments || options.asGoal) return undefined;
  const words = trimmed.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
  // This is one sequential dependency, not two independently manageable jobs:
  // the same run must identify the prior surface before it can continue it.
  // Keeping it on the conversational agent removes a dispatch and relay while
  // the bounded ComputerHistory primitive supplies the missing state in one call.
  if (words <= 24 && RESUME_VERB.test(trimmed) && PRIOR_WORK_REFERENCE.test(trimmed))
    return "resume";
  if (words <= 24 && options.hasPriorAssistant && CONTEXTUAL_COMMUNICATION_FOLLOW_UP.test(trimmed))
    return "communications";
  if (
    words <= 32 &&
    options.previousDirectGroup === "browser-research" &&
    DISCOVERY_FOLLOW_UP.test(trimmed) &&
    !MULTI_SOURCE_DISCOVERY.test(trimmed) &&
    !IMPLICIT_GUI.test(trimmed) &&
    !PAGE_MUTATION.test(trimmed)
  ) return "browser-research";
  if (
    words <= 24 &&
    SINGLE_SITE_DISCOVERY_ACTION.test(trimmed) &&
    SINGLE_SITE_DISCOVERY_OBJECT.test(trimmed) &&
    (SINGLE_SITE_SOURCE.test(trimmed) || SINGLE_ORGANISATION_SOURCE.test(trimmed)) &&
    !MULTI_SOURCE_DISCOVERY.test(trimmed) &&
    !IMPLICIT_GUI.test(trimmed) &&
    !PAGE_MUTATION.test(trimmed)
  ) return "browser-research";
  if (
    words <= 24 &&
    SINGLE_SITE_DISCOVERY_ACTION.test(trimmed) &&
    SINGLE_SOURCE_FACT_OBJECT.test(trimmed) &&
    (SINGLE_SITE_SOURCE.test(trimmed) || SINGLE_ORGANISATION_SOURCE.test(trimmed)) &&
    !MULTI_SOURCE_DISCOVERY.test(trimmed) &&
    !IMPLICIT_GUI.test(trimmed) &&
    !PAGE_MUTATION.test(trimmed)
  ) return "browser-research";
  // A nearby recommendation is one bounded dependency chain: resolve the
  // already-authorised fix, then research venues around that anchor. A manager
  // round-trip adds latency but no useful parallelism. Keep compound actions,
  // multi-source comparisons and bookings on the coordinator path.
  if (
    words <= 48 &&
    SINGLE_SITE_DISCOVERY_ACTION.test(trimmed) &&
    LOCAL_DISCOVERY_REFERENCE.test(trimmed) &&
    LOCAL_DISCOVERY_OBJECT.test(trimmed) &&
    !MULTI_SOURCE_DISCOVERY.test(trimmed) &&
    !LOCAL_CROSS_SURFACE.test(trimmed) &&
    !IMPLICIT_GUI.test(trimmed) &&
    !LOCAL_RESULT_MUTATION.test(trimmed)
  ) return "browser-research";
  if (
    words <= 32 &&
    options.currentPageAvailable === true &&
    CURRENT_PAGE_REFERENCE.test(trimmed) &&
    CURRENT_PAGE_READ.test(trimmed) &&
    !PAGE_MUTATION.test(trimmed) &&
    !HISTORICAL_SCREEN.test(trimmed) &&
    !COMPLEX.test(trimmed)
  ) return "browser-read";
  if (
    words > 32 ||
    COMPLEX.test(trimmed) ||
    IMPLICIT_GUI.test(trimmed) ||
    REMOTE_OR_CROSS_SURFACE.test(trimmed)
  ) return undefined;
  if (!ACTION.test(trimmed) && !IMPLICIT_REMINDER.test(trimmed) && !IMPLICIT_PERSON_MESSAGE_READ.test(trimmed))
    return undefined;
  const domains = DOMAINS.filter(({ pattern }) => pattern.test(trimmed));
  if (domains.length === 1) {
    const group = domains[0]!.group;
    if (group === "messages" && !COMMUNICATION_WRITE.test(trimmed)) return "messages-read";
    if (group === "email" && !COMMUNICATION_WRITE.test(trimmed)) return "email-read";
    return group;
  }
  if (!domains.length && IMPLICIT_REMINDER.test(trimmed)) return "reminders";
  if (!domains.length && PERSON_MESSAGE.test(trimmed))
    return COMMUNICATION_WRITE.test(trimmed) ? "messages" : "messages-read";
  return undefined;
}
