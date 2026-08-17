# Working on FlareAI

FlareAI is an Electron + Svelte 5 desktop app. `src/main` is the main process,
`src/preload` the bridge, `src/renderer` the Svelte UI, and `packages/*` the
workspace libraries the main process runs on.

**`CLAUDE.md` is a symlink to this file — opening either one opens this.** So
everything here is instruction rather than reference material: not background
reading, not guidance meant for some other tool's agent, but rules for you,
binding as written. A task is not done until it satisfies this file. Project
guidance worth keeping goes here, which is the only place it can go — there is
no second document to drift out of step with.

## Where main-process code goes

Only `main.ts` (the Electron entry) and `backend.ts` (the IPC surface) sit at
the top of `src/main`. Everything else belongs to a domain folder:

| Folder | Holds |
| --- | --- |
| `agent/` | the agent run surface, hooks, chronicle, run resources |
| `browser/` | the in-app browser, the extension, favicons |
| `communications/` | messaging accounts, the hub, email |
| `drive/` | cloud and local file providers |
| `homeserver/` | the Matrix homeserver and its bridges |
| `inference/` | providers, model catalog, key rotation |
| `mcp/` | the MCP registry |
| `scheduler/` | schedules and their calendar arithmetic |
| `skills/` | discovery, install, official and protected skills |
| `system/` | OS permissions, credentials, updater, dictation, window chrome |
| `workspace/` | workspace snapshots |

`backend.ts` is the IPC surface and holds the `DesktopBackend` class only. The
free functions it leans on live in `backend/`: `requests.ts` coerces untrusted
renderer payloads, `settings.ts` and `models.ts` read and fold preferences,
`host.ts` reads facts off the machine, `dto.ts` shapes run events. A new
handler that needs to validate a payload adds the coercion to
`backend/requests.ts` rather than to the bottom of `backend.ts`.

A domain's agent-tool definitions live inside it as `tools.ts`, not in a
separate top-level file. **Tests sit next to what they test** —
`src/main/skills/registry.test.ts`, not a shared `test/` directory — so a
folder is readable on its own. `npm run test:main` globs `**/*.test.ts`, so a
new test is picked up wherever it lands.

## Where renderer code goes

`src/renderer/lib` splits by feature, not by file kind. A feature owns its
components *and* the plain-TS modules only it uses:

- `features/chat/` — the chat pane and its parts, `markdown.ts`, `activities.ts`
- `features/workspace/` — the drawer and every `*View`, plus `taskStatus.ts`,
  `visitHistory.ts`, `agentSurfaceLeases.ts`
- `features/settings/`, `features/onboarding/`, `features/shell/`
- `shared/` — anything two features use: `components/` (`Icon`, `Menu`,
  `Tooltip`, the logo components), plus `layout/`, `options/`, `voice/`,
  `state/` and the small utilities (`theme`, `errors`, `qr`, `clipboard`,
  `scrollFade`)
- `api/` stays cross-cutting

The catalogs are data, not app code, so they sit outside `lib` entirely, at
`src/renderer/i18n/` with one file per language under `locales/`. They stay
TypeScript rather than JSON on purpose: each catalog is annotated
`const messages: Catalog`, which is what makes a missing *or misspelled* key
fail `npm run check` instead of shipping a blank string.

A module used by exactly one feature belongs inside it. When a second feature
starts importing it, move it to `shared/` rather than reaching across features.

## Verify the app still starts after every change

A change that type-checks and builds can still leave `npm start` on a blank
window — the renderer throws while mounting, or a stale dev instance holds the
single-instance lock. **Never end a task that touched app code without
confirming the app actually paints.**

Run, in order, and fix anything that fails before handing the work back:

```bash
npm run check && npm run renderer:build && npm run test:ui
```

- `check` — svelte-check + `tsc --noEmit`.
- `renderer:build` — catches import/compile errors the type checker misses.
- `test:ui` — Playwright builds the renderer, serves it, and asserts the app
  mounts. This is the real "not stuck on an empty page" gate: a renderer that
  throws on mount fails every test here, not just one.

Then launch the desktop app itself and confirm a window with content appears:

```bash
npm start
```

Watch the output. If the window is blank, check in this order:

1. The renderer devtools console (`View → Toggle Developer Tools`) — a throw
   during `mount()` in `src/renderer/main.ts` leaves `#app` empty with the error
   only in the console, never in the terminal.
2. A leftover dev app from an earlier `npm start`. `scripts/dev-start.mjs`
   retires these automatically; if you see `Retiring the FlareAI dev app...`, that
   was the cause. Kill any stray `node_modules/electron/dist/...` processes by
   hand if the window is still stale.
3. Main-process failures before `loadURL` — these print to the terminal.

Do not report a change as working on the strength of a green build alone, and
do not ask the user to check the window for you.

## One FlareAI at a time

