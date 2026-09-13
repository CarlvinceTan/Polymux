# Browser integration

Use the user-named browser; otherwise resolve the OS default. Browser identity
is engine-neutral: Safari/WebKit, Firefox/Gecko, Chromium and unknown engines
can all be described. Identity discovery does not imply a controllable endpoint.

```bash
python3 scripts/browser/runtime.py default
python3 scripts/browser/runtime.py tabs
python3 scripts/browser/inventory.py --browser /ABSOLUTE/BROWSER --pid PID
python3 scripts/browser/inventory.py --browser /ABSOLUTE/BROWSER --pid PID \
  --protocol bidi --endpoint EXISTING_NEGOTIATED_WEBSOCKET_URL
python3 scripts/browser/setup.py check
```

Every inventory/check command is read-only and leaves normal browser launching,
profile, sessions, default handling and desktop integration unchanged. The old
idle-restart, debugging relaunch, Dock rewriting and default-app repair routes
have been removed. `setup` and `check` both diagnose available capabilities.
Neither installs components nor launches/reconfigures the browser. See [setup](setup.md).

## CDP

The built-in adapter reads a running Chromium instance's DevToolsActivePort,
verifies the listener belongs to its exact PID and is loopback-only, and checks
process birth. An explicit endpoint is also verified against the process.
Inventory reads page targets and parent window IDs, preserving tabs even when
an individual parent cannot be resolved. It does not activate or navigate tabs.
When browser attention matters it reads document visibility in an isolated world;
page focus alone is insufficient because the human may be using browser chrome.
Visible tabs in a foreground browser are conservatively protected where CDP
cannot distinguish focused native windows. Background targets remain independent.

No code silently enables debugging. Modern Chrome restricts debugging against
its normal default profile; a special profile or interactive browser permission
would conflict with an invisible normal-browser setup. Report the capability
that exists instead of changing the user's browser.

## Firefox / BiDi

`browser.inventory.bidi_inventory(call, app, instance, foreground)` works with
any driver's existing synchronous BiDi call function. It uses
`browsingContext.getTree`, `browser.getClientWindows`, and an isolated
`script.evaluate` for title/visibility. It never creates or ends a session.
The driver collector exposes its normalized snapshot through the provider
contract in [state.md](state.md).

A negotiated existing WebSocket endpoint can use the CLI adapter. Do not invent
`/session/ID` URLs or assume Firefox allows a second observer connection: a
session created directly over BiDi may remain available only through the owning
connection. In that case the owner publishes context through a provider bridge.
Control deliberately refuses the bare `/session` bootstrap endpoint during
inventory; `session.new` can alter browser behavior or trigger user consent.

Protocol selection uses capabilities and engine, not the page driver's brand.
Control includes no browser extension or extension service.

## Native metadata and other drivers

On macOS, the installed browser scripting dictionary selects the native collector
by capabilities, not an agent or browser brand. Compatible Chromium dictionaries
expose `title`, `URL` and the read-only `uniqueID` tab property. Safari exposes
`name` and `URL`, but no equivalent tab ID. The shared bundled JXA collector uses
bulk property reads across every scriptable open window, checks topology again,
and retains other tabs if a field/window disappears. It never selects a tab or
evaluates page JavaScript. Existing Automation consent is required.

Chromium's native IDs use `identity_namespace: applescript` plus process birth.
Duplicate IDs, changed topology and process restarts cannot produce exact tab
identities. Unknown selection stays unknown. These IDs allow leases independently
of CDP/BiDi, but the collector advertises observation only: a writer still needs
an integrated driver able to address the same native tab. IDs from another
protocol are not automatically equivalent. Native and protocol inventories may
both be returned as alternative views; never sum their counts as distinct tabs
or deduplicate by URL/title. `alternative_inventory` marks the additional rows.

Windows additionally reads UI Automation tab labels from browser chrome in each
observable WTS desktop session. Known address controls can supply a URL for the
unambiguously selected tab; background URLs remain explicitly unavailable. Linux
uses existing AT-SPI bindings and the verified desktop session bus when present.
Both collectors prune web documents, retain separate windows and duplicate labels,
use bounded reads, and never select tabs, enable accessibility, or install a
component. Accessibility rows are metadata only, without invented tab identities.
Per-window gaps and `url_status` distinguish missing metadata from an empty browser.
`title_source: accessibility_label` indicates browser decorations may accompany a title.
The default cross-device deadline is eight seconds, including a six-second guest
transport budget; native and protocol reads retain their tighter internal limits.
These native observations survive a later browser-protocol timeout.

