import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Preference order: quality first, then whatever smaller model is present. */
const MODEL_NAMES = [
  "ggml-small.en.bin",
  "ggml-base.en.bin",
  "ggml-small.bin",
  "ggml-base.bin",
];

/** Absolute candidates cover Dock launches, where Homebrew is not on PATH. */
const BINARY_CANDIDATES = [
  "/opt/homebrew/bin/whisper-cli",
  "/usr/local/bin/whisper-cli",
  "whisper-cli",
];

export interface WhisperDictationOptions {
  /** Directory holding ggml Whisper models, e.g. `<userData>/whisper`. */
  modelDirectory: string;
}

/**
 * Fully local speech-to-text: the renderer records a mono 16kHz 16-bit WAV
 * clip and this class transcribes it with whisper.cpp. Nothing leaves the
 * machine — the Web Speech API this replaces silently depended on Google's
 * cloud recogniser, which Electron cannot use.
 */
export class WhisperDictation {
  readonly #modelDirectory: string;

  constructor(options: WhisperDictationOptions) {
    this.#modelDirectory = options.modelDirectory;
  }

  async transcribe(audio: Buffer): Promise<string> {
    if (!audio.length) return "";
    const model = this.#modelPath();
    const directory = await mkdtemp(path.join(tmpdir(), "midas-dictation-"));
    try {
      const wavPath = path.join(directory, "clip.wav");
      await writeFile(wavPath, audio);
      const { stdout } = await this.#runBinary([
        "-m", model,
        "-f", wavPath,
        "--no-timestamps",
        "--no-prints",
        "--language", "en",
      ]);
      return stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !/^\[.*\]$/.test(line))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  #modelPath(): string {
    for (const name of MODEL_NAMES) {
      const candidate = path.join(this.#modelDirectory, name);
      if (existsSync(candidate)) return candidate;
    }
    throw new Error(
      `Dictation model is missing. Download ggml-small.en.bin from huggingface.co/ggerganov/whisper.cpp into ${this.#modelDirectory}`,
    );
  }

  async #runBinary(args: string[]): Promise<{ stdout: string }> {
    let missing: unknown;
    for (const binary of BINARY_CANDIDATES) {
      if (path.isAbsolute(binary) && !existsSync(binary)) continue;
      try {
        return await run(binary, args, { maxBuffer: 8 * 1024 * 1024 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          missing = error;
          continue;
        }
        throw error;
      }
    }
    throw missing instanceof Error
      ? new Error("Local dictation needs whisper-cpp. Install it with: brew install whisper-cpp")
      : new Error("Local dictation is unavailable");
  }
}
