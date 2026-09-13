# State and provider contract

`control.py state` produces a compact versioned snapshot of every configured
device, including agent-owned devices. State never launches/restarts target apps,
changes browser/desktop settings, asks for permissions, focuses windows or
acquires a lease. Available metadata is routing evidence, not permission to
read unrelated page/document contents.

```bash
python3 scripts/control.py state
python3 scripts/control.py state --json --full --fresh --device DEVICE
python3 scripts/control.py state --device DEVICE --app-id APP --full --json
python3 scripts/control.py state --since PREVIOUS_REVISION --json
```

Default output includes up to 40 surfaces and 40 apps per device; titles/URLs
are shortened to 180 characters in the compact view. `surface_count` and
`omitted_surfaces` make truncation explicit. `--full` preserves full metadata length, with credential-like URL queries, userinfo,
and fragments redacted.
The complete provider response is limited to 2 MiB; oversized and timed-out
providers become availability warnings. Devices run concurrently under a
per-device deadline (five seconds by default). One missing device does not
prevent other devices' results. A two-second per-user cache makes repeated
ambient reads cheap; `--fresh` bypasses it. Acquisition/action resolution never
uses this ambient cache. `--since` suppresses unchanged content, not collection.
`--app-id` filters returned content; it does not promise the provider collects
only that app. Task-specific observation should use an exact provider directly.

The JSON root includes `schema_version: 1`, `observed_at` (Unix seconds),
`revision`, `cached`, `elapsed_ms`, and `devices`. Each device retains
`device_id`, `platform`, `kind`, `user_active`, derived `coordination`,
`sessions`, `session_inventory_complete`, `completeness`, `tab_inventory`, capabilities,
apps, current attention, browser metadata and surfaces. Empty containers remain
empty; unknown/unavailable is distinct from a known empty result.

## Native capabilities

| Platform | Source | Limits |
|---|---|---|
| macOS | AppKit, CoreGraphics, existing Accessibility permission | Exact focused window needs a unique AX/native match. Metadata Apple Events are checked without prompting. |
| Windows | WTS sessions, Win32 windows, foreground HWND, process creation time | Inaccessible process identities remain unavailable. UI Automation powers exact semantic actions. |
| Linux X11 | EWMH through xprop, process birth from procfs | Depends on the window manager exporting EWMH properties. xdotool/AT-SPI are needed for native actions. |
| Sway / Hyprland | Existing compositor IPC, procfs | Read-only native inventory/attention; bundled native actions remain X11-only. |
| Other Wayland | Explicit capability gap | XWayland inventory is not proof of complete Wayland attention. |

Built-in browser metadata discovers declared running browser apps. macOS Safari
and compatible Chromium AppleScript collectors use already granted consent only.
Chromium's native tab IDs are exact in the `applescript` namespace; Safari indexes
are metadata only. Both collectors advertise observation, not an action driver.
If unavailable, return native window metadata. CDP/BiDi produce exact tab/context
IDs when an existing route is available. Per-browser `tab_inventories` give the
source, scope, count and completeness of each interface; alternative views may
describe the same tabs. Never infer whole-browser coverage from returned rows.
External providers can contribute exact identities even when native inventory is
unavailable; the device then reports partial context. Browser setup never runs
implicitly during state collection, and Control includes no extension service.

## Configuration

`instance/control.json` contains `devices` and optional `providers`. Exactly one
device is `local` and its ID matches the local hostname. Kinds are `local`,
`remote`, `vm`, `phone`. A VM names its host; its device ID is the libvirt domain.
`user_active` means the human can use that session; it gates attention admission,
not agent coordination. All UI writers require leases. Omitted `user_active` defaults to **true**, including explicitly configured peers.
This is a safety migration from the former implicit false default. Set false only
for a device explicitly dedicated to agents. With no
configuration file, Control automatically uses one local device with the
conservative shared-device value `true`, without writing a file.

Device fields are `kind`, `platform`, `host` (VM only), `user_active`,
`state_command`, `lock_command`, and `power`. State collectors may be configured
for agent-owned devices too. A shared non-local device needs live state for admission. A missing route reports
unavailable context and blocks acquisition; it does not imply human absence.
`power` retains complete `status`, `wake`, `sleep` argument arrays. Authentication
and host-specific routing stay in external helpers; no secrets in this file.
`${skill}` in command arguments expands to this installation root.

## External drivers

Register local driver collectors as `providers: { "driver-name": ["EXECUTABLE",
"ARGUMENT", "..."] }`. They can wrap any browser/native driver. Each invocation
must be bounded, live, read-only and non-activating, returning:

```json
{
  "schema_version": 1,
  "observed_at": 1800000000.0,
  "surfaces": [{
    "kind": "browser-tab",
    "app_id": "native.application.identity",
    "instance_id": "pid:process-birth",
    "identity_namespace": "cdp",
    "identity": "exact",
    "window_id": "window-id",
    "tab_id": "target-id",
    "title": "Example",
    "url": "https://example.invalid/",
    "human_active": false,
    "capabilities": {"observe": true, "background_actions": true}
  }]
}
```

Use the same native app identity and process-birth instance as other providers.
Same-protocol drivers share target IDs; never prefix them with an agent/session
name. Only declare `identity: exact` with authoritative lifecycle identity.
Use `metadata_only` for tab indexes/title-based mappings. `human_active` is
boolean or `"unknown"`; absence is unknown, never false. False means the
provider proved that surface is outside current human attention, not merely
that `document.hasFocus()` was false. Browsers may focus the address bar.
`background_actions` describes route availability and is not a guarantee that
arbitrary page/application code cannot react by opening new UI.

Providers are trusted installed code, not arbitrary JSON supplied by an agent
at acquisition time. A provider must not return cached activity as fresh. A
configured remote `state_command` returns the same device/surface data through
its authenticated transport. Cached metadata is useful ambient context only;
it cannot establish mutation eligibility.

Session details and collector routing are described in [sessions.md](sessions.md).
`coordination.session_mode` is configured `shared` or `unattended` policy;
`human_active` is live destination attention, independently of that policy.
`session_id` links a surface to its OS login/display session. It is contextual
scope, not an agent identifier or replacement for process-birth identity.
Do not collapse several active sessions into one global foreground window.
