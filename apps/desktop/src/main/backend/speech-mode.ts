import type {ModelRole} from "@polymux/protocol";

/** A speech-role boundary supplies the automatic value. Other role changes
 * leave the user's explicit speech-mode choice alone. */
export function speechModeAfterRoleChange(
  role: ModelRole,
  assigned: boolean,
  current: boolean,
): boolean {
  return role === "speech" ? assigned : current;
}
