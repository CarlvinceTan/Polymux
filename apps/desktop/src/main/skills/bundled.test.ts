import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { SkillLoader } from "@flareai/agent";
import { coreSkillNames } from "./official.js";

const TIERS = ["core", "official"] as const;
const bundled = (tier: string): string =>
  path.join(process.cwd(), "resources", "skills", tier);

/**
 * The bundled set is only ever read through the mirror, so it is loaded the way
 * the app loads it — both tiers merged flat — rather than by walking the source
 * tree. A skill whose frontmatter or `flare.yaml` is malformed ships silently
 * otherwise: it simply stops appearing.
 */
function loadMirror() {
  const home = mkdtempSync(path.join(tmpdir(), "flareai-bundled-"));
  const mirror = path.join(home, ".flareai", "official-skills");
  mkdirSync(mirror, { recursive: true });
  for (const tier of TIERS) cpSync(bundled(tier), mirror, { recursive: true });
  const loaded = new SkillLoader({ home, official: [mirror] }).load();
  rmSync(home, { recursive: true, force: true });
  return loaded;
}

test("every bundled skill loads, with no duplicate or malformed one", () => {
  const loaded = loadMirror();
  assert.deepEqual(
    loaded.diagnostics.filter((d) => d.severity === "error"),
    [],
  );
  const names = loaded.skills.map((skill) => skill.name).sort();
  assert.equal(new Set(names).size, names.length, "a name is claimed twice");
  // Both tiers arrive: a mirror that copied only one still loads cleanly.
  assert.ok(names.includes("email-use"), "core tier is present");
  assert.ok(names.includes("pdf"), "official tier is present");
});

test("a skill's name matches the folder it ships in", () => {
  const loaded = loadMirror();
  const folders = new Set(TIERS.flatMap((tier) => coreSkillNames(bundled(tier))));
  for (const skill of loaded.skills)
    assert.ok(
      folders.has(skill.name),
      `${skill.name} does not match its folder; a rename left one of the two behind`,
    );
});

test("core membership is the core folder, so the Skills tab hides exactly those", () => {
  // Read from disk rather than listed here: moving a folder is meant to be the
  // whole of changing a skill's tier.
  const core = coreSkillNames(bundled("core"));
  assert.deepEqual(
    [...core].sort(),
    [
      "browser-use",
      "computer-history",
      "computer-use",
      "email-use",
      "message-use",
      "skill-creator",
      "skill-maintenance",
      "skill-record",
    ],
  );
});
