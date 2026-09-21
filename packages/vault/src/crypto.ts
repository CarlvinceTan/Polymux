import { argon2d, argon2id } from "@noble/hashes/argon2.js";
import kdbxweb from "kdbxweb";

let installed = false;

/** KeePass 4 databases need Argon2; WebCrypto does not provide it. */
export function installArgon2(): void {
  if (installed) return;
  kdbxweb.CryptoEngine.setArgon2Impl(
    async (password, salt, memory, iterations, length, parallelism, type, version) => {
      const opts = {
        t: iterations,
        m: memory,
        p: parallelism,
        dkLen: length,
        version,
        maxmem: Math.max(memory * 1024 * 2, 64 * 1024 * 1024),
      };
      const derive = type === 0 ? argon2d : argon2id;
      const hash = derive(new Uint8Array(password), new Uint8Array(salt), opts);
      return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength);
    },
  );
  installed = true;
}
