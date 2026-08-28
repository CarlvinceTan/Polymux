import assert from "node:assert/strict";
import type { spawn as spawnFn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { connect, createServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  BRIDGE_FLEET,
  BridgeHost,
  messagesDatabaseAccess,
  repairConfig,
  withNetwork,
} from "../src/bridges.js";
import { COMMS_PLATFORMS } from "@polymux/protocol";

/**
 * The fleet is the list of networks this host can run. These tests pin the
 * parts that are easy to get quietly wrong: the dedicated Meta binaries,
 * ports that must not drift when the installed set changes, and each binary's
 * required network mode.
 */

/** A child that starts and simply stays up, so supervision has something to hold. */
function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    stderr: null;
    kill: () => void;
  };
  child.pid = 424_242;
  child.stderr = null;
  child.kill = () => {};
  return child;
}

/** Enough of a Homeserver for BridgeHost's config seeding. */
function fakeHomeserver() {
  return {
    baseUrl: "http://127.0.0.1:47664",
    serverName: "polymux.local",
    registerAppservice: () => {},
    setProvisioningTarget: () => {},
  } as unknown as ConstructorParameters<typeof BridgeHost>[0]["homeserver"];
}

/** A child that dies the moment it is started, the way a misconfigured one does. */
function crashingChild() {
  const child = fakeChild();
  setTimeout(() => child.emit("exit", 1), 0);
  return child;
}

/** A supervised child whose output can exercise the real line relay. */
function outputChild() {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: () => void;
  };
  child.pid = 424_242;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {
    child.stdout.end();
    child.stderr.end();
  };
  return child;
}

async function hostWith(
  binaries: string[],
  options: Partial<ConstructorParameters<typeof BridgeHost>[0]> = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-fleet-"));
  const binariesDirectory = path.join(root, "bin");
  await mkdir(binariesDirectory, { recursive: true });
  for (const binary of binaries) {
    const file = path.join(binariesDirectory, binary);
    await writeFile(file, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(file, 0o755);
  }
  const host = new BridgeHost({
    directory: path.join(root, "bridges"),
    binariesDirectory,
    homeserver: fakeHomeserver(),
    // Nothing a fake child spawns ever binds a port, so waiting for one would
    // only ever burn the timeout.
    readyTimeoutMs: 0,
    ...options,
  });
  return { host, root };
}

/**
 * A registration already on disk, so a test exercising supervision is not also
 * exercising the `-g` pass that would normally write one.
 */
async function seedRegistration(root: string, platform: string): Promise<void> {
  const directory = path.join(root, "bridges", platform);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "registration.yaml"),
    `id: ${platform}\nas_token: aaa\nhs_token: bbb\n`,
    "utf8",
  );
}

/**
 * A bridge database holding `logins` linked accounts, in the shape the current
 * bridge generation writes. This is what decides whether a bridge comes up at
 * launch, and it is read rather than remembered, so the test writes the real
 * thing rather than stubbing the reader.
 */
function linkedDatabase(file: string, logins: number): void {
  const database = new DatabaseSync(file);
  database.exec(
    "create table user_login (bridge_id text, user_mxid text, id text, remote_name text)",
  );
  for (let index = 0; index < logins; index += 1)
    database
      .prepare("insert into user_login values (?, ?, ?, ?)")
      .run("bridge", "@user:polymux.local", `login-${index}`, "Someone");
  database.close();
}

/** Waits for supervision to settle, which happens across timers rather than awaits. */
async function until(check: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(message);
}

const blockedBy = async (host: BridgeHost, platform: string) =>
  (await host.inventory()).find((entry) => entry.platform === platform)
    ?.blocked ?? null;

const blockedReason = async (host: BridgeHost, platform: string) =>
  (await blockedBy(host, platform))?.reason ?? null;

test("Messenger and Instagram are discovered from their dedicated binaries", async () => {
  const { host } = await hostWith(["mautrix-meta", "mautrix-instagram"]);
  const found = await host.discover();

  assert.deepEqual(
    found.map((bridge) => bridge.name).sort(),
    ["instagram", "messenger"],
    "both Meta networks are available",
  );
  const ports = new Set(found.map((bridge) => bridge.port));
  assert.equal(ports.size, 2, "the two instances cannot share a port");
  assert.equal(
    found.find((bridge) => bridge.name === "instagram")?.network?.mode,
    "instagram",
    "the Instagram config keeps its network mode",
  );
});

test("a platform keeps its port when other bridges come and go", async () => {
  const alone = await hostWith(["mautrix-discord"]);
  const crowded = await hostWith([
    "mautrix-whatsapp",
    "mautrix-discord",
    "mautrix-signal",
  ]);

  const port = async (host: BridgeHost) =>
    (await host.discover()).find((bridge) => bridge.name === "discord")?.port;

  assert.equal(
    await port(alone.host),
    await port(crowded.host),
    "ports come from the catalogue, not from what happens to be installed",
  );
});

test("the inventory reports the whole fleet, installed or not", async () => {
  const { host } = await hostWith(["mautrix-whatsapp"]);
  const inventory = await host.inventory();

  assert.equal(inventory.length, BRIDGE_FLEET.length);
  assert.equal(
    inventory.find((entry) => entry.platform === "whatsapp")?.installed,
    true,
  );
  assert.equal(
    inventory.find((entry) => entry.platform === "slack")?.installed,
    false,
    "a platform with no binary is reported as missing rather than omitted",
  );
});

test("Windows executable names are discovered through the portable catalogue", async () => {
  const { host, root } = await hostWith(["mautrix-instagram.exe"]);
  const bridge = (await host.discover()).find((entry) => entry.name === "instagram");

  assert.equal(
    bridge?.binary,
    path.join(root, "bin", "mautrix-instagram.exe"),
  );
  assert.equal(
    (await host.inventory()).find((entry) => entry.platform === "instagram")
      ?.installed,
    true,
  );
});

