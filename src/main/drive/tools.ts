import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import type {AgentTool} from "@flareai/core";
import type {Drive} from "./index.js";

/**
 * Agent tools for the storage the user has connected in Settings → Drive.
 *
 * The native `read`/`write`/`edit` tools already cover this Mac, where the
 * agent works by default. These exist for everywhere else: a file on the user's
 * Google Drive is not reachable by path, and without them the agent could only
 * ever tell the user to fetch it themselves.
 *
 * Every configured account is writable — the user asked for one agent that can
 * act across all of their drives, not a reader with a separate blessed one.
 */
export function createDriveTools(drive: Drive): AgentTool[] {
  return [
    createSourcesTool(drive),
    createListTool(drive),
    createReadTool(drive),
    createWriteTool(drive),
    createFolderTool(drive),
    createMoveTool(drive),
    createDeleteTool(drive),
  ];
}

/** How much of a file the agent is handed at once. Past this the content stops
 * being something a model can use and starts being something that fills its
 * context window. */
const READ_LIMIT_BYTES = 512 * 1024;

function ok(value: unknown): {content: string} {
  return {content: JSON.stringify(value, null, 2)};
}

function failed(error: unknown): {content: string; isError: true} {
  return {
    content: error instanceof Error ? error.message : String(error),
    isError: true,
  };
}

function text(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value === "")
    throw new Error(`drive.${key} is required`);
  return value;
}

/** Paths are a list in the tools that take one, so a single string is accepted
 * too rather than failing on the obvious shorthand. */
function paths(input: Record<string, unknown>, key: string): string[] {
  const value = input[key];
  if (typeof value === "string" && value) return [value];
  if (Array.isArray(value)) {
    const list = value.filter((entry): entry is string => typeof entry === "string");
    if (list.length) return list;
  }
  throw new Error(`drive.${key} must be a path or a list of paths`);
}

const SOURCE_PARAM = {
  type: "string",
  description:
    "Which storage to act on, as returned by drive_sources — e.g. local#outputs, local#home, google-drive#<account>.",
} as const;

const PATH_PARAM = {
  type: "string",
  description:
    "The entry's path in that source's own addressing, exactly as drive_list returned it. Empty means the source's root.",
} as const;

function createSourcesTool(drive: Drive): AgentTool {
  return {
    name: "drive_sources",
    description:
      "List the storage the user has connected: their output folder, this Mac, and every signed-in cloud drive account. Returns the source ids every other drive_* tool takes. Call this first when the user names a drive rather than a path.",
    parameters: {type: "object", properties: {}, additionalProperties: false},
    async execute() {
      try {
        const status = await drive.status();
        return ok(
          status.sources.map((source) => ({
            source: source.id,
            name: source.accountLabel
              ? `${source.name} – ${source.accountLabel}`
              : source.name,
            provider: source.provider,
            connected: source.state === "connected",
            root: source.root,
            error: source.error,
          })),
        );
      } catch (error) {
        return failed(error);
      }
    },
  };
}

function createListTool(drive: Drive): AgentTool {
  return {
    name: "drive_list",
    description:
      "List one folder's contents in a connected storage source. Pass the path of a folder from a previous listing to descend into it; omit it for the source's root.",
    parameters: {
      type: "object",
      properties: {source: SOURCE_PARAM, path: PATH_PARAM},
      required: ["source"],
      additionalProperties: false,
    },
    async execute(input) {
      try {
        const entries = await drive.list(
          text(input, "source"),
          typeof input.path === "string" ? input.path : "",
        );
        return ok(
          entries.map((entry) => ({
            name: entry.name,
            path: entry.path,
            kind: entry.kind,
            size: entry.size,
            modified_at: entry.modifiedAt,
          })),
        );
      } catch (error) {
        return failed(error);
      }
    },
  };
}

function createReadTool(drive: Drive): AgentTool {
  return {
    name: "drive_read",
    description:
      "Read a text file out of a connected storage source. The file is fetched to a temporary location and its contents returned; binary files are refused rather than returned as noise.",
    parameters: {
      type: "object",
      properties: {source: SOURCE_PARAM, path: PATH_PARAM},
      required: ["source", "path"],
      additionalProperties: false,
    },
    async execute(input) {
      let scratch: string | null = null;
      try {
        const target = text(input, "path");
        scratch = await mkdtemp(path.join(tmpdir(), "flareai-drive-"));
        const local = path.join(scratch, path.basename(target) || "download");
        // Into scratch rather than through `download`, which lands in the
        // user's downloads folder: reading a file is not meant to leave a copy
        // of it behind.
        await drive.downloadTo(text(input, "source"), target, local);
        const buffer = await readFile(local);
        if (buffer.length > READ_LIMIT_BYTES)
          throw new Error(
            `${target} is ${buffer.length} bytes, past the ${READ_LIMIT_BYTES} byte read limit. Ask the user to narrow it down.`,
          );
        // A NUL byte in the first stretch is the usual tell for a binary file,
        // and decoding one produces replacement characters rather than an error.
        if (buffer.subarray(0, 8_000).includes(0))
          throw new Error(
            `${target} looks like a binary file, so there is no text to read.`,
          );
        return {content: buffer.toString("utf8")};
      } catch (error) {
        return failed(error);
      } finally {
        if (scratch) await rm(scratch, {recursive: true, force: true});
      }
    },
  };
}

