import {execFile, spawn} from "node:child_process";
import {promisify} from "node:util";

const run = promisify(execFile);

export interface WeChatRelayNativeTarget {
  pid: number;
  /** Exact birth/executable identity from ps lstart=,comm=. */
  identity: string;
}

export type WeChatRelayRelease = (() => Promise<void>) & {
  nativeTarget?: WeChatRelayNativeTarget;
};

export interface WeChatRelayPauseOptions {
  /** Required for native operations; their driver must use this exact target. */
  nativeTargetPid?: number;
  /** Bounded fixture override; ordinary leases use six minutes. */
  deadlineMs?: number;
}

// The watcher survives parent EOF. For a native lease, EOF/expiry cannot prove
// that an orphan writer will not attach a moment later. Keep the relay paused
// until the caller explicitly finishes, or the pinned native target is gone.
// No signal is ever sent to the target. Ordinary non-native leases retain the
// existing crash/deadline resume policy.
const WATCHER = String.raw`
const {execFileSync} = require("node:child_process");
const [pidText, identity, targetText, targetIdentity, deadlineText] = process.argv.slice(1);
const pid = Number(pidText);
const targetPid = Number(targetText);
let paused = false;
let finished = false;
let input = "";
const identify = (value) => execFileSync("/bin/ps", ["-p", String(value), "-o", "lstart=,comm="], {encoding:"utf8", timeout:1500, stdio:["ignore","pipe","ignore"]}).trim();
function exists(value) {
  try { process.kill(value, 0); return true; }
  catch (error) { return error.code === "ESRCH" ? false : null; }
}
function targetState() {
  if (!targetPid) return "unguarded";
  if (exists(targetPid) === false) return "gone";
  try {
    if (identify(targetPid) !== targetIdentity) return "replaced";
    const state = execFileSync("/bin/ps", ["-p", targetText, "-o", "stat="], {encoding:"utf8", timeout:1500, stdio:["ignore","pipe","ignore"]}).trim();
    if (identify(targetPid) !== targetIdentity) return "replaced";
    if (!state) return "unknown";
    // macOS X denotes traced/debugged; T is stopped. Linux t is traced-stop.
    return /[TXt]/.test(state) ? "busy" : "running";
  } catch { return exists(targetPid) === false ? "gone" : "unknown"; }
}
function output(value, callback) {
  try { process.stdout.write(value + "\n", callback); }
  catch { if (callback) callback(); }
}
function finish(explicit = false) {
  if (finished) return;
  try {
    if (exists(pid) === false || identify(pid) !== identity) {
      finished = true;
      process.exit(0);
    }
    const state = targetState();
    const safe = state === "unguarded" || state === "gone" || state === "replaced" ||
      (explicit && state === "running");
    if (!safe) {
      if (explicit) output("held:" + state);
      return;
    }
    if (paused) process.kill(pid, "SIGCONT");
    finished = true;
    output("released", () => process.exit(0));
  } catch {
    if (explicit) output("held:unknown");
  }
}
process.stdout.on("error", () => {});
process.on("SIGTERM", () => finish(false));
process.on("SIGINT", () => finish(false));
process.stdin.on("end", () => finish(false));
process.stdin.on("error", () => finish(false));
process.stdin.on("data", chunk => {
  input += chunk.toString("utf8");
  if (input.length > 1024) {input = ""; return;}
  let newline;
  while ((newline = input.indexOf("\n")) >= 0) {
    const command = input.slice(0, newline);
    input = input.slice(newline + 1);
    if (command === "release") finish(true);
  }
});
process.stdin.resume();
setTimeout(() => finish(false), Number(deadlineText));
if (targetPid) setInterval(() => finish(false), 500);
try {
  if (identify(pid) !== identity) throw new Error("relay identity changed");
  if (targetPid && identify(targetPid) !== targetIdentity) throw new Error("native target identity changed");
  process.kill(pid, "SIGSTOP");
  paused = true;
  output("paused");
} catch {
  if (!paused) process.exit(1);
  finish(false);
}
`;

/** Pause an existing supervised relay without triggering KeepAlive restart.
 * The caller verifies the listening port and executable. Native callers must
 * supply nativeTargetPid and pin every writer/debugger to the returned target.
 * Release only after all writer descendants have finished their detach work.
 * A refused release retains the guard and may be retried after cleanup. */
