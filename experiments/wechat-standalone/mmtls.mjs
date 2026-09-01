import {
  createCipheriv,
  createDecipheriv,
  createECDH,
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify,
} from "node:crypto";
import http from "node:http";
import net from "node:net";

export const PROTOCOL_VERSION = 0xf104;
export const RECORD_HANDSHAKE = 0x16;
export const RECORD_DATA = 0x17;
export const RECORD_ABORT = 0x15;
export const RECORD_SYSTEM = 0x19;

const ECDHE_ECDSA_AES_128_GCM_SHA256 = 0xc02b;
const NOOP_REQUEST = 0x00000006;
const NOOP_RESPONSE = 0x3b9aca06;
const SERVER_KEY_X = Buffer.from(
  "1da177b6a5ed34dabb3f2b047697ca8bbeb78c68389ced43317a298d77316d54",
  "hex",
);
const SERVER_KEY_Y = Buffer.from(
  "4175c032bc573d5ce4b3ac0b7f2b9a8d48ca4b990ce2fa3ce75cc9d12720fa35",
  "hex",
);
const REGIONAL_SERVER_KEY_X = Buffer.from(
  "ab915700062064dae83edafcceb85c5c761bc46b5eed2e4c9cb8e50dabe4b05b",
  "hex",
);
const REGIONAL_SERVER_KEY_Y = Buffer.from(
  "8bc6c7b5ad5a8acbfc6512eb8270a87572e06e7838231e84a5abe465aa341753",
  "hex",
);
const ECDHE_EXTENSION_TRAILER = Buffer.from([
  0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04,
]);

function u16(value) {
  const output = Buffer.alloc(2);
  output.writeUInt16BE(value);
  return output;
}

function u16le(value) {
  const output = Buffer.alloc(2);
  output.writeUInt16LE(value);
  return output;
}

function u32(value) {
  const output = Buffer.alloc(4);
  output.writeUInt32BE(value >>> 0);
  return output;
}

function withU32Length(payload) {
  return Buffer.concat([u32(payload.length), payload]);
}

function b64url(value) {
  return value.toString("base64url");
}

export function sha256(...chunks) {
  const hash = createHash("sha256");
  for (const chunk of chunks) hash.update(chunk);
  return hash.digest();
}

function hmacSha256(key, value) {
  return createHmac("sha256", key).update(value).digest();
}

export function hkdfExpandOnly(prk, info, length) {
  if (length > 255 * 32) throw new Error("HKDF output is too long");

  const blocks = [];
  let previous = Buffer.alloc(0);
  for (let counter = 1; Buffer.concat(blocks).length < length; counter += 1) {
    previous = hmacSha256(
      prk,
      Buffer.concat([previous, Buffer.from(info), Buffer.from([counter])]),
    );
    blocks.push(previous);
  }
  return Buffer.concat(blocks).subarray(0, length);
}

function makeEcdheExtension(publicKeys) {
  const keyEntries = publicKeys.map((publicKey, index) => {
    const entry = Buffer.concat([
      u32(5 + index),
      u16(publicKey.length),
      publicKey,
    ]);
    return withU32Length(entry);
  });
  const payload = Buffer.concat([
    u16(0x0010),
    Buffer.from([publicKeys.length]),
    ...keyEntries,
    ECDHE_EXTENSION_TRAILER,
  ]);
  return withU32Length(payload);
}

