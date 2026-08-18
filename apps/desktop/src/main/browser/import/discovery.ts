import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { BrowserSourceDto } from "@flareai/protocol";
import {
  CHROMIUM_BROWSERS,
  chromiumProfiles,
  chromiumUserDataDir,
  keychainSecret,
  readChromiumCookies,
  readChromiumLogins,
  readChromiumHistory,
  deriveKey,
} from "./chromium.js";
import {
  FIREFOX_BROWSERS,
  firefoxProfiles,
  firefoxRoot,
  readFirefoxCookies,
  readFirefoxLogins,
  readFirefoxHistory,
} from "./firefox.js";
import {
  SAFARI_PROFILE_ID,
  readSafariCookies,
  readSafariHistory,
  safariHistoryPath,
  safariCookiePaths,
  safariLogins,
  safariProfiles,
} from "./safari.js";
import { EMPTY_IMPORT, type ImportedData } from "./types.js";

/**
 * Which browsers are on this machine, and reading one of them.
 *
 * Discovery is deliberately cheap and side-effect free: it looks for the
 * directories, not the data, so nothing here can trigger a keychain prompt.
 * The prompt belongs to the moment the user actually asks to import, which is
 * `importFrom` below.
 */

/** A browser is offered only when its support directory is actually there —
 * listing every fork whether or not it is installed would be a menu of things
 * that cannot work. */
export async function discoverBrowsers(home: string = homedir()): Promise<BrowserSourceDto[]> {
  const sources: BrowserSourceDto[] = [];

  for (const browser of CHROMIUM_BROWSERS) {
    const userDataDir = chromiumUserDataDir(browser, home);
    if (!existsSync(userDataDir)) continue;
    // A browser that was installed once leaves its support directory behind
    // with the profile folders gone. `Local State` still lists them, so those
    // profiles are dropped and a browser left with none is not offered at all
    // — three rows reading "its folder is missing" is a menu of things that
    // cannot work, which is what discovery is meant to avoid.
    const profiles = (await chromiumProfiles(userDataDir)).filter(
      (profile) => existsSync(profile.path),
    );
    if (!profiles.length) continue;
    sources.push({
      id: `chromium:${browser.id}`,
      name: browser.name,
      family: "chromium",
      profiles,
      fileImportOnly: false,
    });
  }

  for (const browser of FIREFOX_BROWSERS) {
    const root = firefoxRoot(browser, home);
    if (!existsSync(root)) continue;
    sources.push({
      id: `firefox:${browser.id}`,
      name: browser.name,
      family: "firefox",
      profiles: firefoxProfiles(root),
      fileImportOnly: false,
    });
  }

  const safari = await safariProfiles({ home });
  if (safari.length)
    sources.push({
      id: "safari",
      name: "Safari",
      family: "safari",
      profiles: safari,
      // Safari's saved passwords sit behind per-item keychain ACLs that trust
      // only Apple's own binaries, so there is no reading them however the
      // user is asked. A CSV they export themselves is the only route.
      fileImportOnly: true,
    });

  return sources;
}

/**
 * Reads one profile of one browser.
 *
 * `sourceId` is the id `discoverBrowsers` handed out, and the browser is looked
 * up from it rather than taken from the renderer — the same rule the MCP
 * discovery follows, so a payload cannot name a path of its own choosing and
 * have it read.
 */
export async function importFrom(
  request: {sourceId: string; profileId: string; cookies: boolean; passwords: boolean; history: boolean},
  home: string = homedir(),
): Promise<ImportedData> {
  const [family, browserId] = request.sourceId.split(":");
  if (family === "chromium") return importChromiumProfile(request, browserId ?? "", home);
  if (family === "firefox") return importFirefoxProfile(request, browserId ?? "", home);
  if (request.sourceId === "safari") return importSafariProfile(request, home);
  return { ...EMPTY_IMPORT, problems: [`Unknown browser: ${request.sourceId}`] };
}