test("Windows advertises only bridges with a working native build", async () => {
  const { host } = await hostWith([], {platform: "win32", arch: "x64"});
  const inventory = await host.inventory();
  const supported = (platform: string) =>
    inventory.find((entry) => entry.platform === platform)?.supported;

  assert.equal(supported("instagram"), true);
  assert.equal(supported("signal"), false);
  assert.equal(supported("discord"), false);
  assert.equal(supported("imessage"), false);

  const custom = await hostWith(["mautrix-signal.exe"], {
    platform: "win32",
    arch: "x64",
  });
  assert.equal(
    (await custom.host.inventory()).find((entry) => entry.platform === "signal")
      ?.supported,
    true,
    "a user-supplied native bridge can fill an upstream platform gap",
  );
});

test("Linux advertises every packaged bridge except iMessage", async () => {
  const { host } = await hostWith([], {platform: "linux", arch: "x64"});
  const inventory = await host.inventory();
  const unsupported = inventory
    .filter((entry) => !entry.supported)
    .map((entry) => entry.platform);

  assert.deepEqual(unsupported, ["imessage"]);
  assert.equal(inventory.filter((entry) => entry.supported).length, 14);
});

test("Linux arm64 omits the bridge with no native artifact", async () => {
  const { host } = await hostWith([], {platform: "linux", arch: "arm64"});
  const unsupported = (await host.inventory())
    .filter((entry) => !entry.supported)
    .map((entry) => entry.platform);

  assert.deepEqual(unsupported, ["googlechat", "imessage"]);
});

test("a user-supplied binary fills a gap the bundle does not cover", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-fleet-"));
  const bundled = path.join(root, "bundled");
  const userSupplied = path.join(root, "bin");
  await mkdir(bundled, { recursive: true });
  await mkdir(userSupplied, { recursive: true });
  // What ships in the app, and what the user dropped in themselves.
  await writeFile(path.join(bundled, "mautrix-whatsapp"), "", "utf8");
  await writeFile(path.join(userSupplied, "mautrix-googlechat"), "", "utf8");

  const host = new BridgeHost({
    directory: path.join(root, "bridges"),
    binariesDirectory: [bundled, userSupplied],
    homeserver: fakeHomeserver(),
  });

  const found = await host.discover();
  assert.deepEqual(
    found.map((bridge) => bridge.name).sort(),
    ["googlechat", "whatsapp"],
    "both directories are searched, so upstream gaps can be filled by hand",
  );
  assert.equal(
    found.find((bridge) => bridge.name === "googlechat")?.binary,
    path.join(userSupplied, "mautrix-googlechat"),
  );
});

test("the bundled copy wins over a stale one in the user directory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-fleet-"));
  const bundled = path.join(root, "bundled");
  const userSupplied = path.join(root, "bin");
  await mkdir(bundled, { recursive: true });
  await mkdir(userSupplied, { recursive: true });
  await writeFile(path.join(bundled, "mautrix-signal"), "", "utf8");
  await writeFile(path.join(userSupplied, "mautrix-signal"), "", "utf8");

  const host = new BridgeHost({
    directory: path.join(root, "bridges"),
    binariesDirectory: [bundled, userSupplied],
    homeserver: fakeHomeserver(),
  });

  assert.equal(
    (await host.discover()).find((bridge) => bridge.name === "signal")?.binary,
    path.join(bundled, "mautrix-signal"),
    "the version shipped with the app is the one it was tested against",
  );
});

test("a bridge's own credentials are written to its config and read back", async () => {
  const { host, root } = await hostWith(["mautrix-telegram"]);

  assert.deepEqual(
    await host.networkConfig("telegram"),
    {},
    "nothing is configured before the user supplies it",
  );

  await host.configureNetwork("telegram", {
    api_id: "2040",
    api_hash: "b18441a1ff607e10",
  });

  const config = await readFile(
    path.join(root, "bridges", "telegram", "config.yaml"),
    "utf8",
  );
  assert.match(config, /network:\n\s+api_id: 2040/);
  assert.match(config, /api_hash: b18441a1ff607e10/);
  assert.deepEqual(await host.networkConfig("telegram"), {
    api_id: "2040",
    api_hash: "b18441a1ff607e10",
  });
});

