#!/usr/bin/env node

import { buildAuthReadiness } from "./auth-readiness.mjs";
import { runTransportProbe } from "./mmtls.mjs";

if (!process.argv.includes("--live")) {
  console.error(
    "Refusing to contact WeChat without --live. This probe performs transport negotiation only and never authenticates an account.",
  );
  process.exitCode = 2;
} else {
  try {
    const transport = await runTransportProbe();
    console.log(
      JSON.stringify(
        {
          transport,
          authentication: buildAuthReadiness(transport),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(`Standalone WeChat transport probe failed: ${error.message}`);
    process.exitCode = 1;
  }
}
