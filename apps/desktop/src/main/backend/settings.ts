import {clearFaviconCache} from "../browser/favicon.js";
import {SUPPORTED_LANGUAGES, supportedLanguage} from "@flareai/protocol";
import type {BrowserSettingsDto, GeneralSettingsDto, ReasoningEffort} from "@flareai/protocol";
import {app, nativeTheme} from "electron";
import {rename} from "node:fs/promises";
import {parse as parseToml} from "smol-toml";
import {
  DEFAULT_PERMISSION_SWITCHES,
  permissionSwitches,
  permissionSwitchesUpdate,
} from "./permission-settings.js";
import {
  DEFAULT_NOTIFICATION_SWITCHES,
  notificationSwitches,
  notificationSwitchesUpdate,
} from "./notification-settings.js";
import {number} from "./requests.js";

/** Stored general settings: reading a preference back into a DTO, and folding
 * an update into it. */
export function hasOnboardingFlag(value: unknown): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "onboardingCompleted" in (value as Record<string, unknown>)
  );
}

/**
 * Puts Chromium's colour scheme on the app's theme rather than the system's.
 *
 * Every embedded page — a browser tab, an OAuth window — resolves
 * `prefers-color-scheme` against `nativeTheme`, and so does the `media`
 * attribute a site puts on its `<link rel="icon">`. Left on the system default,
 * a light app on a dark Mac asks sites for their dark-mode icon and then draws
 * it on light chrome: Luma's mark is white, and vanishes. The theme the user
 * sees is the one pages should be answering, so it is set here.
 *
 * Cached icons were fetched under the old scheme, so they go with it. That is
 * belt and braces: the embedded browser also drops them on `nativeTheme`'s own
 * `updated`, which is the event that covers an OS appearance flip while the
 * preference here sits on 'system' and never moves.
 */

export function applyThemeSource(theme: GeneralSettingsDto["theme"]): void {
  if (nativeTheme.themeSource === theme) return;
  nativeTheme.themeSource = theme;
  clearFaviconCache();
}

export function generalSettingsPreference(value: unknown): GeneralSettingsDto {
  const defaults: GeneralSettingsDto = {
    theme: "light",
    language: "system",
    currency: null,
    // Speech mode has nothing to run until a speech model is assigned. Model
    // assignment turns this on; clearing that assignment turns it off again.
    speechModeEnabled: false,
    dictationAutoStopSeconds: 6,
    timeEnabled: true,
    locationEnabled: true,
    hubIncognitoMode: false,
    reasoningLevel: reasoningEffort(process.env.FLAREAI_REASONING, "medium") ?? "medium",
    advancedMode: false,
    onboardingCompleted: false,
    // Every capability is on by default: the OS grant is the real gate, and
    // this switch exists to turn one off without giving the grant back.
    permissions: {...DEFAULT_PERMISSION_SWITCHES},
    // Same reasoning as the permission switches: on by default, because the
    // OS grant is the real gate and a notification the user never asked to
    // silence is the behaviour they expect.
    notificationsEnabled: true,
    notifications: {...DEFAULT_NOTIFICATION_SWITCHES},
    // On by default for the same reason as the switches it covers: the OS
    // grant is the real gate, and a skill installed to do a job should be able
    // to ask for what that job needs.
    appPermissionsEnabled: true,
    pinnedViews: [],
    location: null,
  };
  if (!value || typeof value !== "object" || Array.isArray(value))
    return defaults;
  const record = value as Record<string, unknown>;
  return {
    theme:
      record.theme === "light" || record.theme === "dark" || record.theme === "system"
        ? record.theme
        : defaults.theme,
    language: supportedLanguage(record.language) ?? defaults.language,
    currency: supportedCurrency(record.currency),
    advancedMode:
      typeof record.advancedMode === "boolean"
        ? record.advancedMode
        : defaults.advancedMode,
    speechModeEnabled:
      typeof record.speechModeEnabled === "boolean"
        ? record.speechModeEnabled
        : defaults.speechModeEnabled,
    dictationAutoStopSeconds:
      record.dictationAutoStopSeconds === null
        ? null
        : (autoStopSeconds(record.dictationAutoStopSeconds) ??
          defaults.dictationAutoStopSeconds),
    timeEnabled:
      typeof record.timeEnabled === "boolean"
        ? record.timeEnabled
        : defaults.timeEnabled,
    locationEnabled:
      typeof record.locationEnabled === "boolean"
        ? record.locationEnabled
        : defaults.locationEnabled,
    hubIncognitoMode:
      typeof record.hubIncognitoMode === "boolean"
        ? record.hubIncognitoMode
        : defaults.hubIncognitoMode,
    onboardingCompleted:
      typeof record.onboardingCompleted === "boolean"
        ? record.onboardingCompleted
        : defaults.onboardingCompleted,
    // `thinkingLevel` is the pre-rename key: settings written before the
    // rename still carry it, so an existing choice is not reset to the default.
    reasoningLevel:
      reasoningEffort(
        record.reasoningLevel ?? record.thinkingLevel,
        defaults.reasoningLevel,
      ) ?? defaults.reasoningLevel,
    permissions: permissionSwitches(record.permissions, defaults.permissions),
    notificationsEnabled:
      typeof record.notificationsEnabled === "boolean"
        ? record.notificationsEnabled
        : defaults.notificationsEnabled,
    notifications: notificationSwitches(record.notifications, defaults.notifications),
    appPermissionsEnabled:
      typeof record.appPermissionsEnabled === "boolean"
        ? record.appPermissionsEnabled
        : defaults.appPermissionsEnabled,
    pinnedViews: pinnedViewsPreference(record.pinnedViews),
    location: locationPreference(record.location),
  };
}


