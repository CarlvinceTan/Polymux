import assert from "node:assert/strict";
import test from "node:test";
import {finalAnswerQualityIssues} from "../src/context/final-answer-quality.js";

test("flags visible model scratch work without rejecting an ordinary result", () => {
  assert.deepEqual(
    finalAnswerQualityIssues(
      "Find events",
      "**Considering verified events**\n\nI should focus on current options.\n\nHere are three events.",
    ),
    ["Remove the visible internal deliberation and begin directly with the result."],
  );
  assert.deepEqual(finalAnswerQualityIssues("Explain planning algorithms", "Planning algorithms choose actions."), []);
  assert.deepEqual(
    finalAnswerQualityIssues(
      "Check whether the server is ready",
      "**Clarifying functionality**\n\nI think I need to convey the blocker clearly.\n\nThe host is reachable.",
    ),
    ["Remove the visible internal deliberation and begin directly with the result."],
  );
  assert.deepEqual(
    finalAnswerQualityIssues(
      "Find a quiet place nearby",
      "**Considering backup options**\n\nI need to find a genuinely separate backup.\n\nBest option: A.",
    ),
    ["Remove the visible internal deliberation and begin directly with the result."],
  );
  assert.deepEqual(
    finalAnswerQualityIssues(
      "Find the latest events",
      "**Filtering actionable events**\n\n**Listing verified events with links**\n\nHere are the current options.",
    ),
    ["Remove the visible internal deliberation and begin directly with the result."],
  );
  assert.deepEqual(
    finalAnswerQualityIssues(
      "Find the latest events",
      "**Planning verified event inclusion**\nAs of today, these are the relevant events.",
    ),
    ["Remove the visible internal deliberation and begin directly with the result."],
  );
  assert.deepEqual(
    finalAnswerQualityIssues(
      "Find the latest events",
      "**Compiling concise event summary**\nAs of today, these are the relevant events.",
    ),
    ["Remove the visible internal deliberation and begin directly with the result."],
  );
});

test("flags ongoing-before-upcoming ranking only for live recommendation prompts", () => {
  assert.equal(
    finalAnswerQualityIssues("Find the latest events for me", "### Ongoing\nA\n### Upcoming\nB").length,
    1,
  );
  assert.deepEqual(
    finalAnswerQualityIssues("Summarise this report", "Ongoing work is followed by upcoming work."),
    [],
  );
  assert.deepEqual(
    finalAnswerQualityIssues("Find upcoming workshops", "### Upcoming\nB\n### Ongoing\nA"),
    [],
  );
});

test("personal discovery requires demonstrated relevance and verified eligibility", () => {
  const prompt = "Find the latest events from NUSync that I might be interested in";
  const issues = finalAnswerQualityIssues(prompt, [
    "1. Powerlifting training",
    "Restricted to specific members.",
    "2. Dental exchange",
    "An overseas programme.",
  ].join("\n"));
  assert.ok(issues.some((issue) => /eligibility is restricted/i.test(issue)));
  assert.ok(issues.some((issue) => /concrete user-context reason/i.test(issue)));
  assert.deepEqual(finalAnswerQualityIssues(prompt, [
    "1. AI builders meetup",
    "This matches your interest in agent products and current software work.",
  ].join("\n")), []);
  assert.ok(finalAnswerQualityIssues(prompt, [
    "- University exchange programme",
    "Relevant because you are studying at one of the participating universities and are currently on exchange.",
  ].join("\n")).some((issue) => /shared identity, institution, location, or logistics/i.test(issue)));
  assert.deepEqual(finalAnswerQualityIssues(prompt, [
    "- Distributed systems workshop",
    "Relevant because it helps you build skills for your backend engineering goal.",
  ].join("\n")), []);
  assert.deepEqual(finalAnswerQualityIssues(prompt, [
    "I found no strong match.",
    "The exchange programme is not relevant because it only shares your university and exchange context; its actual activity does not match a known interest.",
  ].join("\n")), []);
});

test("rejects the full incidental exchange-programme recommendation pattern", () => {
  const prompt = "Find the latest events from NUSync that I might be interested in";
  const answer = [
    "Here are the strongest current matches:",
    "",
    "1. **Friday Hacks #297 — Evaluating AI Agents**",
    "   - Strong fit with your agent-evaluation work and software-engineering goals.",
    "   - [Event page](https://nusync.nus.edu.sg/hackers/rsvp_boot?id=382691)",
    "",
    "2. **NUS–UM Exchange Programme**",
    "   - Directly relevant to your University of Melbourne",
    "     exchange plans.",
    "   - [Event page](https://nusync.nus.edu.sg/dentalclub/rsvp_boot?id=382526)",
  ].join("\n");
  assert.ok(finalAnswerQualityIssues(prompt, answer).some((issue) =>
    /shared identity, institution, location, or logistics/i.test(issue)));
});

