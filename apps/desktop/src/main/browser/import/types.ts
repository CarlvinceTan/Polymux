/**
 * The shape every importer speaks, whichever browser it read.
 *
 * Each decoder's job is to turn one browser's storage into these two plain
 * records and nothing else: no Electron, no session, no vault. Applying them
 * is `apply.ts`'s job, which is what keeps "how Chrome encrypts a cookie"
 * separate from "what our session will accept".
 *
 * Everything here is read-only with respect to the source browser. Nothing in
 * this folder writes to another browser's files, ever.
 */

/** A cookie, already normalised to what `session.cookies.set` takes. */
export interface ImportedCookie {
  /** The URL the cookie is being set against. Electron requires one, and it
   * must be consistent with `domain` and `path` or the write is rejected. */
  url: string;
  name: string;
  value: string;
  /** Present for a domain cookie (one that covers subdomains), absent for a
   * host-only cookie. The distinction is not cosmetic: Electron infers
   * host-only from the absence of this field. */
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  /** Seconds since the Unix epoch, which is what Electron expects. Absent for
   * a session cookie. Each browser stores time differently — Chromium in
   * microseconds since 1601, Safari in seconds since 2001 — and converting is
   * the decoder's job, not the caller's. */
  expirationDate?: number;
  sameSite?: "unspecified" | "no_restriction" | "lax" | "strict";
}

export interface ImportedLogin {
  /** `scheme://host[:port]`, with no path. */
  origin: string;
  username: string;
  password: string;
}

/** One page the source browser recorded a visit to. */
export interface ImportedVisit {
  url: string;
  title: string;
  /** Seconds since the Unix epoch. Every browser stores this differently —
   * Chromium in microseconds since 1601, Firefox in microseconds since 1970,
   * Safari in seconds since 2001 — and converting is the decoder's job. */
  visitedAt: number;
  /** How many times the source says the page was visited. Kept because it is
   * what makes an imported history worth ranking rather than just listing;
   * a source that does not count says 1. */
  visitCount: number;
}

export interface ImportedProfile {
  id: string;
  name: string;
  path: string;
  /** False when the profile is there but cannot be read — Safari without Full
   * Disk Access, or a Firefox profile behind a Primary Password. */
  readable: boolean;
  /** Why it cannot be read, phrased for the user. Null when it can. */
  reason: string | null;
}

/** What a decoder returns. Problems are collected rather than thrown: one
 * unreadable cookie should not cost the user the other nine hundred. */
export interface ImportedData {
  cookies: ImportedCookie[];
  logins: ImportedLogin[];
  visits: ImportedVisit[];
  problems: string[];
}

export const EMPTY_IMPORT: ImportedData = {
  cookies: [],
  logins: [],
  visits: [],
  problems: [],
};

/** Chromium and Firefox both store times as microseconds, from different
 * epochs. 1601-01-01 to 1970-01-01 is 11644473600 seconds. */
export const WINDOWS_EPOCH_OFFSET_SECONDS = 11_644_473_600;

/** Mac absolute time counts from 2001-01-01. */
export const MAC_EPOCH_OFFSET_SECONDS = 978_307_200;

/**
 * The URL a cookie should be set against, built from the host and secure flag
 * the source recorded. A leading dot on the host means "and subdomains", which
 * is not part of a URL and is dropped here.
 */
export function cookieUrl(host: string, secure: boolean, path = "/"): string {
  const bare = host.replace(/^\./, "");
  return `${secure ? "https" : "http"}://${bare}${path.startsWith("/") ? path : `/${path}`}`;
}