export function generalSettingsUpdate(
  value: unknown,
  current: GeneralSettingsDto,
): GeneralSettingsDto {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("General settings must be an object");
  const record = value as Record<string, unknown>;
  if (
    record.theme !== undefined &&
    record.theme !== "light" &&
    record.theme !== "dark" &&
    record.theme !== "system"
  )
    throw new Error("theme must be light, dark, or system");
  if (record.language !== undefined && !supportedLanguage(record.language))
    throw new Error(
      `language must be one of: ${SUPPORTED_LANGUAGES.map((item) => item.value).join(", ")}`,
    );
  if (record.currency !== undefined && record.currency !== null && !supportedCurrency(record.currency))
    throw new Error("currency must be USD, AUD, EUR, GBP, SGD, or JPY");
  if (
    record.notificationsEnabled !== undefined &&
    typeof record.notificationsEnabled !== "boolean"
  )
    throw new Error("notificationsEnabled must be a boolean");
  if (record.timeEnabled !== undefined && typeof record.timeEnabled !== "boolean")
    throw new Error("timeEnabled must be a boolean");
  if (
    record.onboardingCompleted !== undefined &&
    typeof record.onboardingCompleted !== "boolean"
  )
    throw new Error("onboardingCompleted must be a boolean");
  if (record.advancedMode !== undefined && typeof record.advancedMode !== "boolean")
    throw new Error("advancedMode must be a boolean");
  if (
    record.speechModeEnabled !== undefined &&
    typeof record.speechModeEnabled !== "boolean"
  )
    throw new Error("speechModeEnabled must be a boolean");
  if (
    record.dictationAutoStopSeconds !== undefined &&
    record.dictationAutoStopSeconds !== null &&
    !autoStopSeconds(record.dictationAutoStopSeconds)
  )
    throw new Error(
      `dictationAutoStopSeconds must be null or a whole number of seconds between ${AUTO_STOP_MIN_SECONDS} and ${AUTO_STOP_MAX_SECONDS}`,
    );
  if (
    record.locationEnabled !== undefined &&
    typeof record.locationEnabled !== "boolean"
  )
    throw new Error("locationEnabled must be a boolean");
  if (
    record.hubIncognitoMode !== undefined &&
    typeof record.hubIncognitoMode !== "boolean"
  )
    throw new Error("hubIncognitoMode must be a boolean");
  if (
    record.reasoningLevel !== undefined &&
    !reasoningEffort(record.reasoningLevel, null)
  )
    throw new Error("reasoningLevel must be a supported reasoning effort");
  if (record.pinnedViews !== undefined && !validPinnedViews(record.pinnedViews))
    throw new Error("pinnedViews must be an array of drive, schedule, hub, or tasks");
  const locationEnabled =
    typeof record.locationEnabled === "boolean"
      ? record.locationEnabled
      : current.locationEnabled;
  const location =
    record.location === undefined
      ? current.location
      : record.location === null
        ? null
        : requiredLocation(record.location);
  const onboardingCompleted =
    typeof record.onboardingCompleted === "boolean"
      ? record.onboardingCompleted
      : current.onboardingCompleted;
  return {
    onboardingCompleted,
    // A partial update patches the map rather than replacing it, so a row can
    // send only the switch the user just moved.
    permissions: permissionSwitchesUpdate(record.permissions, current.permissions),
    // The master switch and the per-kind map move independently: silencing
    // everything must not forget which kinds were chosen underneath.
    notificationsEnabled:
      typeof record.notificationsEnabled === "boolean"
        ? record.notificationsEnabled
        : current.notificationsEnabled,
    notifications: notificationSwitchesUpdate(record.notifications, current.notifications),
    appPermissionsEnabled:
      typeof record.appPermissionsEnabled === "boolean"
        ? record.appPermissionsEnabled
        : current.appPermissionsEnabled,
    theme:
      record.theme === "light" || record.theme === "dark" || record.theme === "system"
        ? record.theme
        : current.theme,
    language: supportedLanguage(record.language) ?? current.language,
    currency:
      record.currency === undefined
        ? current.currency
        : record.currency === null
          ? null
          : supportedCurrency(record.currency),
    advancedMode:
      typeof record.advancedMode === "boolean"
        ? record.advancedMode
        : current.advancedMode,
    speechModeEnabled:
      typeof record.speechModeEnabled === "boolean"
        ? record.speechModeEnabled
        : current.speechModeEnabled,
    dictationAutoStopSeconds:
      record.dictationAutoStopSeconds === undefined
        ? current.dictationAutoStopSeconds
        : record.dictationAutoStopSeconds === null
          ? null
          : (autoStopSeconds(record.dictationAutoStopSeconds) as number),
    timeEnabled:
      typeof record.timeEnabled === "boolean"
        ? record.timeEnabled
        : current.timeEnabled,
    locationEnabled,
    hubIncognitoMode:
      typeof record.hubIncognitoMode === "boolean"
        ? record.hubIncognitoMode
        : current.hubIncognitoMode,
    location: locationEnabled ? location : null,
    reasoningLevel:
      record.reasoningLevel === undefined
        ? current.reasoningLevel
        : (reasoningEffort(record.reasoningLevel, current.reasoningLevel) as ReasoningEffort),
    pinnedViews:
      Array.isArray(record.pinnedViews)
        ? validPinnedViews(record.pinnedViews) as GeneralSettingsDto['pinnedViews']
        : current.pinnedViews,
  };
}

