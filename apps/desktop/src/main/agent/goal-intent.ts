const RESUME_INTENT = /\b(?:continue|resume|carry\s+on|keep\s+going|pick\s+(?:it|this|that)\s+back\s+up)\b/i;
const EXPLICIT_GOAL_REFERENCE = /\b(?:goal|objective|plan|where\s+(?:we|i)\s+left\s+off)\b/i;
const FINISH_ALL_INTENT = /\b(?:finish|complete)\s+(?:the\s+)?(?:whole|entire|all|everything)|\b(?:all|every)\s+(?:the\s+)?(?:remaining|outstanding)\b|\buntil\s+(?:it(?:'s|\s+is)\s+)?(?:done|finished|complete)\b/i;
const STOP_WORDS = new Set([
  "about", "after", "again", "continue", "from", "going", "handle", "item", "just", "keep",
  "most", "next", "now", "one", "over", "preparation", "prepare", "priority", "ready",
  "remaining", "resume", "step", "that", "the", "this", "urgent", "with", "week",
]);

function meaningfulWords(value: string): Set<string> {
  return new Set(
    value.toLowerCase().match(/[a-z0-9]+/g)
      ?.filter((word) => word.length >= 4 && !STOP_WORDS.has(word))
      .map((word) => word.length > 4 && word.endsWith("s") && !word.endsWith("ss")
        ? word.slice(0, -1)
        : word) ?? [],
  );
}

/**
 * A paused goal is resumed only for an explicit continuation request which
 * either names the goal or shares a meaningful subject with its objective.
 * This avoids treating unrelated requests such as "continue the video" as a
 * durable-goal resume.
 */
export function shouldResumePausedGoal(text: string, objective: string): boolean {
  if (!RESUME_INTENT.test(text)) return false;
  if (EXPLICIT_GOAL_REFERENCE.test(text)) return true;
  const objectiveWords = meaningfulWords(objective);
  return [...meaningfulWords(text)].some((word) => objectiveWords.has(word));
}

/** A bare goal continuation should make one useful increment, not recursively
 * drain an open-ended objective. Explicit finish-all wording keeps the user's
 * request authoritative and removes the batch cap. */
export function shouldBoundGoalContinuation(text: string, objective: string): boolean {
  return shouldResumePausedGoal(text, objective) && !FINISH_ALL_INTENT.test(text);
}

/** Visible user turns can advance the durable goal without being automatic
 * goal-loop continuations. Subject overlap is strong evidence; a short deictic
 * manager instruction qualifies only when no unrelated subject remains. */
export function shouldUseGoalProgressContext(text: string, objective: string): boolean {
  if (EXPLICIT_GOAL_REFERENCE.test(text)) return true;
  const objectiveWords = meaningfulWords(objective);
  const requestWords = meaningfulWords(text);
  if ([...requestWords].some((word) => objectiveWords.has(word))) return true;
  return /\b(?:handle|next|remaining|urgent|priority|step|item|for\s+now)\b/i.test(text) &&
    requestWords.size === 0;
}
