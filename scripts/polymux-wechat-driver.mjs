#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildReplyXml,
  interruptNativeOperations,
  recallNativeMessage,
  sendNativeFile,
  sendNativeSticker,
  sendNativeVideo,
  sendNativeVoice,
  sendTypedMessage,
  stickerMd5,
} from "./wechat-wire.mjs";
import {
  daemonStatusRunning,
  hasWeChatDaemonCaptureProcess,
  recognisesDaemonStatus,
  settlePausedDaemonOperation,
  usesNativeTextTransport,
  weChatDaemonCaptureProcessIds,
} from "./wechat-daemon-coordination.mjs";

const MAX_REQUEST_BYTES = 1024 * 1024;
const TIMEOUT_MS = 130_000;
const DAEMON_DETACH_QUIET_MS = 1_000;
const activeCommands = new Set();
let shutdownSignal;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    shutdownSignal ??= signal;
    interruptNativeOperations(new Error(`WeChat writer received ${signal}`));
    for (const child of activeCommands) child.kill("SIGTERM");
  });
}

function requireNativeWire(operation) {
  if (process.env.POLYMUX_WECHAT_WIRE_NATIVE !== "1")
    throw new Error(
      `native WeChat ${operation} requires the exact-build wire sender`,
    );
}

async function mediaPrepareExecutable() {
  const candidates = [
    process.env.POLYMUX_WECHAT_MEDIA_PREPARE,
    fileURLToPath(
      new URL("../native/bin/wechat-media-prepare", import.meta.url),
    ),
    fileURLToPath(
      new URL("../resources/native/bin/wechat-media-prepare", import.meta.url),
    ),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the checkout or packaged location next.
    }
  }
  throw new Error("the bundled WeChat media preparer is unavailable");
}

