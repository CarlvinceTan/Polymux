import assert from "node:assert/strict";
import test from "node:test";
import { directFastPathGroup, shouldUseDirectFastPath } from "../src/context/delegation-strategy.js";

test("short explicit single-domain actions use the direct fast path", () => {
  assert.equal(shouldUseDirectFastPath("Remind me tomorrow at 8 to submit the form"), true);
  assert.equal(shouldUseDirectFastPath("Draft an email to Dad saying I will arrive at 7"), true);
  assert.equal(shouldUseDirectFastPath("List my unread email"), true);
  assert.equal(directFastPathGroup("List my unread email"), "email-read");
  assert.equal(directFastPathGroup("Reply to Dad and say I will arrive at 7"), "messages");
  assert.equal(
    directFastPathGroup("Make sure I don't forget to submit my exchange form tomorrow morning"),
    "reminders",
  );
});

test("single-site discovery is direct while multi-source and implicit-screen work keep orchestration", () => {
  assert.equal(directFastPathGroup("Find the latest events from NUSync that I might be interested in"), "browser-research");
  assert.equal(directFastPathGroup("Show me upcoming workshops on Eventbrite"), "browser-research");
  assert.equal(directFastPathGroup("Find a few upcoming University of Melbourne events I might be interested in"), "browser-research");
  assert.equal(directFastPathGroup("Also find the official opening hours for NUS Central Library today"), "browser-research");
  assert.equal(directFastPathGroup("Check the registration deadline on the conference website"), "browser-research");
  assert.equal(directFastPathGroup("Find events from NUSync and also check my messages"), undefined);
  assert.equal(directFastPathGroup("Compare events from NUSync with Eventbrite"), undefined);
  assert.equal(shouldUseDirectFastPath("Check email and WhatsApp for anything important"), false);
  assert.equal(shouldUseDirectFastPath("Move the file I have open into that folder"), false);
  assert.equal(directFastPathGroup("Continue what I was doing where I left off"), "resume");
  assert.equal(shouldUseDirectFastPath("Move the file to Google Drive"), false);
  assert.equal(shouldUseDirectFastPath("Open the file from that website"), false);
  assert.equal(shouldUseDirectFastPath("Remember what I said about exchange forms"), false);
});

test("one local recommendation stays direct while compound local work keeps orchestration", () => {
  for (const prompt of [
    "I've got about two hours before my next thing. Find me a quiet place nearby where I can sit with a laptop, and tell me the best option plus one backup.",
    "Find a good cafe near me that is open now",
    "Show me the closest library where I can work",
  ]) assert.equal(directFastPathGroup(prompt), "browser-research", prompt);
  for (const prompt of [
    "Compare cafes nearby across several review sites",
    "Find a cafe near me and also check my calendar",
    "Find the closest restaurant and book it",
  ]) assert.equal(directFastPathGroup(prompt), undefined, prompt);
});

test("an exact current-page explanation is direct but browser mutations and history are not", () => {
  assert.equal(
    directFastPathGroup("Can you explain what this is and whether it matters for me?"),
    undefined,
  );
  assert.equal(
    directFastPathGroup("Can you explain what this is and whether it matters for me?", { currentPageAvailable: true }),
    "browser-read",
  );
  assert.equal(directFastPathGroup("Read this page and tell me what it means", { currentPageAvailable: true }), "browser-read");
  assert.equal(directFastPathGroup("Fill this form in and stop before submitting"), undefined);
  assert.equal(directFastPathGroup("Continue what I was doing before I switched to this"), "resume");
  assert.equal(directFastPathGroup("Compare this page with the latest rules"), undefined);
});

test("previous-work recovery generalises across ordinary paraphrases", () => {
  for (const prompt of [
    "Carry on from where I left off",
    "Go back to the task I was on before opening this",
    "Finish the thing I had open before switching apps",
    "Resume my previous task",
    "Pick up what I was working on",
  ]) assert.equal(directFastPathGroup(prompt), "resume", prompt);
  for (const prompt of [
    "Go back to Singapore next month",
    "Finish this form",
    "What was my previous task?",
    "Carry on with the research and compare several sources",
  ]) assert.notEqual(directFastPathGroup(prompt), "resume", prompt);
});

test("a contextual communication follow-up stays with the main agent", () => {
  const prompt = "Draft replies to the ones that actually need me, but don't send anything";
  assert.equal(directFastPathGroup(prompt, {hasPriorAssistant: true}), "communications");
  assert.equal(directFastPathGroup(prompt), undefined);
});

test("attachments and goals never bypass orchestration", () => {
  assert.equal(shouldUseDirectFastPath("Review this PDF", { hasAttachments: true }), false);
  assert.equal(shouldUseDirectFastPath("Remind me every week", { asGoal: true }), false);
});

test("realistic routing corpus preserves the direct-orchestrated boundary", () => {
  const cases: Array<[string, string | undefined]> = [
    ["Remind me at 8 tomorrow to call Mum", "reminders"],
    ["Make sure I don’t forget to renew my pass next Monday", "reminders"],
    ["List my unread emails", "email-read"],
    ["Draft an email asking for the receipt", "email"],
    ["Reply to Dad that I am downstairs", "messages"],
    ["Read my latest WhatsApp message", "messages-read"],
    ["Read the latest message from Dad", "messages-read"],
    ["What did Dad message me most recently?", "messages-read"],
    ["Read my latest email", "email-read"],
    ["Show my schedule for tomorrow", "schedule"],
    ["Move the file report.pdf into the reports folder", "files"],
    ["Find the latest events from NUSync for me", "browser-research"],
    ["Has anything changed that affects my Singapore plans?", undefined],
    ["Check email and WhatsApp for anything urgent", undefined],
    ["See if there is anything from NUS I need to respond to today", undefined],
    ["Fill this form in and stop before submitting", undefined],
    ["Put the file I have open in the right folder", undefined],
    ["Email Dad the file called report.pdf", undefined],
    ["Move report.pdf to OneDrive", undefined],
    ["Search my email for the booking and compare it with the calendar", undefined],
    ["Review the attached document", undefined],
  ];
  for (const [prompt, expected] of cases)
    assert.equal(directFastPathGroup(prompt), expected, prompt);
});

test("an immediate discovery follow-up stays direct without making arbitrary pronouns direct", () => {
  assert.equal(
    directFastPathGroup(
      "Which one would you pick for me if I can only go on Friday evening, and what would I need to bring?",
      { previousDirectGroup: "browser-research" },
    ),
    "browser-research",
  );
  assert.equal(directFastPathGroup("Which one should I pick?"), undefined);
  assert.equal(
    directFastPathGroup("Which one should I pick after checking my email?", { previousDirectGroup: "browser-research" }),
    undefined,
  );
});
