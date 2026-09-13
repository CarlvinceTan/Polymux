import {execFile} from "node:child_process";
import {existsSync} from "node:fs";
import {homedir} from "node:os";
import path from "node:path";
import {promisify} from "node:util";
import type {PhoneDeviceDto, PhoneFrameDto, PhonePointDto, PhoneStatusDto} from "@polymux/protocol";

const execFileAsync = promisify(execFile);

interface AdbDevice {
  serial: string;
  state: string;
  model: string;
}

interface ResolvedAdbRoute {
  candidate: AdbDevice;
  hardwareSerial: string;
  osVersion: string;
  transport: PhoneDeviceDto["transport"];
}

export interface AndroidPhoneControllerOptions {
  platform?: NodeJS.Platform;
  resourcesDirectory?: string;
  adbPath?: string;
}

/** Android needs no companion app: ADB owns pairing/control and screencap gives
 * PhoneView a portable fallback while the smoother scrcpy stream is optional. */
export class AndroidPhoneController {
  readonly #platform: NodeJS.Platform;
  readonly #resourcesDirectory: string;
  readonly #adbOverride: string | null;
  #activeDeviceId: string | null = null;

  constructor(options: AndroidPhoneControllerOptions = {}) {
    this.#platform = options.platform ?? process.platform;
    this.#resourcesDirectory = options.resourcesDirectory ?? process.resourcesPath ?? path.join(process.cwd(), "resources");
    this.#adbOverride = options.adbPath ?? null;
  }

  async status(): Promise<PhoneStatusDto> {
    const adb = this.#adb();
    if (!adb) return unsupportedStatus();
    const devices = await this.#devices(adb);
    if (devices.length > 1) return statusDto(null, "error", "More than one Android phone is connected. Disconnect the others, then check again.");
    const device = devices[0] ?? null;
    if (!device) return statusDto(null, "disconnected", "Connect with USB, or pair from Android Wireless debugging.");
    if (device.pairingState !== "paired")
      return statusDto(device, "error", "Approve USB debugging on the Android phone, then check again.");
    const connected = this.#activeDeviceId === device.id;
    return statusDto(device, connected ? "connected" : "ready", connected ? null : "Ready to connect.");
  }

  async connect(): Promise<PhoneStatusDto> {
    const adb = this.#adb();
    if (!adb) throw new Error("This Polymux build does not include Android platform tools.");
    const devices = await this.#devices(adb);
    if (devices.length > 1) throw new Error("More than one Android phone is connected. Disconnect the others, then try again.");
    const device = devices[0];
    if (!device) throw new Error("Connect the Android phone with USB, or pair it from Wireless debugging.");
    if (device.pairingState !== "paired") throw new Error("Approve USB debugging on the Android phone first.");
    this.#activeDeviceId = device.id;
    return statusDto(device, "connected", null);
  }

  async stop(): Promise<PhoneStatusDto> {
    this.#activeDeviceId = null;
    return this.status();
  }

  async frame(): Promise<PhoneFrameDto> {
    const {adb, device} = await this.#connectedDevice();
    const png = await runBuffer(adb, ["-s", device.udid, "exec-out", "screencap", "-p"], 15_000);
    const {width, height} = pngDimensions(png);
    return {
      deviceId: device.id,
      dataUrl: `data:image/png;base64,${png.toString("base64")}`,
      width,
      height,
      capturedAt: new Date().toISOString(),
    };
  }

  async tap(point: PhonePointDto): Promise<void> {
    const {adb, device} = await this.#connectedDevice();
    await run(adb, ["-s", device.udid, "shell", "input", "tap", coordinate(point.x), coordinate(point.y)], 10_000);
  }

  async swipe(from: PhonePointDto, to: PhonePointDto, durationMs = 350): Promise<void> {
    const {adb, device} = await this.#connectedDevice();
    const duration = Math.max(100, Math.min(2_000, Math.round(durationMs)));
    await run(adb, [
      "-s", device.udid, "shell", "input", "swipe",
      coordinate(from.x), coordinate(from.y), coordinate(to.x), coordinate(to.y), String(duration),
    ], 10_000);
  }

