import * as acp from "@agentclientprotocol/sdk";
import {spawn, type ChildProcessWithoutNullStreams} from "node:child_process";
import {Readable, Writable} from "node:stream";
import {randomUUID} from "node:crypto";
import path from "node:path";
import type {AgentRunEvent, AgentRunResult, ActiveAgentRun} from "@polymux/core";
import {AgentRunControl} from "@polymux/core";
import type {AssistantBlock, InferenceUsage, ToolCallBlock} from "@polymux/inference";
import type {AgentAuthMethodDto, AgentConfigOptionDto, AgentProviderDto, AgentSettingsDto, SetAgentProviderRequest} from "@polymux/protocol";
import type {JsonValue, Storage} from "@polymux/storage";
import type {AcpRuntimeConfig, AgentRuntime, AgentRuntimeStartInput} from "./types.js";

type RuntimeEvent = AgentRunEvent extends infer Event
  ? Event extends AgentRunEvent
    ? Omit<Event, "runId" | "sequence" | "timestamp">
    : never
  : never;

const EMPTY_USAGE: InferenceUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 0,
  costUsd: 0,
};

class EventQueue implements AsyncIterable<AgentRunEvent> {
  readonly #values: AgentRunEvent[] = [];
  readonly #waiting: Array<(value: IteratorResult<AgentRunEvent>) => void> = [];
  #closed = false;

