import assert from "node:assert/strict";
import test from "node:test";
import type {PhoneStatusDto} from "@polymux/protocol";
import {createPhoneTool, type PhoneAutomation} from "./tools.js";

const status: PhoneStatusDto = {
  supported: true,
  stage: "connected" as const,
  device: {platform: "ios", id: "core-device-id", udid: "private-udid", name: "Owner’s iPhone", model: "iPhone 16 Pro", osVersion: "26.6", transport: "wireless", pairingState: "paired", developerMode: true, tunnelAddress: "fd00::1"},
  signing: {available: true, source: "existing-profile" as const, expiresAt: null, teamId: "PRIVATE_TEAM", message: null},
  wda: {available: true, installed: true, running: true, bundleId: "private.bundle.id"},
  controller: {kind: "wda", available: true, installed: true, running: true},
  message: null,
};

function automation(actions: unknown[]): PhoneAutomation {
  return {
    status: async () => status,
    connect: async () => status,
    frame: async () => ({deviceId: "phone", dataUrl: "data:image/png;base64,AAAA", width: 402, height: 874, capturedAt: "now"}),
    tap: async (point) => { actions.push({tap: point}); },
    swipe: async (from, to, durationMs) => { actions.push({swipe: {from, to, durationMs}}); },
    type: async (text) => { actions.push({type: text}); },
    home: async () => { actions.push({home: true}); },
  };
}

const context = {runId: "run", turn: 1, callId: "call", signal: new AbortController().signal, async emitProgress() {}};

test("keeps action-specific arguments optional without advertising a strict schema", () => {
  const tool = createPhoneTool(automation([]));
  assert.equal(tool.strict, undefined);
  assert.deepEqual(tool.parameters.required, ["action"]);
});

test("returns a screenshot as a model-visible image", async () => {
  const result = await createPhoneTool(automation([])).execute({action: "screenshot"}, context);
  assert.deepEqual(result.content, [
    {type: "text", text: JSON.stringify({width: 402, height: 874, capturedAt: "now"})},
    {type: "image", data: "AAAA", mimeType: "image/png"},
  ]);
});

test("redacts stable device and signing identifiers from agent status", async () => {
  const result = await createPhoneTool(automation([])).execute({action: "status"}, context);
  const content = String(result.content);
  for (const secret of ["core-device-id", "private-udid", "fd00::1", "PRIVATE_TEAM", "private.bundle.id", "Owner’s iPhone"])
    assert.equal(content.includes(secret), false);
  assert.equal(content.includes("iPhone 16 Pro"), true);
});

test("forwards tap and swipe coordinates without guessing defaults", async () => {
  const actions: unknown[] = [];
  const tool = createPhoneTool(automation(actions));
  await tool.execute({action: "tap", x: 20, y: 30}, context);
  await tool.execute({action: "swipe", x: 100, y: 700, toX: 100, toY: 200, durationMs: 500}, context);
  assert.deepEqual(actions, [
    {tap: {x: 20, y: 30}},
    {swipe: {from: {x: 100, y: 700}, to: {x: 100, y: 200}, durationMs: 500}},
  ]);
});
