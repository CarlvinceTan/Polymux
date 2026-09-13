# Portable setup

Install `SKILL.md`, `scripts/`, `references/` and `tests/` together. Python 3.10+
is the common runtime; the coordinator and transports use its standard library.
Control includes no browser extension, extension installer, browser service,
agent-specific integration or mandatory page driver.

For macOS consent to appear under **Control Skill**, install the optional named
native helper with `python3 scripts/macos/helper.py install`. This is a separate
explicit setup action, not the browser capability check. See
[permissions.md](permissions.md) for signing, consent and activation. Existing
script permissions do not automatically transfer to the new app identity.

## First use

```bash
python3 scripts/control.py state
python3 scripts/browser/setup.py check
```

No personal configuration is needed for a local computer. When
`instance/control.json` is absent, every command uses the local hostname and OS
with `user_active: true` in memory. This protects the user's desktop by default.
An existing configuration is authoritative: invalid or unreadable configuration
is reported, never silently replaced with defaults. Leases and the short ambient
cache use the common per-user runtime directory automatically.

`browser/setup.py setup` is a compatibility alias for the same read-only check.
It identifies the normal OS-default browser, or the executable supplied through
`--browser` for a user-named browser, then reports observed native windows, tab
metadata, exact tab identities, attention signals and background routes separately.
It also reports scoped tab coverage and application-lease availability. Add
`--require-complete` when a task needs verified whole-browser coverage; exit 4
means it was not established. The default check does not equate any returned
tab count with a complete list. Missing coverage remains explicit and
extension-free; setup does not offer an extension fallback.
It creates no browser profile, changes no launch flags/default apps/Dock/taskbar
entries, opens no installer or consent dialog, and requests no permissions.
No browser restart, special launcher, store publication or extension is required
by Control. The user continues using their usual browser.

The runtime's task-start instruction should load this skill, run state once and
stop using Control when device/interactive work is unrelated. Use that runtime's
normal instruction mechanism; no particular agent product is required. Python
must already be runnable to execute a Python skill. A runtime that lacks it must
provision it through its normal environment setup; Control cannot execute its
own installer before an interpreter exists.

## Available platform access

| Platform | Built-in access and prerequisites |
|---|---|
| macOS | Process/default-browser discovery uses system APIs. Full native window helpers compile with an existing Swift command-line toolchain; Accessibility/Apple Events capabilities require the applicable existing permission. |
| Windows | Built-in Win32, PowerShell and UI Automation; permissions and application support determine available controls. |
| Linux X11 | EWMH inventory through xprop. Native actions also require xdotool and AT-SPI. |
| Sway / Hyprland | Existing compositor IPC commands supply native observation. Other Wayland desktops report unsupported native capabilities. |
| Chromium on macOS | A compatible native scripting dictionary supplies title/URL metadata and exact Apple Events tab IDs with existing Automation consent. |
| Safari on macOS | Native scripting enumerates tabs exposed by open windows; indexes are metadata only, and inactive tab groups are not assumed covered. |
| Chromium / Firefox protocol routes | CDP or BiDi can supply exact tabs through an available verified endpoint or the owning driver's existing session. Normal Firefox has no equivalent native AppleScript tab list. |

Missing access is an explicit capability gap, not an instruction to modify the
browser. Native metadata may still provide useful context without a page driver.
There is no universal mechanism that silently grants OS permissions or attaches
to every normal browser session. Zero user intervention is possible when the
required interfaces and permissions are available; it is not guaranteed for
full control on every unprepared machine. A lease never expands those capabilities.

## Optional configuration and drivers

To persist or customize the default configuration:

```bash
python3 scripts/config.py initialize --user-active true
```

Initialization never overwrites an existing file. Set `user_active: false` only
for an explicitly dedicated agent device. Remote access alone is not dedication.
Omitted values now default to true for every device, including existing entries. Each installation has one local hostname device.
Store personal state/power/transport helpers outside the portable skill and keep
secrets in the platform's credential facilities.

Extra devices and driver collectors are optional. Register a collector argument
array under `providers` using the [common schema](state.md). The adapter may wrap
any agent's driver; Control has no policy about that driver's internal transport.
All writers must use the shared lease/action-fence protocol. Merely running Control
state does not automatically coordinate a driver that bypasses that protocol.

All agents/copies on a host use the shared per-user runtime directory described
in [coordination.md](coordination.md). A remote device requires one authority:
install Control on that host, configure the same device there, and set local
`lock_command` to an authenticated command ending in `scripts/lock.py serve`.
Arguments travel as JSON on stdin, not interpolated shell text. Agent-owned VMs
can share their physical host's authority with a configured VM device entry.
Route all clients to that authority, including agents running on the host.

`control.py doctor` checks configured read-only reachability and power-status
routes. A reachable/headless device may still lack UI capabilities. `doctor --fix`
and `--offline` explicitly report unsupported options. Power wake/sleep helpers
remain explicit installation commands. Verify wake routes with read-only final
reachability checks; do not perform disruptive power cycles merely to test setup.

For agents running on more than one host, configure the same device catalogue
and authority routes on each host. Discovery cannot securely invent remote
credentials or a list of machines belonging to the user. Once authenticated
peer routes are set up, ambient collection and acquisition query each destination
automatically; no “primary human computer” setting is needed.
See [sessions.md](sessions.md) for restricted SSH and the Windows guest collector.
