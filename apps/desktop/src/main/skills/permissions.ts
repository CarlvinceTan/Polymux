import type { Skill } from "@polymux/agent";
import type { AppPermissionKind } from "@polymux/protocol";
import { isAppPermissionKind } from "@polymux/protocol";

/**
 * The grants a skill declared in its own frontmatter, as `permissions:`.
 * Anything unrecognised is dropped rather than reported: the list is a skill
 * author's, written against whatever host they had in mind, and a name this
 * build has never heard of is not a reason to refuse to load the skill.
 */
export function declaredPermissions(skill: Skill): AppPermissionKind[] {
  const seen = new Set<AppPermissionKind>();
  for (const entry of skill.permissions ?? []) {
    const kind = entry.trim().toLowerCase();
    if (isAppPermissionKind(kind)) seen.add(kind);
  }
  return [...seen];
}
