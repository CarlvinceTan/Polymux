import assert from "node:assert/strict";
import { test } from "node:test";
import type { JsonValue, ScheduleDto } from "@polymux/protocol";
import { nextRunAfter } from "./time.js";
import { Scheduler, type SchedulePreferences } from "./index.js";

/** The preference store, as a map. */
function store(): SchedulePreferences & {values: Map<string, JsonValue>} {
  const values = new Map<string, JsonValue>();
  return {
    values,
    getPreference: (key) => values.has(key) ? {value: values.get(key)!} : null,
    setPreference: (key, value) => values.set(key, value),
  };
}

/** A clock and a timer queue the test drives by hand, so nothing waits. */
function fakeClock(start: number) {
  let now = start;
  let pending: Array<{at: number; callback: () => void}> = [];
  return {
    now: () => now,
    schedule: ((callback: () => void, delay: number) => {
      const entry = {at: now + delay, callback};
      pending.push(entry);
      return entry as unknown as ReturnType<typeof setTimeout>;
    }),
    cancelSchedule: ((timer: ReturnType<typeof setTimeout>) => {
      pending = pending.filter((entry) => entry !== (timer as unknown as {at: number}));
    }),
    /** Moves the clock and fires whatever that reaches. */
    advance(ms: number) {
      now += ms;
      const due = pending.filter((entry) => entry.at <= now);
      pending = pending.filter((entry) => entry.at > now);
      for (const entry of due) entry.callback();
    },
  };
}

const ZONE = "Australia/Sydney";

test("a daily cadence lands on the next matching wall-clock time", () => {
  const anchor = Date.parse("2026-03-02T00:00:00+11:00");
  const after = Date.parse("2026-03-02T10:00:00+11:00");
  const next = nextRunAfter({kind: "daily", time: "08:00", timeZone: ZONE}, after, anchor);
  assert.equal(new Date(next!).toISOString(), new Date(Date.parse("2026-03-03T08:00:00+11:00")).toISOString());
});

test("a wall-clock time survives a daylight saving change", () => {
  // Sydney leaves daylight saving on 5 April 2026: 08:00 stays 08:00 locally,
  // which is a different UTC instant on either side of it.
  const anchor = Date.parse("2026-04-01T00:00:00+11:00");
  const before = nextRunAfter({kind: "daily", time: "08:00", timeZone: ZONE}, Date.parse("2026-04-03T09:00:00+11:00"), anchor);
  const afterChange = nextRunAfter({kind: "daily", time: "08:00", timeZone: ZONE}, Date.parse("2026-04-06T09:00:00+10:00"), anchor);
  const reads = (epoch: number) =>
    new Intl.DateTimeFormat("en-GB", {timeZone: ZONE, hour: "2-digit", minute: "2-digit", hour12: false}).format(new Date(epoch));
  assert.equal(reads(before!), "08:00");
  assert.equal(reads(afterChange!), "08:00");
});

test("a weekday schedule skips the weekend", () => {
  const anchor = Date.parse("2026-03-02T00:00:00+11:00");
  // Friday afternoon: the next weekday firing is Monday.
  const next = nextRunAfter(
    {kind: "weekly", days: [1, 2, 3, 4, 5], time: "08:00", timeZone: ZONE},
    Date.parse("2026-03-06T12:00:00+11:00"),
    anchor,
  );
  assert.equal(new Date(next!).getUTCDay(), 0); // Monday 08:00 in Sydney is Sunday in UTC
  assert.equal(
    new Intl.DateTimeFormat("en-GB", {timeZone: ZONE, weekday: "short"}).format(new Date(next!)),
    "Mon",
  );
});

test("a monthly schedule skips months without the requested day", () => {
  const anchor = Date.parse("2026-01-31T00:00:00+11:00");
  const next = nextRunAfter(
    {kind: "monthly", dayOfMonth: 31, time: "09:00", timeZone: ZONE},
    Date.parse("2026-01-31T10:00:00+11:00"),
    anchor,
  );
  // February has no 31st, so March is the next one rather than a clamped 28th.
  assert.equal(new Intl.DateTimeFormat("en-GB", {timeZone: ZONE, month: "short", day: "numeric"}).format(new Date(next!)), "31 Mar");
});

