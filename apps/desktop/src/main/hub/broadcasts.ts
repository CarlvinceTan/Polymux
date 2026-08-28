import {randomUUID} from "node:crypto";
import type {
  BroadcastDeliveryDto,
  BroadcastDto,
  BroadcastMessageDto,
  BroadcastRecipientDto,
  BroadcastSendResultDto,
  CreateBroadcastRequest,
  JsonValue,
} from "@polymux/protocol";

const PREFERENCE_KEY = "hub-broadcasts";
const MAX_RECIPIENTS = 128;
const MAX_MESSAGES_PER_BROADCAST = 250;

export interface BroadcastPreferenceStore {
  getPreference(key: string): {value: unknown} | null | undefined;
  setPreference(key: string, value: JsonValue): unknown;
}

export interface BroadcastTransport {
  /** Opens one direct chat when the saved destination does not have one yet. */
  openDirect(recipient: BroadcastRecipientDto): Promise<string>;
  /** Sends into one direct chat. It is deliberately called once per person. */
  send(chatId: string, body: string): Promise<void>;
}

type StoredBroadcasts = {
  version: 1;
  broadcasts: BroadcastDto[];
  messages: Record<string, BroadcastMessageDto[]>;
};

/**
 * Persistent local broadcast groups and their outbound history.
 *
 * The remote networks never see this grouping. A send resolves and writes each
 * recipient's direct room independently, so no participant list can leak into
 * any platform and one failed network does not cancel deliveries already made.
 */
export class Broadcasts {
  readonly #store: BroadcastPreferenceStore;
  readonly #transport: BroadcastTransport;
  readonly #now: () => Date;
  readonly #id: () => string;
  #state: StoredBroadcasts;

  constructor(
    store: BroadcastPreferenceStore,
    transport: BroadcastTransport,
    options: {now?: () => Date; id?: () => string} = {},
  ) {
    this.#store = store;
    this.#transport = transport;
    this.#now = options.now ?? (() => new Date());
    this.#id = options.id ?? randomUUID;
    this.#state = storedBroadcasts(store.getPreference(PREFERENCE_KEY)?.value);
  }

  list(): BroadcastDto[] {
    return structuredClone(this.#state.broadcasts).sort((left, right) =>
      Date.parse(right.lastActivity ?? right.updatedAt) -
      Date.parse(left.lastActivity ?? left.updatedAt));
  }

