import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface SwiftHelperOptions {
  /** What the cached binary is called, before its revision suffix. */
  name: string;
  /** Path to the .swift source bundled with the app. */
  sourcePath: string;
  /** Writable directory for the compiled helper, e.g. `<userData>/bin`. */
  cacheDirectory: string;
  /**
   * An Info.plist to link into the binary as its `__TEXT,__info_plist`
   * section. macOS terminates a process that touches a privacy class with no
   * usage description, and a bare executable has no bundle to carry one.
   */
  infoPlist?: string;
  /**
   * What to say when `swiftc` is not on the machine. Each caller names its own
   * capability, because "install the command line tools" is only useful when
   * the sentence before it says what stopped working.
   */
  missingCompilerMessage?: string;
  /** The same, for a source file that is not where it was expected. */
  missingSourceMessage?: (path: string) => string;
}

/**
 * A Swift source bundled with the app, compiled once per revision and cached
 * under the app's data directory. Packaged installs need no build step of
 * their own, and a helper whose source changed is rebuilt rather than served
 * stale from the cache.
 *
 * Running it as a child of the app is not incidental: macOS attributes a
 * privacy request to the responsible process, so a helper the app spawns asks
 * — and is granted — as Polymux. The same binary run from a terminal is
 * attributed to the terminal, which is why one tested that way proves nothing.
 */
export class SwiftHelper {
  readonly #options: SwiftHelperOptions;
  #binary?: Promise<string>;

  constructor(options: SwiftHelperOptions) {
    this.#options = options;
  }

  /**
   * The compiled binary, built on first use. Callers that own how the process
   * is run — a long-lived one they stream events from, a read with its own
   * timeout — take the path and spawn it themselves.
   */
  binary(): Promise<string> {
    return this.#ensureBinary();
  }

  /** Runs the helper and returns its last line of stdout. */
  async run(args: string[], timeout: number): Promise<string> {
    const binary = await this.#ensureBinary();
    const { stdout } = await run(binary, args, { timeout, maxBuffer: 4 * 1024 * 1024 });
    return stdout.trim().split(/\r?\n/).pop() ?? "";
  }

  #ensureBinary(): Promise<string> {
    this.#binary ??= this.#compile().catch((error: unknown) => {
      // A failed build must not poison every later call.
      this.#binary = undefined;
      throw error;
    });
    return this.#binary;
  }

  async #compile(): Promise<string> {
    const {name, sourcePath, cacheDirectory, infoPlist} = this.#options;
    if (!existsSync(sourcePath))
      throw new Error(
        this.#options.missingSourceMessage?.(sourcePath) ??
          `${name} helper source is missing at ${sourcePath}`,
      );
    // The linked plist is part of the binary, so a reworded description has to
    // produce a fresh build rather than reusing one carrying the old sentence.
    const revision = createHash("sha256")
      .update(readFileSync(sourcePath))
      .update(infoPlist ?? "")
      .digest("hex")
      .slice(0, 12);
    const binary = path.join(cacheDirectory, `${name}-${revision}`);
    if (existsSync(binary)) return binary;
    await mkdir(cacheDirectory, { recursive: true });
    const building = `${binary}.build`;
    const linkPlist: string[] = [];
    if (infoPlist) {
      const plistPath = `${binary}.plist`;
      await writeFile(plistPath, infoPlist, "utf8");
      linkPlist.push(
        "-Xlinker", "-sectcreate",
        "-Xlinker", "__TEXT",
        "-Xlinker", "__info_plist",
        "-Xlinker", plistPath,
      );
    }
    try {
      await run("swiftc", ["-O", "-o", building, ...linkPlist, sourcePath], {
        timeout: 120_000,
        maxBuffer: 4 * 1024 * 1024,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new Error(
          this.#options.missingCompilerMessage ??
            `${name} needs the Swift compiler. Install the Xcode Command Line Tools: xcode-select --install`,
        );
      throw error;
    }
    await rename(building, binary);
    return binary;
  }
}