test("a bridge is configured to bring history across, and repaired if it is not", async () => {
  const { host, root } = await hostWith(["mautrix-signal"], {
    spawn: (() => fakeChild()) as unknown as typeof spawnFn,
  });
  const configPath = path.join(root, "bridges", "signal", "config.yaml");
  await seedRegistration(root, "signal");

  await host.ensure("signal");
  // Without this a bridge creates its rooms and syncs their members but brings
  // across nothing that was said before it was linked, so every conversation
  // opens empty. The binaries default it off.
  assert.match(
    await readFile(configPath, "utf8"),
    /^backfill:\n\s+enabled: true/m,
  );

  // The binaries write their own defaults back when they upgrade a config in
  // place, which turns it off again; a config already in that state is
  // repaired rather than left as the one thing that cannot be fixed by using
  // the app.
  const disabled = [
    "homeserver:",
    "    address: http://127.0.0.1:1",
    "backfill:",
    "    # Whether to do backfilling at all.",
    "    enabled: false",
    "    max_initial_messages: 50",
    "encryption:",
    "    enabled: false",
    "",
  ].join("\n");
  await writeFile(configPath, disabled, "utf8");
  // Stopped and started again, which is what a relaunch is: the repair belongs
  // to starting a bridge, not to asking for one that is already up.
  await host.close();
  await host.ensure("signal");

  const repaired = await readFile(configPath, "utf8");
  assert.match(repaired, /^backfill:\n\s+#.*\n\s+enabled: true/m);
  assert.match(
    repaired,
    /^encryption:\n\s+enabled: false/m,
    "and only that section is touched",
  );
});

test("a bridge is told to write the user's own messages as the user", async () => {
  const { host, root } = await hostWith(["mautrix-whatsapp"], {
    spawn: (() => fakeChild()) as unknown as typeof spawnFn,
  });
  const configPath = path.join(root, "bridges", "whatsapp", "config.yaml");
  await seedRegistration(root, "whatsapp");

  await host.ensure("whatsapp");
  // Without double puppeting, a message the user sent in WhatsApp itself comes
  // back from the puppet of their own number, so the thread cannot tell their
  // side from the contact's. The secret is the bridge's own appservice token,
  // which this homeserver accepts for the human it was installed for.
  const seeded = await readFile(configPath, "utf8");
  const asToken = /^[ \t]+as_token:[ \t]*(\S+)/m.exec(seeded)?.[1];
  assert.ok(asToken);
  assert.match(
    seeded,
    /^double_puppet:\n\s+servers:\n\s+polymux\.local: http:\/\/127\.0\.0\.1:47664/m,
  );
  assert.ok(seeded.includes(`polymux.local: as_token:${asToken}`));

  // And repaired in place for a config the binary has upgraded — which is
  // every install already out there, and cannot be fixed by using the app.
  // What it writes back is its own documentation: a filled-in block, with a
  // secret for example.com and a server nobody here has. A block that looks
  // configured but double puppets no one has to count as missing.
  const upstream = seeded.replace(
    /^double_puppet:\n(?:[ \t][^\n]*\n)*/m,
    [
      "double_puppet:",
      "    servers:",
      "        anotherserver.example.org: https://matrix.anotherserver.example.org",
      "    allow_discovery: false",
      "    secrets:",
      "        example.com: as_token:foobar",
      "",
    ].join("\n"),
  );
  await writeFile(configPath, upstream, "utf8");
  await host.close();
  await host.ensure("whatsapp");

  const repaired = await readFile(configPath, "utf8");
  assert.ok(repaired.includes(`polymux.local: as_token:${asToken}`));
  assert.ok(!repaired.includes("example.com: as_token:foobar"));
  assert.match(repaired, /^encryption:/m, "and the sections after it survive");
});

test("a bridge archives history once with persistent queue progress", async () => {
  const { host, root } = await hostWith(["mautrix-whatsapp"], {
    spawn: (() => fakeChild()) as unknown as typeof spawnFn,
  });
  const configPath = path.join(root, "bridges", "whatsapp", "config.yaml");
  await seedRegistration(root, "whatsapp");

  await host.ensure("whatsapp");
  const seeded = await readFile(configPath, "utf8");
  assert.match(seeded, /^    max_initial_messages: 50$/m);
  assert.match(seeded, /^    max_catchup_messages: 500$/m);
  assert.match(
    seeded,
    /^backfill:\n(?:[ \t][^\n]*\n)*?\s+queue:\n(?:\s+#.*\n)*\s+enabled: true/m,
  );

  // Repair the aggressive immediate budgets without disabling the persistent
  // archive queue. Its database, not this config, owns completed-task progress.
  await writeFile(
    configPath,
    [
      "homeserver:",
      "    address: http://127.0.0.1:1",
      "appservice:",
      "    as_token: aaa",
      "backfill:",
      "    enabled: true",
      "    max_initial_messages: 500",
      "    max_catchup_messages: 5000",
      "    threads:",
      "        max_initial_messages: 50",
      "    queue:",
      "        # Whether to enable the backfill queue.",
      "        enabled: false",
      "        batch_size: 100",
      "encryption:",
      "    allow: false",
      "",
    ].join("\n"),
    "utf8",
  );
  await host.close();
  await host.ensure("whatsapp");

  const repaired = await readFile(configPath, "utf8");
  assert.match(repaired, /^\s+queue:\n\s+#.*\n\s+enabled: true/m);
  assert.match(
    repaired,
    /^    max_initial_messages: 50/m,
    "the old initial budget is reduced",
  );
  assert.match(repaired, /^    max_catchup_messages: 500/m);
  // A per-thread budget, multiplied by every thread in a chat — not the same
  // number as the chat's own limit and not raised with it.
  assert.match(repaired, /^        max_initial_messages: 50$/m);
  assert.match(repaired, /^\s+batch_size: 100/m, "and nothing else is touched");
  assert.match(repaired, /^encryption:\n\s+allow: false/m);
});

test("WhatsApp is not asked to export its whole history on every bridge login", async () => {
  const { host, root } = await hostWith(["mautrix-whatsapp"], {
    spawn: (() => fakeChild()) as unknown as typeof spawnFn,
  });
  const configPath = path.join(root, "bridges", "whatsapp", "config.yaml");
  await seedRegistration(root, "whatsapp");
  // This is the aggressive config written by older Polymux versions. Because
  // the request is made when the bridge logs in, it can repeatedly make the
  // phone announce that another device is syncing after desktop restarts.
  await writeFile(
    configPath,
    [
      "network:",
      "    history_sync:",
      "        # Should the bridge request a full sync from the phone?",
      "        request_full_sync: true",
      "        full_sync_config:",
      "            days_limit: 3650",
      "            size_mb_limit: 5000",
      "            storage_quota_mb: 5000",
      "backfill:",
      "    enabled: true",
      "",
    ].join("\n"),
    "utf8",
  );

  await host.ensure("whatsapp");

  const repaired = await readFile(configPath, "utf8");
  assert.match(repaired, /^\s+request_full_sync: false/m);
  assert.match(repaired, /^\s+days_limit: null/m);
  assert.match(repaired, /^\s+size_mb_limit: null/m);
  assert.match(repaired, /^\s+storage_quota_mb: null/m);
});

test("configuring a shared binary keeps its network mode", async () => {
  const { host } = await hostWith(["mautrix-meta"]);
  await host.configureNetwork("instagram", { some_key: "value" });

  assert.equal(
    (await host.networkConfig("instagram")).mode,
    "instagram",
    "a later write must not drop the mode that tells meta which network it is",
  );
});

test("rewriting the network block leaves the rest of the config alone", () => {
  const config = [
    "homeserver:",
    "    address: http://127.0.0.1:47664",
    "network:",
    "    api_id: 1",
    "appservice:",
    "    port: 29801",
    "",
  ].join("\n");

  const updated = withNetwork(config, { api_id: "2040", api_hash: "abc" });

  assert.match(updated, /api_id: 2040/);
  assert.match(updated, /api_hash: abc/);
  assert.match(
    updated,
    /address: http:\/\/127\.0\.0\.1:47664/,
    "the homeserver block survives",
  );
  assert.match(updated, /port: 29801/, "and so does everything after it");
});

test("a config with no network block yet gains one", () => {
  const updated = withNetwork("homeserver:\n    address: http://x\n", {
    mode: "instagram",
  });
  assert.match(updated, /^homeserver:/);
  assert.match(updated, /network:\n {4}mode: instagram/);
});

test("a legacy bridge crash-looping on a modern seed is healed at startup", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-fleet-"));
  const binariesDirectory = path.join(root, "bin");
  await mkdir(binariesDirectory, { recursive: true });
  await writeFile(path.join(binariesDirectory, "mautrix-discord"), "", "utf8");

  // What an earlier Polymux seeded: the modern layout, which mautrix-discord
  // rejects at startup — plus the registration minted alongside it.
  const home = path.join(root, "bridges", "discord");
  await mkdir(home, { recursive: true });
  await writeFile(
    path.join(home, "config.yaml"),
    [
      "homeserver:",
      "    address: http://x",
      "    domain: polymux.local",
      "    software: standard",
      "database:",
      "    type: sqlite3-fk-wal",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(home, "registration.yaml"),
    ["id: discord", "as_token: old", "hs_token: old", ""].join("\n"),
    "utf8",
  );

  const spawned: string[][] = [];
  const host = new BridgeHost({
    directory: path.join(root, "bridges"),
    binariesDirectory,
    homeserver: fakeHomeserver(),
    spawn: ((binary: string, args: string[]) => {
      spawned.push([binary, ...args]);
      // `-g` regenerates the registration the heal deleted.
      if (args.includes("-g")) {
        const child = fakeChild();
        void writeFile(
          path.join(home, "registration.yaml"),
          ["id: discord", "as_token: new", "hs_token: new", ""].join("\n"),
          "utf8",
        ).then(() => child.emit("exit", 0));
        return child;
      }
      return fakeChild();
    }) as unknown as typeof import("node:child_process").spawn,
  });

  await host.startAll();
  await host.close();

  const config = await readFile(path.join(home, "config.yaml"), "utf8");
  assert.doesNotMatch(
    config,
    /software: standard/,
    "the modern-only key is gone",
  );
  assert.match(
    config,
    /appservice:\n(?:.*\n)*? {4}database:/,
    "database now lives under appservice",
  );
  assert.match(
    config,
    /bridge:\n(?:.*\n)*? {4}provisioning:/,
    "provisioning now lives under bridge",
  );
  const registration = await readFile(
    path.join(home, "registration.yaml"),
    "utf8",
  );
  assert.match(
    registration,
    /as_token: new/,
    "the stale registration was regenerated",
  );
});

test("Windows adopts the config update that matches a generated registration", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-fleet-"));
  const binariesDirectory = path.join(root, "bin");
  await mkdir(binariesDirectory, { recursive: true });
  await writeFile(path.join(binariesDirectory, "mautrix-instagram.exe"), "", "utf8");
  const home = path.join(root, "bridges", "instagram");

  const host = new BridgeHost({
    directory: path.join(root, "bridges"),
    binariesDirectory,
    homeserver: fakeHomeserver(),
    platform: "win32",
    readyTimeoutMs: 0,
    spawn: ((_binary: string, args: string[]) => {
      const child = fakeChild();
      if (args.includes("-g")) {
        const completed = [
          "homeserver:",
          "    address: http://127.0.0.1:47664",
          "    domain: polymux.local",
          "appservice:",
          "    id: instagram",
          "    as_token: registered-as",
          "    hs_token: registered-hs",
          "full_config_marker: true",
          "",
        ].join("\n");
        void Promise.all([
          writeFile(
            path.join(home, "registration.yaml"),
            "id: instagram\nas_token: registered-as\nhs_token: registered-hs\n",
            "utf8",
          ),
          writeFile(
            path.join(home, "mautrix-config-1.yaml"),
            "appservice:\n    as_token: stale\n    hs_token: stale\n",
            "utf8",
          ),
          writeFile(
            path.join(home, "mautrix-config-2.yaml"),
            completed,
            "utf8",
          ),
        ]).then(() => child.emit("exit", 0));
      }
      return child;
    }) as unknown as typeof spawnFn,
  });

  await host.startAll();
  await host.close();

  const config = await readFile(path.join(home, "config.yaml"), "utf8");
  assert.match(config, /as_token: registered-as/);
  assert.match(config, /hs_token: registered-hs/);
  assert.match(config, /full_config_marker: true/);
  assert.deepEqual(
    (await readdir(home)).filter((name) => /^mautrix-config-\d+\.yaml$/.test(name)),
    [],
    "temporary configs left by Windows are cleaned up",
  );
});

test("an Instagram config missing its network mode is repaired, not replaced", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-fleet-"));
  const binariesDirectory = path.join(root, "bin");
  await mkdir(binariesDirectory, { recursive: true });
  await writeFile(
    path.join(binariesDirectory, "mautrix-instagram"),
    "",
    "utf8",
  );

  const home = path.join(root, "bridges", "instagram");
  await mkdir(home, { recursive: true });
  // Seeded before the network block existed; `sentinel_key` stands in for a
  // hand-made addition that a wholesale reseed would have destroyed.
  await writeFile(
    path.join(home, "config.yaml"),
    ["homeserver:", "    address: http://x", "sentinel_key: keep-me", ""].join(
      "\n",
    ),
    "utf8",
  );
  await writeFile(
    path.join(home, "registration.yaml"),
    ["id: instagram", "as_token: a", "hs_token: h", ""].join("\n"),
    "utf8",
  );
  await mkdir(path.join(root, "bridges", "messenger"), { recursive: true });
  await writeFile(
    path.join(root, "bridges", "messenger", "registration.yaml"),
    ["id: messenger", "as_token: a", "hs_token: h", ""].join("\n"),
    "utf8",
  );

  const host = new BridgeHost({
    directory: path.join(root, "bridges"),
    binariesDirectory,
    homeserver: fakeHomeserver(),
    spawn: (() =>
      fakeChild()) as unknown as typeof import("node:child_process").spawn,
  });
  await host.startAll();
  await host.close();

  const config = await readFile(path.join(home, "config.yaml"), "utf8");
  assert.match(
    config,
    /network:\n {4}mode: instagram/,
    "the required mode was merged in",
  );
  assert.match(
    config,
    /sentinel_key: keep-me/,
    "everything already there survived",
  );
});

test("every platform in the fleet is one the protocol knows how to route", () => {
  for (const spec of BRIDGE_FLEET) {
    const entry = COMMS_PLATFORMS.find(
      (platform) => platform.value === spec.platform,
    );
    assert.ok(
      entry,
      `${spec.platform} runs here but is missing from COMMS_PLATFORMS`,
    );
    assert.equal(
      entry.route,
      spec.platform,
      `${spec.platform} needs a provisioning route matching its bridge name`,
    );
  }
});

test("the seed config binds each instance to its own network and port", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-fleet-"));
  const binariesDirectory = path.join(root, "bin");
  await mkdir(binariesDirectory, { recursive: true });
  await writeFile(path.join(binariesDirectory, "mautrix-meta"), "", "utf8");
  await writeFile(
    path.join(binariesDirectory, "mautrix-instagram"),
    "",
    "utf8",
  );

  // A registration the bridge would otherwise generate with `-g`, so startup
  // never has to run the (empty) binary to produce one.
  for (const platform of ["messenger", "instagram"]) {
    await mkdir(path.join(root, "bridges", platform), { recursive: true });
    await writeFile(
      path.join(root, "bridges", platform, "registration.yaml"),
      [
        "id: test",
        "as_token: as-token",
        "hs_token: hs-token",
        "url: http://127.0.0.1:1",
        "",
      ].join("\n"),
      "utf8",
    );
  }

  const spawned: string[][] = [];
  const host = new BridgeHost({
    directory: path.join(root, "bridges"),
    binariesDirectory,
    homeserver: fakeHomeserver(),
    spawn: ((binary: string, args: string[]) => {
      spawned.push([binary, ...args]);
      return fakeChild();
    }) as unknown as typeof import("node:child_process").spawn,
  });

  await host.startAll();
  await host.close();

  const config = async (platform: string) =>
    readFile(path.join(root, "bridges", platform, "config.yaml"), "utf8");
  const instagram = await config("instagram");
  const messenger = await config("messenger");

  assert.match(
    instagram,
    /network:\n\s+mode: instagram/,
    "the network mode reaches the config",
  );
  assert.match(messenger, /network:\n\s+mode: messenger/);
  assert.match(
    instagram,
    /id: instagram/,
    "each instance is its own appservice",
  );
  assert.match(instagram, /username: instagrambot/);

  const portOf = (source: string) => Number(source.match(/port: (\d+)/)?.[1]);
  assert.notEqual(
    portOf(instagram),
    portOf(messenger),
    "the two services cannot share an appservice port",
  );
  assert.equal(spawned.length, 2, "both instances are supervised");
});

