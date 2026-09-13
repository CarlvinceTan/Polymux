---
name: deploy-prep
description: Prepare a release review and concise platform readiness report, with proposed versions, changelog, commit message, PR text, and deployment steps. Use only when the user explicitly requests deploy prep or explicitly asks to use this skill.
---

# Deploy prep

## Invocation

Use this skill only when explicitly instructed by the user. Do not select it automatically merely because a task mentions releases, deployment, reviews, performance, or cleanup. Do not run it at startup. Creating, editing, or discussing this skill is not an instruction to execute its workflow.

## Scope and authority

- Follow the current repository instructions and design system. Stay on the current branch and preserve unrelated changes and staging.
- An explicit deploy-prep request authorizes inspection, checks, release drafting, and focused local fixes for validated issues, unless the user requests report-only work. Suggest broad restructuring or risky changes instead of expanding the release indefinitely.
- Preparation does not authorize commits, pushes, tags, PR publication, production migrations, or deployment. Carry out those actions only when explicitly requested in the current task.
- Keep proposed release text in the report by default. Clearly identify any product files fixed locally. Do not silently bump versions or overwrite changelogs; show the exact intended edits and destinations.

## Workflow

1. Establish the current branch, changed and untracked files, release baseline, platform inventory, and requested exclusions. Use the repository's release configuration and previous release conventions; do not guess the release baseline when ambiguous. State any coverage limitation.
2. Review the concerns below. Use applicable installed security/code-review skills and follow their instructions when invoked. If a specialist capability is unavailable, perform supported checks and disclose the gap; never imply that an unavailable skill ran. Keep the workflow portable across agents and tools.
3. Validate findings before fixing them. Apply bounded fixes, then run checks appropriate to the changed behaviour. Report larger improvements as suggestions, separate from release blockers.
4. Verify affected UI through the repository's running-app procedure. For Polymux, use a named background isolate and the prescribed surface coordination; protect the ordinary session. Automated tests and backend checks do not substitute for visual or authenticated live evidence.
5. Inspect platform versions and available built artifacts. Distinguish source versions, built versions, and deployed versions. Verify signing on the actual artifact where possible; configured signing credentials or an unsigned build do not prove distribution readiness. Mark unavailable evidence Unverified.
6. Prepare the exact release wording using the final reviewed scope. Recheck changes since the initial snapshot before issuing the verdict. Separate review completion, fix completion, artifact verification, and deployment status.
7. Return the concise report described in [report-template.md](report-template.md). Do not run a deployment just to fill a status cell.

## Review concerns

- **Security:** Authentication, account/profile isolation, authorization, exposed services, secret handling, dependency vulnerabilities, and data access policies. Identify concrete impact and evidence.
- **Legacy code:** Unused code, abandoned flags, obsolete fallbacks, dead dependencies, and outdated compatibility. Confirm references and runtime entry points before removal.
- **Migrations:** Schema, constraints, storage, and persisted-state changes; affected data, migration ordering, failure recovery, and backup needs. Polymux is pre-release: reset disposable state where appropriate and use bounded migrations for valuable data, rather than retaining obsolete formats indefinitely. Do not assume every existing local record is disposable.
- **Organisation:** Duplication, oversized modules, and folder boundaries. Reuse existing conventions; suggest broad moves separately.
- **Naming:** Prefer clear names of one or two words, three when needed. Clarity takes priority over word count; avoid cryptic abbreviations and unnecessary public API renames.
- **UI components:** Consolidate repeated behaviour and styling where a shared component reduces complexity. Avoid abstractions that only relocate code or add excessive options.
- **UI verification:** Design consistency, light/dark themes, normal/narrow widths, long content, keyboard/focus behaviour, and applicable loading, empty, error, success, selected, hover, and expanded states. Inspect screenshots for visual claims.
- **Performance and caching:** Immediate interaction feedback, navigation latency, cold/warm cache behaviour, invalidation, freshness, account separation, bounded cache size, duplicate requests, background refresh, rendering cost, long lists, and resource use. Keep content visible during refresh and prevent flicker or layout shifts. Use optimistic updates only with safe failure recovery. Exercise slow responses and report measured evidence when available; do not invent timing improvements.
- **Reliability:** Cancellation, timeouts, reconnects, retries, persistence, partial failures, process/resource cleanup, and recovery after restart. Verify terminal results rather than relying on completed-looking UI rows.
- **Release readiness:** Version consistency, environment configuration, provider prerequisites, migrations, packaging, signing/notarization where applicable, distribution status, recovery steps, and post-deployment checks. Distinguish local test coverage from native/live verification.

## Release text rules

- Follow current repository versioning and release-note rules. Propose version changes with reasons; do not invent independent platform versions where the project uses shared versioning.
- Commit and PR subjects: capitalized imperative, at most 72 characters, no trailing punctuation or conventional-commit prefix. Use an informative area prefix when appropriate.
- The proposed PR body ends with `Release Notes:` and exactly one concise bullet: `- <Area>: <Added|Fixed|Improved> <outcome>.` Use `- N/A` for no user-facing change. Nothing follows this section inside the PR body.
- Changelog: group Added, Fixed, and Improved outcomes under Features, Bug Fixes, and Improvements, then by title-cased area. Deduplicate and describe user outcomes. Follow the repository's actual release baseline and include only evidenced changes.
- Do not claim proposed work is already fixed, signed, deployed, or published. Label proposed artifacts explicitly and show their full intended wording, not a description of what they might say.