function createWriteTool(drive: Drive): AgentTool {
  return {
    name: "drive_write",
    description:
      "Save a text file into a folder of a connected storage source, replacing a file of the same name. Use this to put work onto the user's Google Drive, Dropbox, OneDrive or S3; for files on this Mac the plain write tool is simpler.",
    parameters: {
      type: "object",
      properties: {
        source: SOURCE_PARAM,
        folder: {
          type: "string",
          description: "The destination folder's path. Empty means the root.",
        },
        name: {type: "string", description: "The file's name, with extension."},
        content: {type: "string"},
      },
      required: ["source", "name", "content"],
      additionalProperties: false,
    },
    async execute(input) {
      let scratch: string | null = null;
      try {
        const source = text(input, "source");
        const name = text(input, "name");
        // A name carrying a path would write outside the folder the caller
        // named, which is not what a file name means.
        if (name.includes("/") || name.includes("\\"))
          throw new Error("drive.name must be a file name, not a path.");
        const folder = typeof input.folder === "string" ? input.folder : "";
        const content = typeof input.content === "string" ? input.content : "";

        scratch = await mkdtemp(path.join(tmpdir(), "flareai-drive-"));
        const local = path.join(scratch, name);
        await writeFile(local, content, "utf8");

        // Upload is create-or-replace on every adapter, so an existing file of
        // the same name is overwritten rather than duplicated.
        const [entry] = await drive.upload(source, folder, [local]);
        return ok({
          saved: entry?.path ?? `${folder}/${name}`,
          bytes: Buffer.byteLength(content),
        });
      } catch (error) {
        return failed(error);
      } finally {
        if (scratch) await rm(scratch, {recursive: true, force: true});
      }
    },
  };
}

function createFolderTool(drive: Drive): AgentTool {
  return {
    name: "drive_create_folder",
    description:
      "Create a folder inside a connected storage source.",
    parameters: {
      type: "object",
      properties: {
        source: SOURCE_PARAM,
        parent: {
          type: "string",
          description: "The parent folder's path. Empty means the root.",
        },
        name: {type: "string"},
      },
      required: ["source", "name"],
      additionalProperties: false,
    },
    async execute(input) {
      try {
        const entry = await drive.createFolder(
          text(input, "source"),
          typeof input.parent === "string" ? input.parent : "",
          text(input, "name"),
        );
        return ok({created: entry.path});
      } catch (error) {
        return failed(error);
      }
    },
  };
}

function createMoveTool(drive: Drive): AgentTool {
  return {
    name: "drive_move",
    description:
      "Move entries into another folder of the same storage source. Moving between two different sources is not supported — read the file and write it to the other source instead.",
    parameters: {
      type: "object",
      properties: {
        source: SOURCE_PARAM,
        paths: {
          oneOf: [{type: "string"}, {type: "array", items: {type: "string"}}],
          description: "The entries to move.",
        },
        destination: {
          type: "string",
          description: "The destination folder's path. Empty means the root.",
        },
      },
      required: ["source", "paths"],
      additionalProperties: false,
    },
    async execute(input) {
      try {
        const moved = await drive.move(
          text(input, "source"),
          paths(input, "paths"),
          typeof input.destination === "string" ? input.destination : "",
        );
        return ok({moved: moved.map((entry) => entry.path)});
      } catch (error) {
        return failed(error);
      }
    },
  };
}

function createDeleteTool(drive: Drive): AgentTool {
  return {
    name: "drive_delete",
    description:
      "Delete entries from a connected storage source. Deleting a folder takes everything inside it. This is not reversible on every provider, so name only what the user asked to remove.",
    parameters: {
      type: "object",
      properties: {
        source: SOURCE_PARAM,
        paths: {
          oneOf: [{type: "string"}, {type: "array", items: {type: "string"}}],
          description: "The entries to delete.",
        },
      },
      required: ["source", "paths"],
      additionalProperties: false,
    },
    async execute(input) {
      try {
        const targets = paths(input, "paths");
        await drive.remove(text(input, "source"), targets);
        return ok({deleted: targets});
      } catch (error) {
        return failed(error);
      }
    },
  };
}
