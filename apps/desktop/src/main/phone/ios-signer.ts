import {spawn, type ChildProcessWithoutNullStreams} from "node:child_process";
import {existsSync} from "node:fs";
import {chmod, mkdir} from "node:fs/promises";
import {createInterface, type Interface} from "node:readline";
import path from "node:path";
import type {PhoneIosSigningStatusDto} from "@polymux/protocol";

interface HelperResponse {
  id?: unknown;
  ok?: unknown;
  result?: unknown;
  error?: unknown;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(reason: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

interface SignWdaResult {
  bundleId: string;
  output: string;
  expiresAt: string | null;
  teamId: string | null;
}

export interface IosPhoneSignerClient {
  status(): Promise<PhoneIosSigningStatusDto>;
  beginLogin(email: string, password: string): Promise<PhoneIosSigningStatusDto>;
  completeTwoFactor(code: string): Promise<PhoneIosSigningStatusDto>;
  logout(): Promise<PhoneIosSigningStatusDto>;
  signWda(input: {
    source: string;
    output: string;
    udid: string;
    deviceName: string;
  }): Promise<SignWdaResult>;
  close(): Promise<void>;
}

export interface IosPhoneSignerOptions {
  dataDirectory: string;
  platform?: NodeJS.Platform;
  resourcesDirectory?: string;
  signerDirectory?: string;
  pythonPath?: string;
  helperPath?: string;
  zsignPath?: string;
}

/** Persistent private-process boundary for Apple authentication and signing.
 * Secrets cross stdin once as JSON and are never placed in argv, the
 * environment, Polymux logs, or the renderer after the request completes. */
export class IosPhoneSigner implements IosPhoneSignerClient {
  readonly #dataDirectory: string;
  readonly #platform: NodeJS.Platform;
  readonly #resourcesDirectory: string;
  readonly #signerDirectoryOverride: string | null;
  readonly #pythonOverride: string | null;
  readonly #helperOverride: string | null;
  readonly #zsignOverride: string | null;
  readonly #pending = new Map<string, PendingRequest>();
  #child: ChildProcessWithoutNullStreams | null = null;
  #lines: Interface | null = null;
  #sequence = 0;
  #verificationMethod: PhoneIosSigningStatusDto["verificationMethod"] = null;
  #stderr = "";

  constructor(options: IosPhoneSignerOptions) {
    this.#dataDirectory = options.dataDirectory;
    this.#platform = options.platform ?? process.platform;
    this.#resourcesDirectory = options.resourcesDirectory ?? process.resourcesPath ?? path.join(process.cwd(), "resources");
    this.#signerDirectoryOverride = options.signerDirectory ?? null;
    this.#pythonOverride = options.pythonPath ?? null;
    this.#helperOverride = options.helperPath ?? null;
    this.#zsignOverride = options.zsignPath ?? null;
  }

  async status(): Promise<PhoneIosSigningStatusDto> {
    if (!this.#runtime()) return unavailableStatus();
    const value = asRecord(await this.#request("status"));
    return {
      supported: true,
      stage: value.authenticated === true
        ? "authenticated"
        : this.#verificationMethod
          ? "verification-required"
          : "signed-out",
      email: typeof value.email === "string" ? value.email : null,
      teamId: typeof value.team_id === "string" ? value.team_id : null,
      verificationMethod: this.#verificationMethod,
      message: null,
    };
  }

  async beginLogin(email: string, password: string): Promise<PhoneIosSigningStatusDto> {
    if (!email.trim() || !password) throw new Error("Enter your Apple Account email and password.");
    const result = asRecord(await this.#request("beginLogin", {email: email.trim(), password}, 90_000));
    const status = typeof result.status === "string" ? result.status : "";
    if (status === "2fa_required") {
      this.#verificationMethod = result.method === "sms" ? "sms" : "trusted-device";
      return {
        supported: true,
        stage: "verification-required",
        email: email.trim(),
        teamId: null,
        verificationMethod: this.#verificationMethod,
        message: this.#verificationMethod === "sms"
          ? "This Apple Account requires SMS verification, which is not supported by this build yet."
          : null,
      };
    }
    this.#verificationMethod = null;
    return this.status();
  }

  async completeTwoFactor(code: string): Promise<PhoneIosSigningStatusDto> {
    if (!/^\d{6}$/u.test(code.trim())) throw new Error("Enter the six-digit Apple verification code.");
    if (this.#verificationMethod === "sms")
      throw new Error("SMS verification is not supported yet. Use a trusted-device code or another Apple Account.");
    await this.#request("complete2fa", {code: code.trim()}, 90_000);
    this.#verificationMethod = null;
    return this.status();
  }

  async logout(): Promise<PhoneIosSigningStatusDto> {
    await this.#request("logout");
    this.#verificationMethod = null;
    return this.status();
  }

  async signWda(input: {
    source: string;
    output: string;
    udid: string;
    deviceName: string;
  }): Promise<SignWdaResult> {
    const runtime = this.#runtime();
    if (!runtime) throw new Error("This Polymux build does not include local iPhone signing.");
    const result = asRecord(await this.#request("signWda", {
      ...input,
      zsign: runtime.zsign,
    }, 180_000));
    if (typeof result.bundleId !== "string" || typeof result.output !== "string")
      throw new Error("The local iPhone signer returned an invalid result.");
    return {
      bundleId: result.bundleId,
      output: result.output,
      expiresAt: typeof result.expiresAt === "string" ? result.expiresAt : null,
      teamId: typeof result.teamId === "string" ? result.teamId : null,
    };
  }

  async close(): Promise<void> {
    const child = this.#child;
    this.#child = null;
    this.#lines?.close();
    this.#lines = null;
    if (child && child.exitCode === null && child.signalCode === null) {
      child.stdin.end();
      await Promise.race([
        new Promise<void>((resolve) => child.once("exit", () => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 750)),
      ]);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    }
    this.#rejectPending(new Error("The local iPhone signer stopped."));
  }

  async #request(method: string, params: Record<string, unknown> = {}, timeoutMs = 45_000): Promise<unknown> {
    const child = await this.#ensureProcess();
    const id = `phone-signer-${++this.#sequence}`;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error("The local iPhone signer timed out. Check your connection and try again."));
      }, timeoutMs);
      this.#pending.set(id, {resolve, reject, timer});
      child.stdin.write(`${JSON.stringify({id, method, params})}\n`, (reason) => {
        if (!reason) return;
        const pending = this.#pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.#pending.delete(id);
        pending.reject(new Error("The local iPhone signer could not receive the request."));
      });
    });
  }

  async #ensureProcess(): Promise<ChildProcessWithoutNullStreams> {
    if (this.#child && this.#child.exitCode === null && this.#child.signalCode === null)
      return this.#child;
    const runtime = this.#runtime();
    if (!runtime) throw new Error("This Polymux build does not include local iPhone signing.");
    const stateDirectory = path.join(this.#dataDirectory, "phone", "ios", "signer-state");
    await mkdir(stateDirectory, {recursive: true, mode: 0o700});
    if (this.#platform !== "win32") await chmod(stateDirectory, 0o700).catch(() => {});
    const child = spawn(runtime.python, [runtime.helper], {
      env: {
        ...process.env,
        LOCALAPPDATA: stateDirectory,
        PYTHONUTF8: "1",
        PYTHONDONTWRITEBYTECODE: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#child = child;
    this.#stderr = "";
    const lines = createInterface({input: child.stdout});
    this.#lines = lines;
    lines.on("line", (line) => this.#onLine(line));
    child.stderr.on("data", (chunk: Buffer) => {
      this.#stderr = `${this.#stderr}${chunk.toString("utf8")}`.slice(-2_000);
    });
    child.once("exit", () => {
      if (this.#child !== child) return;
      this.#child = null;
      this.#lines = null;
      this.#verificationMethod = null;
      this.#rejectPending(new Error(lastUsefulLine(this.#stderr) || "The local iPhone signer stopped unexpectedly."));
    });
    child.once("error", () => {
      if (this.#child === child) this.#child = null;
      this.#rejectPending(new Error("The local iPhone signer could not start."));
    });
    return child;
  }

  #onLine(line: string): void {
    let response: HelperResponse;
    try {
      response = JSON.parse(line) as HelperResponse;
    } catch {
      this.#rejectPending(new Error("The local iPhone signer returned an invalid response."));
      return;
    }
    if (typeof response.id !== "string") return;
    const pending = this.#pending.get(response.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.#pending.delete(response.id);
    if (response.ok === true) pending.resolve(response.result);
    else pending.reject(new Error(typeof response.error === "string" ? response.error : "The local iPhone signer failed."));
  }

  #rejectPending(reason: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.#pending.clear();
  }

  #runtime(): {python: string; helper: string; zsign: string} | null {
    const executable = this.#platform === "win32" ? "python.exe" : "python3";
    const pythonRelative = this.#platform === "win32"
      ? path.join("python", executable)
      : path.join("python", "bin", executable);
    const zsignName = this.#platform === "win32" ? "zsign.exe" : "zsign";
    const directories = [
      this.#signerDirectoryOverride,
      path.join(this.#resourcesDirectory, "phone", "ios", "signer"),
      path.join(this.#resourcesDirectory, "resources", "phone", "ios", "signer"),
    ].filter((candidate): candidate is string => Boolean(candidate));
    for (const directory of directories) {
      const runtime = {
        python: this.#pythonOverride ?? path.join(directory, pythonRelative),
        helper: this.#helperOverride ?? path.join(directory, "helper.py"),
        zsign: this.#zsignOverride ?? path.join(directory, zsignName),
      };
      if (existsSync(runtime.python) && existsSync(runtime.helper) && existsSync(runtime.zsign)) return runtime;
    }
    if (this.#pythonOverride && this.#helperOverride && this.#zsignOverride &&
        existsSync(this.#pythonOverride) && existsSync(this.#helperOverride) && existsSync(this.#zsignOverride)) {
      return {python: this.#pythonOverride, helper: this.#helperOverride, zsign: this.#zsignOverride};
    }
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("The local iPhone signer returned an invalid response.");
  return value as Record<string, unknown>;
}

function lastUsefulLine(value: string): string {
  return value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).at(-1) ?? "";
}

function unavailableStatus(): PhoneIosSigningStatusDto {
  return {
    supported: false,
    stage: "unavailable",
    email: null,
    teamId: null,
    verificationMethod: null,
    message: "This Polymux build does not include local iPhone signing.",
  };
}
