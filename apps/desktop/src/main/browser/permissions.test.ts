import assert from "node:assert/strict";
import { test } from "node:test";
import type { BrowserPermissionPromptDto } from "@flareai/protocol";
import type { Session, WebContents } from "electron";
import { SitePermissions, originOf } from "./permissions.js";

/** The slice of storage the permission store actually uses. */
function records() {
  const rows = new Map<
    string,
    { origin: string; permission: string; decision: "allow" | "deny" | "ask"; updatedAt: string }
  >();
  return {
    rows,
    setSitePermission(origin: string, permission: string, decision: "allow" | "deny" | "ask") {
      const updatedAt = "2026-08-17T00:00:00.000Z";
      rows.set(`${origin}|${permission}`, { origin, permission, decision, updatedAt });
      return { updatedAt };
    },
    getSitePermission(origin: string, permission: string) {
      return rows.get(`${origin}|${permission}`) ?? null;
    },
    listSitePermissions(origin?: string) {
      return [...rows.values()].filter((row) => origin === undefined || row.origin === origin);
    },
    clearSitePermissions(origin?: string) {
      let removed = 0;
      for (const [key, row] of [...rows])
        if (origin === undefined || row.origin === origin) {
          rows.delete(key);
          removed += 1;
        }
      return removed;
    },
  };
}

/** Captures the two handlers the store installs so a test can call them. */
function harness(options: { tabIdFor?: (contents: WebContents | null) => string | null } = {}) {
  const store = records();
  const prompts: BrowserPermissionPromptDto[] = [];
  const permissions = new SitePermissions({
    records: store,
    tabIdFor: options.tabIdFor ?? (() => "tab-1"),
    prompt: (prompt) => prompts.push(prompt),
  });
  let check: Function | null = null;
  let request: Function | null = null;
  const session = {
    setPermissionCheckHandler: (handler: Function) => {
      check = handler;
    },
    setPermissionRequestHandler: (handler: Function) => {
      request = handler;
    },
  } as unknown as Session;
  const appContents = { isDestroyed: () => false } as WebContents;
  const pageContents = { isDestroyed: () => false } as WebContents;
  permissions.install(session, appContents);
  return {
    store,
    prompts,
    permissions,
    appContents,
    pageContents,
    check: (contents: WebContents | null, permission: string, origin: string, details = {}) =>
      check!(contents, permission, origin, details) as boolean,
    /** Runs a request and returns what the callback was given, or null if it
     * has not been called yet — which is what a prompt looks like. */
    request: (contents: WebContents, permission: string, requestingUrl: string) => {
      let answer: boolean | null = null;
      request!(contents, permission, (granted: boolean) => {
        answer = granted;
      }, { requestingUrl, isMainFrame: true });
      return answer;
    },
  };
}

test("an origin is the site's identity, without the path that came with it", () => {
  assert.equal(originOf("https://example.com/a/b?c=d#e"), "https://example.com");
  // Scheme and port are part of it; a grant to one is not a grant to another.
  assert.equal(originOf("http://example.com"), "http://example.com");
  assert.equal(originOf("https://example.com:8443/x"), "https://example.com:8443");
  assert.equal(originOf("not a url"), null);
  assert.equal(originOf(undefined), null);
});

test("the app window keeps its own narrow grant", () => {
  const app = harness();
  // Exactly what the window had before permissions moved here: location for
  // the location setting, microphone for dictation, and nothing else.
  assert.equal(app.request(app.appContents, "geolocation", "app://flareai"), true);
  assert.equal(app.request(app.appContents, "notifications", "app://flareai"), false);
  assert.equal(
    app.check(app.appContents, "media", "app://flareai", { mediaType: "audio" }),
    true,
  );
  assert.equal(
    app.check(app.appContents, "media", "app://flareai", { mediaType: "video" }),
    false,
  );
});

