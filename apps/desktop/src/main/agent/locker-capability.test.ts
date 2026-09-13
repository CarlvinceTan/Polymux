import assert from "node:assert/strict";
import test from "node:test";
import {chmodSync, mkdtempSync, rmSync, statSync, symlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {loadLockerCapability, matchesLockerCapability} from "./locker-capability.js";

test("Locker native capability is private, stable and never accepts a missing bearer", () => {
  const directory = mkdtempSync(join(tmpdir(), "polymux-capability-"));
  try {
    const file = join(directory, "capability");
    const token = loadLockerCapability(file);
    assert.match(token, /^[a-f0-9]{64}$/);
    assert.equal(loadLockerCapability(file), token);
    assert.equal(matchesLockerCapability(`Bearer ${token}`, token), true);
    assert.equal(matchesLockerCapability(undefined, token), false);
    assert.equal(matchesLockerCapability(`Bearer ${"0".repeat(64)}`, token), false);
    if (process.platform !== "win32") {
      assert.equal(statSync(file).mode & 0o777, 0o600);
      chmodSync(file, 0o644);
      assert.throws(() => loadLockerCapability(file), /private file/);
      chmodSync(file, 0o600);
      const link = join(directory, "link");
      symlinkSync(file, link);
      assert.throws(() => loadLockerCapability(link));
    }
  } finally { rmSync(directory, {recursive: true, force: true}); }
});
