import assert from "node:assert/strict";
import {mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {create} from "tar";
import {extractTarGzip} from "./archive.js";

test("extracts gzip tarballs without a host tar command", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-archive-test-"));
  try {
    const source = path.join(directory, "source");
    const destination = path.join(directory, "destination");
    const archive = path.join(directory, "package.tar.gz");
    await mkdir(path.join(source, "package"), {recursive: true});
    await mkdir(destination, {recursive: true});
    await writeFile(path.join(source, "package", "README.md"), "bundled extractor\n");
    await create({cwd: source, file: archive, gzip: true}, ["package"]);

    await extractTarGzip(archive, destination);

    assert.equal(
      await readFile(path.join(destination, "package", "README.md"), "utf8"),
      "bundled extractor\n",
    );
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
