import assert from "node:assert/strict";
import test from "node:test";
import {applyShippedOAuthCredentials} from "./shipped-oauth.js";

test("packaged OAuth registrations fill an otherwise clean launch", () => {
  const environment: NodeJS.ProcessEnv = {};
  applyShippedOAuthCredentials(environment, {
    POLYMUX_GOOGLE_DRIVE_CLIENT_ID: "google",
    POLYMUX_DROPBOX_CLIENT_ID: "dropbox",
    POLYMUX_ONEDRIVE_CLIENT_ID: "microsoft",
  });

  assert.equal(environment.POLYMUX_GOOGLE_DRIVE_CLIENT_ID, "google");
  assert.equal(environment.POLYMUX_DROPBOX_CLIENT_ID, "dropbox");
  assert.equal(environment.POLYMUX_ONEDRIVE_CLIENT_ID, "microsoft");
});

test("an explicit launch override wins over the packaged registration", () => {
  const environment: NodeJS.ProcessEnv = {
    POLYMUX_GOOGLE_DRIVE_CLIENT_ID: "override",
  };
  applyShippedOAuthCredentials(environment, {
    POLYMUX_GOOGLE_DRIVE_CLIENT_ID: "packaged",
  });

  assert.equal(environment.POLYMUX_GOOGLE_DRIVE_CLIENT_ID, "override");
});

test("blank packaged values never create misleading configuration", () => {
  const environment: NodeJS.ProcessEnv = {};
  applyShippedOAuthCredentials(environment, {
    POLYMUX_GOOGLE_DRIVE_CLIENT_ID: "  ",
  });

  assert.equal(environment.POLYMUX_GOOGLE_DRIVE_CLIENT_ID, undefined);
});
