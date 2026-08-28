import {ImapFlow, type FetchMessageObject, type ListResponse} from "imapflow";
import type {
  MailAddressDto,
  MailEnvelopeDto,
  MailFolderDto,
  MailMessageDto,
} from "@polymux/protocol";

/**
 * Live IMAP connections, one per account, held open for as long as the app is.
 *
 * The point of this module is the holding. Reaching a mailbox by spawning a
 * CLI costs a process, a TLS handshake and a LOGIN *per operation* — measured
 * against Gmail, about 1.9s, of which the handshake is only ~250ms. Everything
 * else is setup being redone. Opening the message you clicked is a single
 * round trip on a connection that is already authenticated and already has the
 * folder selected; the two seconds were never the message.
 *
 * So a connection is a cached thing with a lifetime, and this class is mostly
 * about the ways one stops working: the server hanging up on an idle socket,
 * a token expiring, two operations arriving at once down a protocol that can
 * only carry one.
 */

/** What a connection needs, read out of the account's own configuration. */
export interface MailCredentials {
  host: string;
  port: number;
  encryption: "tls" | "start-tls" | "none";
  login: string;
  /** XOAUTH2 when the account authenticates with a bearer token. */
  kind: "password" | "oauth2";
  secret: string;
}

export interface MailStoreOptions {
  /** The account's connection details, or null if there is no such account. */
  credentials: (accountId: string) => Promise<MailCredentials | null>;
  /**
   * Asked to renew an expired token, once, before a failed login is given up
   * on. The account layer owns the exchange, because it holds the client
   * registration and the keychain entries; this is only the signal that the
   * token in hand was refused. Resolves when the stored token may have
   * changed; the caller re-reads it either way.
   */
  renew: (accountId: string) => Promise<void>;
}

/**
 * How long a connection may sit unused before it is closed. Servers hang up on
 * idle connections anyway; doing it deliberately means the next command finds
 * a socket that is definitely dead rather than one that looks alive.
 */
const IDLE_MS = 5 * 60_000;

export class MailStore {
  readonly #options: MailStoreOptions;
  readonly #clients = new Map<string, Promise<ImapFlow>>();
  /**
   * IMAP carries one command at a time, so everything for an account queues on
   * its own chain. Without this, two clicks in quick succession interleave
   * their fetches down one socket and the library rejects the second.
   */
  readonly #queues = new Map<string, Promise<unknown>>();
  readonly #timers = new Map<string, NodeJS.Timeout>();
  /**
   * Each message's part layout, remembered from the listing that already asked
   * for it. Knowing where the body lives before the message is opened is what
   * lets opening it be a single round trip instead of one to read the
   * structure and another to fetch the part it points at.
   */
  readonly #structures = new Map<string, MessagePart[]>();

  constructor(options: MailStoreOptions) {
    this.#options = options;
  }

