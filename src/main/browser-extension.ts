import { statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * TODO: replace with the real listing once the extension is published. The
 * chip and the Settings row both open this, so it is the only line to change.
 */
export const EXTENSION_INSTALL_URL = "https://flarehq.co/extension";

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
