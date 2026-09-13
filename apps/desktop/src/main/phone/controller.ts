import type {PhoneFrameDto, PhoneIosSigningStatusDto, PhonePointDto, PhoneStatusDto} from "@polymux/protocol";
import {AndroidPhoneController, type AndroidPhoneControllerOptions} from "./android.js";
import {IosPhoneController, type IosPhoneControllerOptions} from "./ios.js";

export interface PhoneControllerOptions {
  ios: IosPhoneControllerOptions;
  android?: AndroidPhoneControllerOptions;
}

/** Selects one physical phone, then keeps every UI and agent action pinned to
 * that provider until Stop. This prevents an arriving second device from
 * silently redirecting a tap or typed text. */
export class PhoneController {
  readonly #ios: IosPhoneController;
  readonly #android: AndroidPhoneController;
  readonly #platform: NodeJS.Platform;
  #active: "ios" | "android" | null = null;

  constructor(options: PhoneControllerOptions) {
    this.#platform = options.ios.platform ?? options.android?.platform ?? process.platform;
    this.#ios = new IosPhoneController(options.ios);
    this.#android = new AndroidPhoneController(options.android);
  }

  async status(): Promise<PhoneStatusDto> {
    if (this.#active) {
      const status = await this.#provider(this.#active).status();
      if (status.device) return status;
      this.#active = null;
    }
    const [ios, android] = await Promise.all([this.#ios.status(), this.#android.status()]);
    const connected = [ios, android].filter((candidate) => candidate.device);
    if (connected.length > 1) {
      return {
        ...connected[0],
        stage: "error",
        message: "More than one phone is connected. Disconnect the phone you do not want to control.",
      };
    }
    if (connected[0]) return connected[0];
    if (this.#platform === "darwin" && ios.supported) return ios;
    if (!android.supported) return ios;
    return {
      ...android,
      message: [android.message, ios.supported ? ios.message : null].filter(Boolean).join(" "),
    };
  }

  async connect(): Promise<PhoneStatusDto> {
    const status = await this.status();
    const platform = status.device?.platform;
    if (!platform) throw new Error(status.message ?? "Connect a phone first.");
    this.#active = platform;
    try {
      return await this.#provider(platform).connect();
    } catch (reason) {
      this.#active = null;
      throw reason;
    }
  }

  async stop(): Promise<PhoneStatusDto> {
    if (!this.#active) return this.status();
    const provider = this.#provider(this.#active);
    this.#active = null;
    return provider.stop();
  }

  async frame(): Promise<PhoneFrameDto> {
    return this.#activeProvider().frame();
  }

  async tap(point: PhonePointDto): Promise<void> {
    await this.#activeProvider().tap(point);
  }

  async swipe(from: PhonePointDto, to: PhonePointDto, durationMs?: number): Promise<void> {
    await this.#activeProvider().swipe(from, to, durationMs);
  }

  async type(text: string): Promise<void> {
    await this.#activeProvider().type(text);
  }

  async home(): Promise<void> {
    await this.#activeProvider().home();
  }

  async pairAndroid(pairingAddress: string, pairingCode: string, connectAddress?: string): Promise<PhoneStatusDto> {
    const status = await this.#android.pair(pairingAddress, pairingCode, connectAddress);
    if (status.device?.pairingState === "paired") {
      this.#active = "android";
      return this.#android.connect();
    }
    return status;
  }

  async iosSigningStatus(): Promise<PhoneIosSigningStatusDto> {
    return this.#ios.iosSigningStatus();
  }

  async iosSigningBegin(email: string, password: string): Promise<PhoneIosSigningStatusDto> {
    return this.#ios.iosSigningBegin(email, password);
  }

  async iosSigningComplete(code: string): Promise<PhoneIosSigningStatusDto> {
    return this.#ios.iosSigningComplete(code);
  }

  async iosSigningLogout(): Promise<PhoneIosSigningStatusDto> {
    return this.#ios.iosSigningLogout();
  }

  async close(): Promise<void> {
    await Promise.all([this.#ios.close(), this.#android.close()]);
    this.#active = null;
  }

  #provider(platform: "ios" | "android"): IosPhoneController | AndroidPhoneController {
    return platform === "ios" ? this.#ios : this.#android;
  }

  #activeProvider(): IosPhoneController | AndroidPhoneController {
    if (!this.#active) throw new Error("Connect a phone in Phone before controlling it.");
    return this.#provider(this.#active);
  }
}
