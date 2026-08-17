import assert from "node:assert/strict";
import test from "node:test";
import type {AgentRunEvent} from "@flareai/core";
import type {Artifact, NewArtifact, NewReference, StoredReference} from "@flareai/storage";
import {RunResourceRecorder, type RunResourceStore} from "./run-resources.js";

function memoryStore(): RunResourceStore & {references: StoredReference[]; artifacts: Artifact[]} {
  const references: StoredReference[] = [];
  const artifacts: Artifact[] = [];
  return {
    references,
    artifacts,
    createReference(input: NewReference) {
      const stored = {
        ...input,
        runId: input.runId ?? null,
        createdAt: "now",
        metadata: input.metadata ?? {},
      } as StoredReference;
      references.push(stored);
      return stored;
    },
    listReferences: (conversationId) => references.filter((item) => item.conversationId === conversationId),
    createArtifact(input: NewArtifact) {
      const stored = {
        ...input,
        conversationId: input.conversationId ?? null,
        runId: input.runId ?? null,
        mimeType: null,
        size: null,
        createdAt: "now",
        updatedAt: "now",
        metadata: input.metadata ?? {},
      } as Artifact;
      artifacts.push(stored);
      return stored;
    },
    listArtifacts: (conversationId) =>
      conversationId === undefined ? artifacts : artifacts.filter((item) => item.conversationId === conversationId),
  };
}

function toolCompleted(name: string, args: Record<string, unknown>, content: string, metadata?: unknown): AgentRunEvent {
  return {
    runId: "run-1",
    sequence: 1,
    timestamp: 0,
    turn: 1,
    type: "tool.completed",
    toolCall: {type: "toolCall", id: "call-1", name, arguments: args},
    result: metadata === undefined ? {content} : {content, metadata},
    durationMs: 5,
  } as AgentRunEvent;
}

function messageCompleted(text: string): AgentRunEvent {
  return {
    runId: "run-1",
    sequence: 2,
    timestamp: 0,
    turn: 1,
    type: "message.completed",
    phase: "final",
    message: {role: "assistant", content: [{type: "text", text}]},
  } as AgentRunEvent;
}

test("records links the reply cites, titled by their link text", () => {
  const store = memoryStore();
  const recorder = new RunResourceRecorder(store, () => `id-${store.references.length}`);
  recorder.record("chat-1", "run-1", messageCompleted(
    "Two are worth a look: [AI Summit](https://one.example/summit) and [Dev Day](https://two.example/dev).",
  ));
  assert.deepEqual(
    store.references.map(({title, uri, kind}) => ({title, uri, kind})),
    [
      {title: "AI Summit", uri: "https://one.example/summit", kind: "web"},
      {title: "Dev Day", uri: "https://two.example/dev", kind: "web"},
    ],
  );
});

test("titles a cited bare url from the page the run actually opened", () => {
  const store = memoryStore();
  const recorder = new RunResourceRecorder(store, () => "id-1");
  recorder.record("chat-1", "run-1", toolCompleted(
    "browser_control",
    {action: "navigate", leaseId: "lease", url: "https://example.com"},
    JSON.stringify({ok: true, pageUrl: "https://example.com/docs", pageTitle: "Docs"}),
  ));
  recorder.record("chat-1", "run-1", messageCompleted("See https://example.com/docs for the details."));
  assert.deepEqual(
    store.references.map(({title, uri}) => ({title, uri})),
    [{title: "Docs", uri: "https://example.com/docs"}],
  );
});

test("falls back to a title derived from an uncited-page url", () => {
  const store = memoryStore();
  const recorder = new RunResourceRecorder(store, () => "id-1");
  recorder.record("chat-1", "run-1", messageCompleted("Source: https://example.com/a/b."));
  assert.deepEqual(
    store.references.map(({title, uri}) => ({title, uri})),
    [{title: "example.com/a/b", uri: "https://example.com/a/b"}],
  );
});

test("pages the run only browsed are not references", () => {
  const store = memoryStore();
  const recorder = new RunResourceRecorder(store, () => "id-1");
  // The shape that filled the panel with search pages: three navigations, and
  // a reply that cites none of them.
  for (const query of ["ai+events", "ai+events+2026", "ai+conferences"])
    recorder.record("chat-1", "run-1", toolCompleted(
      "browser_control",
      {action: "navigate", leaseId: "lease", url: `https://search.example/?q=${query}`},
      JSON.stringify({ok: true, pageUrl: `https://search.example/?q=${query}`, pageTitle: "upcoming AI events Singapore"}),
    ));
  recorder.record("chat-1", "run-1", messageCompleted("I found three events happening in March."));
  assert.equal(store.references.length, 0);
});

test("de-duplicates a link cited twice and seeds from stored references", () => {
  const store = memoryStore();
  store.createReference({id: "existing", conversationId: "chat-1", kind: "web", title: "Docs", uri: "https://example.com/docs"});
  const recorder = new RunResourceRecorder(store, () => "id-new");
  recorder.record("chat-1", "run-1", messageCompleted("https://example.com/docs and again https://example.com/docs"));
  recorder.record("chat-1", "run-1", messageCompleted("[Docs](https://example.com/docs)"));
  assert.equal(store.references.length, 1);
});

test("ignores non-web urls and trailing sentence punctuation", () => {
  const store = memoryStore();
  const recorder = new RunResourceRecorder(store, () => "id-1");
  recorder.record("chat-1", "run-1", messageCompleted("Try about:blank or file:///tmp/x — neither is a source."));
  assert.equal(store.references.length, 0);
  recorder.record("chat-1", "run-1", messageCompleted("(see https://example.com/page)"));
  assert.deepEqual(store.references.map(({uri}) => uri), ["https://example.com/page"]);
});

test("records written files as outputs with a kind from the extension", () => {
  const store = memoryStore();
  const recorder = new RunResourceRecorder(store, () => "id-1");
  recorder.record("chat-1", "run-1", toolCompleted(
    "write",
    {path: "notes.md", content: "hi"},
    "Wrote 2 bytes to /home/me/notes.md",
    {path: "/home/me/notes.md", bytes: 2},
  ));
  assert.deepEqual(
    store.artifacts.map(({name, path, kind}) => ({name, path, kind})),
    [{name: "notes.md", path: "/home/me/notes.md", kind: "document"}],
  );
});
