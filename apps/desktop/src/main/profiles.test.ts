import assert from "node:assert/strict";
import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {SqliteStorage} from "@polymux/storage/sqlite";
import {ProfileManager} from "./profiles.js";

test("profiles begin with a selected default and keep configuration isolated", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-profiles-"));
  const storage = new SqliteStorage(path.join(directory, "polymux.sqlite"));
  try {
    const profiles = new ProfileManager(storage, directory);
    assert.deepEqual(profiles.snapshot(), {
      activeId: "default",
      profiles: [{id: "default", name: "Default Profile", isDefault: true}],
    });
    storage.setPreference(profiles.key("model"), {provider: "openai", id: "one"});
    const created = profiles.create("Work");
    const work = created.profiles.find(profile => profile.name === "Work")!;
    assert.throws(() => profiles.create("work"), /already exists/);
    assert.throws(() => profiles.rename(work.id, "Default Profile"), /already exists/);
    const changedDefault = profiles.setDefault(work.id);
    assert.equal(changedDefault.profiles.find(profile => profile.id === work.id)?.isDefault, true);
    assert.equal(changedDefault.profiles.find(profile => profile.id === "default")?.isDefault, false);
    profiles.select("default");
    assert.equal(profiles.selectDefault().activeId, work.id);
    profiles.select(work.id);
    assert.equal(profiles.preference("model"), null);
    profiles.setPreference("model", {provider: "anthropic", id: "two"});
    profiles.select("default");
    assert.deepEqual(profiles.preference("model")?.value, {provider: "openai", id: "one"});
  } finally {
    storage.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test("duplicate copies scoped preferences and delete cannot remove default", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-profiles-"));
  const storage = new SqliteStorage(path.join(directory, "polymux.sqlite"));
  try {
    const profiles = new ProfileManager(storage, directory);
    storage.setPreference("skill-enabled", {documents: false});
    const duplicated = await profiles.duplicate("default");
    const copy = duplicated.profiles.find(profile => profile.id !== "default")!;
    assert.deepEqual(profiles.preference("skill-enabled", copy.id)?.value, {documents: false});
    assert.equal(profiles.rename("default", "Other").profiles[0].name, "Other");
    await assert.rejects(profiles.remove("default"), /cannot be deleted/);
    const removed = await profiles.remove(copy.id);
    assert.equal(removed.profiles.length, 1);
  } finally {
    storage.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test("legacy MCP configuration migrates once into the default profile only", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-profile-migration-"));
  const dataDirectory = path.join(root, "user-data");
  const configDirectory = path.join(root, "config");
  const profilesDirectory = path.join(configDirectory, "profiles");
  await mkdir(dataDirectory, {recursive: true});
  await writeFile(path.join(dataDirectory, "mcp.json"), '{"mcpServers":{"legacy":{}}}\n');
  const storage = new SqliteStorage(path.join(dataDirectory, "polymux.sqlite"));
  try {
    const profiles = new ProfileManager(
      storage,
      dataDirectory,
      configDirectory,
      profilesDirectory,
    );
    assert.equal(
      await readFile(path.join(profiles.directory("default"), "mcp.json"), "utf8"),
      '{"mcpServers":{"legacy":{}}}\n',
    );

    const created = profiles.create("Clean");
    const clean = created.profiles.find((profile) => profile.name === "Clean")!;
    profiles.select(clean.id);
    await assert.rejects(
      readFile(path.join(profiles.directory(clean.id), "mcp.json"), "utf8"),
      {code: "ENOENT"},
    );

    const index = path.join(profilesDirectory, "index.json");
    await writeFile(index, "migration already completed\n");
    new ProfileManager(storage, dataDirectory, configDirectory, profilesDirectory);
    assert.equal(await readFile(index, "utf8"), "migration already completed\n");
    await assert.rejects(
      readFile(path.join(profiles.directory(clean.id), "mcp.json"), "utf8"),
      {code: "ENOENT"},
    );
  } finally {
    storage.close();
    await rm(root, {recursive: true, force: true});
  }
});
