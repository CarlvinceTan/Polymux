import { app, nativeImage, nativeTheme, type NativeImage } from "electron";
import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { SwiftHelper } from "../system/swift-helper.js";

const run = promisify(execFile);

/**
 * The Computer Use pill's picture: a capsule holding the icons of the apps
 * being driven, with the agent cursor beside them.
 *
 * Drawn by `resources/native/pill-image.swift`, not here. The pill has to be
 * the same picture as the mac-use / Hermes status item, and that one is
 * AppKit: `NSWorkspace` icon representations with their shadows, AppKit's
 * antialiasing, a bezier capsule. Compositing it by hand in the main process
 * meant approximating all three, and the approximation was visibly wrong —
 * generic placeholder icons, no shadows, washed-out colour from mishandled
 * premultiplied alpha. Handing the drawing to AppKit removed that whole class
 * of error at once.
 *
 * Electron's `Tray` takes an image and nothing else, so the capsule AppKit
 * draws in a custom `NSView` behind the real status item is painted into the
 * image by the helper.
 */

export interface PillApp {
  appId: string;
  name: string;
}

/** Beyond this the stack stops being readable and only gets wider. */
const MAX_ICONS = 5;

export interface PillIconOptions {
  /** Path to `native/pill-image.swift`, bundled with the app. */
  sourcePath: string;
  /** Writable directory for the compiled helper, e.g. `<userData>/bin`. */
  cacheDirectory: string;
}

export class PillIcon {
  readonly #helper: SwiftHelper;
  readonly #directory: string;
  /** Keyed by the apps and the theme, since both change the picture. */
  #cache = new Map<string, NativeImage>();

  constructor(options: PillIconOptions) {
    this.#helper = new SwiftHelper({
      name: "pill-image",
      sourcePath: options.sourcePath,
      cacheDirectory: options.cacheDirectory,
      missingCompilerMessage:
        "The Computer Use pill needs the Swift compiler. Install the Xcode Command Line Tools: xcode-select --install",
      missingSourceMessage: (at) => `Pill image helper source is missing at ${at}`,
    });
    this.#directory = path.join(options.cacheDirectory, "pill");
  }

  /**
   * Composites the pill. Returns null when there is nothing to draw, which the
   * caller reads as "take the pill away", and also when the helper cannot run —
   * an indicator that fails is never a reason to stop the agent's work.
   */
  async image(apps: PillApp[]): Promise<NativeImage | null> {
    const shown = apps.slice(0, MAX_ICONS);
    if (shown.length === 0) return null;
    const dark = nativeTheme.shouldUseDarkColors;
    const key = `${dark ? "dark" : "light"}:${shown.map((entry) => entry.appId).join(",")}`;
    const cached = this.#cache.get(key);
    if (cached) return cached;
    try {
      const binary = await this.#helper.binary();
      mkdirSync(this.#directory, { recursive: true });
      // Named for what it holds, so a redraw of the same set reuses the file.
      const out = path.join(this.#directory, `${hash(key)}.png`);
      await run(
        binary,
        ["--out", out, dark ? "--dark" : "--light", ...shown.map((entry) => entry.appId)],
        { timeout: 5_000 },
      );
      const image = nativeImage.createFromPath(out);
      if (image.isEmpty()) return null;
      this.#cache.set(key, image);
      return image;
    } catch {
      return null;
    }
  }

  /** Dropped when the theme changes, since the capsule and glyph are themed. */
  forget(): void {
    this.#cache.clear();
  }
}

/** Short, stable, filesystem-safe name for a set of apps and a theme. */
function hash(key: string): string {
  let value = 0;
  for (let index = 0; index < key.length; index += 1)
    value = (value * 31 + key.charCodeAt(index)) >>> 0;
  return value.toString(36);
}

/** Where the helper caches its compiled binary and rendered images. */
export function defaultPillCacheDirectory(): string {
  return path.join(app.getPath("userData"), "bin");
}
