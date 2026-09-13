import { sha256 } from "@noble/hashes/sha2.js";
import type { Kdbx } from "kdbxweb";
import { base64ToBytes, bytesToBase64 } from "./checksum.js";
import { hostKey } from "./match.js";
import {
  listItems,
  LOCKED,
  readSecrets,
  upsertItem,
  type LockerPasskey,
} from "./vault.js";

/** ES256 / ECDSA P-256, the algorithm KeePassXC stores as PKCS#8 PEM. */
export const PASSKEY_ALG = -7;

export interface PasskeyOffer {
  id: string;
  title: string;
  username: string;
  relyingParty: string;
  credentialId: string;
  userHandle: string;
}

export interface WebAuthnGetRequest {
  origin: string;
  rpId: string;
  challenge: string;
  allowCredentialIds?: string[];
  itemId?: string;
}

export interface WebAuthnCreateRequest {
  origin: string;
  rpId: string;
  rpName?: string;
  challenge: string;
  userName: string;
  userDisplayName?: string;
  userId: string;
  excludeCredentialIds?: string[];
}

export interface WebAuthnAssertion {
  id: string;
  rawId: string;
  type: "public-key";
  authenticatorAttachment: "platform";
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
  userHandle: string | null;
}

export interface WebAuthnAttestation {
  id: string;
  rawId: string;
  type: "public-key";
  authenticatorAttachment: "platform";
  clientDataJSON: string;
  attestationObject: string;
  transports: string[];
}

export function normalizeRpId(value: string): string {
  return hostKey(value.trim());
}

/** Whether this RP ID is a valid WebAuthn rpId for the page origin. */
export function rpIdAllowedForOrigin(rpId: string, origin: string): boolean {
  let page: URL;
  try {
    page = new URL(origin);
  } catch {
    return false;
  }
  const secure =
    page.protocol === "https:" ||
    page.hostname === "localhost" ||
    page.hostname === "127.0.0.1";
  if (!secure) return false;
  const rp = normalizeRpId(rpId);
  const host = normalizeRpId(page.hostname);
  if (!rp || !host) return false;
  return host === rp || host.endsWith(`.${rp}`);
}

export function relyingPartyMatches(storedRpId: string, requestRpId: string): boolean {
  const stored = normalizeRpId(storedRpId);
  const requested = normalizeRpId(requestRpId);
  return Boolean(stored && requested && stored === requested);
}

export function credentialIdsEqual(left: string, right: string): boolean {
  const a = decodeCredentialId(left);
  const b = decodeCredentialId(right);
  if (!a || !b || a.byteLength !== b.byteLength) return false;
  return a.every((byte, index) => byte === b[index]);
}

export function rpIdForOrigin(origin: string, rpId?: string): string {
  if (rpId?.trim()) return normalizeRpId(rpId);
  try {
    return normalizeRpId(new URL(origin).hostname);
  } catch {
    return "";
  }
}

export function listPasskeysForRequest(db: Kdbx, request: WebAuthnGetRequest): PasskeyOffer[] {
  assertUnlocked(db);
  if (!rpIdAllowedForOrigin(request.rpId, request.origin)) return [];
  const allow = request.allowCredentialIds?.filter(Boolean) ?? [];
  const offers: PasskeyOffer[] = [];
  for (const item of listItems(db)) {
    if (!item.hasPasskey) continue;
    const passkey = readSecrets(db, item.id).passkey;
    if (!passkey?.privateKeyPem || !relyingPartyMatches(passkey.relyingParty, request.rpId))
      continue;
    if (allow.length && !allow.some((id) => credentialIdsEqual(passkey.credentialId, id)))
      continue;
    offers.push(offerFrom(item.id, item.title, passkey));
  }
  return offers;
}

export async function getPasskeyAssertion(
  db: Kdbx,
  request: WebAuthnGetRequest,
): Promise<WebAuthnAssertion> {
  assertUnlocked(db);
  if (!rpIdAllowedForOrigin(request.rpId, request.origin))
    throw new Error("This site cannot use that passkey");
  const matches = listPasskeysForRequest(db, request);
  const chosen = request.itemId
    ? matches.find((offer) => offer.id === request.itemId)
    : matches[0];
  if (!chosen) throw new Error("No passkey is saved for this site");
  const passkey = readSecrets(db, chosen.id).passkey;
  if (!passkey?.privateKeyPem) throw new Error("That passkey is incomplete");
  const credentialId = decodeCredentialId(passkey.credentialId);
  if (!credentialId) throw new Error("That passkey is incomplete");
  const challenge = decodeCredentialId(request.challenge);
  if (!challenge) throw new Error("The site challenge was unreadable");
  const clientDataJSON = encodeClientData("webauthn.get", challenge, request.origin);
  const authenticatorData = buildAuthenticatorData(request.rpId, false);
  const signature = await signAssertion(passkey.privateKeyPem, authenticatorData, clientDataJSON);
  const userHandle = passkey.userHandle ? decodeCredentialId(passkey.userHandle) : null;
  return {
    id: bytesToBase64Url(credentialId),
    rawId: bytesToBase64Url(credentialId),
    type: "public-key",
    authenticatorAttachment: "platform",
    clientDataJSON: bytesToBase64Url(clientDataJSON),
    authenticatorData: bytesToBase64Url(authenticatorData),
    signature: bytesToBase64Url(signature),
    userHandle: userHandle ? bytesToBase64Url(userHandle) : null,
  };
}

