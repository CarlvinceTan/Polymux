---
name: skill-creator
description: Create or improve skill structure, instructions, resources, trigger descriptions, and meaningful Polymux-facing metadata. Use when authoring a new skill, restructuring an existing skill, designing reusable scripts, references, assets, display names, prompts, or icons, or refining when a skill should activate. For personal-skill staging, behavioral validation, approval, history, upstream merges, and promotion, use skill-maintenance.
metadata:
  short-description: Create or improve a skill
author: Polymux
category: Skills
---

# Skill Creator

Create concise skills containing only the non-obvious knowledge, stable
preferences, fragile workflows, and reusable resources needed for reliable work.

## Authoring principles

- Use progressive disclosure: keep the always-loaded `SKILL.md` focused on core
  routing and procedure, and put task-specific detail in directly linked
  references.
- Match freedom to risk: use prose for flexible judgment, parameterized scripts
  for preferred patterns, and deterministic scripts for fragile operations.
- Keep activation scope in the frontmatter `description`; include positive
  triggers and important nearby boundaries.
- Avoid duplicating instructions between the core and references.
- Add only resources the workflow consumes. Test every changed script.
- Treat `polymux.yaml` as part of the finished user experience, not optional
  cleanup.

## Structure and resources

Every skill requires `SKILL.md`. Add only the resources it uses:

- `scripts/` for deterministic or repeatedly reused operations;
- `references/` for detailed or variant-specific material loaded on demand;
- `assets/` for templates, icons, fonts, and files used in outputs;
- `polymux.yaml` for the display name shown in Polymux.

Keep the core workflow and routing in `SKILL.md`. Move schemas, provider
details, long examples, and conditional variants into directly linked
references. Do not add generic README, changelog, installation, or quick
reference files that the workflow never consumes.

## Workflow

1. **Understand**
   - Identify representative requests that should trigger the skill and nearby
     requests that should not.
   - Read an existing skill and every required resource before restructuring it.
2. **Plan**
   - Decide what belongs in `SKILL.md`, `scripts/`, `references/`, and `assets/`.
   - Plan a distinct, understandable Polymux display name, short description,
     default prompt, and purpose-relevant icon treatment.
   - Preserve stable behavior and interfaces unless the user requests a change.
3. **Initialize or stage**
   - For a new skill, use `scripts/init_skill.mjs`; do not hand-build boilerplate.
   - For a personal skill, load `skill-maintenance`, create or stage the
     candidate first, and initialize only in that inactive location. Never
     initialize directly in the live skill root.
4. **Implement**
   - Write imperative, task-focused instructions.
   - Keep references one level from `SKILL.md` and state exactly when to read
     each one.
   - Remove all unused placeholders and resources.
   - Read [references/polymux_yaml.md](references/polymux_yaml.md), then create or
     update `polymux.yaml` with a clear, unique display name. Skip the file when
     the folder name already title-cases into that name.
5. **Validate the authored content**
   - Run `scripts/quick_validate.mjs <skill-folder>`.
   - Exercise every changed script and at least one representative workflow.
   - For a new, complex, or substantially revised skill, use permitted fresh,
     isolated test runs to probe a representative request, a nearby boundary,
     and at least one plausible unseen scenario. Give each probe only the skill
     and task-local artifacts; do not reveal the expected answer or suspected
     defect.
   - Run bounded, side-effect-free probes automatically when they need no new
     authority. Ask first if testing may be slow or costly, requires another
     approval, or could touch a real account, device, GUI, or external system.
     Report material failures and resulting changes; summarize successful
     coverage without narrating every probe.
   - For a personal skill, hand the candidate to `skill-maintenance` for the
     complete behavioral gate and deployment decision.

## Ownership boundary

`skill-creator` owns authoring decisions: scope, triggers, structure,
instructions, resources, initialization, basic deterministic validation, and
lightweight discovery probes used to improve the candidate.

`skill-maintenance` exclusively owns personal-skill staging, approved-baseline
comparison, behavioral contracts, repeated probes, reports, intentional-change
approval, Git history, upstream merging, and promotion. Do not duplicate those
systems or run a separate evaluator stack from this skill.
