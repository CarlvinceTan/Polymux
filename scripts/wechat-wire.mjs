import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROFILE_SHA256 =
  "4e85aba6fb2a99f7d0d28b3248de8f06feb9f38aeea49a5edc3e776e5a82a04f";
const WECHAT_DYLIB = "/Applications/WeChat.app/Contents/Resources/wechat.dylib";
const READY_TIMEOUT_MS = 30_000;
const STATUS_TIMEOUT_MS = Number(
  process.env.POLYMUX_WECHAT_STATUS_TIMEOUT_MS || 45_000,
);
// Mars command IDs are part of the exact-build wire contract. These are the
// native task IDs used by WeChat 4.1.11 build 269136, not the older CGI reqids
// or Chatter's legacy placeholder value (110).
export const NATIVE_TASK_ROUTES = Object.freeze({
  newSendMessage: Object.freeze({
    cgi: "/cgi-bin/micromsg-bin/newsendmsg",
    commandId: 522,
  }),
  uploadAppAttach: Object.freeze({
    cgi: "/cgi-bin/micromsg-bin/uploadappattach",
    commandId: 220,
  }),
  sendAppMessage: Object.freeze({
    cgi: "/cgi-bin/micromsg-bin/sendappmsg",
    commandId: 222,
  }),
  uploadVoice: Object.freeze({
    cgi: "/cgi-bin/micromsg-bin/uploadvoice",
    commandId: 127,
  }),
  uploadVideo: Object.freeze({
    cgi: "/cgi-bin/micromsg-bin/uploadvideo",
    commandId: 149,
  }),
  sendEmoji: Object.freeze({
    cgi: "/cgi-bin/micromsg-bin/sendemoji",
    commandId: 175,
  }),
  revokeMessage: Object.freeze({
    cgi: "/cgi-bin/micromsg-bin/revokemsg",
    commandId: 594,
  }),
});
const NATIVE_NEW_SEND_MESSAGE = NATIVE_TASK_ROUTES.newSendMessage;
const NATIVE_UPLOAD_APP_ATTACH = NATIVE_TASK_ROUTES.uploadAppAttach;
const NATIVE_SEND_APP_MESSAGE = NATIVE_TASK_ROUTES.sendAppMessage;
const NATIVE_UPLOAD_VOICE = NATIVE_TASK_ROUTES.uploadVoice;
const NATIVE_UPLOAD_VIDEO = NATIVE_TASK_ROUTES.uploadVideo;
const NATIVE_SEND_EMOJI = NATIVE_TASK_ROUTES.sendEmoji;
const NATIVE_REVOKE_MESSAGE = NATIVE_TASK_ROUTES.revokeMessage;
const FILE_UPLOAD_CHUNK_BYTES = 50_000;
const MEDIA_UPLOAD_CHUNK_BYTES = 65_000;
let nativeInterruption;
const nativeInterruptionListeners = new Set();

/** Interrupt an in-flight native debugger wait without skipping its finally
 * block. The caller can then detach LLDB and remove its temporary arm files. */
export function interruptNativeOperations(reason = "native WeChat operation interrupted") {
  nativeInterruption ??= reason instanceof Error ? reason : new Error(String(reason));
  for (const reject of nativeInterruptionListeners) reject(nativeInterruption);
  nativeInterruptionListeners.clear();
}

async function interruptionAware(operation) {
  if (nativeInterruption) throw nativeInterruption;
  let rejectInterruption;
  const interrupted = new Promise((_, reject) => {
    rejectInterruption = reject;
    nativeInterruptionListeners.add(reject);
  });
  try {
    return await Promise.race([operation, interrupted]);
  } finally {
    nativeInterruptionListeners.delete(rejectInterruption);
  }
}

function xml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function buildReplyXml({
  body,
  chatId,
  createTime,
  displayName,
  fromWxid,
  messageId,
  quotedBody,
  quotedMessageSource = "",
  quotedType = 1,
}) {
  const source = quotedMessageSource
    ? `\n\t\t\t<msgsource>${xml(quotedMessageSource)}</msgsource>`
    : "";
  return `<?xml version="1.0"?>
<msg>
\t<appmsg appid="" sdkver="0">
\t\t<title>${xml(body)}</title>
\t\t<type>57</type>
\t\t<appattach>
\t\t\t<cdnthumbaeskey />
\t\t\t<aeskey />
\t\t</appattach>
\t\t<refermsg>
\t\t\t<type>${Number(quotedType) || 1}</type>
\t\t\t<svrid>${xml(messageId)}</svrid>
\t\t\t<fromusr>${xml(chatId)}</fromusr>
\t\t\t<chatusr />
\t\t\t<displayname>${xml(displayName)}</displayname>
\t\t\t<content>${xml(quotedBody)}</content>${source}
\t\t\t<createtime>${Number(createTime) || 0}</createtime>
\t\t</refermsg>
\t</appmsg>
\t<fromusername>${xml(fromWxid)}</fromusername>
\t<scene>0</scene>
\t<appinfo>
\t\t<version>1</version>
\t\t<appname />
\t</appinfo>
\t<commenturl />
</msg>`;
}

export function extractEmojiElement(value) {
  if (typeof value !== "string") return undefined;
  return (
    value.match(/<emoji\b[\s\S]*?<\/emoji>/i)?.[0] ??
    value.match(/<emoji\b[^>]*\/>/i)?.[0]
  );
}

