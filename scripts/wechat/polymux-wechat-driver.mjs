#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertWeChatNativeProfile,
  buildReplyXml,
  buildMessageSource,
  interruptNativeOperations,
  markNativeSessionRead,
  nativeServiceSession,
  renameNativeGroup,
  prepareComposerModel,
  recallNativeMessage,
  sendComposerMessage,
  sendNativeServiceText,
  sendNativeSticker,
  sendNativeVoice,
  sendTypedMessage,
  stickerMd5,
  wechatPid,
} from "./wechat-wire.mjs";
import {
  daemonStatusRunning,
  hasWeChatDaemonCaptureProcess,
  weChatDaemonCaptureProcessIds,
  settlePausedDaemonOperation,
  usesNativeTextTransport,
} from "./wechat-daemon-coordination.mjs";
import { sentMediaMessageId } from "./wechat-media-history.mjs";
import {loadDesktopFile, loadDesktopVideo, loadDesktopGroupInfo, loadDesktopMessageSource, loadDesktopReadStates, loadDesktopStickers, loadDesktopVoice} from "./wechat-desktop-store.mjs";
import {renameDesktopGroup, validateGroupRename} from "./wechat-group-rename.mjs";
import {weChatTestChatAllowed} from "./wechat-test-scope.mjs";
import {
  historyMessageId,
  hasMentionHistory,
  parseWeChatHistory as parseHistory,
  recallConfirmed,
  sentStickerMessageId,
  sentTextMessageId,
  xmlElementText,
} from "./wechat-message-history.mjs";

import {readLocalCommand} from "./wechat-local-reader.mjs";
import {storeRegistryPath} from "./wechat-account-registry.mjs";

const providerCli = () => process.env.POLYMUX_WECHAT_PROVIDER === "native" ? "polymux-native" : process.env.POLYMUX_WECHAT_CLI || "wechat-use";

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
      new URL("../../resources/native/bin/wechat-media-prepare", import.meta.url),
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
      throw new Error(converted.stderr || "video preparation failed");
    const metadata = JSON.parse(converted.stdout || "{}");
    const durationSeconds = Number(metadata.durationSeconds);
    if (!Number.isInteger(durationSeconds) || durationSeconds <= 0)
      throw new Error("video preparation returned an invalid duration");
    return {
      durationSeconds,
      thumbnail: await readFile(thumbnailPath),
    };
  } finally {
    await rm(directory, {force: true, recursive: true});
  }
}

function answer(value, exitCode = 0) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
  process.exitCode = exitCode;
}

function fail(reason, exitCode = 0, relayRecoverySafe = true, deliveryUnconfirmed = false) {
  answer({ deliveredVerified: false, reason,
    ...(deliveryUnconfirmed ? {deliveryUnconfirmed: true} : {}),
    ...(relayRecoverySafe ? {} : {relayRecoverySafe: false}),
  }, exitCode);
}

function deliveryUnconfirmed(reason) {
  return Object.assign(new Error(reason), {deliveryUnconfirmed: true});
}

function hasUnconfirmedDelivery(error) {
  return error?.deliveryUnconfirmed === true ||
    (error instanceof AggregateError && [...error.errors].some(hasUnconfirmedDelivery));
}

function nativeDetachUnconfirmed(error) {
  return error?.nativeDetachUnconfirmed === true ||
    (error instanceof AggregateError && [...error.errors].some(nativeDetachUnconfirmed));
}

