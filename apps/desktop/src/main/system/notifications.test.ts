import assert from "node:assert/strict";
import {test} from "node:test";
import {DEFAULT_NOTIFICATION_SWITCHES} from "../backend/notification-settings.js";
import {
  activateNotification,
  Notifier,
  notificationBody,
  type NotificationActivation,
  type NotificationRequest,
} from "./notifications.js";

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
  target: {kind: "conversation", conversationId: "conversation-1"},
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

test("clicking restores and focuses the app before opening the exact target", () => {
  const calls: string[] = [];
  const activation: NotificationActivation = {
    restore: () => calls.push("restore"),
    show: () => calls.push("show"),
    focusWindow: () => calls.push("focus-window"),
    focusApp: () => calls.push("focus-app"),
    open: (target) =>
      calls.push(
        target.kind === "conversation"
          ? `open:${target.conversationId}`
          : `open:${target.kind}`,
      ),
  };
  activateNotification(request, activation);
  assert.deepEqual(calls, [
    "restore",
    "show",
    "focus-window",
    "focus-app",
    "open:conversation-1",
  ]);
});

test("a test notification only brings the app forward", () => {
  const calls: string[] = [];
  activateNotification({...request, target: undefined}, {
    restore: () => calls.push("restore"),
    show: () => calls.push("show"),
    focusWindow: () => calls.push("focus-window"),
    focusApp: () => calls.push("focus-app"),
    open: () => calls.push("open"),
  });
  assert.deepEqual(calls, ["restore", "show", "focus-window", "focus-app"]);
});

test("bodies are collapsed and cut on a word boundary", () => {
  assert.equal(notificationBody("  a\n  b  "), "a b");
  const long = notificationBody("word ".repeat(60), 20);
  assert.ok(long.endsWith("…"));
  assert.ok(long.length <= 21);
  assert.ok(!long.includes("  "));
});