test("a page in a browser tab is prompted, and the answer can be remembered", () => {
  const app = harness();
  // Nothing stored yet, so the request waits on the user rather than resolving.
  assert.equal(app.request(app.pageContents, "geolocation", "https://maps.example/here"), null);
  assert.equal(app.prompts.length, 1);
  assert.equal(app.prompts[0]!.origin, "https://maps.example");
  assert.equal(app.prompts[0]!.permission, "geolocation");

  app.permissions.respond(app.prompts[0]!.id, "allow", true);
  assert.equal(app.permissions.decision("https://maps.example", "geolocation"), "allow");
  // Remembered, so the next request settles without asking again.
  assert.equal(app.request(app.pageContents, "geolocation", "https://maps.example/there"), true);
  assert.equal(app.prompts.length, 1);
  // And the synchronous check now reports it as held.
  assert.equal(app.check(app.pageContents, "geolocation", "https://maps.example"), true);
});

test("an answer that is not remembered settles only that request", () => {
  const app = harness();
  app.request(app.pageContents, "notifications", "https://news.example/");
  app.permissions.respond(app.prompts[0]!.id, "allow", false);
  assert.equal(app.store.rows.size, 0, "nothing was written");
  // So the next request asks again rather than riding on the last answer.
  assert.equal(app.request(app.pageContents, "notifications", "https://news.example/"), null);
  assert.equal(app.prompts.length, 2);
});

test("repeat asks from one site ride on the prompt already up", () => {
  const app = harness();
  app.request(app.pageContents, "geolocation", "https://maps.example/");
  // A page that asks again before the user answers must not stack a second
  // prompt behind the first.
  app.request(app.pageContents, "geolocation", "https://maps.example/other");
  assert.equal(app.prompts.length, 1);
  app.permissions.respond(app.prompts[0]!.id, "deny", false);
  // The one answer settles both callers, and answering again is a no-op.
  app.permissions.respond(app.prompts[0]!.id, "allow", true);
  assert.equal(app.permissions.decision("https://maps.example", "geolocation"), "ask");
});

test("a capability with no prompt designed for it is refused outright", () => {
  const app = harness();
  assert.equal(app.request(app.pageContents, "midiSysex", "https://synth.example/"), false);
  assert.equal(app.check(app.pageContents, "usb", "https://synth.example"), false);
  assert.equal(app.prompts.length, 0, "no prompt for something with no answer");
});

test("fullscreen follows the click that asked for it rather than a prompt", () => {
  const app = harness();
  assert.equal(app.request(app.pageContents, "fullscreen", "https://video.example/"), true);
  assert.equal(app.request(app.pageContents, "pointerLock", "https://game.example/"), true);
  assert.equal(app.prompts.length, 0);
  // Still overridable: a site the user has denied stays denied.
  app.permissions.set("https://video.example", "fullscreen", "deny");
  assert.equal(app.request(app.pageContents, "fullscreen", "https://video.example/"), false);
});

test("webContents that belong to nothing we own are refused", () => {
  const app = harness({ tabIdFor: () => null });
  const stray = { isDestroyed: () => false } as WebContents;
  assert.equal(app.request(stray, "geolocation", "https://elsewhere.example/"), false);
  assert.equal(app.check(stray, "geolocation", "https://elsewhere.example"), false);
});

test("a tab that goes away denies what it left outstanding", () => {
  const app = harness();
  assert.equal(app.request(app.pageContents, "geolocation", "https://maps.example/"), null);
  // The page navigating or closing must not leave Chromium waiting forever on
  // a callback nobody will call.
  app.permissions.dismissTab("tab-1");
  app.permissions.respond(app.prompts[0]!.id, "allow", true);
  assert.equal(app.store.rows.size, 0, "a dismissed prompt cannot still be answered");
});

test("only permissions this build understands are listed back", () => {
  const app = harness();
  app.permissions.set("https://maps.example", "geolocation", "allow");
  // A row left by a version that knew a permission this one does not stays in
  // the database but is not shown as a row the UI cannot label.
  app.store.setSitePermission("https://old.example", "retired-capability", "allow");
  const listed = app.permissions.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0]!.origin, "https://maps.example");
});
