import assert from "node:assert/strict";
import test from "node:test";
import {searchSuggestions} from "./suggestions.js";

test("search suggestions are bounded, trimmed and deduplicated", async () => {
  let requested = "";
  const suggestions = await searchSuggestions("  notion  ", async (input) => {
    requested = String(input);
    return {
      ok: true,
      async json() {
        return ["notion", [
          "notion",
          " notion login ",
          "NOTION LOGIN",
          "notion templates",
          "notion app",
          "notion ai",
          "notion calendar",
          "notion download",
        ]];
      },
    };
  });

  assert.equal(new URL(requested).searchParams.get("q"), "notion");
  assert.deepEqual(suggestions, [
    "notion",
    "notion login",
    "notion templates",
    "notion app",
    "notion ai",
    "notion calendar",
  ]);
});

test("addresses stay local and provider failures become no suggestions", async () => {
  let requests = 0;
  const send = async (): Promise<Pick<Response, "ok" | "json">> => {
    requests += 1;
    throw new Error("offline");
  };

  assert.deepEqual(await searchSuggestions("https://notion.so", send), []);
  assert.deepEqual(await searchSuggestions("notion.so/path", send), []);
  assert.equal(requests, 0);
  assert.deepEqual(await searchSuggestions("notion workspace", send), []);
  assert.equal(requests, 1);
});

test("malformed provider payloads are ignored", async () => {
  assert.deepEqual(
    await searchSuggestions("notion", async () => ({ok: true, async json() { return {nope: true}; }})),
    [],
  );
  assert.deepEqual(
    await searchSuggestions("notion", async () => ({ok: false, async json() { return []; }})),
    [],
  );
});