export async function pauseWeChatRelay(
  pid: number,
  options: WeChatRelayPauseOptions = {},
): Promise<WeChatRelayRelease> {
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid)
    throw new Error("WeChat relay process is invalid");
  const targetPid = options.nativeTargetPid;
  if (targetPid !== undefined && (!Number.isInteger(targetPid) || targetPid <= 1 || targetPid === pid || targetPid === process.pid))
    throw new Error("WeChat native target process is invalid");
  const deadlineMs = options.deadlineMs ?? 360_000;
  if (!Number.isInteger(deadlineMs) || deadlineMs < 10 || deadlineMs > 360_000)
    throw new Error("WeChat relay pause deadline is invalid");
  const identify = async (value: number): Promise<string> => {
    const {stdout} = await run("/bin/ps", ["-p", String(value), "-o", "lstart=,comm="], {timeout: 2_000});
    if (!stdout.trim()) throw new Error("WeChat process exited before its native operation");
    return stdout.trim();
  };
  const identity = await identify(pid);
  const nativeTarget = targetPid === undefined ? undefined : {pid: targetPid, identity: await identify(targetPid)};
  const watcher = spawn(process.execPath, ["-e", WATCHER, String(pid), identity,
    nativeTarget ? String(nativeTarget.pid) : "", nativeTarget?.identity ?? "", String(deadlineMs)], {
    env: {...process.env, ELECTRON_RUN_AS_NODE: "1"},
    stdio: ["pipe", "pipe", "ignore"], windowsHide: true,
    detached: true,
  });
  watcher.stdin.on("error", () => undefined);
  let exited = false;
  let released = false;
  let watcherOutput = "";
  watcher.stdout.on("data", (chunk: Buffer) => {
    watcherOutput += chunk.toString("utf8");
    if (watcherOutput.includes("released\n")) released = true;
    watcherOutput = watcherOutput.slice(-1024);
  });
  const closed = new Promise<void>((resolve) => watcher.once("close", () => {exited = true; resolve();}));
  let releasing: Promise<void> | null = null;
  const release = Object.assign(async (): Promise<void> => {
    if (exited) {
      if (!released) throw new Error("WeChat relay guard exited without confirming a safe release");
      return;
    }
    if (releasing) return await releasing;
    const task = new Promise<void>((resolve, reject) => {
      let output = "";
      const finish = (error?: Error): void => {
        clearTimeout(timer);
        watcher.stdout.off("data", onData);
        if (error) reject(error); else resolve();
      };
      const onData = (chunk: Buffer): void => {
        output += chunk.toString("utf8");
        if (output.includes("released\n")) finish();
        else if (output.includes("held:")) finish(new Error("WeChat relay remains paused because native target cleanup is unconfirmed"));
      };
      const timer = setTimeout(() => finish(new Error("WeChat relay release could not confirm native target cleanup")), 4_000);
      watcher.stdout.on("data", onData);
      void closed.then(() => finish(released ? undefined :
        new Error("WeChat relay guard exited without confirming a safe release")));
      watcher.stdin.write("release\n");
    });
    releasing = task;
    try {await task;} finally {if (releasing === task) releasing = null;}
  }, {...(nativeTarget ? {nativeTarget} : {})});
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("WeChat relay did not pause in time")), 4_000);
      let output = "";
      watcher.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
        if (output.includes("paused\n")) {clearTimeout(timer); resolve();}
      });
      watcher.once("error", (error) => {clearTimeout(timer); reject(error);});
      watcher.once("close", () => {clearTimeout(timer); reject(new Error("WeChat relay pause failed"));});
    });
    // The independent guard must not keep a closing host alive. Its own poll
    // remains referenced so an orphan guard notices a replaced/exited target.
    watcher.unref();
    (watcher.stdin as typeof watcher.stdin & {unref?: () => void}).unref?.();
    (watcher.stdout as typeof watcher.stdout & {unref?: () => void}).unref?.();
    return release;
  } catch (error) {
    // EOF preserves a native reservation; it never authorizes blind resume.
    watcher.stdin.end();
    watcher.stdout.destroy();
    watcher.unref();
    (watcher.stdin as typeof watcher.stdin & {unref?: () => void}).unref?.();
    (watcher.stdout as typeof watcher.stdout & {unref?: () => void}).unref?.();
    throw error;
  }
}
