import assert from "node:assert/strict";
import test from "node:test";
import { currentPageFastPathAvailable, selectEnvironmentForPrompt } from "../src/context/environment-selection.js";

const environment = {
  windowsCapturedAt: "2026-08-21T02:00:00.000Z",
  browserTabsCapturedAt: "2026-08-21T02:00:01.000Z",
  externalBrowserCapturedAt: "2026-08-21T02:00:00.500Z",
  time: { local: "2026-08-21 10:00", timeZone: "Asia/Singapore", utcOffset: "+08:00" },
  locationEnabled: true,
  location: { latitude: 1.3, longitude: 103.8, accuracy: 50, updatedAt: "2026-08-21T02:00:00.000Z" },
  browserTabs: [
    { tabId: "nus", title: "NUSync Events", url: "https://nus.campuslabs.com/engage/events" },
    { tabId: "bank", title: "Banking", url: "https://bank.example/private" },
  ],
  externalBrowserTabs: [
    {tabId: 7, windowId: 2, title: "NUS Canvas", url: "https://canvas.nus.edu.sg", active: true},
    {tabId: 8, windowId: 2, title: "Personal banking", url: "https://bank.example", active: false},
  ],
  windows: [
    { app: "Notion", title: "Singapore plan", frontmost: true },
    { app: "Zed", title: "flareAI", frontmost: false },
  ],
};

test("deictic requests retain open state without leaking unrelated location", () => {
  for (const prompt of [
    "Explain this page",
    "Move the file I have open",
    "Continue what I was doing before I switched",
    "Pick up where I left off",
    "Check what's open",
    "Use that tab",
  ]) {
    const selected = selectEnvironmentForPrompt(environment, prompt, Date.parse("2026-08-21T02:05:00.000Z"));
    assert.deepEqual(selected?.browserTabs, environment.browserTabs);
    assert.deepEqual(selected?.externalBrowserTabs, environment.externalBrowserTabs);
    assert.deepEqual(selected?.windows, environment.windows);
    assert.equal(selected?.location, undefined);
    assert.equal(selected?.locationEnabled, false);
  }
});

test("external-tab bounds apply after relevance and prioritize active deictic state", () => {
  const crowded = {
    ...environment,
    externalBrowserTabs: [
      ...Array.from({length: 24}, (_, index) => ({
        tabId: index,
        windowId: 1,
        title: `Unrelated ${index}`,
        url: `https://example.com/${index}`,
        active: false,
      })),
      {tabId: 99, windowId: 2, title: "NUS orientation", url: "https://nus.edu.sg/orientation", active: true},
    ],
  };
  const readiness = selectEnvironmentForPrompt(crowded, "Get me ready for NUS tomorrow");
  assert.deepEqual(readiness?.externalBrowserTabs?.map((tab) => tab.tabId), [99]);
  const deictic = selectEnvironmentForPrompt(crowded, "Use that tab");
  assert.equal(deictic?.externalBrowserTabs?.length, 20);
  assert.equal(deictic?.externalBrowserTabs?.[0]?.tabId, 99);
});

test("ordinary work retains only semantically matching open state", () => {
  const events = selectEnvironmentForPrompt(environment, "Find events from NUSync");
  assert.deepEqual(events?.browserTabs?.map((tab) => tab.tabId), ["nus"]);
  assert.deepEqual(events?.externalBrowserTabs, []);
  assert.deepEqual(events?.windows, []);
  const singapore = selectEnvironmentForPrompt(environment, "Has anything changed for my Singapore plans?");
  assert.deepEqual(singapore?.windows?.map((entry) => entry.app), ["Notion"]);
  assert.deepEqual(singapore?.browserTabs, []);
});

test("implicit NUS preparation keeps related open state without exposing unrelated tabs", () => {
  const selected = selectEnvironmentForPrompt(environment, "Get me ready for NUS tomorrow");
  assert.deepEqual(selected?.browserTabs?.map((tab) => tab.tabId), ["nus"]);
  assert.deepEqual(selected?.externalBrowserTabs?.map((tab) => tab.tabId), [7]);
  assert.deepEqual(selected?.windows?.map((entry) => entry.app), ["Notion"]);
  assert.equal(selected?.browserTabs?.some((tab) => tab.tabId === "bank"), false);
});

test("readiness keeps only the frontmost unmatched window as a weak current-work cue", () => {
  const selected = selectEnvironmentForPrompt({
    ...environment,
    windows: [
      {app: "Zed", title: "DatabaseImplementations — Lexer.java", frontmost: true},
      {app: "Claude", title: "Claude", frontmost: false},
    ],
  }, "Get me ready for NUS tomorrow");
  assert.deepEqual(selected?.windows, [
    {app: "Zed", title: "DatabaseImplementations — Lexer.java", frontmost: true},
  ]);
  assert.equal(selected?.windowsCapturedAt, environment.windowsCapturedAt);
});

test("unrelated state and precise location stay out while time remains", () => {
  const selected = selectEnvironmentForPrompt(environment, "Reply to Dad");
  assert.deepEqual(selected?.browserTabs, []);
  assert.deepEqual(selected?.externalBrowserTabs, []);
  assert.deepEqual(selected?.windows, []);
  assert.equal(selected?.location, undefined);
  assert.equal(selected?.locationEnabled, false);
  assert.equal(selected?.time, environment.time);
  assert.equal(selected?.windowsCapturedAt, undefined);
  assert.equal(selected?.browserTabsCapturedAt, undefined);
  assert.equal(selected?.externalBrowserCapturedAt, undefined);
});