export async function createPasskeyCredential(
  db: Kdbx,
  request: WebAuthnCreateRequest,
): Promise<{ attestation: WebAuthnAttestation; itemId: string }> {
  assertUnlocked(db);
  if (!rpIdAllowedForOrigin(request.rpId, request.origin))
    throw new Error("This site cannot save a passkey");
  const exclude = request.excludeCredentialIds?.filter(Boolean) ?? [];
  if (exclude.length) {
    const existing = listPasskeysForRequest(db, {
      origin: request.origin,
      rpId: request.rpId,
      challenge: request.challenge,
      allowCredentialIds: exclude,
    });
    if (existing.length) throw new Error("A passkey for this site is already saved");
  }
  const challenge = decodeCredentialId(request.challenge);
  if (!challenge) throw new Error("The site challenge was unreadable");
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const privateKeyPem = pkcs8ToPem(pkcs8);
  const credentialId = randomBytes(32);
  const userHandle = decodeCredentialId(request.userId) ?? randomBytes(32);
  const username = request.userName.trim() || request.userDisplayName?.trim() || "Passkey";
  const itemId = upsertItem(db, {
    title: request.rpName?.trim() || request.rpId,
    username,
    url: `https://${request.rpId}`,
    passkey: {
      relyingParty: normalizeRpId(request.rpId),
      username,
      credentialId: bytesToBase64(credentialId),
      userHandle: bytesToBase64(userHandle),
      privateKeyPem,
    },
  });
  const clientDataJSON = encodeClientData("webauthn.create", challenge, request.origin);
  const cose = await coseKey(pair.publicKey);
  const authenticatorData = buildAuthenticatorData(request.rpId, true, credentialId, cose);
  const attestationObject = encodeAttestationObject(authenticatorData);
  return {
    itemId,
    attestation: {
      id: bytesToBase64Url(credentialId),
      rawId: bytesToBase64Url(credentialId),
      type: "public-key",
      authenticatorAttachment: "platform",
      clientDataJSON: bytesToBase64Url(clientDataJSON),
      attestationObject: bytesToBase64Url(attestationObject),
      transports: ["internal", "hybrid"],
    },
  };
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodeCredentialId(value: string): Uint8Array | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = trimmed.replace(/-/g, "+").replace(/_/g, "/");
    const padded = url + "=".repeat((4 - (url.length % 4)) % 4);
    const bytes = base64ToBytes(padded);
    if (bytes.byteLength) return bytes;
  } catch {
    // Not base64; hex is the remaining KeePass-compatible encoding.
  }
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    const bytes = new Uint8Array(trimmed.length / 2);
    for (let index = 0; index < bytes.length; index += 1)
      bytes[index] = Number.parseInt(trimmed.slice(index * 2, index * 2 + 2), 16);
    return bytes;
  }
  return null;
}

function offerFrom(id: string, title: string, passkey: LockerPasskey): PasskeyOffer {
  return {
    id,
    title,
    username: passkey.username || title,
    relyingParty: passkey.relyingParty,
    credentialId: passkey.credentialId,
    userHandle: passkey.userHandle,
  };
}

function assertUnlocked(db: Kdbx | null): asserts db is Kdbx {
  if (!db) throw new Error(LOCKED);
}

function encodeClientData(type: "webauthn.get" | "webauthn.create", challenge: Uint8Array, origin: string): Uint8Array {
  const json = JSON.stringify({
    type,
    challenge: bytesToBase64Url(challenge),
    origin,
    crossOrigin: false,
  });
  return new TextEncoder().encode(json);
}

