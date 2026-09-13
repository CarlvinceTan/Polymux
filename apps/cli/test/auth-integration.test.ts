import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { AUTH_CALLBACK_PORT } from "../src/auth.js";

test(
  "built auth commands stay outside the TUI and support hidden-stdin and Google/Apple callbacks",
  { timeout: 20000 },
  async () => {
    const home = await mkdtemp(path.join(tmpdir(), "polymux-cli-auth-"));
    const calls: Array<Record<string, any>> = [];
    const status = {
      available: true,
      signedIn: false,
      profile: null as null | { userId: string; email: string },
      accounts: [] as Array<{ userId: string; email: string }>,
      device: { registered: true, syncing: false, error: null as string | null },
      connectedDevices: [] as Array<{ deviceName: string }>,
    };
    const server = createServer(async (request, response) => {
      assert.equal(request.url, "/polymux-host/v1/admin/account");
      assert.equal(request.headers.authorization, "Bearer fixture-admin");
      let body = "";
      for await (const chunk of request) body += chunk;
      const value = JSON.parse(body);
      calls.push(value);
      if (value.action === "login" && value.provider !== "email") {
        response
          .writeHead(200, { "content-type": "application/json" })
          .end(
            JSON.stringify({
              result: {
                id: "pending-id",
                url: "https://accounts.example.test/login",
              },
            }),
          );
        return;
      }
      if (value.action === "login" || value.action === "complete") {
        status.signedIn = true;
        status.profile = {
          userId: "fixture-user",
          email: "fixture@example.test",
        };
      }
      if (value.action === "logout") {
        status.signedIn = false;
        status.profile = null;
      }
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ result: status }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await mkdir(path.join(home, "host"));
    await mkdir(path.join(home, "config"));
    await writeFile(
      path.join(home, "host/state.json"),
      JSON.stringify({
        localEndpoint: `http://127.0.0.1:${address.port}`,
        endpoint: `http://127.0.0.1:${address.port}`,
      }),
    );
    await writeFile(
      path.join(home, "config/host-admin-token"),
      "fixture-admin",
    );
    const launch = (args: string[], input = "") => {
      const child = spawn(
        process.execPath,
        [path.resolve("apps/cli/dist/polymux.mjs"), "auth", ...args],
        { env: { ...process.env, POLYMUX_HOME: home }, stdio: "pipe" },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.stdin.end(input);
      const result = new Promise<{
        code: number | null;
        stdout: string;
        stderr: string;
      }>((resolve) =>
        child.on("close", (code) => resolve({ code, stdout, stderr })),
      );
      return { child, result, output: () => stderr };
    };
    try {
      const signedOut = await launch(["status", "--json"]).result;
      assert.equal(JSON.parse(signedOut.stdout).signedIn, false);
      const password = await launch(
        [
          "login",
          "email",
          "--email",
          "fixture@example.test",
          "--password-stdin",
        ],
        "fixture-password\n",
      ).result;
      assert.equal(password.code, 0, password.stderr);
      assert.match(password.stdout, /Signed in as fixture@example.test/);
      assert.ok(
        !password.stdout.includes("fixture-password") &&
          !password.stderr.includes("fixture-password"),
      );
      assert.equal(
        calls.find((call) => call.action === "login")?.password,
        "fixture-password",
      );
      assert.ok(!password.stdout.includes("\x1b[?1049h"));
      await launch(["logout"]).result;
      for (const provider of ["google", "apple"]) {
        const flow = launch(["login", provider, "--no-browser"]);
        try {
          for (
            let i = 0;
            i < 100 &&
            !flow.output().includes("https://accounts.example.test/login") &&
            flow.child.exitCode === null;
            i++
          )
            await new Promise((resolve) => setTimeout(resolve, 20));
          assert.match(flow.output(), /https:\/\/accounts.example.test\/login/);
          const callback = await fetch(
            `http://127.0.0.1:${AUTH_CALLBACK_PORT}/auth/callback?code=fixture-code`,
          );
          assert.equal(callback.status, 200);
          const result = await flow.result;
          assert.equal(result.code, 0, result.stderr);
          assert.match(result.stdout, /Signed in as/);
          assert.ok(
            !result.stdout.includes("fixture-code") &&
              !result.stderr.includes("fixture-code"),
          );
          assert.ok(
            calls.some(
              (call) =>
                call.action === "complete" &&
                call.id === "pending-id" &&
                call.code === "fixture-code",
            ),
          );
          await launch(["logout"]).result;
        } finally {
          if (flow.child.exitCode === null) {
            flow.child.kill("SIGTERM");
            await flow.result;
          }
        }
      }
      const unsafe = await launch([
        "login",
        "email",
        "--password",
        "do-not-echo",
      ]).result;
      assert.notEqual(unsafe.code, 0);
      assert.ok(!unsafe.stderr.includes("do-not-echo"));
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(home, { recursive: true, force: true });
    }
  },
);
