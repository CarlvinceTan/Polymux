---
name: skill-maintenance
description: Stage, compare, and safely promote changes to the user's personal Codex skills. Use whenever creating, editing, merging, installing, deleting, or reviewing a skill under ~/.codex/skills or ~/.agents/skills; when the maintenance hook reports drift; or when reviewing a customized bundled-skill update. Keep live skills unchanged until structural checks and protected behavioral contracts pass.
author: Midas
category: Skills
---

# Skill Maintenance

Protect existing preferences by testing an isolated candidate against the approved skill snapshot before changing the live skill.

- **Live/deployed skill:** the active approved copy Codex loads.
- **Staged candidate:** an inactive working copy used for editing and testing.

Keep user-facing explanations concise and high-level unless the user asks for
implementation detail.

The maintenance interface retains the existing sealed runner, baselines, and
audit history, and records every approved deployment in isolated local Git
history. It also owns upstream-update detection for customized bundled skills;
individual skills do not implement their own synchronization.

## Protected Git history

Git records each approved deployment but never replaces the behavioural gate.
Keep repositories and worktrees outside live skill roots, never run Git writes
against deployed skills, and restore historical content through a new staged
candidate. Read [references/git-history.md](references/git-history.md) for
commands, synchronization, and recovery.

## Update sources

There are two update paths, and both must end as staged candidates that pass
the normal maintenance gate:

- **Public Git source:** for a personal skill installed from a verifiable public
  repository. The updater already exists; enrollment adds the new skill's exact
  provenance to its registry after promotion. Do not guess a source or request
  separate enrollment approval. Read
  [references/public-updates.md](references/public-updates.md).
- **Bundled Codex source (system skill):** for a customized copy of a skill
  shipped with Codex.
  Keep the custom copy in the user-owned skill root and use the integrated
  `system` commands to compare it with the newly bundled version. Read
  [references/system-updates.md](references/system-updates.md).

Neither path may bypass staging or the complete maintenance gate. Preserve local
intent and locally added files, inspect three-way merges for textual and semantic
conflicts, and create a timestamped backup before applying any approved merge.
Hold unresolved textual or semantic conflicts for review rather than guessing;
leave failed or changed reviews pending. A current bundled-skill candidate that
passes every applicable requirement may be promoted without an additional
confirmation.

## Mandatory workflow

1. Never edit a live personal-skill directory directly.
2. Check the gate:

   ```bash
   python3 scripts/skill_maintenance.py doctor
   python3 scripts/skill_maintenance.py scan
   ```

   `doctor` verifies that the maintenance gate, required files, sealed state,
   and evaluation dependencies are healthy. `scan` compares deployed skills
   with their approved baseline and reports anything modified, added, or
   deleted.

3. Stage the change:

   ```bash
   python3 scripts/skill_maintenance.py stage <skill-name>
   python3 scripts/skill_maintenance.py stage-new codex <new-skill-name>
   python3 scripts/skill_maintenance.py stage-delete <skill-name>
   ```

4. Edit only the returned candidate path. Do not change the contracts, runner, hook, approved snapshots, or baseline to make a candidate pass.
5. Check the gate, structure, and applicable approved-versus-proposed behavior suite:

   ```bash
   python3 scripts/skill_maintenance.py check <candidate-id>
   ```

   `check` never stages or promotes anything. Structural validation runs first
   because it is fast and prevents expensive probes from starting for an invalid
   candidate. Once it passes, applicable behavioural jobs run concurrently with
   bounded parallelism. Only one evaluation process may run per candidate, so a
   second check or resume fails immediately instead of racing the active run.
   Do not use subagents to duplicate the same gate work.

   For a strictly mechanical rename, use the deterministic rename gate instead:

   ```bash
   python3 scripts/skill_maintenance.py check-rename <candidate-id> \
     --source-skill codex:old-name \
     --replacement-skill codex:new-name \
     --replace old-name=new-name
   ```

   For the newly named replacement skill itself, use
   `--source-skill codex:old-name` without `--replacement-skill`. For deletion
   of the old skill after its replacement is live, use only `--replacement-skill`.
   Repeat `--replace` for deliberate
   spelling forms such as uppercase environment-variable identifiers.

   `check-rename` is eligible only when the candidate is byte-for-byte equal to
   the approved source after those literal content and path replacements. It
   also validates structure and routing metadata. Any added, removed,
   reordered, or otherwise edited content fails the mechanical proof and must
   use the normal complete `check`; never expand the replacement list to hide a
   behavioral edit.

6. Inspect the complete decision. Promote only a passing, current report:

   ```bash
   python3 scripts/skill_maintenance.py promote <candidate-id>
   ```

## Rename and cleanup migrations

Treat a requested rename as one complete migration, not a replacement plus a
temporary alias. Before promoting the replacement, search every live personal
skill, routing file, metadata file, and managed registry for references to the
old name. Stage the replacement, every affected dependent skill, and the old
skill's deletion together. Validate each candidate in dependency order, then
promote the replacement and dependent updates, and remove the old skill through
the normal deletion gate. Do not report a rename complete while the old skill
remains live solely to preserve stale references; stop and report the failed
candidate if any part cannot pass.

