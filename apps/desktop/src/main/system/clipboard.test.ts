import assert from "node:assert/strict";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {writeClipboardContent, type ClipboardDependencies} from "./clipboard.js";

type FakeImage = {empty: boolean; isEmpty(): boolean};

function harness(root: string): {calls: Array<{kind: string; value: unknown}>; dependencies: ClipboardDependencies<FakeImage>} {
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

test("copies a granted preview from disk without fetching it", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-clipboard-test-"));
  try {
    const local = path.join(root, "shot.png");
    await writeFile(local, "png-bytes");
    const {calls, dependencies} = harness(root);
    let fetched = false;
    dependencies.fetch = async () => {
      fetched = true;
      return new Response("nope");
    };
    dependencies.resolveLocalFile = () => local;
    assert.equal(await writeClipboardContent({
      kind: "attachment",
      url: "polymux-preview://token/shot.png",
      name: "shot.png",
      mimeType: "image/png",
      copyAs: "file",
    }, dependencies), true);
    assert.equal(fetched, false);
    assert.equal(calls[0]?.kind, "public.file-url");
    assert.match(String(calls[0]?.value), /shot\.png$/);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("copies preview pixels from the file on disk", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-clipboard-test-"));
  try {
    const local = path.join(root, "shot.png");
    await writeFile(local, "png-bytes");
    const {calls, dependencies} = harness(root);
    let fromPath = "";
    dependencies.imageFromPath = (filePath: string): FakeImage => {
      fromPath = filePath;
      return {empty: false, isEmpty() { return this.empty; }};
    };
    dependencies.resolveLocalFile = () => local;
    assert.equal(await writeClipboardContent({
      kind: "attachment",
      url: "polymux-preview://token/shot.png",
      name: "shot.png",
      mimeType: "image/png",
      copyAs: "image",
    }, dependencies), true);
    assert.equal(fromPath, local);
    assert.equal(calls[0]?.kind, "image");
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("falls back to a file reference when nativeImage cannot decode a still", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-clipboard-test-"));
  try {
    const local = path.join(root, "mark.svg");
    await writeFile(local, "<svg/>");
    const {calls, dependencies} = harness(root);
    dependencies.imageFromPath = (): FakeImage => ({
      empty: true,
      isEmpty() { return this.empty; },
    });
    dependencies.resolveLocalFile = () => local;
    assert.equal(await writeClipboardContent({
      kind: "attachment",
      url: "polymux-preview://token/mark.svg",
      name: "mark.svg",
      mimeType: "image/svg+xml",
      copyAs: "image",
    }, dependencies), true);
    assert.equal(calls[0]?.kind, "public.file-url");
    assert.match(String(calls[0]?.value), /mark\.svg$/);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("refuses a file url on the attachment path", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-clipboard-test-"));
  try {
    const {dependencies} = harness(root);
    assert.equal(await writeClipboardContent({
      kind: "attachment",
      url: "file:///tmp/secret.png",
      name: "secret.png",
      mimeType: "image/png",
      copyAs: "image",
    }, dependencies), false);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
