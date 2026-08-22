import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {openAICodexDeviceUri, openAICodexInteraction, providerOAuthError, ProviderOAuthSessions} from "./provider-oauth.js";

describe("provider OAuth sessions", () => {
  it("is single-flight per provider and cancellation aborts the owner", () => {
    const sessions = new ProviderOAuthSessions();
    const first = sessions.begin("openai-codex");
    assert.throws(() => sessions.begin("openai-codex"), /already in progress/);
    assert.equal(sessions.cancel("openai-codex"), true);
    assert.equal(first.signal.aborted, true);
    sessions.finish("openai-codex", first);
    assert.equal(sessions.begin("openai-codex").signal.aborted, false);
  });

  it("does not let an old completion remove a replacement owner", () => {
    const sessions = new ProviderOAuthSessions();
    const first = sessions.begin("openai-codex");
    sessions.finish("openai-codex", first);
    const second = sessions.begin("openai-codex");
    sessions.finish("openai-codex", first);
    assert.throws(() => sessions.begin("openai-codex"), /already in progress/);
    sessions.finish("openai-codex", second);
  });
});

describe("provider OAuth errors", () => {
  it("preserves the actionable credential-store cause across IPC", () => {
    const cause = new Error("Secure credential storage is unavailable. Restart FlareAI.");
    const wrapped = new Error("Credential store modify failed for openai-codex", {cause});
    assert.equal(providerOAuthError(wrapped).message, cause.message);
  });
});

describe("OpenAI Codex device login", () => {
  it("selects device login and publishes only bounded renderer events", async () => {
    const events: unknown[] = [];
    const interaction = openAICodexInteraction(
      "openai-codex",
      new AbortController().signal,
      (event) => events.push(event),
    );
    assert.equal(await interaction.prompt({
      type: "select",
      message: "method",
      options: [
        {id: "browser", label: "Browser"},
        {id: "device_code", label: "Device"},
      ],
    }), "device_code");
    interaction.notify({
      type: "device_code",
      userCode: "ABCD-EFGH",
      verificationUri: "https://auth.openai.com/codex/device",
      expiresInSeconds: 900,
    });
    interaction.notify({type: "progress", message: "Waiting"});
    interaction.notify({type: "info", message: "not renderer state"});
    assert.deepEqual(events, [
      {
        providerId: "openai-codex",
        type: "device_code",
        userCode: "ABCD-EFGH",
        verificationUri: "https://auth.openai.com/codex/device",
        expiresInSeconds: 900,
      },
      {providerId: "openai-codex", type: "progress", message: "Waiting"},
    ]);
  });

  it("refuses a login prompt the background flow cannot answer safely", async () => {
    const interaction = openAICodexInteraction(
      "openai-codex",
      new AbortController().signal,
      () => {},
    );
    await assert.rejects(
      interaction.prompt({type: "text", message: "secret"}),
      /unsupported interactive prompt/,
    );
  });

  it("accepts only the expected HTTPS device page", () => {
    assert.equal(
      openAICodexDeviceUri("https://auth.openai.com/codex/device"),
      "https://auth.openai.com/codex/device",
    );
  });

  for (const value of [
    "http://auth.openai.com/codex/device",
    "https://example.com/codex/device",
    "https://auth.openai.com/other",
    "file:///tmp/device",
  ]) {
    it(`rejects ${value}`, () => {
      assert.throws(() => openAICodexDeviceUri(value), /unexpected device-login/);
    });
  }
});
