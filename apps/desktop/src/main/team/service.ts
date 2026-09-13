import {deviceType, type DeviceType} from '@polymux/protocol';
import {createHash, randomUUID} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {hostname} from "node:os";
import path from "node:path";
import type {AgentTool, AgentToolContext, AgentToolResult} from "@polymux/core";
import type {JsonObject} from "@polymux/inference";
import type {
  AgentMessageOriginDto,
  CreateTeamGroupRequest,
  CreateBotRequest,
  LaptopCapabilityLeaseDto,
  MessageDto,
  PairTeamHostRequest,
  ProfileDto,
  SendAgentMessageRequest,
  TeamAvatarDto,
  TeamGroupDto,
  TeamHostDto,
  BotDto,
  UpdateTeamGroupRequest,
  UpdateBotRequest,
} from "@polymux/protocol";
import {TEAM_AVATAR_SHAPES} from "@polymux/protocol";
import type {JsonValue, Storage, StoredMessage} from "@polymux/storage";
import type {ProfileManager} from "../profiles.js";
import {TeamComputerManager} from "./computers.js";
import {TEAM_BOT_SETUP_KEY, isTeamBotSetupCue, teamBotSetupPrompt} from "./setup.js";

const TEAM_METADATA_KEY = "bot";
const TEAM_GROUP_METADATA_KEY = "teamGroup";
const LEASES_KEY = "team.laptop-leases";
const HOSTS_KEY = "team.hosts";
const DEFAULT_HOST_KEY = "team.default-host-id";
const DESKTOP_ID_KEY = "team.desktop-id";
const HOST_ID_KEY = "team.local-host-id";
const TRACE_LEDGER_KEY = "team.relay-traces";
const MAX_HOPS = 4;
const MAX_DELIVERIES_PER_TRACE = 12;
const MAX_RELAY_TRACES = 512;
const RELAY_TRACE_TTL_MS = 24 * 60 * 60_000;

type Capability = LaptopCapabilityLeaseDto["capabilities"][number];

interface BotRecord {
  version: 1;
  id: string;
  name: string;
  role: string;
  profileId: string;
  avatar: TeamAvatarDto;
  laptopAccess: "off" | "ask";
  unread: boolean;
  unreadCount: number;
  skills?: string[];
  mcpServers?: string[];
  plugins?: string[];
}

interface TeamGroupRecord {
  version: 1;
  id: string;
  name: string;
  memberIds: string[];
  unread: boolean;
  unreadCount: number;
}

interface RelayTraceRecord {
  traceId: string;
  deliveries: number;
  conversations: string[];
  updatedAt: string;
}

interface TeamServiceOptions {
  storage: Storage;
  profiles: ProfileManager;
  computers: TeamComputerManager;
  isConversationRunning?: (conversationId: string) => boolean;
  deliver?: (input: {
    conversationId: string;
    text: string;
    messageId: string;
    /** Absent for host-authored turns such as a new bot's setup cue. */
    source?: AgentMessageOriginDto;
  }) => void;
  requestLaptopAccess?: (
    member: BotDto,
    capability: Capability,
    tool: string,
  ) => Promise<boolean>;
  publish?: (members: BotDto[]) => void;
  publishGroups?: (groups: TeamGroupDto[]) => void;
  writeHostSecret?: (hostId: string, secret: string | null) => Promise<void>;
  validateProfile?: (profileId: string) => void;
  transferDirectory?: string;
}

export interface BotTransfer {
  version: 1;
  member: Pick<BotDto,
    "id" | "conversationId" | "name" | "role" | "avatar" |
    "laptopAccess" | "unread" | "unreadCount" | "skills" | "mcpServers" | "plugins">;
  conversation: {title: string; createdAt: string; updatedAt: string};
  messages: Array<{
    id: string;
    role: StoredMessage["role"];
    content: JsonValue;
    metadata: JsonValue;
    createdAt: string;
    attachments: Array<{
      id: string;
      name: string;
      mimeType: string | null;
      size: number | null;
      sha256: string | null;
      data: string;
    }>;
  }>;
}

interface LocalHostInfo {
  deviceType?: DeviceType;
  endpoint: string | null;
  pairingCode: string | null;
  pairingExpiresAt: string | null;
  pairedDesktopName: string | null;
  detail: string | null;
}

type LaptopBroker = (
  member: BotDto,
  capability: Capability,
  tool: AgentTool,
  input: JsonObject,
  context: AgentToolContext,
  requiresApproval: boolean,
) => Promise<{approved: boolean; result: AgentToolResult} | null>;

/** Durable Team identities, peer mailboxes, device leases, and 1:1 Host state. */
export class TeamService {
  readonly #storage: Storage;
  readonly #profiles: ProfileManager;
  readonly #computers: TeamComputerManager;
  readonly #isConversationRunning: (conversationId: string) => boolean;
  readonly #deliver?: TeamServiceOptions["deliver"];
  readonly #requestLaptopAccess?: TeamServiceOptions["requestLaptopAccess"];
  readonly #publish?: TeamServiceOptions["publish"];
  readonly #publishGroups?: TeamServiceOptions["publishGroups"];
  readonly #writeHostSecret?: TeamServiceOptions["writeHostSecret"];
  readonly #validateProfile?: TeamServiceOptions["validateProfile"];
  readonly #transferDirectory: string | null;
  #localHostInfo: (() => LocalHostInfo) | null = null;
  #laptopBroker: LaptopBroker | null = null;

  constructor(options: TeamServiceOptions) {
    this.#storage = options.storage;
    this.#profiles = options.profiles;
    this.#computers = options.computers;
    this.#isConversationRunning = options.isConversationRunning ?? (() => false);
    this.#deliver = options.deliver;
    this.#requestLaptopAccess = options.requestLaptopAccess;
    this.#publish = options.publish;
    this.#publishGroups = options.publishGroups;
    this.#writeHostSecret = options.writeHostSecret;
    this.#validateProfile = options.validateProfile;
    this.#transferDirectory = options.transferDirectory ?? null;
    this.#stableId(DESKTOP_ID_KEY);
    this.#stableId(HOST_ID_KEY);
  }

  list(): BotDto[] {
    const profiles = this.#profiles.snapshot().profiles;
    const localHost = this.localHost();
    return this.#storage
      .listConversations({includeArchived: false, limit: 500})
      .flatMap((conversation): BotDto[] => {
        const record = botRecord(conversation.metadata);
        if (!record) return [];
        const profile = profiles.find((candidate) => candidate.id === record.profileId);
        const latest = this.#storage.latestMessage(conversation.id);
        // The setup cue is host wording, not the user's, so a bot that has not
        // answered yet keeps its role as the preview.
        const preview = latest && !isTeamBotSetupCue(latest.metadata)
          ? messageText(latest.content)
          : record.role;
        const computer = this.#computers.snapshot(record.id);
        return [{
          id: record.id,
          conversationId: conversation.id,
          name: record.name,
          role: record.role,
          profileId: record.profileId,
          profileName: profile?.name ?? "Missing profile",
          hostId: localHost.hostId,
          hostName: localHost.deviceName,
          deviceType: localHost.deviceType,
          avatar: record.avatar,
          laptopAccess: record.laptopAccess,
          status: this.#isConversationRunning(conversation.id)
            ? "working"
            : computer.state === "error" || computer.state === "unavailable"
              ? "computer-offline"
              : "idle",
          preview: preview.slice(0, 180),
          updatedAt: conversation.updatedAt,
          unread: record.unread,
          unreadCount: record.unreadCount,
          computer,
          skills: record.skills,
          mcpServers: record.mcpServers,
          plugins: record.plugins,
        }];
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  publish(): void {
    this.#publishMembers();
    this.#publishTeamGroups();
  }

  groups(): TeamGroupDto[] {
    return this.#storage
      .listConversations({includeArchived: false, limit: 500})
      .flatMap((conversation): TeamGroupDto[] => {
        const record = teamGroupRecord(conversation.metadata);
        if (!record) return [];
        const latest = this.#storage.latestMessage(conversation.id);
        return [{
          id: record.id,
          conversationId: conversation.id,
          name: record.name,
          memberIds: record.memberIds,
          preview: latest ? messageText(latest.content).slice(0, 180) : "No messages yet",
          updatedAt: conversation.updatedAt,
          unread: record.unread,
          unreadCount: record.unreadCount,
        }];
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  group(id: string): TeamGroupDto | null {
    return this.groups().find((group) => group.id === id || group.conversationId === id) ?? null;
  }

  createGroup(request: CreateTeamGroupRequest): TeamGroupDto {
    const input = groupCreateRequest(request);
    const id = randomUUID();
    const record: TeamGroupRecord = {
      version: 1,
      id,
      name: input.name,
      memberIds: input.memberIds,
      unread: false,
      unreadCount: 0,
    };
    const conversation = this.#storage.createConversation({
      id: randomUUID(),
      title: input.name,
      metadata: {[TEAM_GROUP_METADATA_KEY]: record as unknown as JsonValue},
    });
    this.#publishTeamGroups();
    return this.group(conversation.id)!;
  }

  updateGroup(id: string, request: UpdateTeamGroupRequest): TeamGroupDto {
    const current = this.group(id);
    if (!current) throw new Error("Unknown Team group");
    const conversation = this.#storage.getConversation(current.conversationId)!;
    const record = teamGroupRecord(conversation.metadata)!;
    const patch = groupUpdateRequest(request);
    const next: TeamGroupRecord = {
      ...record,
      ...(patch.name === undefined ? {} : {name: patch.name}),
      ...(patch.memberIds === undefined ? {} : {memberIds: patch.memberIds}),
    };
    this.#storage.updateConversation(conversation.id, {
      title: next.name,
      metadata: withTeamGroupRecord(conversation.metadata, next),
    });
    this.#publishTeamGroups();
    return this.group(id)!;
  }

  markGroupRead(id: string): TeamGroupDto {
    const current = this.group(id);
    if (!current) throw new Error("Unknown Team group");
    if (!current.unread && !current.unreadCount) return current;
    const conversation = this.#storage.getConversation(current.conversationId)!;
    const record = teamGroupRecord(conversation.metadata)!;
    this.#storage.updateConversation(conversation.id, {
      metadata: withTeamGroupRecord(conversation.metadata, {...record, unread: false, unreadCount: 0}),
    });
    this.#publishTeamGroups();
    return this.group(id)!;
  }

