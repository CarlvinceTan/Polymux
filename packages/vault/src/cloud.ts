import type { PolymuxAccountClient } from "./account.js";
import { vaultChecksum } from "./checksum.js";

export interface VaultCloudBlob {
  bytes: Uint8Array;
  revision: number;
  updatedAt: string;
  checksum: string;
}

export interface VaultCloudStore {
  available(): boolean;
  signedIn(): boolean;
  pull(): Promise<VaultCloudBlob | null>;
  push(blob: VaultCloudBlob): Promise<void>;
}

/** Physical bucket/table names predate the vault rename and stay as-is: they
 * live server-side, where renaming would orphan every existing account copy. */
export const VAULT_CLOUD_BUCKET = "locker";
export const VAULT_CLOUD_TABLE = "locker_vaults";
export const MISSING_CLOUD_VAULT = "This account has no vault in the cloud.";

/** Encrypted kdbx only. Metadata rows never hold secrets. */
export class FetchVaultCloud implements VaultCloudStore {
  readonly #account: PolymuxAccountClient;

  constructor(account: PolymuxAccountClient) {
    this.#account = account;
  }

  available(): boolean {
    return this.#account.available();
  }

  signedIn(): boolean {
    return this.#account.status().signedIn;
  }

  async pull(): Promise<VaultCloudBlob | null> {
    const userId = this.#account.userId();
    if (!this.signedIn() || !userId) return null;
    const rows = await this.#json<
      Array<{
        revision?: unknown;
        updated_at?: unknown;
        checksum?: unknown;
        object_name?: unknown;
        byte_size?: unknown;
      }>
    >(
      this.#account.restUrl(`rest/v1/${VAULT_CLOUD_TABLE}`, {
        select: "revision,updated_at,checksum,object_name,byte_size",
        user_id: `eq.${userId}`,
      }),
      { method: "GET" },
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return null;
    const revision = Number(row.revision);
    const checksum = typeof row.checksum === "string" ? row.checksum : "";
    const objectName =
      typeof row.object_name === "string" ? row.object_name : "";
    if (
      !Number.isSafeInteger(revision) ||
      revision < 1 ||
      !/^[a-f0-9]{64}$/.test(checksum) ||
      objectName !== vaultObjectName(revision, checksum)
    )
      throw new Error("The vault cloud metadata is invalid.");
    const response = await this.#account.authorizedFetch(
      this.#account.restUrl(
        `storage/v1/object/${VAULT_CLOUD_BUCKET}/${userId}/${objectName}`,
      ),
      { method: "GET" },
    );
    if (!response.ok)
      throw new Error(
        cloudError(
          await readError(response),
          "The vault could not be downloaded.",
        ),
      );
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (
      vaultChecksum(bytes) !== checksum ||
      Number(row.byte_size) !== bytes.byteLength
    )
      throw new Error("The vault cloud copy does not match its metadata.");
    return {
      bytes,
      revision,
      updatedAt:
        typeof row.updated_at === "string"
          ? row.updated_at
          : new Date().toISOString(),
      checksum,
    };
  }

  async push(blob: VaultCloudBlob): Promise<void> {
    const userId = this.#account.userId();
    if (!this.signedIn() || !userId)
      throw new Error("Sign in to sync this vault.");
    const checksum = vaultChecksum(blob.bytes);
    if (checksum !== blob.checksum)
      throw new Error("The vault checksum does not match its contents.");
    const objectName = vaultObjectName(blob.revision, checksum);
    const upload = await this.#account.authorizedFetch(
      this.#account.restUrl(
        `storage/v1/object/${VAULT_CLOUD_BUCKET}/${userId}/${objectName}`,
      ),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "x-upsert": "false",
        },
        body: blob.bytes as BodyInit,
      },
    );
    if (!upload.ok) {
      const message = await readError(upload);
      if (upload.status !== 409 && !/already exists|duplicate/i.test(message))
        throw new Error(
          cloudError(message, "The vault could not be uploaded."),
        );
      await this.#validateObject(
        userId,
        objectName,
        checksum,
        blob.bytes.byteLength,
      );
    }
    const upsert = await this.#account.authorizedFetch(
      this.#account.restUrl(`rest/v1/${VAULT_CLOUD_TABLE}`, {
        on_conflict: "user_id",
      }),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify({
          user_id: userId,
          revision: blob.revision,
          updated_at: blob.updatedAt,
          checksum: blob.checksum,
          object_name: objectName,
          byte_size: blob.bytes.byteLength,
        }),
      },
    );
    if (!upsert.ok) throw new Error(cloudError(await readError(upsert)));
  }

  async #json<T>(url: string, init: RequestInit): Promise<T> {
    const response = await this.#account.authorizedFetch(url, init);
    if (!response.ok) throw new Error(cloudError(await readError(response)));
    return (await response.json()) as T;
  }

  async #validateObject(
    userId: string,
    objectName: string,
    checksum: string,
    byteSize: number,
  ): Promise<void> {
    const response = await this.#account.authorizedFetch(
      this.#account.restUrl(
        `storage/v1/object/${VAULT_CLOUD_BUCKET}/${userId}/${objectName}`,
      ),
      { method: "GET" },
    );
    if (!response.ok)
      throw new Error(
        cloudError(
          await readError(response),
          "The vault could not be downloaded.",
        ),
      );
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== byteSize || vaultChecksum(bytes) !== checksum)
      throw new Error(
        "The existing vault cloud object does not match the upload.",
      );
  }
}

export function vaultObjectName(revision: number, checksum: string): string {
  if (
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    !/^[a-f0-9]{64}$/.test(checksum)
  )
    throw new Error("The vault cloud metadata is invalid.");
  return `${revision}-${checksum}.kdbx`;
}

export function cloudError(message: string, fallback?: string): string {
  if (/bucket not found|not found/i.test(message))
    return "Vault cloud storage is not set up on this account yet.";
  const cleaned = message.replace(/^(StorageApiError|PostgrestError):\s*/i, "");
  return cleaned || fallback || "The vault could not be synced.";
}

async function readError(response: Response): Promise<string> {
  try {
    const value = (await response.json()) as {
      error?: string;
      error_description?: string;
      message?: string;
      msg?: string;
    };
    return (
      value.error_description || value.message || value.msg || value.error || ""
    );
  } catch {
    return "";
  }
}
