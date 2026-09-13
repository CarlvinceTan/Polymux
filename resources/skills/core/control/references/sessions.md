# Runtime sessions and peer routing

Control separates configured sharing policy, live human attention, and agent
ownership. All three apply to the **destination**, regardless of where the
requesting agent runs. A machine is not unattended merely because access is
through SSH, a VM guest agent, or a background service.

- `user_active: true` (the default) means a person might use this device.
- `user_active: false` is an explicit dedication policy, not a detector result.
- `sessions[].presence` is `possible`, `absent`, or `unknown`. Possible includes
  quiet reading, locked sessions and connected remote desktops.
- `sessions[].active` gives that session's observed foreground; surfaces carry
  `session_id`. Several sessions/devices can be active simultaneously.
- `session_inventory_complete` states whether enumeration covers the device.
  Empty or incomplete collection cannot prove absence.

Positive, current absence evidence can admit a shared session's surface even
when its last foreground window remains selected. Unknown presence does not
disable useful context or proven background targets. Idle duration never proves
absence. A fresh acquisition rechecks attention; existing ownership, renewal and
action fences do not. Human access never takes an agent's lease away.

## Native collection

**Linux:** logind supplies user desktop sessions. Collection over SSH finds the
matching same-user display connection through procfs, reading only the selected
display environment keys from processes in that session's cgroup. It uses EWMH
or supported compositor IPC without selecting a desktop. Other users' sessions
remain visible as presence even when their windows cannot be inspected.
Non-logind VNC servers and unsupported Wayland compositors prevent a claim of
complete device-wide absence. IdleHint and LockedHint are context only.

**Windows:** WTS enumerates console and RDP sessions independently of the
collector's process session. An ordinary user process observes its own desktop.
A service already permitted to query a user's session token can launch a bounded
read-only helper in that existing session. The helper has no console window,
does not log anyone in, does not register tasks, and never activates the desktop.
Its random local named pipe is restricted to that session account and SYSTEM;
handles are not inherited across sessions. Install portable source where the
session account has read/execute access, with writes restricted to the owner or
administrator. No permission escalation is attempted.

Disconnected RDP sessions provide absence evidence. Unknown transports and
disconnected console sessions remain conservative. A reconnected session is
protected on the next acquisition. Service session zero and RDP listeners are
not human sessions. Missing permission to inspect a connected session leaves its
attention unknown; it never makes the computer unattended.

**macOS:** CoreGraphics identifies the collector's WindowServer session and
AppKit/Accessibility report its foreground. SSH into the same logged-in account
can use these interfaces when available. The compiled helper cache is per-user,
shared by shell and GUI callers. A missing WindowServer or invisible fast-user
switching session is a capability gap, not proof of absence. Current collection
does not claim complete enumeration of every other macOS login session.

Browser attention uses the browser process's native destination context. CDP and
BiDi keep their existing identities; browser surfaces also carry session scope.
Native observation of another session does not by itself provide an action route
into it. Such native surfaces report background actions unavailable until a
session-capable driver is present. Protocol browser drivers can still act through
their verified endpoint. Unknown/metadata-only tab IDs remain non-lockable.

## Authenticated peers

Every host's private `instance/control.json` lists destinations it can reach.
For a remote host, configure `state_command` and `lock_command` to the destination's
installed Control scripts. All callers must reach the same per-user authority,
including local agents. A VM may use its host's authority; agents in the guest
must explicitly route there too before writing UI. Separate OS accounts must
also route to one authority; per-user default databases cannot coordinate each
other automatically.

`scripts/peer.py` can be used as an SSH authorized-key forced command with
`restrict`. It accepts only `control-state` and `control-lock`; arbitrary shells,
arguments and forwarding are rejected. Pin the destination's independently
verified SSH host key and keep the private key outside the portable archive.
Context calls return local state only, avoiding recursive peer collection.
Lock RPC uses JSON stdin. This pairs existing access; it does not enable a
disabled SSH server or grant OS/browser permissions.

For an existing QEMU Windows guest agent, a trusted `state_command` can invoke:

```bash
python3 scripts/vm/state.py --device VM --python GUEST_PYTHON --script GUEST_CONTROL_DESKTOP_PY
```

The installed guest script must be `scripts/desktop.py`. This is a fixed,
bounded observation route and does not acquire a mutation lease, avoiding a
state/lock recursion. Arbitrary guest commands continue through the fenced VM
helper. This collector does not install QEMU guest agent or restart a VM.

The OS interfaces are documented by [Microsoft WTS](https://learn.microsoft.com/en-us/windows/win32/api/wtsapi32/ne-wtsapi32-wts_connectstate_class),
[Windows session tokens](https://learn.microsoft.com/en-us/windows/win32/api/wtsapi32/nf-wtsapi32-wtsqueryusertoken),
[CreateProcessAsUser](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessasuserw),
[systemd logind](https://github.com/systemd/systemd/blob/main/man/org.freedesktop.login1.xml)
and [Apple WindowServer sessions](https://developer.apple.com/documentation/coregraphics/cgsessioncopycurrentdictionary%28%29?language=objc).
