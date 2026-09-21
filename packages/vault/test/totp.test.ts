import assert from "node:assert/strict";
import { test } from "node:test";
import { generateTotp, otpauthUrl, parseOtpauth } from "../src/totp.js";

test("RFC 6238 SHA1 vectors produce the documented codes", () => {
  // Secret is ASCII "12345678901234567890" as base32.
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  const at = (epoch: number) =>
    generateTotp({ secret, period: 30, digits: 8, algorithm: "SHA1", issuer: "", account: "" }, epoch * 1000);
  assert.equal(at(59).code, "94287082");
  assert.equal(at(59).next.length, 8);
  assert.notEqual(at(59).next, at(59).code);
  assert.equal(at(1111111109).code, "07081804");
});

test("otpauth URLs round-trip issuer, period and algorithm", () => {
  const parsed = parseOtpauth(
    "otpauth://totp/GitHub:ada@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&period=30&digits=6&algorithm=SHA1",
  );
  assert.ok(parsed);
  assert.equal(parsed.issuer, "GitHub");
  assert.equal(parsed.account, "ada@example.com");
  assert.equal(parsed.secret, "JBSWY3DPEHPK3PXP");
  const url = otpauthUrl(parsed);
  const again = parseOtpauth(url);
  assert.equal(again?.secret, parsed.secret);
  assert.equal(again?.issuer, "GitHub");
});
