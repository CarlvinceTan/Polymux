import {execFile} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync, readFileSync} from "node:fs";
import {mkdir, rename} from "node:fs/promises";
import path from "node:path";
import {promisify} from "node:util";
import {bundledSwiftHelperPath} from "../system/swift-helper.js";

const run = promisify(execFile);
const compiling = new Map<string, Promise<string>>();

export interface PtyHostOptions {
  sourcePath: string;
  cacheDirectory: string;
}

/** Compiles or locates the POSIX PTY helper. Windows never uses this path. */
export async function ensurePtyHost(options: PtyHostOptions): Promise<string> {
  if (process.platform === "win32")
    throw new Error("Interactive PTYs are not available on Windows yet");
  const {sourcePath, cacheDirectory} = options;
  const bundled = bundledSwiftHelperPath("pty-host", sourcePath);
  if (!process.defaultApp && existsSync(bundled)) return bundled;
  if (!existsSync(sourcePath))
    throw new Error(`Terminal helper source is missing at ${sourcePath}`);
  const revision = createHash("sha256").update(readFileSync(sourcePath)).digest("hex").slice(0, 12);
  const binary = path.join(cacheDirectory, `pty-host-${revision}`);
  if (existsSync(binary)) return binary;
  const pending = compiling.get(binary);
  if (pending) return pending;
  const work = compile(sourcePath, binary).finally(() => compiling.delete(binary));
  compiling.set(binary, work);
  return work;
}

async function compile(sourcePath: string, binary: string): Promise<string> {
  await mkdir(path.dirname(binary), {recursive: true});
  const building = `${binary}.build`;
  try {
    await run("cc", ["-O2", "-o", building, sourcePath], {
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new Error("Terminal needs a C compiler. Install the Xcode Command Line Tools: xcode-select --install");
    throw error;
  }
  await rename(building, binary);
  return binary;
}
