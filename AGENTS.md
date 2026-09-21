# Working on Polymux

Electron + Svelte 5 desktop app. 
Do not edit this instruction file unless explicitly asked.

## Development

- Use `npm run isolate` to run the app. Never run `npm start`: it owns the
  user's ordinary data, single-instance lock, and hub port, and can retire or
  overwrite their active session.
- Run isolates detached and in the background. Reuse a named instance when
  useful, for example:

  ```bash
  POLYMUX_DEV_INSTANCE=review npm run isolate > /tmp/polymux-review.log 2>&1 &
  ```

- Load and follow `control` before any action that may launch, inspect,
  reveal, focus, or control the app. It owns current-surface checks and
  exact-surface coordination, and routes to `window-control` when exact
  local-window control is required. Keep test windows nonfrontmost; never use `--visible` for
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
- After changing implementation, update tests that have become stale so they
  continue to describe current behavior.
- Do not claim visual verification when only logs or backend state were checked.
- Restore temporary settings, cancel unfinished test runs, and leave the user's
  foreground app and ordinary Polymux session untouched.

### Controlling Polymux for UI verification

- For user-facing changes, operate the running Polymux UI yourself: navigate to
  the feature, use its controls, and inspect the result. Backend/preload checks
  support this walkthrough; they do not replace it. Do not ask the user to
  click through routine verification when the agent can do it.
- Use a named background isolate with an unused debugging port, for example:

  ```bash
  POLYMUX_DEV_INSTANCE=ui-review POLYMUX_REMOTE_DEBUGGING_PORT=9347 npm run isolate > /tmp/polymux-ui-review.log 2>&1 &
  ```

- Connect Playwright's `chromium.connectOverCDP` to the isolate's loopback
  endpoint (`http://127.0.0.1:9347` in the example). Verify the listener belongs
  to that test process, inspect current CDP targets, and bind to the exact app
  renderer. Discover its actual Vite URL; do not assume a port or select the
  first page. Revalidate after reloads or process restarts.
- Follow `control`'s exact-surface coordination. The owned
  renderer provides a background UI route when native accessibility cannot
  expose the window; use the embedded-surface exception only when its stated
  conditions apply. Missing native process identity does not justify bypassing
  native-window guards. Never use global input or `bringToFront()`.
- Click, fill, and scroll through semantic locators such as `getByRole` and
  `getByLabel`, checking that the target is unique. If Polymux controls lack
  useful accessible names or roles, fix them as part of the UI work. Use
  preload APIs for setup and supporting evidence, not to simulate a successful
  user interaction by changing component state directly.
- Check the rendered outcome and relevant backend completion. Capture and
  inspect screenshots for visual claims; for media, scroll it into view and
  check decoded dimensions, loading failures, and animation where relevant.
  Exercise the affected loading, empty, error, and success states as applicable.
- Keep screenshots and private live-data evidence outside the repository.
  An isolate separates Polymux state, not external accounts: use fixtures unless
  live access is authorized. Disconnect automation and stop only the exact
  owned test process when finished, then report what was actually observed and
  any remaining gaps.

## UI work

`docs/DESIGN.md` is the design system of record. Read and follow it before any
component, styling, layout, colour, or motion work. Never update it unless
explicitly asked; report conflicts instead.

- Before editing, identify the applicable design rules and inspect the closest
  existing component or pattern. Reuse shared components, styles, and tokens.
- Before completing UI work, check the affected flow against `docs/DESIGN.md`
  in the running isolate using the verification procedure above. Check both
  light and dark themes, normal and narrow widths, long content, and applicable
  loading, empty, error, success, selected, hover, focus, and expanded states.
- Capture and inspect screenshots of the final result. Check optical alignment,
  spacing, icon size and stroke weight, theme visibility, overflow, and layout
  stability; compare repeated controls with their existing counterparts.
  Passing builds, tests, or geometry assertions alone is not a visual pass.
- Fix design violations within the changed UI before declaring it complete.
  If a mismatch remains or visual verification is blocked, describe the UI work
  as incomplete and name the gap. Report unrelated findings separately without
  expanding the task. The final response must state what was visually checked
  and what remains unverified.

## Repository safety

- Preserve unrelated worktree changes. Never run `git stash`.
- Never create, switch, or move work onto another Git branch unless the user
  explicitly instructs you to do so in the current task. Remain on the current
  branch by default.
- Polymux is pre-release with no external users. Do not add compatibility for
  obsolete formats; reset disposable state or use a bounded one-time migration
  for valuable local data.

## Commits, pull requests, and release notes

- Never create, amend, squash, rebase, tag, or push a commit unless the user
  explicitly asks for that Git action in the current task. Permission to edit
  or test files does not include permission to commit them.
- When asked to commit, use a clear, capitalized, imperative subject of at most
  72 characters, with no trailing punctuation. Do not use conventional-commit
  prefixes such as `feat:`, `fix:`, or `docs:`. When one area is the clear
  scope, an informative prefix is allowed, for example `Hub: Add chat search`.
- Use the same title style for pull requests. End the pull request body with
  this exact, machine-readable section:

  ```text
  Release Notes:

  - Hub: Added chat search to conversations.
  ```

- Use exactly one concise, user-facing bullet in the form
  `- <Area>: <Added|Fixed|Improved> <outcome>.` Reuse stable, title-cased area
  names such as `AI`, `Git`, `Hub`, `Drive`, `Browser`, `Desktop`, and `Site`.
  Describe the outcome rather than implementation details. Use `- N/A` for
  changes with no user-facing release note. Keep `Release Notes:` as the final
  section of the pull request body.
- Release pages collect the merged pull request notes since the previous
  version. Group `Added`, `Fixed`, and `Improved` entries under **Features**,
  **Bug Fixes**, and **Improvements**, then group them again by their area as
  third-level headings. Deduplicate and lightly edit the collected notes for a
  cohesive customer-facing release; do not publish a raw Git log.