  removeGroup(id: string): boolean {
    const group = this.group(id);
    if (!group) return false;
    const removed = this.#storage.deleteConversation(group.conversationId);
    if (removed) this.#publishTeamGroups();
    return removed;
  }

  setLocalHostInfo(provider: () => LocalHostInfo): void {
    this.#localHostInfo = provider;
  }

  setLaptopBroker(broker: LaptopBroker): void {
    this.#laptopBroker = broker;
  }

  create(request: CreateBotRequest): BotDto {
    const input = createRequest(request, this.#profiles);
    this.#validateProfile?.(input.profileId);
    const id = randomUUID();
    const record: BotRecord = {
      version: 1,
      id,
      name: input.name,
      role: input.role,
      profileId: input.profileId,
      avatar: input.avatar,
      laptopAccess: input.laptopAccess ?? "off",
      unread: false,
      unreadCount: 0,
      skills: input.skills,
      mcpServers: input.mcpServers,
      plugins: input.plugins,
    };
    const conversation = this.#storage.createConversation({
      id: randomUUID(),
      title: input.name,
      metadata: {[TEAM_METADATA_KEY]: record as unknown as JsonValue},
    });
    this.#publishMembers();
    const member = this.botByConversation(conversation.id)!;
    this.#startSetup(member);
    return member;
  }

  /**
   * Opens a new bot's conversation in its own voice: the cue is stored as the
   * first user turn (hidden from the transcript) and delivered to the Host
   * that owns the bot, which starts or steers the setup run.
   */
  #startSetup(member: BotDto): void {
    const deliver = this.#deliver;
    if (!deliver) return;
    const text = teamBotSetupPrompt(member);
    const message = this.#storage.appendMessage({
      id: randomUUID(),
      conversationId: member.conversationId,
      runId: null,
      role: "user",
      content: text,
      metadata: {[TEAM_BOT_SETUP_KEY]: true},
    });
    this.#publishMembers();
    queueMicrotask(() => deliver({
      conversationId: member.conversationId,
      text,
      messageId: message.id,
    }));
  }

  update(id: string, request: UpdateBotRequest): BotDto {
    const current = this.require(id);
    const conversation = this.#storage.getConversation(current.conversationId)!;
    const record = botRecord(conversation.metadata)!;
    const patch = updateRequest(request, this.#profiles);
    if (patch.profileId !== undefined) this.#validateProfile?.(patch.profileId);
    const next: BotRecord = {
      ...record,
      ...(patch.name === undefined ? {} : {name: patch.name}),
      ...(patch.role === undefined ? {} : {role: patch.role}),
      ...(patch.profileId === undefined ? {} : {profileId: patch.profileId}),
      ...(patch.avatar === undefined ? {} : {avatar: patch.avatar}),
      ...(patch.laptopAccess === undefined ? {} : {laptopAccess: patch.laptopAccess}),
      ...(patch.skills === undefined ? {} : {skills: patch.skills}),
      ...(patch.mcpServers === undefined ? {} : {mcpServers: patch.mcpServers}),
      ...(patch.plugins === undefined ? {} : {plugins: patch.plugins}),
    };
    this.#storage.updateConversation(conversation.id, {
      title: next.name,
      metadata: withBotRecord(conversation.metadata, next),
    });
    if (next.laptopAccess === "off")
      this.#storeLeases(this.leases().filter((lease) => lease.memberId !== id));
    this.#publishMembers();
    return this.require(id);
  }

  async remove(id: string): Promise<boolean> {
    const member = this.bot(id);
    if (!member) return false;
    const removed = this.#storage.deleteConversation(member.conversationId);
    if (removed) {
      this.#storeLeases(this.leases().filter((lease) => lease.memberId !== id));
      await this.#computers.destroy(id);
      this.#publishMembers();
      for (const group of this.groups()) {
        if (!group.memberIds.includes(id)) continue;
        const remaining = group.memberIds.filter((memberId) => memberId !== id);
        if (remaining.length) this.updateGroup(group.id, {memberIds: remaining});
        else this.removeGroup(group.id);
      }
    }
    return removed;
  }

  async exportBot(id: string): Promise<BotTransfer> {
    const member = this.require(id);
    if (this.#isConversationRunning(member.conversationId))
      throw new Error(`Stop ${member.name}'s active run before moving Hosts.`);
    const conversation = this.#storage.getConversation(member.conversationId)!;
    let totalBytes = 0;
    const messages: BotTransfer["messages"] = [];
    for (const message of this.#storage.listMessages(member.conversationId)) {
      const attachments: BotTransfer["messages"][number]["attachments"] = [];
      for (const attachment of this.#storage.listAttachments(message.id)) {
        const bytes = await readFile(attachment.path).catch((): null => null);
        if (!bytes)
          throw new Error(`Move stopped because ${attachment.name} is no longer available on the current Host.`);
        totalBytes += bytes.byteLength;
        if (bytes.byteLength > 12 * 1024 * 1024 || totalBytes > 12 * 1024 * 1024)
          throw new Error("Move attachments must be at most 12 MB total.");
        attachments.push({
          id: attachment.id,
          name: attachment.name,
          mimeType: attachment.mimeType,
          size: attachment.size,
          sha256: attachment.sha256,
          data: bytes.toString("base64"),
        });
      }
      messages.push({
        id: message.id,
        role: message.role,
        content: message.content,
        metadata: message.metadata,
        createdAt: message.createdAt,
        attachments,
      });
    }
    return {
      version: 1,
      member: {
        id: member.id,
        conversationId: member.conversationId,
        name: member.name,
        role: member.role,
        avatar: member.avatar,
        laptopAccess: member.laptopAccess,
        unread: member.unread,
        unreadCount: member.unreadCount,
        skills: member.skills,
        mcpServers: member.mcpServers,
        plugins: member.plugins,
      },
      conversation: {
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      },
      messages,
    };
  }

  async importBot(value: BotTransfer, profileId: string): Promise<BotDto> {
    if (
      value?.version !== 1 || !value.member || !value.conversation || !Array.isArray(value.messages) ||
      typeof value.conversation.title !== "string" ||
      typeof value.conversation.createdAt !== "string" ||
      typeof value.conversation.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(value.conversation.createdAt)) ||
      !Number.isFinite(Date.parse(value.conversation.updatedAt))
    )
      throw new Error("That bot transfer is invalid.");
    const conversationSegment = transferSegment(value.member.conversationId, "conversation id");
    transferSegment(value.member.id, "bot id");
    for (const message of value.messages) {
      transferSegment(message?.id, "message id");
      if (
        !["system", "user", "assistant", "tool"].includes(message?.role) ||
        !Array.isArray(message?.attachments) ||
        typeof message?.createdAt !== "string" || !Number.isFinite(Date.parse(message.createdAt))
      ) throw new Error("That bot transfer contains an invalid message.");
    }
    if (this.bot(value.member.id) || this.#storage.getConversation(value.member.conversationId))
      throw new Error("That bot already exists on this Host.");
    this.#validateProfile?.(profileId);
    const input = createRequest({
      name: value.member.name,
      role: value.member.role,
      profileId,
      avatar: value.member.avatar,
      laptopAccess: value.member.laptopAccess,
      skills: value.member.skills,
      mcpServers: value.member.mcpServers,
      plugins: value.member.plugins,
    }, this.#profiles);
    const record: BotRecord = {
      version: 1,
      id: value.member.id,
      name: input.name,
      role: input.role,
      profileId: input.profileId,
      avatar: input.avatar,
      laptopAccess: input.laptopAccess ?? "off",
      unread: value.member.unread === true,
      unreadCount: Number.isSafeInteger(value.member.unreadCount) && (value.member.unreadCount ?? 0) > 0
        ? Math.min(999, value.member.unreadCount!)
        : value.member.unread === true ? 1 : 0,
    };
    const prepared = value.messages.flatMap((message) => message.attachments.map((attachment) => {
      if (!this.#transferDirectory) throw new Error("This Host cannot store transferred attachments.");
      const attachmentSegment = transferSegment(attachment?.id, "attachment id");
      if (typeof attachment?.name !== "string" || typeof attachment?.data !== "string")
        throw new Error("A transferred attachment is invalid.");
      if (!/^[a-z0-9+/]*={0,2}$/i.test(attachment.data)) throw new Error("A transferred attachment is invalid.");
      const bytes = Buffer.from(attachment.data, "base64");
      if (bytes.byteLength > 12 * 1024 * 1024) throw new Error("A transferred attachment is larger than 12 MB.");
      const safeName = path.basename(attachment.name).replace(/[^a-z0-9._ -]+/gi, "_").slice(0, 180) || "attachment";
      return {
        messageId: message.id,
        attachment,
        bytes,
        safeName,
        target: path.join(this.#transferDirectory, conversationSegment, `${attachmentSegment}-${safeName}`),
      };
    }));
    const createdFiles: string[] = [];
    try {
      for (const file of prepared) {
        await mkdir(path.dirname(file.target), {recursive: true});
        await writeFile(file.target, file.bytes);
        createdFiles.push(file.target);
      }
      this.#storage.transaction(() => {
        this.#storage.createConversation({
          id: value.member.conversationId,
          title: value.conversation.title || input.name,
          metadata: {[TEAM_METADATA_KEY]: record as unknown as JsonValue},
          createdAt: value.conversation.createdAt,
          updatedAt: value.conversation.updatedAt,
        });
        for (const message of value.messages) {
          this.#storage.appendMessage({
            id: message.id,
            conversationId: value.member.conversationId,
            role: message.role,
            content: message.content,
            metadata: message.metadata,
            createdAt: message.createdAt,
          });
          for (const file of prepared.filter((candidate) => candidate.messageId === message.id)) {
            const attachment = file.attachment;
            this.#storage.addAttachment({
              id: attachment.id,
              messageId: message.id,
              name: file.safeName,
              path: file.target,
              mimeType: attachment.mimeType,
              size: file.bytes.byteLength,
              sha256: attachment.sha256,
            });
          }
        }
      });
    } catch (error) {
      this.#storage.deleteConversation(value.member.conversationId);
      await Promise.allSettled(createdFiles.map((file) => rm(file, {force: true})));
      throw error;
    }
    this.#publishMembers();
    return this.require(value.member.id);
  }

  bot(id: string): BotDto | null {
    return this.list().find((candidate) => candidate.id === id) ?? null;
  }

  botByConversation(conversationId: string): BotDto | null {
    return this.list().find((candidate) => candidate.conversationId === conversationId) ?? null;
  }

  botForRun(runId: string): BotDto | null {
    const run = this.#storage.getRun(runId);
    return run ? this.botByConversation(run.conversationId) : null;
  }

  require(id: string): BotDto {
    const member = this.bot(id);
    if (!member) throw new Error("Unknown Team member");
    return member;
  }

  /** Assistant conversations only; Team people and groups have their own surface. */
  assistantConversations() {
    return this.#storage
      .listConversations({limit: 500})
      .filter((conversation) => this.isAssistantConversation(conversation.id));
  }

  archivedAssistantConversations() {
    return this.#storage
      .listConversations({archivedOnly: true, limit: 500})
      .filter((conversation) => this.isAssistantConversation(conversation.id));
  }

  isAssistantConversation(conversationId: string): boolean {
    const conversation = this.#storage.getConversation(conversationId);
    return Boolean(conversation && !botRecord(conversation.metadata) && !teamGroupRecord(conversation.metadata));
  }

  #agentContactConversations() {
    return this.#storage
      .listConversations({limit: 500})
      .filter((conversation) => !botRecord(conversation.metadata));
  }

  async startComputer(id: string): Promise<BotDto> {
    const member = this.require(id);
    await this.#computers.start(id);
    this.#publishMembers();
    return this.require(member.id);
  }

  async stopComputer(id: string): Promise<BotDto> {
    const member = this.require(id);
    await this.#computers.stop(id);
    this.#publishMembers();
    return this.require(member.id);
  }

  markRead(id: string): BotDto {
    const member = this.require(id);
    if (!member.unread && !member.unreadCount) return member;
    const conversation = this.#storage.getConversation(member.conversationId)!;
    const record = botRecord(conversation.metadata)!;
    this.#storage.updateConversation(conversation.id, {
      metadata: withBotRecord(conversation.metadata, {...record, unread: false, unreadCount: 0}),
    });
    this.#publishMembers();
    return this.require(id);
  }

  async send(value: SendAgentMessageRequest): Promise<StoredMessage> {
    const request = sendMessageRequest(value);
    const source = this.#sourceForRequest(request);
    return this.#send({
      to: request.to,
      text: requiredText(request.text, "message"),
      attachments: request.attachments ?? [],
      source,
    });
  }

  async sendFromOrigin(
    value: unknown,
    origin: unknown,
  ): Promise<StoredMessage> {
    const request = sendMessageRequest(value);
    const source = parseAgentMessageOrigin(origin);
    return this.#send({
      to: request.to,
      text: requiredText(request.text, "message"),
      attachments: request.attachments ?? [],
      source,
    });
  }

  async sendFromRun(
    runId: string,
    to: string,
    text: string,
    attachments: string[] = [],
  ): Promise<StoredMessage> {
    const run = this.#storage.getRun(runId);
    if (!run) throw new Error("The sending run no longer exists");
    const member = this.botByConversation(run.conversationId);
    const inherited = relayOrigin(this.#storage.latestMessage(run.conversationId)?.metadata);
    const source: AgentMessageOriginDto = member
      ? {
          kind: "team",
          memberId: member.id,
          conversationId: member.conversationId,
          name: member.name,
          role: member.role,
          avatar: member.avatar,
          traceId: inherited?.traceId ?? randomUUID(),
          hop: (inherited?.hop ?? -1) + 1,
          automatic: true,
        }
      : {
          kind: "assistant",
          memberId: null,
          conversationId: run.conversationId,
          name: this.#storage.getConversation(run.conversationId)?.title || "Assistant",
          role: null,
          avatar: null,
          traceId: inherited?.traceId ?? randomUUID(),
          hop: (inherited?.hop ?? -1) + 1,
          automatic: false,
        };
    return this.#send({to, text: requiredText(text, "message"), attachments, source});
  }

  targets(): Array<{id: string; name: string; kind: "team" | "assistant"; role: string | null}> {
    const team = this.list().map((member) => ({
      id: member.id,
      name: member.name,
      kind: "team" as const,
      role: member.role,
    }));
    const assistant = this.#agentContactConversations().map((conversation) => ({
      id: conversation.id,
      name: conversation.title,
      kind: "assistant" as const,
      role: null as string | null,
    }));
    return [...team, ...assistant];
  }

  leases(memberId?: string): LaptopCapabilityLeaseDto[] {
    const now = Date.now();
    const stored = this.#storage.getPreference(LEASES_KEY)?.value;
    const leases = Array.isArray(stored) ? stored.flatMap(parseLease) : [];
    const active = leases.filter((lease) => Date.parse(lease.expiresAt) > now);
    if (active.length !== leases.length) this.#storeLeases(active);
    return memberId ? active.filter((lease) => lease.memberId === memberId) : active;
  }

  grantLease(memberId: string, capabilities: Capability[], minutes = 15): LaptopCapabilityLeaseDto {
    const member = this.require(memberId);
    if (member.laptopAccess !== "ask")
      throw new Error("Turn on ‘Ask for laptop access’ for this bot first.");
    const allowed = [...new Set(capabilities.filter(isCapability))];
    if (!allowed.length) throw new Error("Choose at least one laptop capability");
    const createdAt = new Date();
    const lease: LaptopCapabilityLeaseDto = {
      id: randomUUID(),
      memberId,
      capabilities: allowed,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + Math.max(1, Math.min(minutes, 60)) * 60_000).toISOString(),
    };
    this.#storeLeases([...this.leases(), lease]);
    return lease;
  }

  revokeLease(id: string): boolean {
    const current = this.leases();
    const next = current.filter((lease) => lease.id !== id);
    this.#storeLeases(next);
    return next.length !== current.length;
  }

  async authorizeLaptopTool(
    context: AgentToolContext,
    capability: Capability,
    tool: string,
  ): Promise<boolean> {
    const member = this.botForRun(context.runId);
    if (!member) return true;
    if (this.leases(member.id).some((lease) => lease.capabilities.includes(capability)))
      return true;
    if (member.laptopAccess !== "ask" || !this.#requestLaptopAccess) return false;
    const allowed = await this.#requestLaptopAccess(member, capability, tool);
    if (allowed) this.grantLease(member.id, [capability], 15);
    return allowed;
  }

  guardLaptopTool(tool: AgentTool, capability: Capability): AgentTool {
    return {
      ...tool,
      execute: async (input, context) => {
        const member = this.botForRun(context.runId);
        if (member?.laptopAccess === "off")
          return {
            content: `${member.name} is not allowed to use this laptop. Continue inside the private Team computer.`,
            isError: true,
            metadata: {capability, waitingForDevice: false},
          };
        if (member && this.#laptopBroker) {
          const hasLease = this.leases(member.id).some((lease) => lease.capabilities.includes(capability));
          const brokered = await this.#laptopBroker(member, capability, tool, input, context, !hasLease);
          if (brokered) {
            if (brokered.approved && !hasLease && member.laptopAccess === "ask")
              this.grantLease(member.id, [capability], 15);
            return brokered.result;
          }
        }
        if (await this.authorizeLaptopTool(context, capability, tool.name))
          return tool.execute(input, context);
        return {
          content: member
            ? `${member.name} does not have a current ${capability} lease for this laptop. Continue remote work and leave this device step waiting.`
            : "Laptop access is unavailable.",
          isError: true,
          metadata: {capability, waitingForDevice: true},
        };
      },
    };
  }

  executionDevice(conversationId: string): string {
    const id = this.#storage.getPreference(`assistant.device:${conversationId}`)?.value;
    return typeof id === "string" ? id : this.localHost().hostId;
  }

  host(): TeamHostDto {
    const hosts = this.hosts();
    return hosts.find((host) => host.isDefault) ?? hosts[0]!;
  }

  localHost(): TeamHostDto {
    const desktopId = this.#stableId(DESKTOP_ID_KEY);
    const localHostId = this.#stableId(HOST_ID_KEY);
    const deviceName = hostname() || "This computer";
    const server = this.#localHostInfo?.();
    return {
      mode: "local",
      state: "local",
      endpoint: null,
      hostId: localHostId,
      desktopId,
      deviceName,
      deviceType: server?.deviceType ?? 'pc',
      fingerprint: fingerprint(`${localHostId}:${desktopId}:${deviceName}`),
      pairedAt: null,
      detail: server?.detail ?? null,
      listeningEndpoint: server?.endpoint ?? null,
      pairingCode: server?.pairingCode ?? null,
      pairingExpiresAt: server?.pairingExpiresAt ?? null,
      pairedDesktopName: server?.pairedDesktopName ?? null,
    };
  }

  hosts(): TeamHostDto[] {
    const desktopId = this.#stableId(DESKTOP_ID_KEY);
    const local = this.localHost();
    const remotes = hostRecords(this.#storage.getPreference(HOSTS_KEY)?.value)
      .map((host) => ({...host, desktopId}));
    const requestedDefault = this.#storage.getPreference(DEFAULT_HOST_KEY)?.value;
    const defaultHostId = typeof requestedDefault === "string"
      && (requestedDefault === local.hostId || remotes.some((host) => host.hostId === requestedDefault))
      ? requestedDefault
      : local.hostId;
    return [local, ...remotes].map((host) => ({...host, isDefault: host.hostId === defaultHostId}));
  }

  async pairHost(_request: PairTeamHostRequest): Promise<TeamHostDto> {
    throw new Error("Use Devices to connect and approve the other device first.");
  }

  async savePeerConnection(endpoint: string, value: Record<string, unknown>): Promise<TeamHostDto> {
    endpoint = secureHostEndpoint(endpoint);
    const desktopId = this.#stableId(DESKTOP_ID_KEY);
    const hostId = requiredText(value.hostId, "host id");
    const secret = requiredText(value.secret, "host secret");
    const record: Omit<TeamHostDto, "desktopId"> = {
      mode: "remote",
      state: "connected",
      endpoint,
      hostId,
      deviceName: requiredText(value.deviceName, "host name"),
      deviceType: deviceType(value.deviceType),
      fingerprint: typeof value.fingerprint === "string" && value.fingerprint
        ? value.fingerprint
        : fingerprint(`${hostId}:${desktopId}:${endpoint}`),
      pairedAt: new Date().toISOString(),
      detail: null,
    };
    const records = hostRecords(this.#storage.getPreference(HOSTS_KEY)?.value)
      .filter((host) => host.hostId !== hostId);
    records.push(record);
    await this.#writeHostSecret?.(hostId, secret);
    this.#storage.setPreference(HOSTS_KEY, records as unknown as JsonValue);
    return {...record, desktopId, isDefault: this.host().hostId === hostId};
  }

  async useLocalHost(): Promise<TeamHostDto> {
    this.#storage.setPreference(DEFAULT_HOST_KEY, this.localHost().hostId);
    return this.host();
  }

  setDefaultHost(hostId: string): TeamHostDto {
    const target = this.hosts().find((host) => host.hostId === hostId);
    if (!target) throw new Error("That Polymux Host is not configured on this Desktop");
    this.#storage.setPreference(DEFAULT_HOST_KEY, hostId);
    return this.host();
  }

  async removeHost(hostId: string): Promise<TeamHostDto[]> {
    const localId = this.localHost().hostId;
    if (hostId === localId) throw new Error("This computer is always available as a Host");
    const records = hostRecords(this.#storage.getPreference(HOSTS_KEY)?.value);
    if (!records.some((host) => host.hostId === hostId)) return this.hosts();
    this.#storage.setPreference(
      HOSTS_KEY,
      records.filter((host) => host.hostId !== hostId) as unknown as JsonValue,
    );
    await this.#writeHostSecret?.(hostId, null);
    if (this.#storage.getPreference(DEFAULT_HOST_KEY)?.value === hostId)
      this.#storage.setPreference(DEFAULT_HOST_KEY, localId);
    return this.hosts();
  }

  setRemoteHostState(
    hostId: string,
    state: "connected" | "disconnected" | "error",
    detail: string | null,
    type?: DeviceType,
  ): TeamHostDto {
    const current = this.hosts().find((host) => host.hostId === hostId);
    if (!current || current.mode !== "remote") return this.host();
    const next = {...current, state, detail, deviceType: type ?? current.deviceType};
    const records = hostRecords(this.#storage.getPreference(HOSTS_KEY)?.value)
      .map((host) => host.hostId === hostId ? remoteHostRecord(next) : host);
    this.#storage.setPreference(HOSTS_KEY, records as unknown as JsonValue);
    return {...next, isDefault: this.host().hostId === hostId};
  }

  #sourceForRequest(request: SendAgentMessageRequest): AgentMessageOriginDto {
    const member = request.fromMemberId ? this.require(request.fromMemberId) : null;
    if (member) return {
      kind: "team",
      memberId: member.id,
      conversationId: member.conversationId,
      name: member.name,
      role: member.role,
      avatar: member.avatar,
      traceId: randomUUID(),
      hop: 0,
      automatic: request.automatic === true,
    };
    const conversationId = request.fromConversationId;
    const conversation = conversationId ? this.#storage.getConversation(conversationId) : null;
    if (!conversation || botRecord(conversation.metadata))
      throw new Error("An Assistant source conversation is required");
    return {
      kind: "assistant",
      memberId: null,
      conversationId: conversation.id,
      name: conversation.title || "Assistant",
      role: null,
      avatar: null,
      traceId: randomUUID(),
      hop: 0,
      automatic: false,
    };
  }

  async #send(input: {
    to: string;
    text: string;
    attachments: string[];
    source: AgentMessageOriginDto;
  }): Promise<StoredMessage> {
    if (input.source.hop > MAX_HOPS)
      throw new Error("Agent message stopped at the Team hop limit to prevent a reply loop.");
    const target = this.#resolveTarget(input.to);
    if (target.conversationId === input.source.conversationId)
      throw new Error("Choose a different agent or Assistant chat");
    const trace = this.#relayTrace(input.source.traceId);
    const deliveries = trace?.deliveries ?? 0;
    if (deliveries >= MAX_DELIVERIES_PER_TRACE)
      throw new Error("Agent message stopped at the Team delivery limit to prevent a reply loop.");
    if (trace?.conversations.includes(target.conversationId))
      throw new Error("This agent-message trace already reached that conversation.");

    const message = this.#storage.appendMessage({
      id: randomUUID(),
      conversationId: target.conversationId,
      runId: null,
      // `tool` is an agent-authored authority class in storage. The renderer
      // gives it the user's bubble geometry, but it never becomes a user turn.
      role: "tool",
      content: input.text,
      metadata: {
        agentRelay: {
          source: input.source as unknown as JsonValue,
          destination: {
            kind: target.kind,
            memberId: target.memberId,
            conversationId: target.conversationId,
            name: target.name,
          },
          deliveredAt: new Date().toISOString(),
        },
      },
    });
    this.#recordRelayTrace(input.source.traceId, target.conversationId);
    for (const attachmentPath of input.attachments) {
      if (typeof attachmentPath !== "string" || !attachmentPath.trim()) continue;
      this.#storage.addAttachment({
        id: randomUUID(),
        messageId: message.id,
        name: attachmentPath.split(/[\\/]/).pop() ?? attachmentPath,
        path: attachmentPath,
        mimeType: null,
        size: null,
        sha256: null,
      });
    }
    const targetConversation = this.#storage.getConversation(target.conversationId);
    const targetGroup = targetConversation ? teamGroupRecord(targetConversation.metadata) : null;
    if (target.memberId) this.#markUnread(target.memberId);
    else if (targetGroup) this.#markGroupUnread(targetGroup.id);
    this.#publishMembers();
    this.#publishTeamGroups();
    const prompt = `Message from ${input.source.name}${input.source.role ? ` (${input.source.role})` : ""}:\n\n${input.text}`;
    // A group is an inbox for attributed agent replies, not another central
    // Assistant. Delivering again here would create an unrelated model turn.
    if (!targetGroup) queueMicrotask(() => this.#deliver?.({
        conversationId: target.conversationId,
        text: prompt,
        messageId: message.id,
        source: input.source,
      }));
    return message;
  }

  #resolveTarget(value: string): {
    kind: "team" | "assistant";
    memberId: string | null;
    conversationId: string;
    name: string;
  } {
    const target = requiredText(value, "recipient");
    const normalized = target.normalize("NFKC").toLocaleLowerCase();
    const member = this.list().find((candidate) =>
      candidate.id === target ||
      candidate.conversationId === target ||
      candidate.name.normalize("NFKC").toLocaleLowerCase() === normalized,
    );
    if (member) return {
      kind: "team",
      memberId: member.id,
      conversationId: member.conversationId,
      name: member.name,
    };
    const assistant = this.#agentContactConversations().find((conversation) =>
      conversation.id === target ||
      conversation.title.normalize("NFKC").toLocaleLowerCase() === normalized,
    );
    if (assistant) return {
      kind: "assistant",
      memberId: null,
      conversationId: assistant.id,
      name: assistant.title || "Assistant",
    };
    throw new Error(`No Team member or Assistant chat matches “${target}”.`);
  }

  #relayTrace(traceId: string): RelayTraceRecord | null {
    return this.#relayTraces().find((trace) => trace.traceId === traceId) ?? null;
  }

  #recordRelayTrace(traceId: string, conversationId: string): void {
    const now = new Date().toISOString();
    const traces = this.#relayTraces();
    const current = traces.find((trace) => trace.traceId === traceId);
    const next: RelayTraceRecord = current
      ? {
          ...current,
          deliveries: current.deliveries + 1,
          conversations: current.conversations.includes(conversationId)
            ? current.conversations
            : [...current.conversations, conversationId],
          updatedAt: now,
        }
      : {traceId, deliveries: 1, conversations: [conversationId], updatedAt: now};
    this.#storage.setPreference(
      TRACE_LEDGER_KEY,
      [next, ...traces.filter((trace) => trace.traceId !== traceId)]
        .slice(0, MAX_RELAY_TRACES) as unknown as JsonValue,
    );
  }

  #relayTraces(): RelayTraceRecord[] {
    const cutoff = Date.now() - RELAY_TRACE_TTL_MS;
    const stored = this.#storage.getPreference(TRACE_LEDGER_KEY)?.value;
    if (!Array.isArray(stored)) return [];
    return stored.flatMap((value): RelayTraceRecord[] => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const record = value as Record<string, JsonValue>;
      if (
        typeof record.traceId !== "string" ||
        typeof record.deliveries !== "number" ||
        !Number.isSafeInteger(record.deliveries) ||
        record.deliveries < 1 ||
        !Array.isArray(record.conversations) ||
        typeof record.updatedAt !== "string" ||
        Date.parse(record.updatedAt) < cutoff
      ) return [];
      const conversations = record.conversations.filter(
        (conversation): conversation is string => typeof conversation === "string" && Boolean(conversation),
      );
      return [{
        traceId: record.traceId,
        deliveries: record.deliveries,
        conversations: [...new Set(conversations)],
        updatedAt: record.updatedAt,
      }];
    }).slice(0, MAX_RELAY_TRACES);
  }

  #markUnread(id: string): void {
    const member = this.require(id);
    const conversation = this.#storage.getConversation(member.conversationId)!;
    const record = botRecord(conversation.metadata)!;
    this.#storage.updateConversation(conversation.id, {
      metadata: withBotRecord(conversation.metadata, {
        ...record,
        unread: true,
        unreadCount: Math.min(999, record.unreadCount + 1),
      }),
    });
  }

  #markGroupUnread(id: string): void {
    const group = this.group(id);
    if (!group) return;
    const conversation = this.#storage.getConversation(group.conversationId)!;
    const record = teamGroupRecord(conversation.metadata)!;
    this.#storage.updateConversation(conversation.id, {
      metadata: withTeamGroupRecord(conversation.metadata, {
        ...record,
        unread: true,
        unreadCount: Math.min(999, record.unreadCount + 1),
      }),
    });
  }

  #publishMembers(): void {
    this.#publish?.(this.list());
  }

  #publishTeamGroups(): void {
    this.#publishGroups?.(this.groups());
  }

  #storeLeases(leases: LaptopCapabilityLeaseDto[]): void {
    this.#storage.setPreference(LEASES_KEY, leases as unknown as JsonValue);
  }

  #stableId(key: string): string {
    const stored = this.#storage.getPreference(key)?.value;
    if (typeof stored === "string" && stored) return stored;
    const id = randomUUID();
    this.#storage.setPreference(key, id);
    return id;
  }
}

