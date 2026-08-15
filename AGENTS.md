# Working on Midas

Midas is an Electron + Svelte 5 desktop app. `src/main` is the main process,
`src/preload` the bridge, `src/renderer` the Svelte UI, and `packages/*` the
workspace libraries the main process runs on.

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
   retires these automatically; if you see `Retiring the Midas dev app...`, that
   was the cause. Kill any stray `node_modules/electron/dist/...` processes by
   hand if the window is still stale.
3. Main-process failures before `loadURL` — these print to the terminal.

Do not report a change as working on the strength of a green build alone, and
do not ask the user to check the window for you.

## One Midas at a time

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
