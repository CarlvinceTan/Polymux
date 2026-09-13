import {
  vaultChecksum,
  vaultObjectName,
  type LockerCloudBlob,
  type LockerCloudStore,
} from "@polymux/locker";
import type { AccountService } from "../account/account-service.js";

export type { LockerCloudBlob, LockerCloudStore };
export { vaultChecksum };

const BUCKET = "locker";

/** Encrypted kdbx only. Metadata rows never hold secrets. */
export class SupabaseLockerCloud implements LockerCloudStore {
  readonly #account: AccountService;

  constructor(account: AccountService) {
    this.#account = account;
  }

  available(): boolean {
    return this.#account.status().available;
  }

  signedIn(): boolean {
    return this.#account.status().signedIn;
  }

  async pull(): Promise<LockerCloudBlob | null> {
    const client = this.#account.client;
    const userId = this.#account.status().profile?.userId;
    if (!client || !userId) return null;
    const { data: row, error: rowError } = await client
      .from("locker_vaults")
      .select("revision, updated_at, checksum, object_name, byte_size")
      .eq("user_id", userId)
      .maybeSingle();
    if (rowError) throw new Error(cloudError(rowError.message));
    if (!row) return null;
    const revision = Number(row.revision);
    const checksum = typeof row.checksum === "string" ? row.checksum : "";
    const objectName =
      typeof row.object_name === "string" ? row.object_name : "";
    if (
      !Number.isSafeInteger(revision) ||
      revision < 1 ||
      objectName !== vaultObjectName(revision, checksum)
    )
      throw new Error("The locker cloud metadata is invalid.");
    const { data, error } = await client.storage
      .from(BUCKET)
      .download(`${userId}/${objectName}`);
    if (error || !data)
      throw new Error(
        cloudError(error?.message ?? "The locker could not be downloaded."),
      );
    const bytes = new Uint8Array(await data.arrayBuffer());
    if (
      vaultChecksum(bytes) !== checksum ||
      Number(row.byte_size) !== bytes.byteLength
    )
      throw new Error("The locker cloud copy does not match its metadata.");
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

  async push(blob: LockerCloudBlob): Promise<void> {
    const client = this.#account.client;
    const userId = this.#account.status().profile?.userId;
    if (!client || !userId) throw new Error("Sign in to sync this locker.");
    const checksum = vaultChecksum(blob.bytes);
    if (checksum !== blob.checksum)
      throw new Error("The locker checksum does not match its contents.");
    const objectName = vaultObjectName(blob.revision, checksum);
    const { error: uploadError } = await client.storage
      .from(BUCKET)
      .upload(`${userId}/${objectName}`, blob.bytes, {
        upsert: false,
        contentType: "application/octet-stream",
      });
    if (uploadError) {
      if (!/already exists|duplicate|409/i.test(uploadError.message))
        throw new Error(cloudError(uploadError.message));
      const { data, error } = await client.storage
        .from(BUCKET)
        .download(`${userId}/${objectName}`);
      if (error || !data)
        throw new Error(
          cloudError(error?.message ?? "The locker could not be downloaded."),
        );
      const existing = new Uint8Array(await data.arrayBuffer());
      if (
        existing.byteLength !== blob.bytes.byteLength ||
        vaultChecksum(existing) !== checksum
      )
        throw new Error(
          "The existing locker cloud object does not match the upload.",
        );
    }
    const { error: rowError } = await client.from("locker_vaults").upsert({
      user_id: userId,
      revision: blob.revision,
      updated_at: blob.updatedAt,
      checksum: blob.checksum,
      object_name: objectName,
      byte_size: blob.bytes.byteLength,
    });
    if (rowError) throw new Error(cloudError(rowError.message));
  }
}

function cloudError(message: string): string {
  if (/bucket not found|not found/i.test(message))
    return "Locker cloud storage is not set up on this account yet.";
  return message.replace(/^(StorageApiError|PostgrestError):\s*/i, "");
}
