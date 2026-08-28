import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SkillLoader, parseSkillCommand } from "../src/index.js";

test("discovers Pi-compatible global skills with progressive metadata", async () => {
  const home = await mkdtemp(join(tmpdir(), "polymux-skills-"));
  try {
    const directory = join(home, ".polymux", "skills", "pdf-tools");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "SKILL.md"),
      "---\nname: pdf-tools\ndescription: Work with PDF files.\n---\n\n# Instructions",
    );
    await writeFile(
      join(directory, "polymux.yaml"),
      'display_name: "PDF Tools"\n',
    );
    const loaded = new SkillLoader({ home }).load();
    assert.equal(loaded.skills[0]?.name, "pdf-tools");
    assert.equal(loaded.skills[0]?.description, "Work with PDF files.");
    assert.equal(loaded.skills[0]?.displayName, "PDF Tools");
    assert.equal(
      parseSkillCommand("/skill:pdf-tools extract", loaded.skills)?.arguments,
      "extract",
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("sources the cross-agent ~/.agents store but not agent-specific ones", async () => {
  const home = await mkdtemp(join(tmpdir(), "polymux-agents-skills-"));
  try {
    await mkdir(join(home, ".agents", "skills", "react-best-practices"), {recursive: true});
    await writeFile(
      join(home, ".agents", "skills", "react-best-practices", "SKILL.md"),
      "---\nname: react-best-practices\ndescription: React guidance.\n---\n",
    );
    await mkdir(join(home, ".codex", "skills", "personal-research"), {recursive: true});
    await writeFile(
      join(home, ".codex", "skills", "personal-research", "SKILL.md"),
      "---\nname: personal-research\ndescription: Personal research workflow.\n---\n",
    );

    const loaded = new SkillLoader({home}).load();
    assert.deepEqual(loaded.skills.map((skill) => `${skill.name}:${skill.source}`), ["react-best-practices:agents"]);
  } finally {
    await rm(home, {recursive: true, force: true});
  }
});

test("can inspect a configured skill directory without mixing in user skills", async () => {
  const root = await mkdtemp(join(tmpdir(), "polymux-configured-skill-"));
  const home = join(root, "home");
  const configured = join(root, "configured");
  try {
    await mkdir(join(home, ".agents", "skills", "shared"), {recursive: true});
    await writeFile(
      join(home, ".agents", "skills", "shared", "SKILL.md"),
      "---\nname: shared\ndescription: Shared workflow.\n---\n",
    );
    await mkdir(join(configured, "focused"), {recursive: true});
    await writeFile(
      join(configured, "focused", "SKILL.md"),
      "---\nname: focused\ndescription: Focused workflow.\n---\n",
    );

    const loaded = new SkillLoader({
      home,
      configured: [configured],
      includeUserLocations: false,
    }).load();
    assert.deepEqual(
      loaded.skills.map((skill) => `${skill.name}:${skill.source}`),
      ["focused:configured"],
    );
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("configured skills cannot escape their root or recurse through symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "polymux-confined-skills-"));
  const configured = join(root, "configured");
  const outside = join(root, "outside");
  try {
    await mkdir(join(configured, "file-link"), { recursive: true });
    await mkdir(join(configured, "safe"), { recursive: true });
    await mkdir(join(outside, "external"), { recursive: true });
    await writeFile(
      join(outside, "external", "SKILL.md"),
      "---\nname: escaped\ndescription: Must stay outside.\n---\n",
    );
    await writeFile(
      join(configured, "safe", "SKILL.md"),
      "---\nname: safe\ndescription: Stays inside.\n---\n",
    );
    await writeFile(
      join(outside, "polymux.yaml"),
      'display_name: "Escaped metadata"\n',
    );
    await symlink(join(outside, "external"), join(configured, "directory-link"));
    await symlink(
      join(outside, "external", "SKILL.md"),
      join(configured, "file-link", "SKILL.md"),
    );
    await symlink(
      join(outside, "polymux.yaml"),
      join(configured, "safe", "polymux.yaml"),
    );
    await symlink(configured, join(configured, "recursive-link"));

    const loaded = new SkillLoader({
      configured: [configured],
      includeUserLocations: false,
    }).load();
    assert.deepEqual(
      loaded.skills.map((skill) => ({
        name: skill.name,
        displayName: skill.displayName,
      })),
      [{ name: "safe", displayName: undefined }],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("excludes skills disabled by the host application", async () => {
  const home = await mkdtemp(join(tmpdir(), "polymux-disabled-skill-"));
  try {
    const directory = join(home, ".polymux", "skills", "optional-skill");
    await mkdir(directory, {recursive: true});
    await writeFile(join(directory, "SKILL.md"), "---\nname: optional-skill\ndescription: Optional workflow.\n---\n");
    const loaded = new SkillLoader({home, isEnabled: (skill) => skill.name !== "optional-skill"}).load();
    assert.equal(loaded.skills.length, 0);
  } finally {
    await rm(home, {recursive: true, force: true});
  }
});

test("warns about invalid names and refuses skills without descriptions", async () => {
  const home = await mkdtemp(join(tmpdir(), "polymux-skills-"));
  try {
    const directory = join(home, ".polymux", "skills", "Bad Name");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "SKILL.md"),
      "---\nname: Bad Name\n---\nMissing description",
    );
    const loaded = new SkillLoader({ home }).load();
    assert.equal(loaded.skills.length, 0);
    assert.ok(loaded.diagnostics.some((item) => item.severity === "error"));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("official skills ship with the app and shadow same-named user skills", async () => {
  const root = await mkdtemp(join(tmpdir(), "polymux-official-skills-"));
  const home = join(root, "home");
  const official = join(root, "official");
  try {
    await mkdir(join(official, "browser"), { recursive: true });
    await writeFile(
      join(official, "browser", "SKILL.md"),
      "---\nname: browser\ndescription: Official browser workflow.\n---\n",
    );
    await mkdir(join(home, ".polymux", "skills", "browser"), {
      recursive: true,
    });
    await writeFile(
      join(home, ".polymux", "skills", "browser", "SKILL.md"),
      "---\nname: browser\ndescription: User browser workflow.\n---\n",
    );

    const loaded = new SkillLoader({ home, official: [official] }).load();
    const matches = loaded.skills.filter((skill) => skill.name === "browser");
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.source, "official");
    assert.equal(matches[0]?.description, "Official browser workflow.");
    assert.ok(
      loaded.diagnostics.some((item) =>
        item.message.includes("Duplicate skill browser; official skill wins"),
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("surfaces manifest and frontmatter metadata for the skill catalogue", async () => {
  const home = await mkdtemp(join(tmpdir(), "polymux-skill-metadata-"));
  try {
    const directory = join(home, ".polymux", "skills", "hub-use");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "SKILL.md"),
      "---\nname: hub-use\ndescription: Handle email.\nauthor: Polymux\ncategory: Communication\n---\n",
    );
    await writeFile(
      join(directory, "polymux.yaml"),
      'display_name: "Hub"\n',
    );
    const loaded = new SkillLoader({ home }).load();
    const skill = loaded.skills[0];
    assert.equal(skill?.displayName, "Hub");
    assert.equal(skill?.author, "Polymux");
    assert.equal(skill?.category, "Communication");
    assert.ok(skill?.updatedAt && !Number.isNaN(Date.parse(skill.updatedAt)));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