export function buildClientHello({
  transportPublicKey,
  verificationPublicKey,
  random = randomBytes(32),
  timestamp = Math.floor(Date.now() / 1000),
}) {
  for (const [name, value] of [
    ["transportPublicKey", transportPublicKey],
    ["verificationPublicKey", verificationPublicKey],
  ]) {
    if (!Buffer.isBuffer(value) || value.length !== 65 || value[0] !== 0x04) {
      throw new Error(`${name} must be a 65-byte uncompressed P-256 point`);
    }
  }
  if (!Buffer.isBuffer(random) || random.length !== 32) {
    throw new Error("random must be exactly 32 bytes");
  }

  const extension = makeEcdheExtension([
    transportPublicKey,
    verificationPublicKey,
  ]);
  const extensions = Buffer.concat([Buffer.from([1]), extension]);
  const body = Buffer.concat([
    Buffer.from([1]),
    u16le(PROTOCOL_VERSION),
    Buffer.from([1]),
    u16(ECDHE_ECDSA_AES_128_GCM_SHA256),
    random,
    u32(timestamp),
    u32(extensions.length),
    extensions,
  ]);
  return withU32Length(body);
}

export function serializeRecord(recordType, payload) {
  if (payload.length > 0xffff) throw new Error("MMTLS record is too large");
  return Buffer.concat([
    Buffer.from([recordType]),
    u16(PROTOCOL_VERSION),
    u16(payload.length),
    payload,
  ]);
}

function nonceForSequence(baseNonce, sequence) {
  const nonce = Buffer.from(baseNonce);
  for (let index = 0; index < 4; index += 1) {
    nonce[nonce.length - 1 - index] ^= (sequence >>> (index * 8)) & 0xff;
  }
  return nonce;
}

function additionalData(recordType, encryptedLength, sequence) {
  const aad = Buffer.alloc(13);
  aad.writeBigUInt64BE(BigInt(sequence), 0);
  aad[8] = recordType;
  aad.writeUInt16BE(PROTOCOL_VERSION, 9);
  aad.writeUInt16BE(encryptedLength, 11);
  return aad;
}

export function encryptRecordPayload({
  key,
  baseNonce,
  sequence,
  recordType,
  plaintext,
}) {
  const encryptedLength = plaintext.length + 16;
  const cipher = createCipheriv(
    "aes-128-gcm",
    key,
    nonceForSequence(baseNonce, sequence),
  );
  cipher.setAAD(additionalData(recordType, encryptedLength, sequence));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([ciphertext, cipher.getAuthTag()]);
}