export const REASONING_EFFORTS: ReasoningEffort[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/** Returns the value when it names a supported effort, otherwise the fallback.
 * The fallback may be null when the caller needs to know whether a raw value
 * was accepted at all (update validation). */

export function reasoningEffort(
  value: unknown,
  fallback: ReasoningEffort | null,
): ReasoningEffort | null {
  return typeof value === "string" &&
    REASONING_EFFORTS.includes(value as ReasoningEffort)
    ? (value as ReasoningEffort)
    : fallback;
}

export const AUTO_STOP_MIN_SECONDS = 2;

export const AUTO_STOP_MAX_SECONDS = 60;

/** Returns the value when it is a usable silence window, otherwise null. Null
 * doubles as "never stop on its own", so callers separate that case out before
 * asking. */

export function autoStopSeconds(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= AUTO_STOP_MIN_SECONDS &&
    value <= AUTO_STOP_MAX_SECONDS
    ? value
    : null;
}

export function supportedCurrency(
  value: unknown,
): Exclude<GeneralSettingsDto["currency"], null> | null {
  return value === "USD" || value === "AUD" || value === "EUR" ||
    value === "GBP" || value === "SGD" || value === "JPY"
    ? value
    : null;
}

export function locationPreference(value: unknown): GeneralSettingsDto["location"] {
  try {
    return value === null || value === undefined ? null : requiredLocation(value);
  } catch {
    return null;
  }
}

export function requiredLocation(value: unknown): NonNullable<GeneralSettingsDto["location"]> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("location must be an object or null");
  const record = value as Record<string, unknown>;
  const latitude = Number(record.latitude);
  const longitude = Number(record.longitude);
  const accuracy = Number(record.accuracy);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)
    throw new Error("location latitude is invalid");
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)
    throw new Error("location longitude is invalid");
  if (!Number.isFinite(accuracy) || accuracy < 0)
    throw new Error("location accuracy is invalid");
  if (typeof record.updatedAt !== "string" || !Number.isFinite(Date.parse(record.updatedAt)))
    throw new Error("location updatedAt is invalid");
  return { latitude, longitude, accuracy, updatedAt: record.updatedAt };
}

