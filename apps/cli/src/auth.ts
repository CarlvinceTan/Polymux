import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline/promises";
import { stdin, stdout, stderr } from "node:process";
import type { AccountStatusDto, JsonValue } from "@polymux/protocol";
import { promptSecret, secretFromStdin } from "./secrets.js";

export const AUTH_CALLBACK_PORT = 47667;
type Flags = {
  positional: string[];
  [key: string]: string | boolean | string[];
};
export type AccountRequest = <T>(
  request: Record<string, JsonValue>,
) => Promise<T>;
export interface Status extends AccountStatusDto {
  device: { registered: boolean; syncing: boolean; error: string | null };
  connectedDevices: Array<{ deviceName: string }>;
}
const flag = (flags: Flags, name: string) =>
  typeof flags[name] === "string" ? (flags[name] as string) : undefined;

export async function authCommand(
  action: string,
  flags: Flags,
  request: AccountRequest,
): Promise<void> {
  if (
    action === "status" ||
    action === "whoami" ||
    action === "logout" ||
    action === "sync"
  ) {
    printStatus(
      await request<Status>({
        action: action === "whoami" ? "status" : action,
      }),
      flags.json === true,
    );
    return;
  }
  if (action !== "login")
    throw new Error(
      "Usage: polymux auth login [google|apple|email] | status | logout | sync",
    );
  if (flags.password !== undefined)
    throw new Error(
      "Use the hidden password prompt or --password-stdin instead of putting a password in the command.",
    );
  const current = await request<Status>({ action: "status" });
  if (!current.available)
    throw new Error(
      "Account sign-in is not configured for this Host. Set POLYMUX_SUPABASE_URL and POLYMUX_SUPABASE_ANON_KEY in its host.env, then restart it.",
    );
  if (current.signedIn) {
    printStatus(current, flags.json === true);
    return;
  }
  let provider =
    flag(flags, "provider") ??
    flags.positional[0] ??
    (flag(flags, "email") ? "email" : undefined);
  if (!provider)
    provider =
      (
        await prompt("Sign in with google, apple, or email [google]: ")
      ).trim() || "google";
  if (!["google", "apple", "email"].includes(provider))
    throw new Error("Choose google, apple, or email.");
  if (provider === "email") {
    const email = (flag(flags, "email") ?? (await prompt("Email: "))).trim();
    if (!email || !email.includes("@"))
      throw new Error("Enter your email address.");
    const password =
      flags["password-stdin"] === true
        ? await secretFromStdin()
        : stdin.isTTY
          ? await promptSecret("Password")
          : (() => {
              throw new Error(
                "Use --email ADDRESS --password-stdin for noninteractive login.",
              );
            })();
    printStatus(
      await request<Status>({
        action: "login",
        provider: "email",
        email,
        password,
      }),
      flags.json === true,
    );
    return;
  }
  const controller = new AbortController();
  const abort = () => controller.abort(new Error("Sign-in cancelled."));
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  let listener: Awaited<ReturnType<typeof authCallback>> | undefined;
  let id: string | undefined;
  try {
    listener = await authCallback(controller.signal);
    const started = await request<{ id: string; url: string }>({
      action: "login",
      provider,
    });
    id = started.id;
    const url = new URL(started.url);
    if (
      url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(url.hostname)
      )
    )
      throw new Error("Invalid sign-in URL from the Host.");
    stderr.write(
      `Sign in with ${provider === "google" ? "Google" : "Apple"}:\n${url.href}\n`,
    );
    if (process.env.SSH_CONNECTION || process.env.SSH_TTY)
      stderr.write(
        `If your browser is on another computer, forward port ${AUTH_CALLBACK_PORT} to this computer first.\n`,
      );
    if (
      flags.browser !== false &&
      !process.env.SSH_CONNECTION &&
      !process.env.SSH_TTY
    ) {
      await openLoginUrl(url.href).catch(() =>
        stderr.write("Open the link above in your browser to continue.\n"),
      );
    }
    const code = await listener.code;
    printStatus(
      await request<Status>({ action: "complete", id, code }),
      flags.json === true,
    );
    id = undefined;
  } finally {
    controller.abort();
    listener?.close();
    if (id) await request({ action: "cancel", id }).catch(() => {});
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}

