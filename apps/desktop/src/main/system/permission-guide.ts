import {spawn, type ChildProcess} from "node:child_process";
import path from "node:path";
import {app, systemPreferences} from "electron";
import {SwiftHelper} from "./swift-helper.js";

/** Resolve the running app, never a similarly named copy in /Applications. */
export function permissionAppBundle(executable: string): string {
  let directory = path.dirname(executable);
  while (directory !== path.dirname(directory)) {
    if (directory.endsWith(".app")) return directory;
    directory = path.dirname(directory);
  }
  throw new Error("The running Polymux application bundle could not be found.");
}

/** One non-activating native drag source for this desktop instance. */
export class PermissionGuide {
  readonly #helper: SwiftHelper;
  #child?: ChildProcess;
  #opening?: Promise<void>;
  #poll?: ReturnType<typeof setInterval>;
  #closed = false;
  #generation = 0;

  constructor(sourcePath: string, cacheDirectory: string) {
    this.#helper = new SwiftHelper({name: "permission-guide", sourcePath, cacheDirectory});
  }

  open(): Promise<void> {
    if (process.platform !== "darwin" || this.#closed) return Promise.resolve();
    if (this.#child) return Promise.resolve();
    if (!this.#opening) {
      const opening = this.#open().finally(() => {
        if (this.#opening === opening) this.#opening = undefined;
      });
      this.#opening = opening;
    }
    return this.#opening;
  }

  async #open(): Promise<void> {
    const generation = this.#generation;
    const binary = await this.#helper.binary();
    if (this.#closed || generation !== this.#generation || systemPreferences.getMediaAccessStatus("screen") === "granted") return;
    const child = spawn(binary, [permissionAppBundle(app.getPath("exe")), String(process.pid)], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.#child = child;
    child.stderr?.resume();
    child.once("exit", () => {
      if (this.#child !== child) return;
      this.#child = undefined;
      clearInterval(this.#poll);
    });
    // Resolve only after AppKit has built the panel. Spawn success alone does
    // not establish that the helper survived startup.
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error("The permission helper could not open. Try the settings link again.")), 10_000);
      const finish = (error?: Error) => {
        clearTimeout(timeout);
        child.removeListener("error", failed);
        child.removeListener("exit", exited);
        child.stdout?.removeListener("data", ready);
        if (error) { child.kill(); reject(error); } else resolve();
      };
      const failed = (error: Error) => {
        if (this.#child === child) this.#child = undefined;
        finish(error);
      };
      const exited = () => finish(generation !== this.#generation ? undefined : new Error("The permission helper closed before it was ready."));
      const ready = (data: Buffer) => { if (data.toString().includes("ready")) finish(); };
      child.once("error", failed);
      child.once("exit", exited);
      child.stdout?.on("data", ready);
    });
    if (this.#child !== child) return;
    this.#poll = setInterval(() => {
      if (systemPreferences.getMediaAccessStatus("screen") === "granted") child.kill();
    }, 1500);
    this.#poll.unref();
  }

  dismiss(): void {
    ++this.#generation;
    this.#opening = undefined;
    clearInterval(this.#poll);
    this.#child?.kill();
    this.#child = undefined;
  }

  close(): void {
    this.#closed = true;
    this.dismiss();
  }
}
