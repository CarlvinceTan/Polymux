import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { discoverAgentSkills, resolveDiscoveredSkill } from "./discovery.js";

function home(): string {
  return mkdtempSync(path.join(tmpdir(), "polymux-skill-discovery-"));
}

function skill(directory: string, name: string): void {
  mkdirSync(directory, {recursive: true});
  writeFileSync(
    path.join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: What ${name} is for.\n---\n\nBody.\n`,
  );
}

test("groups what it finds by the agent whose directory it sits in", () => {
  const root = home();
  skill(path.join(root, ".claude", "skills", "commit-writer"), "commit-writer");
  skill(path.join(root, ".codex", "skills", "repo-map"), "repo-map");

  const groups = discoverAgentSkills(new Set(), root);
  assert.deepEqual(groups.map((group) => group.label), ["Claude", "Codex"]);
  assert.equal(groups[0]!.directory, path.join("~", ".claude", "skills"));
  assert.deepEqual(groups[0]!.skills, [{
    name: "commit-writer",
    description: "What commit-writer is for.",
    path: path.join("~", ".claude", "skills", "commit-writer"),
    state: "available",
  }]);
});

test("finds the other agents people run, Hermes and Pi among them", () => {
  const root = home();
  skill(path.join(root, ".hermes", "skills", "inbox-triage"), "inbox-triage");
  skill(path.join(root, ".pi", "skills", "site-check"), "site-check");
  skill(path.join(root, ".cursor", "skills", "review"), "review");
  assert.deepEqual(
    discoverAgentSkills(new Set(), root).map((group) => group.label),
    ["Hermes", "Pi", "Cursor"],
  );
});

test("the Agent Client Protocol registry's agents are titled the way the registry writes them", () => {
  const root = home();
  // Including the ones whose directory is not the name anyone would guess.
  for (const [directory, expected] of [
    ["droid", "Factory Droid"],
    ["vibe", "Mistral Vibe"],
    ["auggie", "Auggie CLI"],
    ["sigit", "siGit Code"],
    ["crow", "crow-cli"],
    ["qwen", "Qwen Code"],
    ["vtcode", "VT Code"],
    ["glm", "GLM Agent"],
  ] as const) {
    skill(path.join(root, `.${directory}`, "skills", `${directory}-skill`), `${directory}-skill`);
    const group = discoverAgentSkills(new Set(), root).find((item) => item.id === directory);
    assert.equal(group?.label, expected);
  }
});

test("an agent nobody has named yet is still found, with its name read off the directory", () => {
  const root = home();
  skill(path.join(root, ".open-interpreter", "skills", "plot"), "plot");
  const [group] = discoverAgentSkills(new Set(), root);
  assert.equal(group!.label, "Open Interpreter");
  assert.equal(group!.directory, path.join("~", ".open-interpreter", "skills"));
});

test("known agents lead, whatever else the machine has collected follows", () => {
  const root = home();
  skill(path.join(root, ".aardvark", "skills", "dig"), "dig");
  skill(path.join(root, ".claude", "skills", "commit-writer"), "commit-writer");
  assert.deepEqual(
    discoverAgentSkills(new Set(), root).map((group) => group.label),
    ["Claude", "Aardvark"],
  );
});

test("reads the XDG layout too, and the singular skill folder", () => {
  const root = home();
  skill(path.join(root, ".config", "goose", "skills", "deploy"), "deploy");
  skill(path.join(root, ".opencode", "skill", "explain"), "explain");
  assert.deepEqual(
    discoverAgentSkills(new Set(), root).map((group) => [group.label, group.directory]),
    [
      ["OpenCode", path.join("~", ".opencode", "skill")],
      ["goose", path.join("~", ".config", "goose", "skills")],
    ],
  );
});

test("Polymux's own directories are not offered back to it", () => {
  const root = home();
  skill(path.join(root, ".polymux", "skills", "personal-research"), "personal-research");
  assert.deepEqual(discoverAgentSkills(new Set(), root), []);
});

test("a directory Polymux already sources reads as in use, not as something to add", () => {
  const root = home();
  skill(path.join(root, ".agents", "skills", "find-skills"), "find-skills");
  const [shared] = discoverAgentSkills(new Set(), root);
  assert.equal(shared!.label, "Shared skills");
  assert.equal(shared!.skills[0]!.state, "loaded");
});

test("a skill Polymux has under that name is not offered again", () => {
  const root = home();
  skill(path.join(root, ".claude", "skills", "pdf"), "pdf");
  const [claude] = discoverAgentSkills(new Set(["pdf"]), root);
  assert.equal(claude!.skills[0]!.state, "loaded");
});

test("empty and absent directories are left out rather than listed bare", () => {
  const root = home();
  mkdirSync(path.join(root, ".cursor", "skills"), {recursive: true});
  assert.deepEqual(discoverAgentSkills(new Set(), root), []);
});

test("only paths inside a scanned directory resolve back to disk", () => {
  const root = home();
  skill(path.join(root, ".claude", "skills", "commit-writer"), "commit-writer");
  assert.equal(
    resolveDiscoveredSkill(path.join("~", ".claude", "skills", "commit-writer"), root),
    path.join(root, ".claude", "skills", "commit-writer"),
  );
  // The displayed path makes a round trip through the window, so a rewritten
  // one must not turn into a copy of an arbitrary directory.
  assert.throws(() => resolveDiscoveredSkill("~/.ssh", root), /not in a directory/);
  assert.throws(() => resolveDiscoveredSkill("/etc", root), /not in a directory/);
  assert.throws(
    () => resolveDiscoveredSkill(path.join("~", ".claude", "skills", "..", "..", ".ssh"), root),
    /not in a directory/,
  );
});
