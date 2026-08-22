/**
 * Whether this turn needs an up-to-the-moment desktop window snapshot before
 * inference starts. Most turns do not: an AX scan would add launch latency to
 * an email, research, or reminder request whose answer ignores open windows.
 */
export function needsFreshDesktopContext(text: string): boolean {
  const value = text.toLowerCase();
  return (
    // Open state is part of the answer to broad readiness requests: an
    // already-open itinerary, inbox, course page, or document can turn a
    // generic checklist into the next useful action. Pay the AX refresh only
    // for this personal-assistant intent, not ordinary topical research.
    /\b(?:(?:get|make|help) me ready|prepare me|set me up)\b/.test(value) ||
    /\b(?:explain|review|check|fix|use|read|fill|move|continue|finish|summari[sz]e)\s+(?:what\s+)?(?:this|that)\b/.test(value) ||
    /\bwhat\s+(?:this|that)\s+is\b/.test(value) ||
    /\b(?:this|that)\s+(?:page|tab|window|document|doc|file|form)\b/.test(value) ||
    /\b(?:here|what(?:'s| is) open|current (?:page|tab|window)|where i left off|the thing i was working on)\b/.test(value) ||
    /\b(?:page|tab|window|document|doc|file|form)\s+(?:(?:i(?:'m| am|'ve| have)?|we(?:'re| are|'ve| have)?)\s+)?(?:have\s+)?open\b/.test(value) ||
    /\b(?:on|in)\s+(?:my|the)\s+screen\b/.test(value) ||
    /\bwhat\s+i(?:'m| am| was)\s+(?:looking at|doing)\b/.test(value) ||
    /\bbefore\s+i\s+switched\b/.test(value)
  );
}

export interface PromptWindow {
  app: string;
  title: string;
  frontmost: boolean;
}

/** Collapse indistinguishable AX rows while preserving that several windows
 * exist. Repeating "Finder: Finder" four times costs attention without giving
 * the model a way to identify which is which. */
export function compactPromptWindows(windows: PromptWindow[], maximum = 20): PromptWindow[] {
  const grouped = new Map<string, {window: PromptWindow; count: number}>();
  for (const window of windows) {
    const key = `${window.app}\u0000${window.title}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
      existing.window.frontmost ||= window.frontmost;
    } else {
      grouped.set(key, {window: {...window}, count: 1});
    }
  }
  return [...grouped.values()].slice(0, Math.max(0, maximum)).map(({window, count}) => ({
    ...window,
    title: count > 1 ? `${window.title} (${count} windows)` : window.title,
  }));
}