/**
 * A bridge that cannot succeed must not be started. Both of the ways one can
 * be doomed at launch — a credential only the user has, a grant only macOS can
 * give — used to be discovered by starting it anyway and watching it die once
 * a minute, forever, with nothing but the crash in the log to say why.
 */
test("a bridge waiting on its own credentials is parked instead of started", async () => {
  const spawned: string[][] = [];
  const { host } = await hostWith(["mautrix-telegram"], {
    spawn: ((binary: string, args: string[]) => {
      spawned.push([binary, ...args]);
      return fakeChild();
    }) as unknown as typeof spawnFn,
  });

  await host.startAll();
  await host.close();

  assert.deepEqual(spawned, [], "nothing is launched that is known to fail");
  assert.match(
    (await blockedReason(host, "telegram")) ?? "",
    /api_id and api_hash/,
    "the inventory says what it is waiting for, so the tab can ask for it",
  );
});

test("supplying the credentials starts the bridge that was waiting for them", async () => {
  const spawned: string[][] = [];
  const { host, root } = await hostWith(["mautrix-telegram"], {
    spawn: ((binary: string, args: string[]) => {
      spawned.push([binary, ...args]);
      return fakeChild();
    }) as unknown as typeof spawnFn,
  });
  await seedRegistration(root, "telegram");

  await host.startAll();
  assert.equal(spawned.length, 0, "parked to begin with");

  await host.configureNetwork("telegram", {
    api_id: "2040",
    api_hash: "b18441a1ff607e10",
  });
  await host.close();

  assert.equal(
    spawned.length,
    1,
    "a parked bridge is launched by the values it was waiting for",
  );
  assert.equal(
    await blockedReason(host, "telegram"),
    null,
    "and stops being reported as held back",
  );
});

