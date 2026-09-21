import kdbxweb from "kdbxweb";
import { parsePasswordCsv, type CsvLogin } from "./csv.js";
import { installArgon2 } from "./crypto.js";
import {
  generateTotp,
  otpauthUrl,
  parseOtpauth,
  type TotpCode,
  type TotpParams,
} from "./totp.js";

export const RECOVERY_FIELD = "RecoveryCodes";
export const OTP_FIELD = "otp";
export const TOTP_SEED_FIELD = "TOTP Seed";
export const TIME_OTP_SECRET = "TimeOtp-Secret-Base32";
export const TIME_OTP_PERIOD = "TimeOtp-Period";
export const TIME_OTP_LENGTH = "TimeOtp-Length";
export const TIME_OTP_ALGORITHM = "TimeOtp-Algorithm";
/** KeePassXC-compatible passkey fields. The private key is PKCS#8 PEM of an ES256 P-256 key. */
export const PASSKEY_RP = "KPEX_PASSKEY_RELYING_PARTY";
export const PASSKEY_USERNAME = "KPEX_PASSKEY_USERNAME";
export const PASSKEY_CREDENTIAL_ID = "KPEX_PASSKEY_CREDENTIAL_ID";
export const PASSKEY_USER_HANDLE = "KPEX_PASSKEY_USER_HANDLE";
export const PASSKEY_PRIVATE_KEY = "KPEX_PASSKEY_PRIVATE_KEY_PEM";
/** Vault-only pin and grid order. KeePass stores them as ordinary extra fields. */
export const PIN_FIELD = "PolymuxPinned";
export const ORDER_FIELD = "PolymuxOrder";

export const WRONG_PASSWORD = "Wrong master password";
export const LOCKED = "Vault is locked";
export const MISSING_ITEM = "That item is not in the vault";

export interface VaultGroup {
  id: string;
  name: string;
  parentId: string | null;
}

export interface VaultItem {
  id: string;
  title: string;
  username: string;
  url: string;
  notes: string;
  groupId: string;
  groupName: string;
  hasPassword: boolean;
  hasTotp: boolean;
  hasRecoveryCodes: boolean;
  hasPasskey: boolean;
  pinned: boolean;
  sortIndex: number;
  updatedAt: string | null;
}

export interface VaultPasskey {
  relyingParty: string;
  username: string;
  credentialId: string;
  userHandle: string;
  privateKeyPem: string;
}

export interface VaultSecrets {
  password: string;
  totp: TotpParams | null;
  recoveryCodes: string[];
  passkey: VaultPasskey | null;
}

export interface VaultItemInput {
  id?: string;
  title: string;
  username?: string;
  url?: string;
  notes?: string;
  groupName?: string;
  password?: string;
  totpSecret?: string;
  recoveryCodes?: string[];
  passkey?: {
    relyingParty: string;
    username: string;
    credentialId: string;
    userHandle?: string;
    privateKeyPem?: string;
  } | null;
}

export interface VaultImportResult {
  imported: number;
  skipped: number;
  problems: string[];
}

export async function createDatabase(password: string, name = "Vault"): Promise<kdbxweb.Kdbx> {
  installArgon2();
  const credentials = await credentialsFromPassword(password);
  return kdbxweb.Kdbx.create(credentials, name);
}

export async function loadDatabase(bytes: ArrayBuffer, password: string): Promise<kdbxweb.Kdbx> {
  installArgon2();
  const credentials = await credentialsFromPassword(password);
  try {
    return await kdbxweb.Kdbx.load(bytes, credentials);
  } catch (reason) {
    if (isInvalidKey(reason)) throw new Error(WRONG_PASSWORD);
    throw reason;
  }
}

export async function saveDatabase(db: kdbxweb.Kdbx): Promise<Uint8Array> {
  installArgon2();
  db.cleanup({ historyRules: true, customIcons: true, binaries: true });
  const buffer = await db.save();
  return new Uint8Array(buffer);
}

export function listGroups(db: kdbxweb.Kdbx): VaultGroup[] {
  const root = db.getDefaultGroup();
  const groups: VaultGroup[] = [];
  for (const group of visibleGroups(db)) {
    groups.push({
      id: group.uuid.toString(),
      name: group.name?.trim() || "Group",
      parentId:
        !group.parentGroup || group.uuid.equals(root.uuid)
          ? null
          : group.parentGroup.uuid.toString(),
    });
  }
  return groups;
}

