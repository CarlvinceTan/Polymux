import assert from "node:assert/strict";
import test from "node:test";
import {mailOAuthError} from "../src/email-oauth.js";

test("mail OAuth errors preserve a provider response description", () => {
  const wrapped = new Error("server responded with an error in the response body", {
    cause: {
      error: "invalid_client",
      error_description: "The client secret is invalid or expired.",
    },
  });

  assert.equal(
    mailOAuthError("microsoft", wrapped).message,
    "Microsoft sign-in failed: The client secret is invalid or expired.",
  );
});

test("mail OAuth errors retain a useful ordinary error", () => {
  assert.equal(
    mailOAuthError("google", new Error("The token endpoint could not be reached.")).message,
    "Google sign-in failed: The token endpoint could not be reached.",
  );
});
