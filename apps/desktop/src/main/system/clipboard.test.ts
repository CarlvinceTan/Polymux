import assert from "node:assert/strict";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {writeClipboardContent} from "./clipboard.js";

type FakeImage = {empty: boolean; isEmpty(): boolean};

function harness(root: string) {
  const calls: Array<{kind: string; value: unknown}> = [];
  return {
    calls,
    dependencies: {
      clipboard: {
        write: (value: unknown) => calls.push({kind: "text", value}),
        writeBuffer: (format: string, value: Buffer) =>
          calls.push({kind: format, value: value.toString()}),
        writeImage: (value: FakeImage) => calls.push({kind: "image", value}),
      },
      fetch: async () => new Response("remote bytes"),
      imageFromBuffer: (_value: Buffer): FakeImage => ({
        empty: false,
        isEmpty() { return this.empty; },
      }),
      platform: "darwin" as const,
      temporaryRoot: root,
    },
  };
}

test("writes text and links with a native bookmark fallback", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-clipboard-test-"));
  try {
    const {calls, dependencies} = harness(root);
    assert.equal(await writeClipboardContent({kind: "text", text: "https://example.test", title: "Example"}, dependencies), true);
    assert.deepEqual(calls, [{kind: "text", value: {text: "https://example.test", bookmark: "Example"}}]);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("writes local and fetched attachments as pasteable macOS files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-clipboard-test-"));
  try {
    const local = path.join(root, "local notes.txt");
    await writeFile(local, "local bytes");
    const {calls, dependencies} = harness(root);
    assert.equal(await writeClipboardContent({kind: "file", path: local}, dependencies), true);
    assert.equal(calls[0]?.kind, "public.file-url");
    assert.match(String(calls[0]?.value), /local%20notes\.txt$/);

    calls.length = 0;
    assert.equal(await writeClipboardContent({kind: "attachment", url: "https://example.test/file", name: "folder/remote.txt", mimeType: "text/plain", copyAs: "file"}, dependencies), true);
    assert.equal(calls[0]?.kind, "public.file-url");
    const copiedUrl = new URL(String(calls[0]?.value));
    assert.equal(await readFile(copiedUrl, "utf8"), "remote bytes");
    assert.equal(path.basename(copiedUrl.pathname), "remote.txt");
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("decodes an image into native clipboard pixels", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-clipboard-test-"));
  try {
    const {calls, dependencies} = harness(root);
    assert.equal(await writeClipboardContent({kind: "attachment", url: "https://example.test/photo", name: "photo.png", mimeType: "image/png", copyAs: "image"}, dependencies), true);
    assert.equal(calls[0]?.kind, "image");
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