  push(value: AgentRunEvent): void {
    if (this.#closed) return;
    const waiting = this.#waiting.shift();
    if (waiting) waiting({value, done: false});
    else this.#values.push(value);
  }

  close(): void {
    this.#closed = true;
    for (const waiting of this.#waiting.splice(0))
      waiting({value: undefined, done: true});
  }

  [Symbol.asyncIterator](): AsyncIterator<AgentRunEvent> {
    return {
      next: () => {
        const value = this.#values.shift();
        if (value) return Promise.resolve({value, done: false});
        if (this.#closed)
          return Promise.resolve({value: undefined, done: true});
        return new Promise((resolve) => this.#waiting.push(resolve));
      },
    };
  }
}

interface ConnectedAgent {
  child: ChildProcessWithoutNullStreams;
  connection: acp.ClientConnection;
  sessions: Map<string, acp.ActiveSession>;
  configOptions: Map<string, acp.SessionConfigOption[]>;
  info: acp.InitializeResponse;
}

const SETTINGS_SESSION = "__polymux_agent_settings__";

/** Runs any stdio ACP v1 agent behind Polymux's existing run/event contract. */
export class AcpAgentRuntime implements AgentRuntime {
  readonly id: string;
  readonly name: string;
  readonly #storage: Storage;
  readonly #config: AcpRuntimeConfig;
  readonly #requestPermission?: (request: acp.RequestPermissionRequest) => Promise<acp.RequestPermissionResponse>;
  readonly #mcpServers: () => acp.McpServer[];
  #connected?: Promise<ConnectedAgent>;

  constructor(
    config: AcpRuntimeConfig,
    storage: Storage,
    requestPermission?: (request: acp.RequestPermissionRequest) => Promise<acp.RequestPermissionResponse>,
    mcpServers: () => acp.McpServer[] = () => [],
  ) {
    this.#config = config;
    this.#storage = storage;
    this.#requestPermission = requestPermission;
    this.#mcpServers = mcpServers;
    this.id = `acp:${config.command}`;
    this.name = config.name;
  }

  start(input: AgentRuntimeStartInput): ActiveAgentRun {
    const control = new AgentRunControl();
    const events = new EventQueue();
    const result = this.#run(input, control, events).finally(() => events.close());
    return {control, events, result};
  }

  async close(): Promise<void> {
    const connected = await this.#connected?.catch((): undefined => undefined);
    this.#connected = undefined;
    if (!connected) return;
    for (const session of connected.sessions.values()) session.dispose();
    connected.connection.close();
    if (!connected.child.killed) connected.child.kill();
  }

  /** Reads the controls this agent actually exposes instead of guessing from
   * its registry name. The reserved session is never prompted. */
  async settings(): Promise<AgentSettingsDto> {
    const connected = await this.#connect();
    const supportsProviders = connected.info.agentCapabilities?.providers != null;
    let session: acp.ActiveSession;
    try {
      session = (await this.#session(SETTINGS_SESSION)).session;
    } catch (error) {
      if (isAuthRequired(error))
        return agentSettingsDto([], [], supportsProviders, connected.info, true);
      throw error;
    }
    const providers = supportsProviders
      ? (await connected.connection.agent.request(acp.methods.agent.providers.list, {})).providers
      : [];
    return agentSettingsDto(
      connected.configOptions.get(session.sessionId) ?? [],
      providers,
      supportsProviders,
      connected.info,
      false,
    );
  }

  async authenticate(methodId: string): Promise<AgentSettingsDto> {
    const connected = await this.#connect();
    const method = connected.info.authMethods?.find((candidate) => candidate.id === methodId);
    if (!method) throw new Error(`Unknown ACP authentication method: ${methodId}`);
    if ("type" in method && method.type === "terminal")
      throw new Error("This authentication method requires interactive terminal support.");
    await connected.connection.agent.request(acp.methods.agent.authenticate, {methodId});
    this.#disposeSettingsSession(connected);
    return this.settings();
  }

  async logout(): Promise<AgentSettingsDto> {
    const connected = await this.#connect();
    if (connected.info.agentCapabilities?.auth?.logout == null)
      throw new Error(`${this.name} does not advertise ACP logout support`);
    await connected.connection.agent.request(acp.methods.agent.logout, {});
    for (const session of connected.sessions.values()) session.dispose();
    connected.sessions.clear();
    connected.configOptions.clear();
    return this.settings();
  }

  async setConfigOption(id: string, value: string | boolean): Promise<AgentSettingsDto> {
    const {connected, session: settingsSession} = await this.#session(SETTINGS_SESSION);
    const option = (connected.configOptions.get(settingsSession.sessionId) ?? [])
      .find((candidate) => candidate.id === id);
    if (!option) throw new Error(`Unknown ACP option: ${id}`);
    assertConfigValue(option, value);
    this.#config.config = {...this.#config.config, [id]: value};
    for (const session of connected.sessions.values())
      await this.#setSessionConfigOption(connected, session, id, value);
    return this.settings();
  }

  async setProvider(request: SetAgentProviderRequest): Promise<AgentSettingsDto> {
    const connected = await this.#connect();
    if (connected.info.agentCapabilities?.providers == null)
      throw new Error(`${this.name} does not expose provider configuration through ACP`);
    await connected.connection.agent.request(acp.methods.agent.providers.set, {
      providerId: request.id,
      apiType: request.apiType,
      baseUrl: request.baseUrl,
      ...(request.headers ? {headers: request.headers} : {}),
    });
    return this.settings();
  }

  async disableProvider(id: string): Promise<AgentSettingsDto> {
    const connected = await this.#connect();
    if (connected.info.agentCapabilities?.providers == null)
      throw new Error(`${this.name} does not expose provider configuration through ACP`);
    await connected.connection.agent.request(acp.methods.agent.providers.disable, {providerId: id});
    return this.settings();
  }

  async #connect(): Promise<ConnectedAgent> {
    if (this.#connected) return this.#connected;
    this.#connected = (async () => {
      const child = spawn(this.#config.command, this.#config.args, {
        cwd: this.#config.cwd || process.cwd(),
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      });
      const exited = new Promise<never>((_, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) =>
          reject(new Error(
            `${this.name} exited${signal ? ` with ${signal}` : ` with code ${code ?? "unknown"}`}`,
          )),
        );
      });
      child.stderr.on("data", (chunk) =>
        console.warn(`[acp:${this.name}] ${String(chunk).trimEnd()}`),
      );
      const stream = acp.ndJsonStream(
        Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      );
      const app = acp.client({name: "Polymux"}).onRequest(
        acp.methods.client.session.requestPermission,
        ({params}) => {
          if (this.#requestPermission) return this.#requestPermission(params);
          // Until the renderer has an explicit approval card, never convert an
          // external agent's request into silent authority.
          const reject = params.options.find((option) => option.kind === "reject_once" || option.kind === "reject_always");
          return reject
            ? {outcome: {outcome: "selected" as const, optionId: reject.optionId}}
            : {outcome: {outcome: "cancelled" as const}};
        },
      );
      const connection = app.connect(stream);
      const info = await Promise.race([
        connection.agent.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {session: {configOptions: {boolean: {}}}},
          clientInfo: {name: "Polymux", version: "0.2.1"},
        }),
        exited,
      ]);
      if (info.protocolVersion !== acp.PROTOCOL_VERSION) {
        connection.close();
        child.kill();
        throw new Error(
          `${this.name} negotiated unsupported ACP version ${info.protocolVersion}`,
        );
      }
      return {child, connection, sessions: new Map(), configOptions: new Map(), info};
    })().catch((error) => {
      this.#connected = undefined;
      throw error;
    });
    return this.#connected;
  }

  async #session(conversationId: string): Promise<{connected: ConnectedAgent; session: acp.ActiveSession}> {
    const connected = await this.#connect();
    const existing = connected.sessions.get(conversationId);
    if (existing) return {connected, session: existing};
    const session = await connected.connection.agent
      .buildSession({
        cwd: path.resolve(this.#config.cwd || process.cwd()),
        mcpServers: this.#mcpServers(),
      })
      .start();
    connected.sessions.set(conversationId, session);
    connected.configOptions.set(session.sessionId, session.newSessionResponse.configOptions ?? []);
    await this.#applyPreferredConfig(connected, session);
    return {connected, session};
  }

  #disposeSettingsSession(connected: ConnectedAgent): void {
    const session = connected.sessions.get(SETTINGS_SESSION);
    if (!session) return;
    session.dispose();
    connected.sessions.delete(SETTINGS_SESSION);
    connected.configOptions.delete(session.sessionId);
  }

  async #applyPreferredConfig(connected: ConnectedAgent, session: acp.ActiveSession): Promise<void> {
    const options = connected.configOptions.get(session.sessionId) ?? [];
    for (const [id, value] of Object.entries(this.#config.config ?? {})) {
      const option = options.find((candidate) => candidate.id === id);
      if (!option) continue;
      try {
        assertConfigValue(option, value);
        if (option.currentValue !== value)
          await this.#setSessionConfigOption(connected, session, id, value);
      } catch {
        // An agent upgrade may remove a model or change an option's type. The
        // session remains usable with its own current value.
      }
    }
  }

  async #setSessionConfigOption(
    connected: ConnectedAgent,
    session: acp.ActiveSession,
    id: string,
    value: string | boolean,
  ): Promise<void> {
    const response = await connected.connection.agent.request(
      acp.methods.agent.session.setConfigOption,
      typeof value === "boolean"
        ? {sessionId: session.sessionId, configId: id, type: "boolean", value}
        : {sessionId: session.sessionId, configId: id, value},
    );
    connected.configOptions.set(session.sessionId, response.configOptions);
  }

  async #run(
    input: AgentRuntimeStartInput,
    control: AgentRunControl,
    queue: EventQueue,
  ): Promise<AgentRunResult> {
    const startedAt = Date.now();
    let sequence = 0;
    let turn = 1;
    let text = "";
    let reasoning = "";
    let usage = {...EMPTY_USAGE};
    let hadWorkActivity = false;
    const toolCalls = new Map<string, {call: ToolCallBlock; startedAt: number}>();
    const emit = (event: RuntimeEvent): void => {
      const complete = {
        ...event,
        runId: input.runId,
        sequence: ++sequence,
        timestamp: Date.now(),
      } as AgentRunEvent;
      queue.push(complete);
      if (complete.type !== "message.text.delta" && complete.type !== "message.tool_call.delta")
        this.#storage.appendRunEvent(input.runId, complete.type, json(complete));
    };
    const model = {
      provider: "acp",
      id: this.id,
      name: this.name,
      contextWindow: 0,
      maxOutputTokens: 0,
      reasoning: true,
      input: ["text" as const, "image" as const],
    };

    if (!input.reuseUserMessage) {
      const message = this.#storage.appendMessage({
        id: input.userMessageId ?? randomUUID(),
        conversationId: input.conversationId,
        runId: null,
        role: "user",
        content: input.text,
        metadata: input.asGoal ? {asGoal: true} : {},
      });
      for (const attachment of input.attachments ?? [])
        this.#storage.addAttachment({
          id: randomUUID(),
          messageId: message.id,
          name: path.basename(attachment),
          path: attachment,
          mimeType: null,
          size: null,
          sha256: null,
        });
    }
    this.#storage.createRun({
      id: input.runId,
      conversationId: input.conversationId,
      status: "running",
      model: this.id,
    });
    emit({type: "run.started", model});
    emit({type: "run.state", status: "running"});
    emit({
      type: "turn.started",
      turn,
      context: {messages: [{role: "user", content: input.text}]},
      footprint: {
        systemPromptBytes: 0,
        messageBytes: Buffer.byteLength(input.text),
        toolSchemaBytes: 0,
        toolCount: 0,
        toolNames: [],
        systemSections: [],
        activeSkillNames: [],
        availableSkillCount: 0,
        ambientContextCounts: {memoryBlocks: 0, memoryCandidateBlocks: 0, flareBrowserTabs: 0, externalBrowserTabs: 0, openWindows: 0},
        ambientContextCapturedAt: {},
        totalBytes: Buffer.byteLength(input.text),
      },
    });
    emit({type: "model.started", turn, model});

    try {
      const {connected, session} = await this.#session(input.conversationId);
      const cancel = (): void => {
        void connected.connection.agent.notify(
          acp.methods.agent.session.cancel,
          {sessionId: session.sessionId},
        ).catch((): void => {});
      };
      control.signal.addEventListener("abort", cancel, {once: true});
      const prompt = session.prompt([
        {type: "text", text: input.text},
        ...(input.attachments ?? []).map((file): acp.ContentBlock => ({
          type: "resource_link",
          name: path.basename(file),
          uri: `file://${path.resolve(file)}`,
        })),
      ]);
      for (;;) {
        const message = await session.nextUpdate();
        if (message.kind === "stop") {
          if (message.response.usage) {
            usage = {
              ...EMPTY_USAGE,
              inputTokens: message.response.usage.inputTokens,
              outputTokens: message.response.usage.outputTokens,
              totalTokens: message.response.usage.totalTokens,
            };
          }
          break;
        }
        const update = message.update;
        if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
          text += update.content.text;
          emit({type: "message.text.delta", turn, index: 0, delta: update.content.text});
        } else if (update.sessionUpdate === "agent_thought_chunk" && update.content.type === "text") {
          reasoning += update.content.text;
          emit({type: "message.reasoning.delta", turn, index: 0, delta: update.content.text});
        } else if (update.sessionUpdate === "tool_call") {
          hadWorkActivity = true;
          const call: ToolCallBlock = {
            type: "toolCall",
            id: update.toolCallId,
            name: update.name || update.kind || "acp_tool",
            arguments: objectJson(update.rawInput),
          };
          toolCalls.set(update.toolCallId, {call, startedAt: Date.now()});
          emit({type: "tool.started", turn, toolCall: call});
        } else if (update.sessionUpdate === "tool_call_update") {
          const current = toolCalls.get(update.toolCallId);
          if (!current) continue;
          if (update.status === "completed" || update.status === "failed") {
            const result = {
              content: toolContent(update.content, update.rawOutput),
              isError: update.status === "failed",
            };
            emit(update.status === "failed"
              ? {type: "tool.failed", turn, toolCall: current.call, error: {code: "internal", message: String(update.rawOutput ?? "ACP tool failed"), retryable: false}, durationMs: Date.now() - current.startedAt}
              : {type: "tool.completed", turn, toolCall: current.call, result, durationMs: Date.now() - current.startedAt});
            toolCalls.delete(update.toolCallId);
          }
        } else if (update.sessionUpdate === "config_option_update") {
          connected.configOptions.set(session.sessionId, update.configOptions);
        }
      }
      await prompt;
      control.signal.removeEventListener("abort", cancel);
      if (control.aborted) return this.#finish(input, emit, startedAt, text, reasoning, usage, hadWorkActivity, "cancelled");
      return this.#finish(input, emit, startedAt, text, reasoning, usage, hadWorkActivity, "completed");
    } catch (error) {
      if (control.aborted)
        return this.#finish(input, emit, startedAt, text, reasoning, usage, hadWorkActivity, "cancelled");
      const message = error instanceof Error ? error.message : String(error);
      const result = this.#result(input.runId, startedAt, text, reasoning, usage, hadWorkActivity, "failed", message);
      this.#storage.updateRun(input.runId, {status: "failed", error: {message}});
      emit({type: "run.state", status: "failed"});
      emit({type: "run.failed", result});
      return result;
    }
  }

  #finish(
    input: AgentRuntimeStartInput,
    emit: (event: RuntimeEvent) => void,
    startedAt: number,
    text: string,
    reasoning: string,
    usage: InferenceUsage,
    hadWorkActivity: boolean,
    status: "completed" | "cancelled",
  ): AgentRunResult {
    const content: AssistantBlock[] = [
      ...(reasoning ? [{type: "reasoning" as const, text: reasoning}] : []),
      ...(text ? [{type: "text" as const, text}] : []),
    ];
    if (content.length) {
      emit({type: "message.completed", turn: 1, message: {role: "assistant", content, provider: "acp", model: this.id, usage}, phase: "final"});
      this.#storage.appendMessage({
        id: randomUUID(),
        conversationId: input.conversationId,
        runId: input.runId,
        role: "assistant",
        content: json(content),
        metadata: {phase: "final", runtime: this.id},
      });
    }
    const result = this.#result(input.runId, startedAt, text, reasoning, usage, hadWorkActivity, status);
    this.#storage.updateRun(input.runId, {status, usage: json(usage)});
    emit({type: "run.state", status});
    emit(status === "completed" ? {type: "run.completed", result} : {type: "run.cancelled", result});
    return result;
  }

  #result(
    runId: string,
    startedAt: number,
    text: string,
    reasoning: string,
    usage: InferenceUsage,
    hadWorkActivity: boolean,
    status: "completed" | "cancelled" | "failed",
    error?: string,
  ): AgentRunResult {
    return {
      runId,
      status,
      context: {messages: [{role: "assistant", content: [
        ...(reasoning ? [{type: "reasoning" as const, text: reasoning}] : []),
        ...(text ? [{type: "text" as const, text}] : []),
      ]}]},
      turns: 1,
      usage,
      durationMs: Date.now() - startedAt,
      hadWorkActivity,
      lastAgentMessage: text,
      ...(error ? {error: {code: "internal" as const, message: error, retryable: true}} : {}),
    };
  }
}

