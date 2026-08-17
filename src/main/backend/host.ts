import path from "node:path";
import type {GeneralSettingsDto} from "@flareai/protocol";
import {app} from "electron";
import {copyFileSync, existsSync, mkdirSync, readFileSync} from "node:fs";
import {homedir} from "node:os";
import {parse as parseToml} from "smol-toml";
import {json} from "./requests.js";

/** Facts read from the host rather than from storage or the renderer. */
export async function approximateLocation(): Promise<NonNullable<GeneralSettingsDto["location"]>> {
  const services = ["https://ipwho.is/", "https://ipapi.co/json/"];
  let failure = "the network location services did not respond";
  for (const service of services) {
    try {
      const response = await fetch(service, {
        signal: AbortSignal.timeout(6_000),
        headers: { accept: "application/json" },
      });
      if (!response.ok) continue;
      const body = (await response.json()) as Record<string, unknown>;
      const latitude = Number(body.latitude);
      const longitude = Number(body.longitude);
      if (Number.isFinite(latitude) && Number.isFinite(longitude))
        return {
          latitude,
          longitude,
          // IP geolocation is city-scale; advertise that honestly.
          accuracy: 25_000,
          updatedAt: new Date().toISOString(),
        };
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`Could not determine an approximate location: ${failure}`);
}

export const BROWSER_IDENTITIES: Record<string, { name: string; bundleId: string }> = {
  chrome: { name: "Google Chrome", bundleId: "com.google.Chrome" },
  brave: { name: "Brave Browser", bundleId: "com.brave.Browser" },
  edge: { name: "Microsoft Edge", bundleId: "com.microsoft.edgemac" },
  arc: { name: "Arc", bundleId: "company.thebrowser.Browser" },
  chromium: { name: "Chromium", bundleId: "org.chromium.Chromium" },
};

export function tabContextBrowser(): { name: string; bundleId: string } | null {
  try {
    const payload = JSON.parse(
      readFileSync(
        path.join(
          homedir(),
          "Library",
          "Application Support",
          "flareai-tab-context",
          "tabs.json",
        ),
        "utf8",
      ),
    ) as { browser?: string };
    return BROWSER_IDENTITIES[payload.browser ?? ""] ?? null;
  } catch {
    return null;
  }
}

export function browserAppName(): string {
  return tabContextBrowser()?.name ?? "Browser";
}

export function browserBundleId(): string | undefined {
  return tabContextBrowser()?.bundleId;
}

/** Whether a stored settings record predates the first-run setup flag. */

export function adoptLegacyMcpConfig(legacy: string, current: string): void {
  try {
    if (existsSync(current) || !existsSync(legacy)) return;
    mkdirSync(path.dirname(current), {recursive: true});
    copyFileSync(legacy, current);
  } catch {
    // A migration is a convenience; the app still starts with no MCP servers.
  }
}

export function skillInstructions(contents: string): string {
  if (!contents.startsWith("---")) return contents.trim();
  const end = contents.indexOf("\n---", 3);
  return end < 0 ? contents.trim() : contents.slice(end + 4).trim();
}

export function mimetypeOf(file: string): string {
  const types: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".heic": "image/heic",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",
    ".wav": "audio/wav",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
  };
  return types[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}
