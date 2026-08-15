# Customized system-skill updates

## Ownership

`skill-maintenance` owns detection, merge preparation, staging, behavioral
validation, approved deployment history, and upstream-baseline finalization.
Customized skills such as `skill-creator` contain no updater or sync logic.

State lives under `~/.midas/skill-maintenance/system-updates`. This directory
contains accepted upstream baselines, reviews, and backups; it is not a live
skill or editing surface.

## Detection

```bash
python3 scripts/skill_maintenance.py system check --json
python3 scripts/skill_maintenance.py system status --json
```

Detection copies the bundled skills from the installed Midas app bundle into an
isolated temporary home. It does not trust the live `.system` cache. An
upstream change creates a review containing:

- `base/`: previously accepted upstream version;
- `local/`: current customized live version;
- `upstream/`: newly bundled version;
- `merged/`: proposed three-way merge;
- `conflicts.json`: paths requiring explicit resolution;
- `review.json`: immutable source hashes and review state.

## Review and staging

Inspect clean merges for semantic conflicts as well as resolving every listed
path. Preserve local intent, protected behavior, and every locally added file
while adopting compatible upstream improvements.
Write `resolution.json` with `resolved_paths`, `summary`, and `validation`.

```bash
python3 scripts/skill_maintenance.py system stage-review --skill <name> --json
```

Staging refuses changed live state, altered upstream snapshots, unresolved
conflicts, or invalid skill metadata. It creates a timestamped backup and a
normal maintenance candidate, but never changes the live skill.

Run the candidate through the complete maintenance check. If validation fails,
a protected requirement changes, or the live skill changes during review, leave
the merge pending. A current candidate that passes every applicable requirement
may be promoted without an additional confirmation. Successful promotion
records Git history and finalizes the accepted upstream baseline.

## Scheduled detection

The background LaunchAgent runs `system watch --json`. Watch performs detection
and review preparation only. It never launches a review agent, edits a live
skill, promotes a candidate, or advances an upstream baseline.

## Recovery

If promotion succeeds but finalization fails, the live deployment and approved
Git history remain authoritative. Rerun:

```bash
python3 scripts/skill_maintenance.py system finalize-candidate <candidate-id> --json
```

Never repair state by copying a review directly into a live skill.
