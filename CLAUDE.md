# Working on FlareAI

Electron + Svelte 5 desktop app. **`AGENTS.md` is a symlink to this file.**
Everything here is binding instruction, not reference. Project guidance worth
keeping goes here — there is no second document.

## Layout

| Path | Holds |
| --- | --- |
| `apps/desktop/` | `src/main` (main process), `src/preload`, `src/renderer` (Svelte), Forge/Vite configs, icons |
| `apps/extension/` | browser extension + native messaging host |
| `packages/` | agent · browser-use · core · chronicle · drive · hub · inference · protocol · storage · tools |
| `resources/` | `skills/`, `native/`, `bridges/` — one `extraResource` entry, read via `bundledResource()` |
| `scripts/` | dev launcher, bridge fetch, icon build, update publishing |

One `package.json`, at the root. Paths in `apps/desktop/forge.config.ts` are
relative to the root because Forge runs there (`config.forge` points at it).

## Main process

Only `main.ts` (entry) and `backend.ts` (IPC surface) sit at the top of
`apps/desktop/src/main`. Everything else belongs to a domain folder: `agent/`,
`browser/`, `communications/`, `inference/`, `mcp/`, `plugins/`, `reminders/`,
`scheduler/`, `skills/`, `system/`, `workspace/`.

- `backend.ts` holds the `DesktopBackend` class only. Free functions live in
  `backend/`: `requests.ts` (coerce untrusted renderer payloads), `settings.ts` /
  `models.ts` (preferences), `host.ts` (machine facts), `dto.ts` (run events).
  A new handler's payload validation goes in `backend/requests.ts`.
- A domain's agent-tool definitions live inside it as `tools.ts`.
- **Tests sit next to what they test** (`skills/registry.test.ts`). `npm run
  test:main` globs `**/*.test.ts`.

A domain that owes nothing to Electron is a package; only its seam stays in the app:

- **`@flareai/hub`** — the whole embedded Matrix hub (homeserver, bridge fleet
  supervisor, WeChat bridge, `MatrixHub`, email accounts, media urls, wechat relay
  probe). Electron-free by construction; tests run under plain Node
  (`npm run test:hub`). Electron seams stay in the app: `communications/media.ts`,
  `communications/cookie-login.ts`, the `Communications` service. Add hub logic to
  the package.
- **`@flareai/drive`** — the `Drive` manager, local/S3/Google/Dropbox/OneDrive
  adapters, OAuth client, agent drive tools. One seam: `DriveConsentPrompt`,
  implemented by `system/drive-consent.ts`. The package runs the whole OAuth flow
  (PKCE, loopback listener, state check) and asks the host only to show a URL. A
  new provider is an adapter and touches nothing in `apps/`. Storage, secrets and
  file pickers are injected (`npm run test:drive`).

### Drive rules

- **Every call goes through `request()` in `http.ts`** — per-attempt timeout,
  retry on 408/429/5xx, `Retry-After` in either spelling, backoff with jitter, cap
  past which a stated wait fails rather than hangs. Odd rate limits add a hook
  (`retryable`, `retryAfter`), never their own loop — Drive reports rate limiting
  as **403** with the reason in the body; Dropbox states the wait in the JSON.
  Never call `fetch` directly.
- **Never read a whole file to upload it.** Past `SIMPLE_UPLOAD_LIMIT` use
  `uploadInChunks`, which holds one chunk in memory and resumes from the offset the
  *provider* reports.
- **Writes are keyed by destination.** Runs are parallel (`#activeRuns`); mutations
  go through `locks.run()` from `@flareai/core`, keyed `drive:<source>:<path>` —
  never the account. `createFolder` holds the key across its listing too. Reads,
  listings and downloads take no lock.
- **A write the run read first is conditional on what it read.** `drive_read`
  records the provider's version token; `drive_write` passes it as `ifMatch`. A
  conflict is reported to the agent as re-read-and-merge, and the stale expectation
  is dropped so the retry isn't doomed. A file never read is written
  unconditionally. Only `local` and `s3` set `conditionalWrites`.
- **`upload` does not replace on Google, Dropbox or OneDrive** (POST-new,
  `autorename`, `conflictBehavior=rename`), so a second write yields `report (1).md`.
  Nothing can be lost, hence no version token. Fixing it means finding the entry by
  name and updating in place; each then gains `conditionalWrites` with its own token
  (Dropbox `mode: update` + `rev`, Graph `If-Match` on eTag, Drive compares `version`
  inside the lock).
