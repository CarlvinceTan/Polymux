---
name: window-control
description: Drive an exact native app window without activating it. Acquire a caller-stable lease in the host window lease registry before inspection, capture, or mutation; the same registry drives Polymux's menu-bar pill, so every held lease is visible to the user. Covers the exact-window controller, the compiled route registry, background-launch checks, and lease renewal and release. Never launches, activates, or focuses an app, and never synthesizes global pointer or keyboard input.
author: Polymux
---

# Window Control

Control owns coordination and context; this skill owns the operating tooling
for exact native windows on this host. Load `control` first and follow its
admission rules, then operate only the leased identity below.

Keep first answers brief and outcome-first. Omit internal preflight and
recovery detail unless the user asks for it.

## Leases are mandatory and visible

- Acquire the window or exact tab atomically with
  `python3 scripts/window-control-lease.py`, passing `--owner "$POLYMUX_RUN_ID"`
  so the lease stays attached to this run, along with `--controller
  window-control`, the app/window identity, scope, and tab identity when
  relevant. Window-scoped control conflicts with every controller in that
  window. Tab-scoped controllers may coexist only on different exact tabs and
  only when neither route can change window-wide state or spill into the other
  tab.
- The lease window ID must be `cg-NATIVE_ID` or `cg-NATIVE_ID:QUALIFIER`; the
  wrapper rejects a lease bound to a different native window before invoking
  the controller.
- Every held lease appears in Polymux's menu-bar pill while it lives, and an
  expired lease ends the pill entry on its own — nothing has to remember to
  call hide. Renew a lease while thinking, waiting, or accepting human help;
  release it on completion, explicit abandonment, or transfer.
- An app name alone never identifies the target. Resolve the exact identity
  from current PID, native ID, title, bounds, document, and workflow evidence;
  never from recency, list order, position, or an old screenshot. If evidence
  remains ambiguous, stop and ask the user to distinguish the windows without
  changing either one.

## Discover, verify, then operate

List current native windows without activation:

```bash
zsh scripts/exact-window-control.sh list \
  --app "Calculator" \
  --app-id "com.apple.calculator" \
  --pid 1234
```

Every material call validates the exact lease and compiled capability first;
see [references/exact-window-controller.md](references/exact-window-controller.md)
for the inspect, capture, and action forms. Before using exact-window capture
or an accessibility action, check the exact app/version/capability tuple with
`python3 scripts/app-control-registry.py lookup-control`. A verified capture
capability does not imply action coverage; request the material capability
actually needed. Before classifying any installed app as supported,
visual-only, untested, or unsafe, read what this installation actually knows —
`python3 scripts/app-control-registry.py list-routes` — rather than assuming
coverage. A recorded read-only route never implies mutation coverage.

An explicit request to use an exact unregistered or stale app authorizes a
just-in-time compatibility check for only the capability required by that
task, gated by the maintenance protocol in
[references/compatibility-audits.md](references/compatibility-audits.md). Do
not run a full launch, window-state, capture, inspection, and action battery.
Check any route identifier with `python3 scripts/app-control-registry.py
check-route` before use, and consult
[references/tested-background-launchers.md](references/tested-background-launchers.md)
for background-launch evidence. When making evidence claims from captures,
follow [references/evidence-quality.md](references/evidence-quality.md).

## Boundaries

- This skill never launches, activates, raises, or focuses an app or window,
  and never moves the pointer, issues global keystrokes, or steals focus. An
  application can itself open or focus a dialog in response to a semantic
  action; that is the application's behavior, not a license to activate
  windows directly.
- A user-only handoff (OTP, CAPTCHA, biometric/passkey challenge, secret
  entry, or another genuinely user-only choice) pauses control of that exact
  surface until the completion signal and lease rules permit resumption.
- Verify the task's actual result. A dispatched action or changed dialog is
  only an intermediate observation.