function json(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function objectJson(value: unknown): Record<string, JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? json(value) as Record<string, JsonValue>
    : {};
}

function toolContent(content: acp.ToolCallContent[] | null | undefined, raw: unknown): string {
  const lines = (content ?? []).flatMap((item) => {
    if (item.type === "content" && item.content.type === "text") return [item.content.text];
    if (item.type === "diff") return [`Changed ${item.path}`];
    return [];
  });
  if (lines.length) return lines.join("\n");
  return typeof raw === "string" ? raw : raw === undefined ? "Completed" : JSON.stringify(raw);
}

function agentSettingsDto(
  options: acp.SessionConfigOption[],
  providers: acp.ProviderInfo[],
  supportsProviders: boolean,
  info: acp.InitializeResponse,
  authRequired: boolean,
): AgentSettingsDto {
  return {
    authMethods: (info.authMethods ?? []).map(authMethodDto),
    authRequired,
    supportsLogout: info.agentCapabilities?.auth?.logout != null,
    configOptions: options.map(configOptionDto),
    providers: providers.map(providerDto),
    supportsProviders,
  };
}

function authMethodDto(method: acp.AuthMethod): AgentAuthMethodDto {
  const terminal = "type" in method && method.type === "terminal";
  return {
    id: method.id,
    name: method.name,
    description: method.description ?? null,
    type: terminal ? "terminal" : "agent",
    available: !terminal,
  };
}

