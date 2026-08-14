import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSkillPackage } from "../skill-registry.js";

test("parses owner/repo and owner/repo/skill package specs", () => {
  assert.deepEqual(parseSkillPackage("vercel-labs/skills"), {
    owner: "vercel-labs",
    repo: "skills",
    subpath: undefined,
  });
  assert.deepEqual(parseSkillPackage("vercel-labs/skills/find-skills"), {
    owner: "vercel-labs",
    repo: "skills",
    subpath: "find-skills",
  });
  assert.deepEqual(parseSkillPackage(" vercel-labs/skills/skills/find-skills/ "), {
    owner: "vercel-labs",
    repo: "skills",
    subpath: "skills/find-skills",
  });
});

test("parses skills.sh and github.com URLs including deep links", () => {
  assert.deepEqual(parseSkillPackage("https://skills.sh/vercel-labs/skills/find-skills"), {
    owner: "vercel-labs",
    repo: "skills",
    subpath: "find-skills",
  });
  assert.deepEqual(parseSkillPackage("https://github.com/vercel-labs/skills"), {
    owner: "vercel-labs",
    repo: "skills",
    subpath: undefined,
  });
  assert.deepEqual(
    parseSkillPackage("https://github.com/vercel-labs/skills/tree/main/skills/find-skills"),
    { owner: "vercel-labs", repo: "skills", subpath: "skills/find-skills" },
  );
  assert.deepEqual(
    parseSkillPackage("https://github.com/vercel-labs/skills/blob/main/skills/find-skills/SKILL.md"),
    { owner: "vercel-labs", repo: "skills", subpath: "skills/find-skills" },
  );
});

test("rejects specs that cannot name a GitHub package", () => {
  assert.throws(() => parseSkillPackage(""));
  assert.throws(() => parseSkillPackage("just-a-name"));
  assert.throws(() => parseSkillPackage("https://example.com/owner/repo"));
  assert.throws(() => parseSkillPackage("owner//repo"));
});
