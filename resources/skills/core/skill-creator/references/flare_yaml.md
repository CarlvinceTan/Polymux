# flare.yaml fields

`flare.yaml` sits beside `SKILL.md` at the skill root and is the manifest
Polymux reads for a skill's display identity. The harness reads it, not the
agent, and it is optional: a skill without one is listed under a title derived
from its folder name.

## Full example

```yaml
display_name: "Optional user-facing name"
```

## Field descriptions and constraints

- Quote all string values. Keep keys unquoted.
- `display_name`: human-facing title shown in Polymux's skill lists and chips.
  It is the only field Polymux reads; do not invent others, because nothing
  consumes them.

## Polymux-facing quality rules

- Create `flare.yaml` for every user-facing skill whose folder name does not
  already title-case into the name a person would expect, and recheck it after a
  rename or a material change of scope.
- Make `display_name` natural, distinctive, and understandable without reading
  the folder name.
