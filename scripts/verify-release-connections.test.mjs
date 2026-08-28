import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import test from "node:test";

const script = new URL("./verify-release-connections.mjs", import.meta.url);
const required = [
  "POLYMUX_TELEGRAM_API_ID",
  "POLYMUX_TELEGRAM_API_HASH",
  "POLYMUX_GOOGLE_DRIVE_CLIENT_ID",
  "POLYMUX_DROPBOX_CLIENT_ID",
  "POLYMUX_ONEDRIVE_CLIENT_ID",
];

function cleanEnvironment() {
  const environment = {...process.env};
  for (const name of required) delete environment[name];
  return environment;
}

test("a release without its built-in connections is refused", () => {
  const result = spawnSync(process.execPath, [script.pathname], {
    encoding: "utf8",
    env: cleanEnvironment(),
  });

  assert.equal(result.status, 1);
  for (const name of required) assert.match(result.stderr, new RegExp(name));
});

test("a release with every required application registration may build", () => {
  const environment = cleanEnvironment();
  for (const name of required) environment[name] = "configured";
  const result = spawnSync(process.execPath, [script.pathname], {
    encoding: "utf8",
    env: environment,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /registrations are present/i);
});
