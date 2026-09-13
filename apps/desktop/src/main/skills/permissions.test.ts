import assert from "node:assert/strict";
import { test } from "node:test";
import type { Skill } from "@polymux/agent";
import { declaredPermissions } from "./permissions.js";

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
