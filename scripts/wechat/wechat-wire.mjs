import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { access, copyFile, chmod, lstat, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const runProcess = promisify(execFile);

const PROFILE_SHA256 =
  "4e85aba6fb2a99f7d0d28b3248de8f06feb9f38aeea49a5edc3e776e5a82a04f";
// Exact dylib digests with a native profile. Each build's private offsets are
// selected by image UUID inside wechat_native_task_lldb.py; this gate only
// decides whether the bundled native layer may run at all.
const SUPPORTED_PROFILE_SHA256S = new Set([
  PROFILE_SHA256,
  "6e82322680d7747020c305f67e932b235fe68b22578c24d9c524dabb31a4694a",
]);
// The Mars task hijack drives per-build instruction offsets that are only
// derived and verified for 4.1.11 build 269136. Keep this gate separate from
// the model sender's list: accepting a build here that has no wire offsets
// would call that build's addresses with another build's constants.
const WIRE_TASK_PROFILE_SHA256S = new Set([PROFILE_SHA256]);
const WECHAT_DYLIB = "/Applications/WeChat.app/Contents/Resources/wechat.dylib";
const WECHAT_EXECUTABLE = "/Applications/WeChat.app/Contents/MacOS/WeChat";
const WECHAT_BUNDLE_IDENTIFIER = "com.tencent.xinWeChat";
let weChatTemporaryDirectoryCache;
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

/** The target's own temporary directory is the only one it can always read. */
export function weChatTemporaryDirectoryFor({sandboxed, home, fallback}) {
  return sandboxed
    ? path.join(home, "Library", "Containers", WECHAT_BUNDLE_IDENTIFIER, "Data", "tmp")
    : fallback;
}

/** A sandboxed WeChat may only read its own container, and every file this
 * module shares with the target process lives in that process's temporary
 * directory. The signing entitlements decide which one that is, because an
 * unsandboxed target uses the ordinary per-user temporary directory. */
async function weChatTemporaryDirectory() {
  if (weChatTemporaryDirectoryCache) return weChatTemporaryDirectoryCache;
  const sandboxed = await runProcess("/usr/bin/codesign", [
    "-d", "--entitlements", ":-",
    process.env.POLYMUX_WECHAT_EXECUTABLE || WECHAT_EXECUTABLE,
  ], {timeout: 5_000})
    .then(({stdout}) => /<key>com\.apple\.security\.app-sandbox<\/key>\s*<true\s*\/>/.test(stdout))
    .catch(() => false);
  weChatTemporaryDirectoryCache = weChatTemporaryDirectoryFor({
    sandboxed, home: homedir(), fallback: tmpdir(),
  });
  await mkdir(weChatTemporaryDirectoryCache, {recursive: true});
  return weChatTemporaryDirectoryCache;
}

/** The debugger loads this library inside WeChat. A sandboxed target cannot read
 * the repository or the packaged application, so publish the current revision
 * into its container first. The revision is part of the file name, which keeps
 * dlopen from reusing an older image retained by a running WeChat. */
async function weChatPrimerLibrary() {
  const source = await nativePrimeLibrary();
  const directory = await weChatTemporaryDirectory();
  if (path.dirname(source) === directory) return source;
  const staged = path.join(directory, path.basename(source));
  await copyFile(source, staged);
  await chmod(staged, 0o755);
  return staged;
}

/** WeChat reads the attachment itself, so a sandboxed target needs the bytes in
 * its own container. The extension is preserved because WeChat classifies the
 * pending message from it. */
async function stageModelAttachment(filePath) {
  const directory = await weChatTemporaryDirectory();
  if (path.dirname(filePath) === directory) return {path: filePath, staged: null};
  // Keep the caller's file name: the recipient sees it in the delivered message.
  const name = path.basename(filePath);
  if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\0"))
    throw new Error("WeChat model attachment name is invalid");
  const staged = path.join(
    directory, `polymux-wechat-attachment-${randomBytes(8).toString("hex")}`,
  );
  await mkdir(staged, {recursive: true, mode: 0o700});
  const stagedFile = path.join(staged, name);
  await copyFile(filePath, stagedFile);
  await chmod(stagedFile, 0o600);
  return {path: stagedFile, staged};
}

async function nativePrimeLibrary() {
  const directories = [new URL("../../resources/native/bin/", import.meta.url), new URL("../native/bin/", import.meta.url)];
  for (const directory of directories) {
    try {
      const version = (await readFile(new URL("VERSION", directory), "utf8")).trim();
      if (!/^[a-f0-9]{64}$/.test(version)) continue;
      const candidate = fileURLToPath(new URL(`libpolymux-wechat-prime-${version}.dylib`, directory));
      await access(candidate);
      return candidate;
    } catch { /* Try the packaged location next. */ }
  }
  throw new Error("the bundled WeChat primer library is unavailable");
}

async function waitForGuardStatus(statusPath, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      return JSON.parse(await readFile(statusPath, "utf8"));
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error("WeChat native window guard did not arm in time");
}

export function nativeWindowGuardReady(value, nowSeconds = Date.now() / 1_000) {
  const ready = /^1\n(\d+(?:\.\d+)?)\n(\d+(?:\.\d+)?)\n$/.exec(value);
  const armedAt = Number(ready?.[1]);
  const expiresAt = Number(ready?.[2]);
  return Number.isFinite(armedAt) && Number.isFinite(expiresAt) &&
    armedAt <= nowSeconds + 1 && expiresAt > nowSeconds;
}

export async function prepareNativeWeChatWindowGuard({pid, durationMs = 15_000} = {}) {
  const targetPid = Number(pid);
  if (!Number.isInteger(targetPid) || targetPid <= 1)
    throw new Error("the WeChat window guard process is invalid");
  if (!Number.isInteger(durationMs) || durationMs < 1_000 || durationMs > 120_000)
    throw new Error("the WeChat window guard duration is invalid");
  const readyPath = path.join(
    await weChatTemporaryDirectory(),
    `polymux-wechat-window-guard-${targetPid}.ready`,
  );
  const [details, value] = await Promise.all([
    lstat(readyPath).catch(() => null),
    readFile(readyPath, "utf8").catch(() => ""),
  ]);
  if (
    details?.isFile() && details.uid === process.getuid?.() &&
    (details.mode & 0o777) === 0o600 &&
    nativeWindowGuardReady(value)
  ) return {guarded: true, reason: "window_guard_cached"};

  const nonce = `${process.pid}-${randomBytes(8).toString("hex")}`;
  const statusPath = path.join(
    await weChatTemporaryDirectory(),
    `polymux-wechat-prime-status-window-guard-${nonce}.json`,
  );
  const nativeInjector = fileURLToPath(
    new URL("./wechat_native_task_lldb.py", import.meta.url),
  );
  const executable = process.env.POLYMUX_WECHAT_LLDB || "/usr/bin/lldb";
  const child = spawn(executable, [
    "--no-lldbinit",
    "-p", String(targetPid),
    "-o", `command script import "${nativeInjector.replaceAll('"', '\\"')}"`,
    "-o", "polymux-native-window-guard",
    "-o", "process detach",
    "-o", "quit",
  ], {
    env: {
      ...process.env,
      POLYMUX_WECHAT_PRIME_DYLIB: await weChatPrimerLibrary(),
      POLYMUX_WECHAT_PRIME_STATUS: statusPath,
      POLYMUX_WECHAT_WINDOW_GUARD_DURATION: String(durationMs),
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const output = [];
  child.stdout.on("data", (chunk) => output.push(chunk));
  child.stderr.on("data", (chunk) => output.push(chunk));
  let code;
  try {
    ({code} = await finishNativeSetup(child, 15_000, "WeChat native window guard scheduling"));
  } catch (error) {
    await rm(statusPath, {force: true});
    throw error;
  }
  const text = Buffer.concat(output).toString("utf8");
  const line = text.split("\n").find((candidate) =>
    candidate.trim().startsWith('{"scheduled":'));
  if (code !== 0 || !line) {
    await rm(statusPath, {force: true});
    throw new Error(text.trim() || `WeChat native window guard exited with ${code}`);
  }
  const scheduled = JSON.parse(line);
  if (scheduled.scheduled !== true) {
    await rm(statusPath, {force: true});
    throw new Error(String(scheduled.reason || "WeChat native window guard is unavailable"));
  }
  try {
    const payload = await waitForGuardStatus(statusPath, 5_000);
    if (payload?.ok !== true)
      throw new Error(String(payload?.reason || "WeChat native window guard did not arm"));
    return {guarded: payload.guarded === true, reason: String(payload.reason || "")};
  } finally {
    await rm(statusPath, {force: true});
  }
}

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
  quotedSender,
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
\t\t\t<chatusr>${xml(/@chatroom$/i.test(chatId) ? quotedSender ?? "" : "")}</chatusr>
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

/** The native source carries the notification targets separately from the
 * visible @ labels. A direct chat and a malformed id cannot become a group
 * mention merely because their text contains an @ character. */
export function buildMessageSource(recipient, mentions = []) {
  if (!Array.isArray(mentions) || mentions.some((user) =>
    typeof user !== "string" || !/^[A-Za-z0-9_-]+$/.test(user)))
    throw new Error("WeChat mention targets must be exact member ids");
  if (mentions.length && !/@chatroom$/i.test(recipient))
    throw new Error("WeChat native mentions require a group chat");
  const users = [...new Set(mentions)];
  return `<msgsource><alnode><fr>1</fr></alnode>${users.length
    ? `<atuserlist>${users.join(",")}</atuserlist>` : ""}</msgsource>`;
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

/** One entry per distinct file path; the WeChat image is hundreds of megabytes
 * and several send paths only need to know which build is loaded. Keying on
 * size and mtime keeps a replaced image from reusing a stale digest. */
const sha256FileCache = new Map();

export async function sha256File(filePath) {
  const key = path.resolve(filePath);
  const { size, mtimeMs } = await stat(key);
  const revision = `${size}:${mtimeMs}`;
  const entry = sha256FileCache.get(key);
  // The promise is cached too, so concurrent callers share one read rather
  // than hashing the same image several times in parallel.
  if (entry?.revision === revision) return entry.promise;
  const promise = (async () =>
    createHash("sha256").update(await readFile(key)).digest("hex"))();
  sha256FileCache.set(key, { revision, promise });
  try {
    return await promise;
  } catch (error) {
    if (sha256FileCache.get(key)?.promise === promise) sha256FileCache.delete(key);
    throw error;
  }
}

export async function assertWeChatNativeProfile() {
  const digest = await sha256File(
    process.env.POLYMUX_WECHAT_DYLIB || WECHAT_DYLIB,
  );
  if (!SUPPORTED_PROFILE_SHA256S.has(digest))
    throw new Error(
      "This WeChat version needs a Polymux update before sending. Your imported chats are still available.",
    );
}

export async function wechatPid() {
  const pinnedPid = process.env.POLYMUX_WECHAT_TARGET_PID;
  const pinnedIdentity = process.env.POLYMUX_WECHAT_TARGET_IDENTITY;
  if (pinnedPid !== undefined || pinnedIdentity !== undefined) {
    const pid = Number(pinnedPid);
    if (!pinnedPid || !/^[1-9]\d*$/.test(pinnedPid) || !Number.isSafeInteger(pid) || pid <= 1 ||
        !pinnedIdentity?.trim())
      throw new Error("native WeChat target pin is invalid");
    // A crashed bridge can leave a driver behind. It must never rediscover a
    // different WeChat process after the lease's original target has exited.
    const current = await runProcess("/bin/ps", ["-p", pinnedPid, "-o", "lstart=,comm="],
      {timeout: 2_000}).catch(() => null);
    if (!current || current.stdout.trim() !== pinnedIdentity)
      throw new Error("native WeChat target changed or exited; no replacement was selected");
    return pid;
  }
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
  if (pids.length === 1) return pids[0];

  // A second launch can leave a shell WeChat process with no account store or
  // windows. Select the one that actually owns the signed-in message store;
  // never guess by PID when more than one process has live account data.
  const owners = await new Promise((resolve, reject) => {
    const child = spawn("lsof", ["-n", "-a", "-p", pids.join(","), "-Fn"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.once("error", reject);
    child.once("close", () => {
      const found = new Set();
      let current;
      for (const line of Buffer.concat(stdout).toString("utf8").split("\n")) {
        if (line.startsWith("p")) current = Number(line.slice(1));
        else if (
          line.startsWith("n") &&
          line.includes("/xwechat_files/") &&
          line.includes("/db_storage/message/") &&
          pids.includes(current)
        ) found.add(current);
      }
      resolve([...found]);
    });
  });
  if (owners.length !== 1)
    throw new Error("native WeChat writer could not identify one signed-in process");
  return owners[0];
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
    if (confirmed) {
      await terminateInjectorProcess(child);
      return;
    }
    throw nativeDetachFailure(
      "WeChat debugger did not confirm a clean detach; it was not forcibly terminated",
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
  if (!confirmed)
    throw nativeDetachFailure("WeChat debugger did not confirm a clean detach");
  await terminateInjectorProcess(child);
}

function nativeDetachFailure(message) {
  const error = new Error(message);
  error.nativeDetachUnconfirmed = true;
  return error;
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

/** Every one-shot attachment must detach even when the parent cancels it.
 * Keep stdin available for LLDB cleanup instead of killing a stopped target's
 * debugger at the timeout boundary. */
async function finishNativeSetup(child, timeoutMs, label) {
  let timer;
  try {
    return await interruptionAware(new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({code, signal}));
    }));
  } finally {
    clearTimeout(timer);
    if (child.exitCode == null && child.signalCode == null)
      await stopInjector(child);
  }
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

async function modelSocketPath(pid) {
  return path.join(await weChatTemporaryDirectory(), `polymux-wechat-model-${pid}.sock`);
}

async function residentModelSocketReady(pid, socketPath) {
  const details = await lstat(socketPath ?? await modelSocketPath(pid)).catch(() => null);
  return Boolean(
    details?.isSocket() &&
    details.uid === process.getuid?.() &&
    (details.mode & 0o777) === 0o600
  );
}

async function probeResidentModel(pid) {
  const socketPath = await modelSocketPath(pid);
  if (!(await residentModelSocketReady(pid, socketPath))) return false;
  return await new Promise((resolve) => {
    const socket = createConnection({path: socketPath});
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 500);
    socket.once("connect", () => socket.end("{}\n"));
    socket.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    socket.once("close", (hadError) => {
      clearTimeout(timer);
      resolve(!hadError);
    });
  });
}

export async function residentComposerReady() {
  const pid = await wechatPid();
  return await probeResidentModel(pid);
}

async function invokeResidentModel(pid, armPath, statusPath, socketPath) {
  let connected = false;
  socketPath ??= await modelSocketPath(pid);
  await new Promise((resolve, reject) => {
    const socket = createConnection({path: socketPath});
    const timer = setTimeout(() => {
      socket.destroy();
      const error = new Error("WeChat resident model channel timed out");
      error.modelRequestSubmitted = connected;
      reject(error);
    }, 2_000);
    socket.once("connect", () => {
      connected = true;
      socket.end(`${JSON.stringify({requestPath: armPath, statusPath})}\n`);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      error.modelRequestSubmitted = connected;
      reject(error);
    });
    socket.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  try {
    return await waitForStatus(statusPath, 10_000);
  } catch (error) {
    // The same-user socket accepted the request. Without an explicit native
    // rejection, retrying through LLDB could send the same content twice.
    error.modelRequestSubmitted = true;
    throw error;
  }
}

export async function prepareComposerModel() {
  await assertWeChatNativeProfile();
  const pid = await wechatPid();
  if (await probeResidentModel(pid))
    return {prepared: true, cached: true};
  const nativeInjector = fileURLToPath(
    new URL("./wechat_native_task_lldb.py", import.meta.url),
  );
  const executable = process.env.POLYMUX_WECHAT_LLDB || "/usr/bin/lldb";
  const output = [];
  const child = spawn(executable, [
    "--no-lldbinit",
    "-p", String(pid),
    "-o", `command script import "${nativeInjector.replaceAll('"', '\\"')}"`,
    "-o", "polymux-native-model-prepare",
    "-o", "process detach",
    "-o", "quit",
  ], {
    env: {
      ...process.env,
      POLYMUX_WECHAT_PRIME_DYLIB: await weChatPrimerLibrary(),
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", (chunk) => output.push(chunk));
  child.stderr.on("data", (chunk) => output.push(chunk));
  const exit = await finishNativeSetup(child, STATUS_TIMEOUT_MS, "WeChat model preparation");
  const transcript = Buffer.concat(output).toString("utf8");
  const line = transcript.split("\n").find((candidate) =>
    candidate.trim().startsWith('{"prepared":'));
  if (exit.code !== 0 || !line)
    throw new Error(
      transcript.trim() || `WeChat model preparation exited with ${exit.code}`,
    );
  const result = JSON.parse(line);
  if (result.prepared !== true || !(await probeResidentModel(pid)))
    throw new Error(String(result.reason || "WeChat model channel is unavailable"));
  return result;
}

async function uploadNativeVideoCdn({ bytes, recipient, videoMd5 }) {
  await assertWeChatWireProfile();
  if (process.env.POLYMUX_WECHAT_WIRE_NATIVE !== "1")
    throw new Error(
      "native WeChat wire sending is disabled; set POLYMUX_WECHAT_WIRE_NATIVE=1",
    );
  if (process.env.POLYMUX_WECHAT_LLDB_EXPERIMENTAL !== "1")
    throw new Error(
      "native WeChat LLDB task sending is experimental and disabled",
    );
  await assertWeChatNativeProfile();
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

async function claimModelWindowGuard(pid) {
  const armPath = path.join(
    await weChatTemporaryDirectory(),
    `polymux-wechat-window-guard-${pid}.arm`,
  );
  const value = `1\n${Date.now() / 1000}\n`;
  const create = () => writeFile(armPath, value, { flag: "wx", mode: 0o600 });
  try {
    await create();
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const details = await lstat(armPath).catch(() => null);
    const stale =
      details?.isFile() &&
      details.uid === process.getuid?.() &&
      (details.mode & 0o777) === 0o600 &&
      Date.now() - details.mtimeMs > 30_000;
    if (!stale)
      throw new Error("another guarded WeChat model operation is active");
    await rm(armPath, { force: true });
    await create();
  }
  return armPath;
}

/** The session model owns native unread clearing. No conversation selection,
 * local database write, or synthetic receipt substitutes for its own action. */
export async function markNativeSessionRead(recipient, {unread = false} = {}) {
  if (typeof recipient !== "string" || !recipient || recipient.includes("\0") ||
    Buffer.byteLength(recipient) > 1024)
    throw new Error("WeChat read recipient is invalid");
  if (typeof unread !== "boolean") throw new Error("WeChat unread state must be a boolean");
  if (process.env.POLYMUX_WECHAT_TEST_ONLY_FILEHELPER === "1" && recipient !== "filehelper")
    throw new Error("live WeChat testing is restricted to filehelper");
  await assertWeChatNativeProfile();
  const pid = await wechatPid();
  const nonce = `${process.pid}-${randomBytes(8).toString("hex")}`;
  const armPath = path.join(
    await weChatTemporaryDirectory(), `polymux-wechat-model-read-${nonce}.json`,
  );
  const statusPath = path.join(
    await weChatTemporaryDirectory(), `polymux-wechat-prime-status-read-${nonce}.json`,
  );
  let child;
  try {
    // The caller owns daemon isolation for the entire operation, including
    // installing the window guard and this subsequent model invocation.
    await prepareNativeWeChatWindowGuard({pid, durationMs: 120_000});
    await atomicJson(armPath, {kind: "read", recipient, unread});
    const injector = fileURLToPath(new URL("./wechat_native_task_lldb.py", import.meta.url));
    const output = [];
    child = spawn(process.env.POLYMUX_WECHAT_LLDB || "/usr/bin/lldb", [
      "--no-lldbinit",
      "-p", String(pid),
      "-o", `command script import "${injector.replaceAll('"', '\\"')}"`,
      "-o", "polymux-native-mark-read", "-o", "process detach", "-o", "quit",
    ], {
      env: {...process.env, POLYMUX_WECHAT_MODEL_ARM: armPath, POLYMUX_WECHAT_MODEL_STATUS: statusPath},
      stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    });
    child.stdout.on("data", (chunk) => output.push(chunk));
    child.stderr.on("data", (chunk) => output.push(chunk));
    const {code} = await finishNativeSetup(child, STATUS_TIMEOUT_MS, "WeChat native read operation");
    const status = await waitForStatus(statusPath, 1_000);
    if (code !== 0 || status.ok !== true || status.submitted !== true)
      throw new Error(status.reason || "WeChat did not submit its native mark-read action");
    return status;
  } finally {
    // finishNativeSetup owns detaching this process. Never force-terminate a
    // debugger here after that cleanup failed to confirm release of WeChat.
    await Promise.all([rm(armPath, {force: true}), rm(statusPath, {force: true})]);
  }
}

/** ContactService::ModifyChatRoomName, the same operation used by Desktop's
 * group settings. The caller must hold writer isolation and verify the name
 * in native contact state after this asynchronous submission. */
export async function renameNativeGroup(recipient, name) {
  if (typeof recipient !== "string" || !/^[1-9]\d{0,30}@chatroom$/.test(recipient))
    throw new Error("WeChat group recipient is invalid");
  if (typeof name !== "string" || !name.trim() || /[\u0000-\u001f\u007f]/.test(name) ||
      Buffer.byteLength(name) > 1024 || Buffer.from(name).toString() !== name)
    throw new Error("WeChat group name is invalid");
  if (process.env.POLYMUX_WECHAT_TEST_ONLY_FILEHELPER === "1")
    throw new Error("Group renaming is outside File Transfer testing");
  await assertWeChatNativeProfile();
  const pid = await wechatPid();
  const nonce = `${process.pid}-${randomBytes(8).toString("hex")}`;
  const armPath = path.join(
    await weChatTemporaryDirectory(), `polymux-wechat-model-rename-${nonce}.json`,
  );
  const statusPath = path.join(
    await weChatTemporaryDirectory(), `polymux-wechat-prime-status-rename-${nonce}.json`,
  );
  try {
    await prepareNativeWeChatWindowGuard({pid, durationMs: 120_000});
    await atomicJson(armPath, {kind: "rename-group", recipient, name});
    const injector = fileURLToPath(new URL("./wechat_native_task_lldb.py", import.meta.url));
    const child = spawn(process.env.POLYMUX_WECHAT_LLDB || "/usr/bin/lldb", [
      "--no-lldbinit", "-p", String(pid),
      "-o", `command script import "${injector.replaceAll('"', '\\"')}"`,
      "-o", "polymux-native-rename-group", "-o", "process detach", "-o", "quit",
    ], {
      env: {...process.env, POLYMUX_WECHAT_MODEL_ARM: armPath, POLYMUX_WECHAT_MODEL_STATUS: statusPath},
      stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    });
    child.stdout.resume();
    child.stderr.resume();
    const {code} = await finishNativeSetup(child, STATUS_TIMEOUT_MS, "WeChat native group rename");
    const status = await waitForStatus(statusPath, 1_000);
    if (code !== 0 || status.ok !== true || status.submitted !== true)
      throw new Error(status.reason || "WeChat did not submit its group rename");
    return status;
  } finally {
    await Promise.all([rm(armPath, {force: true}), rm(statusPath, {force: true})]);
  }
}

/** Return no result only when native setup can safely precede the first
 * submission. A definitive recipient rejection must escape the transport
 * catch, and an accepted request with a lost reply must never be replayed. */
export async function settleResidentComposerAttempt(invoke) {
  let resident;
  try {
    resident = await invoke();
  } catch (error) {
    if (error?.modelRequestSubmitted === true)
      return {ok: true, submitted: true, verificationPending: true, transport: "resident"};
    if (error?.modelRequestSubmitted === false) return null;
    throw error;
  }
  if (resident?.submitted === true)
    return {...resident, ok: true, ...(resident.ok !== true ? {verificationPending: true} : {}), transport: "resident"};
  if (resident?.reason === "wechat_model_configuration_changed" && resident?.submitted === false)
    return null;
  throw new Error(resident?.reason || "WeChat resident model sender did not submit");
}

export async function sendComposerMessage({ kind, path: filePath, recipient, text }) {
  if (!["text", "file", "image", "video"].includes(kind))
    throw new Error("WeChat model message kind is invalid");
  if (
    typeof recipient !== "string" ||
    !recipient ||
    recipient.includes("\0") ||
    Buffer.byteLength(recipient, "utf8") > 22
  ) throw new Error("WeChat model recipient is invalid");
  if (
    process.env.POLYMUX_WECHAT_TEST_ONLY_FILEHELPER === "1" &&
    recipient !== "filehelper"
  ) throw new Error("live WeChat testing is restricted to filehelper");
  if (kind === "text" && (typeof text !== "string" || !text || text.includes("\0")))
    throw new Error("WeChat model text is invalid");
  if (
    kind !== "text" &&
    (typeof filePath !== "string" || !path.isAbsolute(filePath))
  ) throw new Error("WeChat model attachment path is invalid");

  await assertWeChatNativeProfile();
  const pid = await wechatPid();
  const nonce = `${process.pid}-${randomBytes(8).toString("hex")}`;
  const armPath = path.join(
    await weChatTemporaryDirectory(), `polymux-wechat-model-arm-${nonce}.json`,
  );
  const statusPath = path.join(
    await weChatTemporaryDirectory(), `polymux-wechat-prime-status-model-${nonce}.json`,
  );
  const windowArmPath = await claimModelWindowGuard(pid);
  const attachment = kind === "text" ? null : await stageModelAttachment(filePath);
  const nativeInjector = fileURLToPath(
    new URL("./wechat_native_task_lldb.py", import.meta.url),
  );
  const executable = process.env.POLYMUX_WECHAT_LLDB || "/usr/bin/lldb";
  const output = [];
  let child;
  try {
    await atomicJson(armPath, {
      kind,
      ...(kind === "text" ? { text } : { path: attachment.path }),
      recipient,
    });
    if (await residentModelSocketReady(pid)) {
      const resident = await settleResidentComposerAttempt(
        () => invokeResidentModel(pid, armPath, statusPath),
      );
      if (resident) return resident;
      await rm(statusPath, {force: true});
    }
    child = spawn(executable, [
      "-p", String(pid),
      "-o", `command script import "${nativeInjector.replaceAll('"', '\\"')}"`,
      "-o", "polymux-native-model-send",
      "-o", "process detach",
      "-o", "quit",
    ], {
      env: {
        ...process.env,
        POLYMUX_WECHAT_MODEL_ARM: armPath,
        POLYMUX_WECHAT_MODEL_STATUS: statusPath,
        POLYMUX_WECHAT_PRIME_DYLIB: await weChatPrimerLibrary(),
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout.on("data", (chunk) => output.push(chunk));
    child.stderr.on("data", (chunk) => output.push(chunk));
    const exit = await finishNativeSetup(child, STATUS_TIMEOUT_MS, "WeChat model sender");
    if (exit.code !== 0)
      throw new Error(
        Buffer.concat(output).toString("utf8").trim() ||
        `WeChat model sender exited with code ${exit.code}`,
      );
    let status;
    try {
      status = await waitForStatus(statusPath, 10_000);
    } catch (error) {
      // The LLDB command returns `scheduled:true` only after the exact model
      // pointers were validated and WeChat accepted the main-queue operation.
      // Once that commit point is crossed, reporting a timeout as a failed
      // send would put the content back in the composer and invite a duplicate.
      const transcript = Buffer.concat(output).toString("utf8");
      if (transcript.includes('"scheduled":true'))
        return {ok: true, submitted: true, verificationPending: true};
      throw error;
    }
    if (status?.ok !== true || status?.submitted !== true)
      throw new Error(status?.reason || "WeChat model sender did not submit");
    return {...status, transport: "debugger"};
  } finally {
    // finishNativeSetup owns detach. Never terminate a debugger here when
    // its cleanup could not confirm that it released WeChat.
    await Promise.all([
      rm(armPath, { force: true }),
      rm(statusPath, { force: true }),
      rm(windowArmPath, { force: true }),
      ...(attachment?.staged
        ? [rm(attachment.staged, { force: true, recursive: true })]
        : []),
    ]);
  }
}

/** Desktop creates and persists this message itself, independent of the open
 * chat. The caller owns process isolation and verifies the outgoing history
 * row. Scheduling or a callback alone is never a delivery acknowledgement. */
export async function nativeServiceSession(userId) {
  if (typeof userId !== "string" || !/^wxid_[A-Za-z0-9_-]+$/.test(userId))
    throw new Error("WeChat native account is invalid");
  await assertWeChatNativeProfile();
  const pid = await wechatPid();
  const helper = path.join(path.dirname(await nativePrimeLibrary()), "wechat-session-state");
  const {stdout} = await runProcess(helper, ["--pid", String(pid)], {timeout: 3_000});
  const result = JSON.parse(stdout);
  return result.ok === true && result.state === "signed_in" && result.pid === pid &&
    result.accountFingerprint === createHash("sha256").update(userId).digest("hex");
}

export async function sendNativeServiceText({recipient, text, userId, residentOnly = false}) {
  for (const value of [recipient, userId])
    if (typeof value !== "string" || !/^[A-Za-z0-9_@.-]{1,128}$/.test(value))
      throw new Error("WeChat native message identity is invalid");
  if (typeof text !== "string" || !text || text.includes("\0") ||
      Buffer.byteLength(text) > 64 * 1024 || Buffer.from(text).toString() !== text)
    throw new Error("WeChat native text is invalid");
  if (process.env.POLYMUX_WECHAT_TEST_ONLY_FILEHELPER === "1" && recipient !== "filehelper")
    throw new Error("live WeChat testing is restricted to filehelper");
  await assertWeChatNativeProfile();
  const pid = await wechatPid();
  const directory = path.dirname(await nativePrimeLibrary());
  const revision = (await readFile(path.join(directory, "VERSION"), "utf8")).trim();
  if (!/^[a-f0-9]{64}$/.test(revision)) throw new Error("WeChat native helper revision is invalid");
  // Distinct install names keep dlopen from reusing an older helper retained
  // by an already-running Desktop after a Polymux update.
  const library = path.join(directory, `libpolymux-wechat-message-${revision}.dylib`);
  await access(library);
  const nonce = `${process.pid}-${randomBytes(16).toString("hex")}`;
  const armPath = `/tmp/polymux-wechat-service-arm-${nonce}.json`;
  const statusPath = `/tmp/polymux-wechat-service-status-${nonce}.json`;
  const injector = fileURLToPath(new URL("./wechat_native_task_lldb.py", import.meta.url));
  const output = [];
  try {
    await atomicJson(armPath, {requestId: nonce, pid, createdAt: Date.now() / 1000,
      recipient, accountId: userId, text,
      testOnlyFileTransfer: process.env.POLYMUX_WECHAT_TEST_ONLY_FILEHELPER === "1"});
    const socketPath = `/tmp/pmx-wx-service-${process.getuid()}-${pid}-${revision.slice(0,16)}.sock`;
    if (await residentModelSocketReady(pid, socketPath)) {
      const result = await settleResidentComposerAttempt(() => invokeResidentModel(pid, armPath, statusPath, socketPath));
      if (result) return {...result, verificationPending:true};
    }
    if (residentOnly) return null;
    const child = spawn(process.env.POLYMUX_WECHAT_LLDB || "/usr/bin/lldb", [
      "--no-lldbinit", "-p", String(pid),
      "-o", `command script import "${injector.replaceAll('"', '\\"')}"`,
      "-o", "polymux-native-service-text", "-o", "process detach", "-o", "quit",
    ], {
      env: {...process.env, POLYMUX_WECHAT_MODEL_ARM: armPath,
        POLYMUX_WECHAT_MODEL_STATUS: statusPath, POLYMUX_WECHAT_SERVICE_DYLIB: library},
      stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    });
    child.stdout.on("data", chunk => output.push(chunk));
    child.stderr.on("data", chunk => output.push(chunk));
    let scheduled;
    try {
      await finishNativeSetup(child, STATUS_TIMEOUT_MS, "WeChat message service");
      const transcript = Buffer.concat(output).toString("utf8");
      const receipt = transcript.split("\n").find(line => line.trim().startsWith('{"scheduled":'));
      scheduled = receipt ? JSON.parse(receipt) : null;
      if (typeof scheduled?.scheduled !== "boolean")
        throw new Error("WeChat message scheduling was not confirmed");
    } catch (error) {
      // A running injector may have queued the send before cancellation,
      // detach failure or a lost receipt. Preserve its cleanup flags, and
      // never report that uncertain operation as safe to resend.
      if (child.pid) error.deliveryUnconfirmed = true;
      throw error;
    }
    if (!scheduled.scheduled)
      throw Object.assign(new Error(scheduled.reason || "WeChat message was not scheduled"),
        scheduled.deliveryUnconfirmed === true ? {deliveryUnconfirmed: true} : {});
    let result;
    try { result = await waitForStatus(statusPath, 10_000); }
    catch { return {submitted: true, verificationPending: true}; }
    if (result?.submitted === true) return {...result, verificationPending: true};
    if (result?.submitted === false)
      throw new Error(result.reason || "WeChat message was rejected before submission");
    return {submitted: true, verificationPending: true};
  } finally {
    await Promise.all([rm(armPath, {force: true}), rm(statusPath, {force: true})]);
  }
}

/** Wire-layer operations (voice, stickers, CDN uploads, recall, and the
 * indirect task sender) refuse a build whose offsets were never derived. */
export async function assertWeChatWireProfile() {
  const digest = await sha256File(
    process.env.POLYMUX_WECHAT_DYLIB || WECHAT_DYLIB,
  );
  if (!WIRE_TASK_PROFILE_SHA256S.has(digest))
    throw new Error(
      "This WeChat version needs a Polymux update before sending. Your imported chats are still available.",
    );
  return digest;
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
  await assertWeChatWireProfile();
  if (
    process.env.POLYMUX_WECHAT_TEST_ONLY_FILEHELPER === "1" &&
    recipient !== "filehelper"
  )
    throw new Error("live WeChat testing is restricted to filehelper");
  await assertWeChatNativeProfile();
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
      throw new AggregateError([operationError, detachError],
        "WeChat native operation failed and debugger cleanup also failed");
    }
    await Promise.all([
      rm(armPath, { force: true }),
      rm(statusPath, { force: true }),
      rm(tracePath, { force: true }),
    ]);
  }
}

export async function sendTypedMessage({ content, messageType, recipient, userId, messageSource }) {
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
      messageSource,
    }),
  });
  return {
    ...sent,
    clientMessageId: String(clientMessageId),
    messageId: parseNativeNewSendMessageResponse(sent.response),
  };
}

export const WECHAT_NATIVE_PROFILE_SHA256 = PROFILE_SHA256;
