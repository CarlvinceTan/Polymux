import type { AgentTool, AgentToolContext, AgentToolResult } from "@flareai/core";
import type { JsonObject } from "@flareai/inference";

export interface ToolEnvironment {
  /**
   * Where relative paths resolve and where `bash` runs.
   *
   * A function is resolved per call, which is what lets the host answer with
   * the folder belonging to the conversation the run is part of — the tools
   * outlive any one conversation, so a fixed string could only ever name one.
   */
  cwd: string | ((context: AgentToolContext) => string);
  env?: NodeJS.ProcessEnv;
  shell?: string;
  outputLimitBytes?: number;
  outputLimitLines?: number;
  temporaryDirectory?: string;
}

export type ToolFactory = (environment: ToolEnvironment) => AgentTool;

/** The working directory for one tool call. */
export function workingDirectory(
  environment: ToolEnvironment,
  context: AgentToolContext,
): string {
  return typeof environment.cwd === "function"
    ? environment.cwd(context)
    : environment.cwd;
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
