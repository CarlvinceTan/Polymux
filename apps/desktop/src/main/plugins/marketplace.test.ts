import assert from "node:assert/strict";
import test from "node:test";
import { marketplaceId, parseCatalog, parseMarketplaceSource } from "./marketplace.js";

const reference = { owner: "anthropics", repo: "claude-code" };

test("accepts the shapes a marketplace is pasted as", () => {
  assert.deepEqual(parseMarketplaceSource("anthropics/claude-code"), reference);
  assert.deepEqual(parseMarketplaceSource("  anthropics/claude-code/  "), reference);
  assert.deepEqual(
    parseMarketplaceSource("https://github.com/anthropics/claude-code"),
    reference,
  );
  assert.deepEqual(parseMarketplaceSource("https://github.com/anthropics/claude-code.git"), reference);
  assert.throws(() => parseMarketplaceSource(""), /Enter a marketplace/);
  assert.throws(() => parseMarketplaceSource("claude-code"), /owner\/repo/);
  assert.throws(() => parseMarketplaceSource("an owner/repo"), /owner\/repo/);
});

test("files a marketplace under its repository name", () => {
  assert.equal(marketplaceId({ owner: "Anthropics", repo: "Claude-Code" }), "claude-code");
});

test("reads a catalog, defaulting the source to plugins/<name>", () => {
  const catalog = parseCatalog(
    JSON.stringify({
      name: "Anthropic Plugins",
      plugins: [
        { name: "with-path", description: " a plugin ", source: "./bundles/one", version: "1.2.0" },
        { name: "defaulted", author: { name: "Ada" } },
        { name: "elsewhere", source: { source: "github", repo: "someone/other", path: "pack" } },
      ],
    }),
    reference,
  );
  assert.equal(catalog.name, "Anthropic Plugins");
  assert.deepEqual(catalog.plugins[0], {
    name: "with-path",
    description: "a plugin",
    version: "1.2.0",
    author: undefined,
    homepage: undefined,
    source: { kind: "path", path: "bundles/one" },
  });
  assert.deepEqual(catalog.plugins[1]?.source, { kind: "path", path: "plugins/defaulted" });
  assert.equal(catalog.plugins[1]?.author, "Ada");
  assert.deepEqual(catalog.plugins[2]?.source, {
    kind: "github",
    owner: "someone",
    repo: "other",
    path: "pack",
  });
});

test("names the repository when the catalog does not name itself", () => {
  assert.equal(parseCatalog(JSON.stringify({ plugins: [] }), reference).name, "claude-code");
});

test("drops entries that would install nothing or install twice", () => {
  const catalog = parseCatalog(
    JSON.stringify({
      plugins: [
        { name: "one", source: "./a" },
        { name: "one", source: "./b" },
        { name: "escaping", source: "../../etc" },
        { name: "unresolvable", source: { source: "svn", url: "svn://example" } },
        { description: "nameless" },
      ],
    }),
    reference,
  );
  assert.deepEqual(catalog.plugins.map((plugin) => plugin.name), ["one", "escaping"]);
  // Kept but neutered: the empty path is what install refuses on.
  assert.deepEqual(catalog.plugins[1]?.source, { kind: "path", path: "" });
  assert.deepEqual(catalog.plugins[0]?.source, { kind: "path", path: "a" });
});

test("refuses a marketplace file it cannot read", () => {
  assert.throws(() => parseCatalog("not json", reference), /unreadable marketplace\.json/);
  assert.throws(() => parseCatalog("[]", reference), /unreadable marketplace\.json/);
});