/**
 * The alternative to asking: a build that carries its own registered pair.
 * Telegram is the only network that needs one, and the difference between
 * shipping it and not is the difference between "scan this QR" and "go
 * register an application on another website first".
 */
test("a pair shipped with the build starts the bridge without asking for one", async () => {
  const spawned: string[][] = [];
  const { host, root } = await hostWith(["mautrix-telegram"], {
    shippedCredentials: (platform: string) =>
      platform === "telegram"
        ? { api_id: "2040", api_hash: "b18441a1ff607e10" }
        : {},
    spawn: ((binary: string, args: string[]) => {
      spawned.push([binary, ...args]);
      return fakeChild();
    }) as unknown as typeof spawnFn,
  });
  await seedRegistration(root, "telegram");

  await host.startAll();
  await host.close();

  assert.equal(
    spawned.length,
    1,
    "nothing is waiting on a credential the build already has",
  );
  assert.equal(await blockedReason(host, "telegram"), null);
  const config = await readFile(
    path.join(root, "bridges", "telegram", "config.yaml"),
    "utf8",
  );
  assert.match(
    config,
    /network:\n\s+api_id: 2040/,
    "and the bridge runs on it",
  );
});

test("a pair the user supplies wins over the one shipped with the build", async () => {
  const { host } = await hostWith(["mautrix-telegram"], {
    shippedCredentials: () => ({
      api_id: "2040",
      api_hash: "b18441a1ff607e10",
    }),
  });

  await host.configureNetwork("telegram", { api_id: "99", api_hash: "mine" });
  await host.close();

  assert.deepEqual(await host.networkConfig("telegram"), {
    api_id: "99",
    api_hash: "mine",
  });
});