export function stickerMd5(value) {
  const element = extractEmojiElement(value);
  const match = element?.match(/\bmd5\s*=\s*["']([a-f0-9]{32})["']/i);
  return match?.[1]?.toLowerCase();
}

export function buildStickerXml(emojiElement, { chatId, fromWxid }) {
  const element = extractEmojiElement(emojiElement);
  if (!element || !stickerMd5(element))
    throw new Error("WeChat sticker reference is invalid");
  const replace = (name, value, source) => {
    const attribute = new RegExp(`\\b${name}\\s*=\\s*["'][^"']*["']`, "i");
    return attribute.test(source)
      ? source.replace(attribute, `${name}="${xml(value)}"`)
      : source.replace(/<emoji\b/i, `<emoji ${name}="${xml(value)}"`);
  };
  const routed = replace(
    "tousername",
    chatId,
    replace("fromusername", fromWxid, element),
  );
  return `<msg>${routed}<gameext type="0" content="0"></gameext></msg>`;
}

function protobufVarint(value) {
  let remaining = BigInt(value);
  if (remaining < 0n) throw new Error("protobuf varint must be non-negative");
  const output = [];
  do {
    const byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    output.push(byte | (remaining === 0n ? 0 : 0x80));
  } while (remaining !== 0n);
  return Buffer.from(output);
}

function protobufBytes(fieldNumber, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return Buffer.concat([
    protobufVarint(BigInt(fieldNumber) * 8n + 2n),
    protobufVarint(bytes.length),
    bytes,
  ]);
}

function protobufInteger(fieldNumber, value) {
  return Buffer.concat([
    protobufVarint(BigInt(fieldNumber) * 8n),
    protobufVarint(value),
  ]);
}

const nativeClientIdentity = {
  clientProof: Buffer.from(`m64${randomBytes(7).toString("hex").slice(0, 13)}`),
  deviceId: 0xffffffff00000000n | BigInt(randomBytes(4).readUInt32LE()),
  sessionId: 100_000_000 + (randomBytes(4).readUInt32LE() % 4_000_000_000),
};

export function buildNativeBaseRequest({
  clientProof = nativeClientIdentity.clientProof,
  deviceId = nativeClientIdentity.deviceId,
  platform = "UnifiedPCMac 26 arm64",
  sessionId = nativeClientIdentity.sessionId,
  taskId,
}) {
  if (!Number.isInteger(taskId) || taskId <= 0 || taskId > 0xffffffff)
    throw new Error("native WeChat task id is invalid");
  const proof = Buffer.isBuffer(clientProof)
    ? clientProof
    : Buffer.from(clientProof);
  if (!proof.length || proof.length > 64)
    throw new Error("native WeChat client proof is invalid");
  return Buffer.concat([
    protobufBytes(1, Buffer.from([0])),
    protobufInteger(2, sessionId),
    protobufBytes(3, proof),
    protobufInteger(4, deviceId),
    protobufBytes(5, Buffer.from(platform, "utf8")),
    protobufInteger(6, taskId),
  ]);
}

function nativeTaskId() {
  return (randomBytes(4).readUInt32LE() & 0x0fffffff) | 0x20000000;
}

function readProtobufVarint(buffer, start) {
  let offset = start;
  let value = 0n;
  let shift = 0n;
  while (offset < buffer.length && offset - start < 10) {
    const byte = buffer[offset++];
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { offset, value };
    shift += 7n;
  }
  throw new Error("native WeChat protobuf varint is invalid");
}

function decodeProtobufFields(buffer) {
  const fields = [];
  let offset = 0;
  while (offset < buffer.length) {
    const tag = readProtobufVarint(buffer, offset);
    offset = tag.offset;
    const number = Number(tag.value >> 3n);
    const wire = Number(tag.value & 7n);
    if (number <= 0) throw new Error("native WeChat protobuf field is invalid");
    if (wire === 0) {
      const value = readProtobufVarint(buffer, offset);
      offset = value.offset;
      fields.push({ number, value: value.value, wire });
      continue;
    }
    if (wire !== 2)
      throw new Error(`unsupported native WeChat protobuf wire type ${wire}`);
    const length = readProtobufVarint(buffer, offset);
    offset = length.offset;
    const end = offset + Number(length.value);
    if (end > buffer.length)
      throw new Error("native WeChat protobuf field is truncated");
    fields.push({ number, value: buffer.subarray(offset, end), wire });
    offset = end;
  }
  return fields;
}

function protobufField(fields, number, wire) {
  return fields.find((field) => field.number === number && field.wire === wire)
    ?.value;
}

function assertNativeBaseResponse(response, baseFieldNumber = 1) {
  const fields = decodeProtobufFields(response);
  const base = protobufField(fields, baseFieldNumber, 2);
  if (!Buffer.isBuffer(base))
    throw new Error("native WeChat response omitted BaseResponse");
  const ret = protobufField(decodeProtobufFields(base), 1, 0);
  if (ret === undefined)
    throw new Error("native WeChat response omitted its result code");
  const signed = Number(BigInt.asIntN(32, ret));
  if (signed !== 0)
    throw new Error(`native WeChat request failed with result ${signed}`);
  return fields;
}

function nativeResponseMessageId(fields, fieldNumber) {
  const value = protobufField(fields, fieldNumber, 0);
  return value === undefined || value === 0n ? undefined : value.toString();
}

function requiredNativeMessageId(fields, fieldNumber, operation) {
  const messageId = nativeResponseMessageId(fields, fieldNumber);
  if (!messageId)
    throw new Error(`native WeChat ${operation} response omitted its message id`);
  return messageId;
}

export function parseNativeNewSendMessageResponse(response) {
  const fields = assertNativeBaseResponse(response);
  const results = fields.filter(
    (field) => field.number === 3 && field.wire === 2,
  );
  if (results.length === 0)
    throw new Error("native WeChat message response omitted its result");
  let messageId;
  for (const result of results) {
    const resultFields = decodeProtobufFields(result.value);
    const code = protobufField(resultFields, 1, 0);
    if (code === undefined)
      throw new Error("native WeChat message response omitted its result code");
    const signed = Number(BigInt.asIntN(32, code));
    if (signed !== 0)
      throw new Error(`native WeChat message failed with result ${signed}`);
    messageId =
      nativeResponseMessageId(resultFields, 8) ?? messageId;
  }
  if (!messageId)
    throw new Error("native WeChat message response omitted its message id");
  return messageId;
}

export function parseNativeSendAppMessageResponse(response) {
  const fields = assertNativeBaseResponse(response);
  return requiredNativeMessageId(fields, 9, "file");
}

export function parseNativeVideoResponse(response) {
  const fields = assertNativeBaseResponse(response);
  return requiredNativeMessageId(fields, 6, "video");
}

function skBuiltinBuffer(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new Error("native WeChat media must be bytes");
  return Buffer.concat([
    protobufInteger(1, bytes.length),
    protobufBytes(2, bytes),
  ]);
}

export function buildNativeUploadAppAttachRequest({
  chunk,
  clientAppDataId,
  fileMd5,
  recipient,
  startPosition,
  taskId,
  totalLength,
}) {
  if (!Buffer.isBuffer(chunk) || chunk.length === 0)
    throw new Error("native WeChat file chunk is empty");
  if (!Number.isInteger(totalLength) || totalLength <= 0)
    throw new Error("native WeChat file length is invalid");
  if (!Number.isInteger(startPosition) || startPosition < 0)
    throw new Error("native WeChat file position is invalid");
  const data = Buffer.concat([
    protobufInteger(1, chunk.length),
    protobufBytes(2, chunk),
  ]);
  return Buffer.concat([
    protobufBytes(1, buildNativeBaseRequest({ taskId })),
    protobufBytes(2, Buffer.alloc(0)),
    protobufInteger(3, 0),
    protobufBytes(4, Buffer.from(clientAppDataId, "utf8")),
    protobufBytes(5, Buffer.from(recipient, "utf8")),
    protobufInteger(6, totalLength),
    protobufInteger(7, startPosition),
    protobufInteger(8, chunk.length),
    protobufBytes(9, data),
    protobufInteger(10, 6),
    protobufBytes(11, Buffer.from(fileMd5, "utf8")),
  ]);
}

export function parseNativeUploadAppAttachResponse(response) {
  const fields = assertNativeBaseResponse(response);
  const mediaId = protobufField(fields, 3, 2);
  if (!Buffer.isBuffer(mediaId) || mediaId.length === 0)
    throw new Error("native WeChat upload omitted its attachment id");
  return mediaId.toString("utf8");
}

export function buildNativeFileMessageRequest({
  attachmentId,
  clientMessageId,
  extension,
  fileName,
  fileSize,
  fromWxid,
  recipient,
  taskId,
  timestamp = Math.floor(Date.now() / 1000),
}) {
  const content = `<?xml version="1.0"?>
<appmsg appid="" sdkver=""><title>${xml(fileName)}</title><des></des><action></action><type>6</type><content></content><url></url><lowurl></lowurl><appattach><totallen>${fileSize}</totallen><attachid>${xml(attachmentId)}</attachid><fileext>${xml(extension)}</fileext></appattach><extinfo></extinfo></appmsg>`;
  const body = Buffer.concat([
    protobufBytes(1, Buffer.from(fromWxid, "utf8")),
    protobufBytes(2, Buffer.alloc(0)),
    protobufInteger(3, 0),
    protobufBytes(4, Buffer.from(recipient, "utf8")),
    protobufInteger(5, 6),
    protobufBytes(6, Buffer.from(content, "utf8")),
    protobufInteger(7, timestamp),
    protobufBytes(8, Buffer.from(clientMessageId, "utf8")),
    protobufBytes(
      12,
      Buffer.from(
        "<msgsource><alnode><fr>1</fr><cf>2</cf></alnode></msgsource>",
        "utf8",
      ),
    ),
    protobufBytes(13, Buffer.alloc(0)),
    protobufBytes(14, Buffer.alloc(0)),
    protobufBytes(15, Buffer.alloc(0)),
  ]);
  return Buffer.concat([
    protobufBytes(1, buildNativeBaseRequest({ taskId })),
    protobufBytes(2, body),
  ]);
}

export async function sendNativeFile({
  bytes,
  fileName,
  fromWxid,
  recipient,
}) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0)
    throw new Error("native WeChat file is empty");
  const fileMd5 = createHash("md5").update(bytes).digest("hex");
  const timestamp = Math.floor(Date.now() / 1000);
  const clientAppDataId = `${recipient}_${timestamp}_UploadFile`;
  let attachmentId;
  for (let startPosition = 0; startPosition < bytes.length; ) {
    const chunk = bytes.subarray(
      startPosition,
      Math.min(bytes.length, startPosition + FILE_UPLOAD_CHUNK_BYTES),
    );
    const taskId = nativeTaskId();
    const upload = await sendNativeTask({
      ...NATIVE_UPLOAD_APP_ATTACH,
      recipient,
      taskId,
      userId: fromWxid,
      request: buildNativeUploadAppAttachRequest({
        chunk,
        clientAppDataId,
        fileMd5,
        recipient,
        startPosition,
        taskId,
        totalLength: bytes.length,
      }),
    });
    attachmentId = parseNativeUploadAppAttachResponse(upload.response);
    startPosition += chunk.length;
  }
  const taskId = nativeTaskId();
  const extension = path.extname(fileName).replace(/^\./, "");
  const clientMessageId = `${clientAppDataId}_xwechat_1`;
  const sent = await sendNativeTask({
    ...NATIVE_SEND_APP_MESSAGE,
    recipient,
    taskId,
    userId: fromWxid,
    request: buildNativeFileMessageRequest({
      attachmentId,
      clientMessageId,
      extension,
      fileName,
      fileSize: bytes.length,
      fromWxid,
      recipient,
      taskId,
      timestamp,
    }),
  });
  return {
    attachmentId,
    clientMessageId,
    fileMd5,
    messageId: parseNativeSendAppMessageResponse(sent.response),
  };
}

