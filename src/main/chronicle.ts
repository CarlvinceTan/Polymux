import type {
  ChronicleFrame,
  ChronicleFrameSource,
  ChronicleSystemState,
  ChronicleSystemStateSource,
} from "@midas/chronicle";
import { frameSignature } from "@midas/chronicle";
import { desktopCapturer, powerMonitor } from "electron";

export class ElectronChronicleFrames implements ChronicleFrameSource {
  async capture(): Promise<ChronicleFrame[]> {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 1280, height: 720 },
      fetchWindowIcons: false,
    });
    const frames = sources.flatMap((source) => {
      if (source.thumbnail.isEmpty()) return [];
      const size = source.thumbnail.getSize();
      const signatureImage = source.thumbnail.resize({
        width: 32,
        height: 18,
        quality: "good",
      });
      return [{
        sourceId: source.id,
        sourceName: source.name,
        displayId: source.display_id || null,
        width: size.width,
        height: size.height,
        image: source.thumbnail.toJPEG(68),
        signature: frameSignature(signatureImage.toBitmap()),
      }];
    });
    if (!frames.length)
      throw new Error("Screen capture returned no frames. Screen Recording access may be unavailable.");
    return frames;
  }
}

export class ElectronChronicleSystem implements ChronicleSystemStateSource {
  current(): ChronicleSystemState {
    return {
      idleSeconds: powerMonitor.getSystemIdleTime(),
      locked: powerMonitor.getSystemIdleState(1) === "locked",
      onBattery: powerMonitor.isOnBatteryPower(),
      thermalState:
        process.platform === "darwin"
          ? powerMonitor.getCurrentThermalState()
          : "unknown",
    };
  }
}
