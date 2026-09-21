import {randomBytes, timingSafeEqual} from "node:crypto";
import {closeSync, constants, fstatSync, mkdirSync, openSync, readFileSync, writeFileSync} from "node:fs";
import {dirname} from "node:path";

/** Shared only with the manifest-approved native messaging host, never over HTTP. */
export function loadVaultCapability(file: string): string {
  mkdirSync(dirname(file), {recursive: true, mode: 0o700});
  try {
    const fd = openSync(file, "wx", 0o600);
    try { writeFileSync(fd, randomBytes(32).toString("hex")); }
    finally { closeSync(fd); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || (process.platform !== "win32" &&
      ((stat.mode & 0o777) !== 0o600 || stat.uid !== process.getuid?.())))
      throw new Error("Vault extension capability must be a private file owned by this user");
    const token = readFileSync(fd, "utf8").trim();
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Invalid Vault extension capability");
    return token;
  } finally { closeSync(fd); }
}

export function matchesVaultCapability(header: string | undefined, token: string): boolean {
  const supplied = Buffer.from(header ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