async function wechatVoice(bytes, name) {
  const silk = await import("silk-wasm");
  if (silk.isSilk(bytes))
    return {
      bytes: Buffer.from(bytes),
      durationMs: Math.max(1, Math.round(silk.getDuration(bytes))),
    };

  const directory = await mkdtemp(path.join(tmpdir(), "polymux-wechat-voice-"));
  const input = path.join(directory, path.basename(name || "voice.bin"));
  const output = path.join(directory, "voice.pcm");
  let pcm;
  let preparedDuration;
  try {
    await writeFile(input, bytes);
    const converted = await run(await mediaPrepareExecutable(), [
      "voice",
      input,
      output,
    ]);
    if (converted.code !== 0)
      throw new Error(converted.stderr || "voice conversion failed");
    const metadata = JSON.parse(converted.stdout || "{}");
    preparedDuration = Number(metadata.durationMs);
    pcm = await readFile(output);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
  const encoded = await silk.encode(pcm, 24_000);
  if (!encoded.data?.length || !Number.isFinite(encoded.duration))
    throw new Error("SILK voice encoding failed");
  return {
    bytes: Buffer.from(encoded.data),
    durationMs: Math.max(
      1,
      Math.round(
        Number.isFinite(preparedDuration) ? preparedDuration : encoded.duration,
      ),
    ),
  };
}

async function wechatVideo(bytes, name) {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-wechat-video-"));
  const input = path.join(directory, path.basename(name || "video.mp4"));
  const thumbnailPath = path.join(directory, "thumbnail.jpg");
  try {
    await writeFile(input, bytes);
    const converted = await run(await mediaPrepareExecutable(), [
      "video",
      input,
      thumbnailPath,
    ]);
    if (converted.code !== 0)
      throw new Error(converted.stderr || "video thumbnail conversion failed");
    const durationSeconds = Number(
      JSON.parse(converted.stdout || "{}").durationSeconds,
    );
    if (!Number.isInteger(durationSeconds) || durationSeconds <= 0)
      throw new Error("video duration is unavailable");
    return {
      durationSeconds,
      thumbnail: await readFile(thumbnailPath),
    };
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

function answer(value, exitCode = 0) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
  process.exitCode = exitCode;
}

function fail(reason, exitCode = 0) {
  answer({ deliveredVerified: false, reason }, exitCode);
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
    activeCommands.add(child);
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      activeCommands.delete(child);
      callback(value);
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(reject, new Error(`WeChat command timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", (error) => {
      finish(reject, error);
    });
    child.once("close", (code) => {
      finish(resolve, {
        code,
        stdout: Buffer.concat(stdout).toString("utf8").trim(),
        stderr: Buffer.concat(stderr).toString("utf8").trim(),
      });
    });
  });
}

async function withPausedDaemon(cli, action) {
  const status = await run(cli, ["daemon", "status"]);
  const processes = await daemonProcesses();
  const wasRunning =
    (status.code === 0 && daemonStatusRunning(status.stdout)) ||
    (status.code === 0 &&
      recognisesDaemonStatus(status.stdout) &&
      processes.code === 0 &&
      hasWeChatDaemonCaptureProcess(processes.stdout));
  if (wasRunning) {
    const stopped = await run(cli, ["daemon", "stop"]);
    if (stopped.code !== 0)
      throw new Error(stopped.stderr || "WeChat daemon did not stop");
  }
  // A supervised relay may have begun stopping its daemon just before this
  // process asked for status. In that window status already says "stopped"
  // while LLDB/debugserver is still attached to WeChat; starting the native
  // task then makes one debugger kill the other. Always wait for the capture
  // tree to disappear, even when this writer was not the process that stopped
  // it.
  await waitForDaemonCaptureState(false);
  let result;
  let actionFailure;
  try {
    result = await action();
  } catch (error) {
    if (nativeInjectorFailedBeforeReady(error)) {
      // No request can have been submitted before the injector's ready
      // barrier, so one retry cannot duplicate a message. Keep the daemon
      // paused, wait for the failed debugger to release WeChat, and retry the
      // same native operation once inside this exclusive writer process.
      try {
        await waitForDaemonCaptureState(false);
        result = await action();
      } catch (retryError) {
        actionFailure = retryError;
      }
    } else {
      actionFailure = error;
    }
  }
  let restartFailure;
  if (wasRunning) {
    try {
      const restarted = await run(cli, ["daemon", "start"]);
      if (restarted.code !== 0)
        restartFailure = new Error(restarted.stderr || "WeChat daemon did not restart");
      else
        await waitForDaemonCaptureState(true);
    } catch (error) {
      restartFailure = error;
    }
  }
  const settled = settlePausedDaemonOperation({
    actionFailure,
    restartFailure,
    result,
  });
  if (settled.restartFailure)
    process.stderr.write(
      `[wechat] delivery succeeded but daemon recovery is pending: ${settled.restartFailure.message}\n`,
    );
  return settled.result;
}

function nativeInjectorFailedBeforeReady(error) {
  const detail = String(error?.message ?? error ?? "").toLowerCase();
  return (
    detail.includes("native task injector exited before ready") ||
    detail.includes("native task injector did not become ready")
  );
}

async function waitForDaemonCaptureState(running, timeoutMs = 15_000) {
  const started = Date.now();
  let sentTerm = false;
  let sentKill = false;
  let absentSince;
  while (Date.now() - started < timeoutMs) {
    const processes = await daemonProcesses();
    const present =
      processes.code === 0 && hasWeChatDaemonCaptureProcess(processes.stdout);
    if (running && present) return;
    if (!running && !present) {
      absentSince ??= Date.now();
      // LLDB can disappear from the process table just before macOS releases
      // the task port. Reattaching in that gap makes debugserver kill the new
      // injector. A continuous quiet interval is the observable detach gate.
      if (Date.now() - absentSince >= DAEMON_DETACH_QUIET_MS) return;
    } else {
      absentSince = undefined;
    }
    const elapsed = Date.now() - started;
    if (!running && !sentTerm && elapsed >= 2_000) {
      terminateDaemonCaptureProcesses(processes.stdout, "SIGTERM");
      sentTerm = true;
    } else if (!running && !sentKill && elapsed >= 8_000) {
      terminateDaemonCaptureProcesses(processes.stdout, "SIGKILL");
      sentKill = true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    running
      ? "WeChat daemon did not finish restarting"
      : "WeChat daemon debugger did not finish detaching",
  );
}

function daemonProcesses() {
  return run("/bin/ps", ["-ax", "-o", "pid=,ppid=,command="]);
}

function terminateDaemonCaptureProcesses(processTable, signal) {
  for (const pid of weChatDaemonCaptureProcessIds(processTable)) {
    try {
      process.kill(pid, signal);
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  }
}

function requireString(value, name) {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${name} must be a non-empty string`);
  return value;
}

function xmlText(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function cliExplicitlyFailed(result) {
  if (result.code !== 0) return true;
  try {
    const payload = JSON.parse(result.stdout || "{}");
    return (
      Boolean(payload.error || payload.reason) ||
      payload.delivered_verified === false ||
      payload.diagnostic?.delivered_verified === false
    );
  } catch {
    return true;
  }
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
        ? { messageId: String(payload.message_id ?? diagnostic.message_id) }
        : {}),
    };
  }
  const reason =
    payload.reason ||
    payload.error ||
    diagnostic.reason ||
    result.stderr ||
    `WeChat helper exited with ${result.code}`;
  return { deliveredVerified: false, reason: String(reason) };
}

function cliNeedsBackgroundPrime(result) {
  try {
    const payload = JSON.parse(result.stdout || "{}");
    const reason = String(
      payload.diagnostic?.reason ?? payload.reason ?? payload.error ?? "",
    )
      .trim()
      .toLowerCase();
    return (
      reason === "slot_send_bp_armed_no_fire" ||
      reason === "wechat_no_chat_selected"
    );
  } catch {
    return false;
  }
}

async function primeWeChatInBackground() {
  const helper = String(process.env.POLYMUX_WECHAT_PRIMER ?? "").trim();
  if (!helper) return false;
  const result = await run(helper, []);
  if (result.code !== 0) return false;
  try {
    const payload = JSON.parse(result.stdout || "{}");
    return payload.ok === true && payload.primed === true;
  } catch {
    return false;
  }
}

async function runCliSend(cli, args) {
  let result = await run(cli, args);
  if (cliNeedsBackgroundPrime(result) && (await primeWeChatInBackground()))
    result = await run(cli, args);
  return result;
}

async function requireNonDebuggerPlaceholderTransport(cli) {
  const result = await run(cli, ["polymux-wire-capabilities", "--json"]);
  let capabilities;
  try {
    capabilities = JSON.parse(result.stdout || "{}");
  } catch {
    capabilities = {};
  }
  if (
    result.code !== 0 ||
    capabilities.protocol !== "polymux-wechat-wire-v1" ||
    capabilities.placeholderWithoutDebugger !== true
  )
    throw new Error(
      "native WeChat typed sending is unavailable: the configured helper does not advertise a non-debugger placeholder transport; wechat-use owns and may reap external LLDB sessions",
    );
}

async function sendVerifiedPlaceholder(cli, args) {
  const result = await run(cli, args);
  const delivery = parseCliResult(result);
  if (!delivery.deliveredVerified)
    throw new Error(
      `WeChat placeholder helper failed: ${delivery.reason ?? "delivery was not verified"}`,
    );
  return result;
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
        (candidate.display_text === body ||
          candidate.message_content === body) &&
        candidate.server_id != null,
    );
    return row ? String(row.server_id) : undefined;
  } catch {
    return undefined;
  }
}

