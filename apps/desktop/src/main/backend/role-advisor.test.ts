import assert from "node:assert/strict";
import {test} from "node:test";
import type {InferenceModel} from "@polymux/inference";
import {autoRolePicks, modelPurpose} from "./role-advisor.js";

function model(
  provider: string,
  id: string,
  cost?: {input: number; output: number},
): InferenceModel {
  return {
    provider,
    id,
    name: id,
    contextWindow: 200_000,
    maxOutputTokens: 8192,
    reasoning: false,
    input: ["text"],
    ...(cost ? {cost: {...cost, cacheRead: 0, cacheWrite: 0}} : {}),
  };
}

test("classifies known generation models and defaults unknowns to text", () => {
  assert.equal(modelPurpose({id: "gpt-4o-mini-tts", name: "GPT-4o mini TTS"}), "speech");
  assert.equal(modelPurpose({id: "eleven-tts-v3", name: "Eleven v3"}), "speech");
  assert.equal(modelPurpose({id: "gpt-image-1", name: "GPT Image 1"}), "image");
  assert.equal(modelPurpose({id: "dall-e-3", name: "DALL·E 3"}), "image");
  assert.equal(modelPurpose({id: "flux-1.1-pro", name: "FLUX 1.1 pro"}), "image");
  assert.equal(modelPurpose({id: "sora-2", name: "Sora 2"}), "video");
  assert.equal(modelPurpose({id: "veo-3", name: "Veo 3"}), "video");
  // Transcription hears audio but cannot speak; it must not enable speech.
  assert.equal(modelPurpose({id: "whisper-large-v3", name: "Whisper"}), "text");
  assert.equal(modelPurpose({id: "gpt-4o-transcribe", name: "Transcribe"}), "text");
  // Unknown ids never classify into a generation role.
  assert.equal(modelPurpose({id: "some-new-model", name: "Mystery"}), "text");
  assert.equal(modelPurpose({id: "claude-sonnet-5", name: "Claude Sonnet 5"}), "text");
});

test("fills generation roles from classified candidates, preferring main's provider", () => {
  const picks = autoRolePicks(
    [
      model("openai", "gpt-5.6", {input: 1.25, output: 10}),
      model("openai", "gpt-4o-mini-tts", {input: 0.6, output: 12}),
      model("elevenlabs", "eleven-tts-v3", {input: 0, output: 30}),
      model("openai", "gpt-image-1", {input: 10, output: 40}),
      model("google", "veo-3"),
    ],
    {provider: "openai", id: "gpt-5.6"},
  );
  assert.deepEqual(picks.speech, {provider: "openai", id: "gpt-4o-mini-tts"});
  assert.deepEqual(picks.image, {provider: "openai", id: "gpt-image-1"});
  assert.deepEqual(picks.video, {provider: "google", id: "veo-3"});
});

test("leaves generation roles unset without classified candidates", () => {
  const picks = autoRolePicks(
    [model("anthropic", "claude-sonnet-5", {input: 3, output: 15})],
    {provider: "anthropic", id: "claude-sonnet-5"},
  );
  assert.equal(picks.speech, undefined);
  assert.equal(picks.image, undefined);
  assert.equal(picks.video, undefined);
});

test("subagent and compaction take the best cheaper same-provider text model", () => {
  const picks = autoRolePicks(
    [
      model("anthropic", "claude-fable-5", {input: 15, output: 75}),
      model("anthropic", "claude-sonnet-5", {input: 3, output: 15}),
      model("anthropic", "claude-haiku-4-5", {input: 1, output: 5}),
      model("openai", "gpt-5.6", {input: 1.25, output: 10}),
    ],
    {provider: "anthropic", id: "claude-fable-5"},
  );
  assert.deepEqual(picks.subagent, {provider: "anthropic", id: "claude-sonnet-5"});
  assert.deepEqual(picks.compaction, {provider: "anthropic", id: "claude-sonnet-5"});
  assert.equal(picks.judge, undefined);
});

test("keeps roles on main when the only cheaper model is a micro tier", () => {
  const picks = autoRolePicks(
    [
      model("openai", "gpt-5.6", {input: 1.25, output: 10}),
      model("openai", "gpt-5-nano", {input: 0.05, output: 0.4}),
    ],
    {provider: "openai", id: "gpt-5.6"},
  );
  assert.equal(picks.subagent, undefined);
  assert.equal(picks.compaction, undefined);
});

test("keeps text roles on main without cost data and never picks generation models", () => {
  const picks = autoRolePicks(
    [
      model("custom-local", "llama-3.3-70b"),
      model("custom-local", "llama-3.2-1b"),
      model("custom-local", "flux-schnell"),
    ],
    {provider: "custom-local", id: "llama-3.3-70b"},
  );
  assert.equal(picks.subagent, undefined);
  assert.equal(picks.compaction, undefined);
  assert.deepEqual(picks.image, {provider: "custom-local", id: "flux-schnell"});
});
