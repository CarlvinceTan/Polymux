/** Shared Vault contract for desktop IPC, the browser extension, and the Mobile Host. */

export const VAULT_HOST_METHODS = [
  "vault.status",
  "vault.create",
  "vault.unlock",
  "vault.lock",
  "vault.list",
  "vault.reveal",
  "vault.totp",
  "vault.save",
  "vault.remove",
  "vault.restore",
  "vault.purge",
  "vault.emptyTrash",
  "vault.pin",
  "vault.reorder",
  "vault.changePassword",
  "vault.codes",
  "vault.otpauth",
  "vault.copy",
  "vault.sync",
  "vault.setStorage",
  "vault.export",
  "vault.import",
] as const;

export type VaultHostMethod = (typeof VAULT_HOST_METHODS)[number];

/** Loopback routes the existing Polymux extension uses when desktop is running. */
export const VAULT_SURFACE_PATHS = {
  status: "/v1/vault/status",
  unlock: "/v1/vault/unlock",
  lock: "/v1/vault/lock",
  matches: "/v1/vault/matches",
  fill: "/v1/vault/fill",
  save: "/v1/vault/save",
  totp: "/v1/vault/totp",
  export: "/v1/vault/export",
  import: "/v1/vault/import",
  passkeys: "/v1/vault/passkeys",
  passkeyGet: "/v1/vault/passkey/get",
  passkeyCreate: "/v1/vault/passkey/create",
} as const;

export const VAULT_SURFACE_CAPABILITY = "vault-fill-v1";
