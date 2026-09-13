import assert from "node:assert/strict";
import test from "node:test";
import {
  consentWaitingHtml,
  requireWebConsentUrl,
} from "./oauth-consent-page.js";

test("accepts ordinary http(s) consent addresses", () => {
  assert.equal(
    requireWebConsentUrl("https://accounts.google.com/o/oauth2/v2/auth?x=1"),
    "https://accounts.google.com/o/oauth2/v2/auth?x=1",
  );
  assert.equal(
    requireWebConsentUrl("http://127.0.0.1:47665/drive/callback"),
    "http://127.0.0.1:47665/drive/callback",
  );
});

test("refuses anything that is not a web page", () => {
  assert.throws(() => requireWebConsentUrl("javascript:alert(1)"), {
    message: "The sign-in address is not a web page.",
  });
  assert.throws(() => requireWebConsentUrl("file:///tmp/oauth.html"), {
    message: "The sign-in address is not a web page.",
  });
  assert.throws(() => requireWebConsentUrl("not a url"), {
    message: "The sign-in address is not a web page.",
  });
});

test("the waiting page is a single line and follows the theme", () => {
  const dark = consentWaitingHtml(true);
  const light = consentWaitingHtml(false);
  assert.match(dark, /Finish in your browser/);
  assert.match(dark, /#171717/);
  assert.match(light, /#ffffff/);
  assert.doesNotMatch(dark, /Google|Electron|password/i);
});
