import assert from "node:assert/strict";
import test from "node:test";
import { parseIcsEvents, serializeIcsEvents } from "./ics.js";

test("imports folded, timed, all-day, recurring and alarm event fields", () => {
  const source = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "SUMMARY:Design\\, review",
    "DTSTART;TZID=Asia/Singapore:20260828T093000",
    "DTEND;TZID=Asia/Singapore:20260828T103000",
    "DESCRIPTION:Review the new calen",
    " dar view",
    "RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=4",
    "TRIGGER:-PT15M",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "SUMMARY:Exchange day",
    "DTSTART;VALUE=DATE:20260901",
    "DTEND;VALUE=DATE:20260902",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const parsed = parseIcsEvents(source, "calendar-1");
  assert.equal(parsed.skipped, 0);
  assert.equal(parsed.events.length, 2);
  assert.equal(parsed.events[0]?.title, "Design, review");
  assert.equal(parsed.events[0]?.start, "2026-08-28T01:30:00.000Z");
  assert.deepEqual(parsed.events[0]?.recurrence, {frequency: "weekly", interval: 2, count: 4});
  assert.equal(parsed.events[0]?.alarmMinutes, 15);
  assert.equal(parsed.events[1]?.allDay, true);
});

test("exports standard VEVENT records that can be imported again", () => {
  const text = serializeIcsEvents([{
    id: "event-1",
    calendarId: "calendar-1",
    title: "Planning, notes",
    start: "2026-08-28T01:30:00.000Z",
    end: "2026-08-28T02:30:00.000Z",
    allDay: false,
    notes: "One\nTwo",
    recurrence: {frequency: "weekly", interval: 1},
    alarmMinutes: 10,
    availability: "busy",
    attendees: [],
    editable: true,
  }]);
  assert.match(text, /BEGIN:VCALENDAR\r\nVERSION:2.0/);
  assert.match(text, /SUMMARY:Planning\\, notes/);
  const parsed = parseIcsEvents(text, "calendar-2");
  assert.equal(parsed.events[0]?.title, "Planning, notes");
  assert.equal(parsed.events[0]?.notes, "One\nTwo");
});
