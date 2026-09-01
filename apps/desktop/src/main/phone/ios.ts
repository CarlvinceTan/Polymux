import {spawn, type ChildProcessWithoutNullStreams} from "node:child_process";
import {execFile} from "node:child_process";
import {existsSync} from "node:fs";
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import path from "node:path";
import {promisify} from "node:util";
import {createHash} from "node:crypto";
import type {
  PhoneDeviceDto,
  PhoneFrameDto,
  PhoneIosSigningStatusDto,
  PhonePointDto,
  PhoneStatusDto,
} from "@polymux/protocol";
import {IosPhoneSigner, type IosPhoneSignerClient} from "./ios-signer.js";

const execFileAsync = promisify(execFile);
const WDA_PORT = 8100;
const RUNNER_APP = "WebDriverAgentRunner-Runner.app";

interface CoreDeviceJson {
  capabilities?: Array<{
    featureIdentifier?: unknown;
  }>;
  identifier?: unknown;
  connectionProperties?: {
    pairingState?: unknown;
    transportType?: unknown;
    tunnelIPAddress?: unknown;
    tunnelState?: unknown;
  };
  deviceProperties?: {
    developerModeStatus?: unknown;
    name?: unknown;
    osVersionNumber?: unknown;
  };
  hardwareProperties?: {
    marketingName?: unknown;
    platform?: unknown;
    reality?: unknown;
    udid?: unknown;
  };
}

export interface GoIosDevice {
  udid: string;
  productType: string;
  productVersion: string;
  transport: PhoneDeviceDto["transport"];
}

export interface ProvisioningProfile {
  ExpirationDate?: string;
  TeamIdentifier?: string[];
  ProvisionedDevices?: string[];
  CertificateHashes?: string[];
}

interface SigningIdentity {
  hash: string;
  name: string;
}

interface InstallationReceipt {
  appFingerprint: string;
  bundleId: string;
  deviceUdid: string;
}

interface WdaSourceMetadata {
  release?: unknown;
  archiveSha256?: unknown;
  patchLevel?: unknown;
  bundleId?: unknown;
}

class WdaRequestError extends Error {
  constructor(message: string, readonly code: string | null) {
    super(message);
    this.name = "WdaRequestError";
  }
}

export interface IosPhoneControllerOptions {
  dataDirectory: string;
  platform?: NodeJS.Platform;
  resourcesDirectory?: string;
  goIosPath?: string;
  iosHelperPath?: string;
  deviceHelperPath?: string;
  deviceHelperPythonPath?: string;
  deviceHelperTransport?: "auto" | "native" | "userspace";
  iproxyPath?: string;
  signer?: IosPhoneSignerClient;
  hostPrerequisite?: () => Promise<IosHostPrerequisite>;
}

export type IosHostPrerequisite = "ready" | "missing-apple-devices" | "missing-usbmuxd";

/**
 * A no-Xcode-runtime iPhone bridge. The WDA test bundle is prepared with an
 * locally provisioned Personal Team profile, installed through CoreDevice,
 * and launched directly. Apple Account secrets cross the private signer
 * helper over stdin and are never stored by this controller.
 */
export class IosPhoneController {
  readonly #dataDirectory: string;
  readonly #platform: NodeJS.Platform;
  readonly #resourcesDirectory: string;
  readonly #goIosOverride: string | null;
  readonly #iosHelperOverride: string | null;
  readonly #deviceHelperOverride: string | null;
  readonly #deviceHelperPythonOverride: string | null;
  readonly #deviceHelperTransport: "auto" | "native" | "userspace";
  readonly #iproxyOverride: string | null;
  readonly #signer: IosPhoneSignerClient;
  readonly #hostPrerequisite: () => Promise<IosHostPrerequisite>;
  #runner: ChildProcessWithoutNullStreams | null = null;
  #runnerOutput = "";
  #proxy: ChildProcessWithoutNullStreams | null = null;
  #proxyOutput = "";
  #proxyPort: number | null = null;
  #proxyDeviceKey: string | null = null;
  #sessionId: string | null = null;
  #sessionUrl: string | null = null;
  #sessionPromise: Promise<string> | null = null;
  #sessionPromiseUrl: string | null = null;
  #lifecycleTail: Promise<void> = Promise.resolve();
  #installedDeviceId: string | null = null;
  #goIosTunnel: ChildProcessWithoutNullStreams | null = null;
  #goIosTunnelOutput = "";
  #goIosTunnelPort: number | null = null;
  #goIosUserspacePort: number | null = null;
  #activeDevice: PhoneDeviceDto | null = null;
  #recentDevice: PhoneDeviceDto | null = null;
  #recentDeviceAt = 0;

