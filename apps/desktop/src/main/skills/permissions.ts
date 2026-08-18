import type { Skill } from "@flareai/agent";
import type {
  AppPermissionKind,
  GeneralSettingsDto,
  SystemPermissionStatus,
} from "@flareai/protocol";
import { isAppPermissionKind } from "@flareai/protocol";

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

export interface SkillPermissionNeed {
  kinds: AppPermissionKind[];
  /** Whether the master switch alone is what is holding the grants back. */
  switchedOff: boolean;
}

/**
 * Which of a set of declared grants are worth asking macOS for right now.
 *
 * The two switches are read here rather than at the call sites so they mean
 * the same thing everywhere: the master switch is a refusal to *use* app
 * grants at all, and a per-kind switch is the same refusal narrowed to one —
 * neither takes a grant back, so neither is a reason to prompt. What is left
 * is asked for only when macOS has not already decided, because it shows its
 * dialog once and answering again from the same denial only costs a process.
 */
export function permissionsToRequest(
  declared: Iterable<AppPermissionKind>,
  settings: Pick<GeneralSettingsDto, "appPermissionsEnabled" | "permissions">,
  status: (kind: AppPermissionKind) => SystemPermissionStatus,
): SkillPermissionNeed {
  const wanted = [...new Set(declared)];
  if (!settings.appPermissionsEnabled) return { kinds: [], switchedOff: true };
  const allowed = wanted.filter((kind) => settings.permissions[kind]);
  return {
    kinds: allowed.filter((kind) => status(kind) === "not-determined"),
    switchedOff: allowed.length < wanted.length,
  };
}
