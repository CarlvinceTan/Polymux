import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DropboxDrive } from "../src/dropbox.js";
import { GoogleDrive } from "../src/google-drive.js";
import { OneDrive } from "../src/onedrive.js";
import type { DriveConsentPrompt, DriveSecretStore } from "../src/types.js";

const consent: DriveConsentPrompt = {
  open: async () => {
    throw new Error("sign-in is not used here");
  },
};

function secrets(provider: string): DriveSecretStore {
  const stored = new Map([
    [
      `drive:${provider}:default`,
      JSON.stringify({
        accessToken: "token",
        refreshToken: "refresh",
        expiresAt: null,
        scope: null,
      }),
    ],
  ]);
  return {
    read: async (id) => stored.get(id),
    write: async (id, value) => void stored.set(id, value),
    clear: async (id) => void stored.delete(id),
  };
}

async function localFile(): Promise<{
  file: string;
  cleanup(): Promise<void>;
}> {
  const directory = await mkdtemp(path.join(tmpdir(), "flareai-replace-"));
  const file = path.join(directory, "report.md");
  await writeFile(file, "updated");
  return {
    file,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

test("Google Drive updates the existing same-name file", async () => {
  const { file, cleanup } = await localFile();
  const beforeFetch = globalThis.fetch;
  const beforeId = process.env.FLAREAI_GOOGLE_DRIVE_CLIENT_ID;
  let upload: { url: string; method?: string } | null = null;
  process.env.FLAREAI_GOOGLE_DRIVE_CLIENT_ID = "client";
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url.includes("/drive/v3/files?q="))
      return new Response(
        JSON.stringify({ files: [{ id: "existing", name: "report.md" }] }),
      );
    upload = { url, method: init?.method };
    return new Response(JSON.stringify({ id: "existing", name: "report.md" }), {
      headers: { etag: '"v2"' },
    });
  }) as typeof globalThis.fetch;
  try {
    const entry = await new GoogleDrive(
      secrets("google-drive"),
      consent,
      "default",
    ).upload("folder", file);
    assert.match(upload!.url, /\/files\/existing\?uploadType=multipart/);
    assert.equal(upload!.method, "PATCH");
    assert.equal(entry.version, '"v2"');
  } finally {
    await cleanup();
    globalThis.fetch = beforeFetch;
    if (beforeId === undefined)
      delete process.env.FLAREAI_GOOGLE_DRIVE_CLIENT_ID;
    else process.env.FLAREAI_GOOGLE_DRIVE_CLIENT_ID = beforeId;
  }
});

test("Dropbox overwrites instead of autorenaming", async () => {
  const { file, cleanup } = await localFile();
  const beforeFetch = globalThis.fetch;
  const beforeId = process.env.FLAREAI_DROPBOX_CLIENT_ID;
  let commit: Record<string, unknown> = {};
  process.env.FLAREAI_DROPBOX_CLIENT_ID = "client";
  globalThis.fetch = (async (_input, init) => {
    commit = JSON.parse(
      (init?.headers as Record<string, string>)["dropbox-api-arg"],
    );
    return new Response(
      JSON.stringify({
        ".tag": "file",
        id: "id:report",
        name: "report.md",
        path_lower: "/report.md",
        rev: "v2",
      }),
    );
  }) as typeof globalThis.fetch;
  try {
    const entry = await new DropboxDrive(
      secrets("dropbox"),
      consent,
      "default",
    ).upload("", file);
    assert.equal(commit.mode, "overwrite");
    assert.equal(commit.autorename, false);
    assert.equal(entry.version, "v2");
  } finally {
    await cleanup();
    globalThis.fetch = beforeFetch;
    if (beforeId === undefined) delete process.env.FLAREAI_DROPBOX_CLIENT_ID;
    else process.env.FLAREAI_DROPBOX_CLIENT_ID = beforeId;
  }
});

test("OneDrive requests replacement instead of a renamed copy", async () => {
  const { file, cleanup } = await localFile();
  const beforeFetch = globalThis.fetch;
  const beforeId = process.env.FLAREAI_ONEDRIVE_CLIENT_ID;
  let seen = "";
  process.env.FLAREAI_ONEDRIVE_CLIENT_ID = "client";
  globalThis.fetch = (async (input) => {
    seen = String(input);
    return new Response(
      JSON.stringify({ id: "existing", name: "report.md", eTag: "v2" }),
    );
  }) as typeof globalThis.fetch;
  try {
    const entry = await new OneDrive(
      secrets("onedrive"),
      consent,
      "default",
    ).upload("folder", file);
    assert.match(seen, /conflictBehavior=replace/);
    assert.equal(entry.version, "v2");
  } finally {
    await cleanup();
    globalThis.fetch = beforeFetch;
    if (beforeId === undefined) delete process.env.FLAREAI_ONEDRIVE_CLIENT_ID;
    else process.env.FLAREAI_ONEDRIVE_CLIENT_ID = beforeId;
  }
});
