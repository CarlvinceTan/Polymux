import type {GeneralSettingsDto, JsonValue} from "@polymux/protocol";

/**
 * The whole general-settings DTO is JSON-safe. Keep one complete storage seam
 * so adding a setting cannot make one of the backend's manual writers silently
 * drop it on the next read.
 */
export function generalSettingsStorage(settings: GeneralSettingsDto): JsonValue {
  return structuredClone(settings) as unknown as JsonValue;
}
