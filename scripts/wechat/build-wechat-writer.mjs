#!/usr/bin/env node

import { chmod, cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const target = path.join(root, "resources", "wechat-writer");
const sources = [
  "polymux-wechat-driver.mjs",
  "wechat-account-registry.mjs",
  "wechat-key-collect.mjs",
  "wechat-key-capture.mjs",
  "wechat-key-auth.mjs",
  "wechat-local-reader.mjs",
  "wechat-daemon-coordination.mjs",
  "wechat-desktop-store.mjs",
  "wechat-group-rename.mjs",
  "wechat-media-history.mjs",
  "wechat-message-history.mjs",
  "wechat-test-scope.mjs",
  "wechat-snapshot-worker.mjs",
  "wechat-wire.mjs",
  "wechat_native_cdn_upload_lldb.py",
  "wechat_native_task_lldb.py",
];

await rm(target, { force: true, recursive: true });
await mkdir(target, { recursive: true });
for (const source of sources)
  await cp(path.join(root, "scripts", "wechat", source), path.join(target, source));
await chmod(path.join(target, "polymux-wechat-driver.mjs"), 0o755);

const silkTarget = path.join(target, "node_modules", "silk-wasm");
await mkdir(silkTarget, { recursive: true });
for (const source of ["package.json", "LICENSE", "lib"])
  await cp(
    path.join(root, "node_modules", "silk-wasm", source),
    path.join(silkTarget, source),
    { recursive: true },
  );

process.stdout.write(`WeChat writer → ${path.relative(root, target)}\n`);