export function listItems(db: kdbxweb.Kdbx): VaultItem[] {
  const items: VaultItem[] = [];
  for (const group of visibleGroups(db)) {
    for (const entry of group.entries) {
      items.push(summarize(entry, group));
    }
  }
  items.sort(compareItems);
  return items;
}

export function listTrash(db: kdbxweb.Kdbx): VaultItem[] {
  const items: VaultItem[] = [];
  for (const found of trashEntries(db)) {
    items.push(summarize(found.entry, found.group));
  }
  items.sort((a, b) => a.title.localeCompare(b.title) || a.username.localeCompare(b.username));
  return items;
}

export function readItem(db: kdbxweb.Kdbx, id: string): VaultItem | null {
  const found = findEntry(db, id);
  return found ? summarize(found.entry, found.group) : null;
}

export function readSecrets(db: kdbxweb.Kdbx, id: string): VaultSecrets {
  const found = findEntry(db, id);
  if (!found) throw new Error(MISSING_ITEM);
  const { entry } = found;
  return {
    password: fieldText(entry, "Password"),
    totp: totpParams(entry),
    recoveryCodes: parseRecoveryCodes(fieldText(entry, RECOVERY_FIELD)),
    passkey: readPasskey(entry),
  };
}

export function totpFor(db: kdbxweb.Kdbx, id: string, now = Date.now()): TotpCode | null {
  const found = findEntry(db, id);
  if (!found) throw new Error(MISSING_ITEM);
  const params = totpParams(found.entry);
  return params ? generateTotp(params, now) : null;
}

export function listTotp(db: kdbxweb.Kdbx, now = Date.now()): Array<TotpCode & { id: string }> {
  const codes: Array<TotpCode & { id: string }> = [];
  for (const item of listItems(db)) {
    if (!item.hasTotp) continue;
    const totp = totpFor(db, item.id, now);
    if (totp) codes.push({ id: item.id, ...totp });
  }
  return codes;
}

export function otpauthFor(db: kdbxweb.Kdbx, id: string): string | null {
  const found = findEntry(db, id) ?? findTrashed(db, id);
  if (!found) throw new Error(MISSING_ITEM);
  const params = totpParams(found.entry);
  return params ? otpauthUrl(params) : null;
}

export async function changeMasterPassword(db: kdbxweb.Kdbx, password: string): Promise<void> {
  installArgon2();
  await db.credentials.setPassword(kdbxweb.ProtectedValue.fromString(password));
}

export function upsertItem(db: kdbxweb.Kdbx, input: VaultItemInput): string {
  const group = groupNamed(db, input.groupName);
  let entry: kdbxweb.KdbxEntry;
  if (input.id) {
    const found = findEntry(db, input.id);
    if (!found) throw new Error(MISSING_ITEM);
    entry = found.entry;
    entry.pushHistory();
    if (found.group.uuid.toString() !== group.uuid.toString()) db.move(entry, group);
  } else {
    entry = db.createEntry(group);
  }
  entry.fields.set("Title", input.title.trim() || "Untitled");
  entry.fields.set("UserName", input.username?.trim() ?? "");
  entry.fields.set("URL", input.url?.trim() ?? "");
  entry.fields.set("Notes", input.notes ?? "");
  if (input.password !== undefined)
    entry.fields.set("Password", kdbxweb.ProtectedValue.fromString(input.password));
  if (input.totpSecret !== undefined) writeTotp(entry, input.totpSecret);
  if (input.recoveryCodes !== undefined)
    writeProtected(entry, RECOVERY_FIELD, formatRecoveryCodes(input.recoveryCodes));
  if (input.passkey !== undefined) writePasskey(entry, input.passkey);
  entry.times.update();
  return entry.uuid.toString();
}

export function removeItem(db: kdbxweb.Kdbx, id: string): boolean {
  const found = findEntry(db, id);
  if (!found) return false;
  db.remove(found.entry);
  return true;
}

export function restoreItem(db: kdbxweb.Kdbx, id: string): boolean {
  const found = findTrashed(db, id);
  if (!found) return false;
  const previous = found.entry.previousParentGroup
    ? db.getGroup(found.entry.previousParentGroup)
    : undefined;
  const target =
    previous && !groupIsTrash(db, previous) ? previous : db.getDefaultGroup();
  db.move(found.entry, target);
  found.entry.times.update();
  return true;
}