export function buildNativeVoiceRequest({
  chunk,
  clientMessageId,
  durationMs,
  fromWxid,
  offset,
  recipient,
  taskId,
  timestamp = Math.floor(Date.now() / 1000),
  totalLength,
}) {
  if (!Buffer.isBuffer(chunk) || chunk.length === 0)
    throw new Error("native WeChat voice chunk is empty");
  if (!Number.isInteger(offset) || offset < 0)
    throw new Error("native WeChat voice offset is invalid");
  if (!Number.isInteger(totalLength) || totalLength <= 0)
    throw new Error("native WeChat voice length is invalid");
  if (!Number.isInteger(durationMs) || durationMs <= 0)
    throw new Error("native WeChat voice duration is invalid");
  return Buffer.concat([
    protobufBytes(1, Buffer.from(fromWxid, "utf8")),
    protobufBytes(2, Buffer.from(recipient, "utf8")),
    protobufInteger(3, offset),
    protobufInteger(4, totalLength),
    protobufBytes(5, Buffer.from(clientMessageId, "utf8")),
    protobufInteger(6, 0),
    protobufInteger(7, durationMs),
    protobufBytes(8, skBuiltinBuffer(chunk)),
    protobufInteger(9, 1),
    protobufBytes(10, buildNativeBaseRequest({ taskId })),
    protobufInteger(11, 0),
    protobufBytes(12, Buffer.alloc(0)),
    protobufInteger(13, 4),
    protobufInteger(14, timestamp),
    protobufInteger(15, 0),
    protobufInteger(16, 0),
    protobufInteger(17, timestamp),
    protobufInteger(19, 0),
  ]);
}

