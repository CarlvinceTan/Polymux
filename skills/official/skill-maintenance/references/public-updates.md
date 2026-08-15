# Public-source updater enrollment

## Default rule

Automatically enroll a personal skill when its public Git source and installed baseline can be verified. This is routine setup and does not require a separate user confirmation.

Do not infer provenance from a similar name or search result. If the source is private, ambiguous, unreachable, rewritten, or cannot be matched to the installed baseline, leave the skill unchanged and report that enrollment was held.

## Installer lockfiles

Installers that record GitHub provenance in `.skill-lock.json` are synchronized with:

```bash
python3 ~/.midas/github-skill-updater/enroll_skill.py --sync-locks
```

The daily updater also runs this synchronization before checking registered skills. A lock entry is enrolled only when its source is anonymously reachable and its folder hash resolves to the same Git tree on the public upstream branch.

## Explicit public source

For a manually installed public skill, record the exact repository, source subdirectory, installed directory, and accepted source commit:

```bash
python3 ~/.midas/github-skill-updater/enroll_skill.py \
  --skill <skill-name> \
  --repo <public-https-github-url> \
  --skill-dir <installed-skill-directory> \
  --subdir <repository-skill-subdirectory> \
  --accepted-commit <full-source-commit>
```

Capture the source commit during installation rather than trying to reconstruct it later. Enrollment may proceed without a supplied commit only when the installed skill exactly matches the current verified upstream tree.

## Boundaries

- Enrollment itself does not modify the live skill.
- Keep the 24-hour soak and fast-forward-only history checks.
- Preserve local-only files and protected frontmatter through three-way merge.
- Hold conflicts, failed validation, changed live state, or unverifiable history for review.
- Create a timestamped backup before any validated upstream installation.