function buildAuthenticatorData(
  rpId: string,
  attest: boolean,
  credentialId?: Uint8Array,
  cose?: Uint8Array,
): Uint8Array {
  const rpHash = sha256Sync(new TextEncoder().encode(normalizeRpId(rpId)));
  const flags = attest ? 0b01000101 : 0b00000101; // UP | UV [| AT]
  const header = new Uint8Array(37);
  header.set(rpHash, 0);
  header[32] = flags;
  if (!attest || !credentialId || !cose) return header;
  const attested = new Uint8Array(16 + 2 + credentialId.byteLength + cose.byteLength);
  const view = new DataView(attested.buffer);
  view.setUint16(16, credentialId.byteLength, false);
  attested.set(credentialId, 18);
  attested.set(cose, 18 + credentialId.byteLength);
  const out = new Uint8Array(header.byteLength + attested.byteLength);
  out.set(header);
  out.set(attested, header.byteLength);
  return out;
}

async function signAssertion(
  pem: string,
  authenticatorData: Uint8Array,
  clientDataJSON: Uint8Array,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    new Uint8Array(pemToPkcs8(pem)),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const clientHash = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(clientDataJSON)));
  const payload = new Uint8Array(authenticatorData.byteLength + clientHash.byteLength);
  payload.set(authenticatorData);
  payload.set(clientHash, authenticatorData.byteLength);
  const ieee = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, payload),
  );
  return p1363ToDer(ieee);
}

async function coseKey(publicKey: CryptoKey): Promise<Uint8Array> {
  const jwk = await crypto.subtle.exportKey("jwk", publicKey);
  const x = decodeCredentialId(jwk.x ?? "");
  const y = decodeCredentialId(jwk.y ?? "");
  if (!x || !y) throw new Error("The passkey public key could not be exported");
  return encodeCoseEc2(x, y);
}

function encodeCoseEc2(x: Uint8Array, y: Uint8Array): Uint8Array {
  return concat(
    Uint8Array.of(0xa5),
    encodeCborUint(1),
    encodeCborUint(2),
    encodeCborUint(3),
    encodeCborInt(-7),
    encodeCborInt(-1),
    encodeCborUint(1),
    encodeCborInt(-2),
    encodeCborBytes(x),
    encodeCborInt(-3),
    encodeCborBytes(y),
  );
}

function encodeAttestationObject(authData: Uint8Array): Uint8Array {
  return concat(
    Uint8Array.of(0xa3),
    encodeCborText("fmt"),
    encodeCborText("none"),
    encodeCborText("attStmt"),
    Uint8Array.of(0xa0),
    encodeCborText("authData"),
    encodeCborBytes(authData),
  );
}

function encodeCborUint(value: number): Uint8Array {
  if (value < 24) return Uint8Array.of(value);
  if (value < 256) return Uint8Array.of(0x18, value);
  return Uint8Array.of(0x19, (value >> 8) & 0xff, value & 0xff);
}

function encodeCborInt(value: number): Uint8Array {
  if (value >= 0) return encodeCborUint(value);
  const n = -1 - value;
  if (n < 24) return Uint8Array.of(0x20 + n);
  if (n < 256) return Uint8Array.of(0x38, n);
  return Uint8Array.of(0x39, (n >> 8) & 0xff, n & 0xff);
}

function encodeCborText(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  return concat(cborLen(0x60, bytes.byteLength), bytes);
}

function encodeCborBytes(value: Uint8Array): Uint8Array {
  return concat(cborLen(0x40, value.byteLength), value);
}

function cborLen(major: number, length: number): Uint8Array {
  if (length < 24) return Uint8Array.of(major + length);
  if (length < 256) return Uint8Array.of(major + 24, length);
  return Uint8Array.of(major + 25, (length >> 8) & 0xff, length & 0xff);
}

function p1363ToDer(ieee: Uint8Array): Uint8Array {
  if (ieee.byteLength !== 64) return ieee;
  const r = derInt(ieee.subarray(0, 32));
  const s = derInt(ieee.subarray(32));
  const seq = concat(r, s);
  return concat(Uint8Array.of(0x30, seq.byteLength), seq);
}

function derInt(raw: Uint8Array): Uint8Array {
  let start = 0;
  while (start < raw.byteLength - 1 && raw[start] === 0) start += 1;
  let body = raw.subarray(start);
  if (body[0] & 0x80) body = concat(Uint8Array.of(0), body);
  return concat(Uint8Array.of(0x02, body.byteLength), body);
}

function pkcs8ToPem(pkcs8: Uint8Array): string {
  const lines = bytesToBase64(pkcs8).match(/.{1,64}/g) ?? [];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----`;
}

function pemToPkcs8(pem: string): Uint8Array {
  const body = pem.replace(/-----BEGIN [^-]+-----/, "").replace(/-----END [^-]+-----/, "").replace(/\s+/g, "");
  const bytes = decodeCredentialId(body);
  if (!bytes) throw new Error("That passkey is incomplete");
  return bytes;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function sha256Sync(bytes: Uint8Array): Uint8Array {
  return sha256(bytes);
}