  async folders(accountId: string): Promise<MailFolderDto[]> {
    return this.#run(accountId, async (client) => {
      const list = await client.list();
      return list
        .filter((item) => !item.flags?.has("\\Noselect"))
        .map((item) => ({
          name: item.path,
          label: leafName(item.path),
          role: folderRole(item.path, describe(item)),
        }));
    });
  }

  /**
   * A folder's envelopes, newest first.
   *
   * Without a search there is nothing to search *for*: the wanted page is a
   * window on the end of the mailbox, addressed by sequence number, which
   * costs no SEARCH at all. A query has to ask the server which messages match
   * before it can know what the page contains.
   */
  async envelopes(options: {
    account: string;
    folder: string;
    page?: number;
    pageSize?: number;
    query?: string;
    sort?: "date-desc" | "date-asc" | "subject" | "from";
  }): Promise<MailEnvelopeDto[]> {
    const size = options.pageSize ?? 30;
    const page = Math.max(1, options.page ?? 1);
    const criteria = searchCriteria(options.query);
    return this.#run(options.account, async (client) => {
      const lock = await client.getMailboxLock(options.folder);
      try {
        const total = client.mailbox && typeof client.mailbox === "object" ? client.mailbox.exists : 0;
        if (!total) return [];
        let messages: FetchMessageObject[] = [];
        if (criteria) {
          const uids = await client.search(criteria, {uid: true});
          if (!uids || uids.length === 0) return [];
          // Search answers in ascending order; the newest are at the end.
          const ordered = [...uids].reverse();
          const wanted = ordered.slice((page - 1) * size, page * size);
          if (wanted.length === 0) return [];
          messages = await collect(client, wanted.join(","), true);
        } else {
          const last = total - (page - 1) * size;
          const first = Math.max(1, last - size + 1);
          if (last < 1) return [];
          // Sequence order is arrival order, so the newest are at the end of
          // the window. Reversing here is what makes the sort below stable in
          // the right direction when a run of messages shares a timestamp.
          messages = (await collect(client, `${first}:${last}`, false)).reverse();
        }
        for (const message of messages)
          this.#remember(
            options.account,
            options.folder,
            String(message.uid),
            flattenParts(message.bodyStructure),
            uidValidity(client),
          );
        const previews = await this.#previews(client, messages);
        const envelopes = messages.map((message) => ({
          ...toEnvelope(message),
          preview: previews.get(String(message.uid)) ?? "",
        }));
        return sortEnvelopes(envelopes, options.sort);
      } finally {
        lock.release();
      }
    });
  }

  /**
   * One message, with its body but *not* its attachments.
   *
   * This is the other half of why opening a message was slow. Asking a CLI for
   * the readable body means exporting the whole message — every attachment
   * decoded and written to disk — to get at the HTML part. A 10MB invoice is
   * downloaded so that a paragraph of text can be shown. BODYSTRUCTURE says
   * where the text lives before anything is transferred, so only that part is
   * fetched; the attachments are reported by name and left on the server until
   * something actually asks for them.
   */
  async message(options: {
    account: string;
    folder: string;
    id: string;
  }): Promise<MailMessageDto> {
    const uid = options.id;
    return this.#run(options.account, async (client) => {
      const lock = await client.getMailboxLock(options.folder);
      try {
        // Looked up only once the folder is open, because the layout is only
        // this message's while UIDVALIDITY is unchanged. A rebuilt mailbox
        // reissues its uids, and a remembered layout would then be some other
        // message's — rendering the wrong body with no way to notice.
        const validity = uidValidity(client);
        const known = this.#structures.get(structureKey(options.account, options.folder, uid, validity));
        // The listing already read this message's layout, so the bodies can be
        // named in the same command that asks for the envelope — one round
        // trip for the whole message. Without that, the structure has to come
        // back before the fetch that uses it can be sent.
        const wanted = known ? bodyParts(known) : [];
        const message = await client.fetchOne(
          uid,
          {
            uid: true,
            envelope: true,
            bodyStructure: !known,
            flags: true,
            // A reply threads in the recipient's client only if it echoes the
            // chain it answers, and the envelope does not carry it.
            headers: ["references", "in-reply-to"],
            ...(wanted.length ? {bodyParts: wanted.map((part) => part.id)} : {}),
          },
          {uid: true},
        );
        if (!message) throw new Error("That message is no longer in this folder.");
        const parts = known ?? flattenParts(message.bodyStructure);
        if (!known) this.#remember(options.account, options.folder, uid, parts, validity);
        const htmlPart = parts.find((part) => part.type === "text/html");
        const textPart = parts.find((part) => part.type === "text/plain");
        // Both bodies in one command whichever way we got here: asking for them
        // one at a time is a round trip each, and against a server a couple of
        // hundred milliseconds away that is most of what opening a message
        // costs.
        const bodies = message.bodyParts
          ? decodeParts(message.bodyParts, parts)
          : await this.#parts(client, uid, bodyParts(parts));
        const html = bodies.get(htmlPart?.id ?? "") ?? null;
        const text = bodies.get(textPart?.id ?? "") ?? null;
        const envelope = message.envelope;
        return {
          id: uid,
          subject: envelope?.subject ?? "",
          from: address(envelope?.from?.[0]),
          to: addresses(envelope?.to),
          cc: addresses(envelope?.cc),
          bcc: addresses(envelope?.bcc),
          date: (envelope?.date ?? new Date()).toISOString(),
          // A message with only HTML still owes the reader words: the markup is
          // flattened rather than leaving the body empty behind a blocked frame.
          body: text ?? (html ? htmlToText(html) : ""),
          html: html ?? null,
          attachments: parts
            .filter((part) => part.attachment)
            .map((part) => ({name: part.name ?? "attachment", mime: part.type})),
          messageId: envelope?.messageId ?? null,
          references: references(message.headers),
        } satisfies MailMessageDto;
      } finally {
        lock.release();
      }
    });
  }

  /**
   * Several MIME parts as text, in one fetch, keyed by section.
   *
   * Fetched this way the bytes arrive exactly as the message carries them —
   * still base64 or quoted-printable, still in the sender's charset — because
   * only the convenience call decodes, and the convenience call is the one
   * that costs a round trip per part. The structure already said how each part
   * is encoded, so decoding here is reading what was already fetched.
   */
  /**
   * A line of each message's body, for the list rows, in as few commands as
   * the page allows.
   *
   * The section a message keeps its text in differs from message to message,
   * and one fetch can only name one set of sections — so the page is grouped
   * by section and each group asked for once. In practice almost every message
   * keeps its text at section 1, which makes this a single extra round trip
   * for a whole page rather than one per row.
   *
   * A body big enough to be worth a transfer of its own is skipped: a preview
   * is worth a line of text, never a megabyte of newsletter markup.
   */
  async #previews(
    client: ImapFlow,
    messages: FetchMessageObject[],
  ): Promise<Map<string, string>> {
    const previews = new Map<string, string>();
    const groups = new Map<string, {uid: string; part: MessagePart}[]>();
    for (const message of messages) {
      const parts = flattenParts(message.bodyStructure);
      const part =
        parts.find((item) => item.type === "text/plain" && !item.attachment) ??
        parts.find((item) => item.type === "text/html" && !item.attachment);
      if (!part || part.size > PREVIEW_MAX_BYTES) continue;
      const group = groups.get(part.id) ?? [];
      group.push({uid: String(message.uid), part});
      groups.set(part.id, group);
    }
    for (const [id, group] of groups) {
      const wanted = new Map(group.map((item) => [item.uid, item.part]));
      // Never fatal: a row without its preview is a row, while a failed peek
      // that threw would be a folder that would not list.
      try {
        for await (const fetched of client.fetch(
          [...wanted.keys()].join(","),
          {uid: true, bodyParts: [id]},
          {uid: true},
        )) {
          const part = wanted.get(String(fetched.uid));
          const bytes = fetched.bodyParts?.get(id);
          if (!part || !bytes) continue;
          previews.set(String(fetched.uid), previewOf(decodePart(bytes, part.encoding, part.charset), part.type));
        }
      } catch {
        continue;
      }
    }
    return previews;
  }

  async #parts(
    client: ImapFlow,
    uid: string,
    parts: MessagePart[],
  ): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    if (parts.length === 0) return found;
    const message = await client
      .fetchOne(uid, {uid: true, bodyParts: parts.map((part) => part.id)}, {uid: true})
      .catch((): false => false);
    if (!message || !message.bodyParts) return found;
    return decodeParts(message.bodyParts, parts);
  }

  async flag(options: {
    account: string;
    folder: string;
    ids: string[];
    flag: "seen" | "flagged";
    on: boolean;
  }): Promise<void> {
    if (options.ids.length === 0) return;
    const flags = [options.flag === "seen" ? "\\Seen" : "\\Flagged"];
    await this.#run(options.account, async (client) => {
      const lock = await client.getMailboxLock(options.folder);
      try {
        const range = options.ids.join(",");
        if (options.on) await client.messageFlagsAdd(range, flags, {uid: true});
        else await client.messageFlagsRemove(range, flags, {uid: true});
      } finally {
        lock.release();
      }
    });
  }

  async move(options: {
    account: string;
    folder: string;
    ids: string[];
    target: string;
  }): Promise<void> {
    if (options.ids.length === 0) return;
    await this.#run(options.account, async (client) => {
      const lock = await client.getMailboxLock(options.folder);
      try {
        await client.messageMove(options.ids.join(","), options.target, {uid: true});
      } finally {
        lock.release();
      }
    });
  }

  async delete(options: {account: string; folder: string; ids: string[]}): Promise<void> {
    if (options.ids.length === 0) return;
    await this.#run(options.account, async (client) => {
      const lock = await client.getMailboxLock(options.folder);
      try {
        await client.messageDelete(options.ids.join(","), {uid: true});
      } finally {
        lock.release();
      }
    });
  }

  /** Every attachment's bytes, named as the message announces them. */
  async attachments(options: {
    account: string;
    folder: string;
    id: string;
  }): Promise<{name: string; content: Buffer}[]> {
    return this.#run(options.account, async (client) => {
      const lock = await client.getMailboxLock(options.folder);
      try {
        const message = await client.fetchOne(options.id, {uid: true, bodyStructure: true}, {uid: true});
        if (!message) throw new Error("That message is no longer in this folder.");
        const wanted = flattenParts(message.bodyStructure).filter((part) => part.attachment);
        const files: {name: string; content: Buffer}[] = [];
        for (const [index, part] of wanted.entries()) {
          // Deliberately not caught: a part that will not download is a failed
          // save, and swallowing it here would report "no attachments" for a
          // message that plainly has one — while also stepping on the one-shot
          // reconnect above, which only fires for an error that reaches it.
          const download = await client.download(options.id, part.id, {uid: true});
          if (!download?.content)
            throw new Error(`${part.name ?? "An attachment"} could not be read from the server.`);
          const chunks: Buffer[] = [];
          for await (const chunk of download.content) chunks.push(Buffer.from(chunk));
          files.push({name: part.name ?? `attachment-${index + 1}`, content: Buffer.concat(chunks)});
        }
        return files;
      } finally {
        lock.release();
      }
    });
  }

  /**
   * Files a finished message into a folder. This is how a draft is saved: it
   * is written to the mailbox itself rather than kept locally, so it appears
   * wherever the user reads their mail and can be finished on another device.
   */
  async append(options: {
    account: string;
    folder: string;
    raw: string;
    flags?: string[];
    messageId?: string;
  }): Promise<string | null> {
    return this.#run(options.account, async (client) => {
      const appended = await client.append(
        options.folder,
        Buffer.from(options.raw, "utf8"),
        options.flags ?? [],
      );
      if (!appended) throw new Error(`Could not append the message to ${options.folder}.`);
      if (appended.uid) return String(appended.uid);
      if (!options.messageId) return null;

      // UIDPLUS normally gives the new UID in the APPEND response. A smaller
      // IMAP server may omit it, so find the one-off Message-ID we just wrote.
      const lock = await client.getMailboxLock(options.folder);
      try {
        const found = await client.search(
          {header: {"message-id": options.messageId}},
          {uid: true},
        );
        return Array.isArray(found) && found.length ? String(found.at(-1)) : null;
      } finally {
        lock.release();
      }
    });
  }

  /** Whether a folder already holds the message with this id. */
  async contains(options: {account: string; folder: string; messageId: string}): Promise<boolean> {
    return this.#run(options.account, async (client) => {
      const lock = await client.getMailboxLock(options.folder);
      try {
        const found = await client.search({header: {"message-id": options.messageId}}, {uid: true});
        return Array.isArray(found) && found.length > 0;
      } finally {
        lock.release();
      }
    });
  }

  /** Proves an account works by opening a connection and listing its folders. */
  async check(accountId: string): Promise<void> {
    await this.folders(accountId);
  }

  /** Drops an account's connection, so the next command builds a fresh one. */
  async disconnect(accountId: string): Promise<void> {
    const pending = this.#clients.get(accountId);
    this.#clients.delete(accountId);
    const timer = this.#timers.get(accountId);
    if (timer) clearTimeout(timer);
    this.#timers.delete(accountId);
    if (!pending) return;
    await pending.then((client) => client.logout()).catch(() => {});
  }

  async close(): Promise<void> {
    await Promise.all([...this.#clients.keys()].map((id) => this.disconnect(id)));
  }

  /**
   * Runs one operation against an account's connection, in turn behind
   * whatever else that account is doing.
   *
   * A held connection is the one thing here that can be stale in a way the
   * caller should never see, so a command that fails on a dead socket is
   * retried once on a new one. That retry is deliberately limited to the
   * connection failing: a message that no longer exists must report itself,
   * not be asked for twice.
   */
  async #run<T>(accountId: string, body: (client: ImapFlow) => Promise<T>): Promise<T> {
    const queued = (this.#queues.get(accountId) ?? Promise.resolve()).then(
      async (): Promise<T> => {
        try {
          return await body(await this.#client(accountId));
        } catch (cause) {
          if (!isConnectionFailure(cause)) throw cause;
          await this.disconnect(accountId);
          return await body(await this.#client(accountId));
        } finally {
          this.#idle(accountId);
        }
      },
    );
    // The queue holds the *settled* chain: one operation's failure must not
    // reject every operation waiting behind it.
    this.#queues.set(
      accountId,
      queued.then(
        (): undefined => undefined,
        (): undefined => undefined,
      ),
    );
    return queued;
  }

  /** The account's connection, opened on first use and kept afterwards. */
  #client(accountId: string): Promise<ImapFlow> {
    const existing = this.#clients.get(accountId);
    if (existing) return existing;
    const opening = this.#open(accountId).catch((cause: unknown) => {
      // A failed connection must not be cached, or the account stays broken
      // for the life of the app.
      this.#clients.delete(accountId);
      throw cause;
    });
    this.#clients.set(accountId, opening);
    return opening;
  }

  async #open(accountId: string, renewed = false): Promise<ImapFlow> {
    const credentials = await this.#options.credentials(accountId);
    if (!credentials) throw new Error(`No email account named ${accountId}`);
    const client = new ImapFlow({
      host: credentials.host,
      port: credentials.port,
      secure: credentials.encryption === "tls",
      auth:
        credentials.kind === "oauth2"
          ? {user: credentials.login, accessToken: credentials.secret}
          : {user: credentials.login, pass: credentials.secret},
      // The library's own logging writes every command to stdout, including
      // the LOGIN line.
      logger: false,
      emitLogs: false,
    });
    // ImapFlow raises errors on the client itself; unhandled, one takes the
    // process down rather than the mailbox.
    client.on("error", () => {});
    try {
      await client.connect();
    } catch (cause) {
      await client.logout().catch(() => {});
      // An expired bearer token looks exactly like a wrong password, so a
      // renewal is asked for once and only once — a genuinely wrong password
      // must not become an endless pair of round trips.
      if (!renewed && credentials.kind === "oauth2" && isAuthFailure(cause)) {
        // If the refresh token itself was revoked, that provider error is the
        // useful answer: retrying the same rejected access token would only
        // replace it with the server's generic "Invalid credentials".
        await this.#options.renew(accountId);
        return this.#open(accountId, true);
      }
      throw cause;
    }
    return client;
  }

  /**
   * Files a message's layout against its folder, forgetting the oldest once
   * the map has grown past a few folders' worth. This is a shortcut, never a
   * source of truth: a miss costs the round trip it would always have cost.
   */
  #remember(account: string, folder: string, uid: string, parts: MessagePart[], validity: string): void {
    const key = structureKey(account, folder, uid, validity);
    this.#structures.delete(key);
    this.#structures.set(key, parts);
    if (this.#structures.size > 500) {
      const oldest = this.#structures.keys().next();
      if (!oldest.done) this.#structures.delete(oldest.value);
    }
  }

  /** Restarts the unused-connection countdown. */
  #idle(accountId: string): void {
    const existing = this.#timers.get(accountId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => void this.disconnect(accountId), IDLE_MS);
    // A pending close must never be the reason the app stays alive.
    timer.unref?.();
    this.#timers.set(accountId, timer);
  }
}

