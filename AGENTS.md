# Working on Polymux

Electron + Svelte 5 desktop app. **`CLAUDE.md` is a symlink to this file.**
Don't edit this file unless explicitly told so.

## Running the app

**`npm run isolate` is the default — use it unless told otherwise.**

```bash
npm run isolate
```

**Never run `npm start`** — it owns the ordinary userData directory, its
single-instance lock and hub port 47664, and a second run retires the user's session.

`npm run isolate` is `npm start -- --isolated[=name]`. `POLYMUX_DEV_INSTANCE` keys its
own userData dir (`…/Polymux-side`), its own homeserver port (derived from the name),
and its own `~/.polymux-<name>`. Vite picks a free port. Named isolates automatically
use Polymux's `--polymux-background` contract: the window is exposed for the
renderer/accessibility backend but stays transparent, ignores mouse input, and is
shown inactive. Use `--visible` only for a developer-run session the user explicitly
wants to inspect; automation must not use it.

- **Run it in the background** — it's long-running, and blocking stalls the turn.
- **Never bring it to the front.** Drive and verify it behind the user's window
  (screenshots, logs, renderer are all reachable). Surface it only when asked.
  Stop it when done.
- A side instance starts empty (settings, keys, chats, hub, skills) — reuse a name
  (`--isolated=review`) to keep state.
- Both runs build into the same `.vite`.

The other entry points exist, but **never reach for one on your own — only run these
when the user explicitly names them:**

| | uses `~/.polymux` | starts from nothing |
| --- | --- | --- |
| ordinary | `npm start` | `npm run new:start` |
| onboarding | `npm run onboarding` | `npm run new:onboarding` |

The left column is the app as the user has it — one at a time, and a second run
retires the first. The right column is `--new`: an instance named `new<N>`, the
first number no run holds and no directory is left over from, so several can run
at once and none of them collides with the user's. It is discarded on exit —
both `…/Polymux-new<N>` and `~/.polymux-new<N>` — which is also what keeps the
numbers from creeping up. Because it is discarded, state never survives the run —
which is the other reason `isolate` is the default.

`npm start` reads `.env` from the repo root (OAuth client ids for Drive, Dropbox,
OneDrive in development). Git-ignored, never packaged, environment wins. Add new
variables to `.env.example` too.

### Fast background operation

Load `window-control` before touching the app. For ordinary development, start a
named isolate as a background process and reuse that name so its test state
survives. Use logs and the run database for most verification; inspect the exact
Polymux window only when the result is genuinely visual.

For the usual reusable development instance, launch it detached and keep its
log separate from the current turn:

```bash
POLYMUX_DEV_INSTANCE=review npm run isolate > /tmp/polymux-review.log 2>&1 &
```

Before starting another copy, check whether the `review` instance and its
backend endpoint already exist. Reuse them when healthy; do not infer readiness
from the Electron process alone. Readiness means the backend responds and, when
UI control is needed, the exact window exposes a populated semantic tree.

Use this order so routine operation stays fast and non-interrupting:

1. Reuse an already-running named isolate and its existing backend endpoint.
2. Prefer backend/preload APIs and run, AgentActivity, Ledger, and timing records.
3. If UI evidence is required, refresh the non-activating window list, match the
   exact PID plus native window ID, acquire its lease, then use semantic
   accessibility actions and verify the resulting state.
4. If the accessibility mapping is stale after fullscreen, a Space change, or
   lock/unlock, re-identify that same native window once. Do not relaunch or focus it.
5. Release the lease and stop only the exact test instance when finished.

When reading AgentActivity, pair each task start with its parent run, terminal
state, elapsed time, and result. A completed-looking activity row is not enough:
shared-pool work must show the expected Ledger claim/update, independent work
should not pay Ledger overhead, and the final answer or external state still
needs independent verification.

Treat current open tabs/windows as present-state evidence, durable memory as the
source for preferences and personal relevance, and ComputerHistory as the fallback for
recent state that is no longer open. Do not search ComputerHistory when the current
snapshot already resolves the reference, and do not treat any of these sources
as authorization to click, send, submit, or change state.

Do not pass the whole desktop snapshot for incidental wording such as “this
weekend.” A current-state request gets one synchronous refresh; ordinary turns
use only semantically matching open state and refresh the cache off the critical
path. After an exact window is leased, validate that identity rather than
re-enumerating every window between actions.

For a benchmark that needs the user's real `~/.polymux` settings or credentials,
do not substitute an empty isolate and never use `npm start`. Build the packaged
app, then use the verified Polymux background-launch route from `window-control`.
Confirm it stayed nonfrontmost, identify and lease its exact native window, and
use only exact-window accessibility actions. Verify the selected main and task
models in the recorded run rather than assuming the UI setting propagated.

Keep the loop short: launch or reuse → submit one realistic prompt → follow the
run/activity and Ledger records → verify the final UI/state → release the lease
and stop the instance. If fullscreen or a Space change makes the accessibility
window disappear, invalidate the route and re-identify the same native window;
never recover by focusing, raising, globally typing into, or clicking the app.
Prefer the backend and read-only run records until exact background control is
available again. Restore any temporary benchmark setting when finished.

Before any packaged benchmark launch, query the bundled route registry for the
exact built app and run both the headless provider probe and a check-only GUI
preflight. Stop before building or launching when the provider probe is not
`ready`; quota, authentication, and timeout results are diagnostic only:

```bash
npm run eval:orchestration:probe
python3 resources/skills/core/computer-use/scripts/app-control-registry.py lookup-launch \
  --app Polymux --bundle-id com.flarehq.polymux
zsh resources/skills/core/computer-use/scripts/prepare-background-app.sh \
  --app Polymux --process Polymux --bundle-id com.flarehq.polymux \
  --compiled-launch --check-only
```

Proceed only when lookup includes `arg=--polymux-background` and the helper
returns `ready_compiled_hidden_launch` or `ready_compiled_recoverable_launch`.
Do not combine `--compiled-launch` with ad-hoc `--verified-launch-*` arguments:
the helper rejects those as conflicting launch sources. The first-use route is
still monitored rather than pre-certified; after check-only, run the same
helper with `--compiled-launch` and proceed only if its live result is
`ready_hidden_launch` or `ready_background_recovered_launch`. Never weaken this
boundary merely to run the benchmark.

Use a dedicated isolated or background-benchmark data directory, verify role
assignments through Polymux's own API, and submit through the backend/preload
API. The macOS lock screen intentionally makes accessibility window mapping
unavailable; while locked, use only the verified non-GUI backend route and do
not claim visual UI verification. On completion, cancel unfinished runs, stop
only the exact test PID, and confirm the prior frontmost app never changed.
The packaged `--polymux-background` route owns homeserver port 47865; the
ordinary user session remains on 47664, so a hidden benchmark must never retire
or bind the user's session even when both are running.

Normal launches use the baseline orchestration strategy. Add
`--orchestration-experiment` after `--args` only for a recorded experimental
run; alternate baseline/experiment order and never infer the active strategy
from the answer text alone.

## UI work

`DESIGN.md` is the design system of record. **Read it before any UI work** —
components, styling, layout, colours, motion — and follow it.

**Never update `DESIGN.md` unless explicitly told to.** If a change conflicts with
it, say so and ask rather than editing the document to match the code.

## Git

**Never run `git stash`.** It moves the user's uncommitted work somewhere they
aren't looking. If changes are in the way, work around them or ask.

## Compatibility

Polymux is pre-release with no external users. Do not add runtime compatibility
for obsolete Polymux formats; reset disposable state, or use a bounded one-time
migration for valuable local data and remove it once verified.