test("a bridge that keeps dying is left down rather than looping forever", async () => {
  const spawned: string[][] = [];
  const { host, root } = await hostWith(["mautrix-whatsapp"], {
    restartDelaysMs: [1],
    spawn: ((binary: string, args: string[]) => {
      spawned.push([binary, ...args]);
      return crashingChild();
    }) as unknown as typeof spawnFn,
  });
  await seedRegistration(root, "whatsapp");

  await host.startAll();
  await until(
    () => spawned.length >= 5,
    "the bridge should have used its restart budget",
  );
  const settled = spawned.length;
  await new Promise((resolve) => setTimeout(resolve, 50));
  await host.close();

  assert.equal(
    spawned.length,
    settled,
    "the restarts stop rather than running once a minute",
  );
  assert.match(
    (await blockedReason(host, "whatsapp")) ?? "",
    /keeps failing to start/,
    "and the tab is told, instead of the bridge just being quiet",
  );
});

test("bridge logs omit handled reconnect chatter and prefix every diagnostic line", async () => {
  const logs: string[] = [];
  const children = new Map<string, ReturnType<typeof outputChild>>();
  const { host, root } = await hostWith(["mautrix-whatsapp", "mautrix-meta"], {
    log: (line) => logs.push(line),
    spawn: ((binary: string) => {
      const child = outputChild();
      children.set(path.basename(binary), child);
      return child;
    }) as unknown as typeof spawnFn,
  });
  await seedRegistration(root, "whatsapp");
  await seedRegistration(root, "messenger");
  await host.startAll();

  const whatsapp = children.get("mautrix-whatsapp")!;
  whatsapp.stderr.write(
    "2026-08-28T05:42:40.659+08:00 WRN Received stream end frame component=whatsmeow\n" +
      "2026-08-28T05:42:40.659+08:00 WRN Got 503 stream error, assuming automatic reconnect will handle it component=whatsmeow\n",
  );
  whatsapp.stderr.write(
    "2026-08-28T05:42:40.770+08:00 ERR Error reading from websocket: failed to get reader: ",
  );
  whatsapp.stderr.write(
    "failed to read frame header: EOF component=whatsmeow\n" +
      "2026-08-28T05:42:41.000+08:00 INF Connection restored component=whatsmeow\n" +
      "2026-08-28T05:42:42.000+08:00 ERR Database write failed component=database\n",
  );

  const messenger = children.get("mautrix-meta")!;
  messenger.stdout.write(
    '2026-08-28T06:03:02.421+08:00 ERR Error reading message from socket error="failed to get reader: failed to read frame header: EOF" component=messagix\n' +
      '2026-08-28T06:03:02.523+08:00 ERR Error in connection, reconnecting error="error in read loop: failed to read message: failed to get reader: failed to read frame header: EOF" component=messagix reconnect_in=0\n' +
      '2026-08-28T06:03:03.372+08:00 WRN No transactions found component=messagix payload="{}"\n' +
      '2026-08-28T10:16:36.326+08:00 WRN decode.go:282:handleStoredProcedure() > Failed to set int64 field_index=112 field_name=AttachmentLoggingType global_log=true struct_name=LSInsertXmaAttachment val="<redacted string>" val_type=string\n' +
      '2026-08-28T10:16:36.326+08:00 WRN decode.go:217:handleStoredProcedure() > Skipping dependency with no reference global_log=true reference_name=applyAdminMessageCTAV2\n' +
      '2026-08-28T10:16:36.349+08:00 WRN No target message found for read receipt action="handle remote event" bridge_evt_type=RemoteEventReadReceipt portal_id=10069664666446875 read_up_to=1786651625404\n' +
      '2026-08-28T10:16:37.000+08:00 WRN decode.go:282:handleStoredProcedure() > Failed to set int64 field_name=MessageId global_log=true struct_name=LSInsertMessage val="bad" val_type=string\n' +
      '2026-08-28T10:16:38.000+08:00 WRN decode.go:217:handleStoredProcedure() > Skipping dependency with no reference global_log=true reference_name=insertMessageV3\n' +
      "2026-08-28T06:03:04.000+08:00 INF Sync resumed component=messagix\n",
  );

  assert.deepEqual(logs, [
    "[whatsapp] 2026-08-28T05:42:41.000+08:00 INF Connection restored component=whatsmeow",
    "[whatsapp] 2026-08-28T05:42:42.000+08:00 ERR Database write failed component=database",
    '[messenger] 2026-08-28T10:16:37.000+08:00 WRN decode.go:282:handleStoredProcedure() > Failed to set int64 field_name=MessageId global_log=true struct_name=LSInsertMessage val="bad" val_type=string',
    "[messenger] 2026-08-28T10:16:38.000+08:00 WRN decode.go:217:handleStoredProcedure() > Skipping dependency with no reference global_log=true reference_name=insertMessageV3",
    "[messenger] 2026-08-28T06:03:04.000+08:00 INF Sync resumed component=messagix",
  ]);
  await host.close();
});

test(
  "iMessage names the grant that would unblock it, and only when one would",
  { skip: process.platform !== "darwin" ? "macOS-only grant" : false },
  async () => {
    const home = await mkdtemp(path.join(tmpdir(), "polymux-home-"));
    const database = path.join(home, "Library", "Messages", "chat.db");

    const absent = await messagesDatabaseAccess({ home });
    assert.match(absent?.reason ?? "", /Messages has never been set up/);
    assert.equal(
      absent?.permission,
      undefined,
      "no grant creates a database that was never made, so no button is offered",
    );

    // Standing in for what macOS does without Full Disk Access: the file is
    // there and this process cannot open it.
    await mkdir(path.dirname(database), { recursive: true });
    await writeFile(database, "", "utf8");
    await chmod(database, 0o000);
    const denied = await messagesDatabaseAccess({ home });
    assert.match(denied?.reason ?? "", /Full Disk Access/);
    assert.equal(
      denied?.permission,
      "full-disk-access",
      "the grant travels with the reason, so the tab can offer it rather than describe it",
    );

    await chmod(database, 0o600);
    assert.equal(
      await messagesDatabaseAccess({ home }),
      null,
      "a database both this process and its child can open does not hold the bridge back",
    );

    const childDenied = await messagesDatabaseAccess({
      home,
      childProbe: async () => false,
    });
    assert.match(
      childDenied?.reason ?? "",
      /child processes launched by it cannot read/,
    );
    assert.equal(
      childDenied?.permission,
      "full-disk-access",
      "the bridge stays parked when the app grant does not reach its child process",
    );
  },
);