/**
 * A remembered layout belongs to one message in one incarnation of a folder.
 * UIDVALIDITY is the server's own statement that its uids still mean what they
 * meant; when it changes, every key built under the old one stops matching.
 */
function structureKey(account: string, folder: string, uid: string, validity: string): string {
  return `${account}\u0000${folder}\u0000${validity}\u0000${uid}`;
}

function uidValidity(client: ImapFlow): string {
  const mailbox = client.mailbox;
  return mailbox && typeof mailbox === "object" ? String(mailbox.uidValidity ?? "") : "";
}

/** Everything the envelope list needs, in one fetch. */
async function collect(
  client: ImapFlow,
  range: string,
  uid: boolean,
): Promise<FetchMessageObject[]> {
  const messages: FetchMessageObject[] = [];
  for await (const message of client.fetch(
    range,
    {uid: true, envelope: true, flags: true, bodyStructure: true},
    {uid},
  ))
    messages.push(message);
  return messages;
}

function sortEnvelopes(
  envelopes: MailEnvelopeDto[],
  sort?: "date-desc" | "date-asc" | "subject" | "from",
): MailEnvelopeDto[] {
  const by = (a: MailEnvelopeDto, b: MailEnvelopeDto): number => {
    switch (sort) {
      case "date-asc":
        return a.date.localeCompare(b.date);
      case "subject":
        return a.subject.localeCompare(b.subject);
      case "from":
        return (a.from.name ?? a.from.address).localeCompare(b.from.name ?? b.from.address);
      default:
        return b.date.localeCompare(a.date);
    }
  };
  return [...envelopes].sort(by);
}

