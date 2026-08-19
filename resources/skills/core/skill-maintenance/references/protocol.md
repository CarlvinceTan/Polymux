# Maintenance protocol

## Trust model

- Live personal skills are the approved deployment surface, not the editing surface.
- Candidate folders are disposable working copies outside both live skill roots.
- Snapshots and reports are content-addressed. Promotion checks the candidate, approved baseline, complete contract coverage, runner, grader, policy, profile preferences, and report age again under a lock.
- Approved deployments are also committed to a local bare Git repository through temporary detached worktrees outside both live roots. Git history improves inspection and deletion recovery but never substitutes for behavioral validation.
- Promotion refuses to proceed when Git history does not match the current approved live deployment. Git checkout, pull, merge, reset, and restore operations are forbidden against live roots.
- The installed baseline is sealed. `baseline --force` is setup-only and cannot bless later drift after sealing.
- FlareAI runs tool lifecycle hooks from `~/.flareai/hooks.json`. Configure the bundled guard (`scripts/live_skill_guard.mjs`) as a `pre-tool` hook to block direct writes to live skills; the drift scan (`doctor` + `scan`) still quarantines any drift the hook did not prevent. Hook failures are handled as unhealthy-gate warnings, not as evidence that a change passed.

## Report meaning

Each behavioral contract runs the same prompt against the approved snapshot and candidate in separate isolated profiles. Every concurrent process receives its own writable profile and workspace. Preference answers are not injected into those executor profiles. A separate structured grader starts only after its baseline and candidate outputs complete, checks every expectation, and compares the two outputs. Repeated runs use majority evidence so one stochastic wording omission does not become a false regression; infrastructure errors, absolute safety failures, and consistent pass-to-fail behavior still block promotion.

A pass reduces regression risk; it does not prove every possible model response. Use repeated runs for important behavior and add a contract whenever a new stable preference is introduced.

Reports contain an immutable execution plan and an atomic job ledger. Resumption may reuse a completed job only when its inputs, output, candidate, baseline, contracts, model, evaluator context, and artifact hashes still match. Promotion rechecks the complete ledger and rejects partial, altered, stale, or diagnostic-only reports.

## Efficient complete checks

Keep every requirement that applies to the changed skill, but avoid irrelevant
or repeated work. Run deterministic structural validation before model probes,
select contracts by the skill's declared capabilities, use bounded parallelism
for independent baseline, candidate, and grader jobs, and resume only completed
jobs whose full inputs and hashes still match. The normal parallel check is the
fast path; serial runs and partial contracts are diagnostics, not promotion
shortcuts.

### Mechanical rename fast path

Use `check-rename` only for a declared identifier rename. It deterministically
transforms the approved source tree with the ordered literal replacements and
requires the proposed tree to match exactly, including relative paths, file
modes, symlink targets, UTF-8 text, and unchanged binary data. Structural
validation also checks frontmatter, routing metadata, references, JSON, Python,
and shell syntax.

An update compares with its own approved snapshot and must name both the old
source skill and already-live replacement skill for deterministic routing
verification. The literal replacements must include that exact old-name to
new-name pair. A new renamed skill
must name the approved source skill; deletion of the old skill must name the
already-live replacement skill. Every declared replacement must be used. Any other file,
content, mode, or path change fails closed and routes the candidate to the full
behavioral check. Promotion re-runs the deterministic proof under the gate lock,
so a stale or edited candidate cannot reuse an earlier rename report.

The wrapper permits only one evaluation process per candidate. Concurrent
checks or resumes for the same candidate fail immediately with a clear message;
different candidates may still be evaluated independently, and jobs within one
evaluation retain their bounded parallelism.

## Intentional differences

Do not encode a deliberate behavior change by silently deleting or weakening an old contract. First run the candidate against the old contract, show the user what changes, and obtain explicit approval. Record that approval and reason through `approve-intentional`. Structural breakage, stale reports, changed candidates, changed evaluator inputs, and drifted live baselines still block promotion.

For deletion of a named personal skill, the user's direct and unambiguous deletion request already supplies that explicit approval. Run the old contracts and retain the compatibility record, but do not require a second confirmation when the failures are solely the expected absence of the requested skill. The record is internal maintenance bookkeeping and does not create a general preference or authorize another deletion.

## Recovery

Run `doctor`, then `scan`. If live drift exists, run `quarantine`, evaluate the resulting candidate, and keep the restored approved version live until a decision is made. If the runner integrity check fails, disable no safeguards casually: restore the known files, recompute and review their hashes, and re-approve the configuration with the user before trusting it again.

For historical recovery, create a detached inspection worktree from the desired
commit, copy the selected skill into a new staged candidate, and run the full
check before promotion. Never attach a Git worktree to or check out a commit in
either live skill root.
