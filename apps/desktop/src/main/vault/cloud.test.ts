import assert from "node:assert/strict";
import {test} from "node:test";
import {vaultChecksum, type VaultCloudBlob} from "@polymux/vault";
import type {AccountService} from "../account/account-service.js";
import {SupabaseVaultCloud} from "./cloud.js";

function fixture() {
  const objects = new Map<string, Uint8Array>();
  let row: Record<string, unknown> | null = null;
  let failCommit = false;
  const table = {
    select() { return this; },
    eq() { return this; },
    async maybeSingle(): Promise<{data: Record<string, unknown> | null; error: null}> { return {data: row, error: null}; },
    async upsert(next: Record<string, unknown>): Promise<{error: {message: string} | null}> {
      if (failCommit) return {error: {message: "metadata unavailable"}};
      row = {...next};
      return {error: null};
    },
  };
  const bucket = {
    async upload(name: string, bytes: Uint8Array, options: {upsert: boolean}): Promise<{error: {message: string} | null}> {
      assert.equal(options.upsert, false);
      if (objects.has(name)) return {error: {message: "The resource already exists"}};
      objects.set(name, bytes.slice());
      return {error: null};
    },
    async download(name: string): Promise<{data: Blob | null; error: {message: string} | null}> {
      const bytes = objects.get(name);
      return bytes ? {data: new Blob([new Uint8Array(bytes)]), error: null} : {data: null, error: {message: "not found"}};
    },
  };
  const account = {
    status: () => ({available: true, signedIn: true, profile: {userId: "account-1"}}),
    client: {from: () => table, storage: {from: () => bucket}},
  } as unknown as AccountService;
  return {cloud: new SupabaseVaultCloud(account), objects, failCommit(value: boolean) { failCommit = value; }};
}

function blob(revision: number, value: number): VaultCloudBlob {
  const bytes = new Uint8Array([value, 2, 3]);
  return {bytes, revision, checksum: vaultChecksum(bytes), updatedAt: "2026-09-09T00:00:00.000Z"};
}

test("SDK cloud preserves its committed vault after metadata failure and safely retries", async () => {
  const {cloud, objects, failCommit} = fixture();
  const original = blob(1, 10), next = blob(2, 20);
  await cloud.push(original);
  failCommit(true);
  await assert.rejects(cloud.push(next), /metadata unavailable/);
  assert.deepEqual(await cloud.pull(), original);
  assert.equal(objects.size, 2);
  failCommit(false);
  await cloud.push(next);
  assert.equal(objects.size, 2);
  assert.deepEqual(await cloud.pull(), next);
});

test("SDK cloud rejects corrupted committed and orphaned objects", async () => {
  const {cloud, objects, failCommit} = fixture();
  const value = blob(1, 10);
  await cloud.push(value);
  const name = [...objects.keys()][0];
  objects.set(name, new Uint8Array([90, 91, 92]));
  await assert.rejects(cloud.pull(), /does not match its metadata/);
  await assert.rejects(cloud.push(value), /does not match the upload/);
  failCommit(true);
  const next = blob(2, 20);
  await assert.rejects(cloud.push(next), /metadata unavailable/);
  objects.set([...objects.keys()][1], new Uint8Array([1]));
  failCommit(false);
  await assert.rejects(cloud.push(next), /does not match the upload/);
});
