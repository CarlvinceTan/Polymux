export interface PromptBrowserTab {
  tabId: string;
  url: string;
  title: string;
}

/** Keep immediate visible state first, then the newest background pages. The
 * full tab inventory remains available through the browser tool; this is only
 * the bounded state that rides on every model turn. */
export function selectPromptTabs(
  tabs: PromptBrowserTab[],
  onScreen: ReadonlySet<string>,
  maximum = 12,
): PromptBrowserTab[] {
  const visible = tabs.filter((tab) => onScreen.has(tab.tabId));
  const backgroundNewestFirst = tabs
    .filter((tab) => !onScreen.has(tab.tabId))
    .reverse();
  return [...visible, ...backgroundNewestFirst].slice(0, Math.max(0, maximum));
}