export type TeamAgentMessageBroker = (
  input: JsonObject,
  context: AgentToolContext,
) => Promise<AgentToolResult | null>;

/** The one peer-mail tool available to top-level Assistant and Team agents. */
export function createAgentMessageTool(
  team: TeamService,
  broker?: TeamAgentMessageBroker,
): AgentTool {
  return {
    name: "agent_message",
    description:
      "List other Polymux agents and Assistant chats, or send one a durable private message. " +
      "Team agents may coordinate with bots automatically. From an Assistant chat, use send only when the user explicitly asks to mention, delegate to, or contact another agent/chat. " +
      "Messages retain their agent identity and never inherit the sender's permissions.",
    mainAgentOnly: true,
    parameters: {
      type: "object",
      properties: {
        action: {type: "string", enum: ["list", "send"]},
        to: {type: "string", description: "Team member name/id or Assistant chat title/id"},
        message: {type: "string"},
        attachments: {type: "array", items: {type: "string"}},
      },
      required: ["action"],
      additionalProperties: false,
    },
    async execute(input: JsonObject, context: AgentToolContext): Promise<AgentToolResult> {
      if (input.action === "list" && broker) {
        const brokered = await broker(input, context);
        if (brokered) return brokered;
      }
      if (input.action === "list") return {
        content: team.targets().map((target) =>
          `- ${target.name} [${target.kind}]${target.role ? ` — ${target.role}` : ""} (${target.id})`,
        ).join("\n") || "No other Polymux agents or Assistant chats are available.",
      };
      if (input.action !== "send") throw new Error("agent_message.action must be list or send");
      if (typeof input.to !== "string" || typeof input.message !== "string")
        throw new Error("agent_message.send requires to and message");
      const attachments = Array.isArray(input.attachments)
        ? input.attachments.filter((item): item is string => typeof item === "string")
        : [];
      let message: StoredMessage;
      try {
        message = await team.sendFromRun(context.runId, input.to, input.message, attachments);
      } catch (error) {
        if (!broker || !(error instanceof Error) || !error.message.startsWith("No Team member or Assistant chat matches"))
          throw error;
        const brokered = await broker(input, context);
        if (brokered) return brokered;
        throw error;
      }
      return {
        content: `Delivered agent message ${message.id} to ${input.to}.`,
        metadata: {messageId: message.id, recipient: input.to},
      };
    },
  };
}

