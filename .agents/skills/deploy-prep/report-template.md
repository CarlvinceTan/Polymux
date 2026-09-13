# Deploy prep report format

Use short, plain-language sentences. Each review concern has its own section with one concise bullet explaining the intent, outcome, or next step. Use additional bullets only for material blockers. Keep detailed evidence in a linked supporting report when necessary; the summary must still state verification gaps.

## Overall

**Ready / Blocked / Unverified** — One sentence describing progress and the next necessary step. Ready means ready for the proposed release action, not already deployed. Optional cleanup suggestions alone are not blockers.

## Platforms

| Platform | Source version | Built/deployed version | Signing | Progress |
| --- | --- | --- | --- | --- |
| Each actual platform or distributable | Verified version or Unverified | Distinguish build from deployment; use Unverified when unknown | Signed / Unsigned / Unverified / N/A | One concise sentence on readiness or the remaining gap |

Split desktop operating systems when build/signing status differs. Include mobile, site, extension, CLI, or other deliverables only where present. Do not infer artifact signing from configuration; name the checked artifact briefly when relevant.

## Security

- **Pass / Fixed / Blocked / Suggested / Unverified / N/A:** One sentence.

## Legacy code

- **Status:** One sentence.

## Migrations

- **Status:** One sentence.

## Organisation

- **Status:** One sentence.

## Naming

- **Status:** One sentence.

## UI components

- **Status:** One sentence.

## UI verification

- **Status:** State what was visually checked and what remains unverified.

## Performance and caching

- **Status:** One sentence on responsiveness, caching, and remaining evidence gaps.

## Reliability

- **Status:** One sentence.

## Release readiness

- **Status:** One sentence.

## Version changes — Proposed

- **Platform: current → proposed.** Brief reason and intended file. Say No change if appropriate; mark an unresolved version decision Unverified.

## Changelog — Proposed

Destination: actual intended file or release page. Show the exact complete proposed entries with the repository's grouping. Do not use placeholders in a finished report.

## Commit message — Proposed

Show the exact subject and optional body in a copyable block.

## Pull request — Proposed

Show the exact title and complete body separately. Keep the required Release Notes section last inside the body.

## Deployment plan — Proposed

- List the actual targets in order, including any migration prerequisites, recovery procedure, and post-deployment checks. Keep it concise; identify any step requiring separate authorization.

## Remaining blockers

- Only unresolved blockers or required verification gaps, each with a concrete next step. Say None if verified clear.

Use **Written locally** instead of **Proposed** only for text actually saved to its intended destination. Label blocked preparation **Blocked** and explain what evidence is missing. Always display the exact intended release text in its own section, even if also saved elsewhere. Never mark a skipped check Pass.