export async function sendNativeVoice({
  bytes,
  durationMs,
  fromWxid,
  recipient,
}) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0)
    throw new Error("native WeChat voice is empty");
  const clientMessageId = `${fromWxid}_${Math.floor(Date.now() / 1000)}`;
  let messageId;
  for (let offset = 0; offset < bytes.length; offset += MEDIA_UPLOAD_CHUNK_BYTES) {
    const chunk = bytes.subarray(
      offset,
      Math.min(bytes.length, offset + MEDIA_UPLOAD_CHUNK_BYTES),
    );
    const taskId = nativeTaskId();
    const sent = await sendNativeTask({
      ...NATIVE_UPLOAD_VOICE,
      recipient,
      taskId,
      userId: fromWxid,
      request: buildNativeVoiceRequest({
        chunk,
        clientMessageId,
        durationMs,
        fromWxid,
        offset,
        recipient,
        taskId,
        totalLength: bytes.length,
      }),
    });
    const fields = assertNativeBaseResponse(sent.response, 10);
    messageId = nativeResponseMessageId(fields, 12) ?? messageId;
  }
  return { clientMessageId, messageId };
}

export async function sendNativeVideo({
  bytes,
  durationSeconds,
  fromWxid,
  recipient,
  thumbnail,
}) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0)
    throw new Error("native WeChat video is empty");
  if (!Buffer.isBuffer(thumbnail) || thumbnail.length === 0)
    throw new Error("native WeChat video thumbnail is empty");
  const videoMd5 = createHash("md5").update(bytes).digest("hex");
  const upload = await uploadNativeVideoCdn({ bytes, recipient, videoMd5 });
  const timestamp = Math.floor(Date.now() / 1000);
  const clientMessageId = `${recipient}_${timestamp}_160_xwechat_1`;
  const taskId = nativeTaskId();
  const sent = await sendNativeTask({
    ...NATIVE_UPLOAD_VIDEO,
    recipient,
    taskId,
    userId: fromWxid,
    request: buildNativeCdnVideoRequest({
      aesKey: upload.aesKey,
      cdnKey: upload.cdnKey,
      clientMessageId,
      durationSeconds,
      fromWxid,
      md5Key: upload.md5Key,
      recipient,
      taskId,
      videoId: upload.videoId,
      videoSize: bytes.length,
    }),
  });
  return {
    ...upload,
    clientMessageId,
    messageId: parseNativeVideoResponse(sent.response),
    videoMd5,
  };
}

