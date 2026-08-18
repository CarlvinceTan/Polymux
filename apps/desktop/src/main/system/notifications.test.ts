import assert from "node:assert/strict";
import {test} from "node:test";
import {DEFAULT_NOTIFICATION_SWITCHES} from "../backend/notification-settings.js";
import {Notifier, notificationBody, type NotificationRequest} from "./notifications.js";

function harness(overrides: {
  enabled?: boolean;
  kinds?: Partial<typeof DEFAULT_NOTIFICATION_SWITCHES>;
  supported?: boolean;
  focused?: boolean;
} = {}) {
  const posted: NotificationRequest[] = [];
  const notifier = new Notifier({
    preferences: () => ({
      enabled: overrides.enabled ?? true,
      kinds: {...DEFAULT_NOTIFICATION_SWITCHES, ...overrides.kinds},
    }),
    present: (request) => posted.push(request),
    supported: () => overrides.supported ?? true,
    focused: () => overrides.focused ?? false,
  });
  return {notifier, posted};
}

const request: NotificationRequest = {
  kind: "schedule-completed",
  title: "Morning briefing",
  body: "Done",
};

test("posts when the master switch and the kind are both on", () => {
  const {notifier, posted} = harness();
  assert.equal(notifier.notify(request), "posted");
  assert.deepEqual(posted, [request]);
});

test("the master switch silences a kind that is still switched on", () => {
  const {notifier, posted} = harness({enabled: false});
  assert.equal(notifier.notify(request), "disabled");
  assert.equal(posted.length, 0);
});

test("one kind can be switched off without touching the others", () => {
  const {notifier, posted} = harness({kinds: {"schedule-completed": false}});
  assert.equal(notifier.notify(request), "kind-disabled");
  assert.equal(notifier.notify({...request, kind: "agent-completed"}), "posted");
  assert.equal(posted.length, 1);
});

test("nothing is posted where the OS will not show one", () => {
  const {notifier, posted} = harness({supported: false});
  assert.equal(notifier.notify(request), "unsupported");
  assert.equal(posted.length, 0);
});

test("a focused window is not interrupted, but a forced notification still lands", () => {
  const {notifier, posted} = harness({focused: true});
  assert.equal(notifier.notify(request), "focused");
  assert.equal(notifier.notify({...request, force: true}), "posted");
  assert.equal(posted.length, 1);
});

test("bodies are collapsed and cut on a word boundary", () => {
  assert.equal(notificationBody("  a\n  b  "), "a b");
  const long = notificationBody("word ".repeat(60), 20);
  assert.ok(long.endsWith("…"));
  assert.ok(long.length <= 21);
  assert.ok(!long.includes("  "));
});
