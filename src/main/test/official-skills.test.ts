import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { installOfficialSkills, officialSkillsHome } from "../official-skills.js";

function bundle(): {source: string; home: string} {
  const root = mkdtempSync(path.join(tmpdir(), "flareai-official-skills-"));
  const source = path.join(root, "bundle");
  mkdirSync(path.join(source, "gui-control", "scripts"), {recursive: true});
  writeFileSync(path.join(source, "gui-control", "SKILL.md"), "---\nname: gui-control\n---\n");
  const script = path.join(source, "gui-control", "scripts", "run.sh");
  writeFileSync(script, "#!/bin/zsh\n");
  chmodSync(script, 0o755);
  return {source, home: path.join(root, "home")};
}

test("mirrors the bundled skills into ~/.flareai, executable bits intact", () => {
  const {source, home} = bundle();
  const target = installOfficialSkills(source, home);
  assert.equal(target, officialSkillsHome(home));
  assert.equal(target, path.join(home, ".flareai", "official-skills"));
  assert.match(readFileSync(path.join(target, "gui-control", "SKILL.md"), "utf8"), /name: gui-control/);
  assert.equal(statSync(path.join(target, "gui-control", "scripts", "run.sh")).mode & 0o111, 0o111);
});

test("rewrites the mirror when the bundle changes and leaves it alone when it has not", () => {
  const {source, home} = bundle();
  const target = installOfficialSkills(source, home);
  const stamp = statSync(path.join(target, "gui-control", "SKILL.md")).mtimeMs;

  // A second launch against an unchanged bundle must not touch the files.
  installOfficialSkills(source, home);
  assert.equal(statSync(path.join(target, "gui-control", "SKILL.md")).mtimeMs, stamp);

  writeFileSync(path.join(source, "gui-control", "SKILL.md"), "---\nname: gui-control\n---\nnew\n");
  installOfficialSkills(source, home);
  assert.match(readFileSync(path.join(target, "gui-control", "SKILL.md"), "utf8"), /new/);
});

test("a mode change alone still republishes, so a script cannot lose its bit", () => {
  const {source, home} = bundle();
  const target = installOfficialSkills(source, home);
  chmodSync(path.join(target, "gui-control", "scripts", "run.sh"), 0o644);
  chmodSync(path.join(source, "gui-control", "scripts", "run.sh"), 0o700);
  installOfficialSkills(source, home);
  assert.equal(statSync(path.join(target, "gui-control", "scripts", "run.sh")).mode & 0o111, 0o100);
});

test("a missing bundle leaves any existing mirror in place", () => {
  const {source, home} = bundle();
  const target = installOfficialSkills(source, home);
  assert.equal(installOfficialSkills(path.join(source, "absent"), home), target);
  assert.match(readFileSync(path.join(target, "gui-control", "SKILL.md"), "utf8"), /name: gui-control/);
});
