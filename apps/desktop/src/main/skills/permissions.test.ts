import assert from "node:assert/strict";
import { test } from "node:test";
import type { Skill } from "@flareai/agent";
import type { AppPermissionKind, GeneralSettingsDto, SystemPermissionStatus } from "@flareai/protocol";
import { DEFAULT_PERMISSION_SWITCHES } from "../backend/permission-settings.js";
import { declaredPermissions, permissionsToRequest } from "./permissions.js";

function skill(permissions?: string[]): Skill {
  return {
    name: "apple-reminders",
    description: "Manage reminders.",
    filePath: "/skills/apple-reminders/SKILL.md",
    baseDir: "/skills/apple-reminders",
    source: "official",
    disableModelInvocation: false,
    permissions,
  };
}

function settings(
  overrides: Partial<Pick<GeneralSettingsDto, "appPermissionsEnabled" | "permissions">> = {},
): Pick<GeneralSettingsDto, "appPermissionsEnabled" | "permissions"> {
  return {
    appPermissionsEnabled: true,
    permissions: {...DEFAULT_PERMISSION_SWITCHES},
    ...overrides,
  };
}

const undecided = () => "not-determined" as SystemPermissionStatus;

test("reads the grants a skill declares, however it spelled them", () => {
  assert.deepEqual(declaredPermissions(skill(["reminders"])), ["reminders"]);
  assert.deepEqual(declaredPermissions(skill(["Reminders", " calendars "])), [
    "reminders",
    "calendars",
  ]);
  assert.deepEqual(declaredPermissions(skill(["reminders", "reminders"])), ["reminders"]);
});

test("drops names this build has never heard of rather than refusing the skill", () => {
  assert.deepEqual(declaredPermissions(skill(["reminders", "telepathy"])), ["reminders"]);
  assert.deepEqual(declaredPermissions(skill()), []);
});

test("asks only for grants macOS has not already decided", () => {
  const decided: Record<string, SystemPermissionStatus> = {
    reminders: "granted",
    calendars: "denied",
    contacts: "not-determined",
  };
  const need = permissionsToRequest(
    ["reminders", "calendars", "contacts"],
    settings(),
    (kind) => decided[kind] ?? "unknown",
  );
  assert.deepEqual(need.kinds, ["contacts"]);
  assert.equal(need.switchedOff, false);
});

test("the master switch stops every request without touching a grant", () => {
  const need = permissionsToRequest(
    ["reminders"],
    settings({appPermissionsEnabled: false}),
    undecided,
  );
  assert.deepEqual(need.kinds, []);
  assert.equal(need.switchedOff, true);
});

test("a single switched-off grant is skipped, and says so", () => {
  const permissions = {...DEFAULT_PERMISSION_SWITCHES, reminders: false};
  const need = permissionsToRequest(
    ["reminders", "calendars"] as AppPermissionKind[],
    settings({permissions}),
    undecided,
  );
  assert.deepEqual(need.kinds, ["calendars"]);
  assert.equal(need.switchedOff, true);
});
