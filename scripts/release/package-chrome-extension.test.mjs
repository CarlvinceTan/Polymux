import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const env = {...process.env, POLYMUX_SUPABASE_URL: "https://example.supabase.co", POLYMUX_SUPABASE_ANON_KEY: "packaging-public-test-key"};

test("production Vault builds write account config only into staging", () => {
  const stage = mkdtempSync(path.join(tmpdir(), "polymux-config-test-"));
  try {
    const result = spawnSync(process.execPath, [path.join(root, "apps/extension/scripts/build-vault.mjs"), "--output-dir", stage], {cwd: tmpdir(), env, encoding: "utf8"});
    assert.equal(result.status, 0, result.stderr);
    const config = readFileSync(path.join(stage, "vault/config.js"), "utf8");
    assert.match(config, /https:\/\/example\.supabase\.co/);
    assert.match(config, /packaging-public-test-key/);
    assert.ok(readFileSync(path.join(stage, "vault/offline.js")).length > 100_000);
    const invalid = spawnSync(process.execPath, [path.join(root, "apps/extension/scripts/build-vault.mjs"), "--output-dir", stage], {env: {...env, POLYMUX_SUPABASE_URL: "http://insecure.example"}, encoding: "utf8"});
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /packaging requires/);
  } finally { rmSync(stage, {recursive: true, force: true}); }
});

test("Chrome packaging resolves its repository from a different working directory", {skip: process.platform === "win32"}, () => {
  const stage = mkdtempSync(path.join(tmpdir(), "polymux-package-test-"));
  try {
    const archive = path.join(stage, "extension.zip");
    const result = spawnSync("bash", [path.join(root, "scripts/release/package-chrome-extension.sh"), archive], {cwd: stage, env, encoding: "utf8"});
    assert.equal(result.status, 0, result.stderr);
    const config = spawnSync("unzip", ["-p", archive, "vault/config.js"], {encoding: "utf8"});
    assert.equal(config.status, 0, config.stderr);
    assert.match(config.stdout, /packaging-public-test-key/);
    const list = spawnSync("unzip", ["-Z1", archive], {encoding: "utf8"});
    assert.equal(list.status, 0, list.stderr);
    assert.doesNotMatch(list.stdout, /(^|\n)(vault\/config\.local\.js|native-host\/|safari\/|scripts\/)/);
  } finally { rmSync(stage, {recursive: true, force: true}); }
});
