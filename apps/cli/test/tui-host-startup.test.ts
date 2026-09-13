import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureTuiHost, localHostReady } from "../src/tui/host-startup.js";

test(
  "bare-TUI bootstrap starts one background Host and reuses its authenticated endpoint",
  { timeout: 10000 },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "polymux-tui-start-"));
    const entry = path.join(root, "fixture.mjs");
    await writeFile(
      entry,
      `import {createServer} from 'node:http';import {mkdirSync,writeFileSync} from 'node:fs';import path from 'node:path';const root=process.env.POLYMUX_HOME;mkdirSync(path.join(root,'config'),{recursive:true});mkdirSync(path.join(root,'host'),{recursive:true});writeFileSync(path.join(root,'pid'),String(process.pid));writeFileSync(path.join(root,'config','host-admin-token'),'fixture-admin');const server=createServer((req,res)=>{res.writeHead(req.headers.authorization==='Bearer fixture-admin'?200:401).end('{}');});server.listen(0,'127.0.0.1',()=>writeFileSync(path.join(root,'host','state.json'),JSON.stringify({localEndpoint:'http://127.0.0.1:'+server.address().port})));process.on('SIGTERM',()=>server.close(()=>process.exit(0)));`,
    );
    let pid: number | undefined;
    try {
      assert.equal(await localHostReady(root), false);
      const options = {
        entry,
        root,
        ready: () => localHostReady(root),
        timeoutMs: 5000,
      };
      await ensureTuiHost(options);
      pid = Number(await readFile(path.join(root, "pid"), "utf8"));
      assert.ok(pid > 0);
      assert.equal(await localHostReady(root), true);
      await ensureTuiHost(options);
      assert.equal(Number(await readFile(path.join(root, "pid"), "utf8")), pid);
      await writeFile(
        path.join(root, "config", "host-admin-token"),
        "wrong-admin",
      );
      assert.equal(await localHostReady(root), false);
    } finally {
      pid ??= Number(
        await readFile(path.join(root, "pid"), "utf8").catch(() => "0"),
      );
      if (pid) {
        try {
          process.kill(pid, "SIGTERM");
        } catch {}
      }
      await rm(root, { recursive: true, force: true });
    }
  },
);
