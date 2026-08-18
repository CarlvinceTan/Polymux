import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SwiftHelper } from "./swift-helper.js";

const run = promisify(execFile);

/** One reading of the frontmost application, as reported by ax-reader.swift. */
export interface AxSnapshot {
  trusted: boolean;
  skipped?: string;
  app?: string;
  bundleId?: string;
  pid?: number;
  title?: string;
  text?: string;
  /** Page URL when the window is a browser's; absent for a native app. */
  url?: string;
  /** Best-effort private-browsing marker, read off the window title. */
  isPrivate?: boolean;
}

/** One titled window of an ordinary running application. */
export interface AxWindow {
  app: string;
  bundleId?: string;
  pid: number;
  title: string;
  frontmost: boolean;
}

export interface AxReaderOptions {
  /** Path to native/ax-reader.swift (bundled with the app). */
  sourcePath: string;
  /** Writable directory for the compiled helper, e.g. `<userData>/bin`. */
  cacheDirectory: string;
}

/**
 * Compiles and runs the accessibility reader helper. The binary is built
 * once per source revision with `swiftc` and cached under the app's data
 * directory, so packaged installs need no build step of their own.
 */
export class AxReader {
  readonly #helper: SwiftHelper;

  constructor(options: AxReaderOptions) {
    this.#helper = new SwiftHelper({
      name: "ax-reader",
      sourcePath: options.sourcePath,
      cacheDirectory: options.cacheDirectory,
      missingCompilerMessage:
        "Accessibility capture needs the Swift compiler. Install the Xcode Command Line Tools: xcode-select --install",
      missingSourceMessage: (path) => `Accessibility helper source is missing at ${path}`,
    });
  }

  async snapshot(skipPid?: number): Promise<AxSnapshot> {
    return this.#read<AxSnapshot>(skipPid === undefined ? [] : ["--skip-pid", String(skipPid)]);
  }

  /**
   * Every titled window currently open, across applications. Titles only —
   * this is the ambient "what is open" reading, not a page capture, so it
   * costs one AX round trip per app and carries no window text.
   */
  async windows(skipPid?: number): Promise<{ trusted: boolean; windows: AxWindow[] }> {
    return this.#read<{ trusted: boolean; windows: AxWindow[] }>([
      "--windows",
      ...(skipPid === undefined ? [] : ["--skip-pid", String(skipPid)]),
    ]);
  }

  async #read<T>(args: string[]): Promise<T> {
    const binary = await this.#helper.binary();
    const { stdout } = await run(binary, args, {
      timeout: 8_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const line = stdout.trim().split(/\r?\n/).pop() ?? "";
    return JSON.parse(line) as T;
  }
}
