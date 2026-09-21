import {duplicateConversation} from '../../../apps/desktop/src/main/backend/duplicate-conversation.js';
import {rewindConversation} from '../../../apps/desktop/src/main/backend/rewind-conversation.js';
import {updateDeviceMessage} from '../../../apps/desktop/src/main/team/device-message.js';
import {mkdir, writeFile, readFile} from "node:fs/promises";
import {saveDeviceSecret} from "./device-secrets.js";
import {forkConversation} from "./fork.js";
import {hostModels} from "./models.js";
import {HostAccount} from './account.js';
import {DeviceConnections} from "../../../apps/desktop/src/main/team/device-connections.js";
import {randomUUID} from "node:crypto";
import {mkdirSync} from "node:fs";
import {hostname} from "node:os";
import path from "node:path";
import {
  GoalManager,
  MemoryManager,
  PolymuxAgent,
  SkillLoader,
  type AgentPrompts,
  type EnvironmentContext,
} from "@polymux/agent";
import type {ActiveAgentRun} from "@polymux/core";
import type {JsonObject, ModelRef} from "@polymux/inference";
import {PiInference} from "@polymux/inference/pi";
import type {
  ChatDto,
  ChatMessageDto,
  CreateBotRequest,
  LaptopCapabilityLeaseDto,
  MessageDto,
  ProfileDto,
  RunEventDto,
  SendAgentMessageRequest,
  BotDto,
  UpdateBotRequest,
} from "@polymux/protocol";
import {validateSaveEmailAccount, validateStartRun, validateGoalCommand} from "@polymux/protocol";
import type {JsonValue, StoredMessage} from "@polymux/storage";
import {SqliteStorage} from "@polymux/storage/sqlite";
import {createNativeTools, ToolRegistry, McpManager, importMcpServers} from "@polymux/tools";
import type {Credential, CredentialInfo, CredentialStore} from "@earendil-works/pi-ai";
import {ProfileManager} from "../../../apps/desktop/src/main/profiles.js";
import {TeamComputerManager} from "../../../apps/desktop/src/main/team/computers.js";
import {
  TeamService,
  createAgentMessageTool,
  createTeamConnectionsTool,
  createTeamSetupTool,
  createTeamSpawnTool,
  type BotTransfer,
} from "../../../apps/desktop/src/main/team/service.js";
import {
  TeamHostServer,
  type TeamHostServerSnapshot,
} from "../../../apps/desktop/src/main/team/host-server.js";
import {Communications} from "../../../apps/desktop/src/main/hub/index.js";
import {VaultService} from "../../../apps/desktop/src/main/vault/service.js";
import {Scheduler} from '../../../apps/desktop/src/main/scheduler/index.js';
import {SCHEDULE_HOST_METHODS, scheduleHostCall} from '../../../apps/desktop/src/main/scheduler/host.js';
import {createScheduleTool} from '../../../apps/desktop/src/main/scheduler/tools.js';
import {LocalUsage} from '../../../apps/desktop/src/main/usage/local-usage.js';
import {summarizeUsage} from '@polymux/storage';
import {taskOverview} from '../../../apps/desktop/src/main/tasks/overview.js';
import {
  vaultCopyField,
  vaultId,
  vaultIds,
  vaultItemInput,
  vaultPassword,
  vaultStorageMode,
  vaultStorageResolve,
  vaultBlob,
} from "../../../apps/desktop/src/main/vault/requests.js";
import {createKeychainShimRun, HeadlessCredentialStore} from "./credentials.js";

export interface HeadlessHostRuntimeOptions {
  dataDirectory: string;
  configDirectory?: string;
  listen?: string;
  port?: number;
  publicEndpoint?: string | null;
  relayEndpoint?: string | null;
  adminSecret: string;
  model?: string;
  officialSkillDirectories?: string[];
  prompts?: AgentPrompts;
  account?: {url: string | null; anonKey: string | null};
  /** Version this Host reports to account device records. The CLI passes its
   * own release version so a headless Host cannot drift from the app. */
  appVersion?: string;
  /** Tests can opt out of the short pairing window opened by a deliberate
   * `host serve`/service start. */
  beginPairing?: boolean;
}

interface CachedRuntime {
  key: string;
  agent: PolymuxAgent;
}

/**
 * Node-only owner for the same Team and Host protocol the Desktop embeds.
 * It deliberately has no Electron, browser, notification, or local-window
 * dependencies, so it can remain alive on a headless personal server.
 */
export class HeadlessHostRuntime {
  readonly #options: HeadlessHostRuntimeOptions;
  readonly #storage: SqliteStorage;
  readonly #profiles: ProfileManager;
  readonly #computers: TeamComputerManager;
  readonly #team: TeamService;
  readonly #server: TeamHostServer;
  readonly #deviceConnections: DeviceConnections;
  readonly #vault: VaultService;
  readonly #comms: Communications;
  readonly #scheduler: Scheduler;
  readonly #localUsage: LocalUsage;
  readonly #tools: ToolRegistry;
  readonly #activeRuns = new Map<string, ActiveAgentRun>();
  readonly #scheduledRunIds = new Set<string>();
  readonly #drafts = new Map<string, {turn: number; text: string; timestamp: number}>();
  readonly #runtimes = new Map<string, CachedRuntime>();
  readonly #account: HostAccount;
  readonly #modelCredentials: HeadlessCredentialStore;
  readonly #modelsFile: string;
  readonly #mcp = new McpManager();
  readonly #mcpTools = new Set<string>();
  #resourceReload: Promise<void> | null = null;
  #mcpNames: string[] = [];
  #closing = false;