function toEnvelope(message: FetchMessageObject): MailEnvelopeDto {
  const envelope = message.envelope;
  const flags = message.flags ?? new Set<string>();
  return {
    id: String(message.uid),
    subject: envelope?.subject ?? "",
    from: address(envelope?.from?.[0]) ?? {name: null, address: ""},
    to: address(envelope?.to?.[0]),
    date: (envelope?.date ?? new Date()).toISOString(),
    seen: flags.has("\\Seen"),
    flagged: flags.has("\\Flagged"),
    answered: flags.has("\\Answered"),
    draft: flags.has("\\Draft"),
    hasAttachment: flattenParts(message.bodyStructure).some((part) => part.attachment),
  };
}

function address(value: {name?: string; address?: string} | undefined): MailAddressDto | null {
  if (!value?.address) return null;
  return {name: value.name || null, address: value.address};
}

function addresses(values: {name?: string; address?: string}[] | undefined): MailAddressDto[] {
  return (values ?? []).map(address).filter((item): item is MailAddressDto => item !== null);
}

interface MessagePart {
  id: string;
  type: string;
  name: string | null;
  attachment: boolean;
  /** Content-Transfer-Encoding, lowercased; "" when the part states none. */
  encoding: string;
  /** The part's charset, lowercased; "" when the part states none. */
  charset: string;
  /** The part's size in bytes, as the structure announces it; 0 when unstated. */
  size: number;
}

