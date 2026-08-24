import assert from "node:assert/strict";
import test from "node:test";
import type { Skill } from "../src/skills/types.js";
import { selectSkillsForPrompt } from "../src/context/skill-selection.js";

const skill = (name: string, description: string): Skill => ({
  name,
  description,
  filePath: `/${name}/SKILL.md`,
  baseDir: `/${name}`,
  disableModelInvocation: false,
  source: "official",
});
const personalSkill = (name: string, description: string): Skill => ({
  ...skill(name, description),
  source: "polymux",
});

const skills = [
  skill("computer-use", "Use websites, apps, tabs, windows, and recent computer history."),
  skill("drive-use", "Safely find and manage files and folders in Google Drive."),
  skill("hub-use", "Read email and reply across inboxes, WhatsApp, WeChat, and personal chats."),
  skill("chat-style", "Draft a short personal chat reply in the user's style."),
  skill("skill-maintenance", "Safely review, update, or remove installed personal skills."),
  skill("pdf", "Read and edit PDF documents."),
  skill("unrelated-specialist", "Tune a hydroponic irrigation controller."),
];

test("realistic prompts expose only skills useful to the coordinator", () => {
  assert.deepEqual(
    selectSkillsForPrompt(skills, "Find the latest events from NUSync").map((item) => item.name),
    ["computer-use"],
  );
  assert.deepEqual(
    selectSkillsForPrompt(skills, "Reply to Dad and say I will arrive at 7").map((item) => item.name),
    ["hub-use", "chat-style"],
  );
  assert.deepEqual(
    selectSkillsForPrompt(skills, "Continue what I was doing before I switched").map((item) => item.name),
    ["computer-use"],
  );
});

test("explicit artifact words retain their specialist without unrelated skills", () => {
  assert.deepEqual(
    selectSkillsForPrompt(skills, "Review this PDF").map((item) => item.name),
    ["computer-use", "pdf"],
  );
});

test("Google Drive requests retain the core Drive workflow", () => {
  assert.deepEqual(
    selectSkillsForPrompt(skills, "Find the project folder in my Google Drive").map((item) => item.name),
    ["drive-use"],
  );
  assert.deepEqual(
    selectSkillsForPrompt(skills, "Open that Drive file in the browser").map((item) => item.name),
    ["computer-use", "drive-use"],
  );
});

test("change detection exposes independent public and personal evidence skills", () => {
  assert.deepEqual(
    selectSkillsForPrompt(skills, "Has anything changed that affects my Singapore plans?").map((item) => item.name),
    ["computer-use", "hub-use"],
  );
});

test("latest communication requests do not acquire an unrelated browser workflow", () => {
  assert.deepEqual(
    selectSkillsForPrompt(skills, "Check my inbox for the latest email from NUS").map((item) => item.name),
    ["hub-use"],
  );
  assert.deepEqual(
    selectSkillsForPrompt(skills, "What did Dad message me most recently?").map((item) => item.name),
    ["hub-use", "chat-style"],
  );
  assert.deepEqual(
    selectSkillsForPrompt(skills, "Search the web and my email for the latest NUS update").map((item) => item.name),
    ["computer-use", "hub-use"],
  );
});

test("natural time, reminder, and communication wording retains the intended workflows", () => {
  assert.deepEqual(
    selectSkillsForPrompt(skills, "Find the best events this weekend from NUSync and student group pages").map((item) => item.name),
    ["computer-use"],
  );
  const reminderSkills = [skill("apple-reminders", "Create and inspect Apple Reminders."), ...skills];
  assert.deepEqual(
    selectSkillsForPrompt(reminderSkills, "Make sure I don't forget to submit my exchange form tomorrow morning").map((item) => item.name),
    ["apple-reminders"],
  );
  assert.deepEqual(
    selectSkillsForPrompt(skills, "See if there's anything from NUS I need to respond to today").map((item) => item.name),
    ["hub-use", "chat-style"],
  );
});

test("an unmatched prompt returns no guesses so the worker can use full fallback", () => {
  assert.deepEqual(selectSkillsForPrompt(skills, "Think about the tradeoff"), []);
  assert.deepEqual(selectSkillsForPrompt(skills, "Can you explain what this is?"), []);
});

test("natural maintenance wording retains the protected skill workflow", () => {
  assert.deepEqual(
    selectSkillsForPrompt(
      skills,
      "Can you look over my installed skills and see if stale dependencies would get in the way of removing one?",
    ).map((item) => item.name),
    ["skill-maintenance"],
  );
  assert.deepEqual(
    selectSkillsForPrompt(skills, "Review the personal skill before removal").map((item) => item.name),
    ["skill-maintenance"],
  );
});

