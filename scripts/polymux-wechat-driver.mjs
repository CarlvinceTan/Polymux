#!/usr/bin/env node

import {spawn} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";

const MAX_REQUEST_BYTES = 1024 * 1024;
const TIMEOUT_MS = 130_000;

function answer(value, exitCode = 0) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
  process.exitCode = exitCode;
}

function fail(reason, exitCode = 0) {
  answer({deliveredVerified: false, reason}, exitCode);
}

async function readRequest() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) throw new Error("request is too large");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) throw new Error("request is empty");
  return JSON.parse(raw);
}

async function run(executable, args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`WeChat command timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString("utf8").trim(),
        stderr: Buffer.concat(stderr).toString("utf8").trim(),
      });
    });
  });
}

function requireString(value, name) {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${name} must be a non-empty string`);
  return value;
}

function parseCliResult(result) {
  let payload;
  try {
    payload = JSON.parse(result.stdout || "{}");
  } catch {
    throw new Error(result.stderr || "WeChat helper returned invalid JSON");
  }
  const diagnostic =
    payload.diagnostic && typeof payload.diagnostic === "object"
      ? payload.diagnostic
      : {};
  if (
    payload.delivered_verified === true ||
    diagnostic.delivered_verified === true
  ) {
    return {
      deliveredVerified: true,
      ...(payload.message_id || diagnostic.message_id
        ? {messageId: String(payload.message_id ?? diagnostic.message_id)}
        : {}),
    };
  }
  const reason =
    payload.reason ||
    payload.error ||
    diagnostic.reason ||
    result.stderr ||
    `WeChat helper exited with ${result.code}`;
  return {deliveredVerified: false, reason: String(reason)};
}