/**
 * The other half of parking a bridge: something has to bring it back. A grant
 * given in System Settings arrives with nothing to announce it, so the tab
 * asks the host to look again — and the answer has to be a fresh check rather
 * than the reason it recorded at launch.
 */
test("looking again starts a bridge whose blocker has since been cleared", async () => {
  const spawned: string[][] = [];
  const { host, root } = await hostWith(["mautrix-telegram"], {
    spawn: ((binary: string, args: string[]) => {
      spawned.push([binary, ...args]);
      return fakeChild();
    }) as unknown as typeof spawnFn,
  });
  await seedRegistration(root, "telegram");

  await host.startAll();
  assert.equal(
    spawned.length,
    0,
    "parked, because the credentials are not there yet",
  );

  await host.retryBlocked();
  assert.equal(
    spawned.length,
    0,
    "and looking again while still blocked changes nothing",
  );

  // Written straight to the config, as if a previous run had recorded them —
  // configureNetwork would start the bridge itself, which is not what is under
  // test here.
  await writeFile(
    path.join(root, "bridges", "telegram", "config.yaml"),
    withNetwork(
      await readFile(
        path.join(root, "bridges", "telegram", "config.yaml"),
        "utf8",
      ),
      { api_id: "2040", api_hash: "abc" },
    ),
    "utf8",
  );
  await host.retryBlocked();
  await host.close();

  assert.equal(spawned.length, 1, "the bridge starts once its blocker is gone");
  assert.equal(await blockedReason(host, "telegram"), null);
});

test("looking again leaves a bridge that burned its restart budget down", async () => {
  const spawned: string[][] = [];
  const { host, root } = await hostWith(["mautrix-whatsapp"], {
    restartDelaysMs: [1],
    spawn: ((binary: string, args: string[]) => {
      spawned.push([binary, ...args]);
      return crashingChild();
    }) as unknown as typeof spawnFn,
  });
  await seedRegistration(root, "whatsapp");

  await host.startAll();
  await until(
    () => spawned.length >= 5,
    "the bridge should have used its restart budget",
  );
  const settled = spawned.length;

  await host.retryBlocked();
  await new Promise((resolve) => setTimeout(resolve, 30));
  await host.close();

  assert.equal(
    spawned.length,
    settled,
    "a bridge that is not waiting on the user is not restarted by looking again",
  );
});

/**
 * The heal above has to be a one-shot. These binaries accept `software:` under
 * `homeserver:` and write it back when they upgrade the config in place, so a
 * detector keyed on it matched the very config the heal had just written —
 * and every launch threw away working tokens, deleted the registration and
 * minted new ones. The marker has to be something only the modern seed writes.
 */
test("a healed legacy bridge is left alone on the next launch", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-fleet-"));
  const binariesDirectory = path.join(root, "bin");
  await mkdir(binariesDirectory, { recursive: true });
  await writeFile(path.join(binariesDirectory, "mautrix-discord"), "", "utf8");

  // The legacy layout Polymux seeds — database under `appservice:` — after the
  // binary has upgraded it in place and added its own `software:` default.
  const home = path.join(root, "bridges", "discord");
  await mkdir(home, { recursive: true });
  const seeded = [
    "homeserver:",
    "    address: http://x",
    "    domain: polymux.local",
    "    software: standard",
    "appservice:",
    "    id: discord",
    "    as_token: keep-me",
    "    hs_token: keep-me",
    "    database:",
    "        type: sqlite3-fk-wal",
    "",
  ].join("\n");
  await writeFile(path.join(home, "config.yaml"), seeded, "utf8");
  await writeFile(
    path.join(home, "registration.yaml"),
    ["id: discord", "as_token: keep-me", "hs_token: keep-me", ""].join("\n"),
    "utf8",
  );

  const { host } = await hostWith([], {
    directory: path.join(root, "bridges"),
    binariesDirectory,
    // A reseed deletes the registration and regenerates it with `-g`. Answering
    // that here keeps a regression failing on the assertions below rather than
    // hanging on a `-g` pass that never finishes.
    spawn: ((_binary: string, args: string[]) => {
      const child = fakeChild();
      if (args.includes("-g"))
        void writeFile(
          path.join(home, "registration.yaml"),
          ["id: discord", "as_token: fresh", "hs_token: fresh", ""].join("\n"),
          "utf8",
        ).then(() => child.emit("exit", 0));
      return child;
    }) as unknown as typeof spawnFn,
  });
  await host.startAll();
  await host.close();

  assert.equal(
    await readFile(path.join(home, "config.yaml"), "utf8"),
    seeded,
    "a config already in the shape this bridge accepts is not rewritten",
  );
  assert.match(
    await readFile(path.join(home, "registration.yaml"), "utf8"),
    /as_token: keep-me/,
    "and its tokens survive, so the bridge keeps the account it was linked to",
  );
});

/**
 * Which bridges come up at launch. Starting the whole installed fleet cost a
 * dozen Go processes and their databases on a machine that had signed into
 * nothing — so a bridge now has to be carrying an account, or be asked for.
 */
test("only bridges with a linked account start at launch", async () => {
  const spawned: string[][] = [];
  const { host, root } = await hostWith(
    ["mautrix-whatsapp", "mautrix-signal"],
    {
      spawn: ((binary: string, args: string[]) => {
        spawned.push([binary, ...args]);
        return fakeChild();
      }) as unknown as typeof spawnFn,
    },
  );
  await seedRegistration(root, "whatsapp");
  await seedRegistration(root, "signal");
  // WhatsApp has an account on it; Signal has a database but nobody signed in.
  linkedDatabase(path.join(root, "bridges", "whatsapp", "bridge.db"), 1);
  linkedDatabase(path.join(root, "bridges", "signal", "bridge.db"), 0);

  await host.startLinked();
  await host.close();

  assert.equal(spawned.length, 1, "one of the two is carrying anything");
  assert.match(spawned[0][0], /mautrix-whatsapp$/, "and it is the linked one");
});

