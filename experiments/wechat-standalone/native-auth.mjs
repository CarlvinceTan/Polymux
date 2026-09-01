import {
  createCipheriv,
  createDecipheriv,
  createECDH,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";

import { hkdfExpandOnly, sha256 } from "./mmtls.mjs";

export const NATIVE_QR_CGI = 502;
export const NATIVE_QR_PATH = "/cgi-bin/micromsg-bin/getloginqrcode";
export const NATIVE_QR_CHECK_CGI = 503;
export const NATIVE_QR_CHECK_PATH = "/cgi-bin/micromsg-bin/checkloginqrcode";
export const NATIVE_MANUAL_AUTH_CGI = 252;
export const NATIVE_MANUAL_AUTH_PATH = "/cgi-bin/micromsg-bin/secmanualauth";
export const NATIVE_CLIENT_VERSION = 0x18004c2a;
export const NATIVE_DEVICE_TYPE = "iPad Air iPadOS18.8.1";

const HYBRID_NID = Buffer.from("415");
const HYBRID_VERSION = Buffer.from("1");
const HYBRID_SERVER_KEY = Buffer.from(
  "047ebe7604acf072b0ab0177ea551a7b72588f9b5d3801dfd7bb1bca8e33d1c3b8fa6e4e4026eb38d5bb365088a3d3167c83bdd0bbb46255f88a16ede6f7ab43b5",
  "hex",
);

function u32(value) {
  const output = Buffer.alloc(4);
  output.writeUInt32BE(value >>> 0);
  return output;
}

export function encodeVarint(value) {
  let remaining = BigInt(value);
  if (remaining < 0n) remaining = BigInt.asUintN(64, remaining);
  const bytes = [];
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining !== 0n) byte |= 0x80;
    bytes.push(byte);
  } while (remaining !== 0n);
  return Buffer.from(bytes);
}

function fieldKey(field, wireType) {
  return encodeVarint((BigInt(field) << 3n) | BigInt(wireType));
}

export function protobufVarint(field, value) {
  return Buffer.concat([fieldKey(field, 0), encodeVarint(value)]);
}

export function protobufBytes(field, value) {
  const bytes = Buffer.from(value);
  return Buffer.concat([fieldKey(field, 2), encodeVarint(bytes.length), bytes]);
}

export function decodeProtobuf(buffer) {
  const fields = new Map();
  let offset = 0;
  const readVarint = () => {
    let value = 0n;
    let shift = 0n;
    for (let count = 0; count < 10; count += 1) {
      if (offset >= buffer.length)
        throw new Error("Protobuf varint is truncated");
      const byte = buffer[offset++];
      value |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return value;
      shift += 7n;
    }
    throw new Error("Protobuf varint is too long");
  };

  while (offset < buffer.length) {
    const key = readVarint();
    const field = Number(key >> 3n);
    const wireType = Number(key & 7n);
    let value;
    if (wireType === 0) {
      value = readVarint();
    } else if (wireType === 2) {
      const length = Number(readVarint());
      if (!Number.isSafeInteger(length) || offset + length > buffer.length) {
        throw new Error("Protobuf field is truncated");
      }
      value = buffer.subarray(offset, offset + length);
      offset += length;
    } else if (wireType === 1) {
      if (offset + 8 > buffer.length)
        throw new Error("Protobuf field is truncated");
      value = buffer.subarray(offset, offset + 8);
      offset += 8;
    } else if (wireType === 5) {
      if (offset + 4 > buffer.length)
        throw new Error("Protobuf field is truncated");
      value = buffer.subarray(offset, offset + 4);
      offset += 4;
    } else {
      throw new Error(`Unsupported protobuf wire type ${wireType}`);
    }
    const entries = fields.get(field) ?? [];
    entries.push({ wireType, value });
    fields.set(field, entries);
  }
  return fields;
}