export function purgeItem(db: kdbxweb.Kdbx, id: string): boolean {
  const found = findTrashed(db, id);
  if (!found) return false;
  db.move(found.entry, undefined);
  return true;
}

export function emptyTrash(db: kdbxweb.Kdbx): number {
  const ids = listTrash(db).map((item) => item.id);
  for (const id of ids) purgeItem(db, id);
  return ids.length;
}

export function setPinned(db: kdbxweb.Kdbx, ids: string[], pinned: boolean): number {
  let changed = 0;
  for (const id of ids) {
    const found = findEntry(db, id);
    if (!found) continue;
    if (pinned) found.entry.fields.set(PIN_FIELD, "1");
    else found.entry.fields.delete(PIN_FIELD);
    found.entry.times.update();
    changed += 1;
  }
  return changed;
}

export function reorderItems(db: kdbxweb.Kdbx, ids: string[]): void {
  const known = new Set(listItems(db).map((item) => item.id));
  const ordered = ids.filter((id) => known.has(id));
  const rest = [...known].filter((id) => !ordered.includes(id));
  [...ordered, ...rest].forEach((id, index) => {
    const found = findEntry(db, id);
    if (!found) return;
    found.entry.fields.set(ORDER_FIELD, String(index));
    found.entry.times.update();
  });
}

export function importCsvLogins(db: kdbxweb.Kdbx, text: string): VaultImportResult {
  const parsed = parsePasswordCsv(text);
  const importedGroup = groupNamed(db, "Imported");
  let imported = 0;
  for (const login of parsed.logins) {
    writeLogin(db, login, importedGroup);
    imported += 1;
  }
  return { imported, skipped: parsed.problems.length, problems: parsed.problems };
}

export async function importKdbxFile(
  db: kdbxweb.Kdbx,
  bytes: ArrayBuffer,
  password: string,
  folderName: string,
): Promise<VaultImportResult> {
  const source = await loadDatabase(bytes, password);
  const target = groupNamed(db, folderName.trim() || "Imported");
  let imported = 0;
  for (const group of visibleGroups(source)) {
    const destination = group.uuid.equals(source.getDefaultGroup().uuid)
      ? target
      : nestedGroup(db, target, group.name?.trim() || "Group");
    for (const entry of group.entries) {
      db.importEntry(entry, destination, source);
      imported += 1;
    }
  }
  return { imported, skipped: 0, problems: [] };
}

async function credentialsFromPassword(password: string): Promise<kdbxweb.KdbxCredentials> {
  const credentials = new kdbxweb.KdbxCredentials(
    kdbxweb.ProtectedValue.fromString(password),
  );
  await credentials.ready;
  return credentials;
}

function isInvalidKey(reason: unknown): boolean {
  return Boolean(
    reason &&
      typeof reason === "object" &&
      "code" in reason &&
      (reason as { code: string }).code === kdbxweb.Consts.ErrorCodes.InvalidKey,
  );
}

function visibleGroups(db: kdbxweb.Kdbx): kdbxweb.KdbxGroup[] {
  const bin = db.meta.recycleBinUuid;
  const groups: kdbxweb.KdbxGroup[] = [];
  for (const group of db.getDefaultGroup().allGroups()) {
    if (bin && group.uuid.equals(bin)) continue;
    if (bin && group.parentGroup && ancestryHas(group, bin)) continue;
    groups.push(group);
  }
  return groups;
}

function recycleBin(db: kdbxweb.Kdbx): kdbxweb.KdbxGroup | undefined {
  const bin = db.meta.recycleBinUuid;
  return bin ? db.getGroup(bin) : undefined;
}

function groupIsTrash(db: kdbxweb.Kdbx, group: kdbxweb.KdbxGroup): boolean {
  const bin = db.meta.recycleBinUuid;
  if (!bin) return false;
  return group.uuid.equals(bin) || ancestryHas(group, bin);
}

function trashEntries(
  db: kdbxweb.Kdbx,
): { entry: kdbxweb.KdbxEntry; group: kdbxweb.KdbxGroup }[] {
  const bin = recycleBin(db);
  if (!bin) return [];
  const found: { entry: kdbxweb.KdbxEntry; group: kdbxweb.KdbxGroup }[] = [];
  const walk = (group: kdbxweb.KdbxGroup) => {
    for (const entry of group.entries) found.push({ entry, group });
    for (const child of group.groups) walk(child);
  };
  walk(bin);
  return found;
}

