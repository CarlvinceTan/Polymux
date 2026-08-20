# Working on FlareAI

Electron + Svelte 5 desktop app. **`AGENTS.md` is a symlink to this file.**
Don't edit this file unless explicitly told so.

## Running the app

**`npm run isolate` is the default — use it unless told otherwise.**

```bash
npm run isolate
```

**Never run `npm start`** — it owns the ordinary userData directory, its
single-instance lock and hub port 47664, and a second run retires the user's session.

`npm run isolate` is `npm start -- --isolated[=name]`. `FLAREAI_DEV_INSTANCE` keys its
own userData dir (`…/FlareAI-side`), its own homeserver port (derived from the name),
and its own `~/.flareai-<name>`. Vite picks a free port.

- **Run it in the background** — it's long-running, and blocking stalls the turn.
- **Never bring it to the front.** Drive and verify it behind the user's window
  (screenshots, logs, renderer are all reachable). Surface it only when asked.
  Stop it when done.
- A side instance starts empty (settings, keys, chats, hub, skills) — reuse a name
  (`--isolated=review`) to keep state.
- Both runs build into the same `.vite`.

The other entry points exist, but **never reach for one on your own — only run these
when the user explicitly names them:**

| | uses `~/.flareai` | starts from nothing |
| --- | --- | --- |
| ordinary | `npm start` | `npm run new:start` |
| onboarding | `npm run onboarding` | `npm run new:onboarding` |

The left column is the app as the user has it — one at a time, and a second run
retires the first. The right column is `--new`: an instance named `new<N>`, the
first number no run holds and no directory is left over from, so several can run
at once and none of them collides with the user's. It is discarded on exit —
both `…/FlareAI-new<N>` and `~/.flareai-new<N>` — which is also what keeps the
numbers from creeping up. Because it is discarded, state never survives the run —
which is the other reason `isolate` is the default.

`npm start` reads `.env` from the repo root (OAuth client ids for Drive, Dropbox,
OneDrive in development). Git-ignored, never packaged, environment wins. Add new
variables to `.env.example` too.

## UI work

`DESIGN.md` is the design system of record. **Read it before any UI work** —
components, styling, layout, colours, motion — and follow it.

**Never update `DESIGN.md` unless explicitly told to.** If a change conflicts with
it, say so and ask rather than editing the document to match the code.

## Git

**Never run `git stash`.** It moves the user's uncommitted work somewhere they
aren't looking. If changes are in the way, work around them or ask.
