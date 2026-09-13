import assert from "node:assert/strict";
import test from "node:test";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StreamableHTTPClientTransport} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {AgentTool} from "@polymux/core";
import {ToolMcpServer} from "../src/mcp/server.js";

test("serves host tools to one bearer-scoped MCP client", async () => {
  const calls: Array<{input: unknown; runId: string}> = [];
  const tool: AgentTool = {
    name: "hub_state",
    description: "Read Hub state",
    parameters: {
      type: "object",
      properties: {kind: {type: "string"}},
      required: ["kind"],
      additionalProperties: false,
    },
    async execute(input, context) {
      calls.push({input, runId: context.runId});
      return {content: JSON.stringify({kind: input.kind, available: true})};
    },
  };
  let activeRun = "run-1";
  const server = new ToolMcpServer({
    name: "Polymux Hub",
    version: "1.0.0",
    tools: () => [tool],
    context: () => ({runId: activeRun}),
  });
  const descriptor = await server.descriptor("conversation-1");
  const headers = Object.fromEntries(descriptor.headers.map(({name, value}) => [name, value]));
  const client = new Client({name: "test", version: "1.0.0"});
  const transport = new StreamableHTTPClientTransport(new URL(descriptor.url), {
    requestInit: {headers},
  });

  try {
    await client.connect(transport);
    assert.deepEqual((await client.listTools()).tools.map((candidate) => candidate.name), ["hub_state"]);
    assert.deepEqual(await client.callTool({name: "hub_state", arguments: {kind: "contacts"}}), {
      content: [{type: "text", text: '{"kind":"contacts","available":true}'}],
    });
    activeRun = "run-2";
    await client.callTool({name: "hub_state", arguments: {kind: "chats"}});
    assert.deepEqual(calls, [
      {input: {kind: "contacts"}, runId: "run-1"},
      {input: {kind: "chats"}, runId: "run-2"},
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("rejects callers without the scoped bearer capability", async () => {
  const server = new ToolMcpServer({
    name: "Polymux Hub",
    version: "1.0.0",
    tools: () => [],
    context: () => ({runId: "run"}),
  });
  const descriptor = await server.descriptor("conversation-1");
  try {
    const response = await fetch(descriptor.url, {method: "POST", body: "{}"});
    assert.equal(response.status, 401);
  } finally {
    await server.close();
  }
});
