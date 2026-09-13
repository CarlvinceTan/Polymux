import assert from "node:assert/strict";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {IosPhoneSigner} from "./ios-signer.js";

test("keeps the Apple login and 2FA exchange in one private helper process", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-ios-signer-test-"));
  const helper = path.join(directory, "helper.mjs");
  await writeFile(helper, `
    import {createInterface} from "node:readline";
    let authenticated = false;
    const lines = createInterface({input: process.stdin});
    lines.on("line", (line) => {
      const request = JSON.parse(line);
      let result;
      if (request.method === "status") result = {authenticated, email: authenticated ? "owner@example.com" : null};
      else if (request.method === "beginLogin") result = {status: "2fa_required", method: "trusteddevice"};
      else if (request.method === "complete2fa") { authenticated = true; result = {status: "authenticated"}; }
      else if (request.method === "logout") { authenticated = false; result = {status: "signed_out"}; }
      else result = {};
      process.stdout.write(JSON.stringify({id: request.id, ok: true, result}) + "\\n");
    });
  `);
  const signer = new IosPhoneSigner({
    dataDirectory: directory,
    pythonPath: process.execPath,
    helperPath: helper,
    zsignPath: process.execPath,
  });
  try {
    assert.equal((await signer.status()).stage, "signed-out");
    const verification = await signer.beginLogin("owner@example.com", "private-password");
    assert.equal(verification.stage, "verification-required");
    assert.equal(verification.verificationMethod, "trusted-device");
    const signedIn = await signer.completeTwoFactor("123456");
    assert.equal(signedIn.stage, "authenticated");
    assert.equal(signedIn.email, "owner@example.com");
    assert.equal((await signer.logout()).stage, "signed-out");
  } finally {
    await signer.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test("rejects malformed verification codes before they reach the helper", async () => {
  const signer = new IosPhoneSigner({
    dataDirectory: tmpdir(),
    pythonPath: process.execPath,
    helperPath: process.execPath,
    zsignPath: process.execPath,
  });
  await assert.rejects(() => signer.completeTwoFactor("12 34"), /six-digit/);
});
