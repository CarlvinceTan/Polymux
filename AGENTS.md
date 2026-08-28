# Working on Polymux

Electron + Svelte 5 desktop app. `CLAUDE.md` is a symlink to `AGENTS.md`.
Do not edit either instruction file unless explicitly asked.

## Development

- Use `npm run isolate` to run the app. Never run `npm start`: it owns the
  user's ordinary data, single-instance lock, and hub port, and can retire or
  overwrite their active session.
- Run isolates detached and in the background. Reuse a named instance when
  useful, for example:

  ```bash
  POLYMUX_DEV_INSTANCE=review npm run isolate > /tmp/polymux-review.log 2>&1 &
  ```

- Load and follow `computer-use` before any action that may launch, inspect,
  reveal, focus, or control the app. It owns current-surface checks, interference
  arbitration, and routing to `window-control` when exact local-window control
  is required. Keep test windows nonfrontmost; never use `--visible` for
  automation. Stop only the exact test instance when finished.
- Prefer backend/preload APIs, logs, and stored run records. Inspect the exact
  window only when visual evidence is necessary, and verify backend readiness
  rather than inferring it from an Electron process.
- An in-app profile isolates model, provider, MCP, plugin, skill, and credential
  configuration. It does not isolate the process, database, hub, port, chats,
  runs, memory, or browser state, so it is not a substitute for an isolate.
- Other launch routes (`npm start`, onboarding, `new:*`, packaged benchmarks,
  or visible sessions) may be used only when the user explicitly requests that
  route. Never use an ordinary launch for testing against the user's real data.
- `.env` is read from the repository root in development, is git-ignored, and
  is never packaged. Document new variables in `.env.example`.

## Verification

- Match verification to the change. For agent activity, confirm the parent run,
  terminal state, elapsed time, result, and any expected Tasks update; a
  completed-looking activity row alone is insufficient.
- Do not claim visual verification when only logs or backend state were checked.
- Restore temporary settings, cancel unfinished test runs, and leave the user's
  foreground app and ordinary Polymux session untouched.

## UI work

`docs/DESIGN.md` is the design system of record. Read and follow it before any
component, styling, layout, colour, or motion work. Never update it unless
explicitly asked; report conflicts instead.

## Repository safety

- Preserve unrelated worktree changes. Never run `git stash`.
- Polymux is pre-release with no external users. Do not add compatibility for
  obsolete formats; reset disposable state or use a bounded one-time migration
  for valuable local data.

## Commits and release notes

- Never create, amend, squash, rebase, tag, or push a commit unless the user
  explicitly asks for that Git action in the current task. Permission to edit
  or test files does not include permission to commit them.
- When asked to commit, use a clear, capitalized, imperative subject of at most
  72 characters, with no trailing punctuation. Do not use conventional-commit
  prefixes such as `feat:`, `fix:`, or `docs:`. When one area is the clear
  scope, an informative prefix is allowed, for example `Hub: Add chat search`.
- End the commit message with this exact, machine-readable section:

  ```text
  Release Notes:

  - Hub: Added chat search to conversations.
  ```

- Use exactly one concise, user-facing bullet in the form
  `- <Area>: <Added|Fixed|Improved> <outcome>.` Reuse stable, title-cased area
  names such as `AI`, `Git`, `Hub`, `Drive`, `Browser`, `Desktop`, and `Site`.
  The area supplies release-note subsections such as **AI** and **Git**, while
  the verb supplies **Features**, **Bug Fixes**, or **Improvements**. Describe
  the outcome rather than implementation details so the pages under
  `apps/site/releases/` can display it directly. Use `- N/A` for changes with
  no user-facing release note. Keep `Release Notes:` as the final section.
