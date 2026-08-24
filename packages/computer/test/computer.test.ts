import assert from "node:assert/strict";
import test from "node:test";
import {Computer} from "../src/index.js";

const input = {
  windowsCapturedAt: "2026-08-24T06:00:00.000Z",
  browserTabsCapturedAt: "2026-08-24T06:00:01.000Z",
  externalBrowserCapturedAt: "2026-08-24T06:00:02.000Z",
  windows: [{app: "Zed", title: "Polymux", frontmost: true}],
  browserTabs: [{tabId: "p1", title: "Docs", url: "https://example.com/docs?token=secret#part"}],
  externalBrowserTabs: [{tabId: 7, windowId: 2, title: "Assignment", url: "https://canvas.example/assignment?session=secret", active: true}],
};

test("State returns every requested surface and always identifies the user surface", () => {
  const computer = new Computer(() => input);
  const state = computer.State.query({surfaces: ["tabs"]});
  assert.equal(state.user.app, "Zed");
  assert.equal(state.surfaces.length, 2);
  assert.equal(state.counts.tabs, 2);
  assert.equal(state.surfaces[0]?.url, "https://example.com/docs");
  assert.equal(state.surfaces[1]?.url, "https://canvas.example/assignment");
});

test("Arbiter allows isolated background tab control and enforces its lease", () => {
  const computer = new Computer(() => input);
  const decision = computer.Arbiter.request({ownerId: "agent-1", surfaceId: "tab:external:7", operation: "scroll", scope: "tab"});
  assert.equal(decision.decision, "allow_background_only");
  assert.ok(decision.token);
  assert.equal(computer.Arbiter.validate(decision.token!, "tab:external:7"), true);
  assert.equal(computer.Arbiter.validate(decision.token!, "tab:external:7", "press", "tab"), false);
  assert.equal(computer.Arbiter.userActivity("tab:external:7"), 1);
  assert.equal(computer.Arbiter.validate(decision.token!, "tab:external:7"), false);
});

test("Arbiter keeps unverified desktop mutation read-only", () => {
  const computer = new Computer(() => input);
  const window = computer.State.query({surfaces: ["windows"], app: "Zed"}).surfaces[0]!;
  const decision = computer.Arbiter.request({ownerId: "agent-1", surfaceId: window.id, operation: "type", scope: "window", explicitlyRequested: true});
  assert.equal(decision.decision, "read_only");
});

test("State attaches privacy-safe recent activity to the exact surface", () => {
  const computer = new Computer(() => input);
  computer.observe({at: new Date().toISOString(), kind: "scroll", app: "External Browser", title: "Assignment", count: 4});
  const tab = computer.State.query({surfaces: ["tabs"]}).surfaces.find((surface) => surface.title === "Assignment");
  assert.deepEqual(tab?.lastUserEvent?.kind, "scroll");
  assert.equal(tab?.lastUserEvent?.count, 4);
});

test("observed user activity revokes control of the matching surface", () => {
  const computer = new Computer(() => input);
  const decision = computer.Arbiter.request({ownerId: "agent-1", surfaceId: "tab:external:7", operation: "scroll", scope: "tab"});
  assert.ok(decision.token);
  computer.observe({at: new Date().toISOString(), kind: "scroll", app: "External Browser", title: "Assignment"});
  assert.equal(computer.Arbiter.validate(decision.token!, "tab:external:7"), false);
});

test("Arbiter allows isolated tab leases in different browser windows", () => {
  const computer = new Computer(() => ({
    externalBrowserTabs: [
      {tabId: 1, windowId: 10, title: "One", url: "https://one.example", active: false},
      {tabId: 2, windowId: 20, title: "Two", url: "https://two.example", active: false},
    ],
  }));
  const first = computer.Arbiter.request({ownerId: "a", surfaceId: "tab:external:1", operation: "navigate", scope: "window"});
  const second = computer.Arbiter.request({ownerId: "b", surfaceId: "tab:external:2", operation: "navigate", scope: "window"});
  assert.equal(first.decision, "read_only");
  assert.equal(second.decision, "read_only");
  const tabFirst = computer.Arbiter.request({ownerId: "a", surfaceId: "tab:external:1", operation: "navigate", scope: "tab"});
  const tabSecond = computer.Arbiter.request({ownerId: "b", surfaceId: "tab:external:2", operation: "navigate", scope: "tab"});
  assert.equal(tabFirst.decision, "allow_background_only");
  assert.equal(tabSecond.decision, "allow_background_only");
});
