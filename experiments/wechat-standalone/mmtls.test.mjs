import assert from "node:assert/strict";
import { test } from "node:test";

import { buildAuthReadiness } from "./auth-readiness.mjs";
import {
  PROTOCOL_VERSION,
  RECORD_DATA,
  buildClientHello,
  decryptRecordPayload,
  encryptRecordPayload,
  hkdfExpandOnly,
  parseSessionTickets,
  parseServerHello,
  serializeSessionTicket,
  serializeRecord,
} from "./mmtls.mjs";
import {
  buildPskZeroClientHello,
  buildShortRequestData,
} from "./mmtls-short.mjs";
import {
  NATIVE_CLIENT_VERSION,
  buildNativeBusinessPacket,
  buildNativeQrCheckProtobuf,
  buildSecManualAuthProtobuf,
  buildNativeQrProtobuf,
  decodeProtobuf,
  parseNativeQrCheckResponse,
  parseSecManualAuthResponse,
  protobufBytes,
  protobufVarint,
} from "./native-auth.mjs";
import { parseQrLoginChallenge, parseQrLoginStatus } from "./web-qr.mjs";

test("HKDF expand matches RFC 5869 test case 1", () => {
  const prk = Buffer.from(
    "077709362c2e32df0ddc3f0dc47bba6390b6c73bb50f9c3122ec844ad7c2b3e5",
    "hex",
  );
  const info = Buffer.from("f0f1f2f3f4f5f6f7f8f9", "hex");
  const expected = Buffer.from(
    "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865",
    "hex",
  );
  assert.deepEqual(hkdfExpandOnly(prk, info, 42), expected);
});

test("MMTLS AES-GCM record payload round-trips", () => {
  const key = Buffer.alloc(16, 0x11);
  const baseNonce = Buffer.alloc(12, 0x22);
  const plaintext = Buffer.from("encrypted heartbeat");
  const ciphertext = encryptRecordPayload({
    key,
    baseNonce,
    sequence: 7,
    recordType: RECORD_DATA,
    plaintext,
  });
  assert.notDeepEqual(ciphertext.subarray(0, plaintext.length), plaintext);
  assert.deepEqual(
    decryptRecordPayload({
      key,
      baseNonce,
      sequence: 7,
      recordType: RECORD_DATA,
      ciphertext,
    }),
    plaintext,
  );
});

test("client hello carries two uncompressed P-256 keys", () => {
  const first = Buffer.concat([Buffer.from([0x04]), Buffer.alloc(64, 0x11)]);
  const second = Buffer.concat([Buffer.from([0x04]), Buffer.alloc(64, 0x22)]);
  const hello = buildClientHello({
    transportPublicKey: first,
    verificationPublicKey: second,
    random: Buffer.alloc(32, 0x33),
    timestamp: 1,
  });

  assert.equal(hello.readUInt32BE(0), hello.length - 4);
  assert.equal(hello.readUInt16LE(5), PROTOCOL_VERSION);
  assert.equal(hello.indexOf(first) > 0, true);
  assert.equal(hello.indexOf(second) > hello.indexOf(first), true);

  const record = serializeRecord(0x16, hello);
  assert.equal(record.readUInt16BE(1), PROTOCOL_VERSION);
  assert.equal(record.readUInt16BE(3), hello.length);
});

test("server hello parses its inner protocol version as little-endian", () => {
  const serverKey = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.alloc(64, 0x44),
  ]);
  const body = Buffer.concat([
    Buffer.from([1]),
    Buffer.from([0x04, 0xf1]),
    Buffer.from([0xc0, 0x2b]),
    Buffer.alloc(32),
    Buffer.alloc(4),
    Buffer.from([1]),
    Buffer.alloc(4),
    Buffer.from([0x00, 0x10]),
    Buffer.from([0x00, 0x00, 0x00, 0x05]),
    Buffer.from([0x00, serverKey.length]),
    serverKey,
  ]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);

  const parsed = parseServerHello(Buffer.concat([length, body]));
  assert.equal(parsed.version, PROTOCOL_VERSION);
  assert.equal(parsed.keyPairSequence, 5);
  assert.deepEqual(parsed.publicKey, serverKey);
});