export function decryptRecordPayload({
  key,
  baseNonce,
  sequence,
  recordType,
  ciphertext,
}) {
  if (ciphertext.length < 16)
    throw new Error("Encrypted record has no GCM tag");
  const body = ciphertext.subarray(0, -16);
  const tag = ciphertext.subarray(-16);
  const decipher = createDecipheriv(
    "aes-128-gcm",
    key,
    nonceForSequence(baseNonce, sequence),
  );
  decipher.setAAD(additionalData(recordType, ciphertext.length, sequence));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

function splitTrafficKey(material) {
  if (material.length !== 56) throw new Error("Traffic key must be 56 bytes");
  return {
    clientKey: material.subarray(0, 16),
    serverKey: material.subarray(16, 32),
    clientNonce: material.subarray(32, 44),
    serverNonce: material.subarray(44, 56),
  };
}

export function parseServerHello(payload) {
  if (payload.length < 58) throw new Error("ServerHello is truncated");
  const declaredLength = payload.readUInt32BE(0);
  if (declaredLength + 4 !== payload.length) {
    throw new Error("ServerHello length mismatch");
  }

  let offset = 4;
  offset += 1;
  const version = payload.readUInt16LE(offset);
  offset += 2;
  const cipherSuite = payload.readUInt16BE(offset);
  offset += 2 + 32 + 4;
  const extensionCount = payload[offset];
  offset += 1;
  if (extensionCount < 1) throw new Error("ServerHello has no key extension");
  offset += 4 + 2;
  const keyPairSequence = payload.readUInt32BE(offset);
  offset += 4;
  if (offset + 2 > payload.length)
    throw new Error("ServerHello key is missing");
  const keyLength = payload.readUInt16BE(offset);
  offset += 2;
  const publicKey = payload.subarray(offset, offset + keyLength);
  if (publicKey.length !== 65 || publicKey[0] !== 0x04) {
    throw new Error("ServerHello returned an invalid P-256 point");
  }
  if (version !== PROTOCOL_VERSION) {
    throw new Error(`Unexpected MMTLS version 0x${version.toString(16)}`);
  }
  if (cipherSuite !== ECDHE_ECDSA_AES_128_GCM_SHA256) {
    throw new Error(`Unexpected cipher suite 0x${cipherSuite.toString(16)}`);
  }
  if (![5, 6].includes(keyPairSequence)) {
    throw new Error(`Unexpected server key selection ${keyPairSequence}`);
  }
  return { version, cipherSuite, keyPairSequence, publicKey };
}

class SocketReader {
  constructor(socket) {
    this.iterator = socket[Symbol.asyncIterator]();
    this.buffer = Buffer.alloc(0);
  }

  async read(length) {
    while (this.buffer.length < length) {
      const { value, done } = await this.iterator.next();
      if (done) throw new Error("WeChat closed the connection unexpectedly");
      this.buffer = Buffer.concat([this.buffer, value]);
    }
    const result = this.buffer.subarray(0, length);
    this.buffer = this.buffer.subarray(length);
    return result;
  }

  async readRecord() {
    const header = await this.read(5);
    const version = header.readUInt16BE(1);
    if (version !== PROTOCOL_VERSION) {
      throw new Error(`Unexpected record version 0x${version.toString(16)}`);
    }
    const length = header.readUInt16BE(3);
    return {
      type: header[0],
      version,
      payload: await this.read(length),
    };
  }
}

class BufferReader {
  constructor(buffer) {
    this.buffer = Buffer.from(buffer);
  }

  async read(length) {
    if (this.buffer.length < length) {
      throw new Error("WeChat's MMTLS handshake response was truncated");
    }
    const result = this.buffer.subarray(0, length);
    this.buffer = this.buffer.subarray(length);
    return result;
  }

  async readRecord() {
    const header = await this.read(5);
    const version = header.readUInt16BE(1);
    if (version !== PROTOCOL_VERSION) {
      throw new Error(`Unexpected record version 0x${version.toString(16)}`);
    }
    const length = header.readUInt16BE(3);
    return {
      type: header[0],
      version,
      payload: await this.read(length),
    };
  }
}

function expectRecordType(record, expected, label) {
  if (record.type !== expected) {
    throw new Error(
      `${label} used record type 0x${record.type.toString(16)}, expected 0x${expected.toString(16)}`,
    );
  }
}

function parseHandshakeMessage(payload, expectedType, label) {
  if (payload.length < 7 || payload.readUInt32BE(0) + 4 !== payload.length) {
    throw new Error(`${label} has an invalid length`);
  }
  if (payload[4] !== expectedType) {
    throw new Error(
      `${label} has unexpected type 0x${payload[4].toString(16)}`,
    );
  }
  const length = payload.readUInt16BE(5);
  const body = payload.subarray(7, 7 + length);
  if (body.length !== length) throw new Error(`${label} is truncated`);
  return body;
}

export function parseSessionTickets(payload) {
  if (payload.length < 6 || payload.readUInt32BE(0) + 4 !== payload.length) {
    throw new Error("Session ticket message has an invalid length");
  }
  if (payload[4] !== 0x04) throw new Error("Unexpected session ticket message");

  const count = payload[5];
  const tickets = [];
  let offset = 6;
  const take = (length, label) => {
    if (offset + length > payload.length) {
      throw new Error(`Session ticket ${label} is truncated`);
    }
    const value = payload.subarray(offset, offset + length);
    offset += length;
    return value;
  };
  const takeU16Bytes = (label) => {
    const length = take(2, `${label} length`).readUInt16BE(0);
    return Buffer.from(take(length, label));
  };

  for (let index = 0; index < count; index += 1) {
    const itemLength = take(4, "item length").readUInt32BE(0);
    const itemEnd = offset + itemLength;
    if (itemEnd > payload.length)
      throw new Error("Session ticket is truncated");

    const ticketType = take(1, "type")[0];
    const lifetime = take(4, "lifetime").readUInt32BE(0);
    const ageAdd = takeU16Bytes("age add");
    const reserved = take(4, "reserved").readUInt32BE(0);
    const nonce = takeU16Bytes("nonce");
    const ticket = takeU16Bytes("ticket");
    if (offset !== itemEnd) throw new Error("Session ticket length mismatch");
    tickets.push({ ticketType, lifetime, ageAdd, reserved, nonce, ticket });
  }
  if (offset !== payload.length) {
    throw new Error("Session ticket message has trailing data");
  }
  return tickets;
}

export function serializeSessionTicket(ticket, { omitAgeAdd = false } = {}) {
  const ageAdd = omitAgeAdd ? Buffer.alloc(0) : ticket.ageAdd;
  for (const [name, value] of [
    ["ageAdd", ageAdd],
    ["nonce", ticket.nonce],
    ["ticket", ticket.ticket],
  ]) {
    if (!Buffer.isBuffer(value) || value.length > 0xffff) {
      throw new Error(`${name} must be a Buffer no longer than 65535 bytes`);
    }
  }
  return Buffer.concat([
    Buffer.from([ticket.ticketType]),
    u32(ticket.lifetime),
    u16(ageAdd.length),
    ageAdd,
    u32(ticket.reserved),
    u16(ticket.nonce.length),
    ticket.nonce,
    u16(ticket.ticket.length),
    ticket.ticket,
  ]);
}

function makeDataPayload(dataType, sequence) {
  return Buffer.concat([
    u32(16),
    u16(0x10),
    u16(1),
    u32(dataType),
    u32(sequence),
  ]);
}

function publicKeyFromCoordinates(x, y) {
  return createPublicKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: b64url(x),
      y: b64url(y),
    },
    format: "jwk",
  });
}

