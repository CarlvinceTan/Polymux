---
name: control
description: Collect compact ambient device, app, window and browser context at task start. Coordinate exact surfaces across agents with shared leases, acquisition-only human attention checks and background actions. Independent of agent and browser driver.
---

# Control

At the start of every task run once:

```bash
python3 scripts/control.py state
```

This is ambient routing evidence, not authorization to read unrelated content or
operate anything. If the task does not involve a device or interactive surface,
use no further Control commands. Do not report unrelated availability warnings.

## Working autonomously

1. Prefer an authorized connector, API, CLI or remote shell when it covers the task.
2. Resolve the exact device and surface from current provider IDs. Titles, URLs,
   positions and list order are context, never identity. Narrow context with
   `state --device DEVICE --app-id APP --full --json --fresh` when needed.
3. Observation is lock-free and must not activate, select, scroll or navigate.
4. Acquire a lease before UI mutation on **every** device, including agent-owned
   desktops. The coordinator resolves live identity and checks current human use
   on shared devices, using the destination’s current sessions. Unknown identity
   or attention blocks new acquisition, except for the agent-managed
   embedded browser route below.
5. Use a background action route bound to that exact surface. Before dispatch,
   enter an action fence with `lock.py begin`; finish it only after checking the
   outcome. `window.py` does this automatically. Browser drivers use the same
   protocol in [coordination.md](references/coordination.md).
6. Keep the lease while thinking, researching, waiting or accepting human help.
   Renew it or run the bounded `lease.py` keeper. Release on completion, explicit
   abandonment or transfer. An expired/released lease requires new admission.
7. Verify the task's actual result. A dispatched click or changed dialog is only
   an intermediate observation. Never replay an uncertain action automatically.

## Working alongside the human

### Agent-managed embedded browser exception

For an authorized task, assume an identifiable embedded browser surface is usable
when human attention is unknown if the host application exposes it through an
agent-facing tool bound to that surface. Establish this from fresh provider
metadata and tool capabilities, independently of the application or vendor name.
Resolve the exact provider surface ID in the current task/session and read the
current page before acting. An ambient URL, title, or native window alone is
insufficient; an application calling itself agentic is not evidence of this route.

Use the tab-bound browser tool directly. If Control cannot map that provider's
embedded tab or returns `human_attention_unknown`, do not block, ask for extra
permission, or attempt a broad native host-app/window lease as a substitute.
When the tab cannot be represented by Control's coordinator, this route is exempt
from its lease and action-fence commands; retain any available provider ownership
coordination and serialize actions on the exact tab. Do not claim a Control lease
was acquired. A mapped route should retain normal leases and fences when usable.

This exception covers unknown attention and missing native-to-embedded-tab mapping
only. It does not override a known competing owner, an unresolved dispatched
action, explicit human editing of the same control, or an instruction to stop.
Recheck the relevant page/field before each mutation and verify its outcome.
Do not infer that the human is absent or set the whole device to agent-only.
Keep actions within the tab without global input or native-window focus changes.
Normal task authorization and confirmation requirements still apply. External
browsers, native host-application windows, and other apps retain the normal admission rules.

### Shared desktop surfaces

`user_active: true` means potentially shared, not “the human is currently here.”
Use it for computers the human might use directly or through remote desktop.
State discovers runtime sessions; there is no single globally active computer.
A local desktop and a remote RDP desktop can both have protected active surfaces.
Never infer destination attention from the machine running the agent, SSH's lack
of a display, a service's empty desktop, or idle time. Only positive absence
information can relax admission automatically. `user_active: false` is reserved
for an explicitly dedicated agent device and still requires agent leases.
See [Sessions and peers](references/sessions.md).

A **new** lease cannot target the human's focused native window or the selected
page in their focused browser window. A known background tab can be admitted
through a non-activating route. When a provider cannot distinguish windows or
selection reliably, admission is conservative.

Once leased, the human may observe, select, navigate or edit that surface. This
never revokes the lease or re-runs attention admission during renewal or the
next action. Revalidate identity and the small piece of content the next action
depends on. A changed field is a conflict for that field; unrelated human edits
are not a reason to pause the whole task. `window.py set-value` requires the
last observed `--expected-value` and checks it on the exact control before writing.

Never move the pointer, issue global keystrokes, activate/raise a window, select
a tab, steal focus or restore an old foreground app over the human's current
choice. An existing lease does not grant those capabilities. Use semantic
background operations only when their application behavior fits this constraint.
An application can itself open/focus a dialog in response to a semantic action;
do not describe arbitrary native applications as having an absolute OS-enforced
non-activation guarantee. Prefer a direct backend for such operations.

For a step only the human can complete, leave the prepared surface available,
retain coordination, request only the necessary step and resume from live
completion evidence. Human help does not require releasing/reacquiring the lease.
Task authorization governs sends, submissions, deletion and other consequences;
Control never grants additional authorization.

## Context and browser integration

State and browser diagnosis are read-only. They never install extensions, start
or restart a browser, add debugging flags, create a profile, change the default
browser, rewrite Dock/taskbar entries or request OS/browser permissions.
Use the named browser, otherwise the current OS default. Normal browsing and
normal launching remain unchanged.

