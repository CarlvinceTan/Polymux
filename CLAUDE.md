# Working on FlareAI

FlareAI is an Electron + Svelte 5 desktop app. The repo is laid out as
`apps/*` (what ships), `packages/*` (what those share) and `resources/*` (what
gets bundled beside them):

| Path | Holds |
| --- | --- |
| `apps/desktop/` | the app: `src/main` (main process), `src/preload` (bridge), `src/renderer` (Svelte UI), plus its Forge and Vite configs and its icons |
| `apps/extension/` | the browser extension and its native messaging host |
| `packages/` | agent · core · chronicle · inference · protocol · storage · tools |
| `resources/` | `skills/`, `native/`, `bridges/` — copied beside the packaged app by a single `extraResource` entry and read through `bundledResource()` |
| `scripts/` | repo tooling: dev launcher, bridge fetch, icon build, update publishing |

There is one `package.json`, at the root. Every path in
`apps/desktop/forge.config.ts` is written relative to that root, because Forge
runs from there — `config.forge` in `package.json` is what points it at the
file.

**`AGENTS.md` is a symlink to this file — opening either one opens this.** So
everything here is instruction rather than reference material: not background
reading, not guidance meant for some other tool's agent, but rules for you,
binding as written. A task is not done until it satisfies this file. Project
guidance worth keeping goes here, which is the only place it can go — there is
no second document to drift out of step with.

## Where main-process code goes

Only `main.ts` (the Electron entry) and `backend.ts` (the IPC surface) sit at
the top of `apps/desktop/src/main`. Everything else belongs to a domain
folder:

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
`skills/registry.test.ts`, not a shared `test/` directory — so a
folder is readable on its own. `npm run test:main` globs `**/*.test.ts`, so a
new test is picked up wherever it lands.

## Where renderer code goes

`apps/desktop/src/renderer/lib` splits by feature, not by file kind. A feature owns its
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
`apps/desktop/src/renderer/i18n/` with one file per language under `locales/`. They stay
TypeScript rather than JSON on purpose: each catalog is annotated
`const messages: Catalog`, which is what makes a missing *or misspelled* key
fail `npm run check` instead of shipping a blank string.

A module used by exactly one feature belongs inside it. When a second feature
starts importing it, move it to `shared/` rather than reaching across features.

## One FlareAI at a time

Only one dev run can be up at a time — they share one userData directory,
single-instance lock, hub port (47664) and Vite port. The user runs `npm start`;
never launch the dev app yourself.

## Shipped skills, and what makes one core

`resources/skills` has two folders and the difference is the interface, not the
disk:

- `core/` — browser-use, gui-control, email, himalaya, message. Always loaded,
  and **kept out of Settings → Skills** because the surface they back (the Hub
  tab) is where they are configured. A toggle there would contradict it.
- `official/` — the other ten. Listed, and switchable off.

To change a skill's tier, move its folder — nothing else. Membership is read at
startup by `coreSkillNames()`, so never add a list of names anywhere. Both tiers
are mirrored read-only into `~/.flareai/official-skills`; only `~/.flareai/skills`
is editable, so don't write to the mirror.

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

## Packaging

`npm run package` builds into `out/`; `npm run make` also produces the
distributable. Both run `scripts/fetch-bridges.mjs` first — a bridge checksum
mismatch is fatal, so do not work around it.

- Signing and notarisation are already wired into `forge.config.ts` and switch
  on from `APPLE_SIGNING_IDENTITY` / `APPLE_ID` / `APPLE_ID_PASSWORD` /
  `APPLE_TEAM_ID`. Don't edit the config to add them; set the environment.
- Without those, builds are ad-hoc signed: fine locally, never for shipping.
- **Apple Silicon only.** `--arch=x64` refuses by design — there are no macOS
  x86 bridge binaries. Don't try to route around it, and state the requirement
  on the download.
