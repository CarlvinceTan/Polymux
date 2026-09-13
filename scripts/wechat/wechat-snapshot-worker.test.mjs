import assert from "node:assert/strict";
import {createCipheriv, createHmac, pbkdf2Sync, randomBytes} from "node:crypto";
import fs from "node:fs";
import {copyFile, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {DatabaseSync} from "node:sqlite";
import {fileURLToPath} from "node:url";
import {syncBuiltinESMExports} from "node:module";
import {committedWalFrames, SnapshotEngine} from "./wechat-snapshot-worker.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, "fixtures/wechat-desktop-store");
const key = Buffer.alloc(32, 0x11);
const PAGE_SIZE = 4096;

async function withFixture(body) {
  const directory = await mkdtemp(path.join(tmpdir(), "wechat-worker-test-"));
  const main = path.join(directory, "catalog.db");
  const snapshot = path.join(directory, "snapshot.db");
  await copyFile(path.join(fixture, "catalog.db"), main);
  try {
    await body({main, snapshot});
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
}

function favoriteCount(snapshot) {
  const database = new DatabaseSync(snapshot, {readOnly: true});
  try {
    return Number(database.prepare("SELECT COUNT(*) AS count FROM kFavEmoticonOrderTable").get().count);
  } finally {
    database.close();
  }
}

function encryptPage(plain, pageKey, salt, pageNumber) {
  const macKey = pbkdf2Sync(pageKey, Buffer.from(salt).map((byte) => byte ^ 0x3a), 2, 32, "sha512");
  const encrypted = Buffer.alloc(PAGE_SIZE);
  const start = pageNumber === 1 ? 16 : 0;
  if (pageNumber === 1) salt.copy(encrypted);
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", pageKey, iv);
  cipher.setAutoPadding(false);
  Buffer.concat([cipher.update(plain.subarray(start, PAGE_SIZE - 80)), cipher.final()])
    .copy(encrypted, start);
  iv.copy(encrypted, PAGE_SIZE - 80);
  const number = Buffer.alloc(4);
  number.writeUInt32LE(pageNumber);
  createHmac("sha512", macKey)
    .update(encrypted.subarray(start, PAGE_SIZE - 64)).update(number).digest()
    .copy(encrypted, PAGE_SIZE - 64);
  return encrypted;
}

function walChecksum(bytes, initial = [0, 0]) {
  let [a, b] = initial;
  for (let offset = 0; offset < bytes.length; offset += 8) {
    a = (a + bytes.readUInt32LE(offset) + b) >>> 0;
    b = (b + bytes.readUInt32LE(offset + 4) + a) >>> 0;
  }
  return [a, b];
}

function buildWal(frames, salt1, salt2) {
  const header = Buffer.alloc(32);
  header.writeUInt32BE(0x377f0682, 0);
  header.writeUInt32BE(3007000, 4);
  header.writeUInt32BE(PAGE_SIZE, 8);
  header.writeUInt32BE(salt1, 16);
  header.writeUInt32BE(salt2, 20);
  let [a, b] = walChecksum(header.subarray(0, 24));
  header.writeUInt32BE(a, 24);
  header.writeUInt32BE(b, 28);
  const parts = [header];
  for (const frame of frames) {
    const frameHeader = Buffer.alloc(24);
    frameHeader.writeUInt32BE(frame.pageNumber, 0);
    frameHeader.writeUInt32BE(frame.commitSize, 4);
    frameHeader.writeUInt32BE(salt1, 8);
    frameHeader.writeUInt32BE(salt2, 12);
    [a, b] = walChecksum(frameHeader.subarray(0, 8), [a, b]);
    [a, b] = walChecksum(frame.page, [a, b]);
    frameHeader.writeUInt32BE(a, 16);
    frameHeader.writeUInt32BE(b, 20);
    parts.push(frameHeader, frame.page);
  }
  return Buffer.concat(parts);
}

test("a full SQLite SHM header suppresses reset WAL frames", async () => {
  await withFixture(async ({main, snapshot}) => {
    await copyFile(path.join(fixture, "catalog.db-wal"), `${main}-wal`);
    const header = await readFile(path.join(fixture, "empty-wal-index.bin"));
    const shm = Buffer.alloc(32 * 1024);
    header.copy(shm);
    await writeFile(`${main}-shm`, shm);
    const engine = new SnapshotEngine(main, key, snapshot);
    try {
      await engine.open();
      assert.equal(favoriteCount(snapshot), 0);
    } finally {
      await engine.close();
    }
  });
});

test("a commit appearing after the published source is picked up by refresh", async () => {
  await withFixture(async ({main, snapshot}) => {
    const originalRename = fs.promises.rename;
    let injected = false;
    fs.promises.rename = async (from, to) => {
      await originalRename(from, to);
      if (!injected && to === snapshot) {
        injected = true;
        await copyFile(path.join(fixture, "catalog.db-wal"), `${main}-wal`);
      }
    };
    syncBuiltinESMExports();
    const engine = new SnapshotEngine(main, key, snapshot);
    try {
      await engine.open();
      assert.equal(favoriteCount(snapshot), 0);
      assert.equal(injected, true);
      assert.equal(await engine.refresh(), true);
      assert.equal(favoriteCount(snapshot), 1);
      assert.equal(await engine.refresh(), false);
    } finally {
      await engine.close();
      fs.promises.rename = originalRename;
      syncBuiltinESMExports();
    }
  });
});

test("an incremental page-one frame restores the rollback-journal header", async () => {
  await withFixture(async ({main, snapshot}) => {
    const fixtureWal = await readFile(path.join(fixture, "catalog.db-wal"));
    await writeFile(`${main}-wal`, fixtureWal);
    const engine = new SnapshotEngine(main, key, snapshot);
    try {
      await engine.open();
      const parsed = committedWalFrames(fixtureWal);
      const plainPageOne = Buffer.from((await readFile(snapshot)).subarray(0, PAGE_SIZE));
      plainPageOne[18] = 2;
      plainPageOne[19] = 2;
      const mainSalt = (await readFile(main)).subarray(0, 16);
      const pageOne = encryptPage(plainPageOne, key, mainSalt, 1);
      const salt1 = fixtureWal.readUInt32BE(16);
      const salt2 = fixtureWal.readUInt32BE(20);
      await writeFile(`${main}-wal`, buildWal([
        ...parsed.frames,
        {pageNumber: 1, page: pageOne, commitSize: 4},
      ], salt1, salt2));
      assert.equal(await engine.refresh(), true);
      const header = await readFile(snapshot);
      assert.equal(header[18], 1);
      assert.equal(header[19], 1);
      assert.equal(favoriteCount(snapshot), 1);
    } finally {
      await engine.close();
    }
  });
});

test("a stable malformed nonempty WAL is rejected", async () => {
  await withFixture(async ({main, snapshot}) => {
    await writeFile(`${main}-wal`, Buffer.alloc(64, 0x5a));
    const engine = new SnapshotEngine(main, key, snapshot);
    try {
      await assert.rejects(engine.open(), /write-ahead log is malformed/);
    } finally {
      await engine.close();
    }
  });
});

test("a checksum-valid WAL cannot advertise a database above the size limit", () => {
  const page = Buffer.alloc(PAGE_SIZE);
  const wal = buildWal([
    {pageNumber: 1, page, commitSize: (512 * 1024 * 1024 / PAGE_SIZE) + 1},
  ], 0x12345678, 0x87654321);
  assert.equal(committedWalFrames(wal), null);
});

test("initial WAL replay publishes the latest shrinking commit size", async () => {
  await withFixture(async ({main, snapshot}) => {
    const fixtureWal = await readFile(path.join(fixture, "catalog.db-wal"));
    const parsed = committedWalFrames(fixtureWal);
    await writeFile(`${main}-wal`, buildWal([
      {...parsed.frames[0], commitSize: 3},
    ], fixtureWal.readUInt32BE(16), fixtureWal.readUInt32BE(20)));
    const engine = new SnapshotEngine(main, key, snapshot);
    try {
      await engine.open();
      const header = await readFile(snapshot);
      assert.equal(header.readUInt32BE(28), 3);
      assert.equal(header.readUInt32BE(92), header.readUInt32BE(24));
    } finally {
      await engine.close();
    }
  });
});
