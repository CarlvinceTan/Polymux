import assert from "node:assert/strict";
import test from "node:test";
import type {InferenceEvent, InferenceRequest, InferenceService} from "@flareai/inference";
import {RotatingInference, type InferenceKeyPool} from "./rotating.js";

test("rotates to the next key after a pre-response rate limit", async () => {
  const attempted: string[] = [];
  const failures: string[] = [];
  const successes: string[] = [];
  const base = service(async function* (request) {
    attempted.push(request.apiKey!);
    yield {type: "start", model: model} as InferenceEvent;
    if (request.apiKey === "first") {
      yield {type: "error", error: {code: "rate_limit", message: "limited", retryable: true}} as InferenceEvent;
      return;
    }
    yield {type: "textStart", index: 0} as InferenceEvent;
    yield {type: "textDelta", index: 0, delta: "ok"} as InferenceEvent;
  });
  const pool: InferenceKeyPool = {
    candidates: async () => [{id: "one", key: "first"}, {id: "two", key: "second"}],
    markFailure: async (_provider, id) => { failures.push(id); },
    markSuccess: async (_provider, id) => { successes.push(id); },
  };

  const events: InferenceEvent[] = [];
  for await (const event of new RotatingInference(base, pool).stream(request)) events.push(event);
  assert.deepEqual(attempted, ["first", "second"]);
  assert.deepEqual(failures, ["one"]);
  assert.deepEqual(successes, ["two"]);
  assert.equal(events.some((event) => event.type === "error"), false);
  assert.equal(events.filter((event) => event.type === "start").length, 1);
});

test("invalidates a rejected key and replaces the provider's raw auth response", async () => {
  const failures: Array<{id: string; reason: string}> = [];
  const base = service(async function* () {
    yield {type: "start", model} as InferenceEvent;
    yield {
      type: "error",
      error: {
        code: "auth",
        message: '401: {"message":"Missing Authentication header","code":401}',
        retryable: false,
      },
    } as InferenceEvent;
  });
  const pool: InferenceKeyPool = {
    candidates: async () => [{id: "bad", key: "df"}],
    markFailure: async (_provider, id, reason) => { failures.push({id, reason}); },
    markSuccess: async () => undefined,
  };

  const events: InferenceEvent[] = [];
  for await (const event of new RotatingInference(base, pool).stream(request)) events.push(event);

  assert.deepEqual(failures, [{id: "bad", reason: "auth"}]);
  const error = events.find((event) => event.type === "error");
  assert.equal(error?.type, "error");
  if (error?.type === "error") {
    assert.equal(error.error.code, "auth");
    assert.equal(
      error.error.message,
      'The selected provider rejected its saved API key (401: {"message":"Missing Authentication header","code":401}). Remove it or add a valid key in Settings → Provider.',
    );
  }
});

const model = {provider: "test", id: "model", name: "Model", contextWindow: 1, maxOutputTokens: 1, reasoning: false, input: ["text" as const]};
const request: InferenceRequest = {model, messages: []};

function service(stream: InferenceService["stream"]): InferenceService {
  return {
    listModels: () => [model],
    getModel: () => model,
    listAvailableModels: async () => [model],
    stream,
  };
}
