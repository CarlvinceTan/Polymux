import { spawn } from "node:child_process";
import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";

export async function ensureTuiHost(options: {
  entry: string;
  root: string;
  ready: () => Promise<boolean>;
  timeoutMs?: number;
}): Promise<void> {
  if (await options.ready()) return;
  if (options.entry.endsWith(".ts"))
    throw new Error("Build the CLI first with npm run build:cli.");
  await mkdir(options.root, { recursive: true, mode: 0o700 });
  const logPath = path.join(options.root, "host.log");
  const log = await open(logPath, "a", 0o600);
  const child = spawn(
    process.execPath,
    [options.entry, "host", "serve", "--no-pairing"],
    {
      detached: true,
      stdio: ["ignore", log.fd, log.fd],
      env: { ...process.env, POLYMUX_HOME: options.root },
    },
  );
  let failure: Error | undefined;
  let exited = false;
  child.once("error", (error) => {
    failure = error;
    exited = true;
  });
  child.once("exit", () => {
    exited = true;
  });
  child.unref();
  await log.close();
  const deadline = Date.now() + (options.timeoutMs ?? 20_000);
  while (Date.now() < deadline) {
    if (await options.ready()) return;
    if (exited) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  // Only this newly launched process is stopped on a failed bootstrap.
  if (!exited) child.kill("SIGTERM");
  if (failure) throw failure;
  // Keep daemon logs out of terminal output: provider errors may contain private details.
  throw new Error(`The local Host did not become ready. Check ${logPath}.`);
}

export async function localHostReady(root: string): Promise<boolean> {
  try {
    const [state, secret] = await Promise.all([
      readFile(path.join(root, "host", "state.json"), "utf8").then(JSON.parse),
      readFile(path.join(root, "config", "host-admin-token"), "utf8"),
    ]);
    const endpoint = new URL(state.localEndpoint || state.endpoint);
    if (
      endpoint.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)
    )
      return false;
    const response = await fetch(
      `${endpoint.origin}/polymux-host/v1/admin/account`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret.trim()}`,
          "content-type": "application/json",
        },
        body: '{"action":"status"}',
        signal: AbortSignal.timeout(1500),
      },
    );
    // A reachable older Host needs an explicit update, never a competing daemon.
    return response.status !== 401 && response.status !== 403;
  } catch {
    return false;
  }
}
