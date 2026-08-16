import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type {
  InferenceEvent,
  InferenceModel,
  InferenceRequest,
  InferenceService,
  ModelRef,
} from "@flareai/inference";
import { MemoryConsolidator, MemoryManager } from "../src/index.js";

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
    for (const event of this.responses.shift() ?? [])
      yield event;
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

function failure(message: string): InferenceEvent {
  return { type: "error", error: { message } } as InferenceEvent;
}

function vault(): MemoryManager {
  return new MemoryManager({
    directory: mkdtempSync(path.join(tmpdir(), "flareai-consolidation-")),
  });
}

function fill(memory: MemoryManager, count: number): void {
  for (let index = 0; index < count; index += 1)
    memory.remember(`Durable fact number ${index}`, { kind: "preference" });
}

const signal = new AbortController().signal;

test("consolidation waits until enough unconsolidated memory has landed", async () => {
  const memory = vault();
  const inference = new FakeInference();
  const consolidator = new MemoryConsolidator(inference, memory, {
    minimumPending: 10,
  });
  fill(memory, 9);

  assert.equal(await consolidator.maybeConsolidate(model, signal), false);
  assert.equal(inference.requests.length, 0);
  assert.equal(memory.consolidationState().watermark, null);
});

test("consolidation replaces the mechanical summary and records a watermark", async () => {
  const memory = vault();
  const inference = new FakeInference();
  inference.responses.push([answer("## User Profile\n\nSynthesized briefing.")]);
  const consolidator = new MemoryConsolidator(inference, memory, {
    minimumPending: 10,
  });
  fill(memory, 12);

  assert.equal(await consolidator.maybeConsolidate(model, signal), true);

  const state = memory.consolidationState();
  assert.equal(state.lastError, null);
  assert.equal(state.watermark, memory.userMemories()[0]?.updatedAt);
  assert.match(readFileSync(memory.summaryPath, "utf8"), /Synthesized briefing/);
  assert.match(memory.promptContext().summary, /Synthesized briefing/);
  // Every memory was handed to the model, not just the pending ones.
  const sent = inference.requests[0]?.messages[0];
  const rendered = typeof sent?.content === "string" ? sent.content : "";
  assert.equal(rendered.match(/^- \[preference\]/gm)?.length, 12);
});

test("a memory added after consolidation survives without clobbering the summary", async () => {
  const memory = vault();
  const inference = new FakeInference();
  inference.responses.push([answer("Synthesized briefing.")]);
  const consolidator = new MemoryConsolidator(inference, memory, {
    minimumPending: 10,
  });
  fill(memory, 12);
  await consolidator.maybeConsolidate(model, signal);

  memory.remember("Prefers tabs over spaces", { kind: "preference" });

  const summary = readFileSync(memory.summaryPath, "utf8");
  assert.match(summary, /Synthesized briefing/);
  assert.doesNotMatch(summary, /tabs over spaces/);
  // It is missing from the file but still reaches the prompt.
  assert.match(memory.promptContext().summary, /## Not yet consolidated/);
  assert.match(memory.promptContext().summary, /tabs over spaces/);
  assert.equal(memory.pendingMemories().length, 1);
});

test("a failed consolidation backs off and then resumes by itself", async () => {
  let now = new Date("2026-08-15T00:00:00.000Z");
  const memory = new MemoryManager({
    directory: mkdtempSync(path.join(tmpdir(), "flareai-consolidation-")),
    clock: () => now,
  });
  const inference = new FakeInference();
  inference.responses.push([failure("provider unavailable")]);
  inference.responses.push([answer("Synthesized briefing.")]);
  const consolidator = new MemoryConsolidator(inference, memory, {
    minimumPending: 10,
  });
  fill(memory, 12);

  assert.equal(await consolidator.maybeConsolidate(model, signal), false);
  const failed = memory.consolidationState();
  assert.equal(failed.consecutiveFailures, 1);
  assert.match(failed.lastError ?? "", /provider unavailable/);
  assert.equal(failed.retryAfter, "2026-08-15T00:10:00.000Z");

  // Inside the backoff window nothing is spent.
  assert.equal(await consolidator.maybeConsolidate(model, signal), false);
  assert.equal(inference.requests.length, 1);

  // Past it the job resumes with no manual reset, and success clears the state.
  now = new Date("2026-08-15T00:11:00.000Z");
  assert.equal(await consolidator.maybeConsolidate(model, signal), true);
  assert.equal(inference.requests.length, 2);
  const healthy = memory.consolidationState();
  assert.equal(healthy.consecutiveFailures, 0);
  assert.equal(healthy.retryAfter, null);
  assert.equal(healthy.lastError, null);
});

test("backoff doubles per consecutive failure and stays capped", async () => {
  let now = new Date("2026-08-15T00:00:00.000Z");
  const memory = new MemoryManager({
    directory: mkdtempSync(path.join(tmpdir(), "flareai-consolidation-")),
    clock: () => now,
  });
  const inference = new FakeInference();
  const consolidator = new MemoryConsolidator(inference, memory, {
    minimumPending: 10,
  });
  fill(memory, 12);

  const windows: number[] = [];
  for (let attempt = 0; attempt < 8; attempt += 1) {
    inference.responses.push([failure("context window exceeded")]);
    await consolidator.maybeConsolidate(model, signal);
    const { retryAfter } = memory.consolidationState();
    windows.push((Date.parse(retryAfter ?? "") - now.getTime()) / 60_000);
    now = new Date(Date.parse(retryAfter ?? "") + 1_000);
  }

  assert.deepEqual(windows, [10, 20, 40, 80, 160, 320, 360, 360]);
});