const PINNABLE_VIEWS = new Set(['drive', 'schedule', 'hub', 'tasks']);

function validPinnedViews(value: unknown): string[] | false {
  if (!Array.isArray(value)) return false;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !PINNABLE_VIEWS.has(item) || seen.has(item)) return false;
    seen.add(item);
    result.push(item);
  }
  return result;
}

function pinnedViewsPreference(value: unknown): GeneralSettingsDto['pinnedViews'] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is 'drive' | 'schedule' | 'hub' | 'tasks' =>
      typeof item === 'string' && PINNABLE_VIEWS.has(item),
  ).filter((item, i, arr) => arr.indexOf(item) === i);
}

/**
 * Stored browser settings. The download directory defaults to the OS one, and
 * a stored path is taken as written: a folder the user picked and later moved
 * is recreated on next use rather than silently swapped back to the default,
 * which would put files somewhere they are not looking for them.
 */
export function browserSettingsPreference(value: unknown): BrowserSettingsDto {
  const defaults: BrowserSettingsDto = {
    downloadDirectory: app.getPath("downloads"),
    askWhereToSave: false,
    autofillEnabled: true,
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaults;
  const record = value as Record<string, unknown>;
  return {
    downloadDirectory:
      typeof record.downloadDirectory === "string" && record.downloadDirectory.trim()
        ? record.downloadDirectory
        : defaults.downloadDirectory,
    askWhereToSave:
      typeof record.askWhereToSave === "boolean"
        ? record.askWhereToSave
        : defaults.askWhereToSave,
    autofillEnabled:
      typeof record.autofillEnabled === "boolean"
        ? record.autofillEnabled
        : defaults.autofillEnabled,
  };
}

/** Folds a partial update onto current settings; `undefined` means unchanged. */
export function browserSettingsUpdate(
  patch: {
    downloadDirectory?: string | null;
    askWhereToSave?: boolean;
    autofillEnabled?: boolean;
  },
  current: BrowserSettingsDto,
  chosenDirectory: string | null,
): BrowserSettingsDto {
  return {
    // A null directory in the patch asked for the picker. If the user cancelled
    // it, `chosenDirectory` is null too and the current one stands.
    downloadDirectory:
      patch.downloadDirectory === null
        ? (chosenDirectory ?? current.downloadDirectory)
        : (patch.downloadDirectory ?? current.downloadDirectory),
    askWhereToSave: patch.askWhereToSave ?? current.askWhereToSave,
    autofillEnabled: patch.autofillEnabled ?? current.autofillEnabled,
  };
}
