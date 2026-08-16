import type { AgentTool, AgentToolContext, AgentToolResult } from "@flareai/core";
import type { JsonObject } from "@flareai/inference";

export interface ToolEnvironment {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  shell?: string;
  outputLimitBytes?: number;
  outputLimitLines?: number;
  temporaryDirectory?: string;
}

export type ToolFactory = (environment: ToolEnvironment) => AgentTool;

export function stringInput(
  input: JsonObject,
  key: string,
  tool: string,
): string {
  const value = input[key];
  if (typeof value !== "string")
    throw new Error(`${tool}.${key} must be a string`);
  return value;
}

export type { AgentTool, AgentToolContext, AgentToolResult };
