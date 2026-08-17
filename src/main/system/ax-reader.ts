import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

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
  readonly #options: AxReaderOptions;
  #binary?: Promise<string>;

  constructor(options: AxReaderOptions) {
    this.#options = options;
  }

  async snapshot(skipPid?: number): Promise<AxSnapshot> {
    const binary = await this.#ensureBinary();
    const args = skipPid === undefined ? [] : ["--skip-pid", String(skipPid)];
    const { stdout } = await run(binary, args, {
      timeout: 8_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const line = stdout.trim().split(/\r?\n/).pop() ?? "";
    return JSON.parse(line) as AxSnapshot;
  }

  #ensureBinary(): Promise<string> {
    this.#binary ??= this.#compile().catch((error: unknown) => {
      // A failed build must not poison every later capture attempt.
      this.#binary = undefined;
      throw error;
    });
    return this.#binary;
  }

  async #compile(): Promise<string> {
    if (process.platform !== "darwin")
      throw new Error("Accessibility capture is only available on macOS");
    if (!existsSync(this.#options.sourcePath))
      throw new Error(`Accessibility helper source is missing at ${this.#options.sourcePath}`);
    const source = readFileSync(this.#options.sourcePath);
    const revision = createHash("sha256").update(source).digest("hex").slice(0, 12);
    const binary = path.join(this.#options.cacheDirectory, `ax-reader-${revision}`);
    if (existsSync(binary)) return binary;
    await mkdir(this.#options.cacheDirectory, { recursive: true });
    const building = `${binary}.build`;
    try {
      await run("swiftc", ["-O", "-o", building, this.#options.sourcePath], {
        timeout: 120_000,
        maxBuffer: 4 * 1024 * 1024,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new Error(
          "Accessibility capture needs the Swift compiler. Install the Xcode Command Line Tools: xcode-select --install",
        );
      throw error;
    }
    await rename(building, binary);
    return binary;
  }
}