  constructor(options: IosPhoneControllerOptions) {
    this.#dataDirectory = options.dataDirectory;
    this.#platform = options.platform ?? process.platform;
    this.#resourcesDirectory = options.resourcesDirectory ?? process.resourcesPath ?? path.join(process.cwd(), "resources");
    this.#goIosOverride = options.goIosPath ?? null;
    this.#iosHelperOverride = options.iosHelperPath ?? null;
    this.#deviceHelperOverride = options.deviceHelperPath ?? null;
    this.#deviceHelperPythonOverride = options.deviceHelperPythonPath ?? null;
    this.#deviceHelperTransport = options.deviceHelperTransport ?? "auto";
    this.#iproxyOverride = options.iproxyPath ?? null;
    this.#hostPrerequisite = options.hostPrerequisite ?? (() => detectIosHostPrerequisite(this.#platform));
    this.#signer = options.signer ?? new IosPhoneSigner({
      dataDirectory: options.dataDirectory,
      platform: this.#platform,
      resourcesDirectory: this.#resourcesDirectory,
    });
  }

  async iosSigningStatus(): Promise<PhoneIosSigningStatusDto> {
    return this.#signer.status();
  }

  async iosSigningBegin(email: string, password: string): Promise<PhoneIosSigningStatusDto> {
    return this.#signer.beginLogin(email, password);
  }

  async iosSigningComplete(code: string): Promise<PhoneIosSigningStatusDto> {
    return this.#signer.completeTwoFactor(code);
  }

  async iosSigningLogout(): Promise<PhoneIosSigningStatusDto> {
    return this.#signer.logout();
  }

  async status(): Promise<PhoneStatusDto> {
    if (this.#platform !== "darwin" && !this.#goIos() && !this.#iosHelper() && !this.#deviceHelper())
      return unsupportedStatus();
    const devices = await this.#devices();
    const selection = this.#selectEnumeratedDevice(devices);
    const device = selection.device ?? await this.#retainedActiveDevice();
    const ambiguous = selection.ambiguous;
    const source = this.#sourceApp();
    const signing = source && device
      ? await this.#signingStatus(source, device)
      : {
          available: false,
          source: "none" as const,
          expiresAt: null,
          teamId: null,
          message: source ? "Connect an iPhone to check its signing profile." : "WebDriverAgent is not available on this installation.",
        };
    const running = device
      ? await this.#isRunning(device, Boolean(this.#runner || this.#proxy)).catch(() => false)
      : false;
    const installed = Boolean(
      device &&
      (this.#installedDeviceId === device.id || await this.#isInstalled(device).catch(() => false)),
    );
    if (installed && device) this.#installedDeviceId = device.id;
    const disconnectedMessage = !device && !ambiguous
      ? iosDisconnectedMessage(await this.#hostPrerequisite().catch((): IosHostPrerequisite => "ready"))
      : null;
    return {
      supported: true,
      stage: !device
        ? "disconnected"
        : running
          ? "connected"
          : signing.available
            ? "ready"
            : "needs-signing",
      device,
      signing,
      wda: {
        available: Boolean(source),
        installed,
        running,
        bundleId: source ? await bundleIdentifier(source).catch((): null => null) : null,
      },
      controller: {kind: "wda", available: Boolean(source), installed, running},
      message: !device
        ? ambiguous
          ? "More than one iPhone is connected. Disconnect the others, then check again."
          : selection.activeMissing
            ? "The iPhone connected to Phone is unavailable. Reconnect it, or press Stop before choosing another iPhone."
            : disconnectedMessage
        : !signing.available
          ? signing.message
          : running
            ? null
            : "Ready to connect.",
    };
  }

  async connect(): Promise<PhoneStatusDto> {
    return this.#withLifecycle(() => this.#connect());
  }

  async #connect(): Promise<PhoneStatusDto> {
    if (this.#platform !== "darwin" && !this.#goIos() && !this.#iosHelper() && !this.#deviceHelper())
      throw new Error("This Polymux build does not include the iPhone device helper.");
    const devices = await this.#devices();
    const selection = this.#selectEnumeratedDevice(devices);
    if (!this.#activeDevice && devices.length > 1)
      throw new Error("More than one iPhone is connected. Disconnect the others, then try again.");
    const device = selection.device;
    if (!device) {
      if (selection.activeMissing)
        throw new Error("Reconnect the iPhone already connected to Phone, or press Stop before choosing another iPhone.");
      throw new Error("Connect and unlock your iPhone, then try again.");
    }
    if (!device.developerMode)
      throw new Error("Enable Developer Mode on the iPhone, restart it, and approve the confirmation.");
    if (device.pairingState !== "paired")
      throw new Error("Approve Trust This Computer on the iPhone first.");

    let source = this.#sourceApp();
    if (!source) throw new Error("This Polymux build does not include WebDriverAgent.");
    let signing = await this.#signingStatus(source, device);
    if (!signing.available) {
      const account = await this.#signer.status();
      if (account.stage !== "authenticated")
        throw new Error(signing.message ?? "Sign in with your Apple Account to prepare this iPhone.");
      const unsignedSource = this.#unsignedSourceApp();
      if (!unsignedSource) throw new Error("This Polymux build does not include the unsigned WebDriverAgent app.");
      const prepared = this.#preparedApp();
      await rm(prepared, {recursive: true, force: true});
      await this.#signer.signWda({
        source: unsignedSource,
        output: prepared,
        udid: device.udid,
        deviceName: device.name,
      });
      source = prepared;
      signing = await this.#signingStatus(source, device);
      if (!signing.available)
        throw new Error(signing.message ?? "The freshly prepared WebDriverAgent app could not be verified.");
    }

    const bundleId = await bundleIdentifier(source);
    const installedCurrent = await this.#installationCurrent(source, device, bundleId);
    if (!installedCurrent) {
      const prepared = await this.#prepare(source, device);
      await this.#installApp(device, prepared);
      await this.#writeInstallationReceipt(source, device, bundleId);
    }
    this.#installedDeviceId = device.id;
    await this.#start(device, bundleId);
    this.#activeDevice = device;
    return this.status();
  }

  async stop(): Promise<PhoneStatusDto> {
    return this.#withLifecycle(() => this.#stop());
  }

  async #stop(): Promise<PhoneStatusDto> {
    await this.#deleteSession().catch(() => {});
    const runner = this.#runner;
    if (runner && runner.exitCode === null && runner.signalCode === null) {
      runner.kill("SIGINT");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (runner.exitCode === null && runner.signalCode === null) runner.kill("SIGTERM");
          resolve();
        }, 1_500);
        runner.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    this.#runner = null;
    const devices = await this.#devices().catch((): PhoneDeviceDto[] => []);
    const selected = this.#selectEnumeratedDevice(devices);
    const device = selected.device ?? this.#activeDevice;
    const source = this.#sourceApp();
    if (device && source) {
      const executable = await bundleExecutable(source);
      await this.#terminateProcess(device, executable, await bundleIdentifier(source));
    }
    if (device) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        if (!await this.#isRunning(device).catch(() => false)) {
          await this.#stopProxy();
          await this.#stopGoIosTunnel();
          this.#activeDevice = null;
          return this.status();
        }
        await delay(200);
      }
      throw new Error("WebDriverAgent is still running on the iPhone. Try Stop phone control again.");
    }
    await this.#stopProxy();
    await this.#stopGoIosTunnel();
    this.#activeDevice = null;
    return this.status();
  }

  async #withLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#lifecycleTail;
    let release!: () => void;
    this.#lifecycleTail = new Promise<void>((resolve) => { release = resolve; });
    await previous.catch(() => {});
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async frame(): Promise<PhoneFrameDto> {
    return this.#withReadRecovery(async ({device, baseUrl: url}) => {
      const [screenshot, size] = await Promise.all([
        this.#withSession(url, (sessionId) => wdaRequest(url, `/session/${sessionId}/screenshot`)),
        this.#withSession(url, (sessionId) => wdaRequest(url, `/session/${sessionId}/window/size`)),
      ]);
      if (typeof screenshot.value !== "string") throw new Error("The iPhone did not return a screenshot.");
      const dimensions = size.value as {width?: unknown; height?: unknown} | null;
      const width = Number(dimensions?.width);
      const height = Number(dimensions?.height);
      if (!Number.isFinite(width) || !Number.isFinite(height))
        throw new Error("The iPhone returned an invalid screen size.");
      return {
        deviceId: device.id,
        dataUrl: screenshotDataUrl(screenshot.value),
        width,
        height,
        capturedAt: new Date().toISOString(),
      };
    });
  }

  async tap(point: PhonePointDto): Promise<void> {
    const {baseUrl: url} = await this.#connectedDevice();
    const x = finiteCoordinate(point.x, "x");
    const y = finiteCoordinate(point.y, "y");
    await this.#withSession(url, (sessionId) => wdaRequest(url, `/session/${sessionId}/actions`, {
      method: "POST",
      body: {
        actions: [{
          type: "pointer",
          id: "polymux-finger",
          parameters: {pointerType: "touch"},
          actions: [
            {type: "pointerMove", duration: 0, x, y, origin: "viewport"},
            {type: "pointerDown", button: 0},
            {type: "pause", duration: 80},
            {type: "pointerUp", button: 0},
          ],
        }],
      },
    }));
  }

  async swipe(from: PhonePointDto, to: PhonePointDto, durationMs = 350): Promise<void> {
    const {baseUrl: url} = await this.#connectedDevice();
    const start = {x: finiteCoordinate(from.x, "from.x"), y: finiteCoordinate(from.y, "from.y")};
    const end = {x: finiteCoordinate(to.x, "to.x"), y: finiteCoordinate(to.y, "to.y")};
    const duration = Math.max(100, Math.min(2_000, Math.round(durationMs)));
    await this.#withSession(url, (sessionId) => wdaRequest(url, `/session/${sessionId}/actions`, {
      method: "POST",
      body: {
        actions: [{
          type: "pointer",
          id: "polymux-finger",
          parameters: {pointerType: "touch"},
          actions: [
            {type: "pointerMove", duration: 0, ...start, origin: "viewport"},
            {type: "pointerDown", button: 0},
            {type: "pointerMove", duration, ...end, origin: "viewport"},
            {type: "pointerUp", button: 0},
          ],
        }],
      },
    }));
  }

  async type(text: string): Promise<void> {
    if (!text) return;
    if (text.length > 4_000) throw new Error("Phone text is limited to 4,000 characters.");
    const {baseUrl: url} = await this.#connectedDevice();
    await this.#withSession(url, (sessionId) => wdaRequest(url, `/session/${sessionId}/keys`, {
      method: "POST",
      body: {value: [...text]},
    }));
  }

  async home(): Promise<void> {
    const {baseUrl: url} = await this.#connectedDevice();
    await wdaRequest(url, "/wda/homescreen", {method: "POST", body: {}});
  }

  async close(): Promise<void> {
    await this.stop().catch(() => {});
    await this.#signer.close().catch(() => {});
  }

  async #devices(): Promise<PhoneDeviceDto[]> {
    if (this.#recentDevice && Date.now() - this.#recentDeviceAt < 30_000)
      return [this.#recentDevice];
    if (this.#platform === "darwin") {
      try {
        const result = await deviceCtlJson(["list", "devices", "--timeout", "5"]);
        const devices = ((result as {result?: {devices?: unknown}}).result?.devices ?? []) as unknown;
        const connected = parseCoreDevices(devices);
        if (connected.length) return this.#rememberDevices(connected);
      } catch {
        // No Xcode/CoreDevice installation: use the bundled open-source helper.
      }
    }
    const goIos = this.#goIos();
    const helper = this.#iosHelper();
    const enumerated = goIos
      ? await this.#goIosDevices(goIos)
      : helper
        ? await this.#helperDevices(helper)
        : [];
    const wireless = await this.#deviceHelperWirelessDevices().catch((): PhoneDeviceDto[] => []);
    const merged = new Map(enumerated.map((device) => [device.udid, device]));
    for (const device of wireless) {
      const existing = merged.get(device.udid);
      merged.set(device.udid, existing ? {...existing, transport: "wireless"} : device);
    }
    const devices = [...merged.values()];
    if (devices.length) return this.#rememberDevices(devices);
    if (this.#recentDevice && Date.now() - this.#recentDeviceAt < 30_000)
      return [{...this.#recentDevice, transport: "wireless"}];
    return [];
  }

  #rememberDevices(devices: PhoneDeviceDto[]): PhoneDeviceDto[] {
    if (devices.length === 1) {
      this.#recentDevice = devices[0];
      this.#recentDeviceAt = Date.now();
    }
    return devices;
  }

  async #deviceHelperWirelessDevices(): Promise<PhoneDeviceDto[]> {
    const runtime = this.#deviceHelper();
    if (!runtime) return [];
    const pairingDirectory = path.join(this.#dataDirectory, "phone", "ios", "remote-pairing");
    if (!existsSync(pairingDirectory)) return [];
    const output = (await run(runtime.python, [
      runtime.helper,
      "discover-wireless",
      "--pairing-directory", pairingDirectory,
    ], 8_000)).stdout;
    return parseDeviceHelperWireless(output);
  }

  async #goIosDevices(goIos: string): Promise<PhoneDeviceDto[]> {
    const listArgs = this.#goIosTunnelPort
      ? [`--tunnel-info-port=${this.#goIosTunnelPort}`, "list", "--details"]
      : ["list", "--details"];
    const result = parseGoIosDevices((await run(goIos, listArgs, 8_000)).stdout);
    return Promise.all(result.map(async (candidate): Promise<PhoneDeviceDto> => {
      const read = async (key: string, domain?: string): Promise<unknown> => {
        const args = [`--udid=${candidate.udid}`, "lockdown", "get", key];
        if (domain) args.push(`--domain=${domain}`);
        return parseJsonValue((await run(goIos, args, 8_000)).stdout);
      };
      try {
        const [name, developerMode] = await Promise.all([
          read("DeviceName"),
          read("DeveloperModeStatus", "com.apple.security.mac.amfi").catch(() => false),
        ]);
        return {
          platform: "ios",
          id: `ios:${candidate.udid}`,
          udid: candidate.udid,
          name: typeof name === "string" ? name : "iPhone",
          model: candidate.productType || "iPhone",
          osVersion: candidate.productVersion,
          transport: candidate.transport,
          pairingState: "paired",
          developerMode: developerMode === true,
          tunnelAddress: null,
        };
      } catch {
        return {
          platform: "ios",
          id: `ios:${candidate.udid}`,
          udid: candidate.udid,
          name: "iPhone",
          model: candidate.productType || "iPhone",
          osVersion: candidate.productVersion,
          transport: candidate.transport,
          pairingState: "unpaired",
          developerMode: false,
          tunnelAddress: null,
        };
      }
    }));
  }

  async #helperDevices(helper: string): Promise<PhoneDeviceDto[]> {
    const [wiredOutput, wirelessOutput] = await Promise.all([
      run(helper, ["usbmux", "list", "--simple"], 8_000),
      run(helper, ["usbmux", "list", "--network", "--simple"], 8_000)
        .catch((): {stdout: string; stderr: string} => ({stdout: "[]", stderr: ""})),
    ]);
    const wired = parseStringArray(wiredOutput.stdout);
    const wireless = parseStringArray(wirelessOutput.stdout).filter((udid) => !wired.includes(udid));
    return Promise.all([
      ...wired.map((udid) => this.#helperDevice(helper, udid, "wired")),
      ...wireless.map((udid) => this.#helperDevice(helper, udid, "wireless")),
    ]);
  }

  async #helperDevice(
    helper: string,
    udid: string,
    transport: PhoneDeviceDto["transport"],
  ): Promise<PhoneDeviceDto> {
    const read = async (key: string, domain?: string): Promise<unknown> => {
      const args = ["lockdown", "get", "--udid", udid];
      if (transport === "wireless") args.push("--mobdev2");
      if (domain) args.push("--domain", domain);
      args.push("--key", key);
      return parseJsonValue((await run(helper, args, 8_000)).stdout);
    };
    try {
      // usbmux/lockdown is not reliably concurrent on Windows or macOS. Keep
      // these four narrow reads sequential instead of racing helper processes.
      const name = await read("DeviceName");
      const osVersion = await read("ProductVersion");
      const productType = await read("ProductType");
      const developerMode = await read("DeveloperModeStatus", "com.apple.security.mac.amfi").catch(() => false);
      return {
        platform: "ios",
        id: `ios:${udid}`,
        udid,
        name: typeof name === "string" ? name : "iPhone",
        model: typeof productType === "string" ? productType : "iPhone",
        osVersion: typeof osVersion === "string" ? osVersion : "",
        transport,
        pairingState: "paired",
        developerMode: developerMode === true,
        tunnelAddress: null,
      };
    } catch {
      return {
        platform: "ios",
        id: `ios:${udid}`,
        udid,
        name: "iPhone",
        model: "iPhone",
        osVersion: "",
        transport,
        pairingState: "unpaired",
        developerMode: false,
        tunnelAddress: null,
      };
    }
  }

  #iosHelper(): string | null {
    const executable = this.#platform === "win32" ? "polymux-ios-helper.exe" : "polymux-ios-helper";
    const candidates = [
      this.#iosHelperOverride,
      process.env.POLYMUX_IOS_HELPER_PATH,
      path.join(this.#resourcesDirectory, "phone", "ios", executable),
      path.join(this.#resourcesDirectory, "resources", "phone", "ios", executable),
    ];
    return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate))) ?? null;
  }

  #deviceHelper(): {python: string; helper: string} | null {
    const pythonExecutable = this.#platform === "win32" ? "python.exe" : "python3";
    const helperCandidates = [
      this.#deviceHelperOverride,
      process.env.POLYMUX_IOS_DEVICE_HELPER_PATH,
      path.join(this.#resourcesDirectory, "phone", "ios", "device", "helper.py"),
      path.join(this.#resourcesDirectory, "resources", "phone", "ios", "device", "helper.py"),
    ];
    const pythonCandidates = [
      this.#deviceHelperPythonOverride,
      process.env.POLYMUX_IOS_DEVICE_PYTHON_PATH,
      path.join(this.#resourcesDirectory, "phone", "ios", "device", "python", this.#platform === "win32" ? "" : "bin", pythonExecutable),
      path.join(this.#resourcesDirectory, "resources", "phone", "ios", "device", "python", this.#platform === "win32" ? "" : "bin", pythonExecutable),
      path.join(this.#resourcesDirectory, "phone", "ios", "signer", "python", this.#platform === "win32" ? "" : "bin", pythonExecutable),
      path.join(this.#resourcesDirectory, "resources", "phone", "ios", "signer", "python", this.#platform === "win32" ? "" : "bin", pythonExecutable),
    ];
    const helper = helperCandidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
    const python = pythonCandidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
    return helper && python ? {helper, python} : null;
  }

  #goIos(): string | null {
    const executable = this.#platform === "win32" ? "ios.exe" : "ios";
    const candidates = [
      this.#goIosOverride,
      process.env.POLYMUX_GO_IOS_PATH,
      path.join(this.#resourcesDirectory, "phone", "ios", "tools", executable),
      path.join(this.#resourcesDirectory, "resources", "phone", "ios", "tools", executable),
      path.join(this.#resourcesDirectory, "phone", "ios", executable),
      path.join(this.#resourcesDirectory, "resources", "phone", "ios", executable),
    ];
    return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate))) ?? null;
  }

  #iproxyExecutable(): string | null {
    const executable = this.#platform === "win32" ? "iproxy.exe" : "iproxy";
    const candidates = [
      this.#iproxyOverride,
      process.env.POLYMUX_IPROXY_PATH,
      path.join(this.#resourcesDirectory, "phone", "ios", executable),
      path.join(this.#resourcesDirectory, "resources", "phone", "ios", executable),
      this.#platform === "darwin" ? "/opt/homebrew/bin/iproxy" : null,
      this.#platform === "darwin" ? "/usr/local/bin/iproxy" : null,
    ];
    return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate))) ?? null;
  }

  #sourceApp(): string | null {
    const candidates = [
      process.env.POLYMUX_WDA_APP_PATH,
      this.#preparedApp(),
      path.join(this.#dataDirectory, "phone", "ios", "wda-runtime", "DerivedData", "Build", "Products", "Debug-iphoneos", RUNNER_APP),
      path.join(this.#resourcesDirectory, "phone", "ios", RUNNER_APP),
      path.join(this.#resourcesDirectory, "resources", "phone", "ios", RUNNER_APP),
    ];
    return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate))) ?? null;
  }

  #unsignedSourceApp(): string | null {
    const candidates = [
      process.env.POLYMUX_WDA_UNSIGNED_APP_PATH,
      path.join(this.#resourcesDirectory, "phone", "ios", RUNNER_APP),
      path.join(this.#resourcesDirectory, "resources", "phone", "ios", RUNNER_APP),
      path.join(this.#dataDirectory, "phone", "ios", "wda-runtime", "DerivedData", "Build", "Products", "Debug-iphoneos", RUNNER_APP),
    ];
    return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate))) ?? null;
  }

  #preparedApp(): string {
    return path.join(this.#dataDirectory, "phone", "ios", "prepared", RUNNER_APP);
  }

  #installationReceiptPath(): string {
    return path.join(this.#dataDirectory, "phone", "ios", "installation.json");
  }

  async #installationCurrent(source: string, device: PhoneDeviceDto, bundleId: string): Promise<boolean> {
    if (this.#installedDeviceId !== device.id && !await this.#isInstalled(device).catch(() => false)) return false;
    try {
      const receipt = JSON.parse(await readFile(this.#installationReceiptPath(), "utf8")) as InstallationReceipt;
      return receipt.bundleId === bundleId &&
        receipt.deviceUdid === device.udid &&
        receipt.appFingerprint === await appFingerprint(source);
    } catch {
      return false;
    }
  }

  async #writeInstallationReceipt(source: string, device: PhoneDeviceDto, bundleId: string): Promise<void> {
    const receipt: InstallationReceipt = {
      appFingerprint: await appFingerprint(source),
      bundleId,
      deviceUdid: device.udid,
    };
    const target = this.#installationReceiptPath();
    await mkdir(path.dirname(target), {recursive: true});
    await writeFile(target, `${JSON.stringify(receipt, null, 2)}\n`, {encoding: "utf8", mode: 0o600});
  }

  async #signingStatus(source: string, device: PhoneDeviceDto): Promise<PhoneStatusDto["signing"]> {
    if (path.resolve(source) === path.resolve(this.#preparedApp()) &&
        !await this.#preparedMatchesBundledWda(source))
      return missingSigning("WebDriverAgent was updated and needs one local re-sign.");
    const provision = path.join(source, "embedded.mobileprovision");
    if (!existsSync(provision)) return missingSigning("WebDriverAgent does not contain a provisioning profile.");
    const profile = await readProvisioningProfile(provision).catch((): null => null);
    if (!profile) return missingSigning("The WebDriverAgent provisioning profile could not be read.");
    const expiresAt = profile.ExpirationDate ? new Date(profile.ExpirationDate) : null;
    const teamId = profile.TeamIdentifier?.[0] ?? null;
    if (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now())
      return {available: false, source: "none", expiresAt: expiresAt?.toISOString() ?? null, teamId, message: "The local Apple signing profile has expired."};
    if (profile.ProvisionedDevices?.length && !profile.ProvisionedDevices.includes(device.udid))
      return {available: false, source: "none", expiresAt: expiresAt.toISOString(), teamId, message: "The local Apple signing profile does not include this iPhone."};
    if (this.#platform !== "darwin")
      return {available: true, source: "existing-profile", expiresAt: expiresAt.toISOString(), teamId, message: null};
    if (path.resolve(source) === path.resolve(this.#preparedApp())) {
      try {
        await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", source], 10_000);
        return {available: true, source: "existing-profile", expiresAt: expiresAt.toISOString(), teamId, message: null};
      } catch {
        return {available: false, source: "none", expiresAt: expiresAt.toISOString(), teamId, message: "The locally prepared WebDriverAgent signature is invalid."};
      }
    }
    const identities = parseSigningIdentities((await run("/usr/bin/security", ["find-identity", "-v", "-p", "codesigning"], 10_000)).stdout);
    if (!selectSigningIdentity(identities, teamId, profile.CertificateHashes))
      return {available: false, source: "none", expiresAt: expiresAt.toISOString(), teamId, message: "No matching Apple Development certificate is available on this Mac."};
    return {available: true, source: "existing-profile", expiresAt: expiresAt.toISOString(), teamId, message: null};
  }

  async #preparedMatchesBundledWda(prepared: string): Promise<boolean> {
    const bundled = this.#unsignedSourceApp();
    if (!bundled) return true;
    try {
      const [preparedMetadata, bundledMetadata] = await Promise.all([
        readFile(path.join(prepared, "WDA_SOURCE.json"), "utf8"),
        readFile(path.join(bundled, "WDA_SOURCE.json"), "utf8"),
      ]);
      return wdaSourceMetadataMatches(preparedMetadata, bundledMetadata);
    } catch {
      return false;
    }
  }

  async #prepare(source: string, device: PhoneDeviceDto): Promise<string> {
    const signing = await this.#signingStatus(source, device);
    if (!signing.available) throw new Error(signing.message ?? "A valid signing profile is required.");
    if (this.#platform !== "darwin") return source;
    const prepared = this.#preparedApp();
    if (path.resolve(source) === path.resolve(prepared)) return source;
    const identities = parseSigningIdentities((await run("/usr/bin/security", ["find-identity", "-v", "-p", "codesigning"], 10_000)).stdout);
    const profile = await readProvisioningProfile(path.join(source, "embedded.mobileprovision"));
    const identity = selectSigningIdentity(identities, signing.teamId, profile.CertificateHashes);
    if (!identity) throw new Error("No matching Apple Development certificate is available on this Mac.");

    await mkdir(path.dirname(prepared), {recursive: true});
    await rm(prepared, {recursive: true, force: true});
    await run("/usr/bin/ditto", [source, prepared], 30_000);
    await rm(path.join(prepared, "_CodeSignature"), {recursive: true, force: true});
    const frameworks = path.join(prepared, "Frameworks");
    for (const entry of await readdir(frameworks).catch((): string[] => [])) {
      if (entry.startsWith("XC")) await rm(path.join(frameworks, entry), {recursive: true, force: true});
    }

    const scratch = await mkdtemp(path.join(tmpdir(), "polymux-phone-sign-"));
    try {
      const entitlements = path.join(scratch, "entitlements.plist");
      await run("/usr/bin/codesign", ["--display", "--entitlements", entitlements, "--xml", source], 10_000);
      await run("/usr/bin/codesign", [
        "--force",
        "--sign", identity.hash,
        "--preserve-metadata=identifier,flags,runtime",
        "--entitlements", entitlements,
        prepared,
      ], 30_000);
      await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", prepared], 10_000);
    } finally {
      await rm(scratch, {recursive: true, force: true});
    }
    return prepared;
  }

  async #installApp(device: PhoneDeviceDto, appPath: string): Promise<void> {
    if (usesCoreDeviceTransport(this.#platform, device.id)) {
      await run("/usr/bin/xcrun", [
        "devicectl", "device", "install", "app",
        "--device", device.id,
        appPath,
      ], 90_000);
      return;
    }
    const deviceHelper = this.#deviceHelper();
    if (device.transport === "wireless" && deviceHelper) {
      const pairingDirectory = path.join(this.#dataDirectory, "phone", "ios", "remote-pairing");
      await run(deviceHelper.python, [
        deviceHelper.helper,
        "install-app",
        "--udid", device.udid,
        "--app", appPath,
        "--pairing-directory", pairingDirectory,
        "--transport", this.#deviceHelperTransport,
      ], 120_000);
      return;
    }
    const goIos = this.#goIos();
    if (goIos) {
      await run(goIos, [`--udid=${device.udid}`, "install", `--path=${appPath}`], 90_000);
      return;
    }
    const helper = this.#iosHelper();
    if (helper) {
      const args = ["apps", "install", "--developer", "--udid", device.udid];
      if (device.transport === "wireless") args.push("--mobdev2");
      args.push(appPath);
      await run(helper, args, 90_000);
      return;
    }
    throw new Error("No iPhone app installation route is available.");
  }

  async #start(device: PhoneDeviceDto, bundleId: string, force = false): Promise<void> {
    const deviceHelper = this.#deviceHelper();
    if (!force && await this.#isRunning(device, !deviceHelper).catch(() => false)) return;
    const previous = this.#runner;
    if (previous && previous.exitCode === null && previous.signalCode === null) {
      previous.kill("SIGINT");
      await Promise.race([new Promise<void>((resolve) => previous.once("exit", () => resolve())), delay(1_500)]);
    }
    if (deviceHelper) {
      await this.#startDeviceHelper(deviceHelper, device, bundleId);
      return;
    }
    await this.#restartProxy(device);
    this.#runnerOutput = "";
    const goIos = this.#goIos();
    const helper = this.#iosHelper();
    const command = goIos ?? helper ?? "/usr/bin/xcrun";
    const args = goIos
      ? this.#goIosArgs(device, [
          "runwda",
          `--bundleid=${bundleId}`,
          `--testrunnerbundleid=${bundleId}`,
          "--xctestconfig=WebDriverAgentRunner.xctest",
          `--env=USE_PORT=${WDA_PORT}`,
        ])
      : helper
        ? pymobileXcuiTestArgs(this.#platform, device, bundleId)
        : [
          "devicectl", "device", "process", "launch",
          "--device", device.id,
          "--terminate-existing",
          "--console",
          bundleId,
        ];
    const child = spawn(command, args, {
      env: goIos || helper ? process.env : {...process.env, DEVICECTL_CHILD_USE_PORT: String(WDA_PORT)},
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#runner = child;
    const append = (chunk: Buffer): void => {
      this.#runnerOutput = `${this.#runnerOutput}${chunk.toString("utf8")}`.slice(-16_000);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.once("exit", () => {
      if (this.#runner === child) this.#runner = null;
      this.#sessionId = null;
      this.#sessionUrl = null;
    });

    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      if (await this.#isRunning(device).catch(() => false)) return;
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(friendlyCommandError(lastUsefulLine(this.#runnerOutput) || "WebDriverAgent stopped before it was ready."));
      await delay(350);
    }
    child.kill("SIGINT");
    throw new Error(friendlyCommandError(lastUsefulLine(this.#runnerOutput) || "Timed out waiting for WebDriverAgent."));
  }

  async #startDeviceHelper(
    runtime: {python: string; helper: string},
    device: PhoneDeviceDto,
    bundleId: string,
  ): Promise<void> {
    await this.#stopProxy();
    await this.#stopGoIosTunnel();
    const pairingDirectory = path.join(this.#dataDirectory, "phone", "ios", "remote-pairing");
    await mkdir(pairingDirectory, {recursive: true, mode: 0o700});
    if (device.transport === "wired") {
      await run(runtime.python, [
        runtime.helper,
        "bootstrap-remote-pairing",
        "--udid", device.udid,
        "--pairing-directory", pairingDirectory,
      ], 20_000).catch(() => {
        // USB control remains useful even if the optional wireless bootstrap
        // is unavailable on an older device/runtime.
      });
    }

    const port = await availablePort();
    const key = `device-helper:${device.udid}`;
    const child = spawn(runtime.python, [
      runtime.helper,
      "run-wda",
      "--udid", device.udid,
      "--bundle-id", bundleId,
      "--local-port", String(port),
      "--pairing-directory", pairingDirectory,
      "--transport", this.#deviceHelperTransport,
    ], {
      env: {...process.env, PYTHONUTF8: "1", PYTHONDONTWRITEBYTECODE: "1"},
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#runner = child;
    this.#proxyPort = port;
    this.#proxyDeviceKey = key;
    this.#runnerOutput = "";
    const append = (chunk: Buffer): void => {
      this.#runnerOutput = `${this.#runnerOutput}${chunk.toString("utf8")}`.slice(-16_000);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.once("exit", () => {
      if (this.#runner === child) this.#runner = null;
      if (this.#proxyDeviceKey === key) {
        this.#proxyPort = null;
        this.#proxyDeviceKey = null;
      }
      this.#sessionId = null;
      this.#sessionUrl = null;
    });

    const url = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 35_000;
    while (Date.now() < deadline) {
      if (await probeWda(url).catch(() => false)) return;
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(friendlyCommandError(lastUsefulLine(this.#runnerOutput) || "iPhone control stopped before it was ready."));
      await delay(300);
    }
    child.kill("SIGINT");
    throw new Error(friendlyCommandError(lastUsefulLine(this.#runnerOutput) || "Timed out while starting iPhone control."));
  }

  async #connectionUrl(device: PhoneDeviceDto, startProxy = true): Promise<string | null> {
    const existing = this.#existingConnectionUrl(device);
    if (existing) return existing;
    if (startProxy && this.#iproxyExecutable()) {
      try {
        return await this.#ensureProxy(device);
      } catch {
        // A routable CoreDevice address remains a useful macOS fallback.
      }
    }
    return device.tunnelAddress ? baseUrl(device.tunnelAddress) : null;
  }

  #existingConnectionUrl(device: PhoneDeviceDto): string | null {
    const relayProcess = this.#proxyDeviceKey?.startsWith("device-helper:") ? this.#runner : this.#proxy;
    const proxyMatches = relayProcess && relayProcess.exitCode === null && relayProcess.signalCode === null &&
      this.#proxyPort && this.#proxyDeviceKey?.endsWith(`:${device.udid}`);
    if (proxyMatches) return `http://127.0.0.1:${this.#proxyPort}`;
    return device.tunnelAddress ? baseUrl(device.tunnelAddress) : null;
  }

  #selectEnumeratedDevice(devices: PhoneDeviceDto[]): {
    device: PhoneDeviceDto | null;
    activeMissing: boolean;
    ambiguous: boolean;
  } {
    const selection = selectPinnedIosDevice(devices, this.#activeDevice?.udid ?? null);
    if (this.#activeDevice && selection.device) {
      const previous = this.#activeDevice;
      this.#activeDevice = {
        ...selection.device,
        name: selection.device.name === "iPhone" ? previous.name : selection.device.name,
        model: selection.device.model === "iPhone" ? previous.model : selection.device.model,
        osVersion: selection.device.osVersion || previous.osVersion,
        pairingState: selection.device.pairingState === "paired" ? "paired" : previous.pairingState,
        developerMode: selection.device.developerMode || previous.developerMode,
        tunnelAddress: selection.device.tunnelAddress ?? previous.tunnelAddress,
      };
      selection.device = this.#activeDevice;
    }
    return selection;
  }

  async #retainedActiveDevice(): Promise<PhoneDeviceDto | null> {
    if (!this.#activeDevice) return null;
    const url = this.#existingConnectionUrl(this.#activeDevice);
    return url && await probeWda(url).catch(() => false) ? this.#activeDevice : null;
  }

  async #isRunning(device: PhoneDeviceDto, startProxy = true): Promise<boolean> {
    const url = await this.#connectionUrl(device, startProxy);
    return url ? probeWda(url) : false;
  }

  async #ensureProxy(device: PhoneDeviceDto): Promise<string> {
    const goIos = this.#goIos();
    if (goIos) return this.#ensureGoIosForward(goIos, device);
    const executable = this.#iproxyExecutable();
    if (!executable) throw new Error("The iPhone USB proxy is not available.");
    const key = `${device.transport}:${device.udid}`;
    if (this.#proxy && this.#proxy.exitCode === null && this.#proxy.signalCode === null &&
        this.#proxyPort && this.#proxyDeviceKey === key)
      return `http://127.0.0.1:${this.#proxyPort}`;
    await this.#stopProxy();
    const port = await availablePort();
    const args = ["-u", device.udid];
    if (device.transport === "wireless") args.unshift("-n");
    args.push(`${port}:${WDA_PORT}`);
    const child = spawn(executable, args, {stdio: ["pipe", "pipe", "pipe"]});
    this.#proxy = child;
    this.#proxyPort = port;
    this.#proxyDeviceKey = key;
    this.#proxyOutput = "";
    const append = (chunk: Buffer): void => {
      this.#proxyOutput = `${this.#proxyOutput}${chunk.toString("utf8")}`.slice(-4_000);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.once("exit", () => {
      if (this.#proxy !== child) return;
      this.#proxy = null;
      this.#proxyPort = null;
      this.#proxyDeviceKey = null;
    });
    await delay(120);
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(lastUsefulLine(this.#proxyOutput) || "The iPhone USB proxy stopped before it was ready.");
    return `http://127.0.0.1:${port}`;
  }

  async #ensureGoIosForward(goIos: string, device: PhoneDeviceDto): Promise<string> {
    await this.#ensureGoIosTunnel(goIos, device);
    const key = `go-ios:${device.transport}:${device.udid}`;
    if (this.#proxy && this.#proxy.exitCode === null && this.#proxy.signalCode === null &&
        this.#proxyPort && this.#proxyDeviceKey === key)
      return `http://127.0.0.1:${this.#proxyPort}`;
    await this.#stopProxy();
    const port = await availablePort();
    const args = this.#goIosArgs(device, ["forward", String(port), String(WDA_PORT)]);
    const child = spawn(goIos, args, {stdio: ["pipe", "pipe", "pipe"]});
    this.#proxy = child;
    this.#proxyPort = port;
    this.#proxyDeviceKey = key;
    this.#proxyOutput = "";
    const append = (chunk: Buffer): void => {
      this.#proxyOutput = `${this.#proxyOutput}${chunk.toString("utf8")}`.slice(-4_000);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.once("exit", () => {
      if (this.#proxy !== child) return;
      this.#proxy = null;
      this.#proxyPort = null;
      this.#proxyDeviceKey = null;
    });
    await delay(150);
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(lastUsefulLine(this.#proxyOutput) || "The iPhone port forward stopped before it was ready.");
    return `http://127.0.0.1:${port}`;
  }

  async #ensureGoIosTunnel(goIos: string, device: PhoneDeviceDto): Promise<void> {
    if (this.#goIosTunnel && this.#goIosTunnel.exitCode === null && this.#goIosTunnel.signalCode === null &&
        this.#goIosTunnelPort && await this.#goIosTunnelReady(goIos, device)) return;
    await this.#stopGoIosTunnel();
    this.#goIosTunnelPort = await availablePort();
    do this.#goIosUserspacePort = await availablePort();
    while (this.#goIosUserspacePort === this.#goIosTunnelPort);
    const pairingDirectory = path.join(this.#dataDirectory, "phone", "ios", "go-ios-pairing");
    await mkdir(pairingDirectory, {recursive: true});
    const child = spawn(goIos, [
      `--udid=${device.udid}`,
      `--tunnel-info-port=${this.#goIosTunnelPort}`,
      `--userspace-port=${this.#goIosUserspacePort}`,
      "tunnel", "start", "--userspace",
      `--pair-record-path=${pairingDirectory}`,
    ], {stdio: ["pipe", "pipe", "pipe"]});
    this.#goIosTunnel = child;
    this.#goIosTunnelOutput = "";
    const append = (chunk: Buffer): void => {
      this.#goIosTunnelOutput = `${this.#goIosTunnelOutput}${chunk.toString("utf8")}`.slice(-12_000);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.once("exit", () => {
      if (this.#goIosTunnel !== child) return;
      this.#goIosTunnel = null;
      this.#goIosTunnelPort = null;
      this.#goIosUserspacePort = null;
    });
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (await this.#goIosTunnelReady(goIos, device)) return;
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(friendlyCommandError(lastUsefulLine(this.#goIosTunnelOutput) || "The iPhone tunnel stopped before it was ready."));
      await delay(250);
    }
    await this.#stopGoIosTunnel();
    throw new Error(friendlyCommandError(lastUsefulLine(this.#goIosTunnelOutput) || "Timed out while creating the iPhone tunnel."));
  }

  async #goIosTunnelReady(goIos: string, device: PhoneDeviceDto): Promise<boolean> {
    if (!this.#goIosTunnelPort) return false;
    try {
      const output = await run(goIos, [
        `--tunnel-info-port=${this.#goIosTunnelPort}`,
        "tunnel", "ls",
      ], 2_000);
      const tunnels = JSON.parse(output.stdout) as Array<{udid?: unknown}>;
      return Array.isArray(tunnels) && tunnels.some((tunnel) => tunnel.udid === device.udid);
    } catch {
      return false;
    }
  }

  #goIosArgs(device: PhoneDeviceDto, command: string[]): string[] {
    const args = [`--udid=${device.udid}`];
    if (this.#goIosTunnelPort) args.push(`--tunnel-info-port=${this.#goIosTunnelPort}`);
    if (this.#goIosUserspacePort) args.push(`--userspace-port=${this.#goIosUserspacePort}`);
    return [...args, ...command];
  }

  async #stopGoIosTunnel(): Promise<void> {
    const child = this.#goIosTunnel;
    this.#goIosTunnel = null;
    this.#goIosTunnelPort = null;
    this.#goIosUserspacePort = null;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGINT");
    await Promise.race([new Promise<void>((resolve) => child.once("exit", () => resolve())), delay(1_000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }

  async #restartProxy(device: PhoneDeviceDto): Promise<string | null> {
    if (this.#proxyDeviceKey?.startsWith("device-helper:")) return null;
    await this.#stopProxy();
    return this.#connectionUrl(device, true);
  }

  async #stopProxy(): Promise<void> {
    const child = this.#proxy;
    this.#proxy = null;
    this.#proxyPort = null;
    this.#proxyDeviceKey = null;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGINT");
    await Promise.race([new Promise<void>((resolve) => child.once("exit", () => resolve())), delay(750)]);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }

  async #isInstalled(device: PhoneDeviceDto): Promise<boolean> {
    const source = this.#sourceApp();
    if (!source) return false;
    const bundleId = await bundleIdentifier(source).catch((): null => null);
    if (!bundleId) return false;
    if (usesCoreDeviceTransport(this.#platform, device.id)) {
      const result = await deviceCtlJson([
        "device", "info", "apps", "--device", device.id,
        "--bundle-id", bundleId,
        "--timeout", "5",
      ]);
      const apps = (result as {result?: {apps?: unknown[]}}).result?.apps;
      return Array.isArray(apps) && apps.length > 0;
    }
    const deviceHelper = this.#deviceHelper();
    if (device.transport === "wireless" && deviceHelper) {
      const pairingDirectory = path.join(this.#dataDirectory, "phone", "ios", "remote-pairing");
      const output = (await run(deviceHelper.python, [
        deviceHelper.helper,
        "query-app",
        "--udid", device.udid,
        "--bundle-id", bundleId,
        "--pairing-directory", pairingDirectory,
        "--transport", this.#deviceHelperTransport,
      ], 25_000)).stdout;
      return (JSON.parse(output) as {installed?: unknown}).installed === true;
    }
    const goIos = this.#goIos();
    if (goIos) {
      const result = JSON.parse((await run(goIos, [`--udid=${device.udid}`, "apps"], 20_000)).stdout) as Array<{CFBundleIdentifier?: unknown}>;
      return Array.isArray(result) && result.some((app) => app.CFBundleIdentifier === bundleId);
    }
    const helper = this.#iosHelper();
    if (helper) {
      const args = ["apps", "query", "--udid", device.udid];
      if (device.transport === "wireless") args.push("--mobdev2");
      args.push(bundleId);
      const result = JSON.parse((await run(helper, args, 15_000)).stdout) as Record<string, unknown>;
      return Boolean(result[bundleId]);
    }
    return false;
  }

  async #terminateProcess(device: PhoneDeviceDto, executable: string, bundleId: string): Promise<void> {
    if (usesCoreDeviceTransport(this.#platform, device.id)) {
      const result = await deviceCtlJson([
        "device", "info", "processes", "--device", device.id,
        "--timeout", "5",
      ]);
      const processes = (result as {result?: {runningProcesses?: unknown[]}}).result?.runningProcesses;
      if (!Array.isArray(processes)) return;
      const matches = processes.flatMap((candidate) => {
        if (!candidate || typeof candidate !== "object") return [];
        const process = candidate as {executable?: unknown; processIdentifier?: unknown};
        const location = typeof process.executable === "string" ? process.executable : "";
        const pid = Number(process.processIdentifier);
        return location.endsWith(`/${executable}`) && Number.isInteger(pid) && pid > 0 ? [pid] : [];
      });
      for (const pid of matches) {
        await run("/usr/bin/xcrun", [
          "devicectl", "device", "process", "terminate",
          "--device", device.id,
          "--pid", String(pid),
        ], 15_000);
      }
      return;
    }
    const goIos = this.#goIos();
    if (goIos) {
      await this.#ensureGoIosTunnel(goIos, device);
      await run(goIos, this.#goIosArgs(device, ["kill", bundleId]), 15_000).catch(() => {});
      return;
    }
    const helper = this.#iosHelper();
    if (helper) {
      const args = ["developer", "dvt", "pkill", "--udid", device.udid];
      args.push(this.#platform === "darwin" ? "--native" : "--userspace");
      if (device.transport === "wireless") args.push("--mobdev2");
      args.push(executable);
      await run(helper, args, 15_000).catch(() => {});
      return;
    }
  }

  async #connectedDevice(): Promise<{device: PhoneDeviceDto; baseUrl: string}> {
    const devices = await this.#devices();
    const selection = this.#selectEnumeratedDevice(devices);
    if (!this.#activeDevice && devices.length > 1)
      throw new Error("More than one iPhone is connected. Disconnect the others before controlling Phone.");
    const retained = selection.device ? null : await this.#retainedActiveDevice();
    const recoverableWireless = selection.activeMissing && this.#activeDevice && this.#deviceHelper()
      ? {...this.#activeDevice, transport: "wireless" as const}
      : null;
    const device = selection.device ?? retained ?? recoverableWireless;
    if (recoverableWireless) this.#activeDevice = recoverableWireless;
    if (!device) {
      if (selection.activeMissing)
        throw new Error("The iPhone connected to Phone is unavailable. Reconnect it, or press Stop before choosing another iPhone.");
      throw new Error("The iPhone is not connected.");
    }
    let url = await this.#connectionUrl(device, true);
    if (!url && this.#deviceHelper()) {
      const source = this.#sourceApp();
      const bundleId = source ? await bundleIdentifier(source).catch((): null => null) : null;
      if (!bundleId) throw new Error("WebDriverAgent is not available on this installation.");
      await this.#start(device, bundleId);
      url = await this.#connectionUrl(device, true);
    }
    if (!url) throw new Error("No connection route to the iPhone is available.");
    if (!await probeWda(url)) {
      url = await this.#restartProxy(device) ?? url;
      if (!await probeWda(url)) {
        const source = this.#sourceApp();
        const bundleId = source ? await bundleIdentifier(source) : null;
        if (!bundleId || (!this.#deviceHelper() && !await this.#isInstalled(device).catch(() => false)))
          throw new Error("Connect the iPhone in Phone before controlling it.");
        await this.#start(device, bundleId, true);
        url = await this.#connectionUrl(device, true) ?? url;
      }
    }
    if (!await probeWda(url)) throw new Error("WebDriverAgent did not reconnect to the iPhone.");
    return {device, baseUrl: url};
  }

  async #withReadRecovery<T>(
    operation: (connection: {device: PhoneDeviceDto; baseUrl: string}) => Promise<T>,
  ): Promise<T> {
    try {
      return await operation(await this.#connectedDevice());
    } catch (reason) {
      if (!isRecoverableTransportError(reason)) throw reason;
      this.#sessionId = null;
      this.#sessionUrl = null;
      await delay(1_000);
      return operation(await this.#connectedDevice());
    }
  }

  async #ensureSession(url: string): Promise<string> {
    if (this.#sessionId && this.#sessionUrl === url) return this.#sessionId;
    if (this.#sessionPromise && this.#sessionPromiseUrl === url) return this.#sessionPromise;
    if (this.#sessionPromise) await this.#sessionPromise.catch(() => {});
    if (this.#sessionId) await this.#deleteSession().catch(() => {});
    const attempt = this.#createSession(url);
    this.#sessionPromise = attempt;
    this.#sessionPromiseUrl = url;
    try {
      return await attempt;
    } finally {
      if (this.#sessionPromise === attempt) {
        this.#sessionPromise = null;
        this.#sessionPromiseUrl = null;
      }
    }
  }

  /** Keep one XCTest session alive for every PhoneView and agent client. If
   * iOS drops only the WebDriver session while WDA itself survives, recover
   * once without restarting the test runner (and without another PIN prompt). */
  async #withSession<T>(url: string, operation: (sessionId: string) => Promise<T>): Promise<T> {
    const sessionId = await this.#ensureSession(url);
    try {
      return await operation(sessionId);
    } catch (reason) {
      if (isRecoverableTransportError(reason)) {
        if (this.#sessionId === sessionId && this.#sessionUrl === url) {
          this.#sessionId = null;
          this.#sessionUrl = null;
        }
        throw reason;
      }
      if (!isInvalidSessionError(reason)) throw reason;
      if (this.#sessionId === sessionId && this.#sessionUrl === url) {
        this.#sessionId = null;
        this.#sessionUrl = null;
      }
      return operation(await this.#ensureSession(url));
    }
  }

  async #createSession(url: string): Promise<string> {
    const response = await wdaRequest(url, "/session", {
      method: "POST",
      body: {capabilities: {alwaysMatch: {shouldUseCompactResponses: true}}},
      timeoutMs: 20_000,
    });
    const sessionId = typeof response.sessionId === "string"
      ? response.sessionId
      : typeof (response.value as {sessionId?: unknown} | null)?.sessionId === "string"
        ? (response.value as {sessionId: string}).sessionId
        : null;
    if (!sessionId) throw new Error("The iPhone did not create an automation session.");
    // Session capabilities do not apply FBConfiguration settings when calling
    // WDA directly. Use WDA's settings route so screenshots are actually JPEG.
    await wdaRequest(url, `/session/${sessionId}/appium/settings`, {
      method: "POST",
      body: {settings: {
        shouldUseCompactResponses: true,
        screenshotQuality: 2,
      }},
    }).catch(async (reason) => {
      await wdaRequest(url, `/session/${sessionId}`, {method: "DELETE"}).catch(() => {});
      throw reason;
    });
    this.#sessionId = sessionId;
    this.#sessionUrl = url;
    return sessionId;
  }

  async #deleteSession(): Promise<void> {
    await this.#sessionPromise?.catch(() => {});
    const sessionId = this.#sessionId;
    const url = this.#sessionUrl;
    this.#sessionId = null;
    this.#sessionUrl = null;
    if (!sessionId || !url) return;
    await wdaRequest(url, `/session/${sessionId}`, {method: "DELETE"});
  }
}

export function parseCoreDevices(value: unknown): PhoneDeviceDto[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((candidate): candidate is CoreDeviceJson => Boolean(candidate && typeof candidate === "object"))
    .filter((candidate) => candidate.hardwareProperties?.platform === "iOS" && candidate.hardwareProperties?.reality === "physical")
    .filter((candidate) => candidate.connectionProperties?.tunnelState === "connected" || (
      candidate.connectionProperties?.pairingState === "paired" &&
      candidate.connectionProperties?.transportType === "localNetwork" &&
      candidate.capabilities?.some((capability) =>
        capability.featureIdentifier === "com.apple.coredevice.feature.connectdevice")
    ))
    .map((candidate): PhoneDeviceDto => ({
      platform: "ios",
      id: stringValue(candidate.identifier),
      udid: stringValue(candidate.hardwareProperties?.udid),
      name: stringValue(candidate.deviceProperties?.name) || "iPhone",
      model: stringValue(candidate.hardwareProperties?.marketingName) || "iPhone",
      osVersion: stringValue(candidate.deviceProperties?.osVersionNumber),
      transport: candidate.connectionProperties?.transportType === "wired" ? "wired" : "wireless",
      pairingState: candidate.connectionProperties?.pairingState === "paired" ? "paired" : "unpaired",
      developerMode: candidate.deviceProperties?.developerModeStatus === "enabled",
      tunnelAddress: stringValue(candidate.connectionProperties?.tunnelIPAddress) || null,
    }))
    .filter((device) => Boolean(device.id && device.udid));
}

export function usesCoreDeviceTransport(platform: NodeJS.Platform, deviceId: string): boolean {
  return platform === "darwin" && Boolean(deviceId) && !deviceId.startsWith("ios:");
}

export function parseDeviceHelperWireless(output: string): PhoneDeviceDto[] {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    return [];
  }
  const devices = (value as {devices?: unknown} | null)?.devices;
  if (!Array.isArray(devices)) return [];
  return devices.flatMap((candidate): PhoneDeviceDto[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const udid = stringValue((candidate as {udid?: unknown}).udid);
    if (!udid) return [];
    return [{
      platform: "ios",
      id: `ios:${udid}`,
      udid,
      name: "iPhone",
      model: "iPhone",
      osVersion: "",
      transport: "wireless",
      pairingState: "paired",
      developerMode: true,
      tunnelAddress: null,
    }];
  });
}

export function wdaSourceMetadataMatches(prepared: string, bundled: string): boolean {
  try {
    const left = JSON.parse(prepared) as WdaSourceMetadata;
    const right = JSON.parse(bundled) as WdaSourceMetadata;
    return ["release", "archiveSha256", "patchLevel", "bundleId"].every((key) => {
      const preparedValue = left[key as keyof WdaSourceMetadata];
      return preparedValue !== undefined && preparedValue === right[key as keyof WdaSourceMetadata];
    });
  } catch {
    return false;
  }
}

/** Normalises go-ios' stable JSON device list and collapses the USB and
 * network records emitted during a guided wireless handoff into one phone.
 * Prefer the network route so the cable can be removed without changing the
 * selected device. */
export function parseGoIosDevices(output: string): GoIosDevice[] {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    return [];
  }
  const candidates = (value as {deviceList?: unknown} | null)?.deviceList;
  if (!Array.isArray(candidates)) return [];
  const grouped = new Map<string, GoIosDevice[]>();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const device = candidate as Record<string, unknown>;
    const udid = stringValue(device.Udid);
    if (!udid) continue;
    const connection = stringValue(device.ConnectionType).toLowerCase();
    const current = grouped.get(udid) ?? [];
    current.push({
      udid,
      productType: stringValue(device.ProductType),
      productVersion: stringValue(device.ProductVersion),
      transport: connection === "usb" ? "wired" : "wireless",
    });
    grouped.set(udid, current);
  }
  return [...grouped.values()].map((routes) =>
    routes.find((route) => route.transport === "wireless") ?? routes[0]);
}

export function parseSigningIdentities(output: string): SigningIdentity[] {
  return output.split(/\r?\n/).flatMap((line) => {
    const match = /^\s*\d+\)\s+([A-F0-9]{40})\s+"(.+)"\s*$/.exec(line);
    return match ? [{hash: match[1], name: match[2]}] : [];
  });
}

export function selectSigningIdentity(
  identities: SigningIdentity[],
  teamId: string | null,
  certificateHashes: string[] = [],
): SigningIdentity | null {
  if (!identities.length) return null;
  const provisioned = new Set(certificateHashes.map((hash) => hash.toUpperCase()));
  const exact = identities.find((identity) => provisioned.has(identity.hash.toUpperCase()));
  if (exact) return exact;
  if (provisioned.size > 0) return null;
  if (!teamId) return identities[0] ?? null;
  return identities.find((identity) => identity.name.includes(`(${teamId})`)) ?? null;
}

async function readProvisioningProfile(file: string): Promise<ProvisioningProfile> {
  return parseProvisioningProfile(await readFile(file));
}

/** A mobileprovision is a CMS envelope whose payload is an XML plist. Reading
 * that payload directly avoids requiring macOS `security`/`plutil` merely to
 * validate an already signed, device-specific WDA bundle on Windows/Linux. */
export function parseProvisioningProfile(contents: Buffer | string): ProvisioningProfile {
  const source = typeof contents === "string" ? contents : contents.toString("utf8");
  const start = source.indexOf("<?xml");
  const end = source.indexOf("</plist>", start);
  if (start < 0 || end < 0) throw new Error("The provisioning profile has no XML payload.");
  const xml = source.slice(start, end + "</plist>".length);
  const scalar = (key: string, tag: "date" | "string"): string | undefined => {
    const match = new RegExp(`<key>${key}</key>\\s*<${tag}>([\\s\\S]*?)<\\/${tag}>`).exec(xml);
    return match ? decodeXml(match[1].trim()) : undefined;
  };
  const array = (key: string, tag: "string" | "data"): string[] => {
    const match = new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)<\\/array>`).exec(xml);
    if (!match) return [];
    return [...match[1].matchAll(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "g"))]
      .map((entry) => decodeXml(entry[1].trim()));
  };
  const certificates = array("DeveloperCertificates", "data");
  return {
    ExpirationDate: scalar("ExpirationDate", "date"),
    TeamIdentifier: array("TeamIdentifier", "string"),
    ProvisionedDevices: array("ProvisionedDevices", "string"),
    CertificateHashes: certificates.map((certificate) =>
      createHash("sha1").update(Buffer.from(certificate.replace(/\s/g, ""), "base64")).digest("hex").toUpperCase()),
  };
}

export function parseInfoPlistString(contents: Buffer | string, key: string): string {
  const source = typeof contents === "string" ? contents : contents.toString("utf8");
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`<key>${escapedKey}</key>\\s*<string>([\\s\\S]*?)<\\/string>`).exec(source);
  if (!match) throw new Error(`WebDriverAgent has no ${key}.`);
  return decodeXml(match[1].trim());
}

export function pymobileXcuiTestArgs(
  platform: NodeJS.Platform,
  device: Pick<PhoneDeviceDto, "udid" | "transport">,
  bundleId: string,
): string[] {
  const args = ["developer", "dvt", "xcuitest", platform === "darwin" ? "--native" : "--userspace"];
  if (device.transport === "wireless") args.push("--mobdev2");
  args.push("--udid", device.udid, "--env", `USE_PORT=${WDA_PORT}`, bundleId);
  return args;
}

function parseStringArray(output: string): string[] {
  const value = JSON.parse(output) as unknown;
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function parseJsonValue(output: string): unknown {
  return JSON.parse(output.trim());
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!port) throw new Error("Could not reserve a local iPhone port.");
  return port;
}

async function probeWda(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/status`, {signal: AbortSignal.timeout(1_500)});
    if (!response.ok) return false;
    const body = await response.json() as {value?: {ready?: unknown}};
    return body.value?.ready === true;
  } catch {
    return false;
  }
}

function isRecoverableTransportError(reason: unknown): boolean {
  if (reason instanceof WdaRequestError) return false;
  if (!(reason instanceof Error)) return false;
  return reason.name === "AbortError" ||
    /fetch failed|socket|connection|ECONNRESET|ECONNREFUSED|timed? out|terminated abruptly/i.test(reason.message);
}

async function bundleIdentifier(appPath: string): Promise<string> {
  const identifier = parseInfoPlistString(await readFile(path.join(appPath, "Info.plist")), "CFBundleIdentifier");
  if (!identifier) throw new Error("WebDriverAgent has no bundle identifier.");
  return identifier;
}

async function bundleExecutable(appPath: string): Promise<string> {
  const executable = parseInfoPlistString(await readFile(path.join(appPath, "Info.plist")), "CFBundleExecutable");
  if (!executable) throw new Error("WebDriverAgent has no executable name.");
  return executable;
}

async function appFingerprint(appPath: string): Promise<string> {
  const hash = createHash("sha256");
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, {withFileTypes: true});
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(appPath, absolute);
      hash.update(relative).update("\0");
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) hash.update(await readFile(absolute));
    }
  }
  await walk(appPath);
  return hash.digest("hex");
}

async function deviceCtlJson(args: string[]): Promise<unknown> {
  const scratch = await mkdtemp(path.join(tmpdir(), "polymux-phone-device-"));
  try {
    const output = path.join(scratch, "result.json");
    await run("/usr/bin/xcrun", ["devicectl", ...args, "--json-output", output], 30_000);
    return JSON.parse(await readFile(output, "utf8"));
  } finally {
    await rm(scratch, {recursive: true, force: true});
  }
}

async function run(file: string, args: string[], timeout: number): Promise<{stdout: string; stderr: string}> {
  try {
    return await execFileAsync(file, args, {timeout, maxBuffer: 8 * 1024 * 1024, encoding: "utf8"});
  } catch (reason) {
    const error = reason as Error & {stdout?: string; stderr?: string};
    const detail = lastUsefulLine(error.stderr ?? error.stdout ?? "") || error.message;
    throw new Error(friendlyCommandError(detail));
  }
}

async function wdaRequest(
  url: string,
  endpoint: string,
  options: {method?: "POST" | "DELETE"; body?: unknown; timeoutMs?: number} = {},
): Promise<{sessionId?: unknown; value?: unknown}> {
  const response = await fetch(`${url}${endpoint}`, {
    method: options.method ?? "GET",
    headers: options.body === undefined ? undefined : {"content-type": "application/json"},
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
  });
  const payload = await response.json().catch(() => ({})) as {sessionId?: unknown; value?: unknown};
  if (!response.ok) throw wdaRequestError(payload, `iPhone request failed (${response.status}).`);
  const error = payload.value as {error?: unknown; message?: unknown} | null;
  if (typeof error?.error === "string")
    throw new WdaRequestError(typeof error.message === "string" ? error.message : error.error, error.error);
  return payload;
}

function wdaRequestError(payload: {value?: unknown}, fallback: string): WdaRequestError {
  const value = payload.value as {error?: unknown; message?: unknown} | null;
  const message = typeof value?.message === "string" ? value.message : fallback;
  const code = typeof value?.error === "string" ? value.error : null;
  return new WdaRequestError(message, code);
}

function isInvalidSessionError(reason: unknown): boolean {
  if (!(reason instanceof WdaRequestError)) return false;
  return reason.code === "invalid session id" ||
    reason.code === "no such driver" ||
    /session has (?:either )?terminated|session.+not started/i.test(reason.message);
}

function baseUrl(address: string): string {
  return `http://${address.includes(":") ? `[${address}]` : address}:${WDA_PORT}`;
}

function finiteCoordinate(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a positive screen coordinate.`);
  return Math.round(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function lastUsefulLine(output: string): string {
  return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1) ?? "";
}

function friendlyCommandError(detail: string): string {
  if (/BSErrorCodeDescription\s*=\s*Locked|device.+locked/i.test(detail))
    return "Unlock the iPhone and leave its screen awake, then try again.";
  if (/developer mode.+disabled|DeveloperModeDisabled/i.test(detail))
    return "Enable Developer Mode on the iPhone, restart it, and approve the confirmation.";
  return detail;
}

export function windowsAppleMobileDeviceServiceInstalled(output: string): boolean {
  return /(?:SERVICE_NAME|DISPLAY_NAME)\s*:\s*Apple Mobile Device Service/i.test(output);
}

export function linuxUsbMuxdAvailable(exists: (candidate: string) => boolean = existsSync): boolean {
  return [
    "/var/run/usbmuxd",
    "/run/usbmuxd",
    "/usr/sbin/usbmuxd",
    "/usr/bin/usbmuxd",
    "/usr/local/sbin/usbmuxd",
    "/usr/local/bin/usbmuxd",
  ].some(exists);
}

export async function detectIosHostPrerequisite(platform: NodeJS.Platform): Promise<IosHostPrerequisite> {
  if (platform === "win32") {
    const service = await run("sc.exe", ["query", "Apple Mobile Device Service"], 4_000)
      .catch((): {stdout: string; stderr: string} => ({stdout: "", stderr: ""}));
    return windowsAppleMobileDeviceServiceInstalled(`${service.stdout}\n${service.stderr}`)
      ? "ready"
      : "missing-apple-devices";
  }
  if (platform === "linux" && !linuxUsbMuxdAvailable()) return "missing-usbmuxd";
  return "ready";
}

export function iosDisconnectedMessage(prerequisite: IosHostPrerequisite): string {
  if (prerequisite === "missing-apple-devices")
    return "For iPhone on Windows, install Apple Devices once, then connect and unlock it with USB.";
  if (prerequisite === "missing-usbmuxd")
    return "For iPhone on Linux, install usbmuxd once, then connect and unlock it with USB.";
  return "Connect and unlock your iPhone with USB.";
}

export function selectPinnedIosDevice(
  devices: PhoneDeviceDto[],
  activeUdid: string | null,
): {device: PhoneDeviceDto | null; activeMissing: boolean; ambiguous: boolean} {
  if (activeUdid) {
    const active = devices.find((candidate) => candidate.udid === activeUdid) ?? null;
    return {device: active, activeMissing: !active, ambiguous: false};
  }
  return {
    device: devices.length === 1 ? devices[0] : null,
    activeMissing: false,
    ambiguous: devices.length > 1,
  };
}

export function screenshotDataUrl(base64: string): string {
  const signature = Buffer.from(base64.slice(0, 32), "base64");
  if (signature.length >= 3 && signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff)
    return `data:image/jpeg;base64,${base64}`;
  if (signature.length >= 8 && signature.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return `data:image/png;base64,${base64}`;
  throw new Error("The iPhone returned an unsupported screenshot format.");
}

function missingSigning(message: string): PhoneStatusDto["signing"] {
  return {available: false, source: "none", expiresAt: null, teamId: null, message};
}

function unsupportedStatus(): PhoneStatusDto {
  return {
    supported: false,
    stage: "unsupported",
    device: null,
    signing: missingSigning("This Polymux build does not include the iPhone device helper."),
    wda: {available: false, installed: false, running: false, bundleId: null},
    controller: {kind: "wda", available: false, installed: false, running: false},
    message: "Install a Polymux build that includes iPhone support.",
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
