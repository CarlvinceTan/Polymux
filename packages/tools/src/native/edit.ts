import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { JsonObject } from "@flareai/inference";
import type { AgentTool, ToolEnvironment } from "../types.js";
import { stringInput, workingDirectory } from "../types.js";
import { withFileMutation } from "../mutation-queue.js";

type Replacement = { oldText: string; newText: string };

function replacements(input: JsonObject): Replacement[] {
  if (!Array.isArray(input.edits) || input.edits.length === 0)
    throw new Error("edit.edits must be a non-empty array");
  return input.edits.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error(`edit.edits[${index}] must be an object`);
    const item = value as JsonObject;
    return {
      oldText: stringInput(item, "oldText", `edit.edits[${index}]`),
      newText: stringInput(item, "newText", `edit.edits[${index}]`),
    };
  });
}

export function createEditTool(environment: ToolEnvironment): AgentTool {
  return {
    name: "edit",
    description: "Edit one file using exact, unique text replacements.",
    executionMode: "parallel",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        edits: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              oldText: { type: "string" },
              newText: { type: "string" },
            },
            required: ["oldText", "newText"],
            additionalProperties: false,
          },
        },
      },
      required: ["path", "edits"],
      additionalProperties: false,
    },
    async execute(input, context) {
      const path = resolve(
        workingDirectory(environment, context),
        stringInput(input, "path", "edit"),
      );
      const edits = replacements(input);
      await withFileMutation(path, async () => {
        let content = await readFile(path, "utf8");
        for (const [index, edit] of edits.entries()) {
          if (!edit.oldText)
            throw new Error(`edit.edits[${index}].oldText cannot be empty`);
          const first = content.indexOf(edit.oldText);
          if (first < 0)
            throw new Error(`edit.edits[${index}].oldText was not found`);
          if (content.indexOf(edit.oldText, first + edit.oldText.length) >= 0)
            throw new Error(`edit.edits[${index}].oldText is not unique`);
          content =
            content.slice(0, first) +
            edit.newText +
            content.slice(first + edit.oldText.length);
        }
        await writeFile(path, content, "utf8");
      });
      return {
        content: `Applied ${edits.length} edit${edits.length === 1 ? "" : "s"} to ${path}`,
        metadata: { path, edits: edits.length },
      };
    },
  };
}
