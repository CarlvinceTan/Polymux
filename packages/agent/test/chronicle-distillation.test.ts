import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ChronicleManager } from "@flareai/chronicle";
import type {
  InferenceEvent,
  InferenceModel,
  InferenceRequest,
  InferenceService,
  ModelRef,
} from "@flareai/inference";
import { ChronicleDistiller, MemoryManager } from "../src/index.js";

const model: ModelRef = { provider: "test", id: "model" };
const modelInfo: InferenceModel = {
  provider: "test",
  id: "model",
  name: "Model",
  contextWindow: 100_000,
  maxOutputTokens: 4_000,
  reasoning: false,
  input: ["text"],
};

class FakeInference implements InferenceService {
  readonly requests: InferenceRequest[] = [];
  readonly responses: InferenceEvent[][] = [];
  listModels(): InferenceModel[] {
    return [modelInfo];
  }
  getModel(): InferenceModel {
    return modelInfo;
  }
  async listAvailableModels(): Promise<InferenceModel[]> {
    return [modelInfo];
  }
  async *stream(request: InferenceRequest): AsyncIterable<InferenceEvent> {
    this.requests.push(request);
    for (const event of this.responses.shift() ?? []) yield event;
  }
}

function answer(text: string): InferenceEvent {
  return {
    type: "done",
    reason: "stop",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 2,
        costUsd: 0,
      },
    },
  } as InferenceEvent;
}

const signal = new AbortController().signal;
const now = new Date("2026-08-13T18:00:00.000Z");

/** A chronicle holding `count` frames captured well before the cutoff. */
async function chronicle(count: number): Promise<ChronicleManager> {
  let index = 0;
  let at = new Date("2026-08-13T09:00:00.000Z");
  const manager = new ChronicleManager({
    directory: mkdtempSync(path.join(tmpdir(), "flareai-distill-")),
    frames: {
      capture: async () => [
        {
          sourceId: "ax-dev.zed.Zed",
          sourceName: `Zed — file-${index}.ts`,
          displayId: null,
          width: 0,
          height: 0,
          image: Buffer.from(`# Zed\n\nediting the flareAI retry policy ${index}`),
          signature: Uint8Array.from([index, 0, 0]),
          app: "Zed",
        },
      ],
    },
    system: {
      current: () => ({
        idleSeconds: 0,
        locked: false,
        onBattery: false,
        thermalState: "nominal",
      }),
    },
    clock: () => at,
  });
  for (index = 0; index < count; index += 1) {
    at = new Date(at.getTime() + 60_000);
    await manager.captureOnce();
  }
  return manager;
}

function vault(): MemoryManager {
  return new MemoryManager({
    directory: mkdtempSync(path.join(tmpdir(), "flareai-distill-memory-")),
  });
}

test("a quiet window is not worth a model call", async () => {
  const manager = await chronicle(3);
  const inference = new FakeInference();
  const distiller = new ChronicleDistiller(
    inference,
    vault(),
    manager,
    { minimumFrames: 8 },
    () => now,
  );

  assert.equal(await distiller.maybeDistill(model, signal), 0);
  assert.equal(inference.requests.length, 0);
  assert.equal(manager.store.state().distilledThrough, null);
});

test("frames older than the window become durable memories once", async () => {
  const manager = await chronicle(10);
  const memory = vault();
  const inference = new FakeInference();
  inference.responses.push([
    answer("- Works on FlareAI in Zed, currently on the drive retry policy.\n- Short line"),
  ]);
  const distiller = new ChronicleDistiller(inference, memory, manager, {}, () => now);

  assert.equal(await distiller.maybeDistill(model, signal), 1);
  const memories = memory.userMemories();
  assert.equal(memories.length, 1);
  assert.match(memories[0]!.content, /drive retry policy/);
  assert.equal(memories[0]!.kind, "screen");
  // The frame text itself reached the model, not just the index.
  assert.match(String(inference.requests[0]?.messages[0]?.content), /editing the flareAI retry policy/);

  // The watermark has moved, so the same hours are never paid for twice.
  assert.equal(manager.store.state().distilledThrough, manager.store.entries()[0]?.capturedAt);
  assert.equal(await distiller.maybeDistill(model, signal), 0);
  assert.equal(inference.requests.length, 1);
});

test("a window with nothing worth keeping still moves the watermark", async () => {
  const manager = await chronicle(10);
  const memory = vault();
  const inference = new FakeInference();
  inference.responses.push([answer("NOTHING")]);
  const distiller = new ChronicleDistiller(inference, memory, manager, {}, () => now);

  assert.equal(await distiller.maybeDistill(model, signal), 0);
  assert.equal(memory.userMemories().length, 0);
  assert.ok(manager.store.state().distilledThrough);
});

test("recent frames are left alone until they are old enough", async () => {
  const manager = await chronicle(10);
  const inference = new FakeInference();
  const distiller = new ChronicleDistiller(
    inference,
    vault(),
    manager,
    {},
    // Two minutes after the last capture: inside the six-hour window, so
    // nothing in it is finished with yet.
    () => new Date("2026-08-13T09:12:00.000Z"),
  );

  assert.equal(await distiller.maybeDistill(model, signal), 0);
  assert.equal(inference.requests.length, 0);
});
