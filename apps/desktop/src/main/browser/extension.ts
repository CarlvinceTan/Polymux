import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export { EXTENSION_INSTALL_URL } from "../../shared/extension.js";

/**
 * The extension streams a snapshot of the user's open tabs here, and
 * `browser_tabs` reads it. Its freshness is also the only signal we have that
 * the extension is still installed: an uninstall leaves the last snapshot on
 * disk rather than removing it.
 */
export function tabSnapshotPath(home = homedir()): string {
  return path.join(
    home,
    "Library",
    "Application Support",
    "flareai-tab-context",
    "tabs.json",
  );
}

/**
 * Deliberately generous. The snapshot only updates while the user's browser is
 * running, so a short window would call the extension missing every time
 * someone leaves their browser closed over a weekend. A week of silence is a
 * real signal; anything shorter mostly produces false alarms. The Settings row
 * stays available either way, so a missed detection costs discoverability, not
 * the ability to install.
 */
export const SNAPSHOT_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
export const PROMPT_SNAPSHOT_MAX_AGE_MS = 90_000;

export interface ExternalPromptTab {
  tabId: number;
  windowId: number | null;
  url: string;
  title: string;
  active: boolean;
}

export interface ExternalPromptSnapshot {
  capturedAt?: string;
  tabs: ExternalPromptTab[];
}

/** Fresh, bounded external-browser state for ambient prompt context. Status
 * detection deliberately tolerates a week-old file, but the model must never
 * mistake that for what is open now. Invalid, stale, and partially malformed
 * snapshots therefore contribute nothing. */
export function readExternalPromptTabs(
  now = Date.now(),
  snapshotPath = tabSnapshotPath(),
  maximum = 20,
): ExternalPromptTab[] {
  return readExternalPromptSnapshot(now, snapshotPath, maximum).tabs;
}

/** The same bounded prompt state with its verified source timestamp. Keeping
 * the timestamp lets the prompt and benchmark prove freshness without copying
 * any tab title or URL into telemetry. */
export function readExternalPromptSnapshot(
  now = Date.now(),
  snapshotPath = tabSnapshotPath(),
  maximum = 20,
): ExternalPromptSnapshot {
  try {
    const payload = JSON.parse(readFileSync(snapshotPath, "utf8")) as {
      captured_at?: string;
      tabs?: Array<Record<string, unknown>>;
    };
    const capturedAt = Date.parse(payload.captured_at ?? "");
    if (!Number.isFinite(capturedAt) || now - capturedAt > PROMPT_SNAPSHOT_MAX_AGE_MS)
      return {tabs: []};
    const tabs = (payload.tabs ?? [])
      .filter((tab) =>
        Number.isInteger(tab.id) && typeof tab.url === "string" && typeof tab.title === "string",
      )
      .slice(0, Math.max(0, maximum))
      .map((tab) => ({
        tabId: tab.id as number,
        windowId: Number.isInteger(tab.window_id) ? tab.window_id as number : null,
        url: tab.url as string,
        title: tab.title as string,
        active: tab.active === true,
      }));
    return {capturedAt: new Date(capturedAt).toISOString(), tabs};
  } catch {
    return {tabs: []};
  }
}

export interface BrowserExtensionStatus {
  /** True while a tab snapshot exists and is recent enough to trust. */
  installed: boolean;
  /** When the extension last reported, or null if it never has. */
  lastReportedAt: string | null;
}

export function readExtensionStatus(
  now = Date.now(),
  snapshotPath = tabSnapshotPath(),
): BrowserExtensionStatus {
  let modified: number;
  try {
    modified = statSync(snapshotPath).mtimeMs;
  } catch {
    return { installed: false, lastReportedAt: null };
  }
  return {
    installed: now - modified < SNAPSHOT_STALE_AFTER_MS,
    lastReportedAt: new Date(modified).toISOString(),
  };
}
