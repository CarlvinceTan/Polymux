export type VaultStorage = "local" | "account";

export interface VaultMeta {
  revision: number;
  updatedAt: string;
  checksum: string;
  dirty: boolean;
  lastSyncedAt: string | null;
  /** Account is the default when the field is missing. */
  storage: VaultStorage;
}

export function emptyMeta(): VaultMeta {
  return {
    revision: 0,
    updatedAt: new Date(0).toISOString(),
    checksum: "",
    dirty: false,
    lastSyncedAt: null,
    storage: "account",
  };
}

export function parseVaultMeta(value: unknown): VaultMeta | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.revision !== "number" || !Number.isInteger(row.revision) || row.revision < 0)
    return null;
  if (typeof row.updatedAt !== "string" || typeof row.checksum !== "string") return null;
  return {
    revision: row.revision,
    updatedAt: row.updatedAt,
    checksum: row.checksum,
    dirty: row.dirty === true,
    lastSyncedAt: typeof row.lastSyncedAt === "string" ? row.lastSyncedAt : null,
    storage: row.storage === "local" ? "local" : "account",
  };
}
