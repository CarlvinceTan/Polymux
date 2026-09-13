# Coordination contract

All cooperating agents use one per-user registry on the device's authority host:
macOS `~/Library/Application Support/Control`, Linux `$XDG_STATE_HOME/control`
(default `~/.local/state/control`), Windows `%LOCALAPPDATA%/Control`.
Independent skill copies share this location. `CONTROL_RUNTIME_DIR` is an
absolute deployment/test override; all participants on an authority must agree.
Do not put SQLite on a network filesystem or create one registry per agent.

Locks are cooperative coordination, not a sandbox around arbitrary tools.
An unintegrated driver can bypass them. Integrate every writer with the same
identity namespace and begin/finish protocol; raw tool availability is no proof
that its operation participates in coordination or preserves foreground input.

The [Agent-managed embedded browser exception](../SKILL.md#agent-managed-embedded-browser-exception)
is an explicit, narrow alternative when Control cannot map an identifiable
embedded provider tab or its attention is unknown. Use that documented route
instead of seeking a broad native host-app/window lease. It does not relax
the coordinator's admission rules for other surfaces or permit bypassing a known
competing owner or unresolved operation.

## Identity and scopes

Use provider `device_id`, native `app_id`, process-birth `instance_id`, and exact
window/tab IDs. Chromium Apple Events tabs, CDP targets and BiDi contexts live in different namespaces.
Titles, URLs and tab indexes must never become resource keys. Metadata-only
surfaces cannot be acquired. Process birth prevents PID reuse after restarts.

On macOS, an application without a Launch Services launch date uses its kernel
process birth (`PID:bsd:SECONDS:MICROSECONDS`). Other applications retain their
existing identity. If a launch date appears or disappears later, mixed identity
forms for the same PID conservatively conflict across the application; they
are not assumed to identify different processes. An existing lease must still
match its exact live identity before another action can begin. This preserves
uncertain-action quarantine without rewriting existing leases.

A tab key excludes its parent window: moving the tab preserves ownership.
Refresh its parent before action. Different tabs in the same window can be
owned by different agents. An unverified cross-provider alias conservatively
conflicts across the whole application instance, preventing duplicate ownership
without pretending two unrelated ID formats have been reconciled.

`window`, `browser-window`, `app`, and `device` scopes also exist. Native windows
can be independent of other native windows. Broader browser/native operations
conservatively exclude the application instance because browser and native window
IDs are not universally mappable. A device lease conflicts with all its surfaces.
This intentionally trades concurrency for correctness on unmapped topologies.
When a driver can prove the browser instance but cannot map individual tab IDs,
a background app lease using exact native instance identity is a safe, broader
coordination fallback. It does not authorize global input or foregrounding.

## Commands

Use the same resource arguments on each command; tab parent IDs may change:

```bash
python3 scripts/lock.py acquire --device DEVICE --app-id APP \
  --instance-id INSTANCE --kind browser-tab --window-id WINDOW --tab-id TAB \
  --owner UNIQUE_AGENT_SESSION --ttl-seconds 900
```

The result contains a secret lease token and monotonically increasing fence.
Do not publish tokens. Multiple processes acquire atomically using SQLite. The
successful result is printed only after commit. TTL is 30–3600 seconds.

`renew`, `validate`, `release` take the resource arguments and `--token TOKEN`.
Renewal never tests human attention. `status` reports all conflicting leases;
`list` reports active leases for this authority, without secret tokens.

Keep a lease alive across lengthy work with the driver-side `lease.Heartbeat`
context manager or a managed background/tool session running:

```bash
python3 scripts/lease.py --token TOKEN --duration 3600 -- \
  --device DEVICE --app-id APP --kind browser-tab --window-id WINDOW --tab-id TAB
```

The keeper renews every 30 seconds, stops when ownership is lost, and is bounded
to one hour. It does not release on a thinking pause. Stop the keeper and release
when finished; if abandoned, its last renewal expires within two minutes after
the keeper ends. The keeper lifetime bounds orphan retention; it does not prove
that an agent remains alive. Never maintain an orphan keeper indefinitely.

## Action fencing and human edits

1. Resolve the exact live surface and the narrow expected values/revision.
2. `lock.py begin RESOURCE_ARGS --token TOKEN` verifies current identity,
   extends the lease, and returns `lock.operation`. It deliberately does not
   re-run human-attention admission. Only one operation can be in flight under
   a token. A closed/replaced target fails identity validation.
3. Dispatch a bounded, non-activating action to that exact target. Pass the
   operation/fence into an integrated driver; never retry a dispatched action
   solely because its reply timed out.
4. `lock.py finish RESOURCE_ARGS --token TOKEN --operation OP --outcome verified`
   completes a confirmed result. Use `not-applied` only with evidence that it
   did not execute. `unknown` quarantines the operation, blocking takeover and
   further dispatch even after TTL expiry.
5. Reconcile an uncertain operation from authoritative application state, then
   finish the same operation as `verified` or `not-applied`. No automatic force
   unlock exists: expiry cannot prove that a remote action stopped executing.

`window.py` enforces this sequence around its backend. VM helpers fence the
whole requested guest operation. A generic driver must enforce it at dispatch;
validating a token once before a long script is insufficient.

`surfaces.check_preconditions(expected, actual)` returns only conflicting keys.
Native `set-value` compares the observed field value at the backend immediately
before writing. These are optimistic checks, not a universal OS/database
compare-and-swap: a human can type during the tiny read/write interval. Use a
native conditional-write API where one exists and re-read the result. Arbitrary
rich text and simultaneous character-level edits are not automatically merged.

## Cross-host routing and migration

A non-local device declares `lock_command`, a full argument array that reaches
its single authority's `lock.py serve` command, normally through authenticated
SSH. The caller sends JSON `{ "arguments": [...] }` on stdin; arguments are not
interpolated into a remote shell. Responses are ordinary lock JSON. Authorities
have their own matching device configuration. The server rejects forwarding
loops. Remote devices without a route fail closed rather than coordinate in a
second local database. The same rule applies to guest devices controlled from
several physical hosts.

On first registry access, this installation's old version-3 database is locked,
its active leases imported conservatively across their device, and a forwarding marker written that
makes old code fail closed. Existing old leases can be released with their token;
legacy leases have no process-birth proof and must be reacquired before new
fenced actions. Do not run older unregistered copies concurrently: the new
registry cannot discover arbitrary old registries elsewhere on disk.

An admission snapshot is bounded and fresh but cannot atomically lock the human's
OS attention. It is an acquisition-time observation, not an ongoing prohibition
on human use. All actions must independently preserve global input/focus.