test("ordinary uses of this do not leak the whole desktop snapshot", () => {
  const selected = selectEnvironmentForPrompt(environment, "Find events this weekend");
  assert.deepEqual(selected?.browserTabs?.map((tab) => tab.tabId), ["nus"]);
  assert.deepEqual(selected?.windows, []);
});

test("location references retain the current fix and only matching tabs", () => {
  for (const prompt of [
    "What events are near me?",
    "Find the closest quiet study space",
    "Is there somewhere close where I can use my laptop?",
    "What is within walking distance?",
    "Show me good cafes around me",
  ]) {
    const selected = selectEnvironmentForPrompt(environment, prompt, Date.parse("2026-08-21T02:05:00.000Z"));
    assert.equal(selected?.location, environment.location, prompt);
  }
});

test("deictic location requests keep only a fresh precise fix", () => {
  const now = Date.parse("2026-08-21T02:05:00.000Z");
  const selected = selectEnvironmentForPrompt(environment, "Use this page to find somewhere near me", now);
  assert.deepEqual(selected?.browserTabs, environment.browserTabs);
  assert.equal(selected?.location, environment.location);
  const stale = selectEnvironmentForPrompt({
    ...environment,
    location: {...environment.location, updatedAt: "2026-08-21T01:00:00.000Z"},
  }, "Use this page to find somewhere near me", now);
  assert.equal(stale?.location, undefined);
});

test("location intent avoids bare-word false positives and remote weather", () => {
  for (const prompt of [
    "Here is the document — summarise it",
    "What's the weather in Tokyo?",
    "Explain this local variable",
    "Which campus is closest to Tokyo?",
    "Find a cafe within walking distance from NUS",
    "Which option is somewhere close to the conference venue?",
  ]) {
    const selected = selectEnvironmentForPrompt(environment, prompt, Date.parse("2026-08-21T02:05:00.000Z"));
    assert.equal(selected?.location, undefined, prompt);
    assert.equal(selected?.locationEnabled, false, prompt);
  }
  const localWeather = selectEnvironmentForPrompt(environment, "What's the weather here?", Date.parse("2026-08-21T02:05:00.000Z"));
  assert.equal(localWeather?.location, environment.location);
});

test("unanchored and explicitly deictic proximity still retain a fresh fix", () => {
  const now = Date.parse("2026-08-21T02:05:00.000Z");
  for (const prompt of [
    "Find the closest quiet study space",
    "Which cafe is closest to me?",
    "Find somewhere within walking distance",
    "Find somewhere within walking distance from my location",
  ]) assert.equal(selectEnvironmentForPrompt(environment, prompt, now)?.location, environment.location, prompt);
});

test("coarse fixes support local weather but not proximity ranking", () => {
  const coarse = {...environment, location: {...environment.location, accuracy: 25_000}};
  const now = Date.parse("2026-08-21T02:05:00.000Z");
  assert.equal(selectEnvironmentForPrompt(coarse, "What's the weather here?", now)?.location, coarse.location);
  const nearby = selectEnvironmentForPrompt(coarse, "Find a cafe within walking distance", now);
  assert.equal(nearby?.location, undefined);
  assert.equal(nearby?.locationEnabled, true);
});

test("stale, future, and malformed location fixes are not offered", () => {
  for (const updatedAt of [
    new Date(Date.now() - 31 * 60_000).toISOString(),
    new Date(Date.now() + 2 * 60_000).toISOString(),
    "not-a-date",
  ]) {
    const selected = selectEnvironmentForPrompt({
      ...environment,
      location: {...environment.location, updatedAt},
    }, "Find somewhere nearby", Date.now());
    assert.equal(selected?.location, undefined);
    assert.equal(selected?.locationEnabled, true);
  }
});

test("location freshness boundaries are deterministic", () => {
  const now = Date.parse("2026-08-21T02:30:00.000Z");
  const selected = (updatedAt: string) => selectEnvironmentForPrompt({
    ...environment,
    location: {...environment.location, updatedAt},
  }, "Find somewhere nearby", now)?.location;
  assert.ok(selected("2026-08-21T02:00:00.000Z"), "exactly 30 minutes old remains fresh");
  assert.equal(selected("2026-08-21T01:59:59.999Z"), undefined);
  assert.ok(selected("2026-08-21T02:31:00.000Z"), "exactly 60 seconds in the future tolerates clock skew");
  assert.equal(selected("2026-08-21T02:31:00.001Z"), undefined);
});

test("the page fast path requires a currently usable browser surface", () => {
  assert.equal(currentPageFastPathAvailable(environment), false);
  assert.equal(currentPageFastPathAvailable({
    ...environment,
    windows: [{ app: "Google Chrome", title: "Policy", frontmost: true }],
  }), true);
  assert.equal(currentPageFastPathAvailable({
    ...environment,
    windows: [{ app: "FlareAI", title: "FlareAI", frontmost: true }],
  }), true);
  assert.equal(currentPageFastPathAvailable({
    ...environment,
    browserTabs: [],
    windows: [{ app: "FlareAI", title: "FlareAI", frontmost: true }],
  }), false);
  assert.equal(currentPageFastPathAvailable({
    ...environment,
    windows: [{ app: "Safari", title: "Policy", frontmost: true }],
  }), false, "unsupported external browsers must not claim an exact read route");
});