function ancestryHas(group: kdbxweb.KdbxGroup, uuid: kdbxweb.KdbxUuid): boolean {
  let current: kdbxweb.KdbxGroup | undefined = group;
  while (current) {
    if (current.uuid.equals(uuid)) return true;
    current = current.parentGroup;
  }
  return false;
}

function findEntry(
  db: kdbxweb.Kdbx,
  id: string,
): { entry: kdbxweb.KdbxEntry; group: kdbxweb.KdbxGroup } | null {
  for (const group of visibleGroups(db)) {
    for (const entry of group.entries) {
      if (entry.uuid.toString() === id || entry.uuid.id === id) return { entry, group };
    }
  }
  return null;
}

function findTrashed(
  db: kdbxweb.Kdbx,
  id: string,
): { entry: kdbxweb.KdbxEntry; group: kdbxweb.KdbxGroup } | null {
  for (const found of trashEntries(db)) {
    if (found.entry.uuid.toString() === id || found.entry.uuid.id === id) return found;
  }
  return null;
}

function compareItems(a: VaultItem, b: VaultItem): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  if (a.sortIndex !== b.sortIndex) return a.sortIndex - b.sortIndex;
  return a.title.localeCompare(b.title) || a.username.localeCompare(b.username);
}

function groupNamed(db: kdbxweb.Kdbx, name: string | undefined): kdbxweb.KdbxGroup {
  const root = db.getDefaultGroup();
  const wanted = name?.trim();
  if (!wanted || wanted === root.name) return root;
  for (const group of visibleGroups(db)) {
    if (group.name === wanted) return group;
  }
  return db.createGroup(root, wanted);
}

function nestedGroup(
  db: kdbxweb.Kdbx,
  parent: kdbxweb.KdbxGroup,
  name: string,
): kdbxweb.KdbxGroup {
  const existing = parent.groups.find((group) => group.name === name);
  return existing ?? db.createGroup(parent, name);
}

function summarize(entry: kdbxweb.KdbxEntry, group: kdbxweb.KdbxGroup): VaultItem {
  const passkey = readPasskey(entry);
  return {
    id: entry.uuid.toString(),
    title: fieldText(entry, "Title") || "Untitled",
    username: fieldText(entry, "UserName"),
    url: fieldText(entry, "URL"),
    notes: fieldText(entry, "Notes"),
    groupId: group.uuid.toString(),
    groupName: group.name?.trim() || "Vault",
    hasPassword: fieldText(entry, "Password").length > 0,
    hasTotp: totpParams(entry) !== null,
    hasRecoveryCodes: parseRecoveryCodes(fieldText(entry, RECOVERY_FIELD)).length > 0,
    hasPasskey: Boolean(passkey && (passkey.relyingParty || passkey.credentialId)),
    pinned: fieldText(entry, PIN_FIELD) === "1",
    sortIndex: sortIndexOf(entry),
    updatedAt: entry.times.lastModTime?.toISOString() ?? null,
  };
}