/**
 * The message's parts, flat, each with the section number a fetch addresses it
 * by. A part is an attachment because it is dispositioned as one or carries a
 * filename — not because of its type: an inline signature image is a picture
 * the reader should not be offered as a download, while a forwarded `.eml` is.
 */
function flattenParts(node: unknown, into: MessagePart[] = []): MessagePart[] {
  if (!node || typeof node !== "object") return into;
  const part = node as {
    part?: string;
    type?: string;
    size?: number;
    encoding?: string;
    disposition?: string;
    dispositionParameters?: Record<string, string>;
    parameters?: Record<string, string>;
    childNodes?: unknown[];
  };
  const type = (part.type ?? "").toLowerCase();
  const encoding = (part.encoding ?? "").toLowerCase();
  const charset = (part.parameters?.charset ?? "").toLowerCase();
  // A forwarded message is a container *and* a file. Recursing past it the way
  // a multipart is recursed past would list the quoted mail's own parts as
  // though they belonged to this message, and leave the .eml itself with no
  // section anyone could download.
  if (type === "message/rfc822") {
    const forwarded = part.part || "1";
    into.push({
      id: forwarded,
      type,
      name: part.dispositionParameters?.filename ?? part.parameters?.name ?? "forwarded.eml",
      attachment: true,
      encoding,
      charset,
      size: part.size ?? 0,
    });
    return into;
  }
  if (part.childNodes?.length) {
    for (const child of part.childNodes) flattenParts(child, into);
    return into;
  }
  // The root of a single-part message has no section number; it is section 1.
  const id = part.part || "1";
  const name = part.dispositionParameters?.filename ?? part.parameters?.name ?? null;
  const disposition = (part.disposition ?? "").toLowerCase();
  const textual = type === "text/plain" || type === "text/html";
  into.push({
    id,
    type: type || "application/octet-stream",
    name,
    attachment: disposition === "attachment" || (!textual && !!name),
    encoding,
    charset,
    size: part.size ?? 0,
  });
  return into;
}

