import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { HeadlessHostRuntime, TeamHostClient } from "../src/index.js";
import { HeadlessCredentialStore } from "../src/credentials.js";
import { hostModels } from "../src/models.js";

test("TUI model authentication persists encrypted and custom models use the Host catalog", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-model-auth-"));
  const configDirectory = path.join(root, "config");
  await mkdir(configDirectory);
  const modelsFile = path.join(root, "models.json");
  await writeFile(
    modelsFile,
    JSON.stringify({
      providers: {
        aorus: {
          api: "openai-completions",
          apiKey: "local",
          baseUrl: "http://127.0.0.1:11000/v1",
          models: [
            {
              id: "qwen3.8-27b",
              contextWindow: 131072,
              maxTokens: 8192,
              reasoning: true,
            },
          ],
        },
      },
    }),
  );
  const options = {
    dataDirectory: path.join(root, "host"),
    configDirectory,
    listen: "127.0.0.1",
    port: 0,
    adminSecret: "fixture-admin",
    beginPairing: false,
  };
  let runtime = new HeadlessHostRuntime(options);
  try {
    let state = await runtime.start();
    const request = async (body: unknown, secret = "fixture-admin") =>
      fetch(
        `${state.localEndpoint ?? state.endpoint}/polymux-host/v1/admin/account`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${secret}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );
    assert.equal(
      (
        await request(
          {
            action: "provider.save",
            provider: "openai",
            credential: { type: "api_key", key: "fixture-key" },
          },
          "peer-secret",
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await request({
          action: "provider.save",
          provider: "openai",
          credential: { type: "api_key", key: "fixture-key" },
        })
      ).status,
      200,
    );
    const listing = await (await request({ action: "provider.list" })).json();
    assert.deepEqual(listing.result, [
      { providerId: "openai", type: "api_key" },
    ]);
    assert.doesNotMatch(JSON.stringify(listing), /fixture-key/);
    const sealed = path.join(configDirectory, "model-credentials.json");
    assert.doesNotMatch(await readFile(sealed, "utf8"), /fixture-key/);
    const credentials = new HeadlessCredentialStore(sealed, "fixture-admin");
    const catalog = hostModels(credentials, modelsFile);
    assert.equal((await catalog.getAuth("openai"))?.auth.apiKey, "fixture-key");
    assert.equal((await catalog.getAuth("aorus"))?.auth.apiKey, "local");
    const client = new TeamHostClient(state.endpoint!, "fixture-admin");
    await client.call("assistant.ensure", ["chat"]);
    const models =
      await client.call<Array<{ provider: string; id: string }>>("models.list");
    assert.ok(
      models.some(
        (model) => model.provider === "aorus" && model.id === "qwen3.8-27b",
      ),
    );
    if (!process.env.POLYMUX_MODEL) {
      await client.call("runs.configure", [
        "chat",
        { model: "aorus/qwen3.8-27b" },
      ]);
      assert.equal(
        (
          await client.call<{ contextWindow: number }>("runs.configuration", [
            "chat",
          ])
        ).contextWindow,
        131072,
      );
    }
    await runtime.close();
    runtime = new HeadlessHostRuntime(options);
    state = await runtime.start();
    assert.deepEqual(
      (await (await request({ action: "provider.list" })).json()).result,
      [{ providerId: "openai", type: "api_key" }],
    );
    assert.equal(
      (await request({ action: "provider.delete", provider: "openai" })).status,
      200,
    );
    assert.deepEqual(
      (await (await request({ action: "provider.list" })).json()).result,
      [],
    );
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});
