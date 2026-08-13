---
name: skill-creator
description: Create or improve Midas skills, including SKILL.md instructions, reusable scripts, references, assets, and user-facing metadata. Use when authoring a new skill or restructuring an existing one.
allowed-tools: read write edit bash
---

# Skill Creator

Create skills that are concise, discoverable, and usable with the tools Midas
actually exposes.

## Structure

Every skill is a directory containing `SKILL.md`:

```text
skill-name/
├── SKILL.md
├── agents/openai.yaml      # recommended metadata
├── scripts/                # deterministic reusable operations
├── references/             # detailed guidance loaded when needed
└── assets/                 # templates and output resources
```

Use lowercase kebab-case names. Frontmatter must include `name` and a concrete
third-person `description` that says both what the skill does and when it
should activate.

## Workflow

1. Identify two or three representative user requests and the capabilities the
   skill can genuinely use.
2. Inspect related skills and reuse proven patterns without retaining host-only
   tools or paths.
3. Write the shortest SKILL.md that captures routing, safety, workflow, and
   completion checks. Move detail to references and deterministic logic to
   scripts.
4. Use paths relative to the skill directory and explain when each supporting
   resource should be read or run.
5. Validate frontmatter, naming, referenced files, executable scripts, and the
   representative requests.

Avoid generic filler, duplicate documentation, deep reference chains, and
claims about integrations that are not installed.

