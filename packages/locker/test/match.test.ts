import assert from "node:assert/strict";
import { test } from "node:test";
import { entryMatchesPage, matchItems } from "../src/match.js";

test("an entry URL matches the same site, including a path and www", () => {
  assert.equal(entryMatchesPage("https://github.com", "https://github.com/login"), true);
  assert.equal(entryMatchesPage("github.com", "https://www.github.com/session"), true);
  assert.equal(entryMatchesPage("https://www.github.com/login", "https://github.com"), true);
});

test("a stored parent host matches a subdomain of that host", () => {
  assert.equal(entryMatchesPage("https://google.com", "https://mail.google.com"), true);
  assert.equal(entryMatchesPage("google.com", "https://accounts.google.com/signin"), true);
});

test("a lookalike host does not inherit a stored domain", () => {
  assert.equal(entryMatchesPage("google.com", "https://evil-google.com"), false);
  assert.equal(entryMatchesPage("https://github.com", "https://github.example"), false);
  assert.equal(entryMatchesPage("https://a.example", "https://b.example"), false);
});

test("an empty or unusable URL is never a match", () => {
  assert.equal(entryMatchesPage("", "https://github.com"), false);
  assert.equal(entryMatchesPage("https://github.com", ""), false);
  assert.equal(entryMatchesPage("not a url", "https://github.com"), false);
});

test("matchItems keeps only the entries for the page", () => {
  const items = [
    { url: "https://github.com", title: "GitHub" },
    { url: "https://mail.example", title: "Mail" },
    { url: "", title: "No site" },
  ];
  assert.deepEqual(
    matchItems(items, "https://github.com/login").map((item) => item.title),
    ["GitHub"],
  );
}
)