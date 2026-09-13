import assert from "node:assert/strict";
import test from "node:test";
import {
  runContainerCommand,
  teamBashExecArgs,
  teamContainerCreateArgs,
  teamWorkspaceTarget,
} from "./computers.js";

test("Team computers fail closed with a private persistent workspace", () => {
  const args = teamContainerCreateArgs("Maya / ../../laptop");
  const command = args.join(" ");
  assert.match(command, /--network none/);
  assert.match(command, /--cap-drop ALL/);
  assert.match(command, /--security-opt no-new-privileges/);
  assert.match(command, /--read-only/);
  assert.match(command, /--pids-limit 512/);
  assert.match(command, /--memory 2g/);
  assert.match(command, /type=volume,src=polymux-team-mayalaptop-workspace,dst=\/workspace/);
  assert.doesNotMatch(command, /type=bind|docker\.sock|\/Users\//);
  assert.equal(args[args.indexOf("--name") + 1], "polymux-team-mayalaptop");
});

test("Team shell timeouts terminate the workload inside the container", () => {
  assert.deepEqual(teamBashExecArgs("Maya", "sleep 600", 12), [
    "exec", "polymux-team-maya",
    "timeout", "-s", "TERM", "-k", "5", "12s",
    "sh", "-lc", "sleep 600",
  ]);
});

test("Team workspace transfers cannot address laptop or container paths", () => {
  assert.equal(teamWorkspaceTarget("reports/final.pdf"), "/workspace/reports/final.pdf");
  assert.throws(() => teamWorkspaceTarget("../../etc/passwd"), /relative to \/workspace/);
  assert.throws(() => teamWorkspaceTarget("/etc/passwd"), /relative to \/workspace/);
});

test("Container commands terminate on timeout and cancellation", async () => {
  const hanging = ["-e", "setInterval(() => {}, 1_000)"];
  await assert.rejects(
    runContainerCommand(process.execPath, hanging, {timeout: 50}),
    /timed out after 50ms/,
  );

  const controller = new AbortController();
  const cancelled = runContainerCommand(process.execPath, hanging, {signal: controller.signal});
  setTimeout(() => controller.abort(new Error("cancelled by test")), 50);
  await assert.rejects(cancelled, /cancelled by test/);
});
