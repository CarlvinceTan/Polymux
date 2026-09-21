import type {MobileFrameDto, MobileIosSigningStatusDto, MobilePointDto, MobileStatusDto} from "@polymux/protocol";
import {AndroidMobileController, type AndroidMobileControllerOptions} from "./android.js";
import {IosMobileController, type IosMobileControllerOptions} from "./ios.js";

export interface MobileControllerOptions {
  ios: IosMobileControllerOptions;
  android?: AndroidMobileControllerOptions;
}

/** Selects one physical mobile, then keeps every UI and agent action pinned to
 * that provider until Stop. This prevents an arriving second device from
 * silently redirecting a tap or typed text. */
export class MobileController {
  readonly #ios: IosMobileController;
  readonly #android: AndroidMobileController;
  readonly #platform: NodeJS.Platform;
  #active: "ios" | "android" | null = null;

  constructor(options: MobileControllerOptions) {
    this.#platform = options.ios.platform ?? options.android?.platform ?? process.platform;
    this.#ios = new IosMobileController(options.ios);
    this.#android = new AndroidMobileController(options.android);
  }

  async status(): Promise<MobileStatusDto> {
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
        message: "More than one mobile is connected. Disconnect the mobile you do not want to control.",
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

  async connect(): Promise<MobileStatusDto> {
    const status = await this.status();
    const platform = status.device?.platform;
    if (!platform) throw new Error(status.message ?? "Connect a mobile first.");
    this.#active = platform;
    try {
      return await this.#provider(platform).connect();
    } catch (reason) {
      this.#active = null;
      throw reason;
    }
  }

  async stop(): Promise<MobileStatusDto> {
    if (!this.#active) return this.status();
    const provider = this.#provider(this.#active);
    this.#active = null;
    return provider.stop();
  }

  async frame(): Promise<MobileFrameDto> {
    return this.#activeProvider().frame();
  }

  async tap(point: MobilePointDto): Promise<void> {
    await this.#activeProvider().tap(point);
  }

  async swipe(from: MobilePointDto, to: MobilePointDto, durationMs?: number): Promise<void> {
    await this.#activeProvider().swipe(from, to, durationMs);
  }

  async type(text: string): Promise<void> {
    await this.#activeProvider().type(text);
  }

  async home(): Promise<void> {
    await this.#activeProvider().home();
  }

  async pairAndroid(pairingAddress: string, pairingCode: string, connectAddress?: string): Promise<MobileStatusDto> {
    const status = await this.#android.pair(pairingAddress, pairingCode, connectAddress);
    if (status.device?.pairingState === "paired") {
      this.#active = "android";
      return this.#android.connect();
    }
    return status;
  }

  async iosSigningStatus(): Promise<MobileIosSigningStatusDto> {
    return this.#ios.iosSigningStatus();
  }

  async iosSigningBegin(email: string, password: string): Promise<MobileIosSigningStatusDto> {
    return this.#ios.iosSigningBegin(email, password);
  }

  async iosSigningComplete(code: string): Promise<MobileIosSigningStatusDto> {
    return this.#ios.iosSigningComplete(code);
  }

  async iosSigningLogout(): Promise<MobileIosSigningStatusDto> {
    return this.#ios.iosSigningLogout();
  }

  async close(): Promise<void> {
    await Promise.all([this.#ios.close(), this.#android.close()]);
    this.#active = null;
  }

  #provider(platform: "ios" | "android"): IosMobileController | AndroidMobileController {
    return platform === "ios" ? this.#ios : this.#android;
  }

  #activeProvider(): IosMobileController | AndroidMobileController {
    if (!this.#active) throw new Error("Connect a mobile in Mobile before controlling it.");
    return this.#provider(this.#active);
  }
}
