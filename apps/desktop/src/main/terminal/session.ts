import {spawn, type ChildProcess} from "node:child_process";
import {homedir} from "node:os";
import type {TerminalAttachDto, TerminalEventDto} from "@polymux/protocol";
import {ensurePtyHost} from "./pty-host.js";

const REPLAY_LIMIT = 256 * 1024;

export interface TerminalSessionOptions {
  id: string;
  sourcePath: string;
  cacheDirectory: string;
  cwd?: string;
  onEvent: (event: TerminalEventDto) => void;
}

/** One login shell. The workspace and IDE both hold these in a session map. */
export class TerminalSession {
  readonly id: string;
  readonly #options: TerminalSessionOptions;
  #child?: ChildProcess;
  #control?: NodeJS.WritableStream;
  #replay: Buffer[] = [];
  #replayBytes = 0;
  #seq = 0;
  #cols = 80;
  #rows = 24;
  #cwd = homedir();
  #pendingWrites: string[] = [];
  #starting?: Promise<void>;
  #closing = false;
  #exited = false;

  constructor(options: TerminalSessionOptions) {
    this.id = options.id;
    this.#options = options;
    if (options.cwd) this.#cwd = options.cwd;
    void this.warm();
  }

  /** Compiles the PTY helper before the first tab opens. */
  warm(): Promise<void> {
    if (process.platform === "win32") return Promise.resolve();
    return ensurePtyHost({
      sourcePath: this.#options.sourcePath,
      cacheDirectory: this.#options.cacheDirectory,
    }).then((): void => {}).catch(() => {});
  }

  async attach(cols: number, rows: number): Promise<TerminalAttachDto> {
    this.#setSize(cols, rows);
    await this.#ensureStarted();
    this.#applySize();
    return {
      id: this.id,
      seq: this.#seq,
      replay: Buffer.concat(this.#replay).toString("base64"),
    };
  }

  write(data: string): void {
    const stdin = this.#child?.stdin;
    if (stdin && !stdin.destroyed) {
      stdin.write(data);
      return;
    }
    this.#pendingWrites.push(data);
  }

  resize(cols: number, rows: number): void {
    this.#setSize(cols, rows);
    this.#applySize();
  }

  close(): void {
    this.#closing = true;
    const child = this.#child;
    this.#child = undefined;
    this.#control = undefined;
    this.#pendingWrites = [];
    if (!child || child.killed) {
      this.#emitExit(null);
      return;
    }
    child.kill("SIGHUP");
    setTimeout(() => {
      if (!child.killed) child.kill("SIGKILL");
    }, 1500).unref?.();
  }

  async #ensureStarted(): Promise<void> {
    if (this.#closing) throw new Error("Terminal is closing");
    if (this.#child && !this.#child.killed) return;
    this.#starting ??= this.#spawn().finally(() => {
      this.#starting = undefined;
    });
    await this.#starting;
  }

  async #spawn(): Promise<void> {
    this.#replay = [];
    this.#replayBytes = 0;
    if (process.platform === "win32") {
      this.#listen(spawnWindowsShell(this.#cols, this.#rows, this.#cwd));
      return;
    }
    const binary = await ensurePtyHost({
      sourcePath: this.#options.sourcePath,
      cacheDirectory: this.#options.cacheDirectory,
    });
    if (this.#closing) return;
    const child = spawn(
      binary,
      [
        "--shell",
        process.env.SHELL || "/bin/zsh",
        "--cwd",
        this.#cwd,
        "--cols",
        String(this.#cols),
        "--rows",
        String(this.#rows),
      ],
      {
        env: terminalEnv(this.#cols, this.#rows),
        stdio: ["pipe", "pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    this.#control = child.stdio[3] as NodeJS.WritableStream | undefined;
    this.#listen(child);
  }

  #listen(child: ChildProcess): void {
    if (this.#closing) {
      child.kill("SIGKILL");
      return;
    }
    this.#child = child;
    const receive = (chunk: Buffer | string) => {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      this.#pushReplay(data);
      this.#seq += 1;
      this.#options.onEvent({
        type: "data",
        id: this.id,
        seq: this.#seq,
        data: data.toString("base64"),
      });
    };
    child.stdout?.on("data", receive);
    child.stderr?.on("data", receive);
    child.once("close", (code) => {
      if (this.#child === child) this.#child = undefined;
      this.#control = undefined;
      this.#emitExit(code);
    });
    child.once("error", (error) => {
      if (this.#child === child) this.#child = undefined;
      this.#control = undefined;
      this.#seq += 1;
      this.#options.onEvent({
        type: "data",
        id: this.id,
        seq: this.#seq,
        data: Buffer.from(`\r\n${error.message}\r\n`).toString("base64"),
      });
    });
    this.#flushWrites();
  }

  #emitExit(code: number | null): void {
    if (this.#exited) return;
    this.#exited = true;
    this.#closing = true;
    this.#seq += 1;
    this.#options.onEvent({type: "exit", id: this.id, seq: this.#seq, code});
  }

  #flushWrites(): void {
    const stdin = this.#child?.stdin;
    if (!stdin || stdin.destroyed) return;
    for (const chunk of this.#pendingWrites) stdin.write(chunk);
    this.#pendingWrites = [];
  }

  #pushReplay(chunk: Buffer): void {
    this.#replay.push(chunk);
    this.#replayBytes += chunk.byteLength;
    while (this.#replayBytes > REPLAY_LIMIT && this.#replay.length > 1) {
      const oldest = this.#replay.shift();
      if (!oldest) break;
      this.#replayBytes -= oldest.byteLength;
    }
  }

  #setSize(cols: number, rows: number): void {
    const size = windowSize(cols, rows);
    this.#cols = size.cols;
    this.#rows = size.rows;
  }

  #applySize(): void {
    this.#control?.write(`resize ${this.#cols} ${this.#rows}\n`);
  }
}

function windowSize(cols: number, rows: number): {cols: number; rows: number} {
  return {
    cols: Number.isFinite(cols) ? Math.min(400, Math.max(2, Math.round(cols))) : 80,
    rows: Number.isFinite(rows) ? Math.min(200, Math.max(2, Math.round(rows))) : 24,
  };
}

function terminalEnv(cols: number, rows: number): NodeJS.ProcessEnv {
  const env = {...process.env};
  delete env.ELECTRON_RUN_AS_NODE;
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  env.COLUMNS = String(cols);
  env.LINES = String(rows);
  return env;
}

function spawnWindowsShell(cols: number, rows: number, cwd: string): ChildProcess {
  const shell = process.env.COMSPEC || "powershell.exe";
  const powershell = /powershell/i.test(shell);
  return spawn(
    shell,
    powershell ? ["-NoLogo"] : [],
    {
      cwd,
      env: terminalEnv(cols, rows),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    },
  );
}