function errorReason(error) {
  if (error instanceof AggregateError) {
    const causes = [...error.errors]
      .map((cause) => errorReason(cause))
      .filter(Boolean);
    return causes.length
      ? `${error.message}: ${causes.join("; ")}`
      : error.message;
  }
  return error instanceof Error ? error.message : String(error);
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
  if (executable === "polymux-native") {
    if (args[0] === "daemon" && args[1] === "status") return {code: 0, stdout: JSON.stringify({running: false}), stderr: ""};
    try { return {code: 0, stdout: JSON.stringify(await readLocalCommand(args)), stderr: ""}; }
    catch (error) { return {code: 1, stdout: "", stderr: errorReason(error)}; }
  }
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
  // Reject changed builds before any daemon stop, recovery, or debugger work.
  if (cli === "polymux-native") await assertWeChatNativeProfile();
  const status = await run(cli, ["daemon", "status"]);
  const processes = await daemonProcesses();
  const capturing = processes.code === 0 && hasWeChatDaemonCaptureProcess(processes.stdout);
  // An orphaned capture remains attached even when daemon status fails or
  // reports stopped. It still requires the owning helper's clean detach.
  const wasRunning = (status.code === 0 && daemonStatusRunning(status.stdout)) || capturing;
  coordinationTrace({phase: "pause", daemonRunning: status.code === 0 && daemonStatusRunning(status.stdout),
    capturePids: weChatDaemonCaptureProcessIds(processes.stdout)});
  const targetPid = await wechatPid();
  if (cli === "polymux-native" && process.env.POLYMUX_WECHAT_TARGET_PID === undefined) {
    const birth = await run("/bin/ps", ["-p", String(targetPid), "-o", "lstart=,comm="]);
    if (birth.code !== 0 || !birth.stdout.trim()) throw new Error("WeChat target identity is unavailable");
    process.env.POLYMUX_WECHAT_TARGET_PID = String(targetPid);
    process.env.POLYMUX_WECHAT_TARGET_IDENTITY = birth.stdout.trim();
  }
  const nativeState = await run("/bin/ps", ["-p", String(targetPid), "-o", "stat="]);
  if (nativeState.code !== 0 || !nativeState.stdout.trim())
    throw Object.assign(new Error("WeChat native process state is unavailable"), {
      nativeDetachUnconfirmed: true,
    });
  const targetStopped = nativeState.code === 0 && /[TXt]/.test(nativeState.stdout.trim());
  if (cli === "polymux-native" && (wasRunning || targetStopped))
    throw new Error("Another WeChat integration is attached or WeChat is paused. Close that integration and reopen WeChat.");
  if (wasRunning || targetStopped) {
    // A daemon can leave WeChat SIGSTOP'd even after LLDB disappears. Always
    // ask the provider to resume its exact pinned target as well as detach;
    // `daemon stop` alone is not a completed native-session recovery.
    const stopped = await run(cli, ["unfreeze", "--pid", String(targetPid)]);
    coordinationTrace({phase: "stop", method: "unfreeze", code: stopped.code});
    if (stopped.code !== 0)
      throw Object.assign(new Error(stopped.stderr || "WeChat session did not recover"), {
        nativeDetachUnconfirmed: true,
      });
  }
  // A supervised relay may have begun stopping its daemon just before this
  // process asked for status. In that window status already says "stopped"
  // while LLDB/debugserver is still attached to WeChat; starting the native
  // task then makes one debugger kill the other. Always wait for the capture
  // tree to disappear, even when this writer was not the process that stopped
  // it.
  let result;
  let actionFailure;
  let actionStarted = false;
  try {
    await waitForDaemonCaptureState(false);
    if (await wechatPid() !== targetPid)
      throw Object.assign(new Error("WeChat changed during daemon cleanup"), {nativeDetachUnconfirmed: true});
    const recovered = await run("/bin/ps", ["-p", String(targetPid), "-o", "stat="]);
    if (recovered.code !== 0 || !recovered.stdout.trim() || /[TXtZ]/.test(recovered.stdout.trim()))
      throw Object.assign(new Error("WeChat is still stopped or attached after daemon cleanup"), {
        nativeDetachUnconfirmed: true,
      });
    actionStarted = true;
    result = await action();
  } catch (error) {
    if (actionStarted && nativeInjectorFailedBeforeReady(error)) {
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
  if (wasRunning && process.env.POLYMUX_WECHAT_RELAY_MANAGED !== "1") {
    try {
      if (nativeDetachUnconfirmed(actionFailure))
        throw new Error("WeChat daemon recovery is paused until the native debugger confirms a clean detach");
      // The initial wait can fail after daemon stop has succeeded. Try the
      // quiet gate again before restoring that service; never restart over a
      // capture tree which still has ownership of WeChat.
      if (!actionStarted) await waitForDaemonCaptureState(false);
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

async function withWriterIsolation(cli, action) {
  // Stopping the relay does not prove its separate daemon has detached.
  // The driver owns that last gate; the Hub owns restarting the relay.
  return await withPausedDaemon(cli, action);
}

async function withModelIsolation(cli, action) {
  // A resident listener avoids installing another injector, but does not
  // prove the provider's independent capture debugger has detached. The Hub
  // must be able to release its exact-target lease after preparation too.
  return await withPausedDaemon(cli, action);
}

function nativeInjectorFailedBeforeReady(error) {
  const detail = String(error?.message ?? error ?? "").toLowerCase();
  return (
    detail.includes("native task injector exited before ready") ||
    detail.includes("native task injector did not become ready") ||
    // Req2Buf observes the request map before installing any synthetic node
    // or encoding bytes. A busy map therefore means another ordinary WeChat
    // request won the race; retrying after the debugger releases the process
    // cannot duplicate this operation.
    detail.includes("wechat request map is busy")
  );
}

function coordinationTrace(value) {
  if (process.env.POLYMUX_WECHAT_READY_TRACE === "1")
    process.stderr.write(`[wechat coordination] ${JSON.stringify({...value, at: new Date().toISOString()})}\n`);
}

async function waitForDaemonCaptureState(running, timeoutMs = running ? 15_000 : 65_000) {
  const started = Date.now();
  let absentSince;
  let previousPids;
  while (Date.now() - started < timeoutMs) {
    const processes = await daemonProcesses();
    if (processes.code !== 0) throw new Error("WeChat debugger ownership is unavailable");
    const present = hasWeChatDaemonCaptureProcess(processes.stdout);
    const pids = JSON.stringify(weChatDaemonCaptureProcessIds(processes.stdout));
    if (pids !== previousPids) {
      coordinationTrace({phase: "detach wait", capturePids: JSON.parse(pids)});
      previousPids = pids;
    }
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
    // The capture watchdog gets its full 55-second clean-detach deadline.
    // The daemon owns detaching its debugger. Killing debugserver (including
    // as a descendant of LLDB) can terminate WeChat itself. If a clean detach
    // does not finish, refuse this operation instead of forcing the task port.
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

const HISTORY_FIELDS = "server_id,sender_wxid,create_time,message_kind,display_text,message_content,message_source,msg_source,mentionedIds,media";

async function recentHistory(cli, chatId, sinceEpoch) {
  const result = await run(cli, [
    "history", chatId, "--since", String(sinceEpoch), "--limit", "200",
    "--json", "--no-transcribe", "--fields", HISTORY_FIELDS,
  ]);
  if (result.code !== 0) throw new Error("WeChat delivery history is unavailable");
  return parseHistory(result.stdout).rows;
}

async function deliveryBoundary(cli, chatId, mentions = []) {
  const sinceEpoch = Math.floor(Date.now() / 1000) - 2;
  const rows = await recentHistory(cli, chatId, sinceEpoch);
  if (mentions.length && !hasMentionHistory(rows)) {
    const older = await recentHistory(cli, chatId, 0);
    if (!hasMentionHistory(older))
      throw new Error("The installed WeChat reader cannot verify native mentions; no message was sent");
  }
  const identity = await accountIdentity(cli, false);
  return {sinceEpoch, excludedIds: rows.map(historyMessageId).filter(Boolean), selfWxid: identity.wxid};
}

async function waitForSentTextMessageId(cli, chatId, expected, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const rows = await recentHistory(cli, chatId, expected.sinceEpoch).catch(() => []);
    const messageId = sentTextMessageId(rows, expected);
    if (messageId) return messageId;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return undefined;
}

async function replyTarget(cli, chatId, messageId, context) {
  const second = Number(context?.createTime);
  const minute = Math.floor(second / 60) * 60;
  const result = await run(cli, [
    "history",
    chatId,
    "--limit",
    Number.isFinite(second) && second > 0 ? "1000" : "100",
    ...(Number.isFinite(second) && second > 0 ? ["--since", String(minute), "--until", String(minute + 60)] : []),
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
    String(target.message_content ?? target.display_text ?? "")
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

async function accountIdentity(cli, withDisplayName = true) {
  const accounts = await run(cli, ["accounts", "--json"]);
  if (accounts.code !== 0)
    throw new Error("WeChat account identity is unavailable");
  const catalog = JSON.parse(accounts.stdout || "{}");
  const rows = Array.isArray(catalog.accounts) ? catalog.accounts : [];
  const account = Array.isArray(catalog.default)
    ? rows.find((row) => row.wxid === catalog.default[1] && (!row.bundle_id || row.bundle_id === catalog.default[0]))
    : rows.length === 1 ? rows[0] : null;
  const wxid = requireString(account?.wxid, "WeChat account wxid");
  if (!withDisplayName) return {displayName: wxid, wxid};
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

async function waitForSentStickerMessageId(cli, chatId, expected, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const rows = await recentHistory(cli, chatId, expected.sinceEpoch).catch(() => []);
    const messageId = sentStickerMessageId(rows, expected);
    if (messageId) return messageId;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return undefined;
}

async function findSentMediaMessageId(
  cli,
  chatId,
  mediaType,
  bytes,
  sinceEpoch,
  expectedName,
  boundary,
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
    "server_id,sender_wxid,create_time,message_kind,media",
  ]);
  if (result.code !== 0) return undefined;
  try {
    const payload = parseHistory(result.stdout);
    return sentMediaMessageId(payload.rows, {
      mediaType,
      bytes,
      sinceEpoch,
      expectedName,
      ...boundary,
    });
  } catch {
    return undefined;
  }
}

async function waitForSentMediaMessageId(
  cli,
  chatId,
  mediaType,
  bytes,
  sinceEpoch,
  expectedName,
  boundary,
  timeoutMs = 30_000,
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const messageId = await findSentMediaMessageId(
      cli, chatId, mediaType, bytes, sinceEpoch, expectedName, boundary,
    );
    if (messageId) return messageId;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return undefined;
}

async function recallTarget(cli, chatId, messageId, selfWxid) {
  const result = await run(cli, [
    "history",
    chatId,
    "--limit",
    "100",
    "--json",
    "--no-transcribe",
    "--fields",
    "server_id,local_id,sender_wxid,create_time,message_kind,message_content",
  ]);
  if (result.code !== 0) throw new Error("WeChat recall target is unavailable");
  const row = parseHistory(result.stdout).rows?.find(
    (candidate) => String(candidate.server_id) === String(messageId),
  );
  if (!row) throw new Error("WeChat recall target was not found in history");
  if (!selfWxid || row.sender_wxid !== selfWxid)
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
      if (recallConfirmed(rows, messageId)) return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function confirmAlreadyRead(accountWxid, chatId) {
  try {
    const rows = await loadDesktopReadStates({accountWxid});
    const row = rows.find((item) => item.chatId === chatId);
    if (!row) throw new Error("WeChat conversation is absent from native session state");
    if (row.unreadCount === 0 && !row.markedUnread)
      return { deliveredVerified: true };
    return {
      deliveredVerified: false,
      reason: row.markedUnread ? "WeChat still reports this conversation as marked unread" :
        `WeChat still reports ${row.unreadCount} unread item(s)`,
    };
  } catch (error) {
    return {
      deliveredVerified: false,
      reason: `WeChat unread state is unavailable: ${errorReason(error)}`,
    };
  }
}

async function readNativeMedia(cli, request) {
  const {chatId, serverId, localId, timestamp, kind} = request;
  if (typeof chatId !== "string" || !chatId || typeof serverId !== "string" ||
      !/^[1-9]\d{0,18}$/.test(serverId) || BigInt(serverId) > 9223372036854775807n ||
      !Number.isSafeInteger(timestamp) || timestamp <= 0 || timestamp > 253402300798 ||
      !["audio", "file", "video"].includes(kind) ||
      (request.localOnly !== undefined && typeof request.localOnly !== "boolean")) throw new Error("Invalid native media identity");
  if (!weChatTestChatAllowed(chatId)) return null;
  // Cached-page recovery never consults an external executable or registry,
  // even when the account's outbound transport still uses hybrid mode.
  if (request.localOnly) cli = "polymux-native";
  const identity = await accountIdentity(cli, false);
  const storeOptions = {accountWxid: identity.wxid, ...(cli === "polymux-native"
    ? {registryPath: process.env.POLYMUX_WECHAT_STORE_REGISTRY ?? storeRegistryPath()} : {})};
  const result = await run(cli, ["history", chatId,
    "--since", String(timestamp - 1), "--until", String(timestamp + 1),
    "--limit", "100", "--json", "--no-transcribe", "--fields",
    "server_id,local_id,create_time,message_kind,message_content,media"]);
  if (result.code !== 0) throw new Error("Native media history is unavailable");
  const rows = parseHistory(result.stdout).rows.filter(row => String(row.server_id) === serverId &&
    Number(row.create_time) === timestamp && (localId == null || String(row.local_id) === String(localId)));
  if (rows.length !== 1) return null;
  const row = rows[0];
  if (kind === "video" && row.message_kind === "video") {
    const media = await loadDesktopVideo(storeOptions, {chatId, serverId,
      localId:row.local_id, createTime:timestamp, md5:row.media?.md5, size:row.media?.length});
    return media ? {...media, ...(row.media?.durationMs ? {durationMs:row.media.durationMs} : {})} : null;
  }
  if (kind === "audio" && ["audio", "voice"].includes(row.message_kind)) {
    const bytes = await loadDesktopVoice(storeOptions, {
      chatId, serverId, localId: row.local_id, createTime: timestamp,
    });
    if (!bytes) return null;
    const silk = await import("silk-wasm");
    const decoded = await silk.decode(bytes, 24_000);
    if (!decoded.data.length || decoded.data.length > 8 * 1024 * 1024 || decoded.data.length % 2)
      throw new Error("Native voice could not be decoded");
    const wav = Buffer.alloc(44 + decoded.data.length);
    wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(24_000, 24); wav.writeUInt32LE(48_000, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36);
    wav.writeUInt32LE(decoded.data.length, 40); wav.set(decoded.data, 44);
    return {name: `wechat-${serverId}.wav`, mimeType: "audio/wav", size: wav.length,
      bodyBase64: wav.toString("base64"), durationMs: decoded.data.length / 48};
  }
  if (kind === "file" && ["file", "attachment"].includes(row.message_kind)) {
    const xml = String(row.message_content ?? "");
    if (xmlElementText(xml, "type") !== "6") return null;
    const name = xmlElementText(xml, "title");
    const file = await loadDesktopFile(storeOptions, {name,
      size: Number(xmlElementText(xml, "totallen")), md5: xmlElementText(xml, "md5"), createTime: timestamp});
    if (!file) return null;
    const mimeType = ({".mp4": "video/mp4", ".mov": "video/quicktime", ".pdf": "application/pdf",
      ".txt": "text/plain", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"})[path.extname(name).toLowerCase()] ?? "application/octet-stream";
    return {...file, name, mimeType};
  }
  return null;
}

async function main() {
  const operation = process.argv[2];
  if (!process.argv.includes("--json") || !["write", "ready", "compatibility", "stickers", "read-state", "read-media", "read-mentions", "group-info"].includes(operation))
    throw new Error(`Unsupported WeChat driver operation: ${String(operation).slice(0,40)}. Expected a supported operation and --json.`);

  if (operation === "compatibility") {
    try { await assertWeChatNativeProfile(); answer({supported: true}); }
    catch (error) { answer({supported: false, reason: errorReason(error)}); }
    return;
  }

  if (operation === "group-info") {
    const {chatId} = await readRequest();
    if (!weChatTestChatAllowed(chatId)) throw new Error("WeChat group is outside the selected test chats");
    const identity = await accountIdentity(providerCli(), false);
    answer({group: await loadDesktopGroupInfo({accountWxid: identity.wxid}, chatId)});
    return;
  }

  if (operation === "read-mentions") {
    const request = await readRequest();
    // Like read-media, an excluded test conversation has unavailable metadata.
    // Do not query it or turn every background import into a helper failure.
    if (!weChatTestChatAllowed(request.chatId)) { answer({mentionedIds: null}); return; }
    if (typeof request.chatId === "string" && !request.chatId.endsWith("@chatroom")) { answer({mentionedIds: []}); return; }
    const identity = await accountIdentity(providerCli(), false);
    const source = await loadDesktopMessageSource({accountWxid: identity.wxid}, request);
    const ids = source == null ? null : (xmlElementText(source, "atuserlist") ?? "")
      .split(",").map(id => id.trim()).filter(Boolean);
    if (ids?.some(id => !/^[A-Za-z0-9_-]+$/.test(id))) throw new Error("Unsupported native WeChat mention target");
    answer({mentionedIds: ids == null ? null : [...new Set(ids)]});
    return;
  }

  if (operation === "read-media") {
    answer({media: await readNativeMedia(providerCli(), await readRequest())});
    return;
  }

  // Readiness is intentionally a real native preparation, not a guessed
  // process check. It installs the resident model listener once, so the
  // following Hub send can use the same in-process channel without another
  // debugger attach. Session/login state is supplied separately by the
  // desktop helper; this operation never opens or focuses WeChat.
  if (operation === "ready") {
    const cli = providerCli();
    try {
      if (process.env.POLYMUX_WECHAT_PROVIDER === "native") {
        const identity = await accountIdentity(cli, false);
        answer({ready: await nativeServiceSession(identity.wxid)});
        return;
      }
      requireNativeWire("model preparation");
      const result = await withModelIsolation(cli, () => prepareComposerModel());
      answer({ready: result.prepared === true});
    } catch (error) {
      answer({
        ready: false,
        reason: errorReason(error),
        ...(nativeDetachUnconfirmed(error) ? {relayRecoverySafe: false} : {}),
      });
    }
    return;
  }

  if (operation === "read-state") {
    const identity = await accountIdentity(providerCli(), false);
    answer({sessions: await loadDesktopReadStates({accountWxid: identity.wxid})});
    return;
  }
  if (operation === "stickers") {
    const identity = await accountIdentity(providerCli());
    answer({stickers: await loadDesktopStickers({accountWxid: identity.wxid})});
    return;
  }

  const request = await readRequest();
  const cli = providerCli();
  if (request.kind === "prepare") {
    if (process.env.POLYMUX_WECHAT_PROVIDER === "native") {
      const identity = await accountIdentity(cli, false);
      answer({deliveredVerified: await nativeServiceSession(identity.wxid)});
      return;
    }
    requireNativeWire("model preparation");
    const result = await withModelIsolation(cli, () => prepareComposerModel());
    answer({deliveredVerified: result.prepared === true});
    return;
  }
  const chatId = requireString(request.chatId, "chatId");
  if (!weChatTestChatAllowed(chatId))
    throw new Error("live WeChat testing is restricted to the selected test chats");

  if (request.kind === "rename-group") {
    validateGroupRename(request);
    requireNativeWire("group renaming");
    const identity = await accountIdentity(cli, false);
    answer(await renameDesktopGroup(request, {
      read: () => loadDesktopGroupInfo({accountWxid: identity.wxid}, chatId),
      submit: renameNativeGroup,
      isolate: action => withWriterIsolation(cli, action),
    }));
    return;
  }

  if (request.kind === "text") {
    const authored = requireString(request.body, "body");
    const mentions = request.mentions ?? [];
    const messageSource = buildMessageSource(chatId, mentions);
    if ((request.replyTo || mentions.length) && !usesNativeTextTransport())
      throw new Error("native WeChat replies and mentions require the exact-build sender");
    if (request.replyTo) {
      const [historyTarget, identity] = await Promise.all([
        replyTarget(cli, chatId, request.replyTo, request.replyContext).catch(() => null),
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
              message_kind: String(context.kind ?? "text"),
              sender_wxid: String(context.senderId ?? ""),
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
        quotedSender: target.sender_wxid,
      });
      const boundary = await deliveryBoundary(cli, chatId, mentions);
      const delivery = await withWriterIsolation(cli, () =>
        sendTypedMessage({
          content,
          messageType: 49,
          recipient: chatId,
          userId: identity.wxid,
          messageSource,
        }),
      );
      const messageId = await waitForSentTextMessageId(cli, chatId, {
        ...boundary, body: authored, replyTo: request.replyTo, mentions,
        expectedMessageId: delivery.messageId,
      });
      if (!messageId)
        throw deliveryUnconfirmed("WeChat reply was not confirmed in history");
      answer({
        deliveredVerified: true,
        messageId,
        clientMessageId: String(delivery.clientMessageId ?? "") || undefined,
      });
      return;
    }

    if (mentions.length) {
      const identity = await accountIdentity(cli);
      const boundary = await deliveryBoundary(cli, chatId, mentions);
      const delivery = await withWriterIsolation(cli, () => sendTypedMessage({
        content: authored, messageType: 1, recipient: chatId,
        userId: identity.wxid, messageSource,
      }));
      const messageId = await waitForSentTextMessageId(cli, chatId, {
        ...boundary, body: authored, mentions, expectedMessageId: delivery.messageId,
      });
      if (!messageId) throw deliveryUnconfirmed("WeChat did not confirm the native mention in history");
      answer({deliveredVerified: true, messageId, clientMessageId: String(delivery.clientMessageId)});
      return;
    }

    // The independent provider uses Desktop's message service, which accepts
    // the recipient without selecting a chat or changing an existing draft.
    // Keep the established hybrid path until the remaining native media
    // operations have their own verified service adapters.
    if (mentions.length === 0 && usesNativeTextTransport()) {
      const boundary = await deliveryBoundary(cli, chatId);
      const native = process.env.POLYMUX_WECHAT_PROVIDER === "native";
      const identity = native ? await accountIdentity(cli, false) : null;
      // An already-loaded service runs on Desktop's own main queue. It
      // requires no debugger takeover, even if another read integration is
      // present. Only initialization crosses the exclusive attachment gate.
      // A connected but uncertain resident request never returns null.
      const resident = native ? await sendNativeServiceText({
        recipient: chatId, text: authored, userId: identity.wxid, residentOnly:true,
      }) : null;
      const delivery = resident ?? await withModelIsolation(cli, () => native
        ? sendNativeServiceText({recipient: chatId, text: authored, userId: identity.wxid})
        : sendComposerMessage({kind: "text", recipient: chatId, text: authored}));
      const messageId = await waitForSentTextMessageId(cli, chatId, {...boundary, body: authored});
      if (!messageId)
        throw deliveryUnconfirmed("WeChat text submission was not confirmed in history");
      answer({
        deliveredVerified: true,
        messageId,
        submitted: delivery.submitted === true,
      });
      return;
    }

    throw new Error(
      mentions.length
        ? "background-safe native WeChat mentions are not available yet"
        : "background-safe native WeChat text sending is unavailable",
    );
  }

  if (request.kind === "media") {
    const mediaType = requireString(request.mediaType, "mediaType");
    if (!["image", "sticker", "file", "audio", "video"].includes(mediaType))
      throw new Error(`unknown WeChat media type ${mediaType}`);
    const stickerReference =
      mediaType === "sticker"
        ? requireString(request.emojiXml, "emojiXml")
        : undefined;
    // Video is composed by the same exact-build model sender as images and
    // files; only voice and stickers still depend on the native wire sender.
    if (!["image", "video"].includes(mediaType)) requireNativeWire(mediaType);
    const mediaPath = requireString(request.path, "path");
    const bytes = await readFile(mediaPath);

    if (
      ["image", "file", "video"].includes(mediaType) &&
      !usesNativeTextTransport()
    )
      throw new Error(
        `background-safe native WeChat ${mediaType} sending requires the exact-build model sender`,
      );

    if (mediaType === "audio") {
      const sinceEpoch = Math.floor(Date.now() / 1000) - 2;
      const [identity, voice] = await Promise.all([
        accountIdentity(cli),
        wechatVoice(bytes, request.name),
      ]);
      const boundary = await deliveryBoundary(cli, chatId);
      const delivery = await withWriterIsolation(cli, () =>
        sendNativeVoice({
          bytes: voice.bytes,
          durationMs: voice.durationMs,
          fromWxid: identity.wxid,
          recipient: chatId,
        }),
      );
      const messageId = await waitForSentMediaMessageId(
        cli,
        chatId,
        mediaType,
        voice.bytes,
        sinceEpoch,
        request.name,
        {...boundary, expectedMessageId: delivery.messageId},
      );
      if (!messageId)
        throw deliveryUnconfirmed("WeChat voice submission was not confirmed in history");
      answer({
        deliveredVerified: true,
        messageId,
        clientMessageId: String(delivery.clientMessageId ?? "") || undefined,
      });
      return;
    }

    if (mediaType === "video") {
      // Reject malformed local media before it reaches WeChat. Otherwise the
      // composer silently degrades an unplayable clip to a plain file message.
      await wechatVideo(bytes, request.name);
    }

    if (["image", "file", "video"].includes(mediaType)) {
      const suppliedName = requireString(request.name, "name");
      const stagingDirectory = await mkdtemp(
        path.join(process.platform === "darwin" ? "/tmp" : tmpdir(),
          "polymux-wechat-model-media-"),
      );
      const baseName = path.basename(suppliedName).trim() ||
        `attachment${path.extname(mediaPath)}`;
      const stagedPath = path.join(stagingDirectory, baseName);
      const sinceEpoch = Math.floor(Date.now() / 1000) - 2;
      try {
        // Screen Capture, Matrix caches, and Polymux's data directory can be
        // outside WeChat's readable file boundary. A private /tmp copy gives
        // WeChat the same bytes without granting it broader filesystem access.
        await writeFile(stagedPath, bytes, {mode: 0o600});
        const boundary = await deliveryBoundary(cli, chatId);
        const delivery = await withModelIsolation(cli, () =>
          sendComposerMessage({
            kind: mediaType,
            path: stagedPath,
            recipient: chatId,
          }),
        );
        const messageId = await waitForSentMediaMessageId(
          cli,
          chatId,
          mediaType,
          bytes,
          sinceEpoch,
          suppliedName,
          boundary,
        );
        if (!messageId)
          throw deliveryUnconfirmed(
            `WeChat ${mediaType} submission was not confirmed in history`,
          );
        answer({
          deliveredVerified: true,
          messageId,
          submitted: delivery.submitted === true,
        });
      } finally {
        await rm(stagingDirectory, {force: true, recursive: true});
      }
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
      const boundary = await deliveryBoundary(cli, chatId);
      const delivery = await withWriterIsolation(cli, () =>
        sendNativeSticker({
          md5: actualMd5,
          recipient: chatId,
          userId: identity.wxid,
        }),
      );
      const messageId = await waitForSentStickerMessageId(
        cli,
        chatId,
        {...boundary, md5: actualMd5, expectedMessageId: delivery.messageId},
      );
      if (!messageId) {
        // A transport acknowledgement is not Desktop history parity. Preserve
        // its identity for diagnosis and distinguish uncertainty from a
        // rejection, which would invite the user to send a duplicate.
        answer({deliveredVerified: false, deliveryUnconfirmed: true, messageId: delivery.messageId,
          reason: "WeChat returned a sticker acknowledgement, but Desktop has not shown the message. Check this conversation before sending again."});
        return;
      }
      answer({ deliveredVerified: true, messageId });
      return;
    }

    throw new Error(`unsupported WeChat media type ${mediaType}`);
  }

  if (request.kind === "read") {
    const identity = await accountIdentity(cli, false);
    const initial = await confirmAlreadyRead(identity.wxid, chatId);
    if (initial.deliveredVerified || !initial.reason?.startsWith("WeChat still reports ")) {
      answer(initial);
      return;
    }
    requireNativeWire("unread clearing");
    await withWriterIsolation(cli, () => markNativeSessionRead(chatId));
    const deadline = Date.now() + 10_000;
    let result;
    do {
      result = await confirmAlreadyRead(identity.wxid, chatId);
      if (result.deliveredVerified) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    } while (Date.now() < deadline);
    answer(result);
    return;
  }
  if (request.kind === "recall") {
    requireNativeWire("recall");
    const messageId = requireString(request.messageId, "messageId");
    const suppliedClientMessageId = String(
      request.clientMessageId ?? request.client_message_id ?? "",
    ).trim();
    const identity = await accountIdentity(cli, false);
    const target = suppliedClientMessageId
      ? null : await recallTarget(cli, chatId, messageId, identity.wxid);
    const clientMessageId = suppliedClientMessageId ||
      requireString(String(target?.local_id ?? ""), "local message id");
    await withWriterIsolation(cli, () =>
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
    if (!(await waitForRecallHistory(cli, chatId, messageId)))
      throw new Error("WeChat recall was not confirmed in history");
    answer({ deliveredVerified: true, messageId });
    return;
  }
  throw new Error("unknown WeChat writer operation");
}

main().catch((error) =>
  fail(errorReason(error), 0, !nativeDetachUnconfirmed(error), hasUnconfirmedDelivery(error)),
);
