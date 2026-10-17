# Working on Polymux

SwiftUI app backed by a Go agent server.
Do not edit this instruction file unless explicitly asked.

- Do not modify any `README.md` unless explicitly instructed. Suggest changes
  instead.

## UI

`DESIGN.md` is the design system of record: strict rules only, no rationale.
Read and follow it before any component, style, layout, colour, or motion work.
Never update it unless explicitly asked; report conflicts instead.

- Before editing, find the applicable rules and inspect the closest existing
  component or pattern. Reuse shared components and tokens.
- Before finishing, check the affected flow against `DESIGN.md` in the running
  app: both themes, plus the applicable loading, empty, error, selected, hover,
  and focus states. Screenshots are the evidence; a build or a test is not.
- Fix design violations inside the changed UI before calling it done. If a
  mismatch remains or verification is blocked, say the UI work is incomplete and
  name the gap. Report unrelated findings separately.

## Comments

- Prefer short, one-line comments.
- Comment only when it adds what the code cannot: why, non-obvious intent,
  invariants, gotchas. Do not restate an obvious function, type, or variable
  name.
- When in doubt, leave it out; a clear name beats a redundant comment.

## Naming

- Prefer function, component, and variable names of two words or fewer. Use a
  third word only when two isn't enough to make the name clear.

## Repository safety

- Preserve unrelated worktree changes. Never run `git stash`.
- Work directly on `dev`, based on the latest `origin/dev`. Do not create
  another local or remote branch; temporary worktrees must stay detached.
- Commit each verified unit on `dev`: imperative mood, subject of at
  most 72 characters, no AI attribution.
- Push only `dev` and open or update the single `dev` to `main` promotion pull
  request for Carlvince's review. Honour any task-specific hold on pushing.
- Never commit or push directly to `main`. The promotion queue squash-merges
  reviewed `dev` and then realigns `dev` to the promoted `main`; merging waits
  for Carlvince's OK.
- Keep visual evidence local. Never create or publish `proof-media` branches.
- Polymux is pre-release with no external users. Do not add compatibility for
  obsolete formats; reset disposable state or use a bounded one-time migration
  for valuable local data.

## Commits, pull requests, and release notes

- Use a clear, capitalized, imperative subject of at most 72 characters, with
  no trailing punctuation. Do not use conventional-commit prefixes such as
  `feat:`, `fix:`, or `docs:`. When one area is the clear scope, an
  informative prefix is allowed, for example `Hub: Add chat search`.
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
