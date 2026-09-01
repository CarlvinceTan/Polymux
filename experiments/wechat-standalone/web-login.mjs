#!/usr/bin/env node

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createWebQrChallenge, pollWebQrLogin } from "./web-qr.mjs";

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function saveState(path, state) {
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

if (!process.argv.includes("--live")) {
  console.error(
    "Refusing to create a WeChat login session without --live. Use only a disposable test account.",
  );
  process.exitCode = 2;
} else {
  try {
    const directory = await mkdtemp(join(tmpdir(), "polymux-wechat-login-"));
    const qrPath = join(directory, "wechat-login-qr.jpg");
    const statePath = join(directory, "login-state.json");
    const { uuid, image } = await createWebQrChallenge();
    const startedAt = new Date().toISOString();

    await writeFile(qrPath, image, { mode: 0o600 });
    await saveState(statePath, {
      uuid,
      startedAt,
      status: "waiting",
    });
    console.log(
      JSON.stringify({
        event: "ready",
        qrPath,
        statePath,
        warning: "Use a disposable test account only",
      }),
    );

    let tip = 1;
    const deadline = Date.now() + 4 * 60_000;
    while (Date.now() < deadline) {
      const result = await pollWebQrLogin({ uuid, tip });
      if (result.state === "waiting") {
        await delay(1_000);
        continue;
      }
      if (result.state === "scanned") {
        tip = 0;
        await saveState(statePath, {
          uuid,
          startedAt,
          status: "scanned",
        });
        console.log(
          JSON.stringify({
            event: "scanned",
            message: "Confirm the login in WeChat on the test phone",
          }),
        );
        await delay(1_000);
        continue;
      }
      if (result.state === "approved") {
        await saveState(statePath, {
          uuid,
          startedAt,
          status: "approved",
          redirectUri: result.redirectUri,
        });
        console.log(
          JSON.stringify({
            event: "approved",
            statePath,
            message: "Approval received; the credential is stored locally",
          }),
        );
        process.exit(0);
      }

      await saveState(statePath, {
        startedAt,
        status: result.state,
        code: result.code,
      });
      console.error(JSON.stringify({ event: result.state, code: result.code }));
      process.exitCode = 1;
      break;
    }

    if (!process.exitCode && Date.now() >= deadline) {
      await saveState(statePath, { startedAt, status: "timed_out" });
      console.error(JSON.stringify({ event: "timed_out" }));
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`Standalone WeChat login failed: ${error.message}`);
    process.exitCode = 1;
  }
}