/**
 * The search box's own query language, translated to IMAP SEARCH.
 *
 * The little DSL stays because it is what the agent's tool and the search box
 * already speak. Only the shapes those two actually produce are translated — a field
 * followed by a term, joined by `or`/`and` — and anything else falls back to
 * matching the whole string across subject, sender and body, which is what a
 * person typing into a search box means anyway.
 */
export function searchCriteria(query: string | undefined): Record<string, unknown> | null {
  // Ordering is applied after the fact; it says nothing about which messages
  // match, and IMAP SEARCH has nowhere to put it.
  const text = (query ?? "").replace(/\border by [a-z]+(\s+(asc|desc))?/gi, "").trim();
  if (!text) return null;
  const grouped: Record<string, unknown>[] = [];
  let outsideGroups = text.replace(
    /\b(from|to|cc|bcc|subject|body)\s*\(([^()]*)\)/gi,
    (_match, field: string, alternatives: string) => {
      const terms = alternatives
        .split(/\s+or\s+/i)
        .map((value) => value.trim().replace(/^"|"$/g, ""))
        .filter(Boolean)
        .map((value) => readTerm(field.toLowerCase(), {value, quoted: true}))
        .filter((term): term is Record<string, unknown> => Boolean(term));
      if (terms.length) grouped.push(terms.length === 1 ? terms[0]! : {or: terms});
      return " ";
    },
  );
  // A natural grouped topic disjunction has no repeated field prefix, e.g.
  // `since 21-Aug-2026 (NUS OR National University of Singapore)`. Keep the
  // date outside the group as an AND bound and match each alternative across
  // the same subject/sender/body fields as ordinary free text. Treating the
  // bare `OR` as global used to pull in every message after the date.
  outsideGroups = outsideGroups.replace(/\(([^()]*)\)/g, (_match, alternatives: string) => {
    const terms = alternatives
      .split(/\s+or\s+/i)
      .map((value) => value.trim().replace(/^"|"$/g, ""))
      .filter(Boolean)
      .flatMap((value) => [
        {subject: value},
        {from: value},
        {body: value},
      ]);
    if (terms.length) grouped.push({or: terms});
    return " ";
  }).trim();
  if (grouped.length) {
    const outside = outsideGroups ? searchCriteria(outsideGroups) : null;
    if (!outside) return grouped.length === 1 ? grouped[0]! : {and: grouped};
    return grouped.length === 1 && !("or" in outside)
      ? {...outside, ...grouped[0]}
      : {and: [outside, ...grouped]};
  }
  const tokens = tokenise(text);
  const terms: Record<string, unknown>[] = [];
  // `or` is only a joiner when it stands as a bare word. Read off the raw
  // string it also matched inside a quoted value, turning
  // `subject "cats or dogs"` into a disjunction of unrelated terms.
  let disjunction = false;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.quoted) continue;
    const word = token.value.toLowerCase();
    if (word === "or") {
      disjunction = true;
      continue;
    }
    if (word === "and" || word === "not") continue;
    const term = readTerm(word, tokens[index + 1]);
    if (!term) continue;
    terms.push(term);
    index++;
  }
  if (terms.length === 0) return {or: [{subject: text}, {from: text}, {body: text}]};
  if (terms.length === 1) return terms[0];
  if (disjunction) return {or: terms};
  // `and` is the default in IMAP SEARCH, but the criteria object is keyed by
  // field — so two terms on one field have to be nested rather than merged, or
  // the second silently replaces the first.
  const merged: Record<string, unknown> = {};
  const extra: Record<string, unknown>[] = [];
  for (const term of terms) {
    const [key] = Object.keys(term);
    if (key in merged) extra.push(term);
    else merged[key] = term[key];
  }
  return extra.length ? {...merged, and: extra} : merged;
}