async function waitForSentTextMessageId(cli, chatId, body, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const messageId = await findSentTextMessageId(cli, chatId, body);
    if (messageId) return messageId;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return undefined;
}

async function replyTarget(cli, chatId, messageId) {
  const result = await run(cli, [
    "history",
    chatId,
    "--limit",
    "100",
    "--json",
    "--no-transcribe",
    "--fields",
    "server_id,sender_name,sender_wxid,create_time,message_kind,display_text,message_content",
  ]);
  if (result.code !== 0) throw new Error("WeChat reply target is unavailable");
  const payload = parseHistory(result.stdout);
  const target = payload.rows?.find(
    (row) => String(row.server_id) === String(messageId),
  );
  if (!target) throw new Error("WeChat reply target was not found in history");
  const quoted =
    String(target.display_text ?? target.message_content ?? "")
      .trim()
      .replace(/\s+/g, " ") ||
    QUOTED_PLACEHOLDERS[String(target.message_kind ?? "")] ||
    "";
  if (!quoted) throw new Error("WeChat reply target has no readable text");
  return { ...target, quoted };
}

// A refermsg quote of a media message carries no readable text; WeChat still
// supports quoting it, so stand in a type label rather than failing the reply.
const QUOTED_PLACEHOLDERS = {
  attachment: "[File]",
  audio: "[Voice]",
  emoticon: "[Sticker]",
  file: "[File]",
  image: "[Image]",
  video: "[Video]",
};