On macOS, Gecko browsers without a scripting contract use the exact-window AX
backend. It reads the application role to initialize Gecko's lazy accessibility
interface and includes main/focused-window references when AXWindows is empty.
The native collector reads tab-strip labels and selection, prunes webpage content,
and reports unavailable URLs explicitly. Main/focused references are observation
handles only; they never select, raise, or focus a window. Zen 1.22b was verified
with two tab labels in its normally launched window; URLs were not exposed.
Firefox has no equivalent native AppleScript tab list. OS accessibility, session-recovery
files and history databases cannot establish a universally complete live tab
inventory. Do not install an extension, enable debugging, scrape recovery files,
or change the browser launch path to conceal a coverage gap.

### Coverage contract

`tab_inventory.status` is `complete`, `partial`, `unknown` or `unavailable`, always
interpreted with `scope`. Per-interface reports appear in `tab_inventories`:
`scriptable_open_windows`, `accessible_browser_chrome`, `cdp_connection`, or `bidi_session`. A complete scoped
read does not prove coverage of every profile, private context, inactive Safari
tab group, or another browser process. `whole_browser_complete` is false unless
that broader claim has separate authoritative evidence. Empty/missing providers
are not proof of zero tabs. Timeouts retain native context and mark tab coverage
unavailable. All snapshots are observations over time, not atomic browser freezes.

Compact state preserves coverage reports and separately reports display omissions.
`--full` removes display truncation only. `browser/setup.py check --require-complete`
returns exit 4 when complete whole-browser inventory is unproven. A task can thus
check its context requirement programmatically without a misleading successful
tab count. The normal check also reports exact-tab and application-scope locking
availability separately from observation, attention and action capabilities.

Any driver's collector can publish the [common state contract](state.md), including
on desktops where the built-in compositor adapter is unavailable. Only fresh,
exact identity and attention evidence can admit a tab lease. The explicit
[Agent-managed embedded browser exception](../SKILL.md#agent-managed-embedded-browser-exception)
allows direct provider-tab actions when attention is unknown or Control cannot
map the embedded tab; it does not assert that a tab lease was admitted. The collector must
be callable from each participating agent's authority; a live in-process driver
may need its owner to expose that read-only interface. Control cannot discover
arbitrary private agent sessions automatically.

Use the browser the user named, or its normal OS default. Reuse ordinary windows
and tabs when an available interface supports them. Do not start a separate
browser as an implicit fallback. If an operation lacks a route, continue useful
work through authorized APIs, CLIs or available native context and report only
the limitation relevant to the task. Installing a generic browser driver alone
cannot guarantee access to a browser that exposes no automation interface.

## Writer integration

Apply the [Agent-managed embedded browser exception](../SKILL.md#agent-managed-embedded-browser-exception)
before falling back to an app lease. For that route, use fresh in-app browser
metadata and the exact provider tab ID. Missing native mapping or unknown attention
must not force a broad host-app/window lease or an unnecessary user handoff.
All other browser routes follow the integration contract below.

Acquire the exact tab using the common app, process-birth instance, namespace,
and target ID. Retain ownership across parent-window moves and human edits.
Call `lock.py begin` immediately before each bounded background action and
`finish` after verifying its outcome. Integrate field/revision preconditions
inside the driver; do not overwrite changes found after a thinking pause.
Unmapped CDP/BiDi aliases conflict conservatively across the app instance.

When no exact tab route exists, use `lock.py acquire --kind app` with the exact
native app/process identity. This locks all agent work in that application
instance; it neither invents a tab ID nor requires a specific browser driver.
If the human is using that application, new broad admission is blocked. An app
lease does not turn an unavailable background operation into an available one.

Existing user tabs are not automatically closed, and groups are not rearranged
as part of control setup. Global mouse/keyboard injection, `bringToFront`,
`browsingContext.activate` and equivalent focus/selection APIs are outside the
background action contract, regardless of lease ownership.

## Verified protocol references

- [Chrome debugging restrictions](https://developer.chrome.com/blog/remote-debugging-port)
- [Firefox remote protocol preferences](https://firefox-source-docs.mozilla.org/remote/Prefs.html)
- [Firefox remote-agent security](https://firefox-source-docs.mozilla.org/remote/Security.html)
- [BiDi specification](https://www.w3.org/TR/webdriver-bidi/)
- [Firefox session and endpoint implementation](https://searchfox.org/firefox-main/source/remote/webdriver-bidi/WebDriverBiDi.sys.mjs)
- [Chromium native scripting identities](https://www.chromium.org/developers/design-documents/applescript/)
- [Firefox native tab scripting gap](https://bugzilla.mozilla.org/show_bug.cgi?id=939528)