- **A deliverable goes to the drive by default.** `drive_write` takes no `source`
  ordinarily: it resolves to `all`, walking the user's save order. A named source
  always wins. Scratch/intermediate files stay on local disk.
  `Drive.promptContext()` assembles from the last published status and stored order,
  never by probing.
- **Cloud accounts reach FlareAI's own folder only** (Google `drive.file`, Dropbox
  and OneDrive app-folder scopes), while `local#home` is all of `~` and S3 the whole
  bucket. Widening needs a CASA assessment / app re-registration, so the agent is
  told the boundary instead.
- **`all` is a view, not a backend.** `VirtualDrive` stacks connected sources; it
  can't be connected, stays out of the save order and Settings, and a virtual path is
  `<sourceId>/<path>` (source ids carry no slash). **No index** — every listing asks
  the providers.
- **A path is not a name.** Ask the adapter via `describe()` rather than
  `basename`. A Google Doc has no bytes: export it to its editable equivalent.
- **Downloads go through `downloadToFile`** — writes a `.partial`, renames only once
  bytes match the stated size and hash; a broken stream reopens with `Range`. No hash
  is a fair answer; silently skipping a published one is not.

### `plugins/`

**A plugin is installed and listed whole.** Its skills go to the agent's loader
only, never the Skills tab; its MCP servers are configured under
`plugin:<plugin>:<server>` which the MCP tab filters out. A name clash is reported
on the plugin's card and resolved in the plugin's favour, never silently dropped.
Commands, agents and hooks are counted and labelled unsupported, not half-loaded.

Basic mode shows Plugins, hides MCP and Skills; advanced shows all three. A new tab
picks its side deliberately. Plugins/MCP/Skills are tabs *inside*
`SettingsPage.svelte` — same rail, search, filter/sort, storefront, plus button — not
components beside it. Hub, Drive and Browser are components because they aren't lists
of one kind of thing. A locally chosen plugin folder is filed under a `local`
marketplace, which exists only while it holds something.

## Renderer

`apps/desktop/src/renderer/lib` splits by feature, not file kind. A feature owns its
components *and* the plain-TS modules only it uses:

- `features/chat/` — chat pane, `markdown.ts`, `activities.ts`
- `features/workspace/` — drawer, every `*View`, `taskStatus.ts`, `visitHistory.ts`, `agentSurfaceLeases.ts`
- `features/settings/`, `features/onboarding/`, `features/shell/`
- `shared/` — anything two features use: `components/` (`Icon`, `Menu`, `Tooltip`, logos), `layout/`, `options/`, `voice/`, `state/`, and small utilities (`theme`, `errors`, `qr`, `clipboard`, `scrollFade`)
- `api/` is cross-cutting

A module used by one feature lives inside it; move it to `shared/` when a second
imports it, never reach across features.

Catalogs are data: `apps/desktop/src/renderer/i18n/locales/`, one file per language.
They stay TypeScript — each is annotated `const messages: Catalog`, which makes a
missing or misspelled key fail `npm run check`.

## Running the app

**Never run `npm start`** — it owns the ordinary userData directory, its
single-instance lock and hub port 47664, and a second run retires the user's session.

```bash
npm run isolate
```

`npm start -- --isolated[=name]`. `FLAREAI_DEV_INSTANCE` keys its own userData dir
(`…/FlareAI-side`), its own homeserver port (derived from the name), and its own
`~/.flareai-<name>`. Vite picks a free port.

- **Run it in the background** — it's long-running, and blocking stalls the turn.
- **Never bring it to the front.** Drive and verify it behind the user's window
  (screenshots, logs, renderer are all reachable). Surface it only when asked.
  Stop it when done.
- A side instance starts empty (settings, keys, chats, hub, skills) — reuse a name
  (`--isolated=review`) to keep state.
- Both runs build into the same `.vite`.

Nothing in the main process joins `".flareai"` itself — use `flareaiHome()` /
`flareaiPath()` in `system/paths.ts`, not another `homedir()` join.

**Replace a file under that home with `writeFileAtomicSync()` from `@flareai/core`,
never `writeFileSync`.** Bytes go to a *sibling* temporary and are `rename`d over the
destination, so a reader sees the old file or the new one. The sibling is deliberate:
`rename` is only atomic within a filesystem.

`npm start` reads `.env` from the repo root (OAuth client ids for Drive, Dropbox,
OneDrive in development). Git-ignored, never packaged, environment wins. Add new
variables to `.env.example` too.