When a task needs a missing macOS permission, prepare the named **Control Skill**
app using [macOS permissions](references/permissions.md), then request only that
capability through it. New consent should belong to Control Skill, not Terminal,
Python or a particular agent. The human must approve macOS consent; never reset
or rewrite privacy permissions. Keep existing routes until the named app is
approved and explicitly enabled, so ongoing agents are not interrupted.

The common surface schema works with native metadata, CDP, Firefox BiDi and
external driver providers. Control bundles no browser extension, extension
installer, browser service or mandatory page driver. The coordinator depends
on capabilities and exact identities, not an agent brand or driver implementation.

A clean installation uses the local hostname and treats the desktop as shared
with the human automatically. No configuration file or existing integration is
required for built-in ambient context and coordination. An explicit configuration
can add devices and driver collectors. `python3 scripts/browser/setup.py setup`
and `check` diagnose the currently available browser capabilities; both leave
the browser and configuration unchanged. See [Setup](references/setup.md).

Collect browser tabs across every configured, reachable device and every window
exposed by its available interfaces. Desktop collection combines native scripting,
existing browser protocols, and read-only accessibility where supported. Gecko on macOS and browser
accessibility on Windows/Linux may expose only tab labels; use `url_status` and per-window
coverage to explain missing URLs or tabs. An unsupported phone, inaccessible
browser/session, or offline device is a capability gap, never proof of zero tabs.

Native scripting can provide useful titles/URLs without a debugging session where
an OS/browser supports it and permission already exists. Compatible macOS Chromium
interfaces also expose exact tab IDs through Apple Events. Safari's tab indexes
remain metadata only. Choose exact tab coordination when available; otherwise an
exact application lease serializes cooperating agents without a browser protocol.
It still needs safe admission and a supported background action route.

Check `tab_inventory` and its scope before calling any list complete. `--full`
removes display truncation; it does not add missing browser access. Interface
coverage is separate from all profiles/private contexts/inactive tab groups.
Stay extension-free and report gaps; never read browser recovery/history files
as if they were a complete live tab list. `browser/setup.py check --require-complete`
exits unsuccessfully unless whole-browser coverage is positively established.
CDP requires an already reachable endpoint;
BiDi uses the driver's existing session. An unavailable endpoint stays an explicit
capability gap. There is no silent, universal attachment mechanism for all normal
browsers on all operating systems.

Read only the reference needed for the current operation:

- [State and provider schema](references/state.md): compact/full context, freshness,
  configured collectors and partial capabilities.
- [Coordination](references/coordination.md): lease commands, action fences,
  heartbeat, tab moves, broader scopes and cross-host authorities.
- [Browsers](references/browser.md): CDP/BiDi adapters, native metadata, driver integration.
- [Windows](references/window.md): exact native actions and field preconditions.
- [Dialogs](references/dialogs.md): exact buttons, borrowed leases and verification.
- [Setup](references/setup.md): portable installation and diagnostics.
- [macOS permissions](references/permissions.md): the named Control Skill app, explicit consent and activation.
- [Sessions and peers](references/sessions.md): runtime attention across local, SSH and RDP sessions.
- [Maintenance](references/maintenance.md): source boundaries, migrations and tests.

## Remote devices and VMs

Use configured device routes directly; local viewers are separate local surfaces
that also require coordination before interaction. Power commands remain
`power.py status|wake|sleep --device DEVICE`. Task-required waking is permitted;
sleep needs the requested outage. Verify actual reachability, not packet delivery.

VM helpers use the configured libvirt domain and host. Prefer `vm/qga.py` for
commands and `vm/libvirt.py` for status, screenshots and guest input. Mutations
require an owner and use a device-wide fenced lease; status/screenshots are
observations. Route all clients for a remote/guest device to the same lock
authority. These guest operations never authorize controlling a local viewer.

## On Polymux

Control ships as a bundled Polymux core skill alongside `window-control`
and `computer-history`. The division is fixed:

- Control owns coordination logic and context: the rules above, plus
  `python3 scripts/control.py state` for the compact live inventory of
  devices, apps, windows, and tabs. Prefer it over any other surface
  snapshot when resolving what is open and who may act on it.
- `window-control` owns exact native-window operation on this host: the
  exact-window controller, the host window lease registry, and the compiled
  route registry. Its controller acquires and renews the exact-window lease
  itself in the registry that Polymux's menu-bar indicator displays, so every
  held lease is visible to the user. Do not take a separate coordinator lease
  for a window that route has already leased; the route's lease satisfies
  Control's admission for it.
- `computer-history` owns past screen-work retrieval: what the user was doing
  before they switched. Use it only when the relevant current surface is
  closed, changed, or otherwise unresolved.

- Run this skill's scripts from its own directory, for example
  `python3 scripts/control.py state`.
- Pass `--owner "$POLYMUX_RUN_ID"` when a lease or owner is requested, so
  coordination stays attached to the current run.
- Polymux's in-app Browser is an agent-managed embedded browser under the
  exception above: use its tab-bound browser tools directly; native host
  windows and external browsers keep the normal admission rules.
- The extension-backed `browser_control` currently supports reads only. Its
  session does not establish Control admission; mutation remains blocked until
  an exact-surface provider integration is available. Use a Control-admitted
  browser provider for existing-tab actions.
