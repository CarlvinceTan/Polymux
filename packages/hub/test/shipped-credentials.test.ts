import assert from "node:assert/strict";
import {mkdtemp, readFile, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {
  loadShippedCredentials,
  readPairs,
  resetShippedCredentials,
  shippedNetworkConfig,
} from "../src/shipped-credentials.js";

/**
 * The application pair Polymux signs Telegram in with. It is served as well as
 * compiled in, because the failure it exists for — the registration being
 * banned — is one every install hits at the same moment, and a fix that has to
 * be built and notarised arrives days after it is needed.
 */

const PAIR = {telegram: {api_id: "2040", api_hash: "b18441a1ff607e10"}};

function serving(document: unknown, options: {ok?: boolean} = {}) {
  const calls: string[] = [];
  const fetch = (async (url: string | URL) => {
    calls.push(String(url));
    return {
      ok: options.ok ?? true,
      json: async (): Promise<unknown> => document,
    } as Response;
  }) as unknown as typeof globalThis.fetch;
  return {fetch, calls};
}

test.beforeEach(() => resetShippedCredentials());
test.after(() => resetShippedCredentials());

test("a served pair outranks the one compiled into the build", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-creds-"));
  const {fetch, calls} = serving(PAIR);

  await loadShippedCredentials({directory, host: "https://updates.example", fetch});

  assert.deepEqual(shippedNetworkConfig("telegram"), PAIR.telegram);
  assert.deepEqual(calls, ["https://updates.example/stable/credentials.json"]);
  // Kept, so the next launch has it before the network answers — or at all.
  const cached: unknown = JSON.parse(
    await readFile(path.join(directory, "shipped-credentials.json"), "utf8"),
  );
  assert.deepEqual(cached, PAIR);
});

test("a machine that cannot reach the host runs on its cached copy", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-creds-"));
  await writeFile(
    path.join(directory, "shipped-credentials.json"),
    JSON.stringify(PAIR),
    "utf8",
  );
  const fetch = (async () => {
    throw new Error("offline");
  }) as unknown as typeof globalThis.fetch;

  await loadShippedCredentials({directory, host: "https://updates.example", fetch});

  assert.deepEqual(shippedNetworkConfig("telegram"), PAIR.telegram);
});

test("nothing served and nothing cached leaves the built-in pair in charge", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-creds-"));
  const {fetch} = serving(null, {ok: false});

  await loadShippedCredentials({directory, host: "https://updates.example", fetch});

  // No pair is baked into a test run, so this is the ask-the-user path — which
  // is exactly what a build with no credentials at all must still do.
  assert.deepEqual(shippedNetworkConfig("telegram"), {});
});

test("a served document that has lost its pair does not take the good one away", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-creds-"));
  await writeFile(path.join(directory, "shipped-credentials.json"), JSON.stringify(PAIR), "utf8");
  const {fetch} = serving({telegram: {api_id: "2040"}});

  await loadShippedCredentials({directory, host: "https://updates.example", fetch});

  assert.deepEqual(
    shippedNetworkConfig("telegram"),
    PAIR.telegram,
    "half a pair is discarded rather than applied over a whole one",
  );
});

/**
 * These values are written into a bridge's config file, so the served document
 * is treated as untrusted input rather than as our own data: anything that
 * could carry structure, a path, or a shell fragment out of a network response
 * and into that file is refused.
 */
test("only values that look like an application pair are accepted", () => {
  assert.deepEqual(readPairs(PAIR), PAIR);
  assert.deepEqual(readPairs({telegram: {api_id: "2040\n    admins: everyone", api_hash: "x"}}), {});
  assert.deepEqual(readPairs({telegram: {api_id: "../../etc", api_hash: "b18441a1ff607e10"}}), {});
  assert.deepEqual(readPairs({telegram: {api_id: 2040, api_hash: "b18441a1ff607e10"}}), {});
  assert.deepEqual(
    readPairs({telegram: PAIR.telegram, whatsapp: {api_id: "1", api_hash: "2"}}),
    PAIR,
    "a platform with no pair to serve cannot be given one from outside",
  );
  assert.deepEqual(readPairs("nope"), {});
  assert.deepEqual(readPairs(null), {});
});
