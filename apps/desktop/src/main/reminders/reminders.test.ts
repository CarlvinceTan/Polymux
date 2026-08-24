import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Reminders, type RemindersAccess } from "./index.js";

/**
 * A stand-in for the EventKit helper: the same contract — one JSON object per
 * call — reading its answers from a file the test writes. It is compiled and
 * cached by the real `SwiftHelper`, so these exercise the path the app uses
 * rather than a mock of it. What they cannot exercise is EventKit itself,
 * which needs a grant on the machine running them.
 */
const STUB = `import Foundation
let directory = ProcessInfo.processInfo.environment["POLYMUX_TEST_REMINDERS"] ?? "."
let answers = ((try? String(contentsOfFile: directory + "/answers", encoding: .utf8)) ?? "")
  .split(separator: "\\n").map(String.init)
let tally = directory + "/calls"
let seen = ((try? String(contentsOfFile: tally, encoding: .utf8)) ?? "").count
try? String(repeating: "x", count: seen + 1).write(toFile: tally, atomically: true, encoding: .utf8)
print(seen < answers.count ? answers[seen] : "{\\"ok\\":false,\\"error\\":\\"the test ran out of answers\\"}")
`;

// One source for the whole suite, so it compiles once and each case reuses it.
const root = mkdtempSync(path.join(tmpdir(), "polymux-reminders-"));
const sourcePath = path.join(root, "reminders.swift");
writeFileSync(sourcePath, STUB);
const cacheDirectory = path.join(root, "bin");

function answering(...answers: string[]) {
  const directory = path.join(root, `case-${answers.length}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(directory, {recursive: true});
  writeFileSync(path.join(directory, "answers"), answers.join("\n"));
  writeFileSync(path.join(directory, "calls"), "");
  process.env.POLYMUX_TEST_REMINDERS = directory;
  return {
    reminders: (access: RemindersAccess) =>
      new Reminders({sourcePath, cacheDirectory, access}),
    calls: () => readFileSync(path.join(directory, "calls"), "utf8").length,
  };
}

const allow: RemindersAccess = {ensure: async () => null};

const reason = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

test("a switched-off capability is refused in words, and macOS is never asked", async () => {
  const stub = answering();
  let asked = 0;
  const message = await stub
    .reminders({
      ensure: async () => {
        asked += 1;
        return "reminders access is switched off in Settings → General → Permissions.";
      },
    })
    .list()
    .then(() => "no error", reason);
  assert.match(message, /switched off/);
  assert.equal(asked, 1);
  // Nothing reached the helper: a refusal the user chose needs no round trip.
  assert.equal(stub.calls(), 0);
});

test("a grant that arrives on the second ask is used rather than reported", async () => {
  const stub = answering(
    '{"ok":false,"error":"not-authorized"}',
    '{"ok":true,"result":[{"id":"a","title":"Milk"}]}',
  );
  let prompts = 0;
  const found = await stub
    .reminders({
      // Standing in for the dialog the gate raises between the two calls.
      ensure: async () => {
        prompts += 1;
        return null;
      },
    })
    .list();
  assert.deepEqual(found, [{id: "a", title: "Milk"}]);
  assert.equal(prompts, 2);
  assert.equal(stub.calls(), 2);
});

test("a grant still missing after asking says where to change it", async () => {
  const stub = answering(
    '{"ok":false,"error":"not-authorized"}',
    '{"ok":false,"error":"not-authorized"}',
  );
  const message = await stub.reminders(allow).list().then(() => "no error", reason);
  assert.match(message, /System Settings/);
  // Twice and no more: macOS shows its dialog once, so a third call to the
  // helper could only ever return the same refusal.
  assert.equal(stub.calls(), 2);
});

test("a real failure is reported as itself rather than retried as a grant", async () => {
  const stub = answering('{"ok":false,"error":"There is no default reminders list on this Mac"}');
  const message = await stub.reminders(allow).list().then(() => "no error", reason);
  assert.equal(message, "There is no default reminders list on this Mac");
  assert.equal(stub.calls(), 1);
});

test("a created reminder comes back as the helper stored it", async () => {
  const stub = answering('{"ok":true,"result":{"id":"a","title":"Call the vet","list":"Tasks"}}');
  const created = await stub.reminders(allow).create({title: "Call the vet"});
  assert.deepEqual(created, {id: "a", title: "Call the vet", list: "Tasks"});
});