function firstField(fields, field, wireType, required = true) {
  const entry = fields.get(field)?.[0];
  if (!entry) {
    if (required)
      throw new Error(`Required protobuf field ${field} is missing`);
    return undefined;
  }
  if (entry.wireType !== wireType) {
    throw new Error(`Protobuf field ${field} has the wrong wire type`);
  }
  return entry.value;
}

function builtinBuffer(value, declaredLength = value.length) {
  return Buffer.concat([
    protobufVarint(1, declaredLength),
    protobufBytes(2, value),
  ]);
}

export function buildNativeQrProtobuf({
  deviceId,
  randomKey,
  clientVersion = NATIVE_CLIENT_VERSION,
  deviceType = NATIVE_DEVICE_TYPE,
}) {
  if (!Buffer.isBuffer(deviceId) || deviceId.length !== 16) {
    throw new Error("deviceId must be exactly 16 random bytes");
  }
  if (!Buffer.isBuffer(randomKey) || randomKey.length !== 16) {
    throw new Error("randomKey must be exactly 16 random bytes");
  }
  const baseRequest = Buffer.concat([
    protobufBytes(1, Buffer.alloc(0)),
    protobufVarint(2, 0),
    protobufBytes(3, deviceId),
    protobufVarint(4, clientVersion),
    protobufBytes(5, Buffer.from(deviceType)),
    protobufVarint(6, 0),
  ]);
  return Buffer.concat([
    protobufBytes(1, baseRequest),
    protobufBytes(2, builtinBuffer(randomKey)),
    protobufVarint(3, 0),
  ]);
}

export function buildNativeQrCheckProtobuf({
  deviceId,
  randomKey,
  uuid,
  timestamp = Math.floor(Date.now() / 1000),
  clientVersion = NATIVE_CLIENT_VERSION,
  deviceType = NATIVE_DEVICE_TYPE,
}) {
  if (!Buffer.isBuffer(deviceId) || deviceId.length !== 16) {
    throw new Error("deviceId must be exactly 16 bytes");
  }
  if (!Buffer.isBuffer(randomKey) || randomKey.length !== 16) {
    throw new Error("randomKey must be exactly 16 bytes");
  }
  if (typeof uuid !== "string" || uuid.length === 0) {
    throw new Error("A native QR UUID is required");
  }
  const baseRequest = Buffer.concat([
    protobufBytes(1, randomKey),
    protobufVarint(2, 0),
    protobufBytes(3, deviceId),
    protobufVarint(4, clientVersion),
    protobufBytes(5, Buffer.from(deviceType)),
    protobufVarint(6, 0),
  ]);
  return Buffer.concat([
    protobufBytes(1, baseRequest),
    protobufBytes(2, builtinBuffer(randomKey)),
    protobufBytes(3, Buffer.from(uuid)),
    protobufVarint(4, timestamp),
    protobufVarint(5, 0),
  ]);
}

function hybridExpand(randomKey, info, length) {
  const prk = createHmac("sha256", Buffer.from("security hdkf expand"))
    .update(randomKey)
    .digest();
  return hkdfExpandOnly(prk, info, length);
}

