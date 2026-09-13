import {execFile} from "node:child_process";
import {promisify} from "node:util";
import type {WeChatLoginDto} from "@polymux/protocol";
import {weChatAppProcessId} from "./wechat-app.js";

const run = promisify(execFile);
export const unavailableWeChatLogin = (): WeChatLoginDto => ({
  state: "unavailable", qrDataUrl: null, expiresAt: null, optionsReady: false,
});

export function parseWeChatLogin(value: unknown, capturedAt: number): WeChatLoginDto {
  if (!value || typeof value !== "object") return unavailableWeChatLogin();
  const data = value as Record<string, unknown>;
  if (data.ok !== true || !["signed_in", "signed_out", "remembered_login", "interactive_login", "locked", "launching", "unavailable"].includes(String(data.state)))
    return unavailableWeChatLogin();
  const qr = data.state === "interactive_login" && data.optionsReady === true && data.issue === undefined &&
    typeof data.qrDataUrl === "string" && data.qrDataUrl.length < 350_000 &&
    /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(data.qrDataUrl)
    ? data.qrDataUrl : null;
  return {state: data.state as WeChatLoginDto["state"], qrDataUrl: qr,
    expiresAt: qr ? capturedAt + 10_000 : null, optionsReady: data.optionsReady === true,
    ...(["interactive_login", "remembered_login"].includes(String(data.state)) &&
      (data.issue === "screen-recording" || data.issue === "qr-expired" || data.issue === "background-guard")
      ? {issue: data.issue} : {})};
}

/** Re-check process birth around the operation. Only the helper's QR crop is
 * returned; it is not persisted with conversation/status caches. */
export async function weChatLoginHidden(options: {
  helperPath: string;
  capture?: boolean;
  processId?: () => Promise<number | null>;
  run?: (file: string, args: string[], options: {timeout: number}) => Promise<{stdout: string; stderr: string}>;
}): Promise<WeChatLoginDto> {
  const execute = options.run ?? run;
  try {
    const pid = await (options.processId ?? weChatAppProcessId)();
    if (!pid) return unavailableWeChatLogin();
    const identity = async () => (await execute("/bin/ps", ["-p", String(pid), "-o", "lstart=,comm="], {timeout: 2_000})).stdout.trim();
    const before = await identity();
    if (!before) return unavailableWeChatLogin();
    const capturedAt = Date.now();
    const result = await execute(options.helperPath, [options.capture === false ? "--login-options" : "--login-snapshot", "--pid", String(pid)], {timeout: 25_000});
    if (await identity() !== before) return unavailableWeChatLogin();
    return parseWeChatLogin(JSON.parse(result.stdout), capturedAt);
  } catch {
    return unavailableWeChatLogin();
  }
}