export interface TeamSetupController {
  options(): Promise<{
    host: TeamHostDto;
    profiles: ProfileDto[];
    connections?: {
      skills: Array<{name: string; description: string}>;
      mcpServers: Array<{id: string; name: string; description?: string}>;
      plugins: Array<{id: string; name: string; description?: string}>;
    };
  }>;
  list(): Promise<BotDto[]>;
  create(request: CreateBotRequest): Promise<BotDto>;
  update(id: string, request: UpdateBotRequest): Promise<BotDto>;
  remove(id: string): Promise<boolean>;
}

const TEAM_SETUP_COLORS = [
  "#7557ff", "#3167e8", "#1b93a8", "#169c73", "#6aa436", "#e9a008",
  "#f27428", "#e84d4f", "#d5437c", "#a342cc", "#777d8d", "#292c35",
] as const;

/** Assistant-only bot setup; Team agents cannot create their own peers. */
export function createTeamSetupTool(team: TeamService, controller: TeamSetupController): AgentTool {
  return {
    name: "team_setup",
    description:
      "List bots, inspect Team setup choices, or create, update, and remove an individual bot for the user. " +
      "Use mutations only after the user explicitly asks for them; removal additionally requires confirm=true. " +
      "Laptop access 'ask' never grants access by itself; Polymux still asks the user when the bot needs the device.",
    mainAgentOnly: true,
    parameters: {
      type: "object",
      properties: {
        action: {type: "string", enum: ["options", "list", "create", "update", "remove"]},
        member: {type: "string", description: "Existing bot name or id"},
        name: {type: "string", description: "Bot display name"},
        role: {type: "string", description: "Short responsibility or role"},
        profile: {type: "string", description: "Eligible profile id or exact profile name"},
        avatarShape: {type: "string", enum: [...TEAM_AVATAR_SHAPES]},
        avatarColor: {type: "string", description: "Six-digit hex colour such as #7557ff"},
        laptopAccess: {type: "string", enum: ["off", "ask"]},
        skills: {type: "array", items: {type: "string"}, description: "Skill names assigned to this bot from the connections pool"},
        mcpServers: {type: "array", items: {type: "string"}, description: "MCP server IDs assigned to this bot from the connections pool"},
        plugins: {type: "array", items: {type: "string"}, description: "Plugin IDs assigned to this bot from the connections pool"},
        confirm: {type: "boolean", description: "Must be true to permanently remove a bot"},
      },
      required: ["action"],
      additionalProperties: false,
    },
    async execute(input: JsonObject, context: AgentToolContext): Promise<AgentToolResult> {
      if (team.botForRun(context.runId))
        throw new Error("Only the Assistant can create or configure bots.");
      const setup = await controller.options();
      const eligible = setup.profiles.filter((profile) => profile.teamEligible !== false);
      const members = await controller.list();
      if (input.action === "options") {
        const poolLines = setup.connections
          ? [
              "",
              "Available connections pool in workspace:",
              setup.connections.skills.length ? `  Skills: ${setup.connections.skills.map((s) => s.name).join(", ")}` : "  Skills: (none)",
              setup.connections.mcpServers.length ? `  MCP Servers: ${setup.connections.mcpServers.map((m) => m.id).join(", ")}` : "  MCP Servers: (none)",
              setup.connections.plugins.length ? `  Plugins: ${setup.connections.plugins.map((p) => p.id).join(", ")}` : "  Plugins: (none)",
            ]
          : [];
        return {
          content: [
            `Current Team Host: ${setup.host.deviceName} (${setup.host.mode})`,
            eligible.length
              ? `Eligible profiles:\n${eligible.map((profile) => `- ${profile.name} (${profile.id})`).join("\n")}`
              : "No profiles on this Host are eligible for isolated Team agents.",
            ...poolLines,
          ].join("\n"),
          metadata: {
            hostId: setup.host.hostId,
            hostName: setup.host.deviceName,
            profiles: eligible.map((profile) => ({id: profile.id, name: profile.name})),
            connections: setup.connections,
          },
        };
      }
      if (input.action === "list") return {
        content: members.length
          ? members.map((member) => {
              const conns: string[] = [];
              if (member.skills?.length) conns.push(`skills: [${member.skills.join(", ")}]`);
              if (member.mcpServers?.length) conns.push(`mcp: [${member.mcpServers.join(", ")}]`);
              if (member.plugins?.length) conns.push(`plugins: [${member.plugins.join(", ")}]`);
              const connSuffix = conns.length ? ` — ${conns.join(", ")}` : "";
              return `- ${member.name} — ${member.role} (${member.id})${connSuffix}`;
            }).join("\n")
          : "No bots are configured.",
        metadata: {members: members.map((member) => ({id: member.id, name: member.name, role: member.role, skills: member.skills, mcpServers: member.mcpServers, plugins: member.plugins}))},
      };
      if (input.action === "remove") {
        const member = setupMember(members, input.member);
        if (input.confirm !== true)
          throw new Error(`Set confirm=true only after the user explicitly confirms removing ${member.name}.`);
        const removed = await controller.remove(member.id);
        if (!removed) throw new Error(`${member.name} no longer exists.`);
        return {content: `Removed ${member.name} from Team.`, metadata: {memberId: member.id}};
      }
      if (input.action === "update") {
        const member = setupMember(members, input.member);
        const request: UpdateBotRequest = {};
        if (input.name !== undefined) request.name = requiredText(input.name, "bot name");
        if (input.role !== undefined) request.role = requiredText(input.role, "bot role");
        if (input.profile !== undefined)
          request.profileId = setupProfile(eligible, requiredText(input.profile, "profile")).id;
        if (input.avatarShape !== undefined || input.avatarColor !== undefined)
          request.avatar = {
            shape: input.avatarShape === undefined
              ? member.avatar.shape
              : TEAM_AVATAR_SHAPES.includes(input.avatarShape as TeamAvatarDto["shape"])
                ? input.avatarShape as TeamAvatarDto["shape"]
                : (() => { throw new Error("Choose a supported bot avatar shape"); })(),
            color: input.avatarColor === undefined
              ? member.avatar.color
              : typeof input.avatarColor === "string" && /^#[0-9a-f]{6}$/i.test(input.avatarColor)
                ? input.avatarColor
                : (() => { throw new Error("Avatar colour must be a six-digit hex colour"); })(),
            ...(member.avatar.colorPair ? {colorPair: member.avatar.colorPair} : {}),
          };
        if (input.laptopAccess !== undefined)
          request.laptopAccess = input.laptopAccess === "ask" ? "ask" : "off";
        if (input.skills !== undefined)
          request.skills = Array.isArray(input.skills) ? input.skills.filter((s): s is string => typeof s === "string") : [];
        if (input.mcpServers !== undefined)
          request.mcpServers = Array.isArray(input.mcpServers) ? input.mcpServers.filter((s): s is string => typeof s === "string") : [];
        if (input.plugins !== undefined)
          request.plugins = Array.isArray(input.plugins) ? input.plugins.filter((s): s is string => typeof s === "string") : [];
        if (!Object.keys(request).length) throw new Error("Choose at least one bot field to update.");
        const updated = await controller.update(member.id, request);
        return {
          content: `Updated ${updated.name}, ${updated.role}, using ${updated.profileName}.`,
          metadata: {memberId: updated.id, profileId: updated.profileId, skills: updated.skills, mcpServers: updated.mcpServers, plugins: updated.plugins},
        };
      }
      if (input.action !== "create")
        throw new Error("team_setup.action must be options, list, create, update, or remove");
      const name = requiredText(input.name, "bot name");
      const role = requiredText(input.role, "bot role");
      const requestedProfile = typeof input.profile === "string" ? input.profile.trim() : "";
      const profile = requestedProfile
        ? setupProfile(eligible, requestedProfile)
        : eligible.length === 1 ? eligible[0] : undefined;
      if (!profile) throw new Error(requestedProfile
        ? `No eligible Team profile matches “${requestedProfile}”. Use team_setup options first.`
        : "Choose an eligible profile. Use team_setup options first.");
      const shape = input.avatarShape === undefined
        ? "circle"
        : TEAM_AVATAR_SHAPES.includes(input.avatarShape as TeamAvatarDto["shape"])
          ? input.avatarShape as TeamAvatarDto["shape"]
          : null;
      if (!shape) throw new Error("Choose a supported bot avatar shape");
      const color = input.avatarColor === undefined
        ? setupColor(name)
        : typeof input.avatarColor === "string" && /^#[0-9a-f]{6}$/i.test(input.avatarColor)
          ? input.avatarColor
          : null;
      if (!color) throw new Error("Avatar colour must be a six-digit hex colour");
      const skills = Array.isArray(input.skills) ? input.skills.filter((s): s is string => typeof s === "string") : undefined;
      const mcpServers = Array.isArray(input.mcpServers) ? input.mcpServers.filter((s): s is string => typeof s === "string") : undefined;
      const plugins = Array.isArray(input.plugins) ? input.plugins.filter((s): s is string => typeof s === "string") : undefined;
      const created = await controller.create({
        name,
        role,
        profileId: profile.id,
        avatar: {shape, color},
        laptopAccess: input.laptopAccess === "ask" ? "ask" : "off",
        skills,
        mcpServers,
        plugins,
      });
      return {
        content: `Created ${created.name}, ${created.role}, on ${setup.host.deviceName} using ${created.profileName}.`,
        metadata: {
          memberId: created.id,
          conversationId: created.conversationId,
          hostId: setup.host.hostId,
          profileId: created.profileId,
          skills: created.skills,
          mcpServers: created.mcpServers,
          plugins: created.plugins,
        },
      };
    },
  };
}