  constructor(options: HeadlessHostRuntimeOptions) {
    this.#options = options;
    mkdirSync(options.dataDirectory, {recursive: true});
    const configDirectory = options.configDirectory ?? path.join(options.dataDirectory, "config");
    mkdirSync(configDirectory, {recursive: true});
    this.#modelsFile = path.join(configDirectory, "..", "models.json");
    this.#modelCredentials = new HeadlessCredentialStore(path.join(configDirectory, "model-credentials.json"), options.adminSecret ?? "");
    this.#storage = new SqliteStorage(path.join(options.dataDirectory, "polymux.sqlite"));
    this.#localUsage = new LocalUsage(options.dataDirectory);
    this.#scheduler = new Scheduler(this.#storage, async schedule => {
      const bot = schedule.botId ? this.#team.require(schedule.botId) : undefined;
      const previous = schedule.history.find(run => run.conversationId)?.conversationId;
      const conversationId = bot?.conversationId ?? (previous && this.#storage.getConversation(previous)?.id)
        ?? this.#storage.createConversation({id: randomUUID(), title: schedule.title, metadata: {deviceAssistant: true}}).id;
      if ([...this.#activeRuns.keys()].some(id => this.#storage.getRun(id)?.conversationId === conversationId))
        throw new Error('This conversation is already working');
      const {runId} = await this.#startRun({conversationId, text: schedule.prompt, messageId: randomUUID(), attachments: []});
      this.#scheduledRunIds.add(runId);
      try {
        await this.#activeRuns.get(runId)?.result;
      } finally {
        this.#scheduledRunIds.delete(runId);
      }
      const run = this.#storage.getRun(runId);
      if (run?.status !== 'completed') throw new Error('The scheduled run did not complete');
      const message = this.#storage.latestMessage(conversationId);
      const content = message?.runId === runId && message.role === 'assistant' ? message.content : null;
      const summary = typeof content === 'string' ? content : Array.isArray(content) ? content.flatMap(b => b && typeof b === 'object' && !Array.isArray(b) && typeof b.text === 'string' ? [b.text] : []).join('\n') : '';
      return {conversationId, runId, summary: summary.slice(-1200) || undefined};
    });
    this.#profiles = new ProfileManager(
      this.#storage,
      options.dataDirectory,
      configDirectory,
      path.join(configDirectory, "profiles"),
    );
    this.#computers = new TeamComputerManager();
    this.#team = new TeamService({
      storage: this.#storage,
      writeHostSecret: (id, secret) => saveDeviceSecret(path.join(options.dataDirectory, "devices"), options.adminSecret ?? "", id, secret),
      profiles: this.#profiles,
      computers: this.#computers,
      isConversationRunning: (conversationId) =>
        [...this.#activeRuns.keys()].some(
          (runId) => this.#storage.getRun(runId)?.conversationId === conversationId,
        ),
      deliver: (message) => this.#deliver(message),
      validateProfile: (profileId) => this.#requireProfile(profileId),
      transferDirectory: path.join(options.dataDirectory, "team-transfers"),
    });
    this.#vault = new VaultService({
      dataDirectory: options.dataDirectory,
      onChanged: () => {},
    });
    this.#comms = new Communications({
      credentials: new HeadlessCredentialStore(
        path.join(configDirectory, "credentials.json"),
        options.adminSecret ?? "",
      ),
      storage: {
        getPreference: (key) => this.#storage.getPreference(key),
        setPreference: (key, value) => this.#storage.setPreference(key, value),
      },
      onChange: () => {},
      // The headless Host owns its data directory the way a profile owns its
      // home: mail state stays inside it rather than following the user home.
      home: options.dataDirectory,
      emailStorePath: path.join(options.dataDirectory, "email-accounts.json"),
      // Mailbox secrets go to a sealed file; every other subprocess spawns
      // for real. OAuth sign-in has no browser here and fails closed.
      run: createKeychainShimRun(
        path.join(configDirectory, "email-secrets.json"),
        options.adminSecret ?? "",
      ),
    });
    const nativeTools = createNativeTools({cwd: () => "/workspace"})
      .map((tool) => this.#computers.wrapNativeTool(
        tool,
        (runId) => {
          const member = this.#team.botForRun(runId);
          if (member) return member.id;
          const run = this.#storage.getRun(runId);
          const conversation = run ? this.#storage.getConversation(run.conversationId) : null;
          return conversation?.metadata && typeof conversation.metadata === 'object' && !Array.isArray(conversation.metadata) && conversation.metadata.deviceAssistant === true ? conversation.id : null;
        },
      ));
    this.#tools = new ToolRegistry(nativeTools);
    this.#tools.register(createAgentMessageTool(this.#team, async (input, context) => {
      const member = this.#team.botForRun(context.runId);
      if (!member) return null;
      const brokered = await this.#server.requestDevice({
        memberId: member.id,
        memberName: member.name,
        capability: "team",
        tool: "agent_message",
        input,
        requiresApproval: false,
      });
      return brokered?.result ?? null;
    }));
    this.#tools.register(createTeamSetupTool(this.#team, {
      options: async () => ({host: this.#team.host(), profiles: this.#profileDtos()}),
      list: async () => this.#team.list(),
      create: async (request) => this.#team.create(request),
      update: async (id, request) => this.#team.update(id, request),
      remove: async (id) => this.#removeMember(id),
    }));
    // Headless bots get the same self-service as Desktop ones: the workspace
    // pool for capability self-setup, and peer spawning for durable teammates.
    // The Host has no extra connections pool beyond skills/MCP/plugins lists,
    // so pool reads stay empty rather than failing the bot's setup turn.
    this.#tools.register(createTeamConnectionsTool(this.#team, {
      pool: async () => ({skills: [], mcpServers: [], plugins: []}),
      connect: async (botId, connections) => {
        const bot = this.#team.bot(botId);
        if (!bot) throw new Error("Unknown Team member");
        return this.#team.update(botId, {
          skills: [...new Set([...(bot.skills ?? []), ...(connections.skills ?? [])])],
          mcpServers: [...new Set([...(bot.mcpServers ?? []), ...(connections.mcpServers ?? [])])],
          plugins: [...new Set([...(bot.plugins ?? []), ...(connections.plugins ?? [])])],
        });
      },
      disconnect: async (botId, connections) => {
        const bot = this.#team.bot(botId);
        if (!bot) throw new Error("Unknown Team member");
        const removeSkills = new Set(connections.skills ?? []);
        const removeMcp = new Set(connections.mcpServers ?? []);
        const removePlugins = new Set(connections.plugins ?? []);
        return this.#team.update(botId, {
          skills: (bot.skills ?? []).filter((s) => !removeSkills.has(s)),
          mcpServers: (bot.mcpServers ?? []).filter((m) => !removeMcp.has(m)),
          plugins: (bot.plugins ?? []).filter((p) => !removePlugins.has(p)),
        });
      },
    }));
    this.#tools.register(createTeamSpawnTool(this.#team, {
      options: async () => ({profiles: this.#profileDtos()}),
      spawn: async (request, parentBotId) => this.#team.spawn(request, parentBotId),
      children: async (parentBotId) => this.#team.children(parentBotId),
      updateSelf: async (parentBotId, request) => this.#team.update(parentBotId, request),
      archive: async (parentBotId, confirmName, botId) => this.#archiveSpawnedBot(parentBotId, confirmName, botId),
    }));
    this.#tools.register(createScheduleTool(
      this.#scheduler,
      runId => this.#team.botByConversation(this.#storage.getRun(runId)?.conversationId ?? '')?.id,
      {isRoutineRun: (runId) => this.#scheduledRunIds.has(runId)},
    ));
    this.#server = new TeamHostServer({
      storage: this.#storage,
      host: options.listen ?? "127.0.0.1",
      port: options.port ?? 47_680,
      publicEndpoint: options.publicEndpoint ?? null,
      relayEndpoint: options.relayEndpoint ?? null,
      adminSecret: options.adminSecret,
      call: (method, args) => method === "devices.request" ? this.#deviceConnections.request(args[0] as unknown as import("@polymux/protocol").DevicePairingRequest).then(value => value as unknown as JsonValue) : this.#call(method, args),
      onPeerApproved: async peer => {
        if (peer.endpoint && peer.hostId && peer.secret) await this.#team.savePeerConnection(peer.endpoint, {hostId: peer.hostId, deviceName: peer.deviceName, secret: peer.secret, deviceType: peer.deviceType});
      },
    });
    this.#deviceConnections = new DeviceConnections(this.#server, this.#team, options.relayEndpoint ?? "https://connect.polymux.com");
    this.#account = new HostAccount({
      url: options.account?.url ?? process.env.POLYMUX_SUPABASE_URL?.trim() ?? null,
      anonKey: options.account?.anonKey ?? process.env.POLYMUX_SUPABASE_ANON_KEY?.trim() ?? null,
      credentialFile: path.join(configDirectory, 'account-credentials.json'),
      adminSecret: options.adminSecret, team: this.#team, server: this.#server, appVersion: options.appVersion ?? "0.0.0",
    });
    this.#team.setLocalHostInfo(() => {
      const snapshot = this.#server.snapshot();
      return {
        endpoint: snapshot.endpoint,
        deviceType: snapshot.deviceType,
        pairingCode: snapshot.pairingCode,
        pairingExpiresAt: snapshot.pairingExpiresAt,
        pairedDesktopName: snapshot.pairedDesktopName,
        detail: snapshot.detail,
      };
    });
    this.#team.setLaptopBroker(async (member, capability, tool, input, _context, accessForDevice) =>
      this.#server.requestDevice({
        memberId: member.id,
        memberName: member.name,
        capability,
        tool: tool.name,
        input: input as unknown as JsonValue,
        requiresApproval: true,
      }, {accessForDevice}),
    );
  }

  get storage(): SqliteStorage {
    return this.#storage;
  }

  get team(): TeamService {
    return this.#team;
  }

  async start(): Promise<TeamHostServerSnapshot> {
    const started = await this.#server.start();
    if (started.state !== "listening") return started;
    const snapshot = this.#options.beginPairing === false || this.#server.paired()
      ? started
      : this.#server.beginPairing();
    this.#team.publish();
    await this.#account.restore();
    await this.#reloadResources();
    this.#scheduler.start();
    // Cues stored while the Host was stopped never got their delivery
    // microtask; re-arm them once the Host is ready to run them.
    setTimeout(() => {
      if (this.#closing) return;
      for (const member of this.#team.list()) {
        try {
          this.#team.ensureSetup(member.id);
        } catch {
          // Already has a cue or history; the pending check below decides.
        }
      }
      for (const member of this.#team.pendingBotSetups()) {
        try {
          this.#team.retrySetup(member.id);
        } catch {
          // Already working or introduced since the list was read.
        }
      }
      for (const member of this.#team.list()) {
        try {
          this.#team.retryRelayDelivery(member.conversationId);
        } catch {
          // Nothing pending, still working, or setup first.
        }
      }
    }, 8_000).unref?.();
    return snapshot;
  }

  async close(): Promise<void> {
    if (this.#closing) return;
    this.#closing = true;
    this.#scheduler.stop();
    this.#localUsage.close();
    await this.#account.close();
    for (const run of this.#activeRuns.values())
      run.control.cancel(new Error("Polymux Host is stopping"));
    await Promise.allSettled([...this.#activeRuns.values()].map(run => run.result));
    await Promise.allSettled([...this.#runtimes.values()].map(({agent}) => agent.settleGoalWork()));
    this.#deviceConnections.close();
    await this.#resourceReload?.catch(() => {});
    await this.#mcp.close();
    await this.#comms.close();
    this.#vault.close();
    await this.#server.close();
    this.#storage.close();
  }

  async #call(method: string, args: JsonValue[]): Promise<JsonValue> {
    if ((SCHEDULE_HOST_METHODS as readonly string[]).includes(method))
      return scheduleHostCall(this.#scheduler, method, args, id => {this.#team.require(id);});
    switch (method) {
      case 'tasks.snapshot': return taskOverview(this.#storage) as unknown as JsonValue;
      case 'tasks.cancel': this.#activeRuns.get(required(args[0], 'Task'))?.control.cancel(); return null;
      case 'usage.get': {
        const filter = args[0] && typeof args[0] === 'object' && !Array.isArray(args[0]) ? args[0] : {};
        const scope = filter.scope === 'assistant' || filter.scope === 'team' || filter.scope === 'polymux' ? filter.scope : 'all';
        const source = this.#storage.loadUsageSource();
        const local = scope === 'all' ? this.#localUsage.snapshot(filter.refresh === true) : null;
        if (local) {
          source.runs.push(...local.source.runs); source.conversations.push(...local.source.conversations);
          source.toolCounts.push(...local.source.toolCounts); source.skillTurns.push(...local.source.skillTurns);
        }
        return {...summarizeUsage(source, new Date(), {scope, agentId: typeof filter.agentId === 'string' ? filter.agentId : null}),
          ...(local ? {discovery: local.discovery} : {})} as unknown as JsonValue;
      }
      case 'account.request': {
        const value = args[0] as Record<string, JsonValue> | undefined;
        if (value?.action === 'resources.reload') {await this.#reloadResources(); return {ok: true};}
        if (value?.action === 'resources.status') return this.#mcp.snapshots() as unknown as JsonValue;
        if (typeof value?.action === 'string' && value.action.startsWith('provider.')) {
          if (value.action === 'provider.list') return (await this.#modelCredentials.list()) as unknown as JsonValue;
          const provider = required(value.provider, 'Provider');
          const catalog = hostModels(this.#modelCredentials, this.#modelsFile);
          if (!catalog.getProvider(provider)) throw new Error('Unknown provider.');
          if (value.action === 'provider.delete') { await this.#modelCredentials.delete(provider); return {ok: true, environmentConfigured: Boolean(providerKey(provider))}; }
          if (value.action !== 'provider.save') throw new Error('Unknown provider operation.');
          const credential = value.credential as Record<string, JsonValue> | undefined;
          if (!credential || !['api_key', 'oauth'].includes(String(credential.type))) throw new Error('Invalid provider credential.');
          if (credential.type === 'oauth' && (typeof credential.access !== 'string' || typeof credential.refresh !== 'string' || typeof credential.expires !== 'number')) throw new Error('Invalid OAuth credential.');
          if (credential.type === 'api_key' && typeof credential.key !== 'string' && (!credential.env || typeof credential.env !== 'object')) throw new Error('Invalid API credential.');
          await this.#modelCredentials.modify(provider, async () => credential as unknown as Credential);
          return {ok: true};
        }
        return this.#account.request(args[0]);
      }
      case 'runs.configuration': return this.#runConfiguration(required(args[0], 'conversation id'));
      case 'runs.configure': {
        const conversationId = required(args[0], 'conversation id');
        const profileId = this.#conversationProfile(conversationId);
        if ([...this.#activeRuns.keys()].some(id => this.#storage.getRun(id)?.conversationId === conversationId))
          throw new Error('Wait for this run to finish before changing its model or reasoning.');
        const value = args[1];
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected model settings.');
        if (value.reasoning !== undefined && (typeof value.reasoning !== 'string' || !['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(value.reasoning))) throw new Error('Unknown reasoning effort.');
        if (typeof value.model === 'string') {
          const model = parseModel(value.model);
          const inference = new PiInference(hostModels(new EnvironmentCredentialStore(this.#modelCredentials), this.#modelsFile));
          if (!inference.getModel(model)) throw new Error('Unknown Host model.');
          const deployed = this.#options.model?.trim() || process.env.POLYMUX_MODEL?.trim();
          if (deployed && value.model !== deployed) throw new Error('The Host has an explicit model configured. Change its model setting to choose a different model.');
          this.#profiles.setPreference(`conversation.model:${conversationId}`, model as unknown as JsonValue, profileId);
          if (!this.#team.botByConversation(conversationId)) this.#profiles.setPreference('model', model as unknown as JsonValue, profileId);
        }
        if (value.reasoning !== undefined) {
          if (typeof value.reasoning !== 'string' || !['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(value.reasoning)) throw new Error('Unknown reasoning effort.');
          const model = this.#modelFor(profileId, conversationId);
          this.#profiles.setPreference(this.#team.botByConversation(conversationId) ? `conversation.reasoning:${conversationId}:${model}` : `model.reasoning:${model}`, value.reasoning, profileId);
        }
        return this.#runConfiguration(conversationId);
      }
      case 'models.list': return new PiInference(hostModels(new EnvironmentCredentialStore(this.#modelCredentials), this.#modelsFile)).listModels() as unknown as JsonValue;
      case 'team.agentRegistry': return []; // ACP execution is a Desktop capability.
      case "team.hosts": return this.#team.hosts() as unknown as JsonValue;
      case "team.list": return this.#team.list() as unknown as JsonValue;
      case "team.profiles": return this.#profileDtos() as unknown as JsonValue;
      case "team.create": return this.#team.create(
        args[0] as unknown as CreateBotRequest,
      ) as unknown as JsonValue;
      case "team.update": return this.#team.update(
        required(args[0], "Team member id"),
        args[1] as unknown as UpdateBotRequest,
      ) as unknown as JsonValue;
      case "team.markRead": return this.#team.markRead(
        required(args[0], "Team member id"),
      ) as unknown as JsonValue;
      case "team.remove": return await this.#removeMember(
        required(args[0], "Team member id"),
      );
      case "team.export": return await this.#team.exportBot(
        required(args[0], "Team member id"),
      ) as unknown as JsonValue;
      case "team.import": return await this.#team.importBot(
        args[0] as unknown as BotTransfer,
        required(args[1], "profile id"),
      ) as unknown as JsonValue;
      case "team.send": return this.#messageDto(await this.#team.send(
        args[0] as unknown as SendAgentMessageRequest,
      )) as unknown as JsonValue;
      case "team.sendExternal": return this.#messageDto(await this.#team.sendFromOrigin(
        args[0],
        args[1],
      )) as unknown as JsonValue;
      case "team.startComputer": return await this.#team.startComputer(
        required(args[0], "Team member id"),
      ) as unknown as JsonValue;
      case "team.stopComputer": return await this.#team.stopComputer(
        required(args[0], "Team member id"),
      ) as unknown as JsonValue;
      case "team.leases": return this.#team.leases(
        typeof args[0] === "string" ? args[0] : undefined,
      ) as unknown as JsonValue;
      case "team.grantLease": return this.#team.grantLease(
        required(args[0], "Team member id"),
        Array.isArray(args[1])
          ? args[1] as LaptopCapabilityLeaseDto["capabilities"]
          : [],
        typeof args[2] === "number" ? args[2] : undefined,
        typeof args[3] === "string" ? args[3] : undefined,
      ) as unknown as JsonValue;
      case "team.revokeLease": return this.#team.revokeLease(
        required(args[0], "lease id"),
      );
      case "team.retrySetup": return this.#team.retrySetup(
        required(args[0], "Team member id"),
      ) as unknown as JsonValue;
      case "team.spawn": return this.#team.spawn(
        args[0] as unknown as CreateBotRequest & {prompt?: string; spawnKey?: string},
        required(args[1], "Parent bot id"),
      ) as unknown as JsonValue;
      case "team.archiveSpawn": return await this.#archiveSpawnedBot(
        required(args[0], "Parent bot id"),
        required(args[1], "Bot name"),
        typeof args[2] === "string" ? args[2] : undefined,
      ) as unknown as JsonValue;
      case 'assistant.ensure': {
        const id = required(args[0], 'conversation id');
        const existing = this.#storage.getConversation(id);
        if (existing && this.#team.botByConversation(id)) throw new Error('This id belongs to a bot.');
        return (existing ?? this.#storage.createConversation({id, title: typeof args[1] === 'string' ? args[1] : 'Assistant', metadata: {deviceAssistant: true}})) as unknown as JsonValue;
      }
      case 'conversations.fork': return forkConversation(this.#storage, required(args[0], 'conversation id'), required(args[1], 'message id')) as unknown as JsonValue;
      case 'conversations.duplicate': {
        const copy = duplicateConversation(this.#storage, required(args[0], 'conversation id'), args[1] == null ? undefined : required(args[1], 'message id'));
        return this.#storage.updateConversation(copy.id, {metadata: {deviceAssistant: true}}) as unknown as JsonValue;
      }
      case 'conversations.list': return this.#team.assistantConversations() as unknown as JsonValue;
      case 'conversations.listArchived': return this.#team.archivedAssistantConversations() as unknown as JsonValue;
      case 'conversations.create': return this.#storage.createConversation({id: randomUUID(), title: typeof args[0] === 'string' ? args[0] : 'Assistant', metadata: {deviceAssistant: true}}) as unknown as JsonValue;
      case 'conversations.rename': return this.#storage.updateConversation(required(args[0], 'conversation id'), {title: required(args[1], 'title')}) as unknown as JsonValue;
      case 'conversations.archive': {
        const id = required(args[0], 'conversation id');
        if (!this.#storage.getConversation(id)) return null;
        if (!this.#team.isAssistantConversation(id)) throw new Error('Only assistant chats can be archived.');
        const active = [...this.#activeRuns].filter(([runId]) => this.#storage.getRun(runId)?.conversationId === id);
        for (const [, run] of active) run.control.cancel(new Error('Conversation archived'));
        await Promise.allSettled(active.map(([,run]) => run.result));
        return this.#storage.updateConversation(id, {archived: true}) as unknown as JsonValue;
      }
      case 'conversations.unarchive': {
        const id = required(args[0], 'conversation id');
        if (!this.#storage.getConversation(id)) return null;
        if (!this.#team.isAssistantConversation(id)) throw new Error('Only assistant chats can be archived.');
        return this.#storage.updateConversation(id, {archived: false}) as unknown as JsonValue;
      }
      case 'conversations.remove': {
        const id = required(args[0], 'conversation id');
        const active = [...this.#activeRuns].filter(([runId]) => this.#storage.getRun(runId)?.conversationId === id);
        for (const [, run] of active) run.control.cancel(new Error('Conversation deleted'));
        await Promise.allSettled(active.map(([,run]) => run.result));
        return this.#storage.deleteConversation(id);
      }
      case 'conversations.upload': {
        const input = args[0] as {conversationId: string; name: string; data: string};
        if (!this.#storage.getConversation(input.conversationId) || typeof input.data !== 'string' || input.data.length > 16 * 1024 * 1024 || !/^[a-zA-Z0-9+/]*={0,2}$/.test(input.data)) throw new Error('Invalid attachment.');
        const bytes = Buffer.from(input.data, 'base64');
        const directory = path.join(this.#options.dataDirectory, 'uploads');
        await mkdir(directory, {recursive: true, mode: 0o700});
        const file = path.join(directory, `${randomUUID()}-${path.basename(input.name).replace(/[^a-zA-Z0-9._-]/g, '_')}`);
        await writeFile(file, bytes, {mode: 0o600});
        return {path: file};
      }
      case 'goals.get': return this.#storage.getGoal(required(args[0], 'conversation id')) as unknown as JsonValue;
      case 'goals.execute': {
        const request = validateGoalCommand(args[0]);
        if (request.action === 'update') return this.#storage.updateGoal(request.conversationId, {objective: request.objective!}) as unknown as JsonValue;
        return new GoalManager(this.#storage).execute(request.conversationId, request.action === 'create' ? {action: 'create', objective: request.objective!} : {action: request.action}) as unknown as JsonValue;
      }
      case 'conversations.updateMessage': {
        const message = updateDeviceMessage(this.#storage, required(args[0], 'message id'), args[1] as Parameters<typeof updateDeviceMessage>[2]);
        return message ? this.#messageDto(message) as unknown as JsonValue : null;
      }
      case "conversations.messages": {
        const conversationId = required(args[0], "conversation id");
        // Opening a bot's conversation heals a missing first-run turn and
        // re-arms a stalled one or a peer message whose wakeup failed.
        let openedBot = this.#team.botByConversation(conversationId);
        if (openedBot) {
          try {
            openedBot = this.#team.ensureSetup(openedBot.id);
          } catch {
            // Keep the previously read bot; the checks below still apply.
          }
        }
        if (openedBot?.setupPending === true) {
          try {
            this.#team.retrySetup(openedBot.id);
          } catch {
            // Introduced, working, or otherwise unable; explicit retry covers it.
          }
        } else if (openedBot) {
          try {
            this.#team.retryRelayDelivery(conversationId);
          } catch {
            // Nothing pending or still working.
          }
        }
        return this.#storage
          .listMessages(conversationId)
          .map((message) => this.#messageDto(message)) as unknown as JsonValue;
      }
      case 'runs.active':
      case 'runs.activeAll': return [...this.#activeRuns.keys()].flatMap(runId => {
        const run = this.#storage.getRun(runId);
        return run && !run.parentRunId ? [{runId, conversationId: run.conversationId}] : [];
      });
      case "runs.start": return await this.#startRun(args[0]) as unknown as JsonValue;
      case "runs.cancel": {
        this.#activeRuns.get(required(args[0], "run id"))?.control.cancel();
        return null;
      }
      case "runs.steer": {
        const runId = required(args[0], "run id");
        const text = required(args[1], "text");
        const run = this.#storage.getRun(runId);
        if (!run) throw new Error(`Run not found: ${runId}`);
        const active = this.#activeRuns.get(runId);
        if (!active) throw new Error(`Run is not active: ${runId}`);
        active.control.steer({role: "user", content: text});
        this.#storage.appendMessage({
          id: typeof args[2] === "string" && args[2] ? args[2] : randomUUID(),
          conversationId: run.conversationId,
          runId,
          role: "user",
          content: text,
        });
        return null;
      }
      case "runs.events": return this.#runEvents(
        required(args[0], "run id"),
        typeof args[1] === "number" ? args[1] : 0,
      ) as unknown as JsonValue;
      case 'runs.updates': {
        const runId = required(args[0], 'run id');
        return {events: this.#runEvents(runId, typeof args[1] === 'number' ? args[1] : 0), draft: this.#drafts.get(runId) ?? null} as unknown as JsonValue;
      }
      case "hub.chats": return await this.#mobileHubChats();
      case "hub.messages": return await this.#mobileHubMessages(
        required(args[0], "chat id"),
        typeof args[1] === "number" ? args[1] : 50,
        typeof args[2] === "string" ? args[2] : undefined,
      ) as unknown as JsonValue;
      case "hub.markRead": {
        await this.#comms.markChatRead(
          required(args[0], "chat id"),
          required(args[1], "message id"),
        );
        return true;
      }
      case "hub.send": return await this.#mobileHubSend(
        required(args[0], "chat id"),
        required(args[1], "message"),
      ) as unknown as JsonValue;
      case "hub.sendFiles": return await this.#mobileHubSendFiles(args[0], args[1]);
      case "hub.emailAccounts": return await this.#comms.emailAccounts() as unknown as JsonValue;
      case "hub.saveEmailAccount": {
        await this.#comms.emailSave(validateSaveEmailAccount(args[0]));
        return await this.#comms.emailAccounts() as unknown as JsonValue;
      }
      case "hub.removeEmailAccount": {
        await this.#comms.emailRemove(required(args[0], "account id"));
        return await this.#comms.emailAccounts() as unknown as JsonValue;
      }
      case "hub.testEmailAccount": {
        return await this.#comms.emailTest(required(args[0], "account id")) as unknown as JsonValue;
      }
      case "vault.status": return this.#vault.status() as unknown as JsonValue;
      case "vault.create": return await this.#vault.create(vaultPassword(args[0])) as unknown as JsonValue;
      case "vault.unlock": return await this.#vault.unlock(vaultPassword(args[0])) as unknown as JsonValue;
      case "vault.lock": return this.#vault.lock() as unknown as JsonValue;
      case "vault.list": return this.#vault.list() as unknown as JsonValue;
      case "vault.reveal": return this.#vault.reveal(vaultId(args[0])) as unknown as JsonValue;
      case "vault.totp": return this.#vault.totp(vaultId(args[0])) as unknown as JsonValue;
      case "vault.save": return await this.#vault.save(vaultItemInput(args[0])) as unknown as JsonValue;
      case "vault.remove": return await this.#vault.remove(vaultId(args[0])) as unknown as JsonValue;
      case "vault.restore": return await this.#vault.restore(vaultIds(args[0])) as unknown as JsonValue;
      case "vault.purge": return await this.#vault.purge(vaultIds(args[0])) as unknown as JsonValue;
      case "vault.emptyTrash": return await this.#vault.emptyTrash() as unknown as JsonValue;
      case "vault.pin": return await this.#vault.pin(vaultIds(args[0]), args[1] === true) as unknown as JsonValue;
      case "vault.reorder": return await this.#vault.reorder(vaultIds(args[0])) as unknown as JsonValue;
      case "vault.changePassword": return await this.#vault.changePassword(
        vaultPassword(args[0], "Current password"),
        vaultPassword(args[1], "New password"),
      ) as unknown as JsonValue;
      case "vault.codes": return this.#vault.codes() as unknown as JsonValue;
      case "vault.otpauth": return this.#vault.otpauth(vaultId(args[0])) as unknown as JsonValue;
      case "vault.copy": return this.#vault.copyText(
        vaultId(args[0]),
        vaultCopyField(args[1]),
        typeof args[2] === "number" ? args[2] : undefined,
      );
      case "vault.sync": return await this.#vault.hydrate() as unknown as JsonValue;
      case "vault.setStorage": return await this.#vault.setStorage(
        vaultStorageMode(args[0]),
        vaultStorageResolve(args[1]),
      ) as unknown as JsonValue;
      case "vault.export": return this.#vault.exportVault() as unknown as JsonValue;
      case "vault.import": return await this.#vault.importVault(vaultBlob(args[0])) as unknown as JsonValue;
      default: throw new Error(`Unsupported Host method: ${method}`);
    }
  }

  async #mobileHubChats(): Promise<JsonValue> {
    const rooms = await this.#comms.chats();
    return rooms.map((room): ChatDto => ({
      id: room.roomId,
      name: room.name,
      platform: room.platform,
      ...(room.remoteId ? {remoteId: room.remoteId} : {}),
      ...(room.currentPortal ? {currentPortal: true} : {}),
      ...(room.space ? {space: true} : {}),
      ...(room.defaultSpace ? {defaultSpace: true} : {}),
      ...(room.parentIds?.length ? {parentIds: room.parentIds} : {}),
      accountIds: room.accountIds,
      unreadByAccount: room.unreadByAccount,
      avatarUrl: room.avatarUrl,
      unread: room.unread,
      lastActivity: room.lastActivity,
      preview: room.preview,
      group: room.group,
      official: room.official,
    })) as unknown as JsonValue;
  }

  async #mobileHubMessages(
    chatId: string,
    limit: number,
    before?: string,
  ): Promise<{messages: ChatMessageDto[]; nextBefore: string | null}> {
    const result = await this.#comms.readChat(chatId, Math.max(1, Math.min(100, limit)), before);
    const me = this.#comms.userId;
    return {
      nextBefore: result.nextBefore ?? null,
      messages: result.messages.map((message): ChatMessageDto => {
        const mine = message.mine || (Boolean(me) && message.sender === me);
        return {
          id: message.eventId,
          chatId: message.roomId || chatId,
          sender: message.sender,
          senderName: mine ? "You" : message.senderName || message.sender,
          senderAvatarUrl: message.senderAvatarUrl,
          body: message.body,
          notice: message.notice,
          sentAt: message.sentAt,
          mine,
          attachments: message.attachments,
          linkPreview: message.linkPreview,
          forwarded: message.forwarded,
          viewIn: message.viewIn,
          reactions: message.reactions,
          replyTo: message.replyTo,
        };
      }),
    };
  }

  async #mobileHubSend(chatId: string, body: string): Promise<ChatMessageDto> {
    const eventId = await this.#comms.sendChat(chatId, body);
    return {
      id: eventId,
      chatId,
      sender: this.#comms.userId ?? "",
      senderName: "You",
      senderAvatarUrl: null,
      body,
      sentAt: new Date().toISOString(),
      mine: true,
      attachments: [],
      reactions: [],
    } as ChatMessageDto;
  }

  async #mobileHubSendFiles(chatValue: JsonValue, filesValue: JsonValue): Promise<JsonValue> {
    const chatId = required(chatValue, "chat id");
    if (!Array.isArray(filesValue) || !filesValue.length) throw new Error("Choose at least one file");
    if (filesValue.length > 6) throw new Error("Send at most six files at once");
    const files = filesValue.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("A Hub attachment is invalid");
      const input = value as Record<string, JsonValue>;
      const name = path.basename(required(input.name, "file name"))
        .replace(/[^a-z0-9._ -]+/gi, "_").slice(0, 180) || "attachment";
      const encoded = required(input.data, "file data");
      if (encoded.length > 16 * 1024 * 1024 || !/^[a-z0-9+/]*={0,2}$/i.test(encoded))
        throw new Error(`${name} is invalid or larger than 12 MB`);
      const bytes = Buffer.from(encoded, "base64");
      if (bytes.byteLength > 12 * 1024 * 1024) throw new Error(`${name} is larger than 12 MB`);
      return {
        name,
        mimetype: typeof input.mimeType === "string" && input.mimeType
          ? input.mimeType.slice(0, 160)
          : "application/octet-stream",
        bytes: new Uint8Array(bytes),
      };
    });
    await this.#comms.sendChatFiles(chatId, files);
    return null;
  }

  async #startRun(value: JsonValue): Promise<{runId: string}> {
    const request = validateStartRun(value);
    const member = this.#team.botByConversation(request.conversationId);
    if (member?.agentRuntime?.kind === 'acp') throw new Error('This Host does not run ACP agents. Use the bot on Desktop or choose Polymux in its agent settings.');
    const conversation = this.#storage.getConversation(request.conversationId);
    const assistant = conversation?.metadata && typeof conversation.metadata === 'object' && !Array.isArray(conversation.metadata) && conversation.metadata.deviceAssistant === true;
    if (!member && !assistant) throw new Error('Create an Assistant conversation on this device first.');
    if (request.rewind) {
      await this.#settleConversationRuns(request.conversationId, 'Edited and resent');
      rewindConversation(this.#storage, {
        conversationId: request.conversationId,
        messageId: request.messageId!,
        content: request.text,
        attachments: request.attachments,
      });
    }
    const identity = member ?? {id: request.conversationId, profileId: this.#profiles.snapshot().activeId};
    const selectedModel = this.#modelFor(identity.profileId, request.conversationId);
    this.#profiles.setPreference(`conversation.model:${request.conversationId}`, parseModel(selectedModel) as unknown as JsonValue, identity.profileId);
    const computer = await this.#computers.start(identity.id);
    if (computer.state !== "running")
      throw new Error(computer.detail ?? "This bot's isolated computer is unavailable");
    const agent = await this.#runtimeFor(identity);
    if (request.rewind) agent.resetHistory(request.conversationId);
    const runId = randomUUID();
    const active = agent.start({
      conversationId: request.conversationId,
      text: request.text,
      userMessageId: request.messageId,
      attachments: request.attachments,
      reasoning: request.reasoning ?? this.#reasoningFor(identity.profileId, selectedModel, request.conversationId),
      speechMode: request.speechMode,
      asGoal: request.asGoal,
      reuseUserMessage: Boolean(request.reuseUserMessage || request.rewind),
      runId,
      identity: member ? {
        name: member.name,
        role: member.role,
        bots: this.#team.list()
          .filter((candidate) => candidate.id !== member.id)
          .map((candidate) => ({name: candidate.name, role: candidate.role})),
      } : undefined,
    });
    this.#track(runId, active);
    return {runId};
  }

  async #settleConversationRuns(conversationId: string, reason: string): Promise<void> {
    while (true) {
      const active = [...this.#activeRuns.entries()]
        .filter(([runId]) => this.#storage.getRun(runId)?.conversationId === conversationId)
        .map(([, run]) => run);
      if (!active.length) return;
      for (const run of active) run.control.cancel(new Error(reason));
      await Promise.allSettled(active.map((run) => run.result));
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  async #runtimeFor(member: Pick<BotDto, "id" | "profileId">): Promise<PolymuxAgent> {
    await this.#resourceReload;
    const configured = this.#modelFor(member.profileId, this.#team.list().find(bot => bot.id === member.id)?.conversationId ?? member.id);
    const key = JSON.stringify({profileId: member.profileId, model: configured});
    const cached = this.#runtimes.get(member.id);
    if (cached?.key === key) return cached.agent;
    if (cached) await cached.agent.settleGoalWork();

    const credentials = new EnvironmentCredentialStore(this.#modelCredentials);
    const inference = new PiInference(hostModels(credentials, this.#modelsFile));
    const model = parseModel(configured);
    if (!inference.getModel(model))
      throw new Error(`The Host does not recognise model ${model.provider}/${model.id}`);
    const profileDirectory = this.#profiles.directory(member.profileId);
    const agent = new PolymuxAgent({
      inference,
      storage: this.#storage,
      memory: new MemoryManager({directory: path.join(profileDirectory, "memories")}),
      environment: {promptContext: () => headlessEnvironment()},
      tools: this.#tools,
      model,
      skills: {
        official: this.#options.officialSkillDirectories,
        personal: path.join(profileDirectory, "skills"),
        configured: [path.join(path.dirname(this.#modelsFile), "skills")],
      },
      prompts: this.#options.prompts,
      onGoalContinuation: ({runId, run}) => this.#track(runId, run),
      onSubagentRun: ({runId, run}) => this.#track(runId, run),
    });
    this.#runtimes.set(member.id, {key, agent});
    return agent;
  }

  #track(runId: string, active: ActiveAgentRun): void {
    this.#activeRuns.set(runId, active);
    this.#team.publish();
    void (async () => {
      try {
        for await (const event of active.events) {
          if (event.type === 'message.text.delta') {
            const previous = this.#drafts.get(runId);
            this.#drafts.set(runId, {turn: event.turn, text: (previous?.turn === event.turn ? previous.text : '') + event.delta, timestamp: event.timestamp});
          } else if (event.type === 'message.completed' || event.type === 'model.started') this.#drafts.delete(runId);
          // The agent persists the durable event. Draining keeps live runs and
          // cancellation responsive even when no CLI is attached.
        }
        await active.result;
      } catch {
        // The agent records a durable run.failed event and error.
      } finally {
        this.#drafts.delete(runId);
        this.#activeRuns.delete(runId);
        this.#team.publish();
      }
    })();
  }

  #deliver(input: {
    conversationId: string;
    text: string;
    messageId: string;
  }): void {
    const active = [...this.#activeRuns.entries()].reverse().find(([runId]) => {
      const run = this.#storage.getRun(runId);
      return run?.conversationId === input.conversationId && !run.parentRunId;
    });
    if (active) {
      active[1].control.steer({role: "user", content: input.text});
      return;
    }
    void this.#startRun({
      conversationId: input.conversationId,
      text: input.text,
      messageId: input.messageId,
      attachments: [],
      // The delivered row already exists, so the run must reuse it instead of
      // appending a second user message with the same id.
      reuseUserMessage: true,
    }).catch((error) => {
      const message = this.#storage.getMessage(input.messageId);
      if (!message) return;
      const metadata = message.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata)
        ? {...message.metadata}
        : {};
      this.#storage.updateMessage(input.messageId, {
        metadata: {
          ...metadata,
          deliveryError: error instanceof Error ? error.message : String(error),
        },
      });
    });
  }

  async #removeMember(id: string): Promise<boolean> {
    const member = this.#team.require(id);
    for (const [runId, active] of this.#activeRuns) {
      if (this.#storage.getRun(runId)?.conversationId === member.conversationId)
        active.control.cancel(new Error("Team member deleted"));
    }
    const cached = this.#runtimes.get(id);
    if (cached) await cached.agent.settleGoalWork();
    this.#runtimes.delete(id);
    const removed = await this.#team.remove(id);
    if (removed) this.#retireBotSchedules(id);
    return removed;
  }

  async #archiveSpawnedBot(parentBotId: string, confirmName: string, botId?: string): Promise<BotDto> {
    const target = this.#team.spawnedBot(parentBotId, confirmName, botId);
    for (const [runId, active] of this.#activeRuns) {
      if (this.#storage.getRun(runId)?.conversationId === target.conversationId)
        active.control.cancel(new Error("Team member deleted"));
    }
    const cached = this.#runtimes.get(target.id);
    if (cached) await cached.agent.settleGoalWork();
    this.#runtimes.delete(target.id);
    const archived = await this.#team.archiveSpawnedBot(parentBotId, confirmName, botId);
    this.#retireBotSchedules(archived.id);
    return archived;
  }

  /** Drops a removed bot's schedules; without its conversation they can never run again. */
  #retireBotSchedules(botId: string): void {
    for (const item of this.#scheduler.list()) {
      if (item.botId !== botId) continue;
      try {
        this.#scheduler.remove(item.id);
      } catch {
        // Already removed between the list and the remove.
      }
    }
  }

  #profileDtos(): ProfileDto[] {
    return this.#profiles.snapshot().profiles.map((profile) => ({
      ...profile,
      source: profile.source,
      agent: {kind: "polymux", id: "polymux", name: "Polymux"},
      teamEligible: true,
    }));
  }

  async #reloadResources(): Promise<void> {
    if (this.#activeRuns.size) throw new Error("Wait for active Host runs before reloading resources.");
    if (this.#resourceReload) return this.#resourceReload;
    const reload = async () => {
      const file = path.join(path.dirname(this.#modelsFile), "mcp.json");
      const raw = await readFile(file, "utf8").catch(error => {if (error.code === "ENOENT") return '{"mcpServers":{}}'; throw error;});
      const configs = importMcpServers(JSON.parse(raw));
      // Only explicitly configured Polymux servers are loaded. Never scan other apps.
      this.#mcp.configure(configs);
      this.#mcpNames = configs.filter(config => config.enabled !== false).map(config => config.name || config.id);
      await this.#mcp.connectEnabled();
      for (const name of this.#mcpTools) this.#tools.remove(name);
      this.#mcpTools.clear();
      for (const tool of this.#mcp.tools()) {this.#tools.register(tool); this.#mcpTools.add(tool.name);}
      this.#runtimes.clear();
    };
    this.#resourceReload = reload();
    try {await this.#resourceReload;} finally {this.#resourceReload = null;}
  }

  #requireProfile(profileId: string): void {
    if (!this.#profiles.snapshot().profiles.some((profile) => profile.id === profileId))
      throw new Error("That Host profile no longer exists");
  }

  #conversationProfile(conversationId: string): string {
    if (!this.#storage.getConversation(conversationId)) throw new Error('Conversation not found.');
    return this.#team.botByConversation(conversationId)?.profileId ?? this.#profiles.snapshot().activeId;
  }

  #reasoningFor(profileId: string, model: string, conversationId?: string): import('@polymux/protocol').ReasoningEffort | undefined {
    const value = (conversationId ? this.#profiles.preference(`conversation.reasoning:${conversationId}:${model}`, profileId)?.value : undefined) ?? this.#profiles.preference(`model.reasoning:${model}`, profileId)?.value;
    return typeof value === 'string' && ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(value)
      ? value as import('@polymux/protocol').ReasoningEffort : undefined;
  }

  #runConfiguration(conversationId: string): JsonValue {
    const profileId = this.#conversationProfile(conversationId);
    let model: string | null = null;
    try { model = this.#modelFor(profileId, conversationId); } catch { /* An unconfigured host can still open the model picker. */ }
    const skills = new SkillLoader({official: this.#options.officialSkillDirectories, personal: path.join(this.#profiles.directory(profileId), 'skills'), configured: [path.join(path.dirname(this.#modelsFile), 'skills')]}).load().skills.map(skill => skill.name);
    const info = model ? new PiInference(hostModels(new EnvironmentCredentialStore(this.#modelCredentials), this.#modelsFile)).getModel(parseModel(model)) : undefined;
    return {model, reasoning: model ? this.#reasoningFor(profileId, model, conversationId) ?? 'xhigh' : 'xhigh', contextWindow: info?.contextWindow ?? 0, skills, mcps: this.#mcpNames};
  }

  #modelFor(profileId: string, conversationId?: string): string {
    const deployed = this.#options.model?.trim() || process.env.POLYMUX_MODEL?.trim();
    if (deployed) return deployed;
    const stored = (conversationId ? this.#profiles.preference(`conversation.model:${conversationId}`, profileId)?.value : null) ?? this.#profiles.preference("model", profileId)?.value;
    if (stored && typeof stored === "object" && !Array.isArray(stored)) {
      const provider = typeof stored.provider === "string" ? stored.provider : "";
      const id = typeof stored.id === "string" ? stored.id : "";
      if (provider && id) return `${provider}/${id}`;
    }
    throw new Error(
      "No Host model is configured. Set POLYMUX_MODEL=provider/model in the Host service environment.",
    );
  }

  #messageDto(message: StoredMessage): MessageDto {
    return {
      ...message,
      attachments: this.#storage.listAttachments(message.id),
    } as MessageDto;
  }

  #runEvents(runId: string, afterSequence: number): RunEventDto[] {
    const run = this.#storage.getRun(runId);
    const conversationId = run?.conversationId ?? "";
    return this.#storage.listRunEvents(runId, afterSequence).map((event) => {
      const timestamp = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload) && "timestamp" in event.payload
        ? Number((event.payload as JsonObject).timestamp)
        : Date.parse(event.createdAt);
      return {
        runId: event.runId,
        conversationId,
        parentRunId: run?.parentRunId ?? null,
        sequence: event.sequence,
        timestamp,
        type: event.type,
        payload: event.payload,
      };
    });
  }
}

class EnvironmentCredentialStore implements CredentialStore {
  constructor(private readonly stored: HeadlessCredentialStore) {}
  async read(providerId: string): Promise<Credential | undefined> {
    const saved = await this.stored.read(providerId);
    if (saved) return saved;
    const key = providerKey(providerId);
    return key ? {type: "api_key", key} : undefined;
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return [];
  }

  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    return this.stored.modify(providerId, async current => { const key = providerKey(providerId); return fn(current ?? (key ? {type: "api_key", key} : undefined)); });
  }

  async delete(providerId: string): Promise<void> { await this.stored.delete(providerId); }
}

function providerKey(providerId: string): string | undefined {
  const aliases: Record<string, string | undefined> = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    google: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
  };
  return aliases[providerId]
    ?? process.env[`${providerId.replace(/[^a-z0-9]/gi, "_").toUpperCase()}_API_KEY`];
}

function parseModel(value: string): ModelRef {
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1)
    throw new Error("POLYMUX_MODEL must use provider/model format");
  return {provider: value.slice(0, separator), id: value.slice(separator + 1)};
}

function required(value: JsonValue | undefined, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function headlessEnvironment(): EnvironmentContext {
  const now = new Date();
  const offsetMinutes = -now.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const hours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, "0");
  const minutes = String(Math.abs(offsetMinutes) % 60).padStart(2, "0");
  return {
    time: {
      local: new Intl.DateTimeFormat(undefined, {dateStyle: "full", timeStyle: "long"}).format(now),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      utcOffset: `${sign}${hours}:${minutes}`,
      instant: now.toISOString(),
    },
    locationEnabled: false,
    browserTabs: [],
    externalBrowserTabs: [],
    windows: [{app: "Polymux Host", title: hostname() || "Headless Host", frontmost: false}],
  };
}