/** A field term, or null when the word does not name one. */
function readTerm(field: string, next: Token | undefined): Record<string, unknown> | null {
  if (!next) return null;
  const value = next.value;
  if (!value) return null;
  switch (field) {
    case "from":
    case "to":
    case "cc":
    case "bcc":
    case "subject":
    case "body":
      return {[field]: value};
    // A date is the one term the server will refuse outright if it is handed
    // the words a person types. IMAP wants `1-Aug-2026`, so anything a Date
    // can read is converted and anything it cannot is dropped rather than sent.
    case "since":
    case "after":
      return date(value, "since");
    case "before":
      return date(value, "before");
    case "on":
      return date(value, "on");
    case "flag": {
      const flag = FLAGS[value.toLowerCase()];
      return flag ? {[flag]: true} : null;
    }
    default:
      return null;
  }
}

/** The flag words a person uses, and the SEARCH key each one means. */
const FLAGS: Record<string, string> = {
  seen: "seen",
  read: "seen",
  unseen: "unseen",
  unread: "unseen",
  flagged: "flagged",
  starred: "flagged",
  answered: "answered",
  replied: "answered",
  draft: "draft",
  deleted: "deleted",
};

function date(value: string, key: "since" | "before" | "on"): Record<string, unknown> | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : {[key]: parsed};
}

interface Token {
  value: string;
  /** Whether it arrived in quotes, which is what makes it a value and not a word. */
  quoted: boolean;
}

/** Splits a query into words, keeping a quoted phrase whole. */
function tokenise(text: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /"([^"]*)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null)
    tokens.push(
      match[1] === undefined ? {value: match[2], quoted: false} : {value: match[1], quoted: true},
    );
  return tokens;
}

function describe(item: ListResponse): string {
  const flags = item.flags ? [...item.flags].join(" ") : "";
  return `${flags} ${item.specialUse ?? ""}`;
}

function leafName(name: string): string {
  const leaf = name.split("/").pop() ?? name;
  const trimmed = leaf.replace(/^\[[^\]]+\]\s*/, "") || name;
  return /^[A-Z]+$/.test(trimmed) ? trimmed.charAt(0) + trimmed.slice(1).toLowerCase() : trimmed;
}

function folderRole(name: string, desc: string): MailFolderDto["role"] {
  const flags = desc.toLowerCase();
  if (flags.includes("\\junk")) return "junk";
  if (flags.includes("\\trash")) return "trash";
  if (flags.includes("\\drafts")) return "drafts";
  if (flags.includes("\\sent")) return "sent";
  if (flags.includes("\\all") || flags.includes("\\archive")) return "archive";
  if (flags.includes("\\flagged")) return "flagged";
  const leaf = leafName(name).toLowerCase();
  if (leaf === "inbox") return "inbox";
  if (leaf === "spam" || leaf === "junk") return "junk";
  if (leaf === "trash" || leaf === "deleted items") return "trash";
  if (leaf === "drafts") return "drafts";
  if (leaf.startsWith("sent")) return "sent";
  if (leaf === "archive") return "archive";
  return "other";
}

/**
 * The chain a message belongs to, oldest first. References carries it in full;
 * a message that has only In-Reply-To names nothing but its immediate parent,
 * which is still a chain of one.
 */
