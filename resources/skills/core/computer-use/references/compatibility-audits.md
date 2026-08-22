# Compatibility audits

Use this path only when the user explicitly requests testing or operating an
exact missing or stale app tuple. Ordinary task mode is just-in-time: test only
the launch or control capability needed to finish the task. A comprehensive
audit is separate work and must not delay an ordinary task unless the user asks
for certification or compiled enrollment.

## Reusing prior observations

Before testing, query `scripts/runtime-route-observations.mjs lookup` with the
exact app path and requested capability.

```bash
"${FLAREAI_NODE:-node}" scripts/runtime-route-observations.mjs lookup \
  --app-path /absolute/App.app --capability press
```

- `exact_observed` identifies the previously successful route for the same app
  and macOS build. Reuse it after the normal changing checks; do not repeat
  unrelated launch modes, window states, or actions.
- `stale_observed` is a useful route hypothesis after an app or macOS update.
  Revalidate only the requested capability. Escalate to broader testing only if
  that route fails or the relevant surface changed.
- `missing` means try the narrowest safe route needed by the task.

After the attempt, record only that exact capability and result with `record`.
The cache contains structured identity and route metadata only, never content,
passwords, account data, screenshots, or other payloads. A recorded observation
does not authorize a different action and does not replace current exact-window,
lease, focus, or result verification.

```bash
"${FLAREAI_NODE:-node}" scripts/runtime-route-observations.mjs record \
  --app-path /absolute/App.app --capability press \
  --route exact-window-capture+accessibility \
  --prepared-state background --result success
```

## Cold launch

For a stopped app, run `prepare-background-app.sh` with
`--compatibility-audit --user-authorized-compatibility-audit --app-path`.
The helper verifies the bundle identity, fixes the launcher to
`/usr/bin/open -g -j -a APP_PATH`, and pre-arms the same continuous focus,
window-exposure, and recovery monitors used by compiled launches. It refuses an
already-running target, arbitrary launch commands, new-instance flags, and app
arguments.

In ordinary task mode, run one launch attempt only when the app actually needs
launching. Three stopped-state trials are required only for deliberate compiled
launcher enrollment, not routine use. Record whether the task's route stayed
hidden, required launch-only containment, failed to start, or could not be
recovered. Never terminate and relaunch an app merely to broaden coverage.

Treat `blocked_prior_state_changed` as an invalidated trial, not evidence about
the app route. `blocked_foreground_recovery_failed` is route failure evidence.
Every blocked result must surface whether the launch command ran plus the
exact-prior recovery JSON and focus/window watcher results when available; do
not collapse a known watcher result into generic `blocked_state_unavailable`.

## Exact-window control

For an existing nonfrontmost window, use `exact-window-control.sh` with the same
audit authorization and app path. The wrapper verifies that the PID belongs to
the exact bundle, requires an exact window lease for every material operation,
and retains the normal no-global-input and foreground-incident checks.

Test capture and accessibility inspection separately from actions. Add an
action capability only after a harmless reversible state change and its
restoration are independently verified. Test multiple-window isolation only
when two unambiguous safe windows already exist.

Observe saved expanded or full-screen restoration without entering, exiting,
or normalizing full screen. Minimized remains unsupported unless a separate
exact tuple proves it.

## Auditing the host app

For the app running the current task, use a detached one-shot terminal audit
that survives the app quitting, guarantees a compliant relaunch, and writes
durable evidence. A CLI continuation may update the recorded task but is not
proof that the desktop UI visibly refreshed; require a verified host signal or
tell the user to reopen the task.

Compiled enrollment remains a staged registry change with the complete
maintenance gate, applied with `scripts/app-control-registry.mjs enroll-route`
against this installation's own registry — never by editing the file, and never
into anything that ships with the app. An app or macOS update marks compiled evidence stale, but it
does not imply the route changed: use the old observation as a hypothesis and
revalidate only the capability required by the current task.

A clean task result is remembered for the exact app identity, macOS build,
route, prepared state, and capability. It can select the likely route later but
does not create a compiled route or grant broader authority. Temporary
development apps may use the cache while the exact build exists, but they are
never enrolled in the persistent compiled registry.