  async type(text: string): Promise<void> {
    if (!text) return;
    if (text.length > 4_000) throw new Error("Phone text is limited to 4,000 characters.");
    const {adb, device} = await this.#connectedDevice();
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index])
        await run(adb, ["-s", device.udid, "shell", "input", "text", adbInputText(lines[index])], 10_000);
      if (index < lines.length - 1)
        await run(adb, ["-s", device.udid, "shell", "input", "keyevent", "KEYCODE_ENTER"], 10_000);
    }
  }

  async home(): Promise<void> {
    const {adb, device} = await this.#connectedDevice();
    await run(adb, ["-s", device.udid, "shell", "input", "keyevent", "KEYCODE_HOME"], 10_000);
  }

  async pair(pairingAddress: string, pairingCode: string, connectAddress?: string): Promise<PhoneStatusDto> {
    const adb = this.#adb();
    if (!adb) throw new Error("This Polymux build does not include Android platform tools.");
    if (!validAddress(pairingAddress)) throw new Error("Enter the IP address and pairing port shown by Android.");
    if (!/^\d{6}$/.test(pairingCode)) throw new Error("Enter the six-digit wireless debugging code.");
    const paired = await run(adb, ["pair", pairingAddress, pairingCode], 20_000);
    if (!/successfully paired/i.test(`${paired.stdout}\n${paired.stderr}`))
      throw new Error(lastLine(paired.stderr || paired.stdout) || "Android wireless pairing failed.");
    let target = connectAddress;
    if (!target) {
      for (let attempt = 0; attempt < 8 && !target; attempt += 1) {
        const services = await run(adb, ["mdns", "services"], 10_000)
          .catch((): {stdout: string; stderr: string} => ({stdout: "", stderr: ""}));
        target = parseAdbConnectAddress(services.stdout) ?? undefined;
        if (!target && attempt < 7) await delay(300);
      }
    }
    if (target) {
      if (!validAddress(target)) throw new Error("Enter the Android wireless debugging connection address.");
      const connected = await run(adb, ["connect", target], 15_000);
      if (!/connected to|already connected/i.test(`${connected.stdout}\n${connected.stderr}`))
        throw new Error(lastLine(connected.stderr || connected.stdout) || "Android wireless connection failed.");
    }
    const status = await this.status();
    if (!target && !status.device) {
      return {
        ...status,
        message: "Pairing succeeded, but Android discovery was blocked. Enter the separate connection address shown on Wireless debugging and pair again with a new code.",
      };
    }
    return status;
  }

  async close(): Promise<void> {
    this.#activeDeviceId = null;
  }

  async #connectedDevice(): Promise<{adb: string; device: PhoneDeviceDto}> {
    const adb = this.#adb();
    if (!adb) throw new Error("Android platform tools are unavailable.");
    const devices = await this.#devices(adb);
    const device = devices.find((candidate) => candidate.id === this.#activeDeviceId);
    if (!device || device.pairingState !== "paired") throw new Error("Connect the Android phone in Phone before controlling it.");
    return {adb, device};
  }

  async #devices(adb: string): Promise<PhoneDeviceDto[]> {
    const listing = parseAdbDevices((await run(adb, ["devices", "-l"], 10_000)).stdout);
    const routes = await Promise.all(listing.map(async (candidate): Promise<ResolvedAdbRoute> => {
      const paired = candidate.state === "device";
      const [version, hardwareSerial] = paired
        ? await Promise.all([
            run(adb, ["-s", candidate.serial, "shell", "getprop", "ro.build.version.release"], 8_000),
            run(adb, ["-s", candidate.serial, "shell", "getprop", "ro.serialno"], 8_000),
          ])
        : [{stdout: ""}, {stdout: candidate.serial}];
      return {
        candidate,
        hardwareSerial: hardwareSerial.stdout.trim() || candidate.serial,
        osVersion: version.stdout.trim(),
        transport: adbTransport(candidate.serial),
      };
    }));
    const grouped = new Map<string, ResolvedAdbRoute[]>();
    for (const route of routes) {
      const current = grouped.get(route.hardwareSerial) ?? [];
      current.push(route);
      grouped.set(route.hardwareSerial, current);
    }
    return [...grouped.entries()].map(([hardwareSerial, candidates]): PhoneDeviceDto => {
      // During guided wireless setup ADB intentionally lists the same physical
      // phone twice (USB serial + host:port). Prefer the authorized Wi-Fi route
      // so unplugging the cable does not redirect or terminate the session.
      candidates.sort((left, right) =>
        Number(right.candidate.state === "device") - Number(left.candidate.state === "device") ||
        Number(right.transport === "wireless") - Number(left.transport === "wireless"));
      const route = candidates[0];
      const paired = route.candidate.state === "device";
      const model = route.candidate.model || "Android phone";
      return {
        platform: "android",
        id: `android:${hardwareSerial}`,
        udid: route.candidate.serial,
        name: model,
        model,
        osVersion: route.osVersion,
        transport: route.transport,
        pairingState: paired ? "paired" : "unpaired",
        developerMode: paired,
        tunnelAddress: null,
      };
    });
  }

  #adb(): string | null {
    const executable = this.#platform === "win32" ? "adb.exe" : "adb";
    const androidHome = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
    const candidates = [
      this.#adbOverride,
      process.env.POLYMUX_ADB_PATH,
      path.join(this.#resourcesDirectory, "phone", "android", executable),
      path.join(this.#resourcesDirectory, "resources", "phone", "android", executable),
      androidHome ? path.join(androidHome, "platform-tools", executable) : null,
      this.#platform === "darwin" ? path.join(homedir(), "Library", "Android", "sdk", "platform-tools", executable) : null,
      this.#platform === "linux" ? path.join(homedir(), "Android", "Sdk", "platform-tools", executable) : null,
      this.#platform === "win32" && process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, "Android", "Sdk", "platform-tools", executable)
        : null,
      this.#platform === "darwin" ? "/opt/homebrew/bin/adb" : null,
      this.#platform !== "win32" ? "/usr/local/bin/adb" : null,
      this.#platform === "linux" ? "/usr/bin/adb" : null,
    ];
    return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate))) ?? null;
  }
}

