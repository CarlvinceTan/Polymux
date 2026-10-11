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
- Work on a feature branch off the latest `main`.
- Commit each verified unit on that branch: imperative mood, subject of at
  most 72 characters, no AI attribution.
- Push the branch and open one pull request for Carlvince's review.
- Never commit to or merge into `main`; merging waits for Carlvince's OK.
- Polymux is pre-release with no external users. Do not add compatibility for
  obsolete formats; reset disposable state or use a bounded one-time migration
  for valuable local data.
