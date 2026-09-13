# Maintenance

Keep portable source, tests and examples user-, installation-, driver- and
agent-neutral. Personal device facts belong only in instance/control.json;
authentication and machine-specific helpers remain outside this skill. Never
copy credentials into source, fixtures or output. Runtime/cache/leases belong
in the shared per-user authority directory, not a per-agent skill checkout.

Read SKILL.md and the owning reference before changing a contract. The current
migration intentionally replaces: Chromium-only identity, locks disabled on
agent-owned devices, parent-window-dependent tab keys, installation-local lock
registries, automatic browser recovery and Dock/default rewriting. Do not
reintroduce those behaviors to satisfy an obsolete fixture.

Keep platform-specific code under scripts/macos, scripts/windows or scripts/linux.
The common JSON schema and coordinator remain independent of any agent/driver.
No empty package entry points, redundant launchers, unnecessary shebangs or
Python/Swift filename stems with more than two underscore/hyphen-separated words.

## Source layout

Keep each responsibility in its owning module:

| Responsibility | Source |
|---|---|
| Device state commands, caching, configured providers and diagnosis | `scripts/control.py` |
| Native platform dispatch and the browser-enrichment timeout boundary | `scripts/desktop.py` |
| Browser discovery, native/protocol merging and capability reports | `scripts/browser/context.py` |
| Browser identification, protocol inventory and existing endpoint discovery | `scripts/browser/__init__.py`, `inventory.py`, `runtime.py` |
| Browser setup/check CLI | `scripts/browser/setup.py` |
| YAML formatting, app filtering and compact/full display views | `scripts/output.py` |
| Native macOS tab collection and identity normalization | `scripts/macos/tabs.py`, `tabs.js` |
| Lease storage, live target resolution and session attention | `scripts/lock.py`, `surfaces.py`, `attention.py` |
| Native actions and OS/session details | `scripts/macos/`, `windows/`, `linux/` |
| Guest transport, lifecycle and coordination | `scripts/vm/` |

Collection code must not import a CLI module just to obtain formatting/reporting
logic. Rendering must not collect state, request permission, or touch locks.
Keep the existing CLI paths stable. `desktop.enrich`, `desktop.metadata`,
`setup.capabilities` and the rendering functions exported by `control` remain
import aliases for compatibility; there is only one implementation of each.
Older direct CDP helpers in `browser/runtime.py` remain for compatibility and
are not the ambient collection or lock-admission path. Do not fold those helpers
back into the current native/CDP/BiDi inventory.

Required validation for coordination changes:

```bash
python3 -B -m unittest discover -s tests -p 'test_*.py'
```

Use temporary registries and fake collectors in tests. Override both REGISTRY and
LEGACY_REGISTRY before any registry access; a migration test must never point at
the user's real old database. Test actual multi-process contention, tab movement,
process replacement, human acquisition/renewal distinctions, stale tokens,
uncertain action quarantine and conservative cross-provider conflicts. Test
bounded transports with real sockets, including EOF, fragmentation, ping,
oversized messages and streams of irrelevant events.

Keep fixture validation separate from live OS/browser evidence. Use independent
headless browser profiles or isolated desktops for mutations. Never mutate the
human's active surface merely to prove it is protected. Read-only live checks
may inspect the current attention signal and verify that acquisition is rejected
before any action. Verify normal browser identity/settings/process lifetime
remain unchanged across ambient reads. A technical test pass does not establish
support for every OS/compositor/browser/version or eliminate OS permission gaps.

SQLite coordinates cooperating clients on one authority host. Cross-host clients
use the stdin JSON RPC route. Test forwarding with values containing spaces and
shell metacharacters. Do not put the registry on a network share. An old code
copy using an undiscovered private registry cannot be fenced by this version;
upgrade/reroute every participant before claiming system-wide exclusion.

First-use tests must run without personal configuration or browser integrations,
verify conservative shared-device defaults on macOS/Linux/Windows, preserve
existing configuration, and distinguish metadata from exact actionable tabs.
Keep native/CDP/BiDi/provider fixtures independent of any agent brand. Do not
reintroduce browser extension installers or normal-browser lifecycle changes.
Never include runtime SQLite files, user URLs or personal configuration in
portable output.