export function buildNativeCdnVideoRequest({
  aesKey,
  cdnKey,
  clientMessageId,
  durationSeconds,
  fromWxid,
  md5Key,
  recipient,
  taskId,
  videoId,
  videoSize,
}) {
  for (const [name, value] of Object.entries({
    aesKey,
    cdnKey,
    clientMessageId,
    fromWxid,
    md5Key,
    recipient,
    videoId,
  })) {
    if (typeof value !== "string" || !value)
      throw new Error(`native WeChat video ${name} is empty`);
  }
  if (!Number.isInteger(durationSeconds) || durationSeconds <= 0)
    throw new Error("native WeChat video duration is invalid");
  if (!Number.isInteger(videoSize) || videoSize <= 0)
    throw new Error("native WeChat video length is invalid");
  const emptyExtra = Buffer.concat([
    protobufInteger(1, 0),
    protobufBytes(2, Buffer.alloc(0)),
  ]);
  const source = Buffer.from(
    "<msgsource><alnode><fr>1</fr><cf>3</cf></alnode></msgsource>",
    "utf8",
  );
  return Buffer.concat([
    protobufBytes(1, buildNativeBaseRequest({ taskId })),
    protobufBytes(2, Buffer.from(clientMessageId, "utf8")),
    protobufBytes(3, Buffer.from(fromWxid, "utf8")),
    protobufBytes(4, Buffer.from(recipient, "utf8")),
    protobufInteger(5, 14_764),
    protobufInteger(6, 14_764),
    protobufBytes(7, emptyExtra),
    protobufInteger(8, videoSize),
    protobufInteger(9, videoSize),
    protobufBytes(10, emptyExtra),
    protobufInteger(11, durationSeconds),
    protobufInteger(12, 1),
    protobufInteger(13, 2),
    protobufInteger(14, 0),
    protobufBytes(15, source),
    protobufBytes(16, Buffer.from(cdnKey, "utf8")),
    protobufBytes(17, Buffer.from(aesKey, "utf8")),
    protobufInteger(18, 1),
    protobufBytes(19, Buffer.from(cdnKey, "utf8")),
    protobufInteger(20, 14_764),
    protobufInteger(21, 360),
    protobufInteger(22, 203),
    protobufBytes(23, Buffer.from(aesKey, "utf8")),
    protobufBytes(26, Buffer.from(md5Key, "utf8")),
    protobufBytes(37, Buffer.from(videoId, "utf8")),
    protobufInteger(38, 0),
    protobufBytes(48, Buffer.from(md5Key, "utf8")),
    protobufBytes(49, Buffer.from(cdnKey, "utf8")),
    protobufBytes(50, Buffer.from(aesKey, "utf8")),
    protobufInteger(51, videoSize),
  ]);
}

export function buildNativeSendEmojiRequest({
  animationId,
  recipient,
  taskId,
  timestampMs = Date.now(),
}) {
  if (!/^[a-f0-9]{32}$/i.test(animationId))
    throw new Error("native WeChat sticker id is invalid");
  const details = Buffer.concat([
    protobufBytes(1, Buffer.from(animationId.toLowerCase(), "utf8")),
    protobufInteger(2, 0),
    protobufInteger(3, 1 + (randomBytes(2).readUInt16LE() % 9_999)),
    protobufBytes(4, protobufInteger(1, 0)),
    protobufInteger(5, 1),
    protobufBytes(6, Buffer.from(recipient, "utf8")),
    protobufBytes(7, Buffer.from('<gameext type="0" content="0" ></gameext>')),
    protobufBytes(8, Buffer.alloc(0)),
    protobufBytes(9, Buffer.from(String(Math.floor(timestampMs)), "utf8")),
    protobufInteger(11, 0),
  ]);
  return Buffer.concat([
    protobufBytes(1, buildNativeBaseRequest({ taskId })),
    protobufInteger(2, 1),
    protobufBytes(3, details),
    protobufInteger(4, 0),
  ]);
}

export async function sendNativeSticker({ md5, recipient, userId }) {
  const taskId = nativeTaskId();
  const sent = await sendNativeTask({
    ...NATIVE_SEND_EMOJI,
    recipient,
    taskId,
    userId,
    request: buildNativeSendEmojiRequest({
      animationId: md5,
      recipient,
      taskId,
    }),
  });
  const fields = decodeProtobufFields(sent.response);
  const result = protobufField(fields, 3, 2);
  if (!Buffer.isBuffer(result))
    throw new Error("native WeChat sticker response omitted its result");
  const resultFields = decodeProtobufFields(result);
  const code = protobufField(resultFields, 1, 0);
  if (code === undefined || Number(BigInt.asIntN(32, code)) !== 0)
    throw new Error(
      `native WeChat sticker failed with result ${
        code === undefined ? "unknown" : Number(BigInt.asIntN(32, code))
      }`,
    );
  return {
    messageId: requiredNativeMessageId(resultFields, 6, "sticker"),
  };
}

export function buildNativeRevokeRequest({
  clientMessageId,
  fromWxid,
  recipient,
  serverMessageId,
  taskId,
  timestamp = Math.floor(Date.now() / 1000),
}) {
  const serverId = BigInt(serverMessageId);
  if (serverId <= 0n) throw new Error("native WeChat recall id is invalid");
  return Buffer.concat([
    protobufBytes(1, buildNativeBaseRequest({ taskId })),
    protobufBytes(2, Buffer.from(clientMessageId, "utf8")),
    protobufInteger(3, 0),
    protobufInteger(4, timestamp),
    protobufInteger(5, 0),
    protobufBytes(6, Buffer.from(fromWxid, "utf8")),
    protobufBytes(7, Buffer.from(recipient, "utf8")),
    protobufInteger(8, 0),
    protobufInteger(9, serverId),
  ]);
}