export function parseAdbDevices(output: string): AdbDevice[] {
  return output.split(/\r?\n/).slice(1).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("*")) return [];
    const [serial, state, ...details] = trimmed.split(/\s+/);
    if (!serial || !state) return [];
    const model = details.map((entry) => /^model:(.+)$/.exec(entry)?.[1]).find(Boolean) ?? "";
    return [{serial, state, model: model.replace(/_/g, " ")}];
  });
}

export function pngDimensions(png: Buffer): {width: number; height: number} {
  if (png.length < 24 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    throw new Error("Android returned an invalid screenshot.");
  return {width: png.readUInt32BE(16), height: png.readUInt32BE(20)};
}

export function parseAdbConnectAddress(output: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    if (!line.includes("_adb-tls-connect._tcp")) continue;
    const match = /(\[[0-9a-f:]+\]:\d{1,5}|[a-z0-9._-]+:\d{1,5})\s*$/i.exec(line.trim());
    if (match) return match[1];
  }
  return null;
}

export function adbTransport(serial: string): PhoneDeviceDto["transport"] {
  return /:\d+$/.test(serial) ? "wireless" : "wired";
}

function statusDto(device: PhoneDeviceDto | null, stage: PhoneStatusDto["stage"], message: string | null): PhoneStatusDto {
  const running = stage === "connected";
  return {
    supported: true,
    stage,
    device,
    signing: {available: true, source: "none", expiresAt: null, teamId: null, message: null},
    wda: {available: false, installed: false, running: false, bundleId: null},
    controller: {kind: "adb", available: true, installed: true, running},
    message,
  };
}

function unsupportedStatus(): PhoneStatusDto {
  return {
    supported: false,
    stage: "unsupported",
    device: null,
    signing: {available: false, source: "none", expiresAt: null, teamId: null, message: null},
    wda: {available: false, installed: false, running: false, bundleId: null},
    controller: {kind: "adb", available: false, installed: false, running: false},
    message: "This Polymux build does not include Android platform tools.",
  };
}

async function run(file: string, args: string[], timeout: number): Promise<{stdout: string; stderr: string}> {
  try {
    return await execFileAsync(file, args, {timeout, maxBuffer: 8 * 1024 * 1024, encoding: "utf8"});
  } catch (reason) {
    const error = reason as Error & {stdout?: string; stderr?: string};
    throw new Error(lastLine(error.stderr ?? error.stdout ?? "") || error.message);
  }
}

async function runBuffer(file: string, args: string[], timeout: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    execFile(file, args, {timeout, maxBuffer: 32 * 1024 * 1024, encoding: "buffer"}, (error, stdout, stderr) => {
      if (error) {
        const detail = Buffer.isBuffer(stderr) ? stderr.toString("utf8") : String(stderr ?? "");
        reject(new Error(lastLine(detail) || error.message));
        return;
      }
      resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
    });
  });
}

function coordinate(value: number): string {
  if (!Number.isFinite(value) || value < 0) throw new Error("Phone coordinates must be positive numbers.");
  return String(Math.round(value));
}

function adbInputText(value: string): string {
  return value.replace(/%/g, "%25").replace(/ /g, "%s").replace(/([&|;<>()$`\\"'])/g, "\\$1");
}

function validAddress(value: string): boolean {
  return /^\[[0-9a-f:]+\]:\d{1,5}$/i.test(value) || /^[a-z0-9._-]+:\d{1,5}$/i.test(value);
}

function lastLine(output: string): string {
  return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1) ?? "";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
