import { hmac } from "@noble/hashes/hmac.js";
import { sha1 } from "@noble/hashes/legacy.js";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

export type TotpAlgorithm = "SHA1" | "SHA256" | "SHA512";

export interface TotpParams {
  secret: string;
  period: number;
  digits: number;
  algorithm: TotpAlgorithm;
  issuer: string;
  account: string;
}

export interface TotpCode {
  code: string;
  next: string;
  period: number;
  remaining: number;
  issuer: string;
  account: string;
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32, ignoring spaces and padding. TOTP secrets are this alphabet. */
export function decodeBase32(input: string): Uint8Array {
  const cleaned = input.toUpperCase().replace(/[\s=-]/g, "");
  if (!cleaned) return new Uint8Array(0);
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of cleaned) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error("Authenticator secret is not valid base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(bytes);
}

export function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

export function parseOtpauth(value: string): TotpParams | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!trimmed.toLowerCase().startsWith("otpauth://")) {
    return {
      secret: trimmed.replace(/\s+/g, ""),
      period: 30,
      digits: 6,
      algorithm: "SHA1",
      issuer: "",
      account: "",
    };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "otpauth:" || url.host.toLowerCase() !== "totp") return null;
  const secret = url.searchParams.get("secret")?.replace(/\s+/g, "") ?? "";
  if (!secret) return null;
  const label = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const colon = label.indexOf(":");
  const issuerParam = url.searchParams.get("issuer") ?? "";
  const issuer = issuerParam || (colon >= 0 ? label.slice(0, colon) : "");
  const account = colon >= 0 ? label.slice(colon + 1) : label;
  const period = positiveInt(url.searchParams.get("period"), 30);
  const digits = positiveInt(url.searchParams.get("digits"), 6);
  return {
    secret,
    period,
    digits: digits === 8 ? 8 : 6,
    algorithm: totpAlgorithm(url.searchParams.get("algorithm")),
    issuer,
    account,
  };
}

export function otpauthUrl(params: TotpParams): string {
  const label = params.issuer
    ? `${encodeURIComponent(params.issuer)}:${encodeURIComponent(params.account || params.issuer)}`
    : encodeURIComponent(params.account || "Vault");
  const query = new URLSearchParams({
    secret: params.secret.replace(/\s+/g, ""),
    period: String(params.period),
    digits: String(params.digits),
    algorithm: params.algorithm,
  });
  if (params.issuer) query.set("issuer", params.issuer);
  return `otpauth://totp/${label}?${query.toString()}`;
}

export function generateTotp(params: TotpParams, now = Date.now()): TotpCode {
  const period = params.period > 0 ? params.period : 30;
  const digits = params.digits === 8 ? 8 : 6;
  const counter = Math.floor(Math.floor(now / 1000) / period);
  const remaining = period - (Math.floor(now / 1000) % period);
  const key = decodeBase32(params.secret);
  return {
    code: totpDigits(key, params.algorithm, counter, digits),
    next: totpDigits(key, params.algorithm, counter + 1, digits),
    period,
    remaining,
    issuer: params.issuer,
    account: params.account,
  };
}

function totpDigits(
  key: Uint8Array,
  algorithm: TotpAlgorithm,
  counter: number,
  digits: number,
): string {
  const message = new Uint8Array(8);
  const view = new DataView(message.buffer);
  view.setUint32(0, Math.floor(counter / 0x100000000));
  view.setUint32(4, counter >>> 0);
  const hash = hmac(hashFn(algorithm), key, message);
  const offset = hash[hash.length - 1] & 0x0f;
  const truncated =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);
  return String(truncated % 10 ** digits).padStart(digits, "0");
}

function totpAlgorithm(value: string | null): TotpAlgorithm {
  const normalized = (value ?? "").toUpperCase().replace(/-/g, "").replace(/^HMAC/, "");
  if (normalized === "SHA256") return "SHA256";
  if (normalized === "SHA512") return "SHA512";
  return "SHA1";
}

function hashFn(algorithm: TotpAlgorithm) {
  if (algorithm === "SHA256") return sha256;
  if (algorithm === "SHA512") return sha512;
  return sha1;
}

function positiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