function aes192GcmCompressEncrypt(key, plaintext, nonce, aad) {
  const cipher = createCipheriv("aes-192-gcm", key, nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([
    cipher.update(deflateSync(plaintext)),
    cipher.final(),
  ]);
  return Buffer.concat([ciphertext, nonce, cipher.getAuthTag()]);
}

function aes192GcmDecryptInflate(key, encrypted, aad) {
  if (encrypted.length < 28) throw new Error("Hybrid ciphertext is truncated");
  const ciphertext = encrypted.subarray(0, -28);
  const nonce = encrypted.subarray(-28, -16);
  const tag = encrypted.subarray(-16);
  const decipher = createDecipheriv("aes-192-gcm", key, nonce);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return inflateSync(
    Buffer.concat([decipher.update(ciphertext), decipher.final()]),
  );
}

export function hybridEncryptNativeRequest(
  plaintext,
  {
    ecdh = (() => {
      const value = createECDH("prime256v1");
      value.generateKeys();
      return value;
    })(),
    transportRandom = randomBytes(32),
    nonce = randomBytes(12),
  } = {},
) {
  const publicKey = ecdh.getPublicKey();
  const sharedSecret = sha256(ecdh.computeSecret(HYBRID_SERVER_KEY));
  const clientPublicHash = sha256(HYBRID_VERSION, HYBRID_NID, publicKey);
  const encryptedRandom = aes192GcmCompressEncrypt(
    sharedSecret.subarray(0, 24),
    transportRandom,
    nonce,
    clientPublicHash,
  );
  const expanded = hybridExpand(transportRandom, clientPublicHash, 56);
  const finalAad = sha256(
    HYBRID_VERSION,
    HYBRID_NID,
    publicKey,
    encryptedRandom,
  );
  const encryptedData = aes192GcmCompressEncrypt(
    expanded.subarray(0, 24),
    plaintext,
    nonce,
    finalAad,
  );
  const secKey = builtinBuffer(publicKey, 415);
  return {
    encrypted: Buffer.concat([
      protobufVarint(1, 1),
      protobufBytes(2, secKey),
      protobufBytes(3, encryptedRandom),
      protobufBytes(5, encryptedData),
    ]),
    state: {
      ecdh,
      serverHashPrefix: Buffer.concat([expanded.subarray(24, 56), plaintext]),
    },
  };
}

export function hybridDecryptNativeResponse(encrypted, state) {
  const fields = decodeProtobuf(encrypted);
  const secKeyFields = decodeProtobuf(firstField(fields, 1, 2));
  const serverPublicKey = firstField(secKeyFields, 2, 2);
  const decryptData = firstField(fields, 3, 2);
  if (serverPublicKey.length !== 65 || serverPublicKey[0] !== 0x04) {
    throw new Error("Hybrid response returned an invalid P-256 point");
  }
  const sharedSecret = sha256(state.ecdh.computeSecret(serverPublicKey));
  const aad = sha256(
    state.serverHashPrefix,
    HYBRID_NID,
    serverPublicKey,
    HYBRID_VERSION,
  );
  return aes192GcmDecryptInflate(
    sharedSecret.subarray(0, 24),
    decryptData,
    aad,
  );
}

export function prepareNativeQrRequest({
  deviceId = (() => {
    const value = randomBytes(16);
    value[0] = 0x49;
    return value;
  })(),
  randomKey = Buffer.from(
    [...randomBytes(16)].map(
      (value) =>
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"[value % 52],
    ),
  ),
} = {}) {
  const protobuf = buildNativeQrProtobuf({ deviceId, randomKey });
  const hybrid = hybridEncryptNativeRequest(protobuf);
  return {
    deviceId,
    randomKey,
    protobuf,
    encrypted: hybrid.encrypted,
    rqtxInputMd5: createHash("md5").update(hybrid.encrypted).digest("hex"),
    hybridState: hybrid.state,
  };
}

export function buildNativeBusinessPacket({
  encrypted,
  plaintextLength,
  rqtx,
  cgi = NATIVE_QR_CGI,
  clientVersion = NATIVE_CLIENT_VERSION,
}) {
  if (!Number.isInteger(rqtx) || rqtx < 0 || rqtx > 0xffffffff) {
    throw new Error("rqtx must be an unsigned 32-bit integer");
  }
  const header = Buffer.concat([
    Buffer.from([0xbf, 0x02, 0xc0]),
    u32(clientVersion),
    u32(0),
    encodeVarint(cgi),
    encodeVarint(plaintextLength),
    encodeVarint(plaintextLength),
    Buffer.from([0x90, 0x4e, 0x0d, 0x00, 0xff]),
    encodeVarint(rqtx),
    Buffer.from([0x00]),
  ]);
  if (header.length > 63) throw new Error("Native business header is too long");
  header[1] = (header.length << 2) + 2;
  return Buffer.concat([header, encrypted]);
}

export function unpackNativeBusinessResponse(response, hybridState) {
  if (response.length < 11 || response[0] !== 0xbf) {
    throw new Error(
      `WeChat returned an invalid native business packet (${response.length} bytes, prefix ${response.subarray(0, 64).toString("hex")})`,
    );
  }
  const headerLength = response[1] >> 2;
  const cookieLength = response[2] & 0x0f;
  if (headerLength < 11 || headerLength > response.length) {
    throw new Error("WeChat returned an invalid native header length");
  }
  return {
    cookies: Buffer.from(response.subarray(11, 11 + cookieLength)),
    protobuf: hybridDecryptNativeResponse(
      response.subarray(headerLength),
      hybridState,
    ),
  };
}

function parseBuiltinBuffer(buffer) {
  const fields = decodeProtobuf(buffer);
  const declaredLength = Number(firstField(fields, 1, 0, false) ?? 0n);
  const value = firstField(fields, 2, 2, false);
  if (!value) {
    if (declaredLength === 0) return Buffer.alloc(0);
    throw new Error(
      `SKBuiltinBuffer declared ${declaredLength} bytes but omitted its data`,
    );
  }
  if (value.length !== declaredLength) {
    throw new Error(
      `SKBuiltinBuffer declared ${declaredLength} bytes but carried ${value.length}`,
    );
  }
  return Buffer.from(value);
}

export function parseNativeQrResponse(protobuf) {
  const fields = decodeProtobuf(protobuf);
  const baseFields = decodeProtobuf(firstField(fields, 1, 2));
  const rawRet = firstField(baseFields, 1, 0);
  const ret = Number(BigInt.asIntN(32, rawRet));
  let errorMessage = "";
  const errorBuffer = firstField(baseFields, 2, 2, false);
  if (errorBuffer) {
    const errorFields = decodeProtobuf(errorBuffer);
    errorMessage = Buffer.from(
      firstField(errorFields, 1, 2, false) ?? [],
    ).toString();
  }
  const qrField = firstField(fields, 2, 2, false);
  const uuidField = firstField(fields, 3, 2, false);
  const notifyField = firstField(fields, 5, 2, false);
  const expiredField = firstField(fields, 6, 0, false);
  return {
    ret,
    errorMessage,
    qrImage: qrField ? parseBuiltinBuffer(qrField) : undefined,
    uuid: uuidField ? Buffer.from(uuidField).toString() : undefined,
    notifyKey: notifyField ? parseBuiltinBuffer(notifyField) : undefined,
    expiresInSeconds:
      expiredField === undefined ? undefined : Number(expiredField),
  };
}

function parseBaseResponse(fields) {
  const baseFields = decodeProtobuf(firstField(fields, 1, 2));
  const ret = Number(BigInt.asIntN(32, firstField(baseFields, 1, 0)));
  const errorBuffer = firstField(baseFields, 2, 2, false);
  let errorMessage = "";
  if (errorBuffer) {
    const errorFields = decodeProtobuf(errorBuffer);
    errorMessage = Buffer.from(
      firstField(errorFields, 1, 2, false) ?? [],
    ).toString();
  }
  return { ret, errorMessage };
}

export function parseNativeQrCheckResponse(protobuf, notifyKey) {
  const fields = decodeProtobuf(protobuf);
  const base = parseBaseResponse(fields);
  const notifyPackage = firstField(fields, 3, 2, false);
  if (!notifyPackage) return { ...base, state: "waiting" };
  const packageFields = decodeProtobuf(notifyPackage);
  const notifyBuiltin = firstField(packageFields, 1, 2, false);
  if (!notifyBuiltin) return { ...base, state: "waiting" };
  const encryptedNotify = parseBuiltinBuffer(notifyBuiltin);
  if (encryptedNotify.length === 0) return { ...base, state: "waiting" };
  if (encryptedNotify.length % 16 !== 0) {
    throw new Error("Native QR notification is not block aligned");
  }
  if (!Buffer.isBuffer(notifyKey) || notifyKey.length !== 16) {
    throw new Error("Native QR notification key must be exactly 16 bytes");
  }
  const decipher = createDecipheriv("aes-128-cbc", notifyKey, notifyKey);
  const notify = Buffer.concat([
    decipher.update(encryptedNotify),
    decipher.final(),
  ]);
  const notifyFields = decodeProtobuf(notify);
  const status = Number(firstField(notifyFields, 2, 0, false) ?? 0n);
  const stringField = (field) => {
    const value = firstField(notifyFields, field, 2, false);
    return value ? Buffer.from(value).toString() : undefined;
  };
  return {
    ...base,
    status,
    state: status === 2 ? "approved" : status === 1 ? "scanned" : "waiting",
    account: {
      userName: stringField(3),
      password: stringField(4),
      headImageUrl: stringField(5),
      nickName: stringField(7),
    },
  };
}

export function buildSecManualAuthProtobuf({
  deviceId,
  userName,
  password,
  attestation,
  randomKey = Buffer.from(
    [...randomBytes(16)].map(
      (value) =>
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"[value % 52],
    ),
  ),
  timestamp = Math.floor(Date.now() / 1000),
}) {
  if (!Buffer.isBuffer(deviceId) || deviceId.length !== 16) {
    throw new Error("deviceId must be exactly 16 bytes");
  }
  if (!userName || !password) {
    throw new Error("Phone-approved native credentials are required");
  }
  if (!attestation?.extSpam || !attestation?.softType) {
    throw new Error("Device attestation is required for native authentication");
  }

  const p224Ecdh = createECDH("secp224r1");
  p224Ecdh.generateKeys();
  const p224PublicKey = p224Ecdh.getPublicKey();
  const accountRequest = Buffer.concat([
    protobufBytes(1, builtinBuffer(randomKey)),
    protobufBytes(
      2,
      Buffer.concat([
        protobufVarint(1, 713),
        protobufBytes(2, builtinBuffer(p224PublicKey)),
      ]),
    ),
    protobufBytes(3, Buffer.from(userName)),
    protobufBytes(4, Buffer.from(password)),
    protobufBytes(5, Buffer.from(password)),
  ]);
  const baseRequest = Buffer.concat([
    protobufBytes(1, randomKey),
    protobufVarint(2, 0),
    protobufBytes(3, deviceId),
    protobufVarint(4, NATIVE_CLIENT_VERSION),
    protobufBytes(5, Buffer.from(NATIVE_DEVICE_TYPE)),
    protobufVarint(6, 1),
  ]);
  const deviceRequest = Buffer.concat([
    protobufBytes(1, baseRequest),
    protobufBytes(2, Buffer.alloc(0)),
    protobufBytes(3, Buffer.from(attestation.imei)),
    protobufBytes(4, Buffer.from(attestation.softType)),
    protobufVarint(5, 0),
    protobufBytes(6, Buffer.from(attestation.clientSeq)),
    protobufBytes(8, Buffer.from("iPad Air (第7代)")),
    protobufBytes(9, Buffer.from("iPad")),
    protobufBytes(10, Buffer.from("zh_CN")),
    protobufBytes(11, Buffer.from("8.0")),
    protobufVarint(13, 0),
    protobufVarint(14, timestamp),
    protobufBytes(15, Buffer.from("Apple")),
    protobufBytes(17, Buffer.from(NATIVE_DEVICE_TYPE)),
    protobufBytes(18, Buffer.from("CN")),
    protobufBytes(19, Buffer.from("com.tencent.xin")),
    protobufBytes(20, Buffer.from(attestation.adSource)),
    protobufBytes(21, Buffer.from("iPad14,4")),
    protobufVarint(22, 2),
    protobufBytes(24, builtinBuffer(attestation.extSpam)),
  ]);
  return {
    protobuf: Buffer.concat([
      protobufBytes(1, accountRequest),
      protobufBytes(2, deviceRequest),
    ]),
    randomKey,
    p224Ecdh,
  };
}

function parseOptionalBuiltin(fields, field) {
  const value = firstField(fields, field, 2, false);
  return value ? parseBuiltinBuffer(value) : undefined;
}

export function parseSecManualAuthResponse(protobuf, p224Ecdh) {
  const fields = decodeProtobuf(protobuf);
  const base = parseBaseResponse(fields);
  const unifyAuthSectFlag = Number(firstField(fields, 2, 0, false) ?? 0n);
  if (base.ret !== 0 || unifyAuthSectFlag === 0) {
    return {
      ...base,
      unifyAuthSectFlag,
      established: false,
      shortLinkRedirects: parseShortLinkRedirects(fields),
    };
  }

  const authFields = decodeProtobuf(firstField(fields, 3, 2));
  const accountFields = decodeProtobuf(firstField(fields, 4, 2));
  const serverEcdhFields = decodeProtobuf(firstField(authFields, 2, 2));
  const serverPublicKey = parseBuiltinBuffer(
    firstField(serverEcdhFields, 2, 2),
  );
  const encryptedSessionKey = parseOptionalBuiltin(authFields, 3);
  if (!encryptedSessionKey) {
    throw new Error("Manual authentication omitted the session key");
  }
  const sharedSecret = p224Ecdh.computeSecret(serverPublicKey);
  const sessionDecryptKey = createHash("md5").update(sharedSecret).digest();
  const decipher = createDecipheriv(
    "aes-128-cbc",
    sessionDecryptKey,
    sessionDecryptKey,
  );
  const sessionKey = Buffer.concat([
    decipher.update(encryptedSessionKey),
    decipher.final(),
  ]);
  const stringField = (field) => {
    const value = firstField(accountFields, field, 2, false);
    return value ? Buffer.from(value).toString() : undefined;
  };
  return {
    ...base,
    unifyAuthSectFlag,
    established: true,
    uin: Number(firstField(authFields, 1, 0)),
    sessionKey,
    encryptedSessionKey,
    autoAuthKey: parseOptionalBuiltin(authFields, 4),
    clientSessionKey: parseOptionalBuiltin(authFields, 23),
    serverSessionKey: parseOptionalBuiltin(authFields, 24),
    loginEcdhKey: sharedSecret,
    account: {
      userName: stringField(1),
      nickName: stringField(2),
      email: stringField(4),
      mobile: stringField(5),
      alias: stringField(6),
    },
  };
}

function parseShortLinkRedirects(fields) {
  const networkBuffer = firstField(fields, 5, 2, false);
  if (!networkBuffer) return [];
  const network = decodeProtobuf(networkBuffer);
  const cleanString = (value) =>
    Buffer.from(value ?? [])
      .toString()
      .replaceAll("\0", "")
      .trim();
  const redirects = [];
  const newHostListBuffer = firstField(network, 1, 2, false);
  if (newHostListBuffer) {
    const newHostList = decodeProtobuf(newHostListBuffer);
    for (const entry of newHostList.get(2) ?? []) {
      if (entry.wireType !== 2) continue;
      const hostInfo = decodeProtobuf(entry.value);
      const source = cleanString(firstField(hostInfo, 1, 2, false));
      const target = cleanString(firstField(hostInfo, 2, 2, false));
      if (source.includes("short.weixin.qq.com") && target) {
        redirects.push(target);
      }
    }
  }
  const builtinBuffer = firstField(network, 3, 2, false);
  if (builtinBuffer) {
    const builtin = decodeProtobuf(builtinBuffer);
    for (const entry of builtin.get(4) ?? []) {
      if (entry.wireType !== 2) continue;
      const ipInfo = decodeProtobuf(entry.value);
      const ip = cleanString(firstField(ipInfo, 3, 2, false));
      const host = cleanString(firstField(ipInfo, 4, 2, false));
      if (host) redirects.push(host);
      if (ip) redirects.push(ip);
    }
  }
  return [...new Set(redirects)];
}
