import {readdir, readFile, realpath, rename, stat, writeFile} from "node:fs/promises";
import path from "node:path";
import type {IdeEntryDto, IdeFileDto} from "@polymux/protocol";
import {BINARY_LANGUAGE, isBinaryFileName, languageForName} from "./language.js";
import {insideRoot, resolveInside} from "./paths.js";

// Bundled source files can be much larger than ordinary source modules.
// A size limit is an editor constraint, never evidence that a file is binary.
const MAX_TEXT_BYTES = 64 * 1024 * 1024;
const MAX_FOLDER_ENTRIES = 4000;

export class IdeService {
  async list(root: string, relative = ""): Promise<IdeEntryDto[]> {
    const folder = await this.#existing(root, relative);
    if (!(await stat(folder)).isDirectory()) throw new Error("Not a folder");
    const names = await readdir(folder);
    const entries: IdeEntryDto[] = [];
    for (const name of names) {
      if (name === ".DS_Store") continue;
      if (entries.length >= MAX_FOLDER_ENTRIES) break;
      const child = path.join(folder, name);
      try {
        const info = await stat(child);
        entries.push({
          name,
          path: relative ? `${relative}/${name}`.replaceAll("\\", "/") : name,
          kind: info.isDirectory() ? "folder" : "file",
        });
      } catch {
        // A name that vanished between readdir and stat is skipped.
      }
    }
    return entries.sort(compareEntries);
  }

  async read(root: string, relative: string): Promise<IdeFileDto> {
    const file = await this.#existing(root, relative);
    const info = await stat(file);
    if (info.isDirectory()) throw new Error("Not a file");
    const name = path.basename(file);
    if (isBinaryFileName(name)) {
      return {name, path: relative, language: BINARY_LANGUAGE, binary: true, content: null};
    }
    if (info.size > MAX_TEXT_BYTES) throw new Error("File is too large to open (limit: 64 MiB)");
    const bytes = await readFile(file);
    if (looksBinary(bytes)) {
      return {name, path: relative, language: BINARY_LANGUAGE, binary: true, content: null};
    }
    const content = bytes.toString("utf8");
    return {name, path: relative, language: languageForName(name, content), binary: false, content};
  }

  async write(root: string, relative: string, content: string): Promise<void> {
    const file = await this.#existing(root, relative);
    const info = await stat(file);
    if (info.isDirectory()) throw new Error("Not a file");
    await writeFile(file, content, "utf8");
  }

  async create(root: string, relative: string, content = ""): Promise<IdeFileDto> {
    const dest = await this.#writable(root, relative);
    if (await exists(dest)) throw new Error("Already exists");
    await writeFile(dest, content, {encoding: "utf8", flag: "wx"});
    return this.read(root, relative.replaceAll("\\", "/"));
  }

  async move(root: string, from: string, to: string): Promise<IdeFileDto> {
    const source = await this.#existing(root, from);
    const info = await stat(source);
    if (info.isDirectory()) throw new Error("Not a file");
    const dest = await this.#writable(root, to);
    if (path.resolve(source) === path.resolve(dest)) return this.read(root, to.replaceAll("\\", "/"));
    if (await exists(dest)) throw new Error("Already exists");
    await rename(source, dest);
    return this.read(root, to.replaceAll("\\", "/"));
  }

  async #existing(root: string, relative: string): Promise<string> {
    const candidate = resolveInside(root, relative);
    const realRoot = await realpath(root);
    const realTarget = await realpath(candidate);
    if (!insideRoot(realRoot, realTarget)) throw new Error("Path is outside the project");
    return realTarget;
  }

  /** Resolve a path that may not exist yet. The parent folder must already be inside the project. */
  async #writable(root: string, relative: string): Promise<string> {
    const candidate = resolveInside(root, relative);
    const base = path.basename(candidate);
    if (!base || base === "." || base === "..") throw new Error("Invalid name");
    const parent = path.dirname(candidate);
    const realRoot = await realpath(root);
    let realParent: string;
    try {
      realParent = await realpath(parent);
    } catch (reason) {
      if (isEnoent(reason)) throw new Error("Folder not found");
      throw reason;
    }
    if (!insideRoot(realRoot, realParent)) throw new Error("Path is outside the project");
    const dest = path.join(realParent, base);
    if (!insideRoot(realRoot, dest)) throw new Error("Path is outside the project");
    return dest;
  }
}

function compareEntries(a: IdeEntryDto, b: IdeEntryDto): number {
  if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, {sensitivity: "base"});
}

function looksBinary(bytes: Buffer): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8000));
  return sample.includes(0);
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch (reason) {
    if (isEnoent(reason)) return false;
    throw reason;
  }
}

function isEnoent(reason: unknown): boolean {
  return Boolean(reason && typeof reason === "object" && "code" in reason && reason.code === "ENOENT");
}
