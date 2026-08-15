# Midas Agent Surface (browser extension)

The Midas equivalent of the ChatGPT desktop browser extension: it gives the
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
  `com.midas.tab_context` native messaging host into
  `~/Library/Application Support/midas-tab-context/tabs.json`, read by the
  agent's `browser_tabs` tool and the browser-use skill.
- **Control** — Midas runs a loopback agent-surface feed on
  `http://127.0.0.1:47654`. Content scripts long-poll it; a tab whose URL or
  title matches an active lease badges itself and executes the lease's pending
  command (`navigate`, `click`, `type`, `scroll`, `read`), animating the
  cursor to the target before pointer actions and posting the result back.
  The agent drives this through its `browser_control` tool: `focus` a tab from
  `browser_tabs`, then act, then `release`.

Control happens inside the page only — the extension never raises the browser
window, switches tabs, or steals the user's focus.

## Install (macOS)

1. `chrome://extensions` → Developer mode → **Load unpacked** → this
   directory. Copy the extension ID.
2. `./install.sh <extension-id>` — registers the native messaging host for
   every Chromium-based browser it finds (Chrome, Brave, Edge, Arc, …).
3. Reload the extension. Midas must be running for control (the loopback feed
   lives in the app); tab snapshots work either way.

Browser security requires a person to approve an unpacked extension once.
There is no silent profile mutation or enterprise policy installation.