test("MMTLS session tickets parse and reserialize for 0-RTT", () => {
  const ticket = {
    ticketType: 2,
    lifetime: 300,
    ageAdd: Buffer.from([1, 2]),
    reserved: 0x48,
    nonce: Buffer.alloc(12, 3),
    ticket: Buffer.alloc(24, 4),
  };
  const serialized = serializeSessionTicket(ticket);
  const message = Buffer.concat([
    Buffer.alloc(4),
    Buffer.from([4, 1]),
    Buffer.from([
      (serialized.length >>> 24) & 0xff,
      (serialized.length >>> 16) & 0xff,
      (serialized.length >>> 8) & 0xff,
      serialized.length & 0xff,
    ]),
    serialized,
  ]);
  message.writeUInt32BE(message.length - 4, 0);

  const [parsed] = parseSessionTickets(message);
  assert.deepEqual(parsed, ticket);
  const zeroRttTicket = serializeSessionTicket(parsed, { omitAgeAdd: true });
  assert.equal(zeroRttTicket.readUInt16BE(5), 0);

  const hello = buildPskZeroClientHello({
    ticket: parsed,
    random: Buffer.alloc(32, 5),
    timestamp: 6,
  });
  assert.equal(hello.readUInt16LE(5), PROTOCOL_VERSION);
  assert.equal(hello.indexOf(zeroRttTicket) > 0, true);
});

test("short-link request data binds the path, host, and exact body", () => {
  const body = Buffer.from("native request");
  const packed = buildShortRequestData({
    host: "extshort.weixin.qq.com",
    path: "/cgi-bin/micromsg-bin/getloginqrcode",
    body,
  });
  assert.equal(packed.readUInt32BE(0), packed.length - 4);
  assert.equal(packed.indexOf(Buffer.from("getloginqrcode")) > 0, true);
  assert.equal(packed.subarray(-body.length).equals(body), true);
});

test("native QR protobuf carries an anonymous device request", () => {
  const deviceId = Buffer.alloc(16, 0x11);
  const randomKey = Buffer.alloc(16, 0x22);
  const request = buildNativeQrProtobuf({ deviceId, randomKey });
  const fields = decodeProtobuf(request);
  const base = decodeProtobuf(fields.get(1)[0].value);

  assert.deepEqual(base.get(3)[0].value, deviceId);
  assert.equal(Number(base.get(4)[0].value), NATIVE_CLIENT_VERSION);
  assert.equal(Number(fields.get(3)[0].value), 0);

  const packet = buildNativeBusinessPacket({
    encrypted: Buffer.alloc(40, 0x33),
    plaintextLength: request.length,
    rqtx: 1142448179,
  });
  assert.equal(packet[0], 0xbf);
  assert.equal(packet[1] >> 2, packet.length - 40);
  assert.equal(packet.subarray(-40).equals(Buffer.alloc(40, 0x33)), true);
});

test("native QR polling binds the issued UUID and login random key", () => {
  const deviceId = Buffer.alloc(16, 0x49);
  const randomKey = Buffer.from("abcdefghijklmnop");
  const request = buildNativeQrCheckProtobuf({
    deviceId,
    randomKey,
    uuid: "native-qr-uuid",
    timestamp: 123,
  });
  const fields = decodeProtobuf(request);
  const base = decodeProtobuf(fields.get(1)[0].value);
  assert.deepEqual(base.get(1)[0].value, randomKey);
  assert.deepEqual(base.get(3)[0].value, deviceId);
  assert.equal(fields.get(3)[0].value.toString(), "native-qr-uuid");
  assert.equal(Number(fields.get(4)[0].value), 123);
});

test("native QR polling accepts an omitted zero-length notify payload", () => {
  const base = protobufVarint(1, 0);
  const emptyBuiltin = protobufVarint(1, 0);
  const notifyPackage = protobufBytes(1, emptyBuiltin);
  const response = Buffer.concat([
    protobufBytes(1, base),
    protobufBytes(3, notifyPackage),
  ]);

  assert.deepEqual(parseNativeQrCheckResponse(response, Buffer.alloc(16)), {
    ret: 0,
    errorMessage: "",
    state: "waiting",
  });
});

