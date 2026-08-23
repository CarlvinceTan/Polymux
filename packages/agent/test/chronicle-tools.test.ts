import assert from "node:assert/strict";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {ComputerHistoryStore} from "@polymux/computer-history";
import {createComputerHistoryTools} from "../src/memory/computer-history-tools.js";

test("previous-screen work resolves one app switch and its nearest frame", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "polymux-previous-work-"));
  try {
    const store = new ComputerHistoryStore(directory);
    store.save({
      sourceId: "zed",
      sourceName: "runtime.ts — Zed",
      displayId: null,
      width: 1200,
      height: 800,
      image: Buffer.from("Working on retained-worker continuation in runtime.ts"),
      signature: new Uint8Array([1]),
      kind: "text",
      app: "Zed",
      bundleId: "dev.zed.Zed",
    }, new Date("2026-08-21T05:46:30Z"), 0.5, "change");
    store.saveEvents([
      {at: "2026-08-21T05:46:28Z", kind: "app", app: "Zed", title: "runtime.ts — Zed"},
      {at: "2026-08-21T05:46:42Z", kind: "shortcut", app: "Zed", title: "runtime.ts — Zed", chord: "cmd+s"},
      {at: "2026-08-21T05:48:20Z", kind: "app", app: "ChatGPT", title: "ChatGPT"},
    ]);
    const tool = createComputerHistoryTools({enabled: true, store} as never)
      .find((candidate) => candidate.name === "read_previous_screen_work")!;
    const answer = await tool.execute({}, {runId: "run", subagent: true} as never);
    const parsed = JSON.parse(answer.content as string);
    assert.equal(parsed.current.app, "ChatGPT");
    assert.equal(parsed.previous.app, "Zed");
    assert.equal(parsed.previous.title, "runtime.ts — Zed");
    assert.match(parsed.previous.frame.text, /retained-worker continuation/);
    assert.deepEqual(parsed.events.map((event: {did: string}) => event.did), [
      "switched to Zed — runtime.ts — Zed",
      "pressed cmd+s in Zed — runtime.ts — Zed",
      "switched to ChatGPT — ChatGPT",
    ]);
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});