function references(headers: Buffer | undefined): string[] {
  if (!headers) return [];
  const text = headers.toString("utf8");
  const read = (name: string): string => {
    const match = new RegExp(`^${name}:([^]*?)(?=\\r?\\n[^ \\t]|$)`, "im").exec(text);
    return match ? match[1].replace(/\s+/g, " ").trim() : "";
  };
  const ids = `${read("references")} ${read("in-reply-to")}`.match(/<[^>]+>/g) ?? [];
  return [...new Set(ids)];
}

/**
 * The most of a body worth transferring for a one-line preview. Beyond this a
 * row goes without one rather than pulling a whole newsletter down to read its
 * first sentence.
 */
const PREVIEW_MAX_BYTES = 64 * 1024;

/** How much of the body a row can show, with room to spare for the ellipsis. */
const PREVIEW_CHARS = 200;

/** A body reduced to the single line a list row has space for. */
function previewOf(body: string, type: string): string {
  const text = type === "text/html" ? htmlToText(body) : body;
  const line = text
    // Quoted history and signatures say nothing about *this* message.
    .split(/\n\s*(?:>|-- )/)[0]
    .replace(/\s+/g, " ")
    .trim();
  return line.length > PREVIEW_CHARS ? `${line.slice(0, PREVIEW_CHARS).trimEnd()}\u2026` : line;
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The parts worth fetching for a reader: the message's text, in both spellings. */
function bodyParts(parts: MessagePart[]): MessagePart[] {
  return parts.filter((part) => part.type === "text/html" || part.type === "text/plain");
}

/** Fetched section bytes as text, keyed by section. */
function decodeParts(raw: Map<string, Buffer>, parts: MessagePart[]): Map<string, string> {
  const found = new Map<string, string>();
  for (const part of parts) {
    const bytes = raw.get(part.id);
    if (!bytes) continue;
    const body = decodePart(bytes, part.encoding, part.charset).trim();
    if (body) found.set(part.id, body);
  }
  return found;
}

/**
 * A part's bytes as text: undone from its transfer encoding, then read in the
 * charset it declares. A charset the platform does not know is read as UTF-8
 * rather than refused — mangled accents are a better answer than no message.
 */
function decodePart(raw: Buffer, encoding: string, charset: string): string {
  const bytes =
    encoding === "base64"
      ? Buffer.from(raw.toString("ascii"), "base64")
      : encoding === "quoted-printable"
        ? decodeQuotedPrintable(raw)
        : raw;
  const label = charset && charset !== "utf8" ? charset : "utf-8";
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return bytes.toString("utf8");
  }
}

/** Quoted-printable, which is most mail that has an accent in it. */
function decodeQuotedPrintable(raw: Buffer): Buffer {
  // A trailing "=" is a soft line break: the line continues, and neither the
  // "=" nor the newline after it is part of the text.
  const text = raw.toString("latin1").replace(/=(?:\r\n|\n|\r)/g, "");
  const out: number[] = [];
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "=" && /^[0-9a-f]{2}$/i.test(text.slice(index + 1, index + 3))) {
      out.push(parseInt(text.slice(index + 1, index + 3), 16));
      index += 2;
    } else out.push(text.charCodeAt(index) & 0xff);
  }
  return Buffer.from(out);
}

function isAuthFailure(cause: unknown): boolean {
  if (cause && typeof cause === "object") {
    const detail = cause as {
      authenticationFailed?: unknown;
      serverResponseCode?: unknown;
      responseStatus?: unknown;
      responseText?: unknown;
      oauthError?: {status?: unknown};
    };
    // ImapFlow deliberately keeps the top-level message generic ("Command
    // failed") and records authentication failures in structured fields.
    // Gmail's OAUTHBEARER rejection therefore has to be recognized here, or
    // the expired access token is never exchanged for a fresh one.
    if (detail.authenticationFailed === true) return true;
    const structured = [
      detail.serverResponseCode,
      detail.responseStatus,
      detail.responseText,
      detail.oauthError?.status,
    ]
      .filter((value): value is string => typeof value === "string")
      .join(" ");
    if (/auth|credential|password|token|login|AUTHENTICATIONFAILED/i.test(structured)) return true;
  }
  const text = cause instanceof Error ? cause.message : String(cause);
  return /auth|credential|password|token|login|AUTHENTICATIONFAILED/i.test(text);
}

function isConnectionFailure(cause: unknown): boolean {
  if (cause instanceof Error && "code" in cause) {
    const code = String((cause as {code?: unknown}).code ?? "");
    if (/ECONNRESET|EPIPE|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH/.test(code)) return true;
  }
  const text = cause instanceof Error ? cause.message : String(cause);
  return /closed|not connected|socket|disconnect|timed out|timeout/i.test(text);
}
