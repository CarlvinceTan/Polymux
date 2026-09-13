import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { HeadlessHostRuntime, TeamHostClient } from "../src/index.js";

test("Host model and per-model reasoning persist, with explicit deployment model taking precedence", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-tui-settings-"));
  const options = {
    dataDirectory: directory,
    listen: "127.0.0.1",
    port: 0,
    adminSecret: "test-secret",
    beginPairing: false,
  };
  let runtime = new HeadlessHostRuntime(options);
  try {
    let state = await runtime.start();
    let client = new TeamHostClient(state.endpoint!, "test-secret");
    await client.call("assistant.ensure", ["a"]);
    await client.call("assistant.ensure", ["b"]);
    const models =
      await client.call<Array<{ provider: string; id: string }>>("models.list");
    assert.ok(models.length > 1);
    const first = `${models[0].provider}/${models[0].id}`;
    const second = `${models[1].provider}/${models[1].id}`;
    const model = process.env.POLYMUX_MODEL || first;
    await client.call("runs.configure", ["a", { model, reasoning: "medium" }]);
    const selected = await client.call<{ model: string; reasoning: string }>(
      "runs.configuration",
      ["a"],
    );
    assert.equal(selected.model, model);
    assert.equal(selected.reasoning, "medium");
    await assert.rejects(
      client.call("runs.configure", [
        "a",
        { model: second, reasoning: "invalid" },
      ]),
      /Unknown reasoning/,
    );
    assert.equal(
      (await client.call<{ model: string }>("runs.configuration", ["a"])).model,
      model,
    );
    if (!process.env.POLYMUX_MODEL) {
      await client.call("runs.configure", [
        "b",
        { model: second, reasoning: "high" },
      ]);
      assert.equal(
        (await client.call<{ model: string }>("runs.configuration", ["a"]))
          .model,
        first,
      );
      await client.call("assistant.ensure", ["c"]);
      assert.equal(
        (await client.call<{ model: string }>("runs.configuration", ["c"]))
          .model,
        second,
      );
    }
    await runtime.close();
    runtime = new HeadlessHostRuntime({ ...options, model });
    state = await runtime.start();
    client = new TeamHostClient(state.endpoint!, "test-secret");
    assert.equal(
      (await client.call<{ reasoning: string }>("runs.configuration", ["a"]))
        .reasoning,
      "medium",
    );
    await assert.rejects(
      client.call("runs.configure", [
        "a",
        { model: model === second ? first : second },
      ]),
      /explicit model/,
    );
    await assert.rejects(
      client.call("runs.configuration", ["missing"]),
      /Conversation not found/,
    );
    assert.deepEqual(await client.call("runs.updates", ["missing", 0]), {
      events: [],
      draft: null,
    });
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});
