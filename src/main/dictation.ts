import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
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

const SERVER_CANDIDATES = [
  "/opt/homebrew/bin/whisper-server",
  "/usr/local/bin/whisper-server",
  "whisper-server",
];

/** Loading the model takes about half a second; well short of this. */
const SERVER_READY_TIMEOUT = 20_000;
const SERVER_POLL_INTERVAL = 50;
/** The model sits on ~500MB of memory, so an idle session hands it back. */
const SERVER_IDLE_TIMEOUT = 180_000;

export interface WhisperDictationOptions {
  /** Directory holding ggml Whisper models, e.g. `<userData>/whisper`. */
  modelDirectory: string;
}

/**
 * Fully local speech-to-text: the renderer records a mono 16kHz 16-bit WAV
 * clip and this class transcribes it with whisper.cpp. Nothing leaves the
 * machine — the Web Speech API this replaces silently depended on Google's
 * cloud recogniser, which Electron cannot use.
 *
 * Passes go to a resident `whisper-server` when one can be started, and to
 * `whisper-cli` otherwise. Spawning the CLI costs ~400ms of process start and
 * model init whatever the clip length — a 0.5s clip is as expensive as a 34s
 * one — which is most of the wait when partials arrive several times a second.
 * The server pays that once and answers in ~110ms thereafter, and it is also
 * steadier: a cold CLI run measured anywhere from 400ms to several seconds when
 * it followed a long clip through the GPU.
 */
export class WhisperDictation {
  readonly #modelDirectory: string;
  #server: ChildProcess | null = null;
  #serverUrl = "";
  #serverStarting: Promise<string | null> | null = null;
  /** Set once starting fails, so every later pass goes straight to the CLI. */
  #serverUnavailable = false;
  #idleTimer: NodeJS.Timeout | null = null;

  constructor(options: WhisperDictationOptions) {
    this.#modelDirectory = options.modelDirectory;
  }

  /**
   * @param final Whether this is the closing pass over a finished recording,
   *   whose text stays in the composer rather than being replaced by the pass
   *   behind it. Only the CLI fallback spends anything on the distinction.
   */
  async transcribe(audio: Buffer, final = true): Promise<string> {
    if (!audio.length) return "";
    const served = await this.#transcribeOnServer(audio);
    if (served !== null) return served;
    return this.#transcribeWithCli(audio, final);
  }

  /** Releases the resident model. Safe to call when nothing is running. */
  close(): void {
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = null;
    this.#server?.kill();
    this.#server = null;
    this.#serverUrl = "";
    this.#serverStarting = null;
  }

  /** Resolves to null when the server cannot serve this clip, so the caller
   * can fall back rather than fail the dictation. */
  async #transcribeOnServer(audio: Buffer): Promise<string | null> {
    let url: string | null;
    try {
      url = await this.#ensureServer();
    } catch {
      url = null;
    }
    if (!url) return null;
    this.#keepAlive();
    const body = new FormData();
    // Copied into a plain view: a Buffer may sit on shared memory, which Blob
    // does not accept.
    const wav = Uint8Array.from(audio);
    body.append("file", new Blob([wav], { type: "audio/wav" }), "clip.wav");
    body.append("response_format", "text");
    body.append("temperature", "0");
    try {
      const response = await fetch(`${url}/inference`, { method: "POST", body });
      if (!response.ok) return null;
      return cleanTranscript(await response.text());
    } catch {
      // A dead or wedged server should not take the dictation down with it.
      this.close();
      return null;
    }
  }

  /** The fallback engine, so it carries the speed/accuracy tradeoff instead:
   * a partial is replaced by the pass behind it and can decode greedily, while
   * the text a partial leaves behind cannot. */
  async #transcribeWithCli(audio: Buffer, final: boolean): Promise<string> {
    const model = this.#modelPath();
    const directory = await mkdtemp(path.join(tmpdir(), "flareai-dictation-"));
    try {
      const wavPath = path.join(directory, "clip.wav");
      await writeFile(wavPath, audio);
      const { stdout } = await this.#runBinary([
        "-m", model,
        "-f", wavPath,
        "--no-timestamps",
        "--no-prints",
        "--language", "en",
        // Beam search costs ~110ms more per pass and is worth it only for text
        // that stays. whisper-cli's own defaults are 5/5.
        ...(final ? ["--beam-size", "5", "--best-of", "5"] : ["--beam-size", "1", "--best-of", "1"]),
      ]);
      return cleanTranscript(stdout);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  /** Resolves to the server's origin, or null when there is none to use. */
  async #ensureServer(): Promise<string | null> {
    if (this.#serverUrl) return this.#serverUrl;
    if (this.#serverUnavailable) return null;
    this.#serverStarting ??= this.#startServer().finally(() => {
      this.#serverStarting = null;
    });
    return this.#serverStarting;
  }

  async #startServer(): Promise<string | null> {
    const binary = SERVER_CANDIDATES.find(
      (candidate) => !path.isAbsolute(candidate) || existsSync(candidate),
    );
    if (!binary) {
      this.#serverUnavailable = true;
      return null;
    }
    const model = this.#modelPath();
    const port = await freePort();
    const child = spawn(
      binary,
      [
        "--model", model,
        "--host", "127.0.0.1",
        "--port", String(port),
        "--language", "en",
        "--no-timestamps",
        // The server's own default. Temperature fallback stays on: it only
        // costs anything when a decode actually fails, and it is what keeps a
        // hard passage from landing in the composer as repetition.
        "--best-of", "2",
      ],
      { stdio: "ignore" },
    );
    child.once("error", () => this.close());
    child.once("exit", () => {
      if (this.#server === child) this.close();
    });
    this.#server = child;
    const url = `http://127.0.0.1:${port}`;
    if (!(await waitForServer(url, child))) {
      this.#serverUnavailable = true;
      this.close();
      return null;
    }
    this.#serverUrl = url;
    this.#keepAlive();
    return url;
  }

  #keepAlive(): void {
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = setTimeout(() => this.close(), SERVER_IDLE_TIMEOUT);
    this.#idleTimer.unref?.();
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

/** Both tools print the transcript as plain lines, with bracketed noise for
 * silence and music. */
function cleanTranscript(output: string): string {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^\[.*\]$/.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Any HTTP answer means the model has finished loading; until then the port
 * refuses connections. */
async function waitForServer(url: string, child: ChildProcess): Promise<boolean> {
  const deadline = Date.now() + SERVER_READY_TIMEOUT;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) return false;
    try {
      await fetch(url, { method: "GET" });
      return true;
    } catch {
      await delay(SERVER_POLL_INTERVAL);
    }
  }
  return false;
}

/** Asking the OS for a port beats guessing one that another app may hold. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => (port ? resolve(port) : reject(new Error("No free port"))));
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