Every dev run shares one userData directory, one single-instance lock, one hub
port (47664) and one Vite port. Two agents or terminals running `npm start`
against this checkout will fight: each launch retires the other's app, and the
window left on screen belongs to a run whose renderer is already dead. If the
app "keeps getting stuck", check for a second session first:

```bash
ps -axo pid=,command= | grep -E "electron/dist|electron-forge|vite" | grep -v grep
```

Do not start a second `npm start` while another one is up, and do not edit
`package.json`'s `start` script to call `electron-forge` directly —
`scripts/dev-start.mjs` is what clears the stale instance that causes the blank
window.

## Tests

Backend suites are per-package: `npm run test:backend` runs them all, or
`npm run test:agent`, `test:core`, `test:storage`, `test:protocol`, `test:main`,
etc. individually. `npm run test:ui` covers the renderer.

If a suite is already failing before your change, say so explicitly rather than
folding it into your own result.

## UI rules — apply to every UI change

These are defaults for every change, not requests to be asked for each time.
[DESIGN.md](DESIGN.md) is the long form with the worked examples and the styles
that already get each one right — read it before writing styles for anything
non-trivial, and check the result against it afterwards.

- **Centre on centre.** An icon, favicon, dot or avatar in a row is centred on
  the *text's* centre, not the row box's. Underlines go under the text only —
  never under the icon — and the icon's offset is cancelled so it stays on the
  text's centre line. Centre a menu or popover on the control it opens from.
  Icon-to-label gap ~8px; icons in the same strip are all one size.
- **Empty and loading states are centred** in the space they fill, both axes —
  not parked at the top-left. Exception: a small in-flow slot inside a stacked
  panel.
- **No stray chrome.** No border or box around an icon; a fallback glyph
  replaces a favicon rather than nesting inside it. No grey pill/circle on icon
  hover — the icon darkens. Row highlights stay inset, never touching a divider.
  Clickable text stays text. Dividers are not edge-to-edge. **No scrollbars
  anywhere.** Cut explanatory copy.
- **Scrollable lists** fade at top and bottom, and the fade at an edge goes away
  once scrolled hard against it. Menus never overflow: cap the height, scroll
  the rest, keep them on screen.
- **Text that does not fit** truncates with an ellipsis — no wrapping, no
  widening. Tooltips only when the text is genuinely truncated, never while that
  control's menu is open, ~1.5s delay on list rows.
- **Motion** cross-fades rather than cuts; a fade never doubles as a move;
  nothing shifts or blurs on hover; state animations stop when the state does.
- **Spacing** is uniform within a section and tight horizontally. Reuse an
  existing pattern exactly rather than styling a near-copy.

## Packaging and signing

`npm run package` builds the app into `out/`; `npm run make` also produces the
distributable. Both run `scripts/fetch-bridges.mjs` first, which downloads the
pinned mautrix binaries and verifies each against the sha256 published with it.
A checksum mismatch is fatal — a bridge is a child process with access to the
user's accounts.

Without an Apple Developer ID the build is **ad-hoc signed**. That is fine for
running a build on the machine that made it, and not fine for shipping:

- Gatekeeper refuses a downloaded app that is not signed and notarised.
- macOS keys permission grants to the signing identity, so an ad-hoc build asks
  for microphone, accessibility and full disk again after every update.

The configuration for both is already in `forge.config.ts` and switches on from
the environment — no edit needed when the certificate arrives:

```
APPLE_SIGNING_IDENTITY="Developer ID Application: Name (TEAMID)"   # signing
APPLE_ID=you@example.com                                           # + notarising
APPLE_ID_PASSWORD=abcd-efgh-ijkl-mnop                              # app-specific password
APPLE_TEAM_ID=TEAMID
```

Signing alone keeps permission grants stable; notarisation additionally needs
the three `APPLE_*` credentials and a round trip to Apple. Entitlements live in
`assets/entitlements.plist`, and every Mach-O in the bundle is signed with the
same identity — notarisation rejects a bundle holding an executable signed by
someone else, which the bridge binaries are when they arrive.

### Apple Silicon only, and not by choice

Every mautrix release publishes `<binary>-darwin-arm64` for macOS and nothing
else — the `amd64` and `arm` assets beside it are Linux builds. There is no
published macOS x86 bridge binary, so an Intel build cannot be assembled by
fetching different assets, and a universal build would not help either: it
would carry an x86 app slice with no x86 bridges behind it.

Both `scripts/fetch-bridges.mjs --arch=x64` and `npm run package -- --arch=x64`
therefore refuse outright, rather than producing an app that installs, opens,
and quietly has no messaging in it.

Supporting Intel means building the fleet from source for darwin/amd64 — a Go
toolchain, plus libsignal and libolm for the two bridges that need them — and
shipping binaries with no upstream checksum to verify against. That is a
deliberate decision about what FlareAI ships, not a build flag, which is why
nothing here quietly does it.

**So: state Apple Silicon as a requirement on the download.**
