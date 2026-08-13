import type { ToolEnvironment } from "../types.js";
import { createReadTool } from "./read.js";
import { createWriteTool } from "./write.js";
import { createEditTool } from "./edit.js";
import { createBashTool } from "./bash.js";

export { createReadTool, createWriteTool, createEditTool, createBashTool };
export function createNativeTools(environment: ToolEnvironment) {
  return [
    createReadTool(environment),
    createBashTool(environment),
    createEditTool(environment),
    createWriteTool(environment),
  ];
}
