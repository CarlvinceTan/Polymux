import type {DesktopCapturerSource} from "electron";
import {readWindowControlLeases, type WindowControlLease} from "./leases.js";

/**
 * Resolve the exact native window held by this run. A preview must never fall
 * back to the frontmost window: concurrent runs may be controlling unrelated
 * apps, and showing either one under the other run would be misleading.
 */
export function leasedPreviewSource(
  leases: WindowControlLease[],
  sources: ReadonlyArray<Pick<DesktopCapturerSource, "id">>,
  runId: string,
): Pick<DesktopCapturerSource, "id"> | null {
  const lease = leases.find((candidate) => candidate.owner === runId);
  const nativeId = lease ? nativeWindowId(lease.windowId) : null;
  if (!nativeId) return null;
  return sources.find((source) => desktopSourceWindowId(source.id) === nativeId) ?? null;
}

export async function captureLeasedWindowPreview(options: {
  registryPath: string;
  runId: string;
  sources: () => Promise<DesktopCapturerSource[]>;
}): Promise<string | null> {
  const leases = readWindowControlLeases(options.registryPath);
  if (!leases.some((lease) => lease.owner === options.runId)) return null;
  const sources = await options.sources();
  const source = leasedPreviewSource(leases, sources, options.runId) as DesktopCapturerSource | null;
  if (!source || source.thumbnail.isEmpty()) return null;
  return source.thumbnail.toDataURL();
}

/** `cg-123:optional-qualifier` is the exact-window lease contract. */
function nativeWindowId(value: string): string | null {
  const match = /^cg-(\d+)(?::|$)/.exec(value);
  return match?.[1] ?? null;
}

/** Electron reports a macOS window source as `window:CG_WINDOW_ID:display`. */
function desktopSourceWindowId(value: string): string | null {
  const match = /^window:(\d+):/.exec(value);
  return match?.[1] ?? null;
}