test("a cron expression drives the schedule like any other cadence", async () => {
  const clock = fakeClock(Date.parse("2026-03-02T09:59:00+11:00"));
  const runs: string[] = [];
  const scheduler = new Scheduler(store(), async (schedule) => {
    runs.push(schedule.title);
    return {summary: "Checked."};
  }, clock);
  // Every fifteen minutes, on weekdays only — a cadence no picker can say.
  scheduler.create({
    title: "Quarter-hourly sweep",
    prompt: "Check the queue.",
    frequency: {kind: "cron", expression: "*/15 * * * 1-5", timeZone: ZONE},
  });
  scheduler.start();
  clock.advance(61_000);
  await settle();

  assert.deepEqual(runs, ["Quarter-hourly sweep"]);
  const [item] = scheduler.list();
  assert.equal(item.history[0].outcome, "succeeded");
  // The next one is the following quarter hour, not a day later.
  assert.ok(item.nextRunAt! - clock.now() <= 15 * 60_000);
});

test("keeps firing with no window to report to", async () => {
  const clock = fakeClock(Date.parse("2026-03-02T07:59:00+11:00"));
  let fired = 0;
  // The scheduler holds no window and no Electron object: the only thing that
  // touches one is the change notification the backend subscribes with, and a
  // subscriber that throws — as sending to a destroyed window would — must not
  // take the run down with it. Closing every window leaves the clock running;
  // only quitting stops it.
  const scheduler = new Scheduler(store(), async () => { fired += 1; return {}; }, clock);
  scheduler.subscribe(() => { throw new Error("No window to send to"); });
  scheduler.create({title: "Brief", prompt: "Do it.", frequency: {kind: "daily", time: "08:00", timeZone: ZONE}});
  scheduler.start();

  clock.advance(61_000);
  await settle();
  assert.equal(fired, 1);
  assert.equal(scheduler.list()[0].history[0].outcome, "succeeded");
});

/**
 * A laptop asleep through a firing wakes with the run overdue rather than
 * never due: the timer measured against a clock that stopped counting, so the
 * tick compares wall time instead of trusting the delay it was given.
 */
test("fires a run the machine slept through, once", async () => {
  const clock = fakeClock(Date.parse("2026-03-02T07:59:00+11:00"));
  let fired = 0;
  const scheduler = new Scheduler(store(), async () => { fired += 1; return {}; }, clock);
  scheduler.create({title: "Brief", prompt: "Do it.", frequency: {kind: "daily", time: "08:00", timeZone: ZONE}});
  scheduler.start();

  // Asleep from just before 08:00 until the afternoon.
  clock.advance(8 * 3_600_000);
  await settle();
  assert.equal(fired, 1);
  const [item] = scheduler.list();
  assert.ok(item.nextRunAt! > clock.now());
});

test("a one-off that has passed has no next run", () => {
  const at = Date.parse("2026-03-01T09:00:00+11:00");
  assert.equal(nextRunAfter({kind: "once", at}, at + 1, at), undefined);
});

test("a due schedule fires, records its summary and advances", async () => {
  const clock = fakeClock(Date.parse("2026-03-02T07:59:00+11:00"));
  const runs: string[] = [];
  const scheduler = new Scheduler(
    store(),
    async (schedule) => {
      runs.push(schedule.prompt);
      return {summary: "Read 4 messages.", conversationId: "chat-1", runId: "run-1"};
    },
    clock,
  );
  scheduler.create({
    title: "Morning brief",
    prompt: "Summarise my inbox.",
    frequency: {kind: "daily", time: "08:00", timeZone: ZONE},
  });
  scheduler.start();

  clock.advance(61_000);
  await settle();

  assert.deepEqual(runs, ["Summarise my inbox."]);
  const [item] = scheduler.list();
  assert.equal(item.status, "active");
  assert.equal(item.unread, true);
  assert.equal(item.history[0].outcome, "succeeded");
  assert.equal(item.history[0].summary, "Read 4 messages.");
  assert.equal(item.history[0].conversationId, "chat-1");
  // The next run is tomorrow, not a moment later.
  assert.ok(item.nextRunAt! - clock.now() > 23 * 3_600_000);
});

