---
name: skill-maintenance
description: Safely inspect, stage, compare, validate, install, update, or remove personal Midas skills. Use for changes under ~/.midas/skills or ~/.agents/skills, especially when an installed skill may have local customizations.
allowed-tools: read write edit bash
---

# Skill Maintenance

Never edit an installed personal skill in place. Build and validate an isolated
candidate first so the live version remains recoverable.

## Staged workflow

1. Resolve the exact live skill and record its path. Refuse ambiguous names.
2. Create a candidate under `~/.midas/skill-staging/<skill-name>/` or a temporary
   directory outside the live skills roots.
3. Copy the complete live skill into the candidate when updating it. Preserve
   scripts, references, assets, permissions, and user customizations.
4. Make all edits in the candidate. Compare it with the live version and call
   out behavior or safety changes explicitly.
5. Validate frontmatter, referenced files, scripts, and representative trigger
   cases. Run any skill-specific tests.
6. Show the user the candidate result and obtain explicit approval before
   replacing, installing, or deleting the live skill.
7. Promote atomically where practical, retain a recoverable backup, reload the
   Midas skill catalog, and verify the installed copy matches the approved
   candidate.

Do not let a generated candidate modify the live skill, approve itself, weaken
its own safety boundaries, or delete the only recoverable copy. Official skills
shipped inside the Midas app are read-only; customize them by creating an
overriding personal skill with the same name.

