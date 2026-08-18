import assert from "node:assert/strict";
import test from "node:test";
import { parseState } from "./registry.js";

test("an absent or unreadable state file reads as no plugins", () => {
  assert.deepEqual(parseState(""), { marketplaces: [], plugins: [] });
  assert.deepEqual(parseState("{"), { marketplaces: [], plugins: [] });
  assert.deepEqual(parseState("[]"), { marketplaces: [], plugins: [] });
});

test("drops plugins whose marketplace is gone", () => {
  const state = parseState(
    JSON.stringify({
      marketplaces: [{ id: "claude-code", source: "anthropics/claude-code", name: "Claude Code" }],
      plugins: [
        { id: "claude-code/notes", marketplace: "claude-code", name: "notes" },
        { id: "removed/orphan", marketplace: "removed", name: "orphan" },
      ],
    }),
  );
  assert.deepEqual(state.plugins.map((plugin) => plugin.id), ["claude-code/notes"]);
});

test("refuses a name that would resolve outside the plugins directory", () => {
  const state = parseState(
    JSON.stringify({
      marketplaces: [{ id: "m", source: "o/r", name: "m" }],
      plugins: [
        { id: "m/..", marketplace: "m", name: ".." },
        { id: "m/a/b", marketplace: "m", name: "a/b" },
        { id: "m/fine", marketplace: "m", name: "fine" },
      ],
    }),
  );
  assert.deepEqual(state.plugins.map((plugin) => plugin.name), ["fine"]);
});