test("a failing run is recorded and does not stop the cadence", async () => {
  const clock = fakeClock(Date.parse("2026-03-02T07:59:00+11:00"));
  const scheduler = new Scheduler(
    store(),
    async () => { throw new Error("Drive is not connected"); },
    clock,
  );
  scheduler.create({title: "Archive", prompt: "Archive finished work.", frequency: {kind: "daily", time: "08:00", timeZone: ZONE}});
  scheduler.start();
  clock.advance(61_000);
  await settle();

  const [item] = scheduler.list();
  assert.equal(item.status, "failed");
  assert.equal(item.history[0].outcome, "failed");
  assert.equal(item.history[0].error, "Drive is not connected");
  assert.ok(item.nextRunAt !== undefined);
});

test("a paused schedule has no next run and does not fire", async () => {
  const clock = fakeClock(Date.parse("2026-03-02T07:59:00+11:00"));
  let fired = 0;
  const scheduler = new Scheduler(store(), async () => { fired += 1; return {}; }, clock);
  const created = scheduler.create({title: "Brief", prompt: "Do it.", frequency: {kind: "daily", time: "08:00", timeZone: ZONE}});
  scheduler.start();
  const paused = scheduler.update(created.id, {status: "paused"});
  assert.equal(paused.nextRunAt, undefined);

  clock.advance(120_000);
  await settle();
  assert.equal(fired, 0);

  const resumed = scheduler.update(created.id, {status: "active"});
  assert.ok(resumed.nextRunAt !== undefined);
});

test("a one-off finishes as done, and its unread mark clears when read", async () => {
  const start = Date.parse("2026-03-02T07:59:00+11:00");
  const clock = fakeClock(start);
  const scheduler = new Scheduler(store(), async () => ({summary: "Sent."}), clock);
  const created = scheduler.create({
    title: "Send the invite",
    prompt: "Send it.",
    frequency: {kind: "once", at: start + 60_000},
  });
  scheduler.start();
  clock.advance(61_000);
  await settle();

  let [item] = scheduler.list();
  assert.equal(item.status, "done");
  assert.equal(item.nextRunAt, undefined);
  assert.equal(item.unread, true);

  item = scheduler.markRead(created.id);
  assert.equal(item.unread, false);
});

test("schedules survive a restart, and a run the app died in is not left running", async () => {
  const shared = store();
  const first = new Scheduler(shared, async () => ({}), fakeClock(Date.parse("2026-03-02T07:00:00+11:00")));
  const created = first.create({title: "Brief", prompt: "Do it.", frequency: {kind: "daily", time: "08:00", timeZone: ZONE}});
  // A run that never settled, as a crash would leave it.
  const stored = shared.values.get("schedules") as unknown as ScheduleDto[];
  stored[0].status = "running";
  stored[0].history = [{id: "orphan", startedAt: Date.parse("2026-03-01T08:00:00+11:00"), outcome: "running"}];

  const second = new Scheduler(shared, async () => ({}), fakeClock(Date.parse("2026-03-02T09:00:00+11:00")));
  second.start();
  const [item] = second.list();
  assert.equal(item.id, created.id);
  // The interrupted run is reported as the failure it was, rather than being
  // quietly forgotten — but the schedule still has its next run on the clock.
  assert.equal(item.status, "failed");
  assert.equal(item.history[0].outcome, "failed");
  assert.ok(item.nextRunAt !== undefined);
});

/** Lets the executor's promise chain drain. */
async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}
