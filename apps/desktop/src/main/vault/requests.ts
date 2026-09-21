import type {
  VaultCopyField,
  VaultItemInputDto,
  VaultPasskeyInputDto,
  VaultStorageMode,
  VaultStorageResolve,
  VaultBlobDto,
} from "@polymux/protocol";

export function vaultPassword(value: unknown, label = "Master password"): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} is required`);
  return value;
}

export function vaultId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Item id is required");
  return value.trim();
}

export function vaultIds(value: unknown): string[] {
  if (typeof value === "string") return [vaultId(value)];
  if (!Array.isArray(value) || value.length === 0) throw new Error("Item id is required");
  return value.map(vaultId);
}

export function vaultCopyField(value: unknown): VaultCopyField {
  if (
    value === "password" ||
    value === "username" ||
    value === "url" ||
    value === "totp" ||
    value === "notes" ||
    value === "recovery"
  )
    return value;
  throw new Error("Unknown vault field");
}

export function vaultItemInput(value: unknown): VaultItemInputDto {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Item is required");
  const input = value as Record<string, unknown>;
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) throw new Error("Title is required");
  const item: VaultItemInputDto = { title };
  if (typeof input.id === "string" && input.id.trim()) item.id = input.id.trim();
  if (typeof input.username === "string") item.username = input.username;
  if (typeof input.url === "string") item.url = input.url;
  if (typeof input.notes === "string") item.notes = input.notes;
  if (typeof input.groupName === "string") item.groupName = input.groupName;
  if (typeof input.password === "string") item.password = input.password;
  if (typeof input.totpSecret === "string") item.totpSecret = input.totpSecret;
  if (Array.isArray(input.recoveryCodes))
    item.recoveryCodes = input.recoveryCodes.filter((code): code is string => typeof code === "string");
  if (input.passkey === null) item.passkey = null;
  else if (input.passkey && typeof input.passkey === "object" && !Array.isArray(input.passkey)) {
    const passkey = input.passkey as Record<string, unknown>;
    const mapped: VaultPasskeyInputDto = {
      relyingParty: typeof passkey.relyingParty === "string" ? passkey.relyingParty : "",
      username: typeof passkey.username === "string" ? passkey.username : "",
      credentialId: typeof passkey.credentialId === "string" ? passkey.credentialId : "",
    };
    if (typeof passkey.userHandle === "string") mapped.userHandle = passkey.userHandle;
    if (typeof passkey.privateKeyPem === "string") mapped.privateKeyPem = passkey.privateKeyPem;
    item.passkey = mapped;
  }
  return item;
}

export function vaultStorageMode(value: unknown): VaultStorageMode {
  if (value === "local" || value === "account") return value;
  throw new Error("Choose This device or Account");
}

export function vaultStorageResolve(value: unknown): VaultStorageResolve | undefined {
  if (value == null || value === "") return undefined;
  if (value === "keep-local" || value === "keep-cloud") return value;
  throw new Error("Choose which vault to keep");
}

export function vaultBlob(value: unknown): VaultBlobDto {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Vault copy is required");
  const row = value as Record<string, unknown>;
  if (typeof row.bytes !== "string" || !row.bytes) throw new Error("Vault copy is required");
  const meta = row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
    ? row.meta as Record<string, unknown>
    : null;
  if (!meta || typeof meta.revision !== "number" || typeof meta.updatedAt !== "string")
    throw new Error("Vault copy is incomplete");
  return {
    bytes: row.bytes,
    meta: {
      revision: meta.revision,
      updatedAt: meta.updatedAt,
      checksum: typeof meta.checksum === "string" ? meta.checksum : "",
      dirty: meta.dirty === true,
      lastSyncedAt: typeof meta.lastSyncedAt === "string" ? meta.lastSyncedAt : null,
      storage: meta.storage === "local" ? "local" : "account",
    },
  };
}

export function vaultWebAuthnGet(value: unknown): {
  origin: string;
  rpId: string;
  challenge: string;
  allowCredentialIds?: string[];
  itemId?: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Passkey request is required");
  const input = value as Record<string, unknown>;
  const origin = typeof input.origin === "string" ? input.origin : "";
  const rpId = typeof input.rpId === "string" ? input.rpId : "";
  const challenge = typeof input.challenge === "string" ? input.challenge : "";
  if (!origin || !rpId || !challenge) throw new Error("Passkey request is incomplete");
  const request: {
    origin: string;
    rpId: string;
    challenge: string;
    allowCredentialIds?: string[];
    itemId?: string;
  } = {origin, rpId, challenge};
  if (Array.isArray(input.allowCredentialIds))
    request.allowCredentialIds = input.allowCredentialIds.filter((id): id is string => typeof id === "string");
  if (typeof input.itemId === "string" && input.itemId) request.itemId = input.itemId;
  return request;
}

export function vaultWebAuthnCreate(value: unknown): {
  origin: string;
  rpId: string;
  challenge: string;
  userName: string;
  userId: string;
  rpName?: string;
  userDisplayName?: string;
  excludeCredentialIds?: string[];
} {
  const base = vaultWebAuthnGet(value);
  const input = value as Record<string, unknown>;
  return {
    origin: base.origin,
    rpId: base.rpId,
    challenge: base.challenge,
    userName: typeof input.userName === "string" ? input.userName : "",
    userId: typeof input.userId === "string" ? input.userId : "",
    rpName: typeof input.rpName === "string" ? input.rpName : undefined,
    userDisplayName: typeof input.userDisplayName === "string" ? input.userDisplayName : undefined,
    excludeCredentialIds: Array.isArray(input.excludeCredentialIds)
      ? input.excludeCredentialIds.filter((id): id is string => typeof id === "string")
      : undefined,
  };
}
