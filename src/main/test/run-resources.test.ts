import assert from "node:assert/strict";
import test from "node:test";
import type {AgentRunEvent} from "@flareai/core";
import type {Artifact, NewArtifact, NewReference, StoredReference} from "@flareai/storage";
import {RunResourceRecorder, type RunResourceStore} from "../run-resources.js";

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

test("records the page a browser tool landed on", () => {
  const store = memoryStore();
  const recorder = new RunResourceRecorder(store, () => `id-${store.references.length}`);
  recorder.record("chat-1", "run-1", toolCompleted(
    "browser_control",
    {action: "navigate", leaseId: "lease", url: "https://example.com"},
    JSON.stringify({ok: true, pageUrl: "https://example.com/docs", pageTitle: "Docs"}),
  ));
  assert.deepEqual(
    store.references.map(({title, uri, kind}) => ({title, uri, kind})),
    [{title: "Docs", uri: "https://example.com/docs", kind: "web"}],
  );
});

test("falls back to the requested url and derives a title from it", () => {
  const store = memoryStore();
  const recorder = new RunResourceRecorder(store, () => "id-1");
  recorder.record("chat-1", "run-1", toolCompleted("fetch", {url: "https://example.com/a/b"}, "some page text"));
  assert.deepEqual(
    store.references.map(({title, uri}) => ({title, uri})),
    [{title: "example.com/a/b", uri: "https://example.com/a/b"}],
  );
});

test("de-duplicates repeat visits and seeds from stored references", () => {
  const store = memoryStore();
  store.createReference({id: "existing", conversationId: "chat-1", kind: "web", title: "Docs", uri: "https://example.com/docs"});
  const recorder = new RunResourceRecorder(store, () => "id-new");
  const visit = toolCompleted("browser_control", {action: "read", leaseId: "lease"},
    JSON.stringify({ok: true, pageUrl: "https://example.com/docs", pageTitle: "Docs"}));
  recorder.record("chat-1", "run-1", visit);
  recorder.record("chat-1", "run-1", visit);
  assert.equal(store.references.length, 1);
});

test("ignores non-web urls and failed tool calls", () => {
  const store = memoryStore();
  const recorder = new RunResourceRecorder(store, () => "id-1");
  recorder.record("chat-1", "run-1", toolCompleted("browser_control", {}, JSON.stringify({pageUrl: "about:blank"})));
  const failed = toolCompleted("fetch", {url: "https://example.com"}, "boom");
  recorder.record("chat-1", "run-1", {...failed, result: {content: "boom", isError: true}} as AgentRunEvent);
  assert.equal(store.references.length, 0);
});

test("ignores links a search only listed — a result is not a page the agent read", () => {
  const store = memoryStore();
  const recorder = new RunResourceRecorder(store, () => "id-1");
  recorder.record("chat-1", "run-1", toolCompleted("web_search", {query: "flareai"}, JSON.stringify({
    results: [{title: "First", url: "https://one.example/a"}, {title: "Second", link: "https://two.example/b"}],
  })));
  assert.equal(store.references.length, 0);
});

test("ignores a call that reported failure in its payload", () => {
  const store = memoryStore();
  const recorder = new RunResourceRecorder(store, () => "id-1");
  recorder.record("chat-1", "run-1", toolCompleted("fetch", {url: "https://example.com/missing"},
    JSON.stringify({status: 404, body: "Not Found"})));
  recorder.record("chat-1", "run-1", toolCompleted("browser_control", {action: "read", leaseId: "l"},
    JSON.stringify({ok: false, pageUrl: "https://example.com/blocked"})));
  recorder.record("chat-1", "run-1", toolCompleted("fetch", {url: "https://example.com/down"},
    JSON.stringify({error: "connection refused"})));
  assert.equal(store.references.length, 0);
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
