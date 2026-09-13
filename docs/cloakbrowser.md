# CloakBrowser Evaluation

Goal: run the in-app Browser on CloakBrowser (stealth Chromium fork, CloakHQ) so
agent browsing stops hitting bot detection, with no visible change to the
workspace tab UX. Everything outside the browser — windows, hub, drive, wechat,
updater — stays on Electron's bundled Chromium.

## 1. Current architecture (why this is separable)

- In-app tabs are `WebContentsView`s, one per tab
  (`apps/desktop/src/main/browser/embedded.ts`), driven over CDP through
  `webContents.debugger` (`browser/cdp.ts`). Electron 43.4.0.
- `@polymux/browser` (`packages/browser/src/`) is CDP-only with an injected
  transport. It speaks standard domains only — `Runtime`, `DOM`,
  `Accessibility`, `Page`, `Input`, `Network` — and contains no Electron calls.
  The same session type also drives the user's own browser via the extension's
  `chrome.debugger`.
- Agent tools depend on the 7-method `InAppBrowser` interface
  (`browser/embedded-tools.ts`: `tabs`, `openAgentTab`, `reveal`, `navigate`,
  `settle`, `pageInfo`, `session`, `close`) — not on `EmbeddedBrowser`. A
  Cloak-backed class implementing that interface plugs in with no agent-tool
  changes.
- No Playwright/Puppeteer at runtime (`@playwright/test` is dev-only, for UI
  tests). OAuth helpers use Electron partitions (`persist:polymux-comms-*`,
  `polymux-*-oauth-*`); `browser/import/chromium.ts` only *reads* external
  Chrome-profile dirs for cookie import, it never drives them.

## 2. What CloakBrowser is

Stealth Chromium fork: ~50–70 C++ fingerprint patches compiled into the binary
(canvas, WebGL, audio, fonts, GPU, TLS), drop-in Playwright/Puppeteer API, ~200MB
auto-downloaded binary via `npm`/`pip install cloakbrowser`, plus `cloakserve`
mode exposing a CDP endpoint for `connect_over_cdp()`. Fingerprint stealth
applies automatically over raw CDP; `humanize` input timing is a wrapper-level
feature that needs porting. It *prevents* CAPTCHAs (0.9 reCAPTCHA v3,
passing Turnstile, per vendor/independent tests) — it does not solve them, and
datacenter-IP reputation still applies (proxies + `geoip` alignment remain our
job). Wrappers are MIT; the binary ships under its own `BINARY-LICENSE.md` —
review before bundling.

## 3. Options evaluated

**Fork Electron onto Cloak's patches — rejected.** Electron's Chromium is
compiled in; there is no slot for another binary. A fork means a build farm
(3 OSes x 2 arches, hours per build), monthly three-way rebases (upstream x
Electron x Cloak) in browser-internals C++, owning Chromium CVE SLAs in an app
that holds cookies and locker secrets, new headcount outside the team's skill
set, plus a second patch set for Electron's own detectable surface (Cloak
patches Chromium, not Electron). Decisive point: the sidecar runs the *same*
binary, so detection sees identical fingerprints — a fork buys only visual
embedding, at the price of a standing browser team.

**Tauri / Wails — rejected (wrong direction).** Both are system-webview shells
(WKWebView / WebView2 / WebKitGTK) with no bundled Chromium and no engine
choice — the opposite of what this needs — plus effectively no agent-grade CDP.

**Sidecar with external window — viable fallback.** Cloak child process, visible
window ("automate what you can see"), workspace tab shows status + screenshot
stream + focus-for-takeover. Cheapest, but visibly different from today.

**Screencast-mirrored tabs — recommended.** The workspace pane keeps its exact
layout/chrome and hosts a canvas fed by `Page.startScreencast`; a transparent
overlay forwards input via `Input.dispatch*`. Reads/clicks/types feel identical;
agent session code is unchanged.

## 4. Mirror parity work (Electron convenience -> CDP equivalent)

- Input overlay with DPR/bounds mapping (`Input.dispatchMouseEvent/Key/Touch`,
  wheel); careful key-mapping and IME/composition passes.
- Custom context menu (`<select>` popups and native menus don't paint through
  screencast reliably).
- `Page.fileChooserOpened` -> Electron file dialog; HTTP auth and permission
  prompts routed to the existing prompt UI (`permissions.ts` patterns).
- Find bar via `DOM.performSearch`; zoom via `Emulation` metrics; print via
  `Page.printToPDF`.
- Viewport/mobile UA switching is portable as-is (`viewport.ts` logic over
  `Emulation.setUserAgentOverride` + device metrics).
- Agent cursor overlay: same scripts, delivered via
  `Page.addScriptToEvaluateOnNewDocument` instead of the Electron preload.
- Autofill: same one-credential invariant (`autofill.ts` logic), new injection
  delivery.
- Downloads: `Browser.setDownloadBehavior` + progress events into `downloads.ts`.
- Popup/window-open handling follows the existing deny-and-remap pattern.

