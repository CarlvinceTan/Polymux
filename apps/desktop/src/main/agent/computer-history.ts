import type {
  ComputerHistoryFrame,
  ComputerHistoryFrameSource,
  ComputerHistorySystemState,
  ComputerHistorySystemStateSource,
} from "@flareai/computer-history";
import { textSignature } from "@flareai/computer-history";
import { powerMonitor } from "electron";
import type { AxReader } from "../system/ax-reader.js";

/**
 * Pixel-free capture: samples the frontmost window's text through the
 * macOS Accessibility API, so macOS shows no screen-recording indicator.
 * Each app is its own source, letting the manager's change detection and
 * heartbeats work per application exactly as they do per display.
 */
export class AccessibilityComputerHistoryFrames implements ComputerHistoryFrameSource {
  readonly #reader: AxReader;

  constructor(reader: AxReader) {
    this.#reader = reader;
  }

  async capture(): Promise<ComputerHistoryFrame[]> {
    const snapshot = await this.#reader.snapshot(process.pid);
    if (!snapshot.trusted)
      throw new Error(
        "Accessibility access is off. Allow FlareAI under Privacy & Security → Accessibility in System Settings.",
      );
    if (snapshot.skipped || !snapshot.app) return [];
    const text = snapshot.text?.trim() ?? "";
    const title = snapshot.title?.trim() ?? "";
    if (!text && !title) return [];
    const document = [
      `# ${snapshot.app}${title ? ` — ${title}` : ""}`,
      "",
      ...(snapshot.bundleId ? [`Bundle: ${snapshot.bundleId}`] : []),
      ...(snapshot.url ? [`URL: ${snapshot.url}`] : []),
      "",
      text || "(no readable text)",
      "",
    ].join("\n");
    return [{
      sourceId: `ax-${snapshot.bundleId ?? snapshot.app}`,
      sourceName: title ? `${snapshot.app} — ${title}` : snapshot.app,
      displayId: null,
      width: 0,
      height: 0,
      image: new TextEncoder().encode(document),
      signature: textSignature(`${title}\n${text}`),
      kind: "text",
      // Identity the capture policy is judged against. It travels with the
      // frame rather than being re-derived later, so the policy sees exactly
      // the window that was read.
      app: snapshot.app,
      ...(snapshot.bundleId ? { bundleId: snapshot.bundleId } : {}),
      ...(snapshot.url ? { url: snapshot.url } : {}),
      ...(snapshot.isPrivate ? { privateBrowsing: true } : {}),
    }];
  }
}

/**
 * ComputerHistory's active tier is a setting the user can flip while the capture
 * loop runs, so the source is chosen per tick rather than at construction.
 */
export class ElectronComputerHistorySystem implements ComputerHistorySystemStateSource {
  current(): ComputerHistorySystemState {
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