test("a bridge nobody has linked starts when its platform is opened", async () => {
  const spawned: string[][] = [];
  const { host, root } = await hostWith(["mautrix-signal"], {
    spawn: ((binary: string, args: string[]) => {
      spawned.push([binary, ...args]);
      return fakeChild();
    }) as unknown as typeof spawnFn,
  });
  await seedRegistration(root, "signal");

  await host.startLinked();
  assert.equal(spawned.length, 0, "nothing is linked, so nothing runs");
  assert.equal(
    (await host.inventory()).find((entry) => entry.platform === "signal")
      ?.running,
    false,
    "and the tab is told it is dormant rather than silent",
  );

  // Hover then click: the UI asks twice in quick succession, and two processes
  // fighting over one appservice port would be worse than never starting.
  await Promise.all([host.ensure("signal"), host.ensure("signal")]);
  await host.ensure("signal");
  await host.close();

  assert.equal(spawned.length, 1, "asking repeatedly starts it exactly once");
  assert.equal(
    (await host.inventory()).find((entry) => entry.platform === "signal")
      ?.running,
    false,
    "and it reads as stopped again once the host is closed",
  );
});

/**
 * The gap between spawning a bridge and it accepting connections is tens of
 * milliseconds, and the UI reads the fleet the instant `ensure` resolves. When
 * `ensure` returned at spawn time, that read probed a port nothing was
 * listening on yet and the panel showed "the bridge is not responding" for a
 * bridge that was starting perfectly well — and it stuck, because nothing
 * looked again.
 */
test("ensure waits for the bridge to answer, not just to be spawned", async () => {
  const port = 29_972; // basePort + signal's index in the fleet.
  const listener = createServer();
  const { host, root } = await hostWith(["mautrix-signal"], {
    basePort: 29_970,
    readyTimeoutMs: 2_000,
    // Stands in for the real binary: the child exists immediately, the port
    // opens a little later.
    spawn: (() => {
      const child = fakeChild();
      setTimeout(() => listener.listen(port, "127.0.0.1"), 80);
      return child;
    }) as unknown as typeof spawnFn,
  });
  await seedRegistration(root, "signal");

  const started = Date.now();
  await host.ensure("signal");
  const waited = Date.now() - started;

  const answering = await new Promise<boolean>((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("error", () => (socket.destroy(), resolve(false)));
  });
  listener.close();
  await host.close();

  assert.ok(
    waited >= 80,
    `ensure resolved after ${waited}ms, before the port was open`,
  );
  assert.equal(
    answering,
    true,
    "so whatever reads the fleet next finds a bridge that answers",
  );
});

test("ensure gives up on a bridge that dies instead of waiting out its budget", async () => {
  const { host, root } = await hostWith(["mautrix-signal"], {
    basePort: 29_980,
    // Long enough that waiting it out would be obvious in the elapsed time.
    readyTimeoutMs: 10_000,
    spawn: (() => crashingChild()) as unknown as typeof spawnFn,
  });
  await seedRegistration(root, "signal");

  const started = Date.now();
  await host.ensure("signal");
  const waited = Date.now() - started;
  await host.close();

  assert.ok(
    waited < 2_000,
    `waited ${waited}ms for a bridge that was never coming up`,
  );
});

/**
 * A config the binary wrote back with its own defaults. The two sub-maps carry
 * the same key names, which is the trap: a repair that matches on the action
 * names alone deletes the user's history the first time WhatsApp invalidates a
 * session on its own.
 */
const CLEANUP_DEFAULTS = [
  "bridge:",
  "    permissions:",
  '        "flare.local": user',
  "    cleanup_on_logout:",
  "        # Should cleanup on logout be enabled at all?",
  "        enabled: false",
  "        # Settings for manual logouts",
  "        manual:",
  "            private: nothing",
  "            relayed: nothing",
  "            shared_no_users: nothing",
  "            shared_has_users: nothing",
  "        bad_credentials:",
  "            private: nothing",
  "            relayed: nothing",
  "            shared_no_users: nothing",
  "            shared_has_users: nothing",
  "encryption:",
  "    allow: false",
  "",
].join("\n");

const HOMESERVER = {
  serverName: "flare.local",
  baseUrl: "http://127.0.0.1:47664",
};

test("a manual logout is repaired to take its portals with it", () => {
  const repaired = repairConfig(CLEANUP_DEFAULTS, HOMESERVER);
  const manual = repaired.slice(
    repaired.indexOf("        manual:"),
    repaired.indexOf("        bad_credentials:"),
  );
  assert.match(repaired, /^ +enabled: true$/m);
  assert.equal(manual.match(/: delete$/gm)?.length, 4);
});

test("credentials invalidated by the network delete nothing", () => {
  const repaired = repairConfig(CLEANUP_DEFAULTS, HOMESERVER);
  const bad = repaired.slice(
    repaired.indexOf("        bad_credentials:"),
    repaired.indexOf("encryption:"),
  );
  assert.equal(bad.match(/: nothing$/gm)?.length, 4);
  assert.ok(!bad.includes("delete"));
});

test("a config already repaired is left byte for byte alone", () => {
  const once = repairConfig(CLEANUP_DEFAULTS, HOMESERVER);
  assert.equal(repairConfig(once, HOMESERVER), once);
});

test("Instagram reel media is fetched during live sync and backfill", () => {
  const source = `${CLEANUP_DEFAULTS}network:\n    mode: instagram\n    disable_xma_backfill: true\n    disable_xma_always: true\n`;
  const repaired = repairConfig(source, {
    ...HOMESERVER,
    platform: "instagram",
  });
  assert.match(repaired, /^    disable_xma_backfill: false$/m);
  assert.match(repaired, /^    disable_xma_always: false$/m);
  assert.equal(
    repairConfig(repaired, { ...HOMESERVER, platform: "instagram" }),
    repaired,
  );
});

test("a legacy config is not touched by the cleanup repair", () => {
  const repaired = repairConfig(CLEANUP_DEFAULTS, {
    ...HOMESERVER,
    legacy: true,
  });
  assert.ok(repaired.includes("enabled: false"));
});