export interface TeamConnectionsController {
  pool(): Promise<{
    skills: Array<{name: string; description: string}>;
    mcpServers: Array<{id: string; name: string; description?: string}>;
    plugins: Array<{id: string; name: string; description?: string}>;
  }>;
  connect(botId: string, connections: {skills?: string[]; mcpServers?: string[]; plugins?: string[]}): Promise<BotDto>;
  disconnect(botId: string, connections: {skills?: string[]; mcpServers?: string[]; plugins?: string[]}): Promise<BotDto>;
}

/** Allows a bot inside a Team run to inspect the connections pool and connect/disconnect tools for itself. */
export function createTeamConnectionsTool(team: TeamService, controller: TeamConnectionsController): AgentTool {
  return {
    name: "team_connections",
    description:
      "Inspect the workspace pool of connections (skills, MCP servers, plugins) and connect or disconnect them for this bot. " +
      "Use this when you need additional tools, skills, or capabilities from the workspace pool to accomplish your task.",
    parameters: {
      type: "object",
      properties: {
        action: {type: "string", enum: ["pool", "connect", "disconnect"], description: "'pool' lists available connections and what this bot currently has, 'connect' enables connections for this bot, 'disconnect' removes connections"},
        skills: {type: "array", items: {type: "string"}, description: "Skill names to connect or disconnect"},
        mcpServers: {type: "array", items: {type: "string"}, description: "MCP server IDs to connect or disconnect"},
        plugins: {type: "array", items: {type: "string"}, description: "Plugin IDs to connect or disconnect"},
      },
      required: ["action"],
      additionalProperties: false,
    },
    async execute(input: JsonObject, context: AgentToolContext): Promise<AgentToolResult> {
      const bot = team.botForRun(context.runId);
      if (!bot)
        throw new Error("team_connections is available only for Team bots.");
      if (input.action === "pool") {
        const pool = await controller.pool();
        const currentSkills = bot.skills ?? [];
        const currentMcp = bot.mcpServers ?? [];
        const currentPlugins = bot.plugins ?? [];
        return {
          content: [
            `Current connections for ${bot.name}:`,
            `  Skills: ${currentSkills.length ? currentSkills.join(", ") : "(none)"}`,
            `  MCP Servers: ${currentMcp.length ? currentMcp.join(", ") : "(none)"}`,
            `  Plugins: ${currentPlugins.length ? currentPlugins.join(", ") : "(none)"}`,
            "",
            "Available connections pool in workspace:",
            pool.skills.length ? `  Skills: ${pool.skills.map((s) => `${s.name} (${s.description})`).join("; ")}` : "  Skills: (none)",
            pool.mcpServers.length ? `  MCP Servers: ${pool.mcpServers.map((m) => `${m.id} (${m.name})`).join("; ")}` : "  MCP Servers: (none)",
            pool.plugins.length ? `  Plugins: ${pool.plugins.map((p) => `${p.id} (${p.name})`).join("; ")}` : "  Plugins: (none)",
          ].join("\n"),
          metadata: {
            current: {skills: currentSkills, mcpServers: currentMcp, plugins: currentPlugins},
            pool,
          },
        };
      }
      if (input.action === "connect") {
        const skills = Array.isArray(input.skills) ? input.skills.filter((s): s is string => typeof s === "string") : [];
        const mcpServers = Array.isArray(input.mcpServers) ? input.mcpServers.filter((s): s is string => typeof s === "string") : [];
        const plugins = Array.isArray(input.plugins) ? input.plugins.filter((s): s is string => typeof s === "string") : [];
        if (!skills.length && !mcpServers.length && !plugins.length)
          throw new Error("Specify at least one skill, mcpServer, or plugin to connect.");
        const updated = await controller.connect(bot.id, {skills, mcpServers, plugins});
        return {
          content: `Connected requested connections to ${updated.name}. Current connections:\nSkills: ${updated.skills?.join(", ") || "(none)"}\nMCP: ${updated.mcpServers?.join(", ") || "(none)"}\nPlugins: ${updated.plugins?.join(", ") || "(none)"}`,
          metadata: {skills: updated.skills, mcpServers: updated.mcpServers, plugins: updated.plugins},
        };
      }
      if (input.action === "disconnect") {
        const skills = Array.isArray(input.skills) ? input.skills.filter((s): s is string => typeof s === "string") : [];
        const mcpServers = Array.isArray(input.mcpServers) ? input.mcpServers.filter((s): s is string => typeof s === "string") : [];
        const plugins = Array.isArray(input.plugins) ? input.plugins.filter((s): s is string => typeof s === "string") : [];
        if (!skills.length && !mcpServers.length && !plugins.length)
          throw new Error("Specify at least one skill, mcpServer, or plugin to disconnect.");
        const updated = await controller.disconnect(bot.id, {skills, mcpServers, plugins});
        return {
          content: `Disconnected requested connections from ${updated.name}. Current connections:\nSkills: ${updated.skills?.join(", ") || "(none)"}\nMCP: ${updated.mcpServers?.join(", ") || "(none)"}\nPlugins: ${updated.plugins?.join(", ") || "(none)"}`,
          metadata: {skills: updated.skills, mcpServers: updated.mcpServers, plugins: updated.plugins},
        };
      }
      throw new Error("team_connections.action must be pool, connect, or disconnect");
    },
  };
}