  messages(broadcastId: string): BroadcastMessageDto[] {
    this.#find(broadcastId);
    return structuredClone(this.#state.messages[broadcastId] ?? []);
  }

  create(request: CreateBroadcastRequest): BroadcastDto {
    const name = request.name.trim();
    if (!name) throw new Error("Name this broadcast.");
    const recipients = uniqueRecipients(request.recipients);
    if (recipients.length === 0) throw new Error("Choose at least one person.");
    if (recipients.length > MAX_RECIPIENTS)
      throw new Error(`A broadcast can include at most ${MAX_RECIPIENTS} people.`);
    const at = this.#now().toISOString();
    const broadcast: BroadcastDto = {
      id: `broadcast-${this.#id()}`,
      name,
      recipients,
      createdAt: at,
      updatedAt: at,
      lastActivity: null,
      preview: null,
    };
    this.#state.broadcasts.unshift(broadcast);
    this.#state.messages[broadcast.id] = [];
    this.#save();
    return structuredClone(broadcast);
  }

  async send(broadcastId: string, rawBody: string): Promise<BroadcastSendResultDto> {
    const body = rawBody.trim();
    if (!body) throw new Error("Write a message first.");
    const index = this.#state.broadcasts.findIndex((item) => item.id === broadcastId);
    if (index < 0) throw new Error("This broadcast no longer exists.");
    const current = this.#state.broadcasts[index]!;
    const recipients = structuredClone(current.recipients);

    const deliveries = await Promise.all(
      recipients.map(async (recipient, recipientIndex): Promise<BroadcastDeliveryDto> => {
        let chatId = recipient.chatId;
        try {
          if (!chatId) {
            chatId = await this.#transport.openDirect(recipient);
            recipients[recipientIndex] = {...recipient, chatId};
          }
          await this.#transport.send(chatId, body);
          return {
            recipientId: recipient.id,
            recipientName: recipient.name,
            platform: recipient.platform,
            chatId,
            status: "sent",
          };
        } catch (cause) {
          // Retain a room that was successfully opened even if its first send
          // failed, so a retry does not create another remote direct chat.
          if (chatId) recipients[recipientIndex] = {...recipient, chatId};
          return {
            recipientId: recipient.id,
            recipientName: recipient.name,
            platform: recipient.platform,
            chatId,
            status: "failed",
            error: errorMessage(cause),
          };
        }
      }),
    );

    const at = this.#now().toISOString();
    const message: BroadcastMessageDto = {
      id: `broadcast-message-${this.#id()}`,
      broadcastId,
      body,
      sentAt: at,
      deliveries,
    };
    const broadcast: BroadcastDto = {
      ...current,
      recipients,
      updatedAt: at,
      lastActivity: at,
      preview: body,
    };
    this.#state.broadcasts[index] = broadcast;
    this.#state.messages[broadcastId] = [
      message,
      ...(this.#state.messages[broadcastId] ?? []),
    ].slice(0, MAX_MESSAGES_PER_BROADCAST);
    this.#save();
    return {broadcast: structuredClone(broadcast), message: structuredClone(message)};
  }

  #find(id: string): BroadcastDto {
    const found = this.#state.broadcasts.find((item) => item.id === id);
    if (!found) throw new Error("This broadcast no longer exists.");
    return found;
  }

  #save(): void {
    this.#store.setPreference(PREFERENCE_KEY, this.#state as unknown as JsonValue);
  }
}

function uniqueRecipients(input: BroadcastRecipientDto[]): BroadcastRecipientDto[] {
  const recipients: BroadcastRecipientDto[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const id = raw.id?.trim();
    const name = raw.name?.trim();
    const accountId = raw.accountId?.trim();
    if (!id || !name || !accountId || (!raw.chatId && !raw.remoteId)) continue;
    const key = `${raw.platform}:${accountId}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    recipients.push({
      id,
      name,
      platform: raw.platform,
      accountId,
      accountName: raw.accountName?.trim() || accountId,
      remoteId: raw.remoteId?.trim() || null,
      chatId: raw.chatId?.trim() || null,
      avatarUrl: raw.avatarUrl?.trim() || null,
    });
  }
  return recipients;
}

function storedBroadcasts(value: unknown): StoredBroadcasts {
  if (!value || typeof value !== "object") return emptyState();
  const raw = value as Partial<StoredBroadcasts>;
  if (raw.version !== 1 || !Array.isArray(raw.broadcasts) || !raw.messages)
    return emptyState();
  // Records were written by this class. A malformed individual record is
  // omitted instead of making every valid broadcast disappear.
  const broadcasts = raw.broadcasts.filter(validBroadcast);
  const ids = new Set(broadcasts.map((item) => item.id));
  const messages = Object.fromEntries(
    Object.entries(raw.messages).filter(([id, rows]) => ids.has(id) && Array.isArray(rows)),
  ) as Record<string, BroadcastMessageDto[]>;
  for (const id of ids) messages[id] ??= [];
  return {version: 1, broadcasts: structuredClone(broadcasts), messages: structuredClone(messages)};
}

function validBroadcast(value: unknown): value is BroadcastDto {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<BroadcastDto>;
  return typeof item.id === "string" &&
    typeof item.name === "string" &&
    Array.isArray(item.recipients) &&
    typeof item.createdAt === "string" &&
    typeof item.updatedAt === "string";
}

function emptyState(): StoredBroadcasts {
  return {version: 1, broadcasts: [], messages: {}};
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause || "Delivery failed");
}