async function findSentTextMessageId(cli, chatId, body) {
  const result = await run(cli, [
    "history",
    chatId,
    "--since",
    "2 minutes ago",
    "--limit",
    "20",
    "--json",
    "--no-transcribe",
    "--fields",
    "server_id,real_sender_id,message_kind,display_text,message_content",
  ]);
  if (result.code !== 0) return undefined;
  try {
    // WeChat server IDs are unsigned 64-bit values. Quote them before JSON.parse
    // so JavaScript cannot round the identifier and make reply/recall unsafe.
    const losslessJson = (result.stdout || "{}").replace(
      /(\"server_id\"\s*:\s*)(-?\d+)/g,
      '$1"$2"',
    );
    const payload = JSON.parse(losslessJson);
    const row = payload.rows?.find(
      (candidate) =>
        candidate.message_kind === "text" &&
        String(candidate.real_sender_id) === "2" &&
        (candidate.display_text === body || candidate.message_content === body) &&
        candidate.server_id != null,
    );
    return row ? String(row.server_id) : undefined;
  } catch {
    return undefined;
  }
}

async function replyFallbackBody(cli, chatId, messageId, body) {
  const result = await run(cli, [
    "history",
    chatId,
    "--limit",
    "100",
    "--json",
    "--no-transcribe",
    "--fields",
    "server_id,sender_name,sender_wxid,display_text,message_content",
  ]);
  if (result.code !== 0) throw new Error("WeChat reply target is unavailable");
  const payload = parseHistory(result.stdout);
  const target = payload.rows?.find(
    (row) => String(row.server_id) === String(messageId),
  );
  if (!target) throw new Error("WeChat reply target was not found in history");
  const quoted = String(target.display_text ?? target.message_content ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!quoted) throw new Error("WeChat reply target has no readable text");
  const sender = String(target.sender_name ?? target.sender_wxid ?? "Earlier message").trim();
  return `↳ ${sender || "Earlier message"}: ${quoted}\n${body}`;
}

function parseHistory(stdout) {
  const losslessJson = (stdout || "{}").replace(
    /(\"server_id\"\s*:\s*)(-?\d+)/g,
    '$1"$2"',
  );
  return JSON.parse(losslessJson);
}

async function findSentMediaMessageId(
  cli,
  chatId,
  mediaType,
  bytes,
  sinceEpoch,
) {
  const result = await run(cli, [
    "history",
    chatId,
    "--since",
    String(sinceEpoch),
    "--limit",
    "20",
    "--json",
    "--no-transcribe",
    "--fields",
    "server_id,real_sender_id,message_kind,media",
  ]);
  if (result.code !== 0) return undefined;
  try {
    const payload = parseHistory(result.stdout);
    const expectedKind = {
      image: "image",
      // Until the private emoticon handler is recovered, stickers preserve
      // their exact pixels through WeChat's image-send route.
      sticker: "image",
      video: "video",
      audio: "audio",
      file: "attachment",
    }[mediaType];
    const md5 = createHash("md5").update(bytes).digest("hex");
    const candidates = payload.rows?.filter(
      (row) =>
        String(row.real_sender_id) === "2" &&
        row.message_kind === expectedKind &&
        row.server_id != null,
    );
    const exact = candidates?.find((row) => {
      const remoteLength = Number(
        row.media?.length ?? row.media?.total_size ?? row.media?.size ?? NaN,
      );
      return (
        !row.media?.md5 ||
        row.media.md5 === md5 ||
        remoteLength === bytes.byteLength
      );
    });
    // WeChat may re-encode pictures before upload, changing both MD5 and byte
    // length. The history query is bounded to this serialized send's start,
    // so the newest self-authored row of the expected kind is the fallback.
    const delivered = exact ?? candidates?.[0];
    return delivered ? String(delivered.server_id) : undefined;
  } catch {
    return undefined;
  }
}

async function confirmAlreadyRead(cli, chatId) {
  const result = await run(cli, ["unread", "--json"]);
  if (result.code !== 0)
    return {deliveredVerified: false, reason: "WeChat unread state is unavailable"};
  try {
    const payload = JSON.parse(result.stdout || "{}");
    const row = payload.rows?.find((item) => item.username === chatId);
    if (!row || Number(row.unread_count) === 0) return {deliveredVerified: true};
    return {
      deliveredVerified: false,
      reason: `WeChat still reports ${row.unread_count} unread item(s)`,
    };
  } catch {
    return {deliveredVerified: false, reason: "WeChat unread state was invalid"};
  }
}

async function main() {
  if (process.argv[2] !== "write" || !process.argv.includes("--json"))
    throw new Error("usage: polymux-wechat-driver write --json");

  const request = await readRequest();
  const chatId = requireString(request.chatId, "chatId");
  if (
    process.env.POLYMUX_WECHAT_TEST_ONLY_FILEHELPER === "1" &&
    chatId !== "filehelper"
  )
    throw new Error("live WeChat testing is restricted to filehelper");

  const cli = process.env.POLYMUX_WECHAT_CLI || "wechat-use";
  if (request.kind === "text") {
    const authored = requireString(request.body, "body");
    const body = request.replyTo
      ? await replyFallbackBody(cli, chatId, request.replyTo, authored)
      : authored;
    const args = [
      "send",
      body,
      "--wxid",
      chatId,
      "--json",
    ];
    for (const mention of request.mentions ?? [])
      args.push("--mention", requireString(mention, "mention"));
    const delivery = parseCliResult(await run(cli, args));
    if (delivery.deliveredVerified && !delivery.messageId) {
      const messageId = await findSentTextMessageId(cli, chatId, body);
      answer(messageId ? {...delivery, messageId} : delivery);
    } else {
      answer(delivery);
    }
    return;
  }

  if (request.kind === "media") {
    const mediaType = requireString(request.mediaType, "mediaType");
    if (!["image", "sticker"].includes(mediaType))
      throw new Error(`native WeChat ${mediaType} sending is not implemented yet`);
    const mediaPath = requireString(request.path, "path");
    const bytes = await readFile(mediaPath);
    const sinceEpoch = Math.floor(Date.now() / 1000) - 2;
    const helper = await run(cli, [
          "send",
          requireString(request.name, "name"),
          "--image",
          mediaPath,
          "--wxid",
          chatId,
          "--json",
        ]);
    const messageId = await findSentMediaMessageId(
      cli,
      chatId,
      mediaType,
      bytes,
      sinceEpoch,
    );
    if (messageId) answer({deliveredVerified: true, messageId});
    else answer(parseCliResult(helper));
    return;
  }

  if (request.kind === "read") {
    answer(await confirmAlreadyRead(cli, chatId));
    return;
  }
  if (request.kind === "recall")
    throw new Error(`native WeChat ${request.kind} is not implemented yet`);
  throw new Error("unknown WeChat writer operation");
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