async function accountIdentity(cli) {
  const accounts = await run(cli, ["accounts", "--json"]);
  if (accounts.code !== 0)
    throw new Error("WeChat account identity is unavailable");
  const account = JSON.parse(accounts.stdout || "{}").accounts?.[0];
  const wxid = requireString(account?.wxid, "WeChat account wxid");
  const contacts = await run(cli, ["contacts", "--query", wxid, "--json"]);
  let displayName = wxid;
  if (contacts.code === 0) {
    try {
      const row = JSON.parse(contacts.stdout || "[]")[0];
      displayName =
        String(row?.display_name ?? row?.nick_name ?? wxid).trim() || wxid;
    } catch {
      // The wxid remains an unambiguous, safe fallback for refermsg metadata.
    }
  }
  return { displayName, wxid };
}

function quotedType(kind) {
  return (
    {
      attachment: 49,
      audio: 34,
      emoticon: 47,
      file: 49,
      image: 3,
      text: 1,
      video: 43,
    }[kind] ?? 1
  );
}

async function findSentReplyMessageId(cli, chatId, body, replyTo) {
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
    const payload = parseHistory(result.stdout);
    const escapedBody = xmlText(body).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedReply = String(replyTo).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const title = new RegExp(`<title>(?:<!\\[CDATA\\[)?${escapedBody}`);
    const target = new RegExp(`<svrid>(?:<!\\[CDATA\\[)?${escapedReply}`);
    const row = payload.rows?.find((candidate) => {
      const message = String(candidate.message_content ?? "");
      return (
        String(candidate.real_sender_id) === "2" &&
        candidate.server_id != null &&
        message.includes("<refermsg>") &&
        title.test(message) &&
        target.test(message)
      );
    });
    return row ? String(row.server_id) : undefined;
  } catch {
    return undefined;
  }
}

async function findSentStickerMessageId(cli, chatId, md5) {
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
    "server_id,real_sender_id,message_kind,message_content",
  ]);
  if (result.code !== 0) return undefined;
  try {
    const payload = parseHistory(result.stdout);
    const row = payload.rows?.find(
      (candidate) =>
        String(candidate.real_sender_id) === "2" &&
        candidate.message_kind === "emoticon" &&
        candidate.server_id != null &&
        String(candidate.message_content ?? "")
          .toLowerCase()
          .includes(md5),
    );
    return row ? String(row.server_id) : undefined;
  } catch {
    return undefined;
  }
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
      video: "video",
      audio: "audio",
      file: "file",
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

async function recallTarget(cli, chatId, messageId) {
  const result = await run(cli, [
    "history",
    chatId,
    "--limit",
    "100",
    "--json",
    "--no-transcribe",
    "--fields",
    "server_id,local_id,real_sender_id,create_time,message_kind,message_content",
  ]);
  if (result.code !== 0) throw new Error("WeChat recall target is unavailable");
  const row = parseHistory(result.stdout).rows?.find(
    (candidate) => String(candidate.server_id) === String(messageId),
  );
  if (!row) throw new Error("WeChat recall target was not found in history");
  if (String(row.real_sender_id) !== "2")
    throw new Error("WeChat can only recall a message sent by this account");
  return row;
}

