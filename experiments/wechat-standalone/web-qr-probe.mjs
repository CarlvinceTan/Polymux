#!/usr/bin/env node

import { buildAuthReadiness } from "./auth-readiness.mjs";
import { requestWebQrChallenge } from "./web-qr.mjs";

if (!process.argv.includes("--live")) {
  console.error(
    "Refusing to request a WeChat QR challenge without --live. No account is contacted or authenticated by this probe.",
  );
  process.exitCode = 2;
} else {
  try {
    const webQr = await requestWebQrChallenge();
    console.log(
      JSON.stringify(
        {
          webQr,
          authentication: buildAuthReadiness(undefined, webQr),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(
      `Standalone WeChat QR challenge probe failed: ${error.message}`,
    );
    process.exitCode = 1;
  }
}
