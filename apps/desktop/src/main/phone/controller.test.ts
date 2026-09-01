import assert from "node:assert/strict";
import {chmod, mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {PhoneController} from "./controller.js";

test("shows both Android pairing and the missing Windows iPhone driver", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-phone-host-setup-test-"));
  const adb = path.join(directory, "adb.exe");
  const goIos = path.join(directory, "ios.exe");
  await writeFile(adb, `#!/usr/bin/env node
if (process.argv[2] === 'devices') process.stdout.write('List of devices attached\\n');
`, "utf8");
  await writeFile(goIos, `#!/usr/bin/env node
if (process.argv.includes('list')) process.stdout.write('{"deviceList":[]}\\n');
`, "utf8");
  await Promise.all([chmod(adb, 0o755), chmod(goIos, 0o755)]);
  try {
    const controller = new PhoneController({
      ios: {
        dataDirectory: directory,
        platform: "win32",
        goIosPath: goIos,
        hostPrerequisite: async () => "missing-apple-devices",
      },
      android: {platform: "win32", adbPath: adb},
    });
    const status = await controller.status();
    assert.equal(status.device, null);
    assert.equal(status.stage, "disconnected");
    assert.match(status.message ?? "", /pair from Android Wireless debugging/i);
    assert.match(status.message ?? "", /install Apple Devices once/i);
    await controller.close();
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
