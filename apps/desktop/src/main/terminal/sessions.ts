import {randomUUID} from "node:crypto";
import type {TerminalAttachDto, TerminalCreateDto, TerminalEventDto} from "@polymux/protocol";
import {ensurePtyHost} from "./pty-host.js";
import {TerminalSession} from "./session.js";

export interface TerminalSessionsOptions {
  sourcePath: string;
  cacheDirectory: string;
  onEvent: (event: TerminalEventDto) => void;
}

/** Every live PTY, keyed by the id returned from `create`. */
export class TerminalSessions {
  readonly #options: TerminalSessionsOptions;
  readonly #sessions = new Map<string, TerminalSession>();

  constructor(options: TerminalSessionsOptions) {
    this.#options = options;
    void this.warm();
  }

  get size(): number {
    return this.#sessions.size;
  }

  has(id: string): boolean {
    return this.#sessions.has(id);
  }

  /** Compiles the PTY helper before the first tab opens. */
  warm(): Promise<void> {
    if (process.platform === "win32") return Promise.resolve();
    return ensurePtyHost({
      sourcePath: this.#options.sourcePath,
      cacheDirectory: this.#options.cacheDirectory,
    }).then((): void => {}).catch(() => {});
  }

  create(cwd?: string): TerminalCreateDto {
    const id = randomUUID();
    const session = new TerminalSession({
      id,
      sourcePath: this.#options.sourcePath,
      cacheDirectory: this.#options.cacheDirectory,
      cwd,
      onEvent: (event) => {
        if (event.type === "exit") this.#sessions.delete(id);
        this.#options.onEvent(event);
      },
    });
    this.#sessions.set(id, session);
    return {id};
  }

  attach(id: string, cols: number, rows: number): Promise<TerminalAttachDto> {
    return this.#require(id).attach(cols, rows);
  }

  write(id: string, data: string): void {
    this.#require(id).write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    this.#require(id).resize(cols, rows);
  }

  close(id: string): void {
    const session = this.#sessions.get(id);
    if (!session) return;
    this.#sessions.delete(id);
    session.close();
  }

  closeAll(): void {
    for (const id of [...this.#sessions.keys()]) this.close(id);
  }

  #require(id: string): TerminalSession {
    const session = this.#sessions.get(id);
    if (!session) throw new Error("Unknown terminal session");
    return session;
  }
}