## Driving a page

Two browsers, **one command set**, in `@flareai/browser-use`. Add a capability there
and both surfaces gain it. The package speaks nothing but CDP; each surface supplies a
transport:

| Surface | Transport | Lives in |
| --- | --- | --- |
| in-app Browser | Electron `webContents.debugger` | `browser/cdp.ts`, per tab via `EmbeddedBrowser.session()` |
| user's browser | `chrome.debugger` | extension `lib/cdp.js` |

`browser/commands.ts` holds one description, schema and validator, so `browser` and
`browser_control` offer the same actions under the same names. Only tab ownership
differs (workspace tabs vs. tab leases).

The package is **plain JavaScript, not TypeScript** — Chrome loads the files it is
pointed at, so a build step would mean `apps/extension` is no longer the directory you
load. `apps/extension/shared` symlinks to `packages/browser-use/src`. `tsc` still
checks it (`allowJs`, JSDoc types).

### Easy to undo by accident

- **Commands execute in the extension's background worker, never the content script.**
  `background.js` binds a lease to the exact tab, attaches the debugger, runs the shared
  handlers. `content.js` is presentation only (favicon badge, cursor); the worker asks it
  to animate to a target and waits before dispatching input.
- **The debugger is scoped to the work** — attaches when a lease binds, detaches on
  release, tab close, or FlareAI going away. Do not widen it to unleased tabs. The in-app
  Browser has no infobar; its session dies with its tab.
- **A lease is pinned to a tab id once resolved**, never re-matched by URL.
- **The cursor is a follower, not a gate.** Presentation never blocks execution. Three
  parts make that work:
  - **`observed()`** — each surface answers whether a person is plausibly looking (in-app:
    window focused and this tab on screen; extension: leased tab active in a focused
    window). Only then is an action held back. Unwatched work never waits — **2.1× faster**.
  - **A capped wait** (`CURSOR_WAIT_CAP_MS`) even when watched. A surface that can't
    answer `observed` is treated as watched.
  - **Retargeting, not queueing** — a move issued mid-flight supersedes the last and
    settles its waiter.

  The cursor starts as soon as the target point is known, overlapping the covering-element
  round trip. It stays armed for the life of the session. Handlers call
  `session.moveCursor(point)`, which never rejects and is never required; `restCursor` is
  never awaited.
- **Travel pace is one knob**, `DEFAULT_TRAVEL_SCALE` in `cursor-motion.js` (default 1.9,
  ~0.31s across the viewport; the inherited pace of 1 is ~0.2s and reads as hurried).
  `createRenderer` takes a `travelScale` override.
- **Measuring pace has one trap:** the first move after a renderer is created teleports.
  Warm the renderer, await arrival, time the *next* move — `live.test.ts` does this and
  asserts a slower scale is slower.
- **While typing, the cursor retires to the field's bottom-right corner**
  (`restingPoint`) so it doesn't cover the text. Never aim a *click* there — clear button,
  password reveal and search submit live in that corner.
- **`snapshot` is how a page is seen** — accessibility tree with `[ref=eN]` handles,
  reissued every snapshot so a stale ref is refused. Target preference order: ref, semantic
  locator (`role`/`text`/`label`/`placeholder`/`testid`), CSS selector, coordinates.

## Chronicle

`@flareai/chronicle` records two streams under one policy. **Frames** are accessibility
text snapshots of the frontmost window; **events** are what the user did (app switches,
clicks, chords, typing bursts, scrolls). Activity questions are the events' to answer.

- **Keystroke content is never recorded.** A chord is named (it is the action); an
  ordinary key is only counted. No path through `ax-events.swift` emits a character, and
  the same goes for a text field's *value* when describing a click target.
- **The tap is listen-only** — it must never swallow or alter an event.
- **One policy, one place:** `ChronicleManager.allows()` judges frames and events alike.
  The frame source and event seam filter nothing.
- **Defaults record** (policy `all`, private browsing recorded, events on). Narrowing is
  the user's act, in Settings → Memory.
- **Private-browsing detection is best-effort** — the only signal is localized text in the
  window title. Do not present it as a guarantee.
- **Distillation is what outlives the capture.** `ChronicleDistiller` folds the finished
  window into durable memories before retention deletes frames, and moves `state.json`'s
  watermark whether or not anything was kept. Runs before consolidation.
- **The agent reaches Chronicle through tools** — `search_screen_history` and
  `read_screen_history` over `ChronicleAccess`. Reading and nothing else.

