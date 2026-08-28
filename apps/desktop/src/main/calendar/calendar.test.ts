import assert from "node:assert/strict";
import {mkdtemp, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {NativeCalendar} from "./index.js";

const fake = `
import Foundation
let action = CommandLine.arguments[1]
let payload = (try? JSONSerialization.jsonObject(with: Data(CommandLine.arguments[2].utf8))) as? [String: Any] ?? [:]
if action == "calendars" {
  print("{\\"ok\\":true,\\"result\\":[{\\"id\\":\\"cal-1\\",\\"title\\":\\"Home\\",\\"color\\":\\"#4488FF\\",\\"editable\\":true,\\"subscribed\\":false,\\"source\\":{\\"id\\":\\"icloud\\",\\"title\\":\\"iCloud\\",\\"kind\\":\\"icloud\\"}}]}")
} else if action == "snapshot" {
  print("{\\"ok\\":true,\\"result\\":{\\"calendars\\":[{\\"id\\":\\"cal-1\\",\\"title\\":\\"Home\\",\\"color\\":\\"#4488FF\\",\\"editable\\":true,\\"subscribed\\":false,\\"source\\":{\\"id\\":\\"icloud\\",\\"title\\":\\"iCloud\\",\\"kind\\":\\"icloud\\"}}],\\"events\\":[]}}")
} else if action == "import" {
  let count = (payload["events"] as? [[String: Any]])?.count ?? 0
  print("{\\"ok\\":true,\\"result\\":{\\"imported\\":\\(count),\\"skipped\\":0}}")
} else if action == "create" {
  let title = payload["title"] as? String ?? ""
  print("{\\"ok\\":true,\\"result\\":{\\"id\\":\\"event-1\\",\\"calendarId\\":\\"cal-1\\",\\"title\\":\\"\\(title)\\",\\"start\\":\\"2026-08-28T01:00:00.000Z\\",\\"end\\":\\"2026-08-28T02:00:00.000Z\\",\\"allDay\\":false,\\"availability\\":\\"busy\\",\\"attendees\\":[],\\"editable\\":true}}")
} else if action == "update" {
  let cleared = payload["location"] is NSNull ? "cleared" : "not-cleared"
  print("{\\"ok\\":true,\\"result\\":{\\"id\\":\\"event-1\\",\\"calendarId\\":\\"cal-1\\",\\"title\\":\\"\\(cleared)\\",\\"start\\":\\"2026-08-28T01:00:00.000Z\\",\\"end\\":\\"2026-08-28T02:00:00.000Z\\",\\"allDay\\":false,\\"availability\\":\\"busy\\",\\"attendees\\":[],\\"editable\\":true}}")
} else {
  print("{\\"ok\\":true,\\"result\\":[]}")
}
`;

test("reads calendars and validates event writes before invoking EventKit", async (t) => {
  if (process.platform !== "darwin") return t.skip("Swift EventKit helper is macOS-only");
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-calendar-"));
  const sourcePath = path.join(directory, "calendar.swift");
  await writeFile(sourcePath, fake);
  const calendar = new NativeCalendar({sourcePath, cacheDirectory: path.join(directory, "bin"), access: {ensure: async () => null}});
  t.after(() => calendar.close());
  assert.equal((await calendar.calendars())[0]?.source.kind, "icloud");
  const snapshot = await calendar.snapshot("2026-08-01T00:00:00Z", "2026-09-01T00:00:00Z");
  assert.equal(snapshot.calendars[0]?.title, "Home");
  assert.ok(Date.parse(snapshot.fetchedAt) > 0);
  const created = await calendar.create({
    calendarId: "cal-1", title: "Planning", start: "2026-08-28T01:00:00Z",
    end: "2026-08-28T02:00:00Z", allDay: false,
  });
  assert.equal(created.title, "Planning");
  assert.equal((await calendar.update("event-1", {location: null})).title, "cleared");
  const imported = await calendar.importIcs([
    "BEGIN:VCALENDAR", "BEGIN:VEVENT", "SUMMARY:Imported", "DTSTART:20260828T010000Z",
    "DTEND:20260828T020000Z", "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n"), "cal-1", "events.ics");
  assert.deepEqual(imported, {imported: 1, skipped: 0, fileName: "events.ics"});
  await assert.rejects(() => calendar.create({calendarId: "cal-1", title: "", start: "bad", end: "bad", allDay: false}));
});
