import assert from "node:assert/strict";
import test from "node:test";
import type {GeneralSettingsDto} from "@polymux/protocol";
import {generalSettingsStorage} from "./general-settings-storage.js";

test("general settings storage keeps pinned views and every other field", () => {
  const settings: GeneralSettingsDto = {
    theme: "dark",
    language: "system",
    currency: "SGD",
    speechModeEnabled: true,
    dictationAutoStopSeconds: 8,
    timeEnabled: false,
    locationEnabled: true,
    hubIncognitoMode: true,
    reasoningLevel: "high",
    advancedMode: true,
    onboardingCompleted: true,
    permissions: {
      microphone: true,
      "screen-recording": true,
      accessibility: true,
      "full-disk-access": true,
      reminders: true,
      calendars: true,
      contacts: true,
      photos: true,
      automation: true,
    },
    notificationsEnabled: true,
    notifications: {
      "schedule-completed": true,
      "schedule-failed": false,
      "agent-completed": true,
      "agent-attention": false,
      "message-received": true,
    },
    appPermissionsEnabled: false,
    pinnedViews: ["drive", "calendar", "tasks"],
    location: {
      latitude: 1.3521,
      longitude: 103.8198,
      accuracy: 25,
      updatedAt: "2026-08-27T15:00:00.000Z",
    },
  };

  const stored = generalSettingsStorage(settings);
  assert.deepEqual(stored, settings);
  assert.notEqual(stored, settings);
});