function setupColor(name: string): string {
  let value = 0;
  for (const character of name.normalize("NFKC")) value = (value * 31 + character.codePointAt(0)!) >>> 0;
  return TEAM_SETUP_COLORS[value % TEAM_SETUP_COLORS.length]!;
}

function setupMember(members: BotDto[], value: unknown): BotDto {
  const requested = requiredText(value, "bot");
  const normalized = requested.normalize("NFKC").toLocaleLowerCase();
  const member = members.find((candidate) =>
    candidate.id === requested || candidate.name.normalize("NFKC").toLocaleLowerCase() === normalized,
  );
  if (!member) throw new Error(`No bot matches “${requested}”. Use team_setup list first.`);
  return member;
}

function setupProfile(profiles: ProfileDto[], requested: string): ProfileDto {
  const normalized = requested.normalize("NFKC").toLocaleLowerCase();
  const profile = profiles.find((candidate) =>
    candidate.id === requested || candidate.name.normalize("NFKC").toLocaleLowerCase() === normalized,
  );
  if (!profile) throw new Error(`No eligible Team profile matches “${requested}”. Use team_setup options first.`);
  return profile;
}

/** Agent-authored relay rows are fed to the model with explicit provenance. */
export function agentRelayInferenceText(message: StoredMessage): string | null {
  const source = relayOrigin(message.metadata);
  if (!source) return null;
  return `Message from ${source.name}${source.role ? ` (${source.role})` : ""}:\n\n${messageText(message.content)}`;
}

