export interface LaunchModeInput {
  platform: NodeJS.Platform;
  argv: readonly string[];
  hasSwitch(name: string): boolean;
  environment?: NodeJS.ProcessEnv;
}

export function requestsBackgroundLaunch(input: LaunchModeInput): boolean {
  if (input.platform !== "darwin") return false;
  return input.hasSwitch("flareai-background") ||
    input.argv.includes("--flareai-background") ||
    input.environment?.FLAREAI_BACKGROUND_LAUNCH === "1";
}

export function configuredRemoteDebuggingPort(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const port = Number(value);
  return Number.isInteger(port) && port >= 1024 && port <= 65_535 ? port : null;
}
