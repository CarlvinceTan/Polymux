/**
 * "accessibility" samples the frontmost window's text through the macOS
 * Accessibility API — no pixels, so macOS shows no screen-recording
 * indicator. "screen" captures display frames and carries that indicator.
 */
export interface ComputerHistorySettings {
  enabled: boolean;
  activeIntervalMs: number;
  quietIntervalMs: number;
  heartbeatMs: number;
  idleAfterSeconds: number;
  minimumChange: number;
  retentionHours: number;
  maximumBytes: number;
  /**
   * What ComputerHistory leaves alone; everything not named here is captured. Apps
   * are bundle identifiers or app names, matched case-insensitively; sites
   * are hostnames, matched on the host itself or any subdomain of it.
   */
  excludeApps: string[];
  excludeSites: string[];
  /**
   * Whether a browser window the host reports as private counts as ordinary
   * screen. Default true — recording everything is the honest default for a
   * local-only history, and switching it off is the deliberate act.
   */
  recordPrivateBrowsing: boolean;
  /** Whether the interaction stream (clicks, chords, app switches) is kept. */
  interactionEvents: boolean;
  /**
   * Frames and events older than this are distilled into durable memory
   * before retention deletes them, so what was learnt outlives the raw
   * capture. Zero disables distillation.
   */
  distillAfterHours: number;
}

export interface ComputerHistoryFrame {
  sourceId: string;
  sourceName: string;
  displayId: string | null;
  width: number;
  height: number;
  /** JPEG bytes for image captures; UTF-8 markdown for text captures. */
  image: Uint8Array;
  signature: Uint8Array;
  kind?: "image" | "text";
  /** Identity the capture policy is judged against. */
  app?: string;
  bundleId?: string;
  url?: string;
  privateBrowsing?: boolean;
}

export interface ComputerHistoryFrameSource {
  capture(): Promise<ComputerHistoryFrame[]>;
}

export interface ComputerHistorySystemState {
  idleSeconds: number;
  locked: boolean;
  onBattery: boolean;
  thermalState: "unknown" | "nominal" | "fair" | "serious" | "critical";
}

export interface ComputerHistorySystemStateSource {
  current(): ComputerHistorySystemState;
}

export interface ComputerHistoryEntry {
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
  app?: string;
  bundleId?: string;
  url?: string;
}

/**
 * One thing the user did, as opposed to one thing that was on screen. A frame
 * says a document was open; an event says it was scrolled, or that a chord
 * saved it. Content is deliberately absent: a keystroke is counted, never
 * recorded, so the stream carries causality without carrying what was typed.
 */
export interface InteractionEvent {
  at: string;
  kind: "app" | "click" | "shortcut" | "type" | "scroll";
  app: string;
  bundleId?: string;
  title?: string;
  url?: string;
  /** The control the pointer or focus was on, from the accessibility tree. */
  target?: string;
  /** A chord such as "cmd+s", never a plain character. */
  chord?: string;
  /** Keystrokes in a typing burst, or scroll ticks. Never their content. */
  count?: number;
}

export interface InteractionEventSource {
  /** Starts the stream. `onEvent` is called for each event as it happens. */
  start(onEvent: (event: InteractionEvent) => void): Promise<void>;
  stop(): void;
}

export interface ComputerHistoryStatus {
  enabled: boolean;
  running: boolean;
  directory: string;
  lastCapturedAt: string | null;
  lastError: string | null;
  storedFrames: number;
  storedBytes: number;
  storedEvents: number;
  excludeApps: string[];
  excludeSites: string[];
  recordPrivateBrowsing: boolean;
  interactionEvents: boolean;
  distilledThrough: string | null;
}

export interface ComputerHistoryPromptContext {
  directory: string;
  instructionsPath: string;
  enabled: boolean;
}

export interface ComputerHistorySearchHit {
  at: string;
  source: "frame" | "event";
  app: string;
  title?: string;
  url?: string;
  /** Frame path for a frame hit; absent for an event hit. */
  path?: string;
  text: string;
}