function printStatus(status: Status, json: boolean): void {
  if (json) {
    stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    return;
  }
  if (!status.signedIn) {
    stdout.write(
      status.available
        ? "Signed out.\n"
        : "Account sign-in is not configured for this Host.\n",
    );
    return;
  }
  stdout.write(
    `Signed in as ${safe(status.profile?.email || status.profile?.name || "Polymux account")}.\n`,
  );
  stdout.write(
    status.device.registered
      ? "This device is registered to your account.\n"
      : "Device registration is pending.\n",
  );
  if (status.device.error)
    stdout.write(`Device linking: ${safe(status.device.error)}\n`);
  if (status.connectedDevices.length)
    stdout.write(
      `Connected devices: ${status.connectedDevices.map((device) => safe(device.deviceName)).join(", ")}\n`,
    );
}
const safe = (value: string) => value.replace(/[\x00-\x1f\x7f-\x9f]/g, "");

async function prompt(label: string): Promise<string> {
  if (!stdin.isTTY)
    throw new Error(
      "Specify a login provider and --email for noninteractive email login.",
    );
  const reader = createInterface({ input: stdin, output: stderr });
  try {
    return await reader.question(label);
  } finally {
    reader.close();
  }
}

export async function openLoginUrl(url: string): Promise<void> {
  const run = promisify(execFile);
  if (process.platform === "darwin")
    await run("open", [url], { timeout: 5000 });
  else if (process.platform === "win32")
    await run("rundll32.exe", ["url.dll,FileProtocolHandler", url], {
      timeout: 5000,
    });
  else await run("xdg-open", [url], { timeout: 5000 });
}

/** Bind before opening the browser so an existing SSO session cannot beat the listener. */
export async function authCallback(
  signal: AbortSignal,
  port = AUTH_CALLBACK_PORT,
  timeoutMs = 5 * 60_000,
): Promise<{ code: Promise<string>; close: () => void; port: number }> {
  let resolve!: (code: string) => void;
  let reject!: (error: Error) => void;
  let finished = false;
  const code = new Promise<string>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  // Binding or beginning OAuth may fail before the caller starts awaiting the callback.
  void code.catch(() => {});
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method !== "GET" || url.pathname !== "/auth/callback") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    });
    response.end(
      "<!doctype html><title>Polymux</title><p>Return to your terminal to finish signing in to Polymux.</p>",
    );
    const error =
      url.searchParams.get("error_description") ??
      url.searchParams.get("error");
    const value = url.searchParams.get("code");
    finish(
      error
        ? new Error(safe(error))
        : !value
          ? new Error("The sign-in response did not include a code.")
          : null,
      value ?? undefined,
    );
  });
  const finish = (error: Error | null, value?: string) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    server.close();
    if (error) reject(error);
    else resolve(value!);
  };
  const abort = () => finish(new Error("Sign-in cancelled."));
  const timer = setTimeout(
    () => finish(new Error("Sign-in timed out. Run polymux auth login again.")),
    timeoutMs,
  );
  signal.addEventListener("abort", abort, { once: true });
  try {
    if (signal.aborted) throw new Error("Sign-in cancelled.");
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Could not bind the sign-in callback.");
    return { code, close: abort, port: address.port };
  } catch (error) {
    const message =
      (error as NodeJS.ErrnoException).code === "EADDRINUSE"
        ? `Port ${port} is busy. Finish the other sign-in, or use email/password login.`
        : error instanceof Error
          ? error.message
          : String(error);
    finish(new Error(message));
    throw new Error(message);
  }
}
