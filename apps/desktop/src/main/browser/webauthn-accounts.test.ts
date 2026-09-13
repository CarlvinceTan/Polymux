import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  SelectWebauthnAccountDetails,
  Session,
  WebFrameMain,
} from "electron";
import type { BrowserWebAuthnPromptDto } from "@polymux/protocol";
import { WebAuthnAccounts } from "./webauthn-accounts.js";

function harness(tabIdForFrame: () => string | null = () => "browser-1") {
  let listener: Function | null = null;
  const session = {
    on: (event: string, value: Function) => {
      assert.equal(event, "select-webauthn-account");
      listener = value;
    },
    off: (event: string, value: Function) => {
      assert.equal(event, "select-webauthn-account");
      if (listener === value) listener = null;
    },
  } as unknown as Session;
  const prompts: BrowserWebAuthnPromptDto[] = [];
  const accounts = new WebAuthnAccounts({
    tabIdForFrame,
    prompt: (prompt) => prompts.push(prompt),
  });
  accounts.install(session);
  const select = (
    available = [
      { credentialId: "credential-a", displayName: "Carlvince", name: "c@example.com" },
      { credentialId: "credential-b", name: "work@example.com" },
    ],
  ) => {
    let answer: string | null | undefined = null;
    listener!(
      {},
      {
        relyingPartyId: "github.com",
        accounts: available,
        frame: {} as WebFrameMain,
      } satisfies SelectWebauthnAccountDetails,
      (credentialId?: string | null) => {
        answer = credentialId;
      },
    );
    return () => answer;
  };
  return { accounts, prompts, select, listener: () => listener };
}

test("a browser passkey request exposes only display fields and bounded ids", () => {
  const app = harness();
  const answer = app.select();
  assert.equal(answer(), null, "Electron is still waiting");
  assert.deepEqual(app.prompts[0]!.accounts, [
    { credentialId: "credential-a", displayName: "Carlvince", name: "c@example.com" },
    { credentialId: "credential-b", name: "work@example.com" },
  ]);
  app.accounts.respond(app.prompts[0]!.id, "credential-b");
  assert.equal(answer(), "credential-b");
});

test("an invented credential id cancels instead of selecting it", () => {
  const app = harness();
  const answer = app.select();
  app.accounts.respond(app.prompts[0]!.id, "credential-from-another-request");
  assert.equal(answer(), undefined);
});

test("requests outside an owned browser tab are cancelled without a prompt", () => {
  const app = harness(() => null);
  const answer = app.select();
  assert.equal(answer(), undefined);
  assert.equal(app.prompts.length, 0);
});

test("navigation and shutdown settle every outstanding callback once", () => {
  const app = harness();
  const first = app.select();
  app.accounts.dismissTab("browser-1");
  assert.equal(first(), undefined);
  app.accounts.respond(app.prompts[0]!.id, "credential-a");
  assert.equal(first(), undefined, "a stale renderer answer is ignored");

  const second = app.select();
  app.accounts.close();
  assert.equal(second(), undefined);
  assert.equal(app.listener(), null);
});