export async function recallNativeMessage({
  clientMessageId,
  fromWxid,
  recipient,
  serverMessageId,
}) {
  const taskId = nativeTaskId();
  const sent = await sendNativeTask({
    ...NATIVE_REVOKE_MESSAGE,
    recipient,
    taskId,
    userId: fromWxid,
    request: buildNativeRevokeRequest({
      clientMessageId,
      fromWxid,
      recipient,
      serverMessageId,
      taskId,
    }),
  });
  assertNativeBaseResponse(sent.response);
  return sent;
}

export function buildNativeMessageRequest({
  clientMessageId = randomBytes(4).readUInt32LE() & 0x7fffffff,
  content,
  messageSource = "<msgsource><alnode><fr>1</fr></alnode></msgsource>",
  messageType,
  recipient,
  timestamp = Math.floor(Date.now() / 1000),
}) {
  const recipientBytes = Buffer.from(recipient, "utf8");
  const contentBytes = Buffer.from(content, "utf8");
  if (!recipientBytes.length || !contentBytes.length)
    throw new Error("native WeChat recipient and content are required");
  if (!Number.isInteger(messageType) || messageType <= 0)
    throw new Error("native WeChat message type is invalid");
  const baseString = protobufBytes(1, recipientBytes);
  const entry = Buffer.concat([
    protobufBytes(1, baseString),
    protobufBytes(2, contentBytes),
    protobufInteger(3, messageType),
    protobufInteger(4, timestamp),
    protobufInteger(5, clientMessageId || 1),
    protobufBytes(6, Buffer.from(messageSource, "utf8")),
  ]);
  return Buffer.concat([
    protobufInteger(1, 1),
    protobufBytes(2, entry),
  ]);
}

export async function sha256File(filePath) {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

async function assertProfile() {
  const digest = await sha256File(
    process.env.POLYMUX_WECHAT_DYLIB || WECHAT_DYLIB,
  );
  if (digest !== PROFILE_SHA256)
    throw new Error(
      `native WeChat wire writer is disabled for dylib SHA-256 ${digest}`,
    );
}

async function wechatPid() {
  const result = await new Promise((resolve, reject) => {
    const child = spawn("pgrep", ["-x", "WeChat"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.once("error", reject);
    child.once("close", (code) =>
      resolve({ code, stdout: Buffer.concat(stdout).toString("utf8").trim() }),
    );
  });
  const pids = result.stdout
    .split(/\s+/)
    .filter(Boolean)
    .map(Number)
    .filter((pid) => Number.isInteger(pid) && pid > 0);
  if (result.code !== 0 || pids.length === 0)
    throw new Error("WeChat is not running");
  if (pids.length !== 1)
    throw new Error(
      `native WeChat wire writer found ${pids.length} main processes`,
    );
  return pids[0];
}

function waitForNativeReady(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            output.trim() ||
              "WeChat native task injector did not become ready",
          ),
        ),
      READY_TIMEOUT_MS,
    );
    const onData = (chunk) => {
      output += chunk.toString("utf8");
      if (!output.includes("native task injector ready")) return;
      clearTimeout(timer);
      resolve({ output: () => output.trim() });
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      reject(
        new Error(
          [
            `WeChat native task injector exited before ready (code=${code}, signal=${signal ?? "none"})`,
            output.trim(),
          ]
            .filter(Boolean)
            .join("\n"),
        ),
      );
    });
  });
}

function waitForDebuggerOutput(child, predicate, timeoutMs) {
  return new Promise((resolve) => {
    let output = "";
    const timer = setTimeout(() => finish(false), timeoutMs);
    const onData = (chunk) => {
      output += chunk.toString("utf8");
      if (predicate(output)) finish(true);
    };
    const onClose = () => finish(predicate(output));
    const finish = (matched) => {
      clearTimeout(timer);
      child.stdout.off("data", onData);
      child.stderr.off("data", onData);
      child.off("close", onClose);
      resolve(matched);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("close", onClose);
  });
}

async function stopInjector(child, alreadyDetached = false) {
  if (child.exitCode != null || child.signalCode != null) return;
  child.stdin.on("error", () => undefined);
  if (alreadyDetached) {
    if (child.stdin.writable) child.stdin.write("quit\n");
    await terminateInjectorProcess(child);
    return;
  }
  let stopped = false;
  for (let attempt = 0; attempt < 3 && !stopped; attempt += 1) {
    const prompt = waitForDebuggerOutput(
      child,
      (output) => output.includes("(lldb)"),
      2_000,
    );
    child.kill("SIGINT");
    stopped = await prompt;
    if (child.exitCode != null || child.signalCode != null) return;
  }
  if (child.exitCode != null || child.signalCode != null) return;
  if (!stopped) {
    const detached = waitForDebuggerOutput(
      child,
      (output) => /Process \d+ detached/.test(output),
      5_000,
    );
    if (child.stdin.writable)
      child.stdin.write("polymux-native-cleanup\nprocess detach\nquit\n");
    const confirmed = await detached;
    await terminateInjectorProcess(child);
    if (confirmed) return;
    throw new Error(
      "WeChat debugger was shut down but did not confirm a clean detach",
    );
  }
  const detached = waitForDebuggerOutput(
    child,
    (output) => /Process \d+ detached/.test(output),
    5_000,
  );
  if (child.stdin.writable)
    child.stdin.write("polymux-native-cleanup\nprocess detach\nquit\n");
  const confirmed = await detached;
  await terminateInjectorProcess(child);
  if (!confirmed)
    throw new Error("WeChat debugger did not confirm a clean detach");
}

async function terminateInjectorProcess(child) {
  if (await waitForInjectorClose(child, 2_000)) return;
  child.kill("SIGTERM");
  if (await waitForInjectorClose(child, 2_000)) return;
  child.kill("SIGKILL");
  await waitForInjectorClose(child, 2_000);
}

async function waitForInjectorClose(child, timeoutMs) {
  if (child.exitCode != null || child.signalCode != null) return true;
  return await new Promise((resolve) => {
    const finish = (closed) => {
      clearTimeout(timer);
      child.off("close", onClose);
      resolve(closed);
    };
    const onClose = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once("close", onClose);
  });
}

async function atomicJson(filePath, value) {
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, filePath);
}