Swift helpers (`ax-reader.swift`, `ax-events.swift`) compile on demand, cached by source
revision through `system/swift-helper.ts`, and run as children of the app so the
accessibility grant is FlareAI's.

## Driving a native window

The `gui-control` core skill ships `scripts/exact-window-controller.swift` — lists
windows, captures one, inspects its accessibility tree, performs `press` and `set-value`.
It works through accessibility, so it never moves the real pointer and never activates the
app. `system/native-cursor.ts` therefore draws the shared overlay in a transparent,
click-through, non-focusable window over the target's frame; `inspect` reports a `frame`
per control for this. Keep the overlay presentation-only — never take focus, swallow a
click, or prevent an action.

## Permissions

**The app's own** (microphone, screen recording, accessibility, Full Disk Access) are
Electron's to read and prompt for, and each is a Settings row whether used or not.

**A skill's** (Reminders, Calendars, Contacts, Photos, controlling another app) go through
`resources/native/app-permissions.swift`, compiled and cached like the accessibility
reader. Two things make its answer FlareAI's: usage descriptions linked in as an
`__info_plist` section (macOS kills a process touching a privacy class without one), and
running it as a child of the app so TCC attributes the grant to FlareAI. Running it from a
terminal grants the terminal and tests nothing.
`PERMISSION_USAGE_DESCRIPTIONS` in `system/permission-usage.ts` is the one place those
sentences are written; `forge.config.ts` reads the same record.

**A dev run cannot show one of these prompts — not a bug to chase.** macOS attributes a
request to the *responsible* process, which for a terminal-launched app is the terminal,
so `npm start` / `npm run isolate` are refused silently. Verify in a packaged build.

**A skill declares what it needs in its own frontmatter** (`permissions: reminders`), read
at load, so nothing anywhere keeps a list of skill names. Adding a grant = a member of
`APP_PERMISSION_KINDS`, a case in the Swift helper, a usage description, a row.

**A dialog only ever appears because someone did something.** Three moments and no others:
the onboarding permissions step, a button on a Settings row, and the moment something
actually needs the grant (installing or switching on a skill that declares one, or a
capability being used). Nothing is asked at launch or because a run is starting — a
uninvited dialog spends the one prompt macOS will ever show. `FirstRunPermissions` records
the flag and starts Chronicle without asking. A capability without its grant reports that
on its own row.

`#ensurePermissions` in `backend.ts` does the asking, on skill install/enable and the "ask
again" button. Three rules keep it quiet: never ask twice for a grant macOS has decided; a
switched-off grant isn't asked for at all; a permission with no dialog is skipped. It
reports what is still withheld so the button can end at the owning pane, and reports app
grants only.

**A capability that needs a grant is a tool, not a command line.** Reached through `bash`
the only evidence is the command *text*, so a gate on it misses a wrapper and misfires on a
`grep`. A tool **is** the point of use: `#requireAppPermission` in `backend.ts` settles the
grant exactly when needed — switches first (never prompt), then the grant. `Reminders` asks
its gate again only if the helper answers `not-authorized` — twice and no more, because
macOS shows that dialog once. A skill wanting an app grant gets tools, and its SKILL.md
points at those tools rather than a CLI.

Every switch here is programmatic only: turning one off stops FlareAI reaching for the
capability and takes nothing back from macOS. Nothing in the app revokes a grant.

## Shipped skills

`resources/skills` has two folders; the difference is interface, not disk:

- `core/` — browser-use, gui-control, email-use, himalaya, message-use. Always loaded,
  **kept out of Settings → Skills** because the Hub tab configures them.
- `official/` — the other ten. Listed and switchable off.

Change a tier by moving the folder — nothing else. Membership is read at startup by
`coreSkillNames()`; never add a list of names. Both tiers are mirrored read-only into
`~/.flareai/official-skills`; only `~/.flareai/skills` is editable.

**A shipped skill carries no machine's state and no user's data.** `gui-control`'s route
registry pins an exact macOS build and app identity per route, so a foreign registry is
refused as `blocked_compiled_host_stale`. It is per-installation state at
`~/.flareai/state/window-control/app-control-registry.json` — created empty, stamped with
the host on first use, and filled by the work itself: an app with no route gets
`first_use_monitored` rather than a refusal, runs under the same focus, window-exposure and
recovery monitors, and the outcome is remembered (enrolled on a pass, enrolled as a
*foregrounding* route if it took focus and recovery worked, quarantined by app if it
surfaced and stayed). The recovery watcher is armed for a first-use *control* call too, and
that outcome is recorded as a failure rather than quarantined since it was contained. Launch
and control are banned separately; each capability is learnt on its own. Its observation
cache, leases, quarantine and incidents sit beside it, so `list-routes` and
`runtime-route-observations.py list` answer "what is supported here" and no reference file
restates them.

