import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACCOUNT_SESSION_KEY,
  FetchVaultCloud,
  VAULT_CLOUD_BUCKET,
  VAULT_CLOUD_TABLE,
  PolymuxAccountClient,
  vaultChecksum,
  vaultObjectName,
  type AccountStorage,
} from "../src/index.js";

function memoryStorage(): AccountStorage {
  const values = new Map<string, string>();
  values.set(
    ACCOUNT_SESSION_KEY,
    JSON.stringify({
      access_token: "access-1",
      refresh_token: "refresh-1",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "user-1", email: "you@example.com" },
    }),
  );
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

test("cloud pull downloads ciphertext and never includes a master password", async () => {
  const calls: Array<{ url: string; body: string }> = [];
  const bytes = new Uint8Array([1, 2, 3, 9]);
  const checksum = vaultChecksum(bytes);
  const objectName = vaultObjectName(4, checksum);
  const account = new PolymuxAccountClient({
    url: "https://example.supabase.co",
    anonKey: "anon-key",
    storage: memoryStorage(),
    fetch: async (url, init) => {
      const href = String(url);
      const body =
        typeof init?.body === "string"
          ? init.body
          : init?.body instanceof Uint8Array
            ? "bytes"
            : "";
      calls.push({ url: href, body });
      if (href.includes(`/rest/v1/${VAULT_CLOUD_TABLE}`)) {
        return new Response(
          JSON.stringify([
            {
              revision: 4,
              updated_at: "2026-09-07T00:00:00.000Z",
              checksum,
              object_name: objectName,
              byte_size: bytes.byteLength,
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (
        href.includes(
          `/storage/v1/object/${VAULT_CLOUD_BUCKET}/user-1/${objectName}`,
        )
      ) {
        return new Response(bytes, { status: 200 });
      }
      return new Response("missing", { status: 404 });
    },
  });
  await account.restore();
  const cloud = new FetchVaultCloud(account);
  const blob = await cloud.pull();
  assert.ok(blob);
  assert.equal(blob.revision, 4);
  assert.deepEqual([...blob.bytes], [1, 2, 3, 9]);
  assert.equal(
    calls.some(
      (call) =>
        /password|master/i.test(call.url) || /password|master/i.test(call.body),
    ),
    false,
  );
});

test("cloud push uploads the encrypted blob and upserts vault metadata", async () => {
  const methods: string[] = [];
  const bytes = new Uint8Array([9, 8, 7]);
  const checksum = vaultChecksum(bytes);
  const objectName = vaultObjectName(2, checksum);
  const account = new PolymuxAccountClient({
    url: "https://example.supabase.co",
    anonKey: "anon-key",
    storage: memoryStorage(),
    fetch: async (url, init) => {
      methods.push(`${init?.method ?? "GET"} ${String(url)}`);
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  await account.restore();
  const cloud = new FetchVaultCloud(account);
  await cloud.push({
    bytes,
    revision: 2,
    updatedAt: "2026-09-07T00:00:00.000Z",
    checksum,
  });
  assert.equal(
    methods.some(
      (line) =>
        line.startsWith("POST") &&
        line.includes(
          `/storage/v1/object/${VAULT_CLOUD_BUCKET}/user-1/${objectName}`,
        ),
    ),
    true,
  );
  assert.equal(
    methods.some(
      (line) =>
        line.startsWith("POST") &&
        line.includes(`/rest/v1/${VAULT_CLOUD_TABLE}`),
    ),
    true,
  );
});

test("cloud push never commits metadata when the immutable upload fails", async () => {
  let metadataWrites = 0;
  const bytes = new Uint8Array([4, 5, 6]);
  const checksum = vaultChecksum(bytes);
  const account = new PolymuxAccountClient({
    url: "https://example.supabase.co",
    anonKey: "anon-key",
    storage: memoryStorage(),
    fetch: async (url) => {
      if (String(url).includes("/storage/v1/object/"))
        return new Response("unavailable", { status: 503 });
      if (String(url).includes(`/rest/v1/${VAULT_CLOUD_TABLE}`))
        metadataWrites += 1;
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  await account.restore();
  const cloud = new FetchVaultCloud(account);
  await assert.rejects(
    cloud.push({
      bytes,
      revision: 3,
      updatedAt: "2026-09-07T00:00:00.000Z",
      checksum,
    }),
    /uploaded/,
  );
  assert.equal(metadataWrites, 0);
});

test("cloud push validates and reuses an orphaned immutable upload on retry", async () => {
  let metadataWrites = 0;
  const bytes = new Uint8Array([7, 7, 7]);
  const checksum = vaultChecksum(bytes);
  const account = new PolymuxAccountClient({
    url: "https://example.supabase.co",
    anonKey: "anon-key",
    storage: memoryStorage(),
    fetch: async (url, init) => {
      const href = String(url);
      if (href.includes("/storage/v1/object/") && init?.method === "POST")
        return new Response(
          JSON.stringify({ message: "The resource already exists" }),
          { status: 409, headers: { "content-type": "application/json" } },
        );
      if (href.includes("/storage/v1/object/") && init?.method === "GET")
        return new Response(bytes, { status: 200 });
      if (href.includes(`/rest/v1/${VAULT_CLOUD_TABLE}`)) metadataWrites += 1;
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  await account.restore();
  const cloud = new FetchVaultCloud(account);
  await cloud.push({
    bytes,
    revision: 3,
    updatedAt: "2026-09-07T00:00:00.000Z",
    checksum,
  });
  assert.equal(metadataWrites, 1);
});

test("cloud pull rejects ciphertext that does not match the committed metadata", async () => {
  const expected = new Uint8Array([1, 2, 3]);
  const checksum = vaultChecksum(expected);
  const objectName = vaultObjectName(5, checksum);
  const account = new PolymuxAccountClient({
    url: "https://example.supabase.co",
    anonKey: "anon-key",
    storage: memoryStorage(),
    fetch: async (url) => {
      if (String(url).includes(`/rest/v1/${VAULT_CLOUD_TABLE}`))
        return new Response(
          JSON.stringify([
            {
              revision: 5,
              updated_at: "2026-09-07T00:00:00.000Z",
              checksum,
              object_name: objectName,
              byte_size: expected.byteLength,
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      return new Response(new Uint8Array([9, 9, 9]), { status: 200 });
    },
  });
  await account.restore();
  await assert.rejects(
    new FetchVaultCloud(account).pull(),
    /does not match its metadata/,
  );
});

test("cloud pull returns null when the account has no vault row", async () => {
  const account = new PolymuxAccountClient({
    url: "https://example.supabase.co",
    anonKey: "anon-key",
    storage: memoryStorage(),
    fetch: async (url) => {
      if (String(url).includes(`/rest/v1/${VAULT_CLOUD_TABLE}`)) {
        return new Response("[]", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("nope", { status: 500 });
    },
  });
  await account.restore();
  const cloud = new FetchVaultCloud(account);
  assert.equal(await cloud.pull(), null);
});