async function waitForStatus(filePath, timeoutMs = STATUS_TIMEOUT_MS) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      return JSON.parse(await readFile(filePath, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT" && !(error instanceof SyntaxError))
        throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("WeChat wire injector did not report a rewrite");
}

async function uploadNativeVideoCdn({ bytes, recipient, videoMd5 }) {
  if (process.env.POLYMUX_WECHAT_WIRE_NATIVE !== "1")
    throw new Error(
      "native WeChat wire sending is disabled; set POLYMUX_WECHAT_WIRE_NATIVE=1",
    );
  if (process.env.POLYMUX_WECHAT_LLDB_EXPERIMENTAL !== "1")
    throw new Error(
      "native WeChat LLDB task sending is experimental and disabled",
    );
  await assertProfile();
  const pid = await wechatPid();
  const nonce = `${process.pid}-${randomBytes(8).toString("hex")}`;
  const videoPath = path.join(tmpdir(), `polymux-wechat-video-${nonce}.mp4`);
  const armPath = path.join(tmpdir(), `polymux-wechat-cdn-arm-${nonce}.json`);
  const statusPath = path.join(
    tmpdir(),
    `polymux-wechat-cdn-status-${nonce}.json`,
  );
  const injector = fileURLToPath(
    new URL("./wechat_native_cdn_upload_lldb.py", import.meta.url),
  );
  const executable = process.env.POLYMUX_WECHAT_LLDB || "/usr/bin/lldb";
  const importCommand = `command script import "${injector.replaceAll('"', '\\"')}"`;
  const fileId = `${recipient}_${Math.floor(Date.now() / 1000)}_${
    1 + (randomBytes(2).readUInt16LE() % 999)
  }_1`;
  await writeFile(videoPath, bytes, { mode: 0o600 });
  await atomicJson(armPath, {
    aesKey: randomBytes(16).toString("hex"),
    expiryNs: String(BigInt(Date.now() + 60_000) * 1_000_000n),
    fileId,
    recipient,
    videoMd5,
    videoPath,
  });
  const child = spawn(
    executable,
    [
      "-p",
      String(pid),
      "-o",
      importCommand,
      "-o",
      "polymux-native-cdn-video",
      "-o",
      "process continue",
    ],
    {
      env: {
        ...process.env,
        POLYMUX_WECHAT_CDN_ARM: armPath,
        POLYMUX_WECHAT_CDN_STATUS: statusPath,
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let operationError;
  let status;
  try {
    const ready = await interruptionAware(waitForDebuggerOutput(
      child,
      (output) => output.includes("native CDN video upload ready"),
      READY_TIMEOUT_MS,
    ));
    if (!ready)
      throw new Error("WeChat native CDN video uploader did not become ready");
    status = await interruptionAware(waitForStatus(statusPath, 180_000));
    if (status?.ok !== true)
      throw new Error(status?.reason || "WeChat native CDN video upload failed");
    for (const name of ["cdnKey", "aesKey", "md5Key", "videoId"])
      if (typeof status[name] !== "string" || !status[name])
        throw new Error(`WeChat native CDN video omitted ${name}`);
    if (status.md5Key.toLowerCase() !== videoMd5.toLowerCase())
      throw new Error("WeChat native CDN video returned a different md5");
    return {
      aesKey: status.aesKey,
      cdnKey: status.cdnKey,
      fileId: status.fileId,
      md5Key: status.md5Key,
      videoId: status.videoId,
    };
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      await stopInjector(child, status?.detached === true);
    } catch (detachError) {
      if (!operationError) throw detachError;
    }
    await Promise.all([
      rm(armPath, { force: true }),
      rm(statusPath, { force: true }),
      rm(videoPath, { force: true }),
    ]);
  }
}

export function hasExactTextHistory(output, expected) {
  try {
    const parsed = JSON.parse(output);
    return Array.isArray(parsed?.rows) && parsed.rows.some(
      (row) =>
        row?.message_kind === "text" &&
        (row?.message_content === expected || row?.display_text === expected),
    );
  } catch {
    return false;
  }
}

export function hasTextHistoryFragment(output, fragment) {
  try {
    const parsed = JSON.parse(output);
    return Array.isArray(parsed?.rows) && parsed.rows.some(
      (row) =>
        row?.message_kind === "text" &&
        [row?.message_content, row?.display_text].some(
          (value) => typeof value === "string" && value.includes(fragment),
        ),
    );
  } catch {
    return false;
  }
}

export function hasTypedMessageHistory(output, { content, messageType }) {
  try {
    const parsed = JSON.parse(output);
    if (!Array.isArray(parsed?.rows)) return false;
    if (messageType === 1)
      return parsed.rows.some(
        (row) =>
          row?.message_kind === "text" &&
          (row?.message_content === content || row?.display_text === content),
      );
    const expectedKinds = new Map([
      [34, "audio"],
      [43, "video"],
      [47, "emoticon"],
    ]);
    const expectedKind = expectedKinds.get(messageType);
    if (!expectedKind) return false;
    const md5 = messageType === 47 ? stickerMd5(content) : undefined;
    return parsed.rows.some(
      (row) =>
        row?.message_kind === expectedKind &&
        (!md5 || String(row?.message_content || "").includes(md5)),
    );
  } catch {
    return false;
  }
}

export async function sendNativeTask({
  cgi,
  commandId,
  recipient,
  request,
  taskId = (randomBytes(4).readUInt32LE() & 0x0fffffff) | 0x20000000,
  userId,
}) {
  if (process.env.POLYMUX_WECHAT_WIRE_NATIVE !== "1")
    throw new Error(
      "native WeChat wire sending is disabled; set POLYMUX_WECHAT_WIRE_NATIVE=1",
    );
  if (process.env.POLYMUX_WECHAT_LLDB_EXPERIMENTAL !== "1")
    throw new Error(
      "native WeChat LLDB task sending is experimental and disabled; set POLYMUX_WECHAT_LLDB_EXPERIMENTAL=1 only for an isolated debugger probe",
    );
  if (
    process.env.POLYMUX_WECHAT_TEST_ONLY_FILEHELPER === "1" &&
    recipient !== "filehelper"
  )
    throw new Error("live WeChat testing is restricted to filehelper");
  await assertProfile();
  if (typeof cgi !== "string" || !cgi.startsWith("/cgi-bin/"))
    throw new Error("native WeChat task CGI is invalid");
  if (!Number.isInteger(commandId) || commandId <= 0 || commandId > 0xffffffff)
    throw new Error("native WeChat task command id is invalid");
  if (!Buffer.isBuffer(request) || request.length === 0)
    throw new Error("native WeChat task request is empty");
  if (
    typeof userId !== "string" ||
    !userId.trim() ||
    Buffer.byteLength(userId, "utf8") > 255 ||
    userId.includes("\0")
  )
    throw new Error("native WeChat task account id is invalid");

  const nonce = `${process.pid}-${randomBytes(8).toString("hex")}`;
  const armPath = path.join(tmpdir(), `polymux-wechat-wire-arm-${nonce}.json`);
  const statusPath = path.join(
    tmpdir(),
    `polymux-wechat-wire-status-${nonce}.json`,
  );
  const tracePath = `${statusPath}.trace`;
  const nativeInjector = fileURLToPath(
    new URL("./wechat_native_task_lldb.py", import.meta.url),
  );
  const executable = process.env.POLYMUX_WECHAT_LLDB || "/usr/bin/lldb";
  const importCommand = `command script import "${nativeInjector.replaceAll('"', '\\"')}"`;
  const args = [
    "-p",
    String(await wechatPid()),
    "-o",
    importCommand,
    "-o",
    "polymux-native-send",
    "-o",
    "process continue",
  ];
  await atomicJson(armPath, {
    cgi,
    commandId,
    expiryNs: String(BigInt(Date.now() + 60_000) * 1_000_000n),
    recipient,
    requestBase64: request.toString("base64"),
    taskId,
    userId: userId.trim(),
  });
  const child = spawn(
    executable,
    args,
    {
      env: {
        ...process.env,
        POLYMUX_WECHAT_WIRE_ARM: armPath,
        POLYMUX_WECHAT_WIRE_STATUS: statusPath,
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let operationError;
  let nativeStatus;
  try {
    const nativeSession = await interruptionAware(waitForNativeReady(child));
    let status;
    try {
      status = await interruptionAware(waitForStatus(statusPath));
    } catch (error) {
      let trace = "";
      try {
        trace = (await readFile(tracePath, "utf8")).trim();
      } catch (traceError) {
        if (traceError?.code !== "ENOENT") throw traceError;
      }
      throw new Error(
        [error.message, nativeSession.output(), trace]
          .filter(Boolean)
          .join("\n"),
        { cause: error },
      );
    }
    nativeStatus = status;
    if (status?.ok !== true)
      throw new Error(status?.reason || "WeChat native task send failed");
    const response = Buffer.from(status.responseBase64 || "", "base64");
    return {
      ...status,
      response,
      responseBase64: undefined,
    };
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      await stopInjector(child, nativeStatus?.detached === true);
    } catch (detachError) {
      if (!operationError) throw detachError;
    }
    await Promise.all([
      rm(armPath, { force: true }),
      rm(statusPath, { force: true }),
      rm(tracePath, { force: true }),
    ]);
  }
}

export async function sendTypedMessage({ content, messageType, recipient, userId }) {
  const clientMessageId = randomBytes(4).readUInt32LE() & 0x7fffffff;
  const sent = await sendNativeTask({
    ...NATIVE_NEW_SEND_MESSAGE,
    recipient,
    userId,
    request: buildNativeMessageRequest({
      clientMessageId,
      content,
      messageType,
      recipient,
    }),
  });
  return {
    ...sent,
    clientMessageId: String(clientMessageId),
    messageId: parseNativeNewSendMessageResponse(sent.response),
  };
}

export const WECHAT_NATIVE_PROFILE_SHA256 = PROFILE_SHA256;
