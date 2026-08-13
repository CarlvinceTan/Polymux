import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import type { AgentTool, ToolEnvironment } from "../types.js";
import { stringInput } from "../types.js";
import { boundOutput } from "../output.js";

const imageTypes: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export function createReadTool(environment: ToolEnvironment): AgentTool {
  return {
    name: "read",
    description:
      "Read a text file or supported image. Text output is bounded; use offset and limit to continue through large files.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        offset: { type: "number" },
        limit: { type: "number" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    async execute(input) {
      const path = resolve(environment.cwd, stringInput(input, "path", "read"));
      const mimeType = imageTypes[extname(path).toLowerCase()];
      if (mimeType)
        return {
          content: [
            {
              type: "image",
              data: (await readFile(path)).toString("base64"),
              mimeType,
            },
          ],
        };
      const offset = Math.max(
        1,
        typeof input.offset === "number" ? Math.floor(input.offset) : 1,
      );
      const limit = Math.max(
        1,
        Math.min(
          typeof input.limit === "number" ? Math.floor(input.limit) : 2_000,
          2_000,
        ),
      );
      const all = await readFile(path, "utf8");
      const lines = all.split(/\r?\n/);
      const selected = lines
        .slice(offset - 1, offset - 1 + limit)
        .map((line, index) => `${offset + index}: ${line}`)
        .join("\n");
      const bounded = boundOutput(
        selected,
        environment.outputLimitBytes,
        environment.outputLimitLines,
      );
      const suffix =
        offset - 1 + limit < lines.length
          ? `\n[${lines.length - (offset - 1 + limit)} more lines; continue with offset=${offset + limit}]`
          : "";
      return {
        content: bounded.visible + suffix,
        metadata: {
          path,
          totalLines: lines.length,
          truncated: bounded.truncated,
        },
      };
    },
  };
}
