import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyImport,
  cookieProblem,
  dedupeCookies,
  loginProblem,
  visitProblem,
} from "./apply.js";
import type { ImportedCookie } from "./types.js";

const FUTURE = Math.floor(Date.now() / 1000) + 86_400;

function cookie(overrides: Partial<ImportedCookie> = {}): ImportedCookie {
  return {
    url: "https://example.com/",
    name: "session",
    value: "abc",
    secure: true,
    expirationDate: FUTURE,
    ...overrides,
  };
}

test("cookies Chromium would refuse are caught before the write", () => {
  assert.equal(cookieProblem(cookie()), null);

  // SameSite=None is meaningless without Secure.
  assert.ok(cookieProblem(cookie({sameSite: "no_restriction", secure: false})));
  assert.equal(cookieProblem(cookie({sameSite: "no_restriction", secure: true})), null);

  // The prefixes carry rules Chromium enforces whatever the source stored.
  assert.ok(cookieProblem(cookie({name: "__Secure-sid", secure: false})));
  assert.ok(cookieProblem(cookie({name: "__Host-sid", secure: false})));
  assert.ok(cookieProblem(cookie({name: "__Host-sid", domain: ".example.com"})));
  assert.ok(cookieProblem(cookie({name: "__Host-sid", path: "/app"})));
  assert.equal(cookieProblem(cookie({name: "__Host-sid", path: "/"})), null);

  // A write that achieves nothing is not worth a round trip.
  assert.ok(cookieProblem(cookie({expirationDate: 1_000})));
  assert.ok(cookieProblem(cookie({url: "not a url"})));
  assert.ok(cookieProblem(cookie({name: "", value: ""})));

  // A session cookie has no expiry at all, which is fine.
  assert.equal(cookieProblem(cookie({expirationDate: undefined})), null);
});

test("a repeated cookie keeps the last one rather than writing both", () => {
  const deduped = dedupeCookies([
    cookie({value: "old"}),
    cookie({value: "new"}),
    cookie({name: "other", value: "kept"}),
  ]);
  assert.equal(deduped.length, 2);
  assert.equal(deduped[0]!.value, "new");
});

test("a login without what it needs to be used again is refused", () => {
  assert.equal(loginProblem({origin: "https://a.example", username: "me", password: "pw"}), null);
  // A blank username is legitimate — plenty of sites key on the password alone.
  assert.equal(loginProblem({origin: "https://a.example", username: "", password: "pw"}), null);
  assert.ok(loginProblem({origin: "https://a.example", username: "me", password: ""}));
  assert.ok(loginProblem({origin: "", username: "me", password: "pw"}));
  assert.ok(loginProblem({origin: "nonsense", username: "me", password: "pw"}));
});

test("applying reports what landed, what did not, and why", async () => {
  const written: string[] = [];
  const saved: string[] = [];
  const result = await applyImport(
    {
      cookies: [
        cookie({name: "good"}),
        cookie({name: "expired", expirationDate: 1_000}),
        cookie({name: "alsoExpired", expirationDate: 2_000}),
      ],
      logins: [
        {origin: "https://a.example", username: "me", password: "pw"},
        {origin: "", username: "me", password: "pw"},
      ],
      visits: [],
      problems: ["something the decoder already noticed"],
    },
    {
      cookies: {
        set: async (details) => {
          written.push(details.name ?? "");
        },
      },
      logins: {
        save: async (origin, username) => {
          saved.push(`${origin}|${username}`);
          return [];
        },
      },
    },
  );

  assert.deepEqual(written, ["good"]);
  assert.deepEqual(saved, ["https://a.example|me"]);
  assert.equal(result.cookiesImported, 1);
  assert.equal(result.cookiesSkipped, 2);
  assert.equal(result.passwordsImported, 1);
  assert.equal(result.passwordsSkipped, 1);
  // The decoder's own problems survive.
  assert.ok(result.problems.includes("something the decoder already noticed"));
  // Two cookies failed the same way, so they are one line with a count rather
  // than two identical lines.
  assert.ok(result.problems.some((line) => line.includes("(2 items)")));
});

test("a cookie the session rejects is counted, not thrown", async () => {
  const result = await applyImport(
    {cookies: [cookie()], logins: [], visits: [], problems: []},
    {
      cookies: {
        set: async () => {
          throw new Error("Failed to set cookie");
        },
      },
      logins: {save: async () => []},
    },
  );
  assert.equal(result.cookiesImported, 0);
  assert.equal(result.cookiesSkipped, 1);
  assert.ok(result.problems.some((line) => line.includes("Failed to set cookie")));
});

test("a visit with a date that cannot be true is refused", () => {
  const ok = {url: "https://a.example/p", title: "P", visitedAt: 1_700_000_000, visitCount: 2};
  assert.equal(visitProblem(ok), null);

  assert.ok(visitProblem({...ok, url: ""}));
  assert.ok(visitProblem({...ok, url: "not a url"}));
  // A file:// or chrome:// row is not a page we can put in a web history.
  assert.ok(visitProblem({...ok, url: "chrome://settings"}));
  assert.ok(visitProblem({...ok, visitedAt: 0}), "a zero date is a failed conversion");
  assert.ok(visitProblem({...ok, visitedAt: Number.NaN}));
});

test("history is written in one batch, and refusals are counted", async () => {
  let batched: number | null = null;
  const result = await applyImport(
    {
      cookies: [],
      logins: [],
      visits: [
        {url: "https://a.example/1", title: "One", visitedAt: 1_700_000_000, visitCount: 1},
        {url: "https://b.example/2", title: "Two", visitedAt: 1_700_000_100, visitCount: 4},
        {url: "chrome://settings", title: "Nope", visitedAt: 1_700_000_200, visitCount: 1},
      ],
      problems: [],
    },
    {
      cookies: {set: async () => {}},
      logins: {save: async () => []},
      visits: {
        record: (visits) => {
          batched = visits.length;
          return visits.length;
        },
      },
    },
  );

  assert.equal(batched, 2, "one call for the lot, not one per page");
  assert.equal(result.historyImported, 2);
  assert.equal(result.historySkipped, 1);
});

test("history is left alone when nothing is there to write it", async () => {
  const result = await applyImport(
    {
      cookies: [],
      logins: [],
      visits: [{url: "https://a.example", title: "A", visitedAt: 1_700_000_000, visitCount: 1}],
      problems: [],
    },
    {cookies: {set: async () => {}}, logins: {save: async () => []}},
  );
  assert.equal(result.historyImported, 0, "no writer, no claim to have imported");
});
