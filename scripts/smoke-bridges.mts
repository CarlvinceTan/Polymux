/**
 * Proves the bundled bridges actually run: starts the embedded homeserver and
 * the bridge fleet exactly the way the app does, then asks each bridge's
 * provisioning API who it is and which login flows it offers.
 *
 * This is the line between "the binaries downloaded" and "a user can log in":
 * a bridge that reaches `whoami` has started, read its config, generated and
 * registered its appservice, and opened its provisioning listener — everything
 * short of a human scanning the QR.
 *
 *   npx tsx scripts/smoke-bridges.mts
 */

import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {Homeserver} from "../src/main/homeserver/server.js";
import {BridgeHost} from "../src/main/homeserver/bridges.js";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const binaries = path.join(repo, "bridges");
const directory = await mkdtemp(path.join(tmpdir(), "midas-smoke-"));

const homeserver = new Homeserver({
  serverName: "midas.local",
  dataDirectory: directory,
  port: 0,
});
const bridges = new BridgeHost({
  directory: path.join(directory, "bridges"),
  binariesDirectory: binaries,
  homeserver,
  log: (message) => {
    if (process.env.SMOKE_VERBOSE) console.error(message);
  },
});

await homeserver.start();
const started = await bridges.startAll();
console.log(`homeserver up at ${homeserver.baseUrl}; ${started.length} bridges spawned\n`);

/** Telegram will not finish starting without an api pair; give it a dummy one
 * so the smoke test exercises its startup path too. It never dials out —
 * whoami is answered before any Telegram connection is attempted. */
if (started.some((bridge) => bridge.name === "telegram"))
  await bridges.configureNetwork("telegram", {api_id: "17349", api_hash: "344583e45741c457fe1862106095a5eb"});

const deadline = Date.now() + 45_000;
const results = new Map<string, string>();

async function probe(name: string): Promise<string> {
  const response = await fetch(
    `${homeserver.baseUrl}/bridges/${name}/_matrix/provision/v3/whoami`,
    {headers: {Authorization: "Bearer smoke-test"}, signal: AbortSignal.timeout(4000)},
  );
  const body = (await response.json().catch(() => ({}))) as {
    network?: {displayname?: string};
    login_flows?: Array<{name?: string; id?: string}>;
    errcode?: string;
  };
  // 401 is a pass: the bridge is up and enforcing auth — the app talks to it
  // with a real Matrix token this probe does not have.
  if (response.status === 401 || body.errcode === "M_UNKNOWN_TOKEN")
    return "up (auth enforced)";
  if (response.ok) {
    const flows = (body.login_flows ?? []).map((flow) => flow.name ?? flow.id).join(", ");
    return `up — flows: ${flows || "reported none"}`;
  }
  // No v3 routes: a legacy bridge. Its ping is the same fallback the app uses.
  if (response.status === 404 || response.status === 405) {
    const legacy = await fetch(
      `${homeserver.baseUrl}/bridges/${name}/_matrix/provision/v1/ping`,
      {headers: {Authorization: "Bearer smoke-test"}, signal: AbortSignal.timeout(4000)},
    );
    if (legacy.status === 401 || legacy.status === 403 || legacy.ok)
      return "up (legacy provisioning)";
    throw new Error(`legacy ping HTTP ${legacy.status}`);
  }
  throw new Error(`HTTP ${response.status} ${JSON.stringify(body).slice(0, 120)}`);
}

while (Date.now() < deadline && results.size < started.length) {
  for (const bridge of started) {
    if (results.has(bridge.name)) continue;
    try {
      results.set(bridge.name, await probe(bridge.name));
    } catch {
      // Still starting; try again on the next sweep.
    }
  }
  if (results.size < started.length) await new Promise((resolve) => setTimeout(resolve, 1500));
}

let failed = 0;
for (const bridge of started) {
  const outcome = results.get(bridge.name);
  if (!outcome) failed += 1;
  console.log(`${bridge.name.padEnd(12)} ${outcome ?? "FAILED — never answered whoami"}`);
}

await bridges.close();
await homeserver.close();
await rm(directory, {recursive: true, force: true});
console.log(`\n${started.length - failed}/${started.length} bridges answered provisioning.`);
process.exit(failed > 0 ? 1 : 0);