Known, unfixable feel gaps (mitigate only): +50–200ms input latency (screencast
only on the visible tab, adaptive quality, pause when hidden — on-screen
tracking already exists); video-heavy pages cost more CPU at softer quality;
screen readers lose real web content (pixels, not AX).

## 5. New modules (`apps/desktop/src/main/browser/cloak/`)

- `launcher.ts` — binary resolve/download, version pin, per-task profiles under
  the instance-keyed `userData` (follow `main.ts` isolate conventions), remote
  debugging port, crash recovery, quit cleanup.
- `transport.ts` — websocket CDP client satisfying `CdpTransport`, with
  `Target.attachToTarget` multiplexing.
- `cloak-browser.ts` — `CloakBrowser` class implementing `InAppBrowser`
  (display pipeline + dialog/menu/download parity).
- Engine selection behind `POLYMUX_BROWSER_ENGINE=cloak|electron`; Electron
  view remains the fallback. OAuth popup flows (`cookie-login.ts`,
  `drive-consent.ts`) stay Electron initially; routing them through Cloak later
  may help Google's "browser not secure" stance on embedded flows.

## 6. Pre-commit checks

- Binary-license review, ~200MB download-or-bundle per platform, macOS
  Gatekeeper/signing for a third-party binary, update-feed and version-skew
  handling, Win/Linux/macOS parity.
- CDP-chatter audit per Cloak's reCAPTCHA guidance (no `waitForTimeout`-style
  traffic, prefer typed input over `insertText` before checks — note `input.js`
  currently uses `insertText` for typing — minimal `evaluate` pre-check).
- Managed-challenge handoff: "page needs you" path that focuses the Cloak
  surface for human takeover, plus proxy strategy.

## 7. Plan

1. **Feel spike (go/no-go):** launcher + transport + one hardcoded mirrored tab
   (screencast + input). Measure latency/fps/CPU (see section 8); try video,
   dropdowns, file inputs, right-click, IME.
2. **`CloakBrowserView`** behind the engine flag with the section-4 parity list.
3. **Harden edges**, then flip the default.

## 8. Mirror latency budget and minimization

Input→photon pipeline on localhost, typical costs:

| Stage | Cost | Notes |
|---|---|---|
| Overlay → main (IPC) | <2ms | negligible |
| Main → Cloak (CDP over ws) | 1–3ms | localhost; small JSON |
| Page handles input, composites | 0–16ms | same as any browser, not overhead |
| Screencast JPEG encode (Cloak side) | 5–20ms | scales with pixels × quality |
| Frame → main (base64 in CDP msg) | 2–10ms | 1080p/q80 ≈ 100–300KB + 33% base64 inflation |
| Decode + paint to canvas | 8–16ms | vsync-aligned |
| **Total added vs native** | **~30–80ms typical, up to ~200ms loaded** | |

Clicks and typing under ~100ms feel fine (RDP lives at 30–80ms and people work
in it all day). The pain is continuous closed-loop input — scroll-drag and
video, where every tick waits a round trip and motion feels spongy instead of
1:1. Agents are unaffected; this budget only matters for humans watching or
taking over.

Minimization checklist:

- **Ack frames immediately, paint mailbox-style.** `Page.screencastFrameAck`
  gates the pipeline — a late ack stalls everything. Ack on receipt, keep only
  the newest frame, drop stale ones. Never queue.
- **Screencast at exactly pane pixels.** `maxWidth/maxHeight` matched to the tab
  rect × DPR — no scaling work, no wasted encode bytes. Track pane resizes.
- **Adaptive quality.** Crisp (~q80, every frame) when idle; fluid (~q60) while
  scrolling or video plays; throttle hard when the tab is hidden (on-screen
  tracking already exists).
- **Keep Cloak's window alive but invisible correctly.** Minimized windows stop
  compositing on every OS — keep it full pane-size, positioned off-screen, with
  `--disable-background-timer-throttling`,
  `--disable-backgrounding-occluded-windows`, `--disable-renderer-backgrounding`.
  Verify actual fps off-screen; occlusion throttling is the classic silent
  killer.
- **Real GPU, verified.** Software compositing multiplies encode cost — check
  GPU status in the spike environment.
- **Open-loop input.** Fire `Input.dispatch*` immediately; never wait for a
  frame. Coalesce mousemove to latest-per-frame. Push model
  (`startScreencast`) strictly beats `captureScreenshot` polling.
- **Fast paint path.** `createImageBitmap` → canvas; avoid blob-URL churn per
  frame.

Spike instrumentation: timestamp at input event, timestamp at first frame
containing the effect. Report median/p95 for click, keypress, and
wheel-tick-to-scroll, plus Cloak-side and renderer-side CPU at 1080p. Pass bar:
click <100ms p95 and scroll acceptable in person. If scroll sponginess fails the
bar, the Windows `SetParent` upgrade path (section 3) is the fallback on that
platform.

## 9. Open questions

- Must agent tabs look embedded from day one (mirror now), or is a separate
  visible Cloak window acceptable for phase 1?
- Should agents default to Cloak, or escalate from the embedded view only on
  block signals?
