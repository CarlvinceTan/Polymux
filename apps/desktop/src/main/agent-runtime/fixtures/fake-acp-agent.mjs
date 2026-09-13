import readline from "node:readline";

const input = readline.createInterface({input: process.stdin});
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
let model = "fast";
const histories = new Map();
let promptCount = 0;
const reportHistory = process.argv.includes("--report-history");
const lateCancel = process.argv.includes("--late-cancel");
let brave = false;
const requiresAuth = process.argv.includes("--require-auth");
const hangsDuringInitialize = process.argv.includes("--hang-initialize");
const emitsNotices = process.argv.includes("--emit-notices");
const emitsGenericNotices = process.argv.includes("--emit-generic-notices");
const failsPrompt = process.argv.includes("--fail-prompt");
const expectsSessionFailures = process.argv.includes("--expect-session-failures");
const reportsEnvironment = process.argv.includes("--report-environment");
const expectedClientVersion = process.argv
  .find((argument) => argument.startsWith("--expect-client-version="))
  ?.slice("--expect-client-version=".length);
const expectedMcpServer = process.argv
  .find((argument) => argument.startsWith("--expect-mcp-server="))
  ?.slice("--expect-mcp-server=".length);
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
    if (hangsDuringInitialize) return;
    const sessionFailures = message.params.clientCapabilities?._meta?.jetbrains?.air;
    if (expectsSessionFailures && (
      sessionFailures?.version !== 1 ||
      !sessionFailures?.capabilities?.includes("sessionFailure")
    )) {
      send({jsonrpc: "2.0", id: message.id, error: {
        code: -32602,
        message: "Expected the sessionFailure client capability",
      }});
      return;
    }
    if (expectedClientVersion && message.params.clientInfo?.version !== expectedClientVersion) {
      send({jsonrpc: "2.0", id: message.id, error: {
        code: -32602,
        message: `Expected client version ${expectedClientVersion}, received ${message.params.clientInfo?.version ?? "none"}`,
      }});
      return;
    }
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
    if (expectedMcpServer && !message.params.mcpServers?.some((server) => server.name === expectedMcpServer)) {
      send({jsonrpc: "2.0", id: message.id, error: {
        code: -32602,
        message: `Expected MCP server ${expectedMcpServer}`,
      }});
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
    const sessionId = message.params.sessionId;
    const history = histories.get(sessionId) ?? [];
    history.push(message.params.prompt);
    histories.set(sessionId, history);
    promptCount++;
    const chunk = (text) => send({jsonrpc: "2.0", method: "session/update", params: {
      sessionId, update: {sessionUpdate: "agent_message_chunk", content: {type: "text", text}},
    }});
    if (lateCancel) {
      if (promptCount === 1) {
        chunk("FIRST");
        setTimeout(() => chunk("LATE OLD ANSWER"), 60);
        setTimeout(() => send({jsonrpc: "2.0", id: message.id, result: {stopReason: "cancelled"}}), 90);
      } else {
        setTimeout(() => {
          chunk("NEW ANSWER");
          send({jsonrpc: "2.0", id: message.id, result: {stopReason: "end_turn"}});
        }, 120);
      }
      return;
    }
    if (reportHistory) {
      chunk(JSON.stringify({sessionId, history}));
      send({jsonrpc: "2.0", id: message.id, result: {stopReason: "end_turn"}});
      return;
    }
    if (failsPrompt) {
      send({jsonrpc: "2.0", id: message.id, error: {code: -32000, message: "External agent connection lost"}});
      return;
    }
    send({jsonrpc: "2.0", method: "session/update", params: {
      sessionId: message.params.sessionId,
      update: {sessionUpdate: "agent_thought_chunk", content: {type: "text", text: "Checking. "}},
    }});
    send({jsonrpc: "2.0", method: "session/update", params: {
      sessionId: message.params.sessionId,
      update: {sessionUpdate: "agent_message_chunk", content: {type: "text", text: reportsEnvironment
        ? JSON.stringify({home: process.env.HOME, xdg: process.env.XDG_CONFIG_HOME, secret: process.env.OPENAI_API_KEY})
        : model === "capable" ? "Hello from capable ACP" : "Hello from ACP"}},
    }});
    if (emitsNotices) {
      send({jsonrpc: "2.0", method: "session/update", params: {
        sessionId: message.params.sessionId,
        update: {sessionUpdate: "agent_message_chunk", content: {type: "text", text: "**Fast mode turned off:** requires extra usage to be enabled for this account."}},
      }});
      send({jsonrpc: "2.0", method: "session/update", params: {
        sessionId: message.params.sessionId,
        update: {sessionUpdate: "session_info_update", _meta: {jetbrains: {air: {version: 1, sessionFailure: {
          id: "notice-1", revision: 1, category: "service", severity: "error", title: "Claude is temporarily unavailable.", actions: ["retry"],
        }}}}},
      }});
    }
    if (emitsGenericNotices) {
      send({jsonrpc: "2.0", method: "session/update", params: {
        sessionId: message.params.sessionId,
        update: {sessionUpdate: "agent_message_chunk", content: {type: "text", text: "**Warning:** Connection is degraded."}},
      }});
      send({jsonrpc: "2.0", method: "session/update", params: {
        sessionId: message.params.sessionId,
        update: {sessionUpdate: "agent_message_chunk", content: {type: "text", text: "**Error:** External agent transport failed."}},
      }});
    }
    send({jsonrpc: "2.0", id: message.id, result: {stopReason: "end_turn"}});
    return;
  }
  if (message.method === "session/cancel") return;
});
