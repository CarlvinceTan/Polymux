import type {RequestPermissionRequest, RequestPermissionResponse} from "@agentclientprotocol/sdk";
import type {DeviceAccessMode} from "@polymux/protocol";

/** Null means the device policy requires the user to choose an option. */
export function teamAcpPermissionResponse(
  access: DeviceAccessMode,
  request: Pick<RequestPermissionRequest, "options">,
): RequestPermissionResponse | null {
  if (access === "ask") return null;
  // Prefer a single-use response so a later device restriction remains effective.
  const kinds = access === "allow"
    ? ["allow_once", "allow_always"]
    : ["reject_once", "reject_always"];
  const option = kinds.map((kind) => request.options.find((item) => item.kind === kind)).find(Boolean);
  return option
    ? {outcome: {outcome: "selected", optionId: option.optionId}}
    : {outcome: {outcome: "cancelled"}};
}

/** Recheck after a dialog: changing or removing the bot revokes pending approval. */
export async function requestTeamAcpPermission(
  access: () => DeviceAccessMode,
  request: Pick<RequestPermissionRequest, "options">,
  ask: () => Promise<RequestPermissionResponse>,
): Promise<RequestPermissionResponse> {
  const automatic = teamAcpPermissionResponse(access(), request);
  if (automatic) return automatic;
  const chosen = await ask();
  return access() === "off" ? teamAcpPermissionResponse("off", request)! : chosen;
}
