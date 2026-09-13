import assert from "node:assert/strict";
import test from "node:test";
import {ZSIGN_RELEASE, zsignBuildArguments} from "./build-phone-zsign.mjs";

test("links the macOS iPhone signer against static OpenSSL", () => {
  const args = zsignBuildArguments("/portable/openssl");
  assert.equal(ZSIGN_RELEASE, "1.1.1");
  assert.ok(args.includes("OPENSSL_INCLUDE=-I/portable/openssl/include"));
  assert.ok(args.some((arg) =>
    arg === "OPENSSL_LIB=/portable/openssl/lib/libssl.a /portable/openssl/lib/libcrypto.a"));
});
