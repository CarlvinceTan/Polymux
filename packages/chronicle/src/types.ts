/**
 * "accessibility" samples the frontmost window's text through the macOS
 * Accessibility API — no pixels, so macOS shows no screen-recording
 * indicator. "screen" captures display frames and carries that indicator.
 */
export interface ChronicleSettings {
  enabled: boolean;
  activeIntervalMs: number;
  quietIntervalMs: number;
  heartbeatMs: number;
  idleAfterSeconds: number;
  minimumChange: number;
  retentionHours: number;
  maximumBytes: number;
}

export interface ChronicleFrame {
  sourceId: string;
  sourceName: string;
  displayId: string | null;
  width: number;
  height: number;
  /** JPEG bytes for image captures; UTF-8 markdown for text captures. */
  image: Uint8Array;
  signature: Uint8Array;
  kind?: "image" | "text";
}

export interface ChronicleFrameSource {
  capture(): Promise<ChronicleFrame[]>;
}

export interface ChronicleSystemState {
  idleSeconds: number;
  locked: boolean;
  onBattery: boolean;
  thermalState: "unknown" | "nominal" | "fair" | "serious" | "critical";
}

export interface ChronicleSystemStateSource {
  current(): ChronicleSystemState;
}

export interface ChronicleEntry {
  id: string;
  capturedAt: string;
  sourceId: string;
  sourceName: string;
  displayId: string | null;
  width: number;
  height: number;
  path: string;
  change: number;
  reason: "change" | "heartbeat" | "initial";
  bytes: number;
  kind?: "image" | "text";
}

export interface ChronicleStatus {
  enabled: boolean;
  running: boolean;
  directory: string;
  lastCapturedAt: string | null;
  lastError: string | null;
  storedFrames: number;
  storedBytes: number;
}

export interface ChroniclePromptContext {
  directory: string;
  instructionsPath: string;
  enabled: boolean;
}
