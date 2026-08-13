import type { AgentTool, AgentToolContext, AgentToolResult } from "@midas/core";
import type { JsonObject } from "@midas/inference";

export interface ToolEnvironment {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  shell?: string;
  outputLimitBytes?: number;
  outputLimitLines?: number;
  temporaryDirectory?: string;
}

export type ToolFactory = (environment: ToolEnvironment) => AgentTool;

export function objectInput(value: JsonObject, tool: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${tool} input must be an object`);
  return value;
}

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
