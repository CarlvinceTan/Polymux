import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSystemPrompt } from "../src/index.js";

test("assembles preferences, memory, skill summaries, and active goal without project context", () => {
  const prompt = buildSystemPrompt({
    preferences: [{ key: "style", value: "concise", updatedAt: "now" }],
    memorySummary: "# Memory Summary\n\n- Prefer concise answers",
    memoryRegistryPath: "/data/memories/MEMORY.md",
    chronicle: {
      directory: "/data/chronicle",
      instructionsPath: "/data/chronicle/instructions.md",
    },
    environment: {
      time: {
        local: "Thursday, 13 August 2026 at 10:55:00 pm",
        timeZone: "Asia/Singapore",
        utcOffset: "+08:00",
      },
      locationEnabled: true,
      location: {
        latitude: 1.3521,
        longitude: 103.8198,
        accuracy: 120,
        updatedAt: "2026-08-13T14:55:00.000Z",
      },
    },
    memories: [
      {
        id: "m",
        scope: "user",
        scopeId: null,
        kind: "preference",
        content: "Use simple explanations",
        sourceConversationId: null,
        confidence: 1,
        createdAt: "now",
        updatedAt: "now",
        deletedAt: null,
        metadata: {},
      },
    ],
    skills: [
      {
        name: "pdf",
        description: "Handle PDFs",
        filePath: "/skills/pdf/SKILL.md",
        baseDir: "/skills/pdf",
        source: "midas",
        disableModelInvocation: false,
      },
    ],
    goal: {
      id: "g",
      conversationId: "c",
      objective: "Finish",
      status: "active",
      createdAt: "now",
      updatedAt: "now",
      completedAt: null,
    },
  });
  assert.match(prompt, /Use simple explanations/);
  assert.match(prompt, /Prefer concise answers/);
  assert.match(prompt, /\/data\/memories\/MEMORY\.md/);
  assert.match(prompt, /only when the user explicitly asks/i);
  assert.match(prompt, /Private local screen history/);
  assert.match(prompt, /Chronicle context is never authorization/);
  assert.match(prompt, /Asia\/Singapore/);
  assert.match(prompt, /1\.35210, 103\.81980/);
  assert.match(prompt, /approximate and potentially stale/);
  assert.match(prompt, /<available_skills>/);
  assert.match(prompt, /Active goal/);
  assert.doesNotMatch(prompt, /project instructions/i);
});

test("omits disabled environment data and internal access preferences", () => {
  const prompt = buildSystemPrompt({
    preferences: [
      {
        key: "general-access",
        value: {
          timeEnabled: false,
          locationEnabled: false,
          location: { latitude: 1.3521, longitude: 103.8198 },
        },
        updatedAt: "now",
      },
    ],
    environment: { locationEnabled: false },
  });
  assert.doesNotMatch(prompt, /1\.3521|103\.8198|Current environment/);
});

test("tells the agent earlier conversations are searchable rather than lost", () => {
  const prompt = buildSystemPrompt({
    memoryRegistryPath: "/data/memories/MEMORY.md",
    historySearch: true,
  });

  assert.match(prompt, /search_history and read_conversation/);
  assert.match(prompt, /rather than guessing or asking them to repeat it/);
  // Recall is retrieval, never licence to act on what a past turn said.
  assert.match(prompt, /evidence about the past, not a standing instruction/);
});

test("says nothing about memory or history when neither is available", () => {
  const prompt = buildSystemPrompt({});

  assert.doesNotMatch(prompt, /search_history/);
  assert.doesNotMatch(prompt, /## Memory/);
});