async function importChromiumProfile(
  request: {profileId: string; cookies: boolean; passwords: boolean; history: boolean},
  browserId: string,
  home: string,
): Promise<ImportedData> {
  const browser = CHROMIUM_BROWSERS.find((candidate) => candidate.id === browserId);
  if (!browser) return { ...EMPTY_IMPORT, problems: [`Unknown browser: ${browserId}`] };
  const result: ImportedData = { cookies: [], logins: [], visits: [], problems: [] };
  const userDataDir = chromiumUserDataDir(browser, home);
  const profile = (await chromiumProfiles(userDataDir)).find(
    (candidate) => candidate.id === request.profileId,
  );
  if (!profile?.readable)
    return {
      ...EMPTY_IMPORT,
      problems: [profile?.reason ?? `${browser.name}: that profile is no longer there`],
    };

  // The one keychain call, made only now: this is what raises the macOS
  // prompt, and it must follow the user asking rather than merely looking.
  let key: Buffer;
  try {
    key = deriveKey(await keychainSecret(browser.keychain));
  } catch (error) {
    return {
      ...EMPTY_IMPORT,
      problems: [
        `${browser.name}: keychain access was refused, so nothing could be decrypted (${describe(error)})`,
      ],
    };
  }

  const label = `${browser.name} / ${profile.name}`;
  if (request.cookies) {
    const file = path.join(profile.path, "Cookies");
    if (existsSync(file)) {
      const read = await readChromiumCookies(file, key, label);
      result.cookies.push(...read.cookies);
      result.problems.push(...read.problems);
    }
  }
  if (request.passwords) {
    const file = path.join(profile.path, "Login Data");
    if (existsSync(file)) {
      const read = await readChromiumLogins(file, key, label);
      result.logins.push(...read.logins);
      result.problems.push(...read.problems);
    }
  }
  if (request.history) {
    // History is plaintext — no key involved — so it imports even when the
    // keychain refused above would have cost the cookies and passwords.
    const file = path.join(profile.path, "History");
    if (existsSync(file)) {
      const read = await readChromiumHistory(file, label);
      result.visits.push(...read.visits);
      result.problems.push(...read.problems);
    }
  }
  return result;
}

async function importFirefoxProfile(
  request: {profileId: string; cookies: boolean; passwords: boolean; history: boolean},
  browserId: string,
  home: string,
): Promise<ImportedData> {
  const browser = FIREFOX_BROWSERS.find((candidate) => candidate.id === browserId);
  if (!browser) return { ...EMPTY_IMPORT, problems: [`Unknown browser: ${browserId}`] };
  const profile = firefoxProfiles(firefoxRoot(browser, home)).find(
    (candidate) => candidate.id === request.profileId,
  );
  if (!profile?.readable)
    return {
      ...EMPTY_IMPORT,
      problems: [profile?.reason ?? `${browser.name}: that profile is no longer there`],
    };

  const result: ImportedData = { cookies: [], logins: [], visits: [], problems: [] };
  if (request.cookies) {
    const read = readFirefoxCookies(profile.path);
    result.cookies.push(...read.cookies);
    result.problems.push(...read.problems);
  }
  if (request.passwords) {
    const read = readFirefoxLogins(profile.path);
    result.logins.push(...read.logins);
    result.problems.push(...read.problems);
  }
  if (request.history) {
    const read = readFirefoxHistory(profile.path);
    result.visits.push(...read.visits);
    result.problems.push(...read.problems);
  }
  return result;
}

async function importSafariProfile(
  request: {profileId: string; cookies: boolean; passwords: boolean; history: boolean},
  home: string,
): Promise<ImportedData> {
  if (request.profileId !== SAFARI_PROFILE_ID)
    return { ...EMPTY_IMPORT, problems: ["Unknown Safari profile"] };
  const result: ImportedData = { cookies: [], logins: [], visits: [], problems: [] };
  if (request.cookies) {
    const file = safariCookiePaths(home).find((candidate) => existsSync(candidate));
    if (!file) result.problems.push("Safari's cookie store could not be found");
    else {
      const read = await readSafariCookies(file);
      result.cookies.push(...read.cookies);
      result.problems.push(...read.problems);
    }
  }
  // Always reported when passwords were asked for, so the user learns why
  // none arrived rather than seeing a silent zero.
  if (request.history) {
    const read = await readSafariHistory(safariHistoryPath(home));
    result.visits.push(...read.visits);
    result.problems.push(...read.problems);
  }
  if (request.passwords) result.problems.push(...safariLogins().problems);
  return result;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
