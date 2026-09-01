import http from "node:http";
import { randomBytes } from "node:crypto";
import { isIP } from "node:net";

import {
  PROTOCOL_VERSION,
  RECORD_ABORT,
  RECORD_DATA,
  RECORD_HANDSHAKE,
  RECORD_SYSTEM,
  decryptRecordPayload,
  encryptRecordPayload,
  hkdfExpandOnly,
  serializeRecord,
  serializeSessionTicket,
  sha256,
} from "./mmtls.mjs";

const PSK_AES_128_GCM_SHA256 = 0x00a8;
const ALLOWED_SHORT_HOSTS = new Set([
  "extshort.weixin.qq.com",
  "hkshort.weixin.qq.com",
  "szshort.weixin.qq.com",
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

function withU32Length(value) {
  return Buffer.concat([u32(value.length), value]);
}

export function buildPskZeroClientHello({
  ticket,
  random = randomBytes(32),
  timestamp = Math.floor(Date.now() / 1000),
}) {
  if (!ticket) throw new Error("A session ticket is required for 0-RTT");
  if (!Buffer.isBuffer(random) || random.length !== 32) {
    throw new Error("random must be exactly 32 bytes");
  }

  const ticketData = serializeSessionTicket(ticket, { omitAgeAdd: true });
  const extension = withU32Length(
    Buffer.concat([u16(0x000f), Buffer.from([1]), withU32Length(ticketData)]),
  );
  const extensions = Buffer.concat([Buffer.from([1]), extension]);
  return withU32Length(
    Buffer.concat([
      Buffer.from([1]),
      u16le(PROTOCOL_VERSION),
      Buffer.from([1]),
      u16(PSK_AES_128_GCM_SHA256),
      random,
      u32(timestamp),
      u32(extensions.length),
      extensions,
    ]),
  );
}

export function buildShortRequestData({ host, path, body }) {
  const pathBytes = Buffer.from(path);
  const hostBytes = Buffer.from(host);
  if (pathBytes.length > 0xffff || hostBytes.length > 0xffff) {
    throw new Error("Short-link host or path is too long");
  }
  const inner = Buffer.concat([
    u16(pathBytes.length),
    pathBytes,
    u16(hostBytes.length),
    hostBytes,
    u32(body.length),
    body,
  ]);
  return withU32Length(inner);
}

export function buildShortMmtlsPayload({
  session,
  host,
  path,
  body,
  random,
  timestamp = Math.floor(Date.now() / 1000),
}) {
  const ticket = session?.tickets?.[0];
  if (!ticket || !Buffer.isBuffer(session.pskAccess)) {
    throw new Error("A complete MMTLS resumption session is required");
  }

  const hello = buildPskZeroClientHello({ ticket, random, timestamp });
  const earlyMaterial = hkdfExpandOnly(
    session.pskAccess,
    Buffer.concat([Buffer.from("early data key expansion"), sha256(hello)]),
    28,
  );
  const earlyKey = earlyMaterial.subarray(0, 16);
  const earlyNonce = earlyMaterial.subarray(16, 28);
  const extensions = Buffer.from([
    0x00,
    0x00,
    0x00,
    0x10,
    0x08,
    0x00,
    0x00,
    0x00,
    0x0b,
    0x01,
    0x00,
    0x00,
    0x00,
    0x06,
    0x00,
    0x12,
    ...u32(timestamp),
  ]);
  const requestData = buildShortRequestData({ host, path, body });
  const abort = Buffer.from([0x00, 0x00, 0x00, 0x03, 0x00, 0x01, 0x01]);
  const encrypt = (recordType, plaintext, sequence) =>
    serializeRecord(
      recordType,
      encryptRecordPayload({
        key: earlyKey,
        baseNonce: earlyNonce,
        sequence,
        recordType,
        plaintext,
      }),
    );

  return {
    payload: Buffer.concat([
      serializeRecord(RECORD_SYSTEM, hello),
      encrypt(RECORD_SYSTEM, extensions, 1),
      encrypt(RECORD_DATA, requestData, 2),
      encrypt(RECORD_ABORT, abort, 3),
    ]),
    transcript: Buffer.concat([hello, extensions]),
  };
}

function parseRecord(buffer, offset) {
  if (offset + 5 > buffer.length) {
    throw new Error(
      `MMTLS response is truncated at ${offset}/${buffer.length} bytes (prefix ${buffer.subarray(0, 24).toString("hex")})`,
    );
  }
  const type = buffer[offset];
  const version = buffer.readUInt16BE(offset + 1);
  const length = buffer.readUInt16BE(offset + 3);
  const end = offset + 5 + length;
  if (version !== PROTOCOL_VERSION) {
    throw new Error(`Unexpected record version 0x${version.toString(16)}`);
  }
  if (end > buffer.length) {
    throw new Error(
      `MMTLS response record is truncated at ${offset}/${buffer.length} bytes (declared ${length}, prefix ${buffer.subarray(0, 24).toString("hex")})`,
    );
  }
  return { type, payload: buffer.subarray(offset + 5, end), end };
}

export function decryptShortMmtlsResponse({ session, transcript, response }) {
  let offset = 0;
  const serverHello = parseRecord(response, offset);
  offset = serverHello.end;
  const responseTranscript = Buffer.concat([transcript, serverHello.payload]);
  const serverMaterial = hkdfExpandOnly(
    session.pskAccess,
    Buffer.concat([
      Buffer.from("handshake key expansion"),
      sha256(responseTranscript),
    ]),
    28,
  );
  const key = serverMaterial.subarray(0, 16);
  const nonce = serverMaterial.subarray(16, 28);

  const decryptNext = (expectedType, sequence, label) => {
    const record = parseRecord(response, offset);
    offset = record.end;
    if (record.type !== expectedType) {
      throw new Error(
        `${label} used unexpected record type 0x${record.type.toString(16)}`,
      );
    }
    return decryptRecordPayload({
      key,
      baseNonce: nonce,
      sequence,
      recordType: record.type,
      ciphertext: record.payload,
    });
  };

  decryptNext(RECORD_HANDSHAKE, 1, "Server finish");
  const data = decryptNext(RECORD_DATA, 2, "Server data");
  decryptNext(RECORD_ABORT, 3, "Server abort");
  if (offset !== response.length) {
    throw new Error("MMTLS response has trailing records");
  }
  return data;
}

function postMmtls({ host, payload, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host,
        port: 80,
        method: "POST",
        path: `/mmtls/${randomBytes(4).toString("hex")}`,
        headers: {
          Accept: "*/*",
          "Cache-Control": "no-cache",
          Connection: "Keep-Alive",
          "Content-Type": "application/octet-stream",
          "Content-Length": payload.length,
          Upgrade: "mmtls",
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
                `WeChat short link returned HTTP ${response.statusCode}`,
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
        new Error(`WeChat short link timed out after ${timeoutMs} ms`),
      );
    });
    request.once("error", reject);
    request.end(payload);
  });
}

export async function requestShortMmtls({
  session,
  host = "extshort.weixin.qq.com",
  path,
  body,
  timeoutMs = 15_000,
  trustedServerRedirect = false,
}) {
  const isWeChatHostname =
    /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.weixin\.qq\.com$/i.test(host);
  if (
    !ALLOWED_SHORT_HOSTS.has(host) &&
    !(trustedServerRedirect && (isWeChatHostname || isIP(host)))
  ) {
    throw new Error(
      `The experiment only permits known WeChat short-link hosts (received ${JSON.stringify(host)})`,
    );
  }
  const { payload, transcript } = buildShortMmtlsPayload({
    session,
    host,
    path,
    body,
  });
  const response = await postMmtls({ host, payload, timeoutMs });
  return decryptShortMmtlsResponse({ session, transcript, response });
}
