/**
 * Runs `electron-forge start` with macOS system noise filtered out of stderr.
 *
 * macOS 26's Objective-C runtime logs a parse complaint for every property
 * whose attribute string carries the newer `?` (direct) flag, e.g.
 *
 *   ERROR: Unrecognized attribute string flag '?' in attribute string
 *   "T@"NSString",?,R,C" for property debugDescription
 *
 * The properties belong to system frameworks Electron loads, not to any Midas
 * code, and the message is written straight to the process's stderr rather
 * than os_log, so there is nothing to silence from inside the app. Dropping
 * the lines here keeps the dev console readable; everything else is forwarded
 * untouched, and stdout stays attached to the terminal so Forge's spinners and
 * colours still work.
 *
 * Pass through any extra arguments: `node scripts/dev-start.mjs --inspect`.
 */
import {execFileSync, spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

/** Lines matching any of these are system noise, not application output. */
const NOISE = [
  /^ERROR: Unrecognized attribute string flag '.' in attribute string ".*" for property /,
];

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const forge = path.join(projectRoot, 'node_modules/.bin/electron-forge');

/**
 * Every `ps` line, as `{pid, ppid, command}`. Anything unreadable is treated as
 * "no processes": the preflight below is a convenience, never a gate.
 */
function processTable() {
  try {
    return execFileSync('ps', ['-axo', 'pid=,ppid=,command='], {encoding: 'utf8'})
      .split('\n')
      .flatMap((line) => {
        const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
        return match ? [{pid: Number(match[1]), ppid: Number(match[2]), command: match[3]}] : [];
      });
  } catch {
    return [];
  }
}

/**
 * A dev app left over from an earlier `npm start` owns the single-instance lock
 * on the userData directory, so the instance this run is about to launch quits
 * itself before it ever opens a window (see the lock in src/main/main.ts).
 * Forge does not notice — it keeps its dev servers up and its terminal quiet —
 * and the only Midas on screen stays the old one, still on its old bundle.
 * That reads exactly like `npm start` hanging on a blank window, so retire the
 * old session first.
 *
 * Only this checkout's development app is a candidate: it runs out of
 * `node_modules/electron`, which an installed Midas.app never does. Its main
 * process renames itself to "Midas" and so cannot be matched by path, but its
 * helper processes keep theirs — and their parent is the main process.
 */
async function retirePreviousDevApp() {
  const table = processTable();
  const distribution = path.join(projectRoot, 'node_modules/electron/dist/');
  const helpers = table.filter((entry) => entry.command.startsWith(distribution));
  const helperPids = new Set(helpers.map((entry) => entry.pid));
  const byPid = new Map(table.map((entry) => [entry.pid, entry]));

  // The Forge run that owns the old app goes with it: left alone it holds the
  // renderer's port, pushing this run's dev server onto another one while the
  // old window still points at the original.
  const forges = table
    .filter(
      (entry) =>
        entry.pid !== process.pid &&
        entry.command.includes('electron-forge') &&
        entry.command.includes(projectRoot),
    )
    .map((entry) => entry.pid);
  const forgePids = new Set(forges);

  // A dev app whose renderer and GPU helpers have already died is exactly the
  // zombie this exists to clear, and it has no helpers left to be found by. Its
  // Forge parent is still there, though, so take the app from both directions:
  // the parent of a live helper, and the Electron child of a live Forge run.
  const apps = [
    ...new Set([
      ...helpers.map((entry) => entry.ppid),
      ...table.filter((entry) => forgePids.has(entry.ppid)).map((entry) => entry.pid),
    ]),
  ].filter(
    // An orphaned helper is reparented to launchd; its "parent" is not an app.
    (pid) =>
      pid > 1 &&
      pid !== process.pid &&
      !helperPids.has(pid) &&
      !forgePids.has(pid) &&
      byPid.has(pid),
  );
  const doomed = [...apps, ...forges];
  if (doomed.length === 0) return;

  console.error('Retiring the Midas dev app left over from an earlier `npm start`.');
  const alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const signal = (name) => {
    for (const pid of doomed) {
      try {
        process.kill(pid, name);
      } catch {
        // Already gone between listing and signalling: nothing to retire.
      }
    }
  };

  // Waiting is the point. `app.quit()` is not instant — Electron runs its
  // teardown first — and the single-instance lock outlives the old main
  // process by exactly that long. Spawn Forge before then and the new instance
  // finds the lock still held, hands over its session, and exits: the only
  // Midas on screen stays the old one, whose renderer is usually already dead.
  // That is the blank window this whole function is trying to prevent.
  signal('SIGTERM');
  const deadline = Date.now() + 5000;
  while (doomed.some(alive) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 100));

  // A main process wedged in teardown would otherwise hold the lock forever.
  // Its data is already flushed or already lost; the new run matters more.
  if (doomed.some(alive)) {
    console.error('The old dev app did not exit on SIGTERM; forcing it.');
    signal('SIGKILL');
    while (doomed.some(alive) && Date.now() < deadline + 2000)
      await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

await retirePreviousDevApp();

const child = spawn(forge, ['start', ...process.argv.slice(2)], {
  cwd: projectRoot,
  stdio: ['inherit', 'inherit', 'pipe'],
});

let pending = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => {
  const lines = (pending + chunk).split('\n');
  // The last element is whatever follows the final newline: hold it back so a
  // noise line split across two chunks is still matched as one line.
  pending = lines.pop() ?? '';
  const kept = lines.filter((line) => !NOISE.some((pattern) => pattern.test(line)));
  if (kept.length > 0) process.stderr.write(`${kept.join('\n')}\n`);
});
child.stderr.on('end', () => {
  if (pending && !NOISE.some((pattern) => pattern.test(pending)))
    process.stderr.write(pending);
});

for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => child.kill(signal));

child.on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0));
});
