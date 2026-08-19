# Protected Git history

Approved personal skills are mirrored into a local bare Git repository at
`~/.flareai/skill-history.git`. Git never checks out, merges, resets, or pulls in
either live skill root.

## Lifecycle

1. Before `promote` or `approve-intentional`, history preflight verifies that
   `main` exactly matches the approved live skills.
2. The sealed maintenance runner validates and activates the candidate.
3. A temporary detached worktree under
   `~/.flareai/skill-maintenance/git-worktrees/` copies the new live deployment,
   commits it, and atomically advances `main`.
4. The temporary recording worktree is removed. Existing content-addressed
   snapshots and behavioral reports remain the safety and rollback layer.

When an `origin` remote is configured, every successful approved-history
record attempts a normal fast-forward push of `main`. It never fetches into,
pulls, merges, resets, or force-pushes the approved branch. A network or remote
failure leaves the local commit intact, emits a warning, and can be retried
with `history push`.

On first initialization, approved deletion records from the existing sealed
snapshot store are imported into the parent commit before the current baseline
is recorded. Skills deleted before Git history therefore remain recoverable
through ordinary Git history as well as the original snapshot store.

## Commands

```bash
"${FLAREAI_NODE:-node}" scripts/skill_maintenance.mjs history init
"${FLAREAI_NODE:-node}" scripts/skill_maintenance.mjs history status
"${FLAREAI_NODE:-node}" scripts/skill_maintenance.mjs history log --limit 20
"${FLAREAI_NODE:-node}" scripts/skill_maintenance.mjs history worktree [commit]
"${FLAREAI_NODE:-node}" scripts/skill_maintenance.mjs history push
```

`history worktree` creates a detached inspection checkout outside the live
roots. To restore an old skill, copy it from that checkout into a newly staged
maintenance candidate, then run the complete check and promote it normally.
Never copy or check out history directly over live skills.

## Tracked scope

History records non-hidden skill directories containing `SKILL.md` from both
`~/.flareai/skills` and `~/.agents/skills`. It excludes Git metadata, Python
caches, `.DS_Store`, and ESPHome build output. Credentials must remain in their
approved secret stores and must never be added to a skill merely because the
history repository is local.

Git is the durable recovery record for approved skill contents and deletions.
Candidate folders, evaluation reports, and the currently approved comparison
snapshots are gate working data rather than additional deployed skills. Keep
only the working data still required for an active candidate, current baseline,
promotion evidence, or audit; garbage-collect unreferenced snapshots and
disposable profiles through the maintenance commands.
