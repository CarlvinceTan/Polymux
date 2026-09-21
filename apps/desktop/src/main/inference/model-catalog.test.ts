import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ModelCatalog } from "./model-catalog.js";

test("ModelCatalog loads disk cache synchronously and resolves reasoning models", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-test-"));
  const cacheFile = path.join(tmpDir, "models-dev-catalog.json");
  fs.writeFileSync(
    cacheFile,
    JSON.stringify({
      version: 1,
      fetchedAt: Date.now(),
      providers: {
        openai: {
          id: "openai",
          name: "OpenAI",
          models: {
            "o3-mini": {
              id: "o3-mini",
              name: "o3-mini",
              reasoning: true,
              limit: { context: 200_000, output: 100_000 },
            },
          },
        },
      },
      labModels: {
        "deepseek/deepseek-v4.1-flash": {
          id: "deepseek/deepseek-v4.1-flash",
          name: "DeepSeek V4.1 Flash",
          reasoning: true,
          limit: { context: 128_000, output: 8_192 },
        },
      },
    }),
    "utf8",
  );

  const catalog = new ModelCatalog({ cacheDir: tmpDir, fetchImpl: fetch });

  // Synchronous lookup
  const matchFromLab = catalog.lookup(
    "deepseek/deepseek-v4.1-flash",
    "my-custom-provider",
  );
  assert.ok(matchFromLab);
  assert.equal(matchFromLab.reasoning, true);

  const matchBare = catalog.lookup("deepseek-v4.1-flash", "my-custom-provider");
  assert.ok(matchBare);
  assert.equal(matchBare.reasoning, true);

  const matchProvider = catalog.lookup("o3-mini", "openai");
  assert.ok(matchProvider);
  assert.equal(matchProvider.reasoning, true);

  // metadataFor
  const metadata = await catalog.metadataFor([
    { provider: "my-custom-provider", id: "deepseek/deepseek-v4.1-flash" },
  ]);
  assert.equal(
    metadata["my-custom-provider:deepseek/deepseek-v4.1-flash"]?.reasoning,
    true,
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
