import assert from "node:assert/strict";
import {afterEach, describe, it} from "node:test";
import {mailOAuthClients} from "./index.js";

const names = [
  "POLYMUX_GOOGLE_DRIVE_CLIENT_ID",
  "POLYMUX_GOOGLE_DRIVE_CLIENT_SECRET",
  "POLYMUX_GOOGLE_MAIL_CLIENT_ID",
  "POLYMUX_GOOGLE_MAIL_CLIENT_SECRET",
  "POLYMUX_ONEDRIVE_CLIENT_ID",
  "POLYMUX_ONEDRIVE_CLIENT_SECRET",
  "POLYMUX_MICROSOFT_MAIL_CLIENT_ID",
  "POLYMUX_MICROSOFT_MAIL_CLIENT_SECRET",
] as const;

const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const name of names) {
    const value = before[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("mailOAuthClients", () => {
  it("offers mail OAuth from the existing drive registrations", () => {
    process.env.POLYMUX_GOOGLE_DRIVE_CLIENT_ID = "google-shared";
    process.env.POLYMUX_ONEDRIVE_CLIENT_ID = "microsoft-shared";
    delete process.env.POLYMUX_GOOGLE_MAIL_CLIENT_ID;
    delete process.env.POLYMUX_MICROSOFT_MAIL_CLIENT_ID;

    assert.deepEqual(mailOAuthClients(), {
      google: {clientId: "google-shared"},
      microsoft: {clientId: "microsoft-shared"},
    });
  });

  it("prefers a dedicated mail registration when one is configured", () => {
    process.env.POLYMUX_GOOGLE_DRIVE_CLIENT_ID = "google-shared";
    process.env.POLYMUX_GOOGLE_MAIL_CLIENT_ID = "google-mail";
    process.env.POLYMUX_GOOGLE_MAIL_CLIENT_SECRET = "mail-secret";

    assert.deepEqual(mailOAuthClients().google, {
      clientId: "google-mail",
      clientSecret: "mail-secret",
    });
  });
});
