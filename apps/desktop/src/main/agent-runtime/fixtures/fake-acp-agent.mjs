import readline from "node:readline";

const input = readline.createInterface({input: process.stdin});
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

input.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({jsonrpc: "2.0", id: message.id, result: {
      protocolVersion: message.params.protocolVersion,
      agentCapabilities: {},
      agentInfo: {name: "Fake ACP Agent", version: "1.0.0"},
    }});
    return;
  }
  if (message.method === "session/new") {
    send({jsonrpc: "2.0", id: message.id, result: {sessionId: "session-1"}});
    return;
  }
  if (message.method === "session/prompt") {
    send({jsonrpc: "2.0", method: "session/update", params: {
      sessionId: message.params.sessionId,
      update: {sessionUpdate: "agent_thought_chunk", content: {type: "text", text: "Checking. "}},
    }});
    send({jsonrpc: "2.0", method: "session/update", params: {
      sessionId: message.params.sessionId,
      update: {sessionUpdate: "agent_message_chunk", content: {type: "text", text: "Hello from ACP"}},
    }});
    send({jsonrpc: "2.0", id: message.id, result: {stopReason: "end_turn"}});
    return;
  }
  if (message.method === "session/cancel") return;
});
