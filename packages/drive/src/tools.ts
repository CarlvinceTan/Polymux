import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentTool } from "@flareai/core";
import type { Drive } from "./manager.js";
import { DriveConflictError } from "./types.js";

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

/**
 * What to call the scratch copy of a drive file.
 *
 * Asking the drive rather than reading the path: for Drive and OneDrive the
 * path is an opaque id, and a Google Doc is not even the same file type once
 * it comes out. A lookup that fails is not worth failing the read over.
 */
async function readName(
  drive: Drive,
  source: string,
  target: string,
): Promise<string> {
  return drive.describe(source, target).then(
    (entry) => entry.name,
    () => path.basename(target) || "download",
  );
}

function ok(value: unknown): { content: string } {
  return { content: JSON.stringify(value, null, 2) };
}

function failed(error: unknown): { content: string; isError: true } {
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
    const list = value.filter(
      (entry): entry is string => typeof entry === "string",
    );
    if (list.length) return list;
  }
  throw new Error(`drive.${key} must be a path or a list of paths`);
}

const SOURCE_PARAM = {
  type: "string",
  description:
    "Which storage to act on, as returned by drive_sources — e.g. local#outputs, local#home, google-drive#<account>. `all#all` is every connected source as one listing.",
} as const;

const WRITE_SOURCE_PARAM = {
  type: "string",
  description:
    "Which storage to save into, as returned by drive_sources. Omit it to follow the user's save order, which is what a deliverable should normally do; name one only when the user did.",
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
      "List the storage the user has connected: their output folder, this Mac, and every signed-in cloud drive account. Returns the source ids every other drive_* tool takes. Call this first when the user names a drive rather than a path, or when you need to know what a source actually reaches — the cloud accounts are scoped to FlareAI's own folder, so files the user saved there themselves are not visible.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
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
      properties: { source: SOURCE_PARAM, path: PATH_PARAM },
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
      properties: { source: SOURCE_PARAM, path: PATH_PARAM },
      required: ["source", "path"],
      additionalProperties: false,
    },
    async execute(input) {
      let scratch: string | null = null;
      try {
        const source = text(input, "source");
        const target = text(input, "path");
        scratch = await mkdtemp(path.join(tmpdir(), "flareai-drive-"));
        // Named after the entry rather than its path: for Drive and OneDrive
        // the path is an opaque id, and the extension is what tells the agent
        // (and the binary check below) what it is looking at.
        const local = path.join(scratch, await readName(drive, source, target));
        // Into scratch rather than through `download`, which lands in the
        // user's downloads folder: reading a file is not meant to leave a copy
        // of it behind.
        await drive.downloadTo(source, target, local);
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
        return { content: buffer.toString("utf8") };
      } catch (error) {
        return failed(error);
      } finally {
        if (scratch) await rm(scratch, { recursive: true, force: true });
      }
    },
  };
}

function createWriteTool(drive: Drive): AgentTool {
  return {
    name: "drive_write",
    description:
      "Save a text file to the user's drive, replacing a file of the same name. This is where a deliverable belongs — a report, document, spreadsheet or anything else they would keep or open later. Omit `source` and it goes wherever their save order prefers; pass one when the user named a destination. Scratch and intermediate files are not deliverables: leave those on local disk with the plain write tool.",
    parameters: {
      type: "object",
      properties: {
        source: WRITE_SOURCE_PARAM,
        folder: {
          type: "string",
          description: "The destination folder's path. Empty means the root.",
        },
        name: {
          type: "string",
          description: "The file's name, with extension.",
        },
        content: { type: "string" },
      },
      required: ["name", "content"],
      additionalProperties: false,
    },
    async execute(input) {
      let scratch: string | null = null;
      try {
        // No source means the user named none, which is the ordinary case for a
        // deliverable: the virtual drive resolves it through their save order,
        // so the destination is their setting rather than this tool's guess.
        const source =
          typeof input.source === "string" && input.source.trim()
            ? text(input, "source")
            : await drive.preferredSource();
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

        // Conditional on what this run read, when it read anything: replacing
        // a file the agent never looked at is a save, while replacing one it
        // read before someone else edited it is a lost edit, and only the
        // provider can tell those apart at the moment of writing.
        const [entry] = await drive.upload(source, folder, [local], {
          expectVersions: true,
        });
        return ok({
          saved: entry?.path ?? `${folder}/${name}`,
          bytes: Buffer.byteLength(content),
        });
      } catch (error) {
        // A conflict is not a dead end, and reporting it as a bare failure
        // would make the model treat it as one. It is told what happened and
        // what to do — re-read, fold the two together, write again — and the
        // stale expectation is dropped so that re-read establishes a fresh one
        // rather than failing a second time on the same token.
        if (error instanceof DriveConflictError) {
          drive.forgetVersion(
            typeof input.source === "string" ? input.source : "",
            error.path,
          );
          return failed(
            new Error(
              `${error.path} was changed by someone else after you read it, so it was not overwritten and nothing was lost. Read it again, fold your changes into what is there now, and write it back.`,
            ),
          );
        }
        return failed(error);
      } finally {
        if (scratch) await rm(scratch, { recursive: true, force: true });
      }
    },
  };
}

function createFolderTool(drive: Drive): AgentTool {
  return {
    name: "drive_create_folder",
    description: "Create a folder inside a connected storage source.",
    parameters: {
      type: "object",
      properties: {
        source: SOURCE_PARAM,
        parent: {
          type: "string",
          description: "The parent folder's path. Empty means the root.",
        },
        name: { type: "string" },
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
        return ok({ created: entry.path });
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
          oneOf: [
            { type: "string" },
            { type: "array", items: { type: "string" } },
          ],
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
        return ok({ moved: moved.map((entry) => entry.path) });
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
          oneOf: [
            { type: "string" },
            { type: "array", items: { type: "string" } },
          ],
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
        return ok({ deleted: targets });
      } catch (error) {
        return failed(error);
      }
    },
  };
}
