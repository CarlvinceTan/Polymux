import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { AgentTool, ToolEnvironment } from "../types.js";
import { stringInput } from "../types.js";
import { withFileMutation } from "../mutation-queue.js";

export function createWriteTool(environment: ToolEnvironment): AgentTool {
  return {
    name: "write",
    description: "Create a file or replace its complete contents.",
    executionMode: "parallel",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
      additionalProperties: false,
    },
    async execute(input) {
      const path = resolve(
        environment.cwd,
        stringInput(input, "path", "write"),
      );
      const content = stringInput(input, "content", "write");
      await withFileMutation(path, async () => {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, content, "utf8");
      });
      return {
        content: `Wrote ${Buffer.byteLength(content)} bytes to ${path}`,
        metadata: { path, bytes: Buffer.byteLength(content) },
      };
    },
  };
}