export function relayOrigin(value: JsonValue | undefined): AgentMessageOriginDto | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const relay = (value as Record<string, JsonValue>).agentRelay;
  if (!relay || typeof relay !== "object" || Array.isArray(relay)) return null;
  const source = (relay as Record<string, JsonValue>).source;
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  try { return parseAgentMessageOrigin(source); } catch { return null; }
}

/** Shared by live RPC ingress and stored relay context; never trust a TS cast. */
export function parseAgentMessageOrigin(value: unknown): AgentMessageOriginDto {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Agent message origin is required");
  const source = value as Record<string, unknown>;
  if (source.kind !== "team" && source.kind !== "assistant") throw new Error("Unknown agent message origin kind");
  if (typeof source.hop !== "number" || !Number.isSafeInteger(source.hop) || source.hop < 0)
    throw new Error("Agent message hop must be a nonnegative integer");
  if (typeof source.automatic !== "boolean") throw new Error("Agent message automatic flag must be a boolean");
  if (source.kind === "assistant" && source.memberId !== null) throw new Error("Assistant origin cannot claim a Team member");
  return {
    kind: source.kind,
    memberId: source.kind === "team" ? requiredText(source.memberId, "origin member") : null,
    conversationId: requiredText(source.conversationId, "origin conversation"),
    name: requiredText(source.name, "origin name"),
    role: source.role === null ? null : requiredText(source.role, "origin role"),
    avatar: source.avatar === null ? null : avatar(source.avatar),
    traceId: requiredText(source.traceId, "origin trace"),
    hop: source.hop,
    automatic: source.automatic,
  };
}

function sendMessageRequest(value: unknown): SendAgentMessageRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Agent message request is required");
  const request = value as Record<string, unknown>;
  if (request.attachments !== undefined && (!Array.isArray(request.attachments) || request.attachments.some((path) => typeof path !== "string" || !path.trim())))
    throw new Error("Agent message attachments must be file paths");
  if (request.automatic !== undefined && typeof request.automatic !== "boolean") throw new Error("Agent message automatic flag must be a boolean");
  return {
    to: requiredText(request.to, "recipient"),
    text: requiredText(request.text, "message"),
    ...(request.fromConversationId === undefined ? {} : {fromConversationId: requiredText(request.fromConversationId, "source conversation")}),
    ...(request.fromMemberId === undefined ? {} : {fromMemberId: requiredText(request.fromMemberId, "source member")}),
    ...(request.automatic === undefined ? {} : {automatic: request.automatic as boolean}),
    attachments: request.attachments as string[] | undefined,
  };
}

function botRecord(value: JsonValue): BotRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = (value as Record<string, JsonValue>)[TEAM_METADATA_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, JsonValue>;
  if (
    record.version !== 1 ||
    typeof record.id !== "string" ||
    typeof record.name !== "string" ||
    typeof record.role !== "string" ||
    typeof record.profileId !== "string"
  ) return null;
  try {
    return {
      version: 1,
      id: record.id,
      name: record.name,
      role: record.role,
      profileId: record.profileId,
      avatar: avatar(record.avatar),
      laptopAccess: record.laptopAccess === "ask" ? "ask" : "off",
      unread: record.unread === true,
      unreadCount: typeof record.unreadCount === "number" && Number.isSafeInteger(record.unreadCount) && record.unreadCount > 0
        ? Math.min(999, record.unreadCount)
        : record.unread === true ? 1 : 0,
      skills: Array.isArray(record.skills) ? record.skills.filter((s): s is string => typeof s === "string") : undefined,
      mcpServers: Array.isArray(record.mcpServers) ? record.mcpServers.filter((s): s is string => typeof s === "string") : undefined,
      plugins: Array.isArray(record.plugins) ? record.plugins.filter((s): s is string => typeof s === "string") : undefined,
    };
  } catch {
    return null;
  }
}

function withBotRecord(metadata: JsonValue, record: BotRecord): JsonValue {
  const root = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? {...metadata as Record<string, JsonValue>}
    : {};
  root[TEAM_METADATA_KEY] = record as unknown as JsonValue;
  return root;
}

