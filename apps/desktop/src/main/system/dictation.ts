import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Preference order: quality first, then whatever smaller model is present. */
const MODEL_NAMES = [
  "ggml-small.en.bin",
  "ggml-base.en.bin",
  "ggml-small.bin",
  "ggml-base.bin",
];

/**
 * Fetched on first use when the directory is empty. Base is the smallest model
 * that dictates English well, and at ~148MB it lands in seconds; the larger
 * `ggml-small.en.bin` still wins if someone drops it in by hand.
 */
const DEFAULT_MODEL_NAME = "ggml-base.en.bin";
export const DEFAULT_MODEL_REVISION =
  "5359861c739e955e79d9a303bcbc70fb988958b1";
export const DEFAULT_MODEL_SHA256 =
  "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002";
const DEFAULT_MODEL_BYTES = 147_964_211;
const MODEL_BASE_URL =
  `https://huggingface.co/ggerganov/whisper.cpp/resolve/${DEFAULT_MODEL_REVISION}/`;
const MODEL_DOWNLOAD_TIMEOUT = 10 * 60_000;

/** Loading the model takes about half a second; well short of this. */
const SERVER_READY_TIMEOUT = 20_000;
const SERVER_POLL_INTERVAL = 50;
/** The model sits on ~500MB of memory, so an idle session hands it back. */
const SERVER_IDLE_TIMEOUT = 180_000;

export interface WhisperDictationOptions {
  /** Directory holding ggml Whisper models, e.g. `<userData>/whisper`. */
  modelDirectory: string;
  /** Packaged whisper.cpp executables and their adjacent dynamic libraries. */
  binaryDirectory?: string;
  /** Test seam for platform-specific executable names and guidance. */
  platform?: NodeJS.Platform;
}

/** The packaged engine wins, while PATH remains useful for development. Dock
 * launches also need Homebrew's absolute paths because macOS omits them. */
export function dictationBinaryCandidates(
  tool: "whisper-cli" | "whisper-server",
  options: Pick<WhisperDictationOptions, "binaryDirectory" | "platform"> = {},
): string[] {
  const platform = options.platform ?? process.platform;
  const name = `${tool}${platform === "win32" ? ".exe" : ""}`;
  return [
    ...(options.binaryDirectory ? [path.join(options.binaryDirectory, name)] : []),
    ...(platform === "darwin"
      ? [`/opt/homebrew/bin/${tool}`, `/usr/local/bin/${tool}`]
      : []),
    name,
  ];
}

export function dictationUnavailableMessage(
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "win32")
    return "The Windows dictation engine is missing from this Polymux build. Reinstall Polymux to restore voice input.";
  if (platform === "darwin")
    return "The macOS dictation engine is missing from this Polymux build. Reinstall Polymux to restore voice input.";
  if (platform === "linux")
    return "The Linux dictation engine is missing from this Polymux build. Reinstall Polymux to restore voice input.";
  return "The local dictation engine is unavailable.";
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
  /** Shared so overlapping passes wait on one download rather than racing. */
  #downloading: Promise<string> | null = null;
  readonly #binaryCandidates: string[];
  readonly #serverCandidates: string[];
  readonly #platform: NodeJS.Platform;

  constructor(options: WhisperDictationOptions) {
    this.#modelDirectory = options.modelDirectory;
    this.#platform = options.platform ?? process.platform;
    this.#binaryCandidates = dictationBinaryCandidates("whisper-cli", options);
    this.#serverCandidates = dictationBinaryCandidates("whisper-server", options);
  }

  /**
   * Puts the model on the machine ahead of the first recording, so pressing
   * the microphone transcribes rather than waiting on a download. Called
   * during setup and when the composer mounts; a no-op once the model is
   * there, and overlapping calls share the one download.
   */
  async prepare(): Promise<void> {
    await this.#modelPath();
  }

  /**
   * @param final Whether this is the closing pass over a finished recording,
   *   whose text stays in the composer rather than being replaced by the pass
   *   behind it. Only the CLI fallback spends anything on the distinction.
   */
  async transcribe(audio: Buffer, final = true): Promise<string> {
    if (!audio.length) return "";
    // Resolved up front so a failed download surfaces once, rather than being
    // swallowed by the server path and retried by the CLI behind it.
    await this.#modelPath();
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
    const model = await this.#modelPath();
    const directory = await mkdtemp(path.join(tmpdir(), "polymux-dictation-"));
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
    const binary = this.#serverCandidates.find(
      (candidate) => !path.isAbsolute(candidate) || existsSync(candidate),
    );
    if (!binary) {
      this.#serverUnavailable = true;
      return null;
    }
    const model = await this.#modelPath();
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

  /** The installed model, downloading the default one if none is present. */
  async #modelPath(): Promise<string> {
    const installed = this.#installedModel();
    if (installed) return installed;
    this.#downloading ??= this.#downloadModel().finally(() => {
      this.#downloading = null;
    });
    return this.#downloading;
  }

  #installedModel(): string | null {
    for (const name of MODEL_NAMES) {
      const candidate = path.join(this.#modelDirectory, name);
      if (existsSync(candidate)) return candidate;
    }
    return null;
  }

  /** Written to a sibling temp file and renamed, so an interrupted download
   * cannot leave a truncated model that whisper would then fail to load. */
  async #downloadModel(): Promise<string> {
    const destination = path.join(this.#modelDirectory, DEFAULT_MODEL_NAME);
    await mkdir(this.#modelDirectory, { recursive: true });
    const partial = `${destination}.partial`;
    try {
      const response = await fetch(`${MODEL_BASE_URL}${DEFAULT_MODEL_NAME}`, {
        signal: AbortSignal.timeout(MODEL_DOWNLOAD_TIMEOUT),
      });
      if (!response.ok || !response.body)
        throw new Error(`the download returned ${response.status}`);
      const hash = createHash("sha256");
      let bytes = 0;
      const verifying = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytes += chunk.byteLength;
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      await pipeline(
        Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
        verifying,
        createWriteStream(partial),
      );
      const actual = hash.digest("hex");
      if (bytes !== DEFAULT_MODEL_BYTES || actual !== DEFAULT_MODEL_SHA256)
        throw new Error(
          `the model checksum did not match (expected ${DEFAULT_MODEL_SHA256}, got ${actual})`,
        );
      await rename(partial, destination);
      return destination;
    } catch (error) {
      await rm(partial, { force: true });
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Could not download the dictation model (${detail}). Put ${DEFAULT_MODEL_NAME} from huggingface.co/ggerganov/whisper.cpp in ${this.#modelDirectory} to use dictation offline.`,
      );
    }
  }

  async #runBinary(args: string[]): Promise<{ stdout: string }> {
    let missing: unknown;
    for (const binary of this.#binaryCandidates) {
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
      ? new Error(dictationUnavailableMessage(this.#platform))
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
