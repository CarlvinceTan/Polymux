import {clearFaviconCache} from "../browser/favicon.js";
import {SUPPORTED_LANGUAGES, supportedLanguage} from "@flareai/protocol";
import type {GeneralSettingsDto, ReasoningEffort} from "@flareai/protocol";
import {app, nativeTheme} from "electron";
import {rename} from "node:fs/promises";
import {parse as parseToml} from "smol-toml";
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
    speechModeEnabled: true,
    dictationAutoStopSeconds: 6,
    timeEnabled: true,
    locationEnabled: true,
    reasoningLevel: "medium",
    onboardingCompleted: false,
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
  if (record.timeEnabled !== undefined && typeof record.timeEnabled !== "boolean")
    throw new Error("timeEnabled must be a boolean");
  if (
    record.onboardingCompleted !== undefined &&
    typeof record.onboardingCompleted !== "boolean"
  )
    throw new Error("onboardingCompleted must be a boolean");
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
    record.reasoningLevel !== undefined &&
    !reasoningEffort(record.reasoningLevel, null)
  )
    throw new Error("reasoningLevel must be a supported reasoning effort");
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
    location: locationEnabled ? location : null,
    reasoningLevel:
      record.reasoningLevel === undefined
        ? current.reasoningLevel
        : (reasoningEffort(record.reasoningLevel, current.reasoningLevel) as ReasoningEffort),
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
