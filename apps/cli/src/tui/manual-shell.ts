import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export function shellInput(
  text: string,
): { command: string; excluded: boolean } | undefined {
  const match = text.trimStart().match(/^(!{1,2})\s+([\s\S]*)$/);
  return match?.[2].trim()
    ? { command: match[2].trim(), excluded: match[1] === "!!" }
    : undefined;
}
const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
async function directory(value: unknown): Promise<boolean> {
  if (typeof value !== "string" || !path.isAbsolute(value)) return false;
  try {
    return (await stat(value)).isDirectory();
  } catch {
    return false;
  }
}

/** Local manual commands have their own directory; never change Host/agent cwd. */
export class ManualShell {
  cwd: string;
  private previous: string;
  private stateFile: string;
  private cancelRun?: () => void;
  get running() {
    return !!this.cancelRun;
  }
  constructor(cwd: string, settingsHome: string, conversationId: string) {
    this.cwd = this.previous = cwd;
    const key = createHash("sha256").update(conversationId).digest("hex");
    this.stateFile = path.join(settingsHome, "tui-shell", `${key}.json`);
  }
  async restore() {
    try {
      const saved = JSON.parse(await readFile(this.stateFile, "utf8"));
      if (await directory(saved.cwd)) this.cwd = saved.cwd;
      if (await directory(saved.previous)) this.previous = saved.previous;
    } catch {
      /* A new session starts in the workspace. */
    }
  }
  cancel() {
    this.cancelRun?.();
  }
  async run(
    command: string,
    output: (text: string) => void,
  ): Promise<{ exitCode: number; cancelled: boolean }> {
    if (this.running) throw new Error("Wait for the shell command to finish.");
    if (process.platform === "win32")
      throw new Error("Manual shell commands require Bash.");
    // Reserve the shell before async setup so rapid submissions cannot overlap.
    let cancelled = false;
    this.cancelRun = () => {
      cancelled = true;
    };
    let temp: string | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      temp = await mkdtemp(path.join(tmpdir(), "polymux-shell-"));
      const state = path.join(temp, "cwd");
      const capture = `builtin printf '%s\\0%s\\0' "$PWD" "$OLDPWD" > ${quote(state)}`;
      const wrapped = `export OLDPWD=${quote(this.previous)}\ntrap ${quote(capture)} EXIT\neval ${quote(command)}`;
      if (cancelled) return { exitCode: 130, cancelled };
      const child = spawn("/bin/bash", ["-c", wrapped], {
        cwd: this.cwd,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const kill = (signal: NodeJS.Signals) => {
        try {
          if (child.pid) process.kill(-child.pid, signal);
        } catch {
          /* Already exited. */
        }
      };
      this.cancelRun = () => {
        cancelled = true;
        kill("SIGTERM");
        killTimer ??= setTimeout(() => kill("SIGKILL"), 500);
      };
      child.stdout.setEncoding("utf8").on("data", output);
      child.stderr.setEncoding("utf8").on("data", output);
      const exitCode = await new Promise<number>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code) => resolve(code ?? 130));
      });
      if (cancelled) kill("SIGKILL");
      try {
        const [cwd, previous] = (await readFile(state, "utf8")).split("\0");
        if (await directory(cwd)) {
          this.cwd = cwd;
          if (await directory(previous)) this.previous = previous;
          await mkdir(path.dirname(this.stateFile), {
            recursive: true,
            mode: 0o700,
          });
          const pending = `${this.stateFile}.${randomUUID()}.tmp`;
          try {
            await writeFile(
              pending,
              JSON.stringify({ cwd: this.cwd, previous: this.previous }),
              { mode: 0o600 },
            );
            await rename(pending, this.stateFile);
          } finally {
            await rm(pending, { force: true });
          }
        }
      } catch {
        /* Interrupted shells may not report a directory. */
      }
      return { exitCode, cancelled };
    } finally {
      if (killTimer) clearTimeout(killTimer);
      this.cancelRun = undefined;
      if (temp) await rm(temp, { recursive: true, force: true });
    }
  }
}
