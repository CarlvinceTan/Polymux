import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SkillLoader, parseSkillCommand } from "../src/index.js";

test("discovers Pi-compatible global skills with progressive metadata", async () => {
  const home = await mkdtemp(join(tmpdir(), "midas-skills-"));
  try {
    const directory = join(home, ".midas", "skills", "pdf-tools");
    await mkdir(join(directory, "agents"), { recursive: true });
    await mkdir(join(directory, "assets"), { recursive: true });
    await writeFile(
      join(directory, "SKILL.md"),
      "---\nname: pdf-tools\ndescription: Work with PDF files.\n---\n\n# Instructions",
    );
    await writeFile(
      join(directory, "agents", "openai.yaml"),
      'interface:\n  icon_small: "./assets/icon.svg"\n',
    );
    await writeFile(join(directory, "assets", "icon.svg"), "<svg></svg>");
    const loaded = new SkillLoader({ home }).load();
    assert.equal(loaded.skills[0]?.name, "pdf-tools");
    assert.equal(loaded.skills[0]?.description, "Work with PDF files.");
    assert.equal(loaded.skills[0]?.iconPath, join(directory, "assets", "icon.svg"));
    assert.equal(
      parseSkillCommand("/skill:pdf-tools extract", loaded.skills)?.arguments,
      "extract",
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("loads personal Codex skills as a distinct user source", async () => {
  const home = await mkdtemp(join(tmpdir(), "midas-codex-skills-"));
  try {
    const directory = join(home, ".codex", "skills", "personal-research");
    await mkdir(directory, {recursive: true});
    await writeFile(
      join(directory, "SKILL.md"),
      "---\nname: personal-research\ndescription: Personal research workflow.\n---\n",
    );

    const loaded = new SkillLoader({home}).load();
    assert.equal(loaded.skills[0]?.name, "personal-research");
    assert.equal(loaded.skills[0]?.source, "codex");
  } finally {
    await rm(home, {recursive: true, force: true});
  }
});

test("excludes skills disabled by the host application", async () => {
  const home = await mkdtemp(join(tmpdir(), "midas-disabled-skill-"));
  try {
    const directory = join(home, ".midas", "skills", "optional-skill");
    await mkdir(directory, {recursive: true});
    await writeFile(join(directory, "SKILL.md"), "---\nname: optional-skill\ndescription: Optional workflow.\n---\n");
    const loaded = new SkillLoader({home, isEnabled: (skill) => skill.name !== "optional-skill"}).load();
    assert.equal(loaded.skills.length, 0);
  } finally {
    await rm(home, {recursive: true, force: true});
  }
});

test("warns about invalid names and refuses skills without descriptions", async () => {
  const home = await mkdtemp(join(tmpdir(), "midas-skills-"));
  try {
    const directory = join(home, ".midas", "skills", "Bad Name");
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

test("loads official skills and lets user skills override them", async () => {
  const root = await mkdtemp(join(tmpdir(), "midas-official-skills-"));
  const home = join(root, "home");
  const official = join(root, "official");
  try {
    await mkdir(join(official, "browser"), { recursive: true });
    await writeFile(
      join(official, "browser", "SKILL.md"),
      "---\nname: browser\ndescription: Official browser workflow.\n---\n",
    );
    await mkdir(join(home, ".midas", "skills", "browser"), {
      recursive: true,
    });
    await writeFile(
      join(home, ".midas", "skills", "browser", "SKILL.md"),
      "---\nname: browser\ndescription: User browser workflow.\n---\n",
    );

    const loaded = new SkillLoader({ home, official: [official] }).load();
    const browser = loaded.skills.find((skill) => skill.name === "browser");
    assert.equal(browser?.source, "midas");
    assert.equal(browser?.description, "User browser workflow.");
    assert.ok(
      loaded.diagnostics.some((item) =>
        item.message.includes("Duplicate skill browser"),
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
