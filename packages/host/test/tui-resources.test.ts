import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { HeadlessHostRuntime, TeamHostClient } from "../src/index.js";

test(
  "Host loads only its configured MCPs and forks without changing source history",
  { timeout: 15000 },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "polymux-tui-resources-"));
    const configDirectory = path.join(root, "config");
    await mkdir(configDirectory);
    const script = `let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{input+=chunk;let i;while((i=input.indexOf('\\n'))>=0){const line=input.slice(0,i);input=input.slice(i+1);if(!line)continue;const r=JSON.parse(line);if(r.id===undefined)continue;const result=r.method==='initialize'?{protocolVersion:r.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}:r.method==='tools/list'?{tools:[{name:'echo',description:'fixture',inputSchema:{type:'object',properties:{}}}]}:{};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n');}});`;
    await writeFile(
      path.join(root, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          fixture: { command: process.execPath, args: ["-e", script] },
          disabled: { command: "/does/not/exist", enabled: false },
        },
      }),
    );
    await mkdir(path.join(root, "skills", "fixture"), { recursive: true });
    await writeFile(
      path.join(root, "skills", "fixture", "SKILL.md"),
      "---\nname: fixture\ndescription: A test skill\n---\nFixture instructions.\n",
    );
    const runtime = new HeadlessHostRuntime({
      dataDirectory: path.join(root, "host"),
      configDirectory,
      listen: "127.0.0.1",
      port: 0,
      adminSecret: "fixture-admin",
      beginPairing: false,
    });
    try {
      const state = await runtime.start();
      const client = new TeamHostClient(state.endpoint!, "fixture-admin");
      const request = async (action: string) => {
        const response = await fetch(
          `${state.localEndpoint ?? state.endpoint}/polymux-host/v1/admin/account`,
          {
            method: "POST",
            headers: {
              authorization: "Bearer fixture-admin",
              "content-type": "application/json",
            },
            body: JSON.stringify({ action }),
          },
        );
        assert.equal(response.status, 200);
        return (await response.json()).result;
      };
      const status = await request("resources.status");
      assert.equal(
        status.find((server: any) => server.id === "fixture").status,
        "connected",
      );
      assert.deepEqual(
        status.find((server: any) => server.id === "fixture").toolNames,
        ["fixture__echo"],
      );
      assert.equal(
        status.find((server: any) => server.id === "disabled").status,
        "disconnected",
      );
      await client.call("assistant.ensure", ["source"]);
      const configuration = await client.call<{
        skills: string[];
        mcps: string[];
      }>("runs.configuration", ["source"]);
      assert.ok(configuration.skills.includes("fixture"));
      assert.deepEqual(configuration.mcps, ["fixture"]);
      runtime.storage.appendMessage({
        id: "u1",
        conversationId: "source",
        role: "user",
        content: "First",
      });
      runtime.storage.appendMessage({
        id: "a1",
        conversationId: "source",
        role: "assistant",
        content: "Answer",
      });
      runtime.storage.appendMessage({
        id: "u2",
        conversationId: "source",
        role: "user",
        content: "Edit this prompt",
      });
      runtime.storage.appendMessage({
        id: "a2",
        conversationId: "source",
        role: "assistant",
        content: "Future answer",
      });
      const fork = await client.call<{ id: string }>("conversations.fork", [
        "source",
        "u2",
      ]);
      assert.deepEqual(
        runtime.storage.listMessages(fork.id).map((message) => message.content),
        ["First", "Answer"],
      );
      assert.equal(runtime.storage.listMessages("source").length, 4);
      await assert.rejects(
        client.call("conversations.fork", [fork.id, "u2"]),
        /Choose a user message/,
      );
      await writeFile(path.join(root, "mcp.json"), '{"mcpServers":{}}');
      await request("resources.reload");
      assert.deepEqual(await request("resources.status"), []);
    } finally {
      await runtime.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
