import assert from "node:assert/strict";
import {chmod, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {AndroidPhoneController, adbTransport, parseAdbConnectAddress, parseAdbDevices, pngDimensions} from "./android.js";

test("parses authorized and pending ADB devices", () => {
  assert.deepEqual(parseAdbDevices(`List of devices attached
USB123 device product:tokay model:Pixel_9 device:tokay transport_id:1
192.0.2.2:37123 unauthorized model:Pixel_8 transport_id:2
`), [
    {serial: "USB123", state: "device", model: "Pixel 9"},
    {serial: "192.0.2.2:37123", state: "unauthorized", model: "Pixel 8"},
  ]);
});

test("reads PNG dimensions without an image decoder", () => {
  const png = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.writeUInt32BE(1080, 16);
  png.writeUInt32BE(2400, 20);
  assert.deepEqual(pngDimensions(png), {width: 1080, height: 2400});
});

test("finds the post-pairing wireless debug endpoint from ADB mDNS", () => {
  assert.equal(parseAdbConnectAddress(
    "adb-serial._adb-tls-connect._tcp. _adb-tls-connect._tcp. 192.0.2.8:37123\n",
  ), "192.0.2.8:37123");
  assert.equal(adbTransport("192.0.2.8:37123"), "wireless");
  assert.equal(adbTransport("USB123"), "wired");
});

test("controls one Android device through the injected ADB binary", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-adb-test-"));
  const adb = path.join(directory, "adb");
  const log = path.join(directory, "actions.jsonl");
  await writeFile(adb, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'devices') process.stdout.write('List of devices attached\\nUSB123 device product:tokay model:Pixel_9 device:tokay transport_id:1\\n');
else if (args.at(-1) === 'ro.build.version.release') process.stdout.write('16\\n');
else if (args.at(-1) === 'ro.serialno') process.stdout.write('HARDWARE123\\n');
else if (args.includes('screencap')) {
  const png = Buffer.alloc(24); Buffer.from([137,80,78,71,13,10,26,10]).copy(png); png.writeUInt32BE(1080,16); png.writeUInt32BE(2400,20); process.stdout.write(png);
} else fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
`, "utf8");
  await chmod(adb, 0o755);
  try {
    const controller = new AndroidPhoneController({platform: "darwin", adbPath: adb});
    assert.equal((await controller.status()).stage, "ready");
    assert.equal((await controller.connect()).stage, "connected");
    assert.deepEqual(await controller.frame().then(({width, height}) => ({width, height})), {width: 1080, height: 2400});
    await controller.tap({x: 10, y: 20});
    await controller.swipe({x: 20, y: 30}, {x: 40, y: 50}, 500);
    await controller.type("hello world");
    await controller.home();
    const actions = (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string[]);
    assert.deepEqual(actions.map((args) => args.slice(3, 6)), [
      ["input", "tap", "10"],
      ["input", "swipe", "20"],
      ["input", "text", "hello%sworld"],
      ["input", "keyevent", "KEYCODE_HOME"],
    ]);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test("groups USB and wireless routes for one phone and prefers wireless", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-adb-routes-test-"));
  const adb = path.join(directory, "adb");
  await writeFile(adb, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'devices') process.stdout.write('List of devices attached\\nUSB123 device model:Pixel_9 transport_id:1\\n192.0.2.8:37123 device model:Pixel_9 transport_id:2\\n');
else if (args.at(-1) === 'ro.build.version.release') process.stdout.write('16\\n');
else if (args.at(-1) === 'ro.serialno') process.stdout.write('HARDWARE123\\n');
`, "utf8");
  await chmod(adb, 0o755);
  try {
    const controller = new AndroidPhoneController({platform: "darwin", adbPath: adb});
    const status = await controller.status();
    assert.equal(status.stage, "ready");
    assert.equal(status.device?.id, "android:HARDWARE123");
    assert.equal(status.device?.udid, "192.0.2.8:37123");
    assert.equal(status.device?.transport, "wireless");
    assert.equal((await controller.connect()).stage, "connected");
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test("uses Android's separate connection address when discovery is blocked", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-adb-pair-test-"));
  const adb = path.join(directory, "adb");
  const connected = path.join(directory, "connected");
  const actions = path.join(directory, "actions.jsonl");
  await writeFile(adb, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(actions)}, JSON.stringify(args) + '\\n');
if (args[0] === 'pair') process.stdout.write('Successfully paired to ' + args[1] + '\\n');
else if (args[0] === 'connect') { fs.writeFileSync(${JSON.stringify(connected)}, 'yes'); process.stdout.write('connected to ' + args[1] + '\\n'); }
else if (args[0] === 'devices') process.stdout.write('List of devices attached\\n' + (fs.existsSync(${JSON.stringify(connected)}) ? '192.0.2.8:39841 device model:Pixel_9 transport_id:2\\n' : ''));
else if (args.at(-1) === 'ro.build.version.release') process.stdout.write('16\\n');
else if (args.at(-1) === 'ro.serialno') process.stdout.write('HARDWARE123\\n');
`, "utf8");
  await chmod(adb, 0o755);
  try {
    const controller = new AndroidPhoneController({platform: "win32", adbPath: adb});
    const status = await controller.pair("192.0.2.8:37123", "123456", "192.0.2.8:39841");
    assert.equal(status.stage, "ready");
    assert.equal(status.device?.transport, "wireless");
    const calls = (await readFile(actions, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string[]);
    assert.ok(calls.some((args) => args[0] === "pair" && args[1] === "192.0.2.8:37123"));
    assert.ok(calls.some((args) => args[0] === "connect" && args[1] === "192.0.2.8:39841"));
    assert.ok(!calls.some((args) => args[0] === "mdns"));
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
