#!/usr/bin/env node

import { captureNativeCdnWarmup } from "./wechat-wire.mjs";

try {
  const profile = await captureNativeCdnWarmup({
    onReady() {
      process.stderr.write(
        "WeChat CDN capture armed. Send one image in File Transfer.\n",
      );
    },
  });
  process.stdout.write(`${JSON.stringify(profile)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
}