test("rejects speculative personal matches inferred from labels", () => {
  const prompt = "Find events I might be interested in";
  assert.ok(finalAnswerQualityIssues(prompt, [
    "- **Electronic Lab orientation**",
    "  Because you build software, this lab-branded activity is a plausible fit.",
  ].join("\n")).some((issue) => /only plausible/i.test(issue)));
  assert.ok(finalAnswerQualityIssues(prompt, [
    "- **Founders Circle breakfast**",
    "  This could appeal to your product work because the host calls itself a founders group.",
  ].join("\n")).some((issue) => /only plausible/i.test(issue)));
  assert.deepEqual(finalAnswerQualityIssues(prompt, [
    "- **Agent reliability workshop**",
    "  The verified agenda covers evaluation harnesses and tool-call tracing, matching your current agent-evaluation work.",
  ].join("\n")), []);
});

test("rejects named ranked fallbacks that the answer admits are infeasible", () => {
  const prompt = "Find a quiet place nearby and tell me the best option plus one backup";
  assert.equal(finalAnswerQualityIssues(prompt, [
    "**Best option: Central Library**",
    "I couldn't verify tonight's closing time.",
    "**Backup: Cafe**",
    "It is already closed and not usable tonight.",
  ].join("\n")).length, 1);
  assert.deepEqual(finalAnswerQualityIssues(
    prompt,
    "I couldn't verify any place that satisfies quietness, laptop seating, and the full time window, so I don't have a defensible best option or backup.",
  ), []);
  assert.deepEqual(finalAnswerQualityIssues(
    "List two cafes I can consider tomorrow",
    "Cafe A is open tomorrow. Cafe B has unknown hours.",
  ), []);
  assert.ok(finalAnswerQualityIssues(prompt, [
    "**Best option:** Library",
    "[Official details](https://library.example/hours)",
    "**Backup:** Cafe",
    "Its current hours are unverified.",
  ].join("\n")).some((issue) => /Do not present a named/i.test(issue)));
});

test("rejects a named option whose stated closing time cannot fit the requested window", () => {
  const prompt = "I have about two hours. Find the best quiet place nearby plus one backup.";
  const time = {instant: "2026-08-21T14:17:00.000Z", timeZone: "Asia/Singapore"};
  assert.equal(finalAnswerQualityIssues(
    prompt,
    "**Best option: Library**\n[Official details](https://library.example/hours)\nHours today: open until 9:00 pm, which fits your two-hour window.",
    time,
  ).length, 1);
  assert.deepEqual(finalAnswerQualityIssues(
    prompt,
    "**Best option: Late Library**\n[Official details](https://library.example/hours)\nHours today: open until 1:00 am.",
    time,
  ), []);
  assert.equal(finalAnswerQualityIssues(
    prompt,
    "**Best option: Cafe**\n[Official details](https://cafe.example/hours)\nHours today: open until 11:00 pm.",
    time,
  ).length, 1, "closing before the full two-hour window is not a fit");
});

test("rejects map-only named recommendations as unverified discovery leads", () => {
  const prompt = "Find the best nearby cafe plus one backup";
  assert.equal(finalAnswerQualityIssues(
    prompt,
    "**Best option: Cafe A**\n[Map](https://www.google.com/maps/search/?api=1&query=Cafe+A)",
  ).length, 1);
  assert.deepEqual(finalAnswerQualityIssues(
    prompt,
    "**Best option: Cafe A**\n[Official details](https://cafe-a.example/hours)",
  ), []);
});

test("rejects a ranked place that contradicts an explicit quietness requirement", () => {
  const prompt = "Find a quiet place nearby and tell me the best option plus one backup";
  assert.equal(finalAnswerQualityIssues(prompt, [
    "**Best option: Study Hub**",
    "[Official details](https://example.edu/study-hub)",
    "The venue has a constant buzz, so choose a corner if quietness matters.",
  ].join("\n")).length, 1);
  assert.equal(finalAnswerQualityIssues(prompt, [
    "**Best option: Cafe**",
    "[Official details](https://example.edu/cafe)",
    "It may be less quiet than the study hub.",
  ].join("\n")).length, 1);
});

test("rejects a same-venue backup and nearby claims without travel evidence", () => {
  const prompt = "Find a quiet place nearby and tell me the best option plus one backup";
  const answer = [
    "**Best option: Medicine+Science Library — Level 2**",
    "Quiet study area.",
    "**Backup: Medicine+Science Library — Atrium**",
    "Less guaranteed to be quiet.",
  ].join("\n");
  const issues = finalAnswerQualityIssues(prompt, answer, undefined, {
    resolvedCurrentLocation: true,
  });
  assert.ok(issues.some((issue) => /distinct backup/i.test(issue)));
  assert.ok(issues.some((issue) => /travel distance or time/i.test(issue)));
  assert.ok(issues.some((issue) => /explicit quietness/i.test(issue)));
});
