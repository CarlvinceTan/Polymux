import {createWriteStream} from "node:fs";
import {mkdtemp, rm, stat} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {Readable} from "node:stream";
import {pipeline} from "node:stream/promises";
import {pathToFileURL} from "node:url";
import type {ClipboardContentDto} from "@polymux/protocol";

interface ClipboardImage {
  isEmpty(): boolean;
}

interface ClipboardWriter<Image extends ClipboardImage> {
  write(data: {text?: string; bookmark?: string}): void;
  writeBuffer(format: string, buffer: Buffer): void;
  writeImage(image: Image): void;
}

export interface ClipboardDependencies<Image extends ClipboardImage> {
  clipboard: ClipboardWriter<Image>;
  fetch(url: string): Promise<Response>;
  imageFromBuffer(buffer: Buffer): Image;
  platform?: NodeJS.Platform;
  temporaryRoot?: string;
}

/**
 * Writes one semantic value to the native clipboard. The renderer deliberately
 * sends no bytes: authenticated chat media is fetched here, and local file
 * paths never have to be exposed to browser clipboard APIs.
 */
export async function writeClipboardContent<Image extends ClipboardImage>(
  value: unknown,
  dependencies: ClipboardDependencies<Image>,
): Promise<boolean> {
  let temporaryDirectory = "";
  try {
    const content = clipboardContent(value);
    if (content.kind === "text") {
      dependencies.clipboard.write({
        text: content.text,
        ...(content.title ? {bookmark: content.title} : {}),
      });
      return true;
    }

    if (content.kind === "file") {
      const details = await stat(content.path);
      if (!details.isFile()) return false;
      writeFileReference(
        dependencies.clipboard,
        path.resolve(content.path),
        dependencies.platform ?? process.platform,
      );
      return true;
    }

    const response = await dependencies.fetch(content.url);
    if (!response.ok) return false;
    if (content.copyAs === "image") {
      const image = dependencies.imageFromBuffer(
        Buffer.from(await response.arrayBuffer()),
      );
      if (image.isEmpty()) return false;
      dependencies.clipboard.writeImage(image);
      return true;
    }

    temporaryDirectory = await mkdtemp(
      path.join(dependencies.temporaryRoot ?? tmpdir(), "polymux-clipboard-"),
    );
    const destination = path.join(
      temporaryDirectory,
      safeFileName(content.name),
    );
    if (!response.body) return false;
    await pipeline(
      Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
      createWriteStream(destination, {flags: "wx"}),
    );
    writeFileReference(
      dependencies.clipboard,
      destination,
      dependencies.platform ?? process.platform,
    );
    // A pasteboard file reference remains live after this call, so its backing
    // file must remain in the OS temporary directory until the OS clears it.
    temporaryDirectory = "";
    return true;
  } catch {
    return false;
  } finally {
    if (temporaryDirectory)
      await rm(temporaryDirectory, {recursive: true, force: true}).catch(() => {});
  }
}

function clipboardContent(value: unknown): ClipboardContentDto {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Clipboard content must be an object");
  const input = value as Record<string, unknown>;
  if (input.kind === "text") {
    const text = requiredString(input.text, "clipboard text");
    return {
      kind: "text",
      text,
      ...(typeof input.title === "string" && input.title
        ? {title: input.title}
        : {}),
    };
  }
  if (input.kind === "file")
    return {kind: "file", path: requiredString(input.path, "clipboard file")};
  if (input.kind !== "attachment") throw new Error("Unknown clipboard content");
  if (input.copyAs !== "image" && input.copyAs !== "file")
    throw new Error("Unknown clipboard attachment type");
  const url = requiredString(input.url, "clipboard attachment url");
  const protocol = new URL(url).protocol;
  if (!["polymux-media:", "http:", "https:"].includes(protocol))
    throw new Error("Unsupported clipboard attachment url");
  return {
    kind: "attachment",
    url,
    name: requiredString(input.name, "clipboard attachment name"),
    mimeType: typeof input.mimeType === "string" ? input.mimeType : null,
    copyAs: input.copyAs,
  };
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} is required`);
  return value;
}

function safeFileName(value: string): string {
  const leaf = value.split(/[\\/]/).pop()?.replace(/[\0:]/g, "-").trim();
  return leaf && leaf !== "." && leaf !== ".." ? leaf.slice(0, 240) : "Attachment";
}

function writeFileReference<Image extends ClipboardImage>(
  clipboard: ClipboardWriter<Image>,
  filePath: string,
  platform: NodeJS.Platform,
): void {
  const url = pathToFileURL(filePath).toString();
  // macOS recognises this as an actual pasteboard file, so Finder and file
  // pickers paste it as a file instead of receiving a path-shaped text value.
  const format = platform === "darwin" ? "public.file-url" : "text/uri-list";
  clipboard.writeBuffer(
    format,
    Buffer.from(`${url}${platform === "darwin" ? "" : "\r\n"}`),
  );
}
