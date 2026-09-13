# Exact-window controller

Use this controller only after the session gate confirms a supported app and
`lookup-control` verifies the required capability. It never launches or
activates the app and never synthesizes pointer or keyboard input.

## Discover and lease

List current native windows without activation:

```bash
zsh scripts/exact-window-control.sh list \
  --app "Calculator" \
  --app-id "com.apple.calculator" \
  --pid 1234
```

Select the exact window using current PID, native ID, title, bounds, document,
and workflow evidence. Do not use list order or recency. If evidence remains
ambiguous, stop. Acquire that identity with `window-control-lease.py` before
inspection, capture, or mutation. The lease window ID must be `cg-NATIVE_ID` or
`cg-NATIVE_ID:QUALIFIER`; the wrapper rejects a lease bound to a different
native window before invoking the controller.

## Inspect and capture

Every material call validates the exact lease and compiled capability first:

```bash
zsh scripts/exact-window-control.sh inspect \
  --app "Calculator" --app-id "com.apple.calculator" \
  --pid 1234 --native-window-id 5678 \
  --lease-window-id "cg-5678:Calculator" --lease-token "TOKEN"

zsh scripts/exact-window-control.sh capture \
  --app "Calculator" --app-id "com.apple.calculator" \
  --pid 1234 --native-window-id 5678 \
  --lease-window-id "cg-5678:Calculator" --lease-token "TOKEN" \
  --output "/absolute/path/window.png"
```

The controller maps the native window to exactly one accessibility window by
current PID, frame, and title evidence. Missing or multiple matches fail
closed. Duplicate references to the same accessibility object are collapsed,
while genuinely distinct matching windows or controls remain ambiguous.
Capture uses ScreenCaptureKit's desktop-independent exact-window filter,
including for hidden and off-screen windows.

## Actions

Use stable semantic attributes and require exactly one match:

```bash
zsh scripts/exact-window-control.sh press \
  --app "Calculator" --app-id "com.apple.calculator" \
  --pid 1234 --native-window-id 5678 \
  --lease-window-id "cg-5678:Calculator" --lease-token "TOKEN" \
  --match-attribute description --match-value "7"

zsh scripts/exact-window-control.sh set-value \
  --app "Dictionary" --app-id "com.apple.Dictionary" \
  --pid 1234 --native-window-id 5678 \
  --lease-window-id "cg-5678:English" --lease-token "TOKEN" \
  --match-attribute role --match-value "AXTextField" \
  --new-value "example"
```

Prefer a unique accessibility identifier, then a unique title or description.
Use a role alone only when exactly one element of that role exists. `set-value`
verifies the resulting accessibility value. After `press`, independently
verify the expected workflow state through a fresh inspect or capture; a
successful accessibility call alone is not proof of the intended result.

If any call unexpectedly makes the target frontmost, the wrapper fails and
quarantines that exact control route. Release the lease when complete.

## Compatibility-audit mode

With explicit user authorization, an exact missing or stale app tuple may be
tested without first pretending it is approved:

```bash
zsh scripts/exact-window-control.sh inspect \
  --app "Example" --app-id "com.example.app" \
  --app-path "/Applications/Example.app" --pid 1234 \
  --compatibility-audit --user-authorized-compatibility-audit \
  --native-window-id 5678 --lease-window-id "cg-5678:Example" \
  --lease-token "TOKEN"
```

The wrapper verifies the exact bundle path and PID and requires the target to
be nonfrontmost. It retains the normal exact-window lease for every operation
except read-only discovery. Audit output is evidence only; it does not create a
compiled route or authorize later use without the normal staged registry and
maintenance checks.
