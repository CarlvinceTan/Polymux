import type {
  ChatDto,
  ChatMessageDto,
  CommsStatusDto,
  HubSnapshotDto,
  MailEnvelopeDto,
  MailFolderDto,
  MailMessageDto,
} from "@flareai/protocol";

/** The slice of storage the cache needs. Narrow on purpose: this is a copy of
 * what the network owns, and nothing here should be able to reach the rest of
 * the database. */
export interface HubCacheStore {
  readCommsCache(key: string): {key: string; value: string; fetchedAt: string} | null;
  listCommsCache(prefix: string): Array<{key: string; value: string; fetchedAt: string}>;
  writeCommsCache(key: string, value: string): unknown;
  deleteCommsCache(prefix: string): number;
  trimCommsCache(prefix: string, keep: number): number;
}

/** How much of each kind survives quitting. The point is the first screen, not
 * an offline copy: enough that the hub opens on what the user last saw, and
 * little enough that the database stays small. Bodies are the large rows,
 * which is why they are the tightest. */
const KEEP_MAILBOXES = 12;
const KEEP_BODIES = 24;
const KEEP_CHAT_PAGES = 12;

/** Past this, a body is not worth keeping: the whole snapshot crosses to the
 * renderer in one read before its first paint, and one newsletter carrying a
 * megabyte of inlined HTML would cost more there than the fetch it saves. */
const MAX_BODY_BYTES = 512 * 1024;

const STATUS_KEY = "hub:status";
const CHATS_KEY = "hub:chats";
const MAILBOX_PREFIX = "hub:mailbox:";
const BODY_PREFIX = "hub:body:";
const CHAT_PAGE_PREFIX = "hub:chat:";

/**
 * What the hub knew when the app last quit.
 *
 * Every pane in the hub is network-bound — IMAP for a mailbox, the homeserver
 * for a conversation — so a cold start was a skeleton for as long as the
 * slowest of them took, every launch, even when nothing had changed. This
 * records each answer as it passes through the backend and hands the lot back
 * as one snapshot at startup, so the hub paints from disk and the fetch behind
 * it only corrects what moved.
 *
 * Writes are best-effort by construction: a cache that throws would fail a
 * request that had already succeeded, so every path here swallows its own
 * trouble and the caller never learns whether the row landed.
 */
export class HubCache {
  readonly #store: HubCacheStore;

  constructor(store: HubCacheStore) {
    this.#store = store;
  }

  putStatus(status: CommsStatusDto): void {
    this.#write(STATUS_KEY, status);
  }

  putChats(chats: ChatDto[]): void {
    this.#write(CHATS_KEY, chats);
  }

  /** A folder's first page, with the folder list it was read against — the two
   * are what the mail pane needs to draw itself, and neither is useful alone. */
  putMailbox(
    account: string,
    folder: string,
    folders: MailFolderDto[],
    envelopes: MailEnvelopeDto[],
  ): void {
    this.#write(`${MAILBOX_PREFIX}${account}|${folder}`, {account, folder, folders, envelopes});
    this.#trim(MAILBOX_PREFIX, KEEP_MAILBOXES);
  }

  putMail(account: string, folder: string, message: MailMessageDto): void {
    const row = JSON.stringify({account, folder, message});
    if (row.length > MAX_BODY_BYTES) return;
    this.#writeRaw(`${BODY_PREFIX}${account}|${folder}|${message.id}`, row);
    this.#trim(BODY_PREFIX, KEEP_BODIES);
  }

  putChatPage(chatId: string, messages: ChatMessageDto[], nextBefore: string | null): void {
    this.#write(`${CHAT_PAGE_PREFIX}${chatId}`, {chatId, messages, nextBefore});
    this.#trim(CHAT_PAGE_PREFIX, KEEP_CHAT_PAGES);
  }

  /** Everything at once, because the renderer wants one round trip before its
   * first paint rather than one per pane. */
  snapshot(): HubSnapshotDto {
    return {
      status: this.#read<CommsStatusDto>(STATUS_KEY),
      chats: this.#read<ChatDto[]>(CHATS_KEY) ?? [],
      mailboxes: this.#list<HubSnapshotDto["mailboxes"][number]>(MAILBOX_PREFIX),
      mail: this.#list<HubSnapshotDto["mail"][number]>(BODY_PREFIX),
      messages: this.#list<HubSnapshotDto["messages"][number]>(CHAT_PAGE_PREFIX),
    };
  }

  /** Signing out of the hub, or removing the account a row belongs to, has to
   * take the copy with it — a stale inbox is a privacy problem, not just a
   * wrong screen. */
  clear(): void {
    try {
      this.#store.deleteCommsCache("hub:");
    } catch {
      // Nothing kept is nothing to show; the hub fetches as it always did.
    }
  }

  #write(key: string, value: unknown): void {
    this.#writeRaw(key, JSON.stringify(value));
  }

  #writeRaw(key: string, value: string): void {
    try {
      this.#store.writeCommsCache(key, value);
    } catch {
      // A row that will not store costs a spinner next launch, nothing more.
    }
  }

  #trim(prefix: string, keep: number): void {
    try {
      this.#store.trimCommsCache(prefix, keep);
    } catch {
      // Same: the cap is housekeeping, not correctness.
    }
  }

  #read<T>(key: string): T | null {
    try {
      const row = this.#store.readCommsCache(key);
      return row ? (JSON.parse(row.value) as T) : null;
    } catch {
      return null;
    }
  }

  #list<T>(prefix: string): T[] {
    try {
      return this.#store
        .listCommsCache(prefix)
        .flatMap((row) => {
          try {
            return [JSON.parse(row.value) as T];
          } catch {
            // A row written by an older shape is skipped rather than allowed
            // to take the whole snapshot down with it.
            return [];
          }
        });
    } catch {
      return [];
    }
  }
}
