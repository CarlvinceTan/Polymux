# CLAUDE.md

The project guidance for this repo lives in [AGENTS.md](AGENTS.md). Read it
before making changes — it applies to Claude Code as written.

The rule that matters most: **after any change to app code, confirm the app
still starts and paints.** A green `tsc`/build does not prove the renderer
mounts. Run `npm run check && npm run renderer:build && npm run test:ui`, then
`npm start`, and check the window has content before calling the work done. See
AGENTS.md for what to inspect when it comes up blank.
