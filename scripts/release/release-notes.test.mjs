import assert from "node:assert/strict";
import test from "node:test";
import {releaseNotes} from "./release-notes.mjs";

const body = "## Features\n\n### Desktop\n\n- Connect your devices.\n";
const source = `---\nversion: 0.3.0\npublished: true\n---\n\n${body}`;
test("release publication uses the curated notes without front matter", () => {
  assert.equal(releaseNotes(source, "0.3.0"), body);
});
test("publication refuses draft, mismatched or ungrouped notes", () => {
  assert.throws(() => releaseNotes(source.replace("published: true", "published: false"), "0.3.0"), /draft/);
  assert.throws(() => releaseNotes(source, "0.3.1"), /version/);
  assert.throws(() => releaseNotes(source.replace("### Desktop", "Desktop"), "0.3.0"), /grouped/);
  assert.throws(() => releaseNotes(source.replace("## Features", "## Changes"), "0.3.0"), /category/);
});