test("native manual authentication separates account and device sections", () => {
  const request = buildSecManualAuthProtobuf({
    deviceId: Buffer.from("49111111111111111111111111111111", "hex"),
    userName: "wxid_test",
    password: "phone-approved-token",
    randomKey: Buffer.from("abcdefghijklmnop"),
    timestamp: 123,
    attestation: {
      extSpam: Buffer.from("device-attestation"),
      imei: "49111111111111111111111111111111",
      softType: "<softtype />",
      clientSeq: "device-123",
      adSource: "device-uuid",
    },
  });
  const fields = decodeProtobuf(request.protobuf);
  const account = decodeProtobuf(fields.get(1)[0].value);
  const device = decodeProtobuf(fields.get(2)[0].value);
  assert.equal(account.get(3)[0].value.toString(), "wxid_test");
  assert.equal(account.get(4)[0].value.toString(), "phone-approved-token");
  assert.equal(device.get(3)[0].value.toString().startsWith("49"), true);
  assert.equal(device.get(24)[0].value.length > 0, true);
  assert.equal(request.p224Ecdh.getPublicKey().length, 57);
});

test("native manual authentication exposes only server-signed short redirects", () => {
  const base = Buffer.concat([
    protobufVarint(1, -301),
    protobufBytes(2, protobufBytes(1, Buffer.from("redirect"))),
  ]);
  const hostInfo = Buffer.concat([
    protobufBytes(1, Buffer.from("short.weixin.qq.com")),
    protobufBytes(2, Buffer.from("szshort.weixin.qq.com")),
  ]);
  const hostList = protobufBytes(2, hostInfo);
  const response = Buffer.concat([
    protobufBytes(1, base),
    protobufBytes(5, protobufBytes(1, hostList)),
  ]);
  const parsed = parseSecManualAuthResponse(response, undefined);
  assert.equal(parsed.ret, -301);
  assert.deepEqual(parsed.shortLinkRedirects, ["szshort.weixin.qq.com"]);
});

test("transport success never implies personal account authentication", () => {
  const readiness = buildAuthReadiness({
    transportHandshake: true,
    serverSignatureVerified: true,
    encryptedHeartbeat: true,
  });
  assert.equal(readiness.standaloneTransport, "verified");
  assert.equal(readiness.personalAccountAuthentication, "not_attempted");
  assert.deepEqual(readiness.completedStages, ["transport"]);
  assert.equal(readiness.nextStage, "native_qr_request");
  assert.equal(readiness.safety.accountDataUsed, false);
});

test("legacy Web WeChat challenge parsing is strict and separate from login", () => {
  assert.equal(
    parseQrLoginChallenge(
      'window.QRLogin.code = 200; window.QRLogin.uuid = "abc_DEF-12==";',
    ),
    "abc_DEF-12==",
  );
  assert.throws(
    () =>
      parseQrLoginChallenge(
        'window.QRLogin.code = 500; window.QRLogin.uuid = "abc";',
      ),
    /rejected/,
  );

  const readiness = buildAuthReadiness(undefined, { challengeIssued: true });
  assert.equal(
    readiness.candidatePaths.legacyWebWechat.qrChallenge,
    "verified",
  );
  assert.equal(
    readiness.candidatePaths.legacyWebWechat.accountAcceptance,
    "not_attempted",
  );
  assert.equal(readiness.nextStage, "disposable_test_account_scan");
});

test("legacy Web WeChat login polling distinguishes scan and approval", () => {
  assert.deepEqual(parseQrLoginStatus("window.code=408;"), {
    code: 408,
    state: "waiting",
    redirectUri: undefined,
  });
  assert.deepEqual(parseQrLoginStatus("window.code=201;"), {
    code: 201,
    state: "scanned",
    redirectUri: undefined,
  });
  assert.deepEqual(
    parseQrLoginStatus(
      'window.code=200; window.redirect_uri="https://wx.qq.com/login?ticket=secret";',
    ),
    {
      code: 200,
      state: "approved",
      redirectUri: "https://wx.qq.com/login?ticket=secret",
    },
  );
  assert.throws(() => parseQrLoginStatus("window.code=200;"), /redirect URI/);
});