function pinnedServerKeys({ trustedServerRedirect }) {
  const keys = [publicKeyFromCoordinates(SERVER_KEY_X, SERVER_KEY_Y)];
  if (trustedServerRedirect) {
    keys.push(
      publicKeyFromCoordinates(REGIONAL_SERVER_KEY_X, REGIONAL_SERVER_KEY_Y),
    );
  }
  return keys;
}

async function connect(host, port, timeoutMs) {
  const socket = net.createConnection({ host, port });
  socket.setNoDelay(true);
  socket.setTimeout(timeoutMs, () => {
    socket.destroy(new Error(`MMTLS probe timed out after ${timeoutMs} ms`));
  });
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  return socket;
}

function postMmtlsHandshake({ host, port, payload, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host,
        port,
        method: "POST",
        path: `/mmtls/${randomBytes(4).toString("hex")}`,
        headers: {
          Accept: "*/*",
          "Cache-Control": "no-cache",
          Connection: "close",
          "Content-Type": "application/octet-stream",
          "Content-Length": payload.length,
          "User-Agent": "MicroMessenger Client",
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          if (response.statusCode !== 200) {
            reject(
              new Error(
                `WeChat MMTLS handshake returned HTTP ${response.statusCode}`,
              ),
            );
            return;
          }
          resolve(Buffer.concat(chunks));
        });
      },
    );
    request.setTimeout(timeoutMs, () => {
      request.destroy(
        new Error(`MMTLS handshake timed out after ${timeoutMs} ms`),
      );
    });
    request.once("error", reject);
    request.end(payload);
  });
}

