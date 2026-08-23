import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { InteractionEvent, InteractionEventSource } from "@polymux/computer-history";
import { SwiftHelper } from "../system/swift-helper.js";

export interface InteractionEventsOptions {
  /** Path to native/ax-events.swift (bundled with the app). */
  sourcePath: string;
  /** Writable directory for the compiled helper, e.g. `<userData>/bin`. */
  cacheDirectory: string;
}

/**
 * The interaction stream's Electron seam: it compiles and supervises
 * `ax-events.swift`, which holds a listen-only CGEvent tap and prints one JSON
 * event per line. The tap has to live in a native process — Electron cannot
 * see input aimed at other applications — and it is a child of the app so the
 * accessibility grant it needs is Polymux's own.
 *
 * Nothing here decides what is worth keeping. Every event goes to the manager,
 * which applies the capture policy; a filter in two places is a filter that
 * disagrees with itself.
 */
export class NativeInteractionEvents implements InteractionEventSource {
  readonly #helper: SwiftHelper;
  #child?: ChildProcessWithoutNullStreams;
  #stopped = false;
  #restarts = 0;
  #restartTimer?: ReturnType<typeof setTimeout>;

  constructor(options: InteractionEventsOptions) {
    this.#helper = new SwiftHelper({
      name: "ax-events",
      sourcePath: options.sourcePath,
      cacheDirectory: options.cacheDirectory,
      missingCompilerMessage:
        "Interaction events need the Swift compiler. Install the Xcode Command Line Tools: xcode-select --install",
      missingSourceMessage: (path) => `Interaction event helper source is missing at ${path}`,
    });
  }

  async start(onEvent: (event: InteractionEvent) => void): Promise<void> {
    this.#stopped = false;
    const binary = await this.#helper.binary();
    this.#spawn(binary, onEvent);
  }

  stop(): void {
    this.#stopped = true;
    if (this.#restartTimer) clearTimeout(this.#restartTimer);
    this.#restartTimer = undefined;
    this.#child?.kill("SIGTERM");
    this.#child = undefined;
  }

  #spawn(binary: string, onEvent: (event: InteractionEvent) => void): void {
    if (this.#stopped) return;
    const child = spawn(binary, ["--skip-pid", String(process.pid)], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.#child = child;
    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      // The last piece may be half a line; it waits for the rest.
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const event = parse(line);
        if (event) onEvent(event);
      }
      // A wedged helper must not grow the buffer without bound.
      if (buffer.length > 64 * 1024) buffer = "";
    });
    child.stderr.resume();
    child.on("exit", () => {
      if (this.#stopped || this.#child !== child) return;
      this.#child = undefined;
      // A tap macOS revoked comes back when the grant does, so restarting is
      // right — but backing off, so a helper that cannot run is not respawned
      // in a loop for the life of the app.
      this.#restarts += 1;
      if (this.#restarts > 5) return;
      this.#restartTimer = setTimeout(
        () => this.#spawn(binary, onEvent),
        Math.min(60_000, 2_000 * 2 ** (this.#restarts - 1)),
      );
    });
  }
}

const kinds = new Set<InteractionEvent["kind"]>(["app", "click", "shortcut", "type", "scroll"]);

function parse(line: string): InteractionEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const value = JSON.parse(trimmed) as Partial<InteractionEvent>;
    if (typeof value.at !== "string" || typeof value.app !== "string") return null;
    if (!value.kind || !kinds.has(value.kind)) return null;
    return value as InteractionEvent;
  } catch {
    return null;
  }
}