function isAuthRequired(error: unknown): boolean {
  return error instanceof acp.RequestError && error.code === -32000;
}

function configOptionDto(option: acp.SessionConfigOption): AgentConfigOptionDto {
  const common = {
    id: option.id,
    name: option.name,
    description: option.description ?? null,
    category: option.category ?? null,
  };
  if (option.type === "boolean")
    return {...common, type: "boolean", currentValue: option.currentValue};
  const grouped = option.options.length > 0 && "group" in option.options[0]!;
  const groups = grouped
    ? (option.options as acp.SessionConfigSelectGroup[]).map((group) => ({
        id: group.group,
        name: group.name,
        options: group.options.map(configValueDto),
      }))
    : [];
  return {
    ...common,
    type: "select",
    currentValue: option.currentValue,
    options: grouped
      ? groups.flatMap((group) => group.options)
      : (option.options as acp.SessionConfigSelectOption[]).map(configValueDto),
    groups,
  };
}

function configValueDto(option: acp.SessionConfigSelectOption) {
  return {value: option.value, name: option.name, description: option.description ?? null};
}

function providerDto(provider: acp.ProviderInfo): AgentProviderDto {
  return {
    id: provider.providerId,
    supported: provider.supported,
    required: provider.required,
    apiType: provider.current?.apiType ?? null,
    baseUrl: provider.current?.baseUrl ?? null,
  };
}

function assertConfigValue(option: acp.SessionConfigOption, value: string | boolean): void {
  if (option.type === "boolean") {
    if (typeof value !== "boolean") throw new Error(`${option.name} requires an on or off value`);
    return;
  }
  if (typeof value !== "string") throw new Error(`${option.name} requires a selection`);
  const values = option.options.flatMap((candidate) =>
    "group" in candidate ? candidate.options.map((item) => item.value) : [candidate.value],
  );
  if (!values.includes(value)) throw new Error(`Unknown ${option.name} selection: ${value}`);
}