export async function createMmtlsSession({
  host = "long.weixin.qq.com",
  port = 80,
  timeoutMs = 10_000,
  transport = "raw",
  trustedServerRedirect = false,
} = {}) {
  const isWeChatHostname =
    /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.weixin\.qq\.com$/i.test(host);
  const permittedRedirect =
    trustedServerRedirect && (isWeChatHostname || net.isIP(host));
  if (
    port !== 80 ||
    !["raw", "http"].includes(transport) ||
    (host !== "long.weixin.qq.com" && !permittedRedirect) ||
    (transport === "raw" && host !== "long.weixin.qq.com")
  ) {
    throw new Error(
      "The experiment only permits raw long.weixin.qq.com:80 or an HTTP MMTLS handshake to a server-signed WeChat redirect",
    );
  }

  const transportEcdh = createECDH("prime256v1");
  const verificationEcdh = createECDH("prime256v1");
  transportEcdh.generateKeys();
  verificationEcdh.generateKeys();

  const clientHello = buildClientHello({
    transportPublicKey: transportEcdh.getPublicKey(),
    verificationPublicKey: verificationEcdh.getPublicKey(),
  });
  let transcript = Buffer.from(clientHello);
  let clientSequence = 0;
  let serverSequence = 0;
  let socket;

  try {
    let reader;
    if (transport === "http") {
      const response = await postMmtlsHandshake({
        host,
        port,
        payload: serializeRecord(RECORD_HANDSHAKE, clientHello),
        timeoutMs,
      });
      reader = new BufferReader(response);
    } else {
      socket = await connect(host, port, timeoutMs);
      reader = new SocketReader(socket);
      socket.write(serializeRecord(RECORD_HANDSHAKE, clientHello));
    }
    clientSequence += 1;

    const serverHelloRecord = await reader.readRecord();
    expectRecordType(serverHelloRecord, RECORD_HANDSHAKE, "ServerHello");
    const serverHello = parseServerHello(serverHelloRecord.payload);
    transcript = Buffer.concat([transcript, serverHelloRecord.payload]);
    serverSequence += 1;

    const selectedEcdh =
      serverHello.keyPairSequence === 5 ? transportEcdh : verificationEcdh;
    const sharedSecret = sha256(
      selectedEcdh.computeSecret(serverHello.publicKey),
    );
    const handshakeHash = () => sha256(transcript);
    const handshakeTraffic = splitTrafficKey(
      hkdfExpandOnly(
        sharedSecret,
        Buffer.concat([
          Buffer.from("handshake key expansion"),
          handshakeHash(),
        ]),
        56,
      ),
    );

    const signatureRecord = await reader.readRecord();
    expectRecordType(signatureRecord, RECORD_HANDSHAKE, "Server signature");
    const signaturePayload = decryptRecordPayload({
      key: handshakeTraffic.serverKey,
      baseNonce: handshakeTraffic.serverNonce,
      sequence: serverSequence,
      recordType: signatureRecord.type,
      ciphertext: signatureRecord.payload,
    });
    const signature = parseHandshakeMessage(
      signaturePayload,
      0x0f,
      "Server signature",
    );
    const signatureDigest = handshakeHash();
    const signatureVerified = pinnedServerKeys({
      trustedServerRedirect,
    }).some((key) => verify("sha256", signatureDigest, key, signature));
    if (!signatureVerified) {
      const error = new Error("Server signature verification failed");
      error.handshakeEvidence = {
        digest: signatureDigest.toString("hex"),
        signature: signature.toString("hex"),
      };
      throw error;
    }
    transcript = Buffer.concat([transcript, signaturePayload]);
    serverSequence += 1;

    const ticketRecord = await reader.readRecord();
    expectRecordType(ticketRecord, RECORD_HANDSHAKE, "Session ticket");
    const ticketPayload = decryptRecordPayload({
      key: handshakeTraffic.serverKey,
      baseNonce: handshakeTraffic.serverNonce,
      sequence: serverSequence,
      recordType: ticketRecord.type,
      ciphertext: ticketRecord.payload,
    });
    const tickets = parseSessionTickets(ticketPayload);
    const pskAccess = hkdfExpandOnly(
      sharedSecret,
      Buffer.concat([Buffer.from("PSK_ACCESS"), handshakeHash()]),
      32,
    );
    transcript = Buffer.concat([transcript, ticketPayload]);
    serverSequence += 1;

    const finishRecord = await reader.readRecord();
    expectRecordType(finishRecord, RECORD_HANDSHAKE, "Server finish");
    const finishPayload = decryptRecordPayload({
      key: handshakeTraffic.serverKey,
      baseNonce: handshakeTraffic.serverNonce,
      sequence: serverSequence,
      recordType: finishRecord.type,
      ciphertext: finishRecord.payload,
    });
    const serverFinish = parseHandshakeMessage(
      finishPayload,
      0x14,
      "Server finish",
    );
    const serverFinishKey = hkdfExpandOnly(
      sharedSecret,
      Buffer.from("server finished"),
      32,
    );
    const expectedServerFinish = hmacSha256(serverFinishKey, handshakeHash());
    if (
      serverFinish.length !== expectedServerFinish.length ||
      !timingSafeEqual(serverFinish, expectedServerFinish)
    ) {
      throw new Error("Server finish verification failed");
    }
    serverSequence += 1;

    if (transport === "raw") {
      const clientFinishKey = hkdfExpandOnly(
        sharedSecret,
        Buffer.from("client finished"),
        32,
      );
      const clientFinish = Buffer.concat([
        Buffer.from([0x14]),
        u16(32),
        hmacSha256(clientFinishKey, handshakeHash()),
      ]);
      const clientFinishPayload = withU32Length(clientFinish);
      const encryptedClientFinish = encryptRecordPayload({
        key: handshakeTraffic.clientKey,
        baseNonce: handshakeTraffic.clientNonce,
        sequence: clientSequence,
        recordType: RECORD_HANDSHAKE,
        plaintext: clientFinishPayload,
      });
      socket.write(serializeRecord(RECORD_HANDSHAKE, encryptedClientFinish));
      clientSequence += 1;

      const expandedSecret = hkdfExpandOnly(
        sharedSecret,
        Buffer.concat([Buffer.from("expanded secret"), handshakeHash()]),
        32,
      );
      const appTraffic = splitTrafficKey(
        hkdfExpandOnly(
          expandedSecret,
          Buffer.concat([
            Buffer.from("application data key expansion"),
            handshakeHash(),
          ]),
          56,
        ),
      );

      const noop = makeDataPayload(NOOP_REQUEST, 0xffffffff);
      const encryptedNoop = encryptRecordPayload({
        key: appTraffic.clientKey,
        baseNonce: appTraffic.clientNonce,
        sequence: clientSequence,
        recordType: RECORD_DATA,
        plaintext: noop,
      });
      socket.write(serializeRecord(RECORD_DATA, encryptedNoop));
      clientSequence += 1;

      const noopRecord = await reader.readRecord();
      expectRecordType(noopRecord, RECORD_DATA, "Noop response");
      const noopResponse = decryptRecordPayload({
        key: appTraffic.serverKey,
        baseNonce: appTraffic.serverNonce,
        sequence: serverSequence,
        recordType: noopRecord.type,
        ciphertext: noopRecord.payload,
      });
      if (
        noopResponse.length !== 16 ||
        noopResponse.readUInt32BE(0) !== 16 ||
        noopResponse.readUInt32BE(8) !== NOOP_RESPONSE
      ) {
        throw new Error("Encrypted Noop response was invalid");
      }
    }

    const result = {
      host: `${host}:${port}`,
      protocolVersion: `0x${PROTOCOL_VERSION.toString(16)}`,
      transportHandshake: true,
      serverSignatureVerified: true,
      resumptionTicketCount: tickets.length,
      encryptedHeartbeat: transport === "raw",
      authenticationAttempted: false,
      nextBoundary:
        "current personal-account QR/login protobuf and accepted device identity",
    };
    return {
      result,
      session: {
        tickets,
        pskAccess,
      },
    };
  } finally {
    socket?.destroy();
  }
}

export async function runTransportProbe(options = {}) {
  const { result } = await createMmtlsSession(options);
  return result;
}
