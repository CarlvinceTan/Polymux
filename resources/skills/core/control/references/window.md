# Exact native windows

`window.py list|capture|inspect|tabs` is read-only and accepts `--device`, `--app`,
`--app-id` and `--pid`; exact observation adds `--native-window-id`. Capture adds
`--output`. Discovery never authorizes foreground input.

Acquire the canonical native app/window lease first. `press` and `set-value`
require `--lock-window-id`, `--lock-token`, and one exact
`--match-attribute role|title|description|identifier` / `--match-value` pair.
The backend rejects missing/ambiguous controls. Supplied app identity is checked
against the actual process before dispatch; `lock.py begin` checks process birth
and exact current surface. Coordination is required on agent-owned desktops too.

```bash
python3 scripts/window.py set-value --device DEVICE --app APP --app-id APP_ID \
  --pid PID --native-window-id WINDOW --lock-window-id WINDOW --lock-token TOKEN \
  --match-attribute identifier --match-value FIELD \
  --expected-value 'last observed value' --new-value 'intended value'
```

`--expected-value` is mandatory for set-value, including an explicitly empty
string. The exact accessibility control is re-read before writing; mismatch
returns `conflict`, performs no write and leaves ownership intact. Re-read only
the changed field and adapt. This is an optimistic boundary, not a guarantee of
atomic merging with keystrokes that arrive during the read/write interval.
For a literal value beginning with a dash, use `--new-value=--literal` (and
the equivalent form for expected/match values). Backend handoffs preserve the
literal text; Windows uses JSON stdin rather than PowerShell option parsing.

Backends use AX (macOS), UI Automation (Windows), and X11/AT-SPI (Linux).
Wayland collectors can return context, but bundled native actions do not turn
Sway/Hyprland IDs into X11 IDs. Missing background capabilities block dispatch.
Native semantic actions contain no global mouse, keyboard or focus injection.
Their application may still react by presenting new UI; use a different task
backend when that reaction would interrupt the human. macOS action results
include `foreground_changed` as observation, never a command to restore focus.

Actions are bounded to ten seconds. Each gets a lease operation fence. Verified
success completes the fence; proven precondition failure completes it as
not-applied. Timeout/ambiguous failure returns `action_outcome_unknown` and keeps
the operation quarantined. Verify application state before reconciling; do not
repeat the action automatically. A successful setter proves the read-back value,
not that the application saved it to its final destination.

`background.py prepare` only checks existing applications on a shared local
desktop. Its former cold-launch containment could restore focus over the human,
so that route is no longer used there. A missing application needs an actually
non-activating application API or a separate agent-owned desktop. On an
agent-owned desktop the existing launcher remains available. State never launches
applications under either ownership mode.

The macOS `tabs` observation reads browser chrome in the exact window, excludes
webpage widgets/content, and reports metadata-only tab labels and available URLs.
