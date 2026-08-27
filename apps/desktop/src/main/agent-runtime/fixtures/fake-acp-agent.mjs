import readline from "node:readline";

const input = readline.createInterface({input: process.stdin});
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
let model = "fast";
let brave = false;
const requiresAuth = process.argv.includes("--require-auth");
let authenticated = !requiresAuth;
const configOptions = () => [
  {id: "model", name: "Model", category: "model", type: "select", currentValue: model, options: [
    {value: "fast", name: "Fast"},
    {value: "capable", name: "Capable"},
  ]},
  {id: "brave", name: "Brave mode", type: "boolean", currentValue: brave},
];

input.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({jsonrpc: "2.0", id: message.id, result: {
      protocolVersion: message.params.protocolVersion,
      agentCapabilities: requiresAuth ? {auth: {logout: {}}} : {},
      agentInfo: {name: "Fake ACP Agent", version: "1.0.0"},
      ...(requiresAuth ? {authMethods: [{id: "account", name: "Agent account", description: "Sign in through the agent"}]} : {}),
    }});
    return;
  }
  if (message.method === "authenticate") {
    authenticated = message.params.methodId === "account";
    send({jsonrpc: "2.0", id: message.id, result: {}});
    return;
  }
  if (message.method === "logout") {
    authenticated = false;
    send({jsonrpc: "2.0", id: message.id, result: {}});
    return;
  }
  if (message.method === "session/new") {
    if (!authenticated) {
      send({jsonrpc: "2.0", id: message.id, error: {code: -32000, message: "Authentication required"}});
      return;
    }
    send({jsonrpc: "2.0", id: message.id, result: {sessionId: `session-${message.id}`, configOptions: configOptions()}});
    return;
  }
  if (message.method === "session/set_config_option") {
    if (message.params.configId === "model") model = message.params.value;
    if (message.params.configId === "brave") brave = message.params.value;
    send({jsonrpc: "2.0", id: message.id, result: {configOptions: configOptions()}});
    return;
  }
  if (message.method === "session/prompt") {
    send({jsonrpc: "2.0", method: "session/update", params: {
      sessionId: message.params.sessionId,
      update: {sessionUpdate: "agent_thought_chunk", content: {type: "text", text: "Checking. "}},
    }});
    send({jsonrpc: "2.0", method: "session/update", params: {
      sessionId: message.params.sessionId,
      update: {sessionUpdate: "agent_message_chunk", content: {type: "text", text: model === "capable" ? "Hello from capable ACP" : "Hello from ACP"}},
    }});
    send({jsonrpc: "2.0", id: message.id, result: {stopReason: "end_turn"}});
    return;
  }
  if (message.method === "session/cancel") return;
});
