/**
 * Runs `electron-forge start` with macOS system noise filtered out of stderr.
 *
 * macOS 26's Objective-C runtime logs a parse complaint for every property
 * whose attribute string carries the newer `?` (direct) flag, e.g.
 *
 *   ERROR: Unrecognized attribute string flag '?' in attribute string
 *   "T@"NSString",?,R,C" for property debugDescription
 *
 * The properties belong to system frameworks Electron loads, not to any FlareAI
 * code, and the message is written straight to the process's stderr rather
 * than os_log, so there is nothing to silence from inside the app. Dropping
 * the lines here keeps the dev console readable; everything else is forwarded
 * untouched, and stdout stays attached to the terminal so Forge's spinners and
 * colours still work.
 *
 * Pass through any extra arguments: `node scripts/dev-start.mjs --inspect`.
 */
import {execFileSync, spawn} from 'node:child_process';
import {existsSync, rmSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {backgroundInstanceArguments} from './dev-start-arguments.mjs';

/** Lines matching any of these are system noise, not application output. */
const NOISE = [
  /^ERROR: Unrecognized attribute string flag '.' in attribute string ".*" for property /,
];

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const forge = path.join(projectRoot, 'node_modules/.bin/electron-forge');

/**
 * Loads `.env` from the repo root, if there is one.
 *
 * This is where the OAuth client ids for Drive, Dropbox and OneDrive live in
 * development, so they survive between runs instead of being retyped in front
 * of every `npm start`. The file is git-ignored and never packaged: a shipped
 * build has no `.env` to read, and configures those providers through its own
 * settings instead.
 *
 * Anything already in the environment wins — `FOO=bar npm start` is how you
 * override a stored value for one run, and it would be surprising if a file
 * quietly took precedence over what was typed on the command line.
 */
function loadEnvFile() {
  const file = path.join(projectRoot, '.env');
  if (!existsSync(file)) return;
  const before = {...process.env};
  try {
    process.loadEnvFile(file);
  } catch (cause) {
    // A malformed .env should not stop the app from starting; say so and
    // carry on with whatever the environment already holds.
    console.warn(`Ignoring .env: ${cause instanceof Error ? cause.message : cause}`);
    return;
  }
  Object.assign(process.env, before);
}

loadEnvFile();

/**
 * `npm start -- --isolated[=name]` runs a *side* instance: its own userData
 * directory, and so its own single-instance lock, and its own homeserver port
 * (see main.ts). Nothing it does reaches the FlareAI the user already has
 * open, which is the point — an agent can start the app to look at a change
 * without taking the user's session away from them.
 *
 * The flag is consumed here rather than forwarded: Forge would pass it to
 * Electron, which has no idea what it means. The app reads the name off
 * FLAREAI_DEV_INSTANCE instead, so `FLAREAI_DEV_INSTANCE=review npm start`
 * works the same way.
 */
const forwarded = [];
let instance = process.env.FLAREAI_DEV_INSTANCE?.trim() || '';
let ephemeral = false;
let visibleInstance = false;
for (const argument of process.argv.slice(2)) {
  const match = /^--isolated(?:=(.+))?$/.exec(argument);
  if (match) instance = match[1]?.trim() || instance || 'side';
  else if (argument === '--new') ephemeral = true;
  else if (argument === '--visible') visibleInstance = true;
  else forwarded.push(argument);
}
if (ephemeral) {
  await sweepAbandonedInstances();
  instance = freeInstanceName();
}
if (instance) process.env.FLAREAI_DEV_INSTANCE = instance;
const launchArguments = backgroundInstanceArguments(forwarded, instance, visibleInstance);

function fail(message) {
  console.error(message);
  process.exit(1);
}

/**
 * Everything a named instance owns outside this checkout. Both are keyed off
 * the name — see `main.ts` for the userData directory (and with it Electron's
 * single-instance lock and the homeserver port) and `system/paths.ts` for
 * FlareAI's home.
 */
function instanceDirectories(name) {
  return [userDataDirectory(name), path.join(homedir(), `.flareai-${name}`)];
}

/**
 * Electron's own userData path for the ordinary run, with the suffix `main.ts`
 * appends. Derived here rather than asked of Electron because the answer is
 * needed before anything is spawned — and because it is how a running helper
 * is recognised as this instance's.
 */
function userDataDirectory(name) {
  return path.join(homedir(), 'Library/Application Support', `FlareAI-${name}`);
}

/**
 * A name no run is using and no directory is left over from.
 *
 * `npm run new` is "as if FlareAI had never been installed here", and several
 * of them have to be able to run at once — beside each other and beside the
 * ordinary `npm start`. So the name cannot be a constant: two `new` runs
 * sharing one would share a userData directory, and the second would find the
 * first's single-instance lock and hand its session over rather than opening.
 *
 * Scanning for the first free number rather than minting a random name keeps
 * the homeserver port predictable (`main.ts` hashes the name) and the
 * directories readable while a run is up.
 */
function freeInstanceName() {
  const running = processTable();
  for (let index = 1; index <= 99; index += 1) {
    const name = `new${index}`;
    if (running.some((entry) => entry.command.includes(`FLAREAI_DEV_INSTANCE=${name}`))) continue;
    if (instanceDirectories(name).some(existsSync)) continue;
    return name;
  }
  fail('Every ephemeral instance name is taken. Close some `npm run new` runs, or remove the leftover FlareAI-new* directories.');
}

/**
 * Takes the throwaway instance's data with it.
 *
 * The point of `new` is that the next one starts from nothing, so the
 * directories are removed when the run ends rather than left for the next
 * launch to find — which is also what keeps `freeInstanceName` from walking
 * further up the numbers every time.
 */
async function discardInstance(name) {
  // Forge exiting is not the app being gone, and Ctrl-C is not either: the
  // signal reaches this script and Forge, which does not pass it on, so the
  // Electron app it launched carries on orphaned. Deleting at that point
  // removed a directory the live app promptly recreated — which is exactly how
  // a `new` run left its data behind despite this function having run. So the
  // run retires its own instance first, and only deletes once nothing is left
  // that could write there.
  await terminateInstance(name);
  removeInstanceDirectories(name);
}

/**
 * Every process belonging to one instance: whatever carries the name in its
 * environment, plus their descendants — an Electron helper is a child of the
 * app rather than something `ps` shows the instance name for.
 */
function instanceProcesses(name) {
  const table = processTable();
  const byPid = new Map(table.map((entry) => [entry.pid, entry]));
  const owned = new Set(
    table.filter((entry) => entry.pid !== process.pid && ownsInstance(entry, name)).map((entry) => entry.pid),
  );
  /**
   * Climb to the app and to Forge. Neither names the instance: the app's main
   * process renames itself to "FlareAI" (see `dev-app-name.mjs`) so it cannot
   * be matched by path at all, and Forge shows neither the environment nor the
   * data directory. Only the Electron *helpers* carry `--user-data-dir`, so
   * the two processes that matter are reached as their ancestors — and they
   * are the ones that matter, because a surviving app writes its data
   * directory straight back and a surviving Forge starts another app.
   *
   * Stops at this script: a supervisor is not part of what it supervises.
   */
  for (let pass = 0; pass < 4; pass += 1) {
    const before = owned.size;
    for (const pid of [...owned]) {
      const parent = byPid.get(byPid.get(pid)?.ppid ?? 0);
      if (!parent || parent.pid <= 1 || parent.pid === process.pid) continue;
      if (parent.command.includes('dev-start.mjs') || parent.command.includes('npm')) continue;
      owned.add(parent.pid);
    }
    if (owned.size === before) break;
  }
  // Walk down until no new children appear; the tree is three deep at most.
  for (let pass = 0; pass < 8; pass += 1) {
    const before = owned.size;
    for (const entry of table) if (owned.has(entry.ppid)) owned.add(entry.pid);
    if (owned.size === before) break;
  }
  owned.delete(process.pid);
  return [...owned];
}

/**
 * Whether one process belongs to a named instance.
 *
 * Two ways of telling, because neither covers everything. macOS only reports a
 * process's environment to `ps` some of the time — an orphaned Forge shows
 * none at all — so an environment match alone silently missed exactly the
 * processes this has to find. Electron's helpers, on the other hand, carry
 * `--user-data-dir` on the command line itself, and that path *is* the
 * instance.
 */
function ownsInstance(entry, name) {
  return (
    entry.command.includes(`FLAREAI_DEV_INSTANCE=${name}`) ||
    entry.command.includes(`${userDataDirectory(name)}`)
  );
}

/** This process and everything that launched it, which `ps` cannot be asked to
 * leave out. */
function ownProcessChain() {
  const parents = new Map(processTable().map((entry) => [entry.pid, entry.ppid]));
  const chain = new Set();
  for (let pid = process.pid; pid && pid > 1 && !chain.has(pid); pid = parents.get(pid) ?? 0)
    chain.add(pid);
  return chain;
}

/**
 * Waits for a same-named instance to finish exiting.
 *
 * It holds its single-instance lock until it is fully gone, and the app that
 * meets that lock hands the session over and exits. Nothing about that is
 * loud: the launcher still reports a start, the old build stays on screen, and
 * anything the old process had bound — a debugging port, say — stays bound. So
 * a run against "the new code" can quietly be a run against the old one. A few
 * seconds of waiting is the difference between a slow start and a wrong one.
 */
async function awaitInstanceExit(name) {
  // Generous on purpose: quitting takes the app, its helpers and the Forge run
  // that owns them, and the lock is only free once the last of those is gone.
  const deadline = Date.now() + 30_000;
  let announced = false;
  // This run is already carrying the instance in its own environment, and `ps`
  // reports an environment as part of the command — so without this it would
  // find itself, and its npm parent, and wait for them forever.
  const own = ownProcessChain();
  const previous = () =>
    processTable().filter((entry) => !own.has(entry.pid) && ownsInstance(entry, name));
  while (previous().length > 0) {
    // Waited long enough. Going ahead rather than refusing: what is left may be
    // a helper the old run never reaped, which would hold a start hostage
    // forever, and a genuine collision is caught exactly — the app itself says
    // it handed over, and that is what fails the run below.
    if (Date.now() >= deadline) {
      console.error(
        `The "${name}" instance still looks alive after 30s. Starting anyway — if it really ` +
          `is running, this run will say so and stop rather than show you its older build.`,
      );
      return;
    }
    if (!announced) {
      console.error(`Waiting for the previous "${name}" instance to exit...`);
      announced = true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** Ends the instance, politely and then not. Returns once nothing of it runs. */
async function terminateInstance(name) {
  const alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const doomed = instanceProcesses(name);
  const signal = (which) => {
    for (const pid of doomed) {
      try {
        process.kill(pid, which);
      } catch {
        // Already gone between listing and signalling: nothing to retire.
      }
    }
  };

  signal('SIGTERM');
  const deadline = Date.now() + 8000;
  while (doomed.some(alive) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 100));
  if (!doomed.some(alive)) return;

  // Its data is about to be deleted, so there is nothing left to flush; the
  // one thing that matters now is that it cannot write the directory back.
  signal('SIGKILL');
  while (doomed.some(alive) && Date.now() < deadline + 2000)
    await new Promise((resolve) => setTimeout(resolve, 100));
}

function removeInstanceDirectories(name) {
  for (const directory of instanceDirectories(name)) {
    try {
      rmSync(directory, {recursive: true, force: true});
    } catch (cause) {
      // Worth saying, not worth failing the exit over: the sweep on the next
      // `new` run collects whatever is left.
      console.error(`Could not remove ${directory}: ${cause instanceof Error ? cause.message : cause}`);
    }
  }
}

/** True while any process still carries this instance in its environment. */
function instanceIsRunning(name) {
  return processTable().some((entry) => ownsInstance(entry, name));
}

/**
 * Collects the ephemeral instances of runs that never got to clean up after
 * themselves — a `SIGKILL`, a crash, a closed terminal. Without it those
 * directories accumulate one per abandoned run, which is both the mess the
 * user sees in `~` and what pushes `freeInstanceName` further up the numbers
 * every launch.
 *
 * Only `new<N>`, and only when nothing is running under that name: a named
 * instance (`npm run isolate`, `--isolated=review`) is *meant* to survive its
 * run, and a live one is not abandoned.
 */
async function sweepAbandonedInstances() {
  const swept = [];
  for (let index = 1; index <= 99; index += 1) {
    const name = `new${index}`;
    if (!instanceDirectories(name).some(existsSync)) continue;
    if (instanceIsRunning(name) && !instanceIsOrphaned(name)) continue;
    // An orphan is still running, so it has to be ended before its directory
    // can go — otherwise it writes the directory straight back, which is the
    // whole failure this sweep exists to undo.
    await terminateInstance(name);
    removeInstanceDirectories(name);
    swept.push(name);
  }
  if (swept.length > 0)
    console.error(`Cleared ${swept.length} abandoned instance${swept.length === 1 ? '' : 's'}: ${swept.join(', ')}.`);
}

/**
 * An instance still running with nothing left to look after it.
 *
 * The run's cleanup lives in this script, so a wrapper killed outright — a
 * `SIGKILL`, a closed terminal, an editor stopping the task — leaves Forge and
 * the app running with no one who will ever retire them or remove their data.
 * `launchd` adopting a process (`ppid` 1) is what that looks like from
 * outside, and it is the state the ephemeral directories were accumulating in.
 */
function instanceIsOrphaned(name) {
  const table = processTable();
  const byPid = new Map(table.map((entry) => [entry.pid, entry]));
  const owned = table.filter((entry) => ownsInstance(entry, name));
  if (owned.length === 0) return false;
  // Supervised means some ancestor is a live copy of this script — the only
  // thing that will ever retire the instance and remove its data. Asking
  // whether a parent merely exists is not the same question: Forge is a
  // perfectly live parent, and a Forge nobody owns is exactly the leak.
  return !owned.some((entry) => {
    for (let pid = entry.ppid, depth = 0; pid > 1 && depth < 8; depth += 1) {
      const parent = byPid.get(pid);
      if (!parent) return false;
      if (parent.command.includes('dev-start.mjs')) return true;
      pid = parent.ppid;
    }
    return false;
  });
}

/**
 * Every `ps` line, as `{pid, ppid, command}`. Anything unreadable is treated as
 * "no processes": the preflight below is a convenience, never a gate.
 *
 * `-e` appends each process's environment to the command text, which is the
 * only way from outside to tell a side instance from the ordinary run — and
 * the retirement below has to leave side instances alone, since they hold no
 * lock this run wants.
 */
function processTable() {
  try {
    return execFileSync('ps', ['-axeo', 'pid=,ppid=,command='], {encoding: 'utf8'})
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
 * itself before it ever opens a window (see the lock in apps/desktop/src/main/main.ts).
 * Forge does not notice — it keeps its dev servers up and its terminal quiet —
 * and the only FlareAI on screen stays the old one, still on its old bundle.
 * That reads exactly like `npm start` hanging on a blank window, so retire the
 * old session first.
 *
 * Only this checkout's development app is a candidate: it runs out of
 * `node_modules/electron`, which an installed FlareAI.app never does. Its main
 * process renames itself to "FlareAI" and so cannot be matched by path, but its
 * helper processes keep theirs — and their parent is the main process.
 */
async function retirePreviousDevApp() {
  const table = processTable().filter((entry) => !entry.command.includes('FLAREAI_DEV_INSTANCE='));
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

  console.error('Retiring the FlareAI dev app left over from an earlier `npm start`.');
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
  // FlareAI on screen stays the old one, whose renderer is usually already dead.
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

// A side instance is meant to run *beside* whatever is already up, so the
// preflight that clears the previous run is exactly what it must not do.
if (ephemeral) {
  console.error(
    `Starting a fresh FlareAI ("${instance}") with no settings, keys, chats, hub or skills, ` +
      `beside any run already open. Everything it writes is discarded when it exits.`,
  );
} else if (instance) {
  await awaitInstanceExit(instance);
  console.error(
    `Starting the "${instance}" FlareAI instance beside any run already open; ` +
      `its data lives in a userData directory of its own.`,
  );
} else {
  await retirePreviousDevApp();
}

const child = spawn(forge, ['start', ...launchArguments], {
  cwd: projectRoot,
  stdio: ['inherit', 'inherit', 'pipe'],
});

/** Set when the app said it met another instance's lock. See `awaitInstanceExit`. */
let handedOver = false;
const HANDOVER = /handing the session over/;

let pending = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => {
  const lines = (pending + chunk).split('\n');
  // The last element is whatever follows the final newline: hold it back so a
  // noise line split across two chunks is still matched as one line.
  pending = lines.pop() ?? '';
  if (lines.some((line) => HANDOVER.test(line))) handedOver = true;
  const kept = lines.filter((line) => !NOISE.some((pattern) => pattern.test(line)));
  if (kept.length > 0) process.stderr.write(`${kept.join('\n')}\n`);
});
child.stderr.on('end', () => {
  if (pending && !NOISE.some((pattern) => pattern.test(pending)))
    process.stderr.write(pending);
});

for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => child.kill(signal));

child.on('exit', async (code, signal) => {
  if (ephemeral) await discardInstance(instance);
  // A handover exits 0, which reads as a clean run. It is the opposite: nothing
  // of this build ever started, so say so and fail.
  if (handedOver) {
    console.error(
      instance
        ? `Nothing started: another "${instance}" instance holds the lock, and this run exited.`
        : 'Nothing started: another FlareAI holds the lock, and this run exited.',
    );
    process.exit(1);
  }
  process.exit(signal ? 1 : (code ?? 0));
});