test("verbose personal skills require direct prompt overlap instead of expanded topic aliases", () => {
  const catalogue = [
    ...skills,
    personalSkill("job-search", "Find and rank software engineering jobs and applications."),
    personalSkill("notion", "Create and organise project trackers in Notion."),
    personalSkill("research", "Route substantial multi-source web and community research."),
    personalSkill("travel-planner", "Plan trips, compare hotels, and build travel itineraries."),
  ];
  assert.deepEqual(
    selectSkillsForPrompt(catalogue, "Find the latest events from NUSync").map((item) => item.name),
    ["computer-use"],
  );
  const broadWorkspaceCatalogue = [
    ...skills,
    personalSkill("workspace-notes", "Manage pages, projects, trackers, plans, and shortlists in a personal workspace."),
  ];
  assert.deepEqual(
    selectSkillsForPrompt(broadWorkspaceCatalogue, "Find the best events this weekend from student group pages, then give me a ranked shortlist").map((item) => item.name),
    ["computer-use"],
  );
  assert.deepEqual(
    selectSkillsForPrompt(catalogue, "Do a job search for software engineering roles").map((item) => item.name),
    ["computer-use", "job-search"],
  );
  assert.deepEqual(
    selectSkillsForPrompt(catalogue, "Create a project tracker in Notion").map((item) => item.name),
    ["notion"],
  );
  assert.deepEqual(
    selectSkillsForPrompt(catalogue, "Plan a trip and compare hotels").map((item) => item.name),
    ["travel-planner"],
  );
  const noisy = [
    ...catalogue,
    personalSkill("remote-control", "Check whether the user can operate remote computers before a handoff."),
  ];
  assert.deepEqual(
    selectSkillsForPrompt(noisy, "Find a couple of NUS events this weekend and check whether I have anything to reply to").map((item) => item.name),
    ["computer-use", "hub-use", "chat-style"],
  );
});

test("configuration-derived skill routing handles inflection without domain hard-codes", () => {
  const catalogue = [
    ...skills,
    personalSkill("job-search", "Manage jobs, internships, applications, and software engineering roles."),
    personalSkill("notion", "Create and organise project trackers in Notion."),
    personalSkill("travel-planner", "Coordinate trip planning, hotel comparisons, and itineraries."),
    personalSkill("email", "Use email for research, recent correspondence, bookings, and applications."),
    personalSkill("research", "Route substantial web and community research."),
  ];
  assert.deepEqual(
    selectSkillsForPrompt(catalogue, "Find software engineering internships for 2027").map((item) => item.name),
    ["computer-use", "job-search"],
  );
  assert.deepEqual(
    selectSkillsForPrompt(catalogue, "Update my job tracker in Notion").map((item) => item.name),
    ["job-search", "notion"],
  );
  assert.deepEqual(
    selectSkillsForPrompt(catalogue, "Plan a trip to Tokyo and compare hotels").map((item) => item.name),
    ["travel-planner"],
  );
  assert.deepEqual(
    selectSkillsForPrompt(catalogue, "Research recent community opinions about local AI models").map((item) => item.name),
    ["computer-use", "research"],
  );
});

test("a concrete configured workflow is not hidden merely because the prompt says this", () => {
  const catalogue = [
    ...skills,
    personalSkill("job-search", "Manage internships, applications, interviews, and software roles."),
    personalSkill("video-editing", "Edit interviews and videos in DaVinci Resolve, including pacing and captions."),
  ];
  assert.deepEqual(
    selectSkillsForPrompt(catalogue, "Tighten the pacing of this interview in DaVinci Resolve").map((item) => item.name),
    ["video-editing"],
  );
  assert.deepEqual(selectSkillsForPrompt(catalogue, "Can you explain what this is?"), []);
});

test("renamed official workflows suppress duplicate personal counterparts unless explicitly named", () => {
  const catalogue = [
    ...skills,
    personalSkill("email", "Route email and inbox research."),
    personalSkill("message", "Handle messages and WhatsApp accounts."),
    personalSkill("window-control", "Control exact app windows without focus."),
  ];
  assert.deepEqual(
    selectSkillsForPrompt(catalogue, "Check my email inbox").map((item) => item.name),
    ["hub-use"],
  );
  assert.deepEqual(
    selectSkillsForPrompt(catalogue, "Reply to Dad on WhatsApp").map((item) => item.name),
    ["hub-use", "chat-style"],
  );
  assert.deepEqual(
    selectSkillsForPrompt(catalogue, "Use the email skill to check my inbox").map((item) => item.name),
    ["hub-use", "email"],
  );
});