No signatures, accounts, absolute `/Users/...` paths, or launch-agent labels in
`resources/skills`. A skill that remembers something writes under FlareAI's home, following
the same `.flareai-<instance>` rule (reimplemented in Python) — and that is the only place
it *can* write, since the bundled tree is mirrored read-only and `ProtectedSkillGuard`
keeps the agent's file tools out.

A skill's display identity is **`flare.yaml` beside its `SKILL.md`** — one field,
`display_name`, because nothing else is read. It is optional: without it the Skills tab
title-cases the folder name, so a skill only earns the file when that reads wrong
(`email-use` → "Email", `pdf` → "PDF"). `SkillLoader` in
`packages/agent/src/skills/loader.ts` is the one place it is parsed. Do not reintroduce
`agents/openai.yaml`, and do not add fields.

## Tests

`npm run test` runs all backend suites; individually `test:agent`, `test:core`,
`test:storage`, `test:protocol`, `test:hub`, `test:drive`, `test:chronicle`, `test:main`,
`test:browser-use`. `npm run test:ui` covers the renderer.

`test:browser-live` drives real Chromium over real CDP — the only thing that catches a
malformed CDP call, input on the wrong element, or an observer that never fires. Opt-in
(`FLAREAI_LIVE_BROWSER=1`), ~1 minute. **Run it after changing anything in
`packages/browser-use`.** It launches Chrome **headful, positioned off-screen**:
`--headless=new` deadlocks partway through `Input.dispatchKeyEvent` and reads as unrelated
timeouts.

`test:browser-use` covers the shared command set — plain-JS modules, `.test.ts` suites in
`packages/browser-use/test/`, plain Node. A handler needing a transport is tested through a
surface against a CDP fake (see `browser/embedded-tools.test.ts`).

If a suite was already failing before your change, say so explicitly.

## UI rules — apply to every UI change

Defaults for every change, not things to ask about. [DESIGN.md](DESIGN.md) is the long form
— read it before writing styles for anything non-trivial, and check the result after.

- **Centre on centre.** An icon, favicon, dot or avatar is centred on the *text's* centre,
  not the row box's. Underlines go under the text only, with the icon's offset cancelled.
  Centre a menu or popover on the control it opens from. Icon-to-label gap ~8px; icons in
  one strip are one size.
- **Empty and loading states are centred** on both axes. Exception: a small in-flow slot in
  a stacked panel.
- **No stray chrome.** No border or box around an icon; a fallback glyph replaces a favicon
  rather than nesting in it. No grey pill/circle on icon hover — the icon darkens. Row
  highlights stay inset, never touching a divider. Clickable text stays text. Dividers are
  not edge-to-edge. **No scrollbars anywhere.** Cut explanatory copy.
- **Scrollable lists** fade top and bottom, and an edge's fade goes away once scrolled hard
  against it. Menus never overflow: cap the height, scroll the rest, stay on screen.
- **Text that does not fit** truncates with an ellipsis — no wrapping, no widening. Tooltips
  only when genuinely truncated, never while that control's menu is open, ~1.5s delay on
  list rows.
- **Motion** cross-fades rather than cuts; a fade never doubles as a move; nothing shifts or
  blurs on hover; state animations stop when the state does.
- **Spacing** is uniform within a section and tight horizontally. Reuse an existing pattern
  exactly rather than styling a near-copy.

## Packaging

`npm run package` builds into `out/`; `npm run make` also produces the distributable. Both
run `scripts/fetch-bridges.mjs` first — a bridge checksum mismatch is fatal, do not work
around it.

- Signing and notarisation are wired into `forge.config.ts` and switch on from
  `APPLE_SIGNING_IDENTITY` / `APPLE_ID` / `APPLE_ID_PASSWORD` / `APPLE_TEAM_ID`. Set the
  environment, don't edit the config.
- Without those, builds are ad-hoc signed: fine locally, never for shipping.
- **Apple Silicon only.** `--arch=x64` refuses by design (no macOS x86 bridge binaries).
  Don't route around it; state the requirement on the download.
