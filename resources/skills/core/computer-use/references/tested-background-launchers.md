# Background launcher evidence

How launcher and control evidence is produced, and where it lives. It is method
only: **no route, app, version or trial count is recorded in this skill.** A
route pins an exact macOS build and an exact app build, so evidence belongs to
one installation and is worthless — and misleading — anywhere else.

## Where the evidence lives

Everything this installation has learnt sits under Polymux's home, never in the
skill:

| Path | Holds |
| --- | --- |
| `~/.polymux/state/window-control/app-control-registry.json` | compiled routes: the tuples trusted for a launch or a control capability |
| `~/.polymux/state/window-control/route-observations.json` | the observation cache: one task's success or failure per app identity, capability and route |
| `~/.polymux/state/window-control/quarantined-routes.json` | routes withdrawn after a focus or exposure incident |
| `~/.polymux/state/window-control/incidents.jsonl` | the incidents themselves, append-only |

Read them rather than assuming coverage:

```bash
"${POLYMUX_NODE:-node}" scripts/app-control-registry.mjs list-routes
"${POLYMUX_NODE:-node}" scripts/runtime-route-observations.mjs list
```

A fresh installation has none of this. Empty is the correct starting state, and
`blocked_compiled_control_missing` means "not audited on this host yet" — not
"unsupported". Answer a coverage question from those two commands, never from
memory of another machine.

## An app with no route yet: first use, then memory

There is no audit to run before ordinary work. When no compiled route covers the
app and capability, the lookup answers `first_use_monitored` instead of refusing,
and the attempt proceeds on the spot — under the lease, through the same
fail-closed controller, with the focus, window-exposure and recovery monitors
armed exactly as they are for a compiled route. A first use is as contained as a
hundredth; what it lacks is only the memory, and that is written from its
outcome:

- **It passed** — the route is enrolled from the identity actually observed, and
  the next request for that app, version and capability resolves to a compiled
  route with no first-use path at all.
- **It surfaced and was put back** — the recovery watcher is armed before a
  first-use control call as well as before a launch, so an app that comes to the
  front is returned to the background and the user's app reactivated. A launch
  like that is enrolled as a *foregrounding* route, so the next one takes the
  monitored recovery path deliberately. A control call like that is recorded as a
  failure and not enrolled: the next attempt tries again watched rather than
  trusting a route that needed rescuing.
- **It surfaced and stayed** — the incident is recorded and the app is
  quarantined, by app rather than only by route id, since a first-use route id
  does not outlive the attempt. Launch and control are banned separately: an app
  that misbehaves when launched can still be safe to read once it is running, and
  a controller that surfaced it says nothing about the launcher.
- **It failed some other way** — capture refused, no matching control, an
  ambiguous window — the failure goes in the observation cache against that exact
  app build and capability, so the next task knows what was already tried.

Each capability is learnt separately: proving `capture` never implies `press`, so
the first `press` on an app whose capture is already compiled is its own first
use. An app or macOS update invalidates the memory by identity — the route id
pins the exact version and build, so an updated app is a fresh first use rather
than an inherited assumption.

Nothing about that requires a flag. Call the helper the ordinary way:

```bash
zsh scripts/prepare-background-app.sh --app "Example" --process "Example" \
  --bundle-id "com.example.app" --compiled-launch
```

The exception is an app-owned required background contract. The registry maps
that requirement by exact bundle identity and adds it itself; callers must not
mix compiled lookup with ad-hoc launcher arguments. For Polymux,
`com.flarehq.polymux` requires `--args --polymux-background --remote-debugging-port=9334`.
The debugging endpoint is loopback-only and belongs to the disposable
background-benchmark profile; use its preload API for run submission and
telemetry, while keeping exact-window accessibility as the independent visual
check. An older compiled
route without that app argument is ignored, and a successful first use records
the exact flagged command.

The explicit `--compatibility-audit --user-authorized-compatibility-audit
--app-path` mode still exists for a deliberate audit of an app you are *not*
about to use — three trials for a route you want to enroll on evidence rather
than on one pass. It is not a precondition for work.

Record the capability in the observation cache as well, since it remembers the
task-level result the registry does not:

```bash
"${POLYMUX_NODE:-node}" scripts/runtime-route-observations.mjs record \
  --app-path "/Applications/Example.app" --capability capture \
  --route "open -g -j" --prepared-state hidden --result failure
```

Record the failures as carefully as the successes: an app that takes focus on a
hidden launch is exactly what the next task needs to know.

The helpers enroll a passing first use themselves, so there is nothing to do by
hand. `remember-route` is that call if you need it directly, and `enroll-route`
takes a fully audited route object; both re-read the bundle and refuse a route
whose claimed identity no longer matches.

## What a trial has to show

A trial passes only when the target never became frontmost, emitted no
activation event, and exposed no onscreen layer-0 window. Observe focus through
`NSWorkspace` activation events plus frontmost sampling, and windows through
Core Graphics window sampling; the helper's watchers cover a five-second launch
boundary and quarantine a strict hidden route automatically after either
failure. A compiled foregrounding route instead runs the recovery watcher and is
quarantined only if the target cannot be returned to the background.

## Required identity check

Before using a `verified_safe` route:

1. Confirm `sw_vers -buildVersion` is the build the registry recorded.
2. Read the target's `CFBundleIdentifier`, `CFBundleExecutable`,
   `CFBundleShortVersionString`, and `CFBundleVersion` from its `Info.plist`
   without launching it.
3. Require exact matches for path, bundle identifier, executable, version, and
   build.
4. Run the exact launcher only through `scripts/prepare-background-app.sh`
   with `--compiled-launch`; the helper resolves the command and arguments from
   this installation's registry and refuses stale or quarantined routes.
5. Proceed only when the gate returns `ready_hidden_launch`.

An example for a matching Calculator installation:

```bash
zsh scripts/prepare-background-app.sh \
  --app "Calculator" \
  --process "Calculator" \
  --bundle-id "com.apple.calculator" \
  --compiled-launch
```

## Rules that outlive any one machine

- A launcher is app-and-version-specific evidence, never a platform guarantee,
  and never a permanent application allow-list. Retest after any app or macOS
  update before trusting a route again; an update marks evidence stale but does
  not prove the route changed, so treat the old observation as a hypothesis and
  revalidate only the capability the current task needs.
- Read-only coverage does not imply safe mutation. A verified capture capability
  says nothing about presses or value changes: request the material capability
  actually needed and test a harmless, reversible action before enrolling one.
- A foregrounding launcher is not background-safe by itself. It is usable only
  through the compiled monitored-recovery path: the recovery watcher must be
  running before launch, must reactivate the exact previous app when the target
  takes focus, and the target must be verified nonfrontmost before control
  starts. If recovery fails, the route is quarantined. Ad hoc focus restoration
  remains forbidden.
- A running process without an ordinary window is not coverage, and a failed
  launch is not a safe route.
- An app that was already running and nonfrontmost is not cold-launch evidence.
  Its windows staying onscreen behind the active app is not a pass, and it never
  authorizes sending reopen events.
- Full-screen preservation is not a launch goal. Leave a nonfrontmost restored
  layout alone; never enter or exit full-screen merely to normalize it.
- Temporary development apps may use the observation cache while their exact
  build exists, but they are never enrolled as compiled routes.
