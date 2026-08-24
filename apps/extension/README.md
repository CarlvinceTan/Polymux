# FlareAI Agent Surface (browser extension)

The FlareAI equivalent of the ChatGPT desktop browser extension: it gives the
agent context about open tabs **and** lets it control a leased tab, with the
same in-page presentation contract as the original Hermes/Agent Surface
extension it descends from:

- Codex-style favicon badge on leased tabs (original favicon at 30% opacity,
  black cursor glyph with white 1.5 px stroke);
- the same cursor PNG at 23 × 24 px with 44° asset rotation and blue glow;
- spring-based fade, blur, rotation, compression, and stretch;
- short-distance scoot and bounded long-distance Bézier motion; and
- move-sequence arrival acknowledgement before the agent acts.

## How it works

- **Tab context** — the background worker streams the open-tab list (title,
  URL, active/pinned state; never page contents) through the
  `com.flareai.tab_context` native messaging host into
  `~/Library/Application Support/flareai-tab-context/tabs.json`, read by the
  agent's `browser_tabs` tool and the browser-use skill.
- **Control** — FlareAI runs a loopback agent-surface feed on
  `http://127.0.0.1:47654`. The background worker long-polls it, binds each
  lease to the exact tab it names (by URL, then title — never by position or
  recency), attaches `chrome.debugger` to that tab, and executes the lease's
  pending command over CDP. The agent drives this through its
  `browser_control` tool: `focus` a tab from `browser_tabs`, then act, then
  `release`.
- **Presentation** — the content script badges the leased tab and owns the
  cursor. Before any pointer command the worker asks it to animate the cursor
  to the target and waits for it to land, so the move-then-act sequencing
  holds even though the input itself is dispatched over CDP.

Control happens inside the page only — the extension never raises the browser
window, switches tabs, or steals the user's focus. Because CDP reaches an
unfocused tab, a leased tab is driven in the background while the user works
elsewhere.

## Commands

Every command lives in [`@flareai/browser`](../../packages/browser),
shared with the FlareAI in-app Browser, so both browsers answer the same set:
`snapshot` (accessibility tree with `[ref=eN]` handles), `read`, `screenshot`,
`get`, `console`, `network`, `eval`, `click`, `dblclick`, `hover`, `drag`,
`type`, `fill`, `press`/`keydown`/`keyup`, `scroll`,
`mousemove`/`mousedown`/`mouseup`, `check`/`uncheck`, `select`, `upload`,
`dialog`, `wait`, `back`/`forward`/`reload`. This extension adds the tab-level
ones — `tabs`, `tabNew`, `tabClose` — and the lease lifecycle.

`shared/` is a **symlink** to `packages/browser/src`, which is how
Chrome reaches the package without a build step in front of the extension. If
you copy this directory somewhere else, copy it with the symlink followed.

Targets are a `ref` from the last snapshot (preferred), a semantic locator
(`role` with `name`, `text`, `label`, `placeholder`, `testid`), a CSS
`selector`, or a viewport point — in that order of preference, because that is
the order in which they survive the page changing. Refs are reissued by every
snapshot, so one from an earlier snapshot is refused rather than resolved to
whatever now occupies that node. A click whose point is covered fails naming
the covering element instead of silently hitting the overlay.

Input is humanized rather than instantaneous: randomized in-box landing points,
a beat between arriving and pressing, per-character typing cadence with
occasional pauses, and accelerating/decelerating scroll. `pace: "fast"` is the
quickest profile that still reads as a person.

## The debugging infobar

Everything past click/type/scroll needs `chrome.debugger`, and Chrome shows
its "FlareAI Agent Surface started debugging this browser" bar on a tab for as
long as it is attached. The debugger attaches when a lease binds and detaches
on `release`, when the tab closes, or when FlareAI stops answering the feed —
so the bar is scoped to the work rather than left on. This is the same
trade the Codex extension makes; the alternative, shipping a separate browser
as Hermes did, gives up the user's logged-in session, which is the whole
point of running in their browser.

If another client already owns the tab (DevTools open, or another automation
extension), attach fails and the command says so — close DevTools on that tab
and retry.

## Install (macOS)

1. `chrome://extensions` → Developer mode → **Load unpacked** → this
   directory. Copy the extension ID.
2. `./install.sh <extension-id>` — registers the native messaging host for
   every Chromium-based browser it finds (Chrome, Brave, Edge, Arc, …).
3. Reload the extension. FlareAI must be running for control (the loopback feed
   lives in the app); tab snapshots work either way.

Browser security requires a person to approve an unpacked extension once.
There is no silent profile mutation or enterprise policy installation.

## Chrome Web Store releases

Changes to the packaged extension on `main` trigger
`.github/workflows/extension.yml`. The workflow requires a higher
`manifest.json` version, creates a ZIP with the shared browser sources copied
into it, uploads the package through Chrome Web Store API v2, and submits it for
review with automatic publication after approval.

Configure the GitHub `chrome-web-store` environment with:

- variable `CWS_PUBLISHER_ID`: the publisher ID shown under Developer Dashboard
  → Account;
- variable `GCP_WORKLOAD_IDENTITY_PROVIDER`: the full Google Cloud workload
  identity provider resource name;
- variable `GCP_SERVICE_ACCOUNT`: the service account email authorised for the
  publisher.

The workflow uses GitHub OIDC and Google Cloud Workload Identity Federation, so
it does not store a service-account JSON key.

Add that service account's email to the Chrome Web Store Developer Dashboard
publisher account. Google currently permits one service account per publisher.
The listing, privacy declarations, and public visibility must be completed and
published manually once before API releases can preserve that visibility.