function teamGroupRecord(value: JsonValue): TeamGroupRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = (value as Record<string, JsonValue>)[TEAM_GROUP_METADATA_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, JsonValue>;
  if (
    record.version !== 1 ||
    typeof record.id !== "string" ||
    typeof record.name !== "string" ||
    !Array.isArray(record.memberIds)
  ) return null;
  const memberIds = record.memberIds.filter((id): id is string => typeof id === "string" && Boolean(id.trim()));
  return {
    version: 1,
    id: record.id,
    name: record.name,
    memberIds: [...new Set(memberIds)],
    unread: record.unread === true,
    unreadCount: typeof record.unreadCount === "number" && Number.isSafeInteger(record.unreadCount) && record.unreadCount > 0
      ? Math.min(999, record.unreadCount)
      : record.unread === true ? 1 : 0,
  };
}

function withTeamGroupRecord(metadata: JsonValue, record: TeamGroupRecord): JsonValue {
  const root = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? {...metadata as Record<string, JsonValue>}
    : {};
  root[TEAM_GROUP_METADATA_KEY] = record as unknown as JsonValue;
  return root;
}

function groupMemberIds(value: unknown, minimum: number): string[] {
  if (!Array.isArray(value)) throw new Error("Choose Team group members");
  const memberIds = [...new Set(value.map((id) => requiredText(id, "member")))];
  if (memberIds.length < minimum)
    throw new Error(minimum > 1 ? "Choose at least two bots" : "Choose at least one bot");
  return memberIds;
}

function groupCreateRequest(value: CreateTeamGroupRequest): CreateTeamGroupRequest {
  return {
    name: requiredText(value?.name, "group name"),
    memberIds: groupMemberIds(value?.memberIds, 2),
  };
}

function groupUpdateRequest(value: UpdateTeamGroupRequest): UpdateTeamGroupRequest {
  if (!value || typeof value !== "object") throw new Error("Team group update must be an object");
  return {
    ...(value.name === undefined ? {} : {name: requiredText(value.name, "group name")}),
    ...(value.memberIds === undefined ? {} : {memberIds: groupMemberIds(value.memberIds, 1)}),
  };
}

function avatar(value: unknown): TeamAvatarDto {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Choose a bot avatar");
  const item = value as Record<string, unknown>;
  if (!TEAM_AVATAR_SHAPES.includes(item.shape as TeamAvatarDto["shape"])) throw new Error("Unknown avatar shape");
  if (typeof item.color !== "string" || !/^#[0-9a-f]{6}$/i.test(item.color))
    throw new Error("Avatar colour must be a six-digit hex colour");
  let colorPair: TeamAvatarDto["colorPair"];
  if (item.colorPair !== undefined) {
    if (!item.colorPair || typeof item.colorPair !== "object" || Array.isArray(item.colorPair))
      throw new Error("Avatar colour pair must include light and dark colours");
    const pair = item.colorPair as Record<string, unknown>;
    if (
      typeof pair.light !== "string" || !/^#[0-9a-f]{6}$/i.test(pair.light) ||
      typeof pair.dark !== "string" || !/^#[0-9a-f]{6}$/i.test(pair.dark)
    ) throw new Error("Avatar colour pair must use six-digit hex colours");
    colorPair = {light: pair.light, dark: pair.dark};
  }
  return {
    shape: item.shape as TeamAvatarDto["shape"],
    color: item.color,
    ...(colorPair ? {colorPair} : {}),
  };
}

function createRequest(value: CreateBotRequest, profiles: ProfileManager): CreateBotRequest {
  const profileId = requiredText(value?.profileId, "profile");
  if (!profiles.snapshot().profiles.some((profile) => profile.id === profileId)) throw new Error("Unknown profile");
  return {
    name: requiredText(value?.name, "name"),
    role: requiredText(value?.role, "role"),
    profileId,
    avatar: avatar(value?.avatar),
    laptopAccess: value?.laptopAccess === "ask" ? "ask" : "off",
    skills: Array.isArray(value?.skills) ? value.skills.filter((s): s is string => typeof s === "string") : undefined,
    mcpServers: Array.isArray(value?.mcpServers) ? value.mcpServers.filter((s): s is string => typeof s === "string") : undefined,
    plugins: Array.isArray(value?.plugins) ? value.plugins.filter((s): s is string => typeof s === "string") : undefined,
  };
}

function updateRequest(value: UpdateBotRequest, profiles: ProfileManager): UpdateBotRequest {
  if (!value || typeof value !== "object") throw new Error("Team member update must be an object");
  if (value.profileId !== undefined && !profiles.snapshot().profiles.some((profile) => profile.id === value.profileId))
    throw new Error("Unknown profile");
  return {
    ...(value.name === undefined ? {} : {name: requiredText(value.name, "name")}),
    ...(value.role === undefined ? {} : {role: requiredText(value.role, "role")}),
    ...(value.profileId === undefined ? {} : {profileId: value.profileId}),
    ...(value.avatar === undefined ? {} : {avatar: avatar(value.avatar)}),
    ...(value.laptopAccess === undefined ? {} : {laptopAccess: value.laptopAccess === "ask" ? "ask" : "off"}),
    ...(value.skills === undefined ? {} : {skills: Array.isArray(value.skills) ? value.skills.filter((s): s is string => typeof s === "string") : []}),
    ...(value.mcpServers === undefined ? {} : {mcpServers: Array.isArray(value.mcpServers) ? value.mcpServers.filter((s): s is string => typeof s === "string") : []}),
    ...(value.plugins === undefined ? {} : {plugins: Array.isArray(value.plugins) ? value.plugins.filter((s): s is string => typeof s === "string") : []}),
  };
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function transferSegment(value: unknown, label: string): string {
  const text = requiredText(value, label);
  if (!/^[a-z0-9._-]{1,160}$/i.test(text)) throw new Error(`Transferred ${label} is invalid`);
  return text;
}

function messageText(value: JsonValue): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.flatMap((block) =>
    block && typeof block === "object" && !Array.isArray(block) && typeof (block as Record<string, JsonValue>).text === "string"
      ? [(block as Record<string, JsonValue>).text as string]
      : [],
  ).join("\n");
  return JSON.stringify(value);
}

function parseLease(value: JsonValue, index: number): LaptopCapabilityLeaseDto[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const item = value as Record<string, JsonValue>;
  if (
    typeof item.id !== "string" ||
    typeof item.memberId !== "string" ||
    typeof item.createdAt !== "string" ||
    typeof item.expiresAt !== "string" ||
    !Array.isArray(item.capabilities)
  ) return [];
  const capabilities = item.capabilities.filter(isCapability);
  return capabilities.length ? [{
    id: item.id || `legacy-${index}`,
    memberId: item.memberId,
    capabilities,
    createdAt: item.createdAt,
    expiresAt: item.expiresAt,
  }] : [];
}

function isCapability(value: unknown): value is Capability {
  return value === "browser" || value === "computer" || value === "files";
}

function secureHostEndpoint(value: unknown): string {
  const text = requiredText(value, "host address");
  let url: URL;
  try { url = new URL(text); }
  catch { throw new Error("Host address must be a valid URL"); }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:"))
    throw new Error("Remote Polymux Host must use the secure Polymux Connect address");
  if (url.username || url.password) throw new Error("Host address must not contain credentials");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function hostRecord(value: JsonValue | undefined): Omit<TeamHostDto, "desktopId"> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, JsonValue>;
  if (
    item.mode !== "remote" ||
    typeof item.endpoint !== "string" ||
    typeof item.hostId !== "string" ||
    typeof item.deviceName !== "string" ||
    typeof item.fingerprint !== "string"
  ) return null;
  let endpoint: string;
  try {
    endpoint = secureHostEndpoint(item.endpoint);
  } catch {
    return null;
  }
  return {
    mode: "remote",
    state: item.state === "error" ? "error" : item.state === "disconnected" ? "disconnected" : "connected",
    endpoint,
    hostId: item.hostId,
    deviceName: item.deviceName,
    deviceType: deviceType(item.deviceType),
    fingerprint: item.fingerprint,
    pairedAt: typeof item.pairedAt === "string" ? item.pairedAt : null,
    detail: typeof item.detail === "string" ? item.detail : null,
  };
}

function hostRecords(value: JsonValue | undefined): Array<Omit<TeamHostDto, "desktopId">> {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    const host = hostRecord(item);
    if (!host || seen.has(host.hostId)) return [];
    seen.add(host.hostId);
    return [host];
  });
}

function remoteHostRecord(host: TeamHostDto): Omit<TeamHostDto, "desktopId"> {
  return {
    mode: "remote",
    state: host.state === "error" ? "error" : host.state === "disconnected" ? "disconnected" : "connected",
    endpoint: host.endpoint,
    hostId: host.hostId,
    deviceName: host.deviceName,
    deviceType: host.deviceType,
    fingerprint: host.fingerprint,
    pairedAt: host.pairedAt,
    detail: host.detail,
  };
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").match(/.{1,4}/g)!.slice(0, 8).join(" ");
}

// Keeps the return type useful to backend callers without exporting storage internals.
export type TeamMessageDto = MessageDto;
