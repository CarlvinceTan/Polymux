function isCaptureDebugger(command) {
  return (
    /(?:^|\/)lldb(?:\s+|$)/.test(command) &&
    /\/wx-(?:cdn-capture|hijack)-daemon-[^/]+\/cmd\.lldb(?:\s|$)/.test(command)
  );
}

/** Parses `ps -ax -o pid=,ppid=,command=` without treating its own query as a
 * daemon. The command can contain arbitrary spaces, so only the numeric prefix
 * is structural. */
export function processRows(processTable) {
  return String(processTable)
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line))
    .filter(Boolean)
    .map((match) => ({
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      command: match[3],
    }));
}

/** Process ids owned by wechatd's background LLDB capture session, including
 * debugger children such as debugserver. The long-lived `wechatd run` service
 * is deliberately excluded: `daemon stop` disarms its debugger but keeps the
 * service alive so it can be armed again after the native writer detaches. */
export function weChatDaemonCaptureProcessIds(processTable) {
  const rows = processRows(processTable);
  const owned = new Set(
    rows
      .filter((row) => isCaptureDebugger(row.command))
      .map((row) => row.pid),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (!owned.has(row.pid) && owned.has(row.parentPid)) {
        owned.add(row.pid);
        changed = true;
      }
    }
  }
  return [...owned];
}

/** Process-table rows owned by wechatd's background LLDB capture session. */
export function hasWeChatDaemonCaptureProcess(processTable) {
  const source = String(processTable);
  const rows = processRows(source);
  if (rows.length > 0)
    return rows.some((row) => isCaptureDebugger(row.command));
  // Backward-compatible with callers and fixtures that supply commands only.
  return source.split("\n").some((line) => {
    const command = line.trim();
    return isCaptureDebugger(command);
  });
}

export function daemonStatusRunning(output) {
  return /\brunning\b[^\n]*\bpid=\d+\b/i.test(String(output));
}

export function recognisesDaemonStatus(output) {
  return /\b(?:daemon|running|stopped)\b|\bpid=\d+\b/i.test(String(output));
}

/** Plain text can use the exact-build native task route when the daemon's Qt
 * signal chain has not been warmed by a visible WeChat interaction. The wire
 * implementation still enforces its pinned WeChat binary profile before it
 * attaches, in addition to these two explicit runtime gates. */
export function usesNativeTextTransport(environment = process.env) {
  return (
    environment.POLYMUX_WECHAT_WIRE_NATIVE === "1" &&
    environment.POLYMUX_WECHAT_LLDB_EXPERIMENTAL === "1"
  );
}

/** Delivery acknowledgement belongs to the native operation, while daemon
 * restart is recovery for subsequent work. Never turn a verified send into a
 * reported failure merely because that recovery needs the relay's next retry.
 */
export function settlePausedDaemonOperation({
  actionFailure,
  restartFailure,
  result,
}) {
  if (actionFailure && restartFailure)
    throw new AggregateError(
      [actionFailure, restartFailure],
      "WeChat operation failed and the daemon did not restart",
    );
  if (actionFailure) throw actionFailure;
  return {result, restartFailure};
}
