import assert from "node:assert/strict";
import { mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { FileReloadWatcher } from "../file-reload-watcher.js";

/**
 * The debounce is driven by hand rather than by the clock.
 *
 * How long the filesystem takes to deliver an event is the operating system's
 * business: macOS spreads a burst of writes across ~50ms and will deliver the
 * event for a write that happened *before* the watcher started. A test that
 * races that with a real 20ms timer fails whenever the machine is loaded, which
 * says nothing about the watcher. Holding the timer instead tests the contract
 * that actually matters — however many events arrive, only one reload is ever
 * owed — and it holds no matter how the events are spread.
 */
function manualWatcher(target: string, onChange: () => void) {
  // Every timer handed out is kept until it is cancelled, rather than one slot
  // holding the latest. A watcher that forgot to cancel the previous timer
  // would leave several live at once and fire a reload for each, which is
  // exactly the regression the coalescing test has to be able to see.
  const live = new Map<number, () => void>();
  let sequence = 0;
  let scheduled = 0;
  const watcher = new FileReloadWatcher(target, onChange, {
    schedule: (callback) => {
      sequence += 1;
      scheduled += 1;
      live.set(sequence, callback);
      // Truthy: the watcher only cancels a timer it considers live, so a falsy
      // handle would quietly skip the cancel this test is here to exercise.
      return sequence as unknown as ReturnType<typeof setTimeout>;
    },
    cancelSchedule: (timer) => {
      live.delete(timer as unknown as number);
    },
  });
  return {
    watcher,
    /** Fires every timer still live, as the clock would have. */
    flush(): void {
      const callbacks = [...live.values()];
      live.clear();
      for (const callback of callbacks) callback();
    },
    isPending: () => live.size > 0,
    /** How many reloads are actually owed right now. */
    liveCount: () => live.size,
    scheduledCount: () => scheduled,
    resetCount: () => {
      scheduled = 0;
    },
  };
}

test("coalesces a burst of writes into a single reload", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "flareai-reload-"));
  const target = path.join(directory, "mcp.json");
  writeFileSync(target, "{}\n");

  let changes = 0;
  const harness = manualWatcher(target, () => changes++);
  harness.watcher.start();
  try {
    // Written repeatedly until the watcher has seen something, rather than
    // once with a deadline: under load macOS can take seconds to deliver an
    // event, and how long it takes is not what this test is about. More writes
    // only make the point harder, since every one of them must still collapse
    // into the same single reload.
    await writeUntil(() => harness.isPending(), () => {
      writeFileSync(target, '{"mcpServers":{}}\n');
      writeFileSync(path.join(directory, "unrelated.json"), "{}\n");
      writeFileSync(target, "{}\n");
    });
    // Long enough for the rest of the burst to land and reschedule the same
    // single timer, which is the coalescing being tested.
    await settle();

    // The burst produced several events, and every one after the first
    // cancelled its predecessor, so exactly one reload is owed.
    assert.ok(harness.scheduledCount() > 0);
    assert.equal(harness.liveCount(), 1);

    harness.flush();
    assert.equal(changes, 1);

    // And nothing further is owed once it has fired.
    assert.equal(harness.isPending(), false);
  } finally {
    harness.watcher.stop();
  }
});

test("observes an atomic replacement of the watched file", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "flareai-reload-"));
  const target = path.join(directory, "mcp.json");
  writeFileSync(target, "{}\n");

  let changes = 0;
  const harness = manualWatcher(target, () => changes++);
  harness.watcher.start();
  try {
    await settle();
    harness.flush();
    changes = 0;
    harness.resetCount();

    // Written aside and moved into place, the way an editor or an installer
    // replaces a config file. The watcher watches the directory rather than the
    // file precisely so the new inode is still seen.
    let replacements = 0;
    await writeUntil(() => harness.isPending(), () => {
      const replacement = path.join(directory, `mcp.json.${replacements++}.tmp`);
      writeFileSync(replacement, '{"mcpServers":{"a":{}}}\n');
      renameSync(replacement, target);
    });
    await settle();

    assert.equal(harness.liveCount(), 1);
    harness.flush();
    assert.equal(changes, 1);
  } finally {
    harness.watcher.stop();
  }
});

test("ignores changes to other files in the same directory", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "flareai-reload-"));
  const target = path.join(directory, "mcp.json");
  writeFileSync(target, "{}\n");

  let changes = 0;
  const harness = manualWatcher(target, () => changes++);
  harness.watcher.start();
  try {
    // The watched file's own setup write can still be in flight, so the queue
    // is drained before anything is counted.
    await settle();
    harness.flush();
    changes = 0;
    harness.resetCount();

    writeFileSync(path.join(directory, "unrelated.json"), "{}\n");
    writeFileSync(path.join(directory, "notes.txt"), "hello\n");
    await settle();

    assert.equal(harness.scheduledCount(), 0);
    assert.equal(changes, 0);
  } finally {
    harness.watcher.stop();
  }
});

/**
 * Repeats a write until the watcher reacts to it.
 *
 * Waiting on a single event with a deadline is what made the previous version
 * of this file flaky: macOS delivers filesystem events on its own schedule and
 * under load that can be seconds, so the test measured the machine rather than
 * the watcher. Writing again costs nothing and cannot mask a fault — the
 * assertions are about coalescing, which more writes only make stricter.
 */
async function writeUntil(
  predicate: () => boolean,
  write: () => void,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (!predicate()) {
    if (Date.now() >= deadline)
      throw new Error("The watcher never saw the file change");
    write();
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Long enough for macOS to finish delivering a burst, which it spreads over
 * roughly 50ms. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 250));
}
