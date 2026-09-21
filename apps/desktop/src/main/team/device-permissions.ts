export interface DeviceRequestAccess {
  allowed: boolean;
  requiresApproval: boolean;
}

/** Request-time policy may change while a device request or dialog is pending. */
export async function authorizeDeviceRequest(
  access: () => Promise<DeviceRequestAccess>,
  ask: () => Promise<boolean>,
): Promise<{approved: boolean; approvedByUser: boolean}> {
  const current = await access();
  if (!current.allowed) return {approved: false, approvedByUser: false};
  if (!current.requiresApproval) return {approved: true, approvedByUser: false};
  if (!await ask()) return {approved: false, approvedByUser: false};
  const afterPrompt = await access();
  return {approved: afterPrompt.allowed, approvedByUser: afterPrompt.allowed};
}