function sortIndexOf(entry: kdbxweb.KdbxEntry): number {
  const raw = fieldText(entry, ORDER_FIELD);
  if (!raw) return Number.MAX_SAFE_INTEGER;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function writeLogin(db: kdbxweb.Kdbx, login: CsvLogin, fallback: kdbxweb.KdbxGroup): void {
  const group = login.group ? groupNamed(db, login.group) : fallback;
  const entry = db.createEntry(group);
  entry.fields.set("Title", login.title || hostnameOf(login.url) || "Imported");
  entry.fields.set("UserName", login.username);
  entry.fields.set("URL", login.url);
  entry.fields.set("Notes", login.notes);
  entry.fields.set("Password", kdbxweb.ProtectedValue.fromString(login.password));
  if (login.totp) writeTotp(entry, login.totp);
  entry.times.update();
}

function hostnameOf(url: string): string {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function totpParams(entry: kdbxweb.KdbxEntry): TotpParams | null {
  const otp = fieldText(entry, OTP_FIELD);
  const fromOtp = otp ? parseOtpauth(otp) : null;
  if (fromOtp?.secret) return fromOtp;
  const seed = fieldText(entry, TIME_OTP_SECRET) || fieldText(entry, TOTP_SEED_FIELD);
  if (!seed) return null;
  const parsed = parseOtpauth(seed);
  if (!parsed) return null;
  const period = Number(fieldText(entry, TIME_OTP_PERIOD)) || parsed.period;
  const digits = Number(fieldText(entry, TIME_OTP_LENGTH)) || parsed.digits;
  const algorithmRaw = fieldText(entry, TIME_OTP_ALGORITHM);
  return {
    ...parsed,
    period: period > 0 ? period : 30,
    digits: digits === 8 ? 8 : 6,
    algorithm: algorithmRaw.includes("256")
      ? "SHA256"
      : algorithmRaw.includes("512")
        ? "SHA512"
        : parsed.algorithm,
    issuer: parsed.issuer || fieldText(entry, "Title"),
    account: parsed.account || fieldText(entry, "UserName"),
  };
}

function writeTotp(entry: kdbxweb.KdbxEntry, secret: string): void {
  const trimmed = secret.trim();
  if (!trimmed) {
    entry.fields.delete(OTP_FIELD);
    entry.fields.delete(TIME_OTP_SECRET);
    entry.fields.delete(TIME_OTP_PERIOD);
    entry.fields.delete(TIME_OTP_LENGTH);
    entry.fields.delete(TIME_OTP_ALGORITHM);
    return;
  }
  const params = parseOtpauth(trimmed) ?? {
    secret: trimmed.replace(/\s+/g, ""),
    period: 30,
    digits: 6,
    algorithm: "SHA1" as const,
    issuer: fieldText(entry, "Title"),
    account: fieldText(entry, "UserName"),
  };
  if (!params.issuer) params.issuer = fieldText(entry, "Title");
  if (!params.account) params.account = fieldText(entry, "UserName");
  writeProtected(entry, OTP_FIELD, otpauthUrl(params));
  writeProtected(entry, TIME_OTP_SECRET, params.secret);
  entry.fields.set(TIME_OTP_PERIOD, String(params.period));
  entry.fields.set(TIME_OTP_LENGTH, String(params.digits));
  entry.fields.set(
    TIME_OTP_ALGORITHM,
    params.algorithm === "SHA256"
      ? "HMAC-SHA-256"
      : params.algorithm === "SHA512"
        ? "HMAC-SHA-512"
        : "HMAC-SHA-1",
  );
}

function readPasskey(entry: kdbxweb.KdbxEntry): VaultPasskey | null {
  const relyingParty = fieldText(entry, PASSKEY_RP);
  const username = fieldText(entry, PASSKEY_USERNAME);
  const credentialId = fieldText(entry, PASSKEY_CREDENTIAL_ID);
  const userHandle = fieldText(entry, PASSKEY_USER_HANDLE);
  const privateKeyPem = fieldText(entry, PASSKEY_PRIVATE_KEY);
  if (!relyingParty && !credentialId && !privateKeyPem) return null;
  return { relyingParty, username, credentialId, userHandle, privateKeyPem };
}

function writePasskey(
  entry: kdbxweb.KdbxEntry,
  passkey: VaultItemInput["passkey"],
): void {
  if (!passkey) {
    for (const field of [
      PASSKEY_RP,
      PASSKEY_USERNAME,
      PASSKEY_CREDENTIAL_ID,
      PASSKEY_USER_HANDLE,
      PASSKEY_PRIVATE_KEY,
    ])
      entry.fields.delete(field);
    return;
  }
  entry.fields.set(PASSKEY_RP, passkey.relyingParty.trim());
  entry.fields.set(PASSKEY_USERNAME, passkey.username.trim());
  entry.fields.set(PASSKEY_CREDENTIAL_ID, passkey.credentialId.trim());
  entry.fields.set(PASSKEY_USER_HANDLE, passkey.userHandle?.trim() ?? "");
  if (passkey.privateKeyPem !== undefined)
    writeProtected(entry, PASSKEY_PRIVATE_KEY, passkey.privateKeyPem);
}

function writeProtected(entry: kdbxweb.KdbxEntry, name: string, value: string): void {
  if (!value) {
    entry.fields.delete(name);
    return;
  }
  entry.fields.set(name, kdbxweb.ProtectedValue.fromString(value));
}

export function fieldText(entry: kdbxweb.KdbxEntry, name: string): string {
  const value = entry.fields.get(name);
  if (!value) return "";
  if (typeof value === "string") return value;
  return value.getText();
}

export function parseRecoveryCodes(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((code) => code.trim())
    .filter(Boolean);
}

export function formatRecoveryCodes(codes: string[]): string {
  return codes.map((code) => code.trim()).filter(Boolean).join("\n");
}