For a rename requested together with cleanup, do this work immediately within
the same maintenance run. Preserve recovery through the isolated Git history,
not through a live duplicate skill.

When the old identifier appears in protected dependency policy or a registered
update-source registry, use `scripts/migrate_skill_rename.py` after the
replacement and dependent candidates are promoted but before checking the
deletion candidate. Pass only exact old/new identifiers and exact registered
text replacements. Run it with `--dry-run` first; the applied migration creates
an external backup, updates the registered metadata atomically, reseals the
unchanged behavioral baseline against the new routing policy, and refreshes the
hook's expected suite digest. Never use it to alter contracts, grader behavior,
approved skill snapshots, or skill content.

Required contracts, repeats, baseline comparisons, and grader calls may not be
removed for speed from a behavioral check. A passing deterministic
`check-rename` is the sole exception because it proves that no behavior text or
resource changed outside the declared literal substitutions; it does not run
probabilistic behavior graders. Safety and authorization contracts use at least three runs
because model output varies; the majority result reduces a one-off false pass or
failure. Ordinary contracts may use fewer runs. Partial runs remain diagnostic.
Read [references/protocol.md](references/protocol.md) for execution, resumption,
and diagnostic details.

## Deleting a skill

A direct, unambiguous request to delete a named personal skill is sufficient authorization to remove that skill and the behavior it provides. Do not ask for a second confirmation merely because deletion causes the deleted skill's behavioral contracts to fail.

Still run `stage-delete` and the complete `check`. If structural validation passes and the behavioral failures are only the expected result of removing the requested skill, apply the deletion through `approve-intentional --user-approved`, citing the user's deletion request as the reason. This compatibility record is internal maintenance bookkeeping, not an additional consent step or a reusable permission.

Before a deletion can pass structural validation, scan the other live skills'
core routing files, dependency policy, and registered public-update metadata for
explicit references to the deleted skill. Clean or deliberately replace every
reference first. Platform names alone are not a reference to a same-named
deleted skill.

After dependent skill updates are promoted, remove the deleted identifier from
protected dependency policy and public-update registration with the atomic
migration helper before rechecking the deletion candidate:

```bash
python3 scripts/migrate_skill_delete.py <skill-name> --dry-run
python3 scripts/migrate_skill_delete.py <skill-name>
```

The helper backs up every affected metadata file, removes only the exact skill
identifier, reseals the unchanged approved behavioral state against the updated
routing policy, and refreshes the hook suite digest. Never use it before live
skill references have been cleaned or as a substitute for `stage-delete`.

Ask for clarification only when the deletion target is ambiguous, the request is conditional, live drift exists, structural validation fails, or the report shows a problem beyond the expected absence of the deleted skill.

## Failure and intentional change

- Treat a failed contract as a regression. Refine the candidate or discard it; do not weaken the contract inside the same change.
- Except for an unambiguous skill deletion covered above, if the requested change intentionally alters protected behavior, show the failed expectations and exact new behavior to the user. Only after separate explicit approval may you use `approve-intentional` with `--user-approved` and a concrete reason.
- Structural failures can never be intentionally approved.
- If live drift is reported, run `quarantine`. It copies the drift into a candidate and restores the last approved version before evaluation.
- Any automated improvement proposal must remain staged and inert. It must not
  modify a live skill, memory, configuration, or model state, and adoption still
  requires explicit user approval after the proposal and checks are shown.
- Treat customized system-skill updates as the integrated three-way-merge
  workflow above. Never copy a merged review directly over a live skill or use
  a separate updater's direct-apply path.

## Evaluation boundaries

Behavior probes run in isolated read-only Codex profiles with live hooks, memories, GUI control, and external side effects disabled. Never send messages, submit forms, pay, book, power devices, or foreground apps during a probe.

When validation needs a real fresh Codex task outside the sealed probe runner:

- If the user references a specific failed or unsatisfactory task, retrieve and
  reuse the user's exact original prompt as the primary before-versus-after
  regression case. Do not replace it with a friendlier, narrower, or more
  leading prompt merely to demonstrate the new mechanism. Add separate
  diagnostic prompts only after the exact-prompt reproduction.
- Evaluate the completed answer against the user's intended outcome and the
  original failure, not merely whether the candidate invoked a skill, tool,
  cache, hook, or route. Record relevant missing evidence, incorrect claims,
  and output-quality differences.
- Give temporary test tasks a clearly diagnostic title, wait for their final
  result, inspect enough of the turn to judge the output, then archive every
  temporary test task after recording the result. Never archive the user's
  referenced source task unless the user separately asks.

If real GUI work is ever required outside an isolated probe, load and follow
`window-control`; this skill does not duplicate or override that policy.

Read [references/protocol.md](references/protocol.md) when repairing the gate, interpreting artifacts, or handling a deliberate behavior change.