async function waitForRecallHistory(cli, chatId, messageId, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await run(cli, [
      "history",
      chatId,
      "--since",
      "3 minutes ago",
      "--limit",
      "30",
      "--json",
      "--no-transcribe",
      "--fields",
      "server_id,message_kind,message_content,display_text",
    ]);
    if (result.code === 0) {
      const rows = parseHistory(result.stdout).rows ?? [];
      if (
        rows.some(
          (row) =>
            (row.message_kind === "recalled" &&
              String(row.server_id) === String(messageId)) ||
            (["recalled", "system"].includes(row.message_kind) &&
              [row.message_content, row.display_text].some((value) =>
                String(value ?? "").includes(String(messageId)),
              )),
        )
      )
        return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function confirmAlreadyRead(cli, chatId) {
  const result = await run(cli, ["unread", "--json"]);
  if (result.code !== 0)
    return {
      deliveredVerified: false,
      reason: "WeChat unread state is unavailable",
    };
  try {
    const payload = JSON.parse(result.stdout || "{}");
    const row = payload.rows?.find((item) => item.username === chatId);
    if (!row || Number(row.unread_count) === 0)
      return { deliveredVerified: true };
    return {
      deliveredVerified: false,
      reason: `WeChat still reports ${row.unread_count} unread item(s)`,
    };
  } catch {
    return {
      deliveredVerified: false,
      reason: "WeChat unread state was invalid",
    };
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
    const mentions = (request.mentions ?? []).map((mention) =>
      requireString(mention, "mention"),
    );
    const argsFor = (body) => {
      const args = ["send", body, "--wxid", chatId, "--json"];
      for (const mention of mentions) args.push("--mention", mention);
      return args;
    };

    if (request.replyTo) {
      if (
        process.env.POLYMUX_WECHAT_WIRE_NATIVE !== "1" ||
        mentions.length > 0
      ) {
        // Without the native wire injector there is no refermsg packet, but a
        // reply must still be deliverable. The same is true for a reply with
        // mentions: the exact-build refermsg request cannot encode WeChat's
        // at-user list yet, while wechat-use can. Preserve the quote as painted
        // context rather than silently dropping the mention.
        let painted = String(request.fallbackBody ?? "").trim();
        if (!painted) {
          const target = await replyTarget(cli, chatId, request.replyTo);
          const sender = String(
            target.sender_name ?? target.sender_wxid ?? "Earlier message",
          ).trim();
          painted = `↳ ${sender || "Earlier message"}: ${target.quoted}\n${authored}`;
        }
        const delivery = parseCliResult(await runCliSend(cli, argsFor(painted)));
        if (delivery.deliveredVerified && !delivery.messageId) {
          const messageId = await findSentTextMessageId(cli, chatId, painted);
          answer(messageId ? { ...delivery, messageId } : delivery);
        } else {
          answer(delivery);
        }
        return;
      }
      const [historyTarget, identity] = await Promise.all([
        replyTarget(cli, chatId, request.replyTo).catch(() => null),
        accountIdentity(cli),
      ]);
      const context = request.replyContext;
      const target = historyTarget ??
        (context &&
        typeof context === "object" &&
        String(context.body ?? "").trim()
          ? {
              create_time: Math.max(1, Number(context.createTime) || Math.floor(Date.now() / 1000)),
              sender_name: String(context.sender ?? "").trim() || "Earlier message",
              quoted: String(context.body).trim(),
              message_kind: "text",
            }
          : null);
      if (!target)
        throw new Error("WeChat reply target was not found in history");
      const content = buildReplyXml({
        body: authored,
        chatId,
        createTime: target.create_time,
        displayName:
          target.sender_name ?? target.sender_wxid ?? identity.displayName,
        fromWxid: identity.wxid,
        messageId: request.replyTo,
        quotedBody: target.quoted,
        quotedType: quotedType(target.message_kind),
      });
      const delivery = await withPausedDaemon(cli, () =>
        sendTypedMessage({
          content,
          messageType: 49,
          recipient: chatId,
          userId: identity.wxid,
        }),
      );
      const messageId =
        delivery.messageId ??
        (await findSentReplyMessageId(
          cli,
          chatId,
          authored,
          request.replyTo,
        ));
      answer({
        deliveredVerified: true,
        messageId,
        clientMessageId: String(delivery.clientMessageId ?? "") || undefined,
      });
      return;
    }

    // A hidden WeChat restart leaves the daemon's Qt slot chain cold until a
    // person interacts with the native UI. The exact-build task route does not
    // depend on that UI state, and it owns daemon pause/detach itself. Mentions
    // stay on the CLI because the native route cannot encode at-user metadata.
    if (mentions.length === 0 && usesNativeTextTransport()) {
      const identity = await accountIdentity(cli);
      const delivery = await withPausedDaemon(cli, () =>
        sendTypedMessage({
          content: authored,
          messageType: 1,
          recipient: chatId,
          userId: identity.wxid,
        }),
      );
      // The profiled new-send task returns success only with WeChat's server
      // message id. Some desktop builds do not mirror low-level task sends
      // into their local SQLCipher history, so prefer an immediate local echo
      // when present and otherwise retain that server acknowledgement.
      const messageId =
        (await waitForSentTextMessageId(cli, chatId, authored, 2_000)) ??
        delivery.messageId;
      if (!messageId)
        throw new Error("WeChat did not acknowledge the native text message");
      answer({
        deliveredVerified: true,
        messageId,
        clientMessageId: String(delivery.clientMessageId ?? "") || undefined,
      });
      return;
    }

    // Portable fallback for installations without the exact-build task route.
    const delivery = parseCliResult(await runCliSend(cli, argsFor(authored)));
    if (delivery.deliveredVerified && !delivery.messageId) {
      const messageId = await findSentTextMessageId(cli, chatId, authored);
      answer(messageId ? { ...delivery, messageId } : delivery);
    } else {
      answer(delivery);
    }
    return;
  }

  if (request.kind === "media") {
    const mediaType = requireString(request.mediaType, "mediaType");
    if (!["image", "sticker", "file", "audio", "video"].includes(mediaType))
      throw new Error(`unknown WeChat media type ${mediaType}`);
    const stickerReference =
      mediaType === "sticker"
        ? requireString(request.emojiXml, "emojiXml")
        : undefined;
    if (mediaType !== "image") requireNativeWire(mediaType);
    const mediaPath = requireString(request.path, "path");
    const bytes = await readFile(mediaPath);

    if (mediaType === "audio") {
      const sinceEpoch = Math.floor(Date.now() / 1000) - 2;
      const [identity, voice] = await Promise.all([
        accountIdentity(cli),
        wechatVoice(bytes, request.name),
      ]);
      const delivery = await withPausedDaemon(cli, () =>
        sendNativeVoice({
          bytes: voice.bytes,
          durationMs: voice.durationMs,
          fromWxid: identity.wxid,
          recipient: chatId,
        }),
      );
      const messageId =
        delivery.messageId ??
        (await findSentMediaMessageId(
          cli,
          chatId,
          mediaType,
          voice.bytes,
          sinceEpoch,
        ));
      answer({
        deliveredVerified: true,
        messageId,
        clientMessageId: String(delivery.clientMessageId ?? "") || undefined,
      });
      return;
    }

    if (mediaType === "video") {
      const sinceEpoch = Math.floor(Date.now() / 1000) - 2;
      const [identity, video] = await Promise.all([
        accountIdentity(cli),
        wechatVideo(bytes, request.name),
      ]);
      const delivery = await withPausedDaemon(cli, () =>
        sendNativeVideo({
          bytes,
          durationSeconds: video.durationSeconds,
          fromWxid: identity.wxid,
          recipient: chatId,
          thumbnail: video.thumbnail,
        }),
      );
      const messageId =
        delivery.messageId ??
        (await findSentMediaMessageId(
          cli,
          chatId,
          mediaType,
          bytes,
          sinceEpoch,
        ));
      answer({
        deliveredVerified: true,
        messageId,
        clientMessageId: String(delivery.clientMessageId ?? "") || undefined,
      });
      return;
    }

    if (mediaType === "file") {
      const sinceEpoch = Math.floor(Date.now() / 1000) - 2;
      const identity = await accountIdentity(cli);
      const delivery = await withPausedDaemon(cli, () =>
        sendNativeFile({
          bytes,
          fileName: requireString(request.name, "name"),
          fromWxid: identity.wxid,
          recipient: chatId,
        }),
      );
      const messageId =
        delivery.messageId ??
        (await findSentMediaMessageId(
          cli,
          chatId,
          mediaType,
          bytes,
          sinceEpoch,
        ));
      answer({
        deliveredVerified: true,
        messageId,
        clientMessageId: String(delivery.clientMessageId ?? "") || undefined,
      });
      return;
    }

    if (mediaType === "sticker") {
      const reference = stickerReference;
      const expectedMd5 = stickerMd5(reference);
      const actualMd5 = createHash("md5").update(bytes).digest("hex");
      if (!expectedMd5 || expectedMd5 !== actualMd5)
        throw new Error(
          "WeChat sticker bytes do not match the native sticker reference",
        );
      const identity = await accountIdentity(cli);
      const delivery = await withPausedDaemon(cli, () =>
        sendNativeSticker({
          md5: actualMd5,
          recipient: chatId,
          userId: identity.wxid,
        }),
      );
      const messageId =
        delivery.messageId ??
        (await findSentStickerMessageId(cli, chatId, actualMd5));
      answer({ deliveredVerified: true, messageId });
      return;
    }

    if (
      process.env.POLYMUX_WECHAT_TEST_ONLY_FILEHELPER === "1" &&
      process.env.POLYMUX_WECHAT_ALLOW_FOCUSED_IMAGE_SEND !== "1"
    )
      throw new Error(
        "live File Transfer image sending requires POLYMUX_WECHAT_ALLOW_FOCUSED_IMAGE_SEND=1 after the chat is focused",
      );
    const sinceEpoch = Math.floor(Date.now() / 1000) - 2;
    const helper = await runCliSend(cli, [
      "send",
      requireString(request.name, "name"),
      "--image",
      mediaPath,
      "--wxid",
      chatId,
      "--json",
    ]);
    const messageId = cliExplicitlyFailed(helper)
      ? undefined
      : await findSentMediaMessageId(cli, chatId, mediaType, bytes, sinceEpoch);
    if (messageId) answer({ deliveredVerified: true, messageId });
    else answer(parseCliResult(helper));
    return;
  }

  if (request.kind === "read") {
    answer(await confirmAlreadyRead(cli, chatId));
    return;
  }
  if (request.kind === "recall") {
    requireNativeWire("recall");
    const messageId = requireString(request.messageId, "messageId");
    const suppliedClientMessageId = String(
      request.clientMessageId ?? request.client_message_id ?? "",
    ).trim();
    const [target, identity] = await Promise.all([
      suppliedClientMessageId
        ? Promise.resolve(null)
        : recallTarget(cli, chatId, messageId),
      accountIdentity(cli),
    ]);
    const clientMessageId = suppliedClientMessageId ||
      requireString(String(target?.local_id ?? ""), "local message id");
    await withPausedDaemon(cli, () =>
      recallNativeMessage({
        clientMessageId,
        fromWxid: identity.wxid,
        recipient: chatId,
        serverMessageId: messageId,
      }),
    );
    // A freshly injected native message can be recalled before WeChat has
    // indexed it into the queryable history database. Its native client id is
    // the exact target, and recallNativeMessage has already validated WeChat's
    // own success response. Older messages still use history for both ids and
    // the post-operation confirmation.
    if (!suppliedClientMessageId && !(await waitForRecallHistory(cli, chatId, messageId)))
      throw new Error("WeChat recall was not confirmed in history");
    answer({ deliveredVerified: true, messageId });
    return;
  }
  throw new Error("unknown WeChat writer operation");
}

main().catch((error) =>
  fail(error instanceof Error ? error.message : String(error)),
);
