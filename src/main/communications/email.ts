import {mkdir, readFile, rename, writeFile} from "node:fs/promises";
import path from "node:path";
import {parse as parseToml, stringify as stringifyToml} from "smol-toml";
import type {
  CommsEmailAccountDto,
  MailAttachmentDto,
  CommsEmailEndpointDto,
  CommsEmailToolingDto,
  MailAddressDto,
  MailEnvelopeDto,
  MailFolderDto,
  MailMessageDto,
  SaveEmailAccountRequest,
} from "@midas/protocol";

/**
 * Keychain service prefix for mailbox passwords. The generic-password entry is
 * what the account's `auth.cmd` in Himalaya's config reads back, so the naming
 * is a contract between this module and the config it writes — changing it
 * orphans every account already on disk.
 */
export const EMAIL_KEYCHAIN_SERVICE = "Midas Email";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a command with no shell. `input` is written to stdin and closed. */
export type CommandRunner = (
  command: string,
  args: string[],
  input?: string,
) => Promise<CommandResult>;

export interface EmailAccountsOptions {
  /** Himalaya's TOML config, normally ~/.config/himalaya/config.toml. */
  configPath: string;
  run: CommandRunner;
  /** Himalaya executable, resolved from PATH by default. */
  binary?: string;
}

interface TomlTable {
  [key: string]: unknown;
}

export function keychainService(accountId: string): string {
  return `${EMAIL_KEYCHAIN_SERVICE}: ${accountId}`;
}

/**
 * Reads the password back the way Himalaya will. Quoting matters because
 * Himalaya hands this string to a shell.
 */
function keychainReadCommand(accountId: string, login: string): string {
  return `security find-generic-password -s '${shellQuote(keychainService(accountId))}' -a '${shellQuote(login)}' -w`;
}

function shellQuote(value: string): string {
  return value.replace(/'/g, "'\\''");
}

/**
 * Manages the mailboxes Himalaya can reach: the account tables in its TOML
 * config, and the passwords those tables point at in the OS keychain. Secrets
 * are written through stdin and read back only by Himalaya itself, so no
 * plaintext password ever reaches a process argument list or this module's
 * return values.
 */
export class EmailAccounts {
  readonly #configPath: string;
  readonly #run: CommandRunner;
  readonly #binary: string;

  constructor(options: EmailAccountsOptions) {
    this.#configPath = options.configPath;
    this.#run = options.run;
    this.#binary = options.binary ?? "himalaya";
  }

  get configPath(): string {
    return this.#configPath;
  }

  async tooling(): Promise<CommsEmailToolingDto> {
    const result = await this.#run(this.#binary, ["--version"]).catch(
      (error: unknown): CommandResult => ({
        code: -1,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
      }),
    );
    if (result.code !== 0)
      return {
        installed: false,
        version: null,
        configPath: this.#configPath,
        error:
          "Himalaya is not installed. Install it with `cargo install himalaya` or `brew install himalaya` to send and read email.",
      };
    return {
      installed: true,
      version: result.stdout.trim().split("\n")[0] || null,
      configPath: this.#configPath,
      error: null,
    };
  }

  async list(): Promise<CommsEmailAccountDto[]> {
    const config = await this.#read();
    const accounts = isTable(config.accounts) ? config.accounts : {};
    return Object.entries(accounts)
      .filter((entry): entry is [string, TomlTable] => isTable(entry[1]))
      .map(([id, table]) => this.#toDto(id, table));
  }

  async save(request: SaveEmailAccountRequest): Promise<void> {
    const login = request.imapLogin ?? request.email;
    const smtpLogin = request.smtpLogin ?? request.email;
    if (request.password) await this.#storeSecret(request.id, login, request.password);
    // Editing an account can rename it, which moves both the TOML key and the
    // keychain entry the config points at.
    const renamed = request.originalId && request.originalId !== request.id;
    if (renamed && !request.password)
      await this.#copySecret(request.originalId!, request.id, login);

    const config = await this.#read();
    const accounts: TomlTable = isTable(config.accounts) ? {...config.accounts} : {};
    const previous = isTable(accounts[request.originalId ?? request.id])
      ? (accounts[request.originalId ?? request.id] as TomlTable)
      : {};
    if (renamed) delete accounts[request.originalId!];

    // A credential command is Himalaya's own `password` + `cmd` pair: the
    // command prints the secret. Full OAuth2 needs a client id, auth url, and
    // scope that this form does not collect, so those accounts are never
    // rewritten here — their existing auth block is carried over untouched
    // instead, which is what makes editing one non-destructive.
    const lookup = {type: "password", cmd: keychainReadCommand(request.id, login)};
    const previousId = request.originalId ?? request.id;
    const auth = request.tokenCommand
      ? {type: "password", cmd: request.tokenCommand}
      : request.password
        ? lookup
        : (foreignAuth(previous.backend, previousId) ?? lookup);
    const sendAuth = request.tokenCommand
      ? {type: "password", cmd: request.tokenCommand}
      : request.password
        ? lookup
        : (foreignAuth(sendBackend(previous), previousId) ?? auth);

    accounts[request.id] = {
      // Preserve folder aliases, signatures, and anything else the user set by
      // hand; only the connection and credential keys are ours to own.
      ...omit(previous, ["email", "display-name", "default", "backend", "message"]),
      email: request.email,
      ...(request.displayName ? {"display-name": request.displayName} : {}),
      ...(request.isDefault ? {default: true} : {}),
      backend: {
        type: "imap",
        host: request.imapHost,
        port: request.imapPort,
        encryption: {type: request.imapEncryption},
        login,
        auth,
      },
      message: {
        ...(isTable(previous.message) ? omit(previous.message as TomlTable, ["send"]) : {}),
        send: {
          backend: {
            type: "smtp",
            host: request.smtpHost,
            port: request.smtpPort,
            encryption: {type: request.smtpEncryption},
            login: smtpLogin,
            auth: sendAuth,
          },
        },
      },
    };

    // Exactly one account may be default, or Himalaya picks arbitrarily.
    if (request.isDefault)
      for (const [id, table] of Object.entries(accounts))
        if (id !== request.id && isTable(table) && table.default === true)
          accounts[id] = omit(table, ["default"]);

    await this.#write({...config, accounts});
  }

  async remove(id: string): Promise<void> {
    const config = await this.#read();
    if (!isTable(config.accounts)) return;
    const accounts = {...config.accounts};
    const table = accounts[id];
    if (!isTable(table)) return;
    delete accounts[id];
    await this.#write({...config, accounts});
    const login = endpointLogin(table.backend) ?? String(table.email ?? "");
    if (login) await this.#deleteSecret(id, login);
  }

  /** Proves the account works by listing folders over IMAP. */
  async test(id: string): Promise<CommsEmailAccountDto> {
    const accounts = await this.list();
    const account = accounts.find((item) => item.id === id);
    if (!account) throw new Error(`No email account named ${id}`);
    const result = await this.#run(this.#binary, [
      "-c",
      this.#configPath,
      "folder",
      "list",
      "-a",
      id,
      "--output",
      "json",
    ]).catch(
      (error: unknown): CommandResult => ({
        code: -1,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
      }),
    );
    if (result.code === 0) return {...account, status: "ok", error: null};
    return {...account, status: "error", error: firstError(result.stderr || result.stdout)};
  }

  /** Folders, classified by the special-use flags IMAP advertises for them. */
  async folders(account?: string): Promise<MailFolderDto[]> {
    const args = ["folder", "list"];
    if (account) args.push("--account", account);
    const raw = await this.#jsonCommand(args);
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((item): item is {name?: unknown; desc?: unknown} => typeof item === "object" && item !== null)
      .map((item) => {
        const name = typeof item.name === "string" ? item.name : "";
        return {name, label: leafName(name), role: folderRole(name, String(item.desc ?? ""))};
      })
      .filter((folder) => folder.name);
  }

  /** Message envelopes in a folder, newest first. */
  async envelopes(options: {
    account?: string;
    folder?: string;
    page?: number;
    pageSize?: number;
    query?: string;
    sort?: "date-desc" | "date-asc" | "subject" | "from";
  }): Promise<MailEnvelopeDto[]> {
    const args = ["envelope", "list", "--page-size", String(options.pageSize ?? 30)];
    if (options.page && options.page > 1) args.push("--page", String(options.page));
    if (options.folder) args.push("--folder", options.folder);
    if (options.account) args.push("--account", options.account);
    // A query is positional and must come last — after every flag, including
    // the `--output json` that #jsonCommand appends.
    const query = searchQuery(options.query, options.sort);
    const raw = await this.#jsonCommand(args, query ? [query] : []);
    return Array.isArray(raw) ? raw.map(toEnvelope) : [];
  }

  async message(options: {
    id: string;
    account?: string;
    folder?: string;
  }): Promise<MailMessageDto> {
    const args = ["message", "read", options.id];
    // Himalaya prints only the headers it is asked for, and a reply cannot
    // thread without the ids of what it answers.
    for (const header of ["From", "To", "Cc", "Subject", "Date", "Message-ID", "References", "In-Reply-To"])
      args.push("--header", header);
    if (options.folder) args.push("--folder", options.folder);
    if (options.account) args.push("--account", options.account);
    const raw = await this.#jsonCommand(args);
    // Himalaya returns either the rendered message as a bare string, or an
    // object carrying it; both shapes appear across versions.
    const body =
      typeof raw === "string"
        ? raw
        : isTable(raw) && typeof raw.message === "string"
          ? raw.message
          : JSON.stringify(raw);
    return parseMessage(options.id, body);
  }

  async send(options: {
    account?: string;
    from: string;
    to: string[];
    cc: string[];
    bcc: string[];
    subject: string;
    body: string;
    /** Saves to the drafts folder rather than sending. */
    draft?: boolean;
    /** Absolute paths of files to attach. */
    attachments?: string[];
    inReplyTo?: string;
    references?: string[];
  }): Promise<void> {
    const args = options.draft ? ["message", "save"] : ["message", "send"];
    if (options.draft) args.push("--folder", "Drafts");
    if (options.account) args.push("--account", options.account);
    // Files are read here rather than pointed at, because the message goes to
    // Himalaya over stdin as one finished MIME document.
    const attachments = await Promise.all(
      (options.attachments ?? []).map(async (file) => ({
        name: path.basename(file),
        mime: mimeType(file),
        content: await readFile(file),
      })),
    );
    const result = await this.#run(
      this.#binary,
      ["-c", this.#configPath, ...args],
      mimeMessage({...options, attachments}),
    );
    if (result.code !== 0)
      throw new Error(
        `${options.draft ? "Could not save the draft" : "Could not send the email"}: ${firstError(result.stderr || result.stdout)}`,
      );
  }

  /** Erases messages outright, with no folder to recover them from. */
  async delete(options: {
    ids: string[];
    account?: string;
    folder?: string;
  }): Promise<void> {
    if (options.ids.length === 0) return;
    const args = ["message", "delete"];
    if (options.folder) args.push("--folder", options.folder);
    if (options.account) args.push("--account", options.account);
    args.push(...options.ids);
    const result = await this.#run(this.#binary, ["-c", this.#configPath, ...args]);
    if (result.code !== 0)
      throw new Error(`Could not delete the message: ${firstError(result.stderr || result.stdout)}`);
  }

  /**
   * Saves a message's attachments and reports where they landed. Himalaya
   * prints the paths it wrote, which is the only way to know the directory it
   * chose from its own config.
   */
  async download(options: {
    id: string;
    account?: string;
    folder?: string;
  }): Promise<string[]> {
    const args = ["attachment", "download"];
    if (options.folder) args.push("--folder", options.folder);
    if (options.account) args.push("--account", options.account);
    args.push(options.id);
    const result = await this.#run(this.#binary, ["-c", this.#configPath, ...args]);
    if (result.code !== 0)
      throw new Error(
        `Could not save the attachments: ${firstError(result.stderr || result.stdout)}`,
      );
    return attachmentPaths(result.stdout);
  }

  /** Moves messages to another folder, which is how junk and trash are applied. */
  async move(options: {
    ids: string[];
    target: string;
    account?: string;
    folder?: string;
  }): Promise<void> {
    if (options.ids.length === 0) return;
    const args = ["message", "move"];
    if (options.folder) args.push("--folder", options.folder);
    if (options.account) args.push("--account", options.account);
    args.push(options.target, ...options.ids);
    const result = await this.#run(this.#binary, ["-c", this.#configPath, ...args]);
    if (result.code !== 0)
      throw new Error(`Could not move the message: ${firstError(result.stderr || result.stdout)}`);
  }

  async flag(options: {
    ids: string[];
    flag: "seen" | "flagged";
    on: boolean;
    account?: string;
    folder?: string;
  }): Promise<void> {
    if (options.ids.length === 0) return;
    const args = ["flag", options.on ? "add" : "remove"];
    if (options.folder) args.push("--folder", options.folder);
    if (options.account) args.push("--account", options.account);
    args.push(...options.ids, options.flag === "seen" ? "seen" : "flagged");
    const result = await this.#run(this.#binary, ["-c", this.#configPath, ...args]);
    if (result.code !== 0)
      throw new Error(`Could not update the message: ${firstError(result.stderr || result.stdout)}`);
  }

  async #jsonCommand(args: string[], positional: string[] = []): Promise<unknown> {
    const result = await this.#run(this.#binary, [
      "-c",
      this.#configPath,
      ...args,
      "--output",
      "json",
      ...positional,
    ]);
    if (result.code !== 0)
      throw new Error(firstError(result.stderr || result.stdout));
    // A bad search query is reported on stderr with an exit code of 0, leaving
    // stdout empty, so silence here is a failure rather than an empty mailbox.
    const failure = diagnostic(result.stderr);
    if (!result.stdout.trim()) throw new Error(failure || "Himalaya returned no output.");
    try {
      return JSON.parse(result.stdout) as unknown;
    } catch {
      throw new Error(failure || "Himalaya returned output that could not be read as JSON.");
    }
  }

  async #storeSecret(accountId: string, login: string, password: string): Promise<void> {
    // `security -i` reads its command from stdin, which keeps the password out
    // of the process table the way passing -w on argv would not.
    const result = await this.#run(
      "security",
      ["-i"],
      `add-generic-password -U -s ${quote(keychainService(accountId))} -a ${quote(login)} -w ${quote(password)}\n`,
    );
    if (result.code !== 0)
      throw new Error(
        `Could not save the mailbox password to the keychain: ${result.stderr.trim() || `security exited ${result.code}`}`,
      );
  }

  async #copySecret(fromId: string, toId: string, login: string): Promise<void> {
    const read = await this.#run(
      "security",
      ["-i"],
      `find-generic-password -s ${quote(keychainService(fromId))} -a ${quote(login)} -w\n`,
    );
    // A missing entry means the account authenticates some other way; there is
    // nothing to carry over.
    if (read.code !== 0) return;
    const password = read.stdout.replace(/\n$/, "");
    if (!password) return;
    await this.#storeSecret(toId, login, password);
    await this.#deleteSecret(fromId, login);
  }

  async #deleteSecret(accountId: string, login: string): Promise<void> {
    await this.#run(
      "security",
      ["-i"],
      `delete-generic-password -s ${quote(keychainService(accountId))} -a ${quote(login)}\n`,
    ).catch((): undefined => undefined);
  }

  async #read(): Promise<TomlTable> {
    const source = await readFile(this.#configPath, "utf8").catch(
      (error: NodeJS.ErrnoException): string | undefined => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      },
    );
    if (!source) return {};
    const parsed = parseToml(source);
    return isTable(parsed) ? (parsed as TomlTable) : {};
  }

  async #write(config: TomlTable): Promise<void> {
    await mkdir(path.dirname(this.#configPath), {recursive: true});
    const temporary = `${this.#configPath}.tmp`;
    await writeFile(temporary, stringifyToml(config), {encoding: "utf8", mode: 0o600});
    await rename(temporary, this.#configPath);
  }

  #toDto(id: string, table: TomlTable): CommsEmailAccountDto {
    const incoming = endpoint(table.backend);
    const send = isTable(table.message) && isTable(table.message.send)
      ? (table.message.send as TomlTable).backend
      : undefined;
    return {
      id,
      displayName: typeof table["display-name"] === "string" ? table["display-name"] : null,
      email: typeof table.email === "string" ? table.email : "",
      isDefault: table.default === true,
      incoming,
      outgoing: endpoint(send),
      // Only accounts whose config points at our own keychain entry are ones
      // we hold the secret for; hand-written `raw` or foreign `cmd` accounts
      // keep working but are not ours to re-save.
      secretStored: authCommand(table.backend)?.includes(keychainService(id)) === true,
      status: "unknown",
      error: null,
    };
  }
}

function endpoint(value: unknown): CommsEmailEndpointDto {
  if (!isTable(value))
    return {kind: "none", host: null, port: null, encryption: null, login: null, auth: "none"};
  const kind = typeof value.type === "string" ? value.type : "none";
  const encryption = isTable(value.encryption) && typeof value.encryption.type === "string"
    ? value.encryption.type
    : typeof value.encryption === "string"
      ? value.encryption
      : null;
  return {
    kind: (["imap", "maildir", "notmuch", "smtp", "sendmail"].includes(kind)
      ? kind
      : "none") as CommsEmailEndpointDto["kind"],
    host: typeof value.host === "string" ? value.host : null,
    port: typeof value.port === "number" ? value.port : null,
    encryption: (encryption === "tls" || encryption === "start-tls" || encryption === "none"
      ? encryption
      : null),
    login: typeof value.login === "string" ? value.login : null,
    auth: authKind(value.auth),
  };
}

function authKind(value: unknown): CommsEmailEndpointDto["auth"] {
  if (!isTable(value)) return "none";
  if (value.type === "oauth2") return "oauth2";
  if (typeof value.cmd === "string") return "command";
  if (typeof value.keyring === "string") return "keyring";
  if (typeof value.raw === "string") return "password";
  return value.type === "password" ? "password" : "none";
}

function authCommand(value: unknown): string | null {
  if (!isTable(value) || !isTable(value.auth)) return null;
  return typeof value.auth.cmd === "string" ? value.auth.cmd : null;
}

/**
 * An account's auth block when it is not one of our own keychain lookups —
 * OAuth2, or a credential command the user wrote. Preserving it is what lets an
 * OAuth2 account, whose client id and scope this form never collects, survive
 * an edit to its server settings.
 *
 * A lookup we wrote is deliberately *not* preserved: it names the account it
 * belongs to, so a rename has to regenerate it to follow the moved secret.
 */
function foreignAuth(backend: unknown, accountId: string): TomlTable | null {
  if (!isTable(backend) || !isTable(backend.auth)) return null;
  const command = typeof backend.auth.cmd === "string" ? backend.auth.cmd : "";
  return command.includes(keychainService(accountId)) ? null : backend.auth;
}

function sendBackend(account: TomlTable): unknown {
  if (!isTable(account.message) || !isTable(account.message.send)) return undefined;
  return (account.message.send as TomlTable).backend;
}

function endpointLogin(value: unknown): string | null {
  return isTable(value) && typeof value.login === "string" ? value.login : null;
}

function isTable(value: unknown): value is TomlTable {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function omit(table: TomlTable, keys: string[]): TomlTable {
  const copy = {...table};
  for (const key of keys) delete copy[key];
  return copy;
}

/**
 * Builds the raw message Himalaya reads from stdin. Header values are folded
 * onto one line each, because a newline in a header would let a subject or
 * address inject headers of its own.
 */
interface OutgoingAttachment {
  name: string;
  mime: string;
  /** Raw bytes, base64-encoded when written into the message. */
  content: Buffer;
}

function mimeMessage(options: {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: OutgoingAttachment[];
}): string {
  const files = options.attachments ?? [];
  // A reply that carries neither header starts a new thread in the reader's
  // client, however much the subject line looks like an answer.
  const chain = [...(options.references ?? []), ...(options.inReplyTo ? [options.inReplyTo] : [])]
    .map(headerValue)
    .filter(Boolean);
  const headers = [
    `From: ${headerValue(options.from)}`,
    `To: ${options.to.map(headerValue).join(", ")}`,
    ...(options.cc.length ? [`Cc: ${options.cc.map(headerValue).join(", ")}`] : []),
    ...(options.bcc.length ? [`Bcc: ${options.bcc.map(headerValue).join(", ")}`] : []),
    `Subject: ${headerValue(options.subject)}`,
    ...(options.inReplyTo ? [`In-Reply-To: ${headerValue(options.inReplyTo)}`] : []),
    ...(chain.length ? [`References: ${chain.join(" ")}`] : []),
    "MIME-Version: 1.0",
  ];
  const body = options.body.replace(/\r?\n/g, "\r\n");
  if (files.length === 0)
    return `${[...headers, "Content-Type: text/plain; charset=utf-8"].join("\r\n")}\r\n\r\n${body}\r\n`;

  const boundary = `midas-${Date.now().toString(36)}-${files.length}`;
  const parts = [
    ["Content-Type: text/plain; charset=utf-8", "", body].join("\r\n"),
    ...files.map((file) =>
      [
        `Content-Type: ${file.mime}; name="${headerValue(file.name)}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${headerValue(file.name)}"`,
        "",
        file.content.toString("base64").replace(/(.{76})/g, "$1\r\n"),
      ].join("\r\n"),
    ),
  ];
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    ...parts.map((part) => `--${boundary}\r\n${part}`),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

/**
 * Turns what someone typed into a search box into Himalaya's query language,
 * which only understands conditions like `subject x` joined by operators — a
 * bare word is a parse error there, so words are matched against the three
 * fields a reader means when they search a mailbox.
 */
export function searchQuery(
  text: string | undefined,
  sort?: "date-desc" | "date-asc" | "subject" | "from",
): string {
  const words = (text ?? "").trim();
  const order =
    sort === "date-asc"
      ? "order by date asc"
      : sort === "subject"
        ? "order by subject asc"
        : sort === "from"
          ? "order by from asc"
          : sort
            ? "order by date desc"
            : "";
  if (!words) return order;
  // Already a query — passing it through lets the DSL stay available to
  // anyone who knows it, and to the agent's own tool calls.
  const filter = /\b(from|to|subject|body|cc|bcc|date|before|after|flag)\s+\S/i.test(words)
    ? words
    : `subject ${quoteTerm(words)} or from ${quoteTerm(words)} or body ${quoteTerm(words)}`;
  return order ? `${filter} ${order}` : filter;
}

function quoteTerm(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

/**
 * Enough of a type table to label the files people actually attach; anything
 * unrecognised travels as octet-stream, which every client can still save.
 */
const MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  heic: "image/heic",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  zip: "application/zip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  mov: "video/quicktime",
};

function mimeType(file: string): string {
  return MIME_TYPES[path.extname(file).slice(1).toLowerCase()] ?? "application/octet-stream";
}

/** The paths Himalaya prints after saving a message's attachments. */
export function attachmentPaths(stdout: string): string[] {
  return [...stdout.matchAll(/(\/[^\s"']+)/g)].map((match) => match[1]).filter(Boolean);
}

function headerValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}


/** Leaf of an IMAP path: "[Gmail]/Sent Mail" reads better as "Sent Mail". */
function leafName(name: string): string {
  const leaf = name.split("/").pop() ?? name;
  return leaf.replace(/^\[[^\]]+\]\s*/, "") || name;
}

/**
 * Classifies a folder from the special-use attributes IMAP reports for it,
 * falling back to its name. The attributes are authoritative and portable —
 * Gmail calls junk "[Gmail]/Spam" while other servers call it "Junk", but both
 * advertise `\Junk`.
 */
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

function toAddress(value: unknown): MailAddressDto {
  if (!isTable(value)) return {name: null, address: ""};
  return {
    name: typeof value.name === "string" && value.name ? value.name : null,
    address: typeof value.addr === "string" ? value.addr : "",
  };
}

function toEnvelope(value: unknown): MailEnvelopeDto {
  const item = isTable(value) ? value : {};
  const flags = Array.isArray(item.flags)
    ? item.flags.map((flag) => String(flag).toLowerCase())
    : [];
  return {
    id: String(item.id ?? ""),
    subject: typeof item.subject === "string" ? item.subject : "(no subject)",
    from: toAddress(item.from),
    to: isTable(item.to) ? toAddress(item.to) : null,
    date: typeof item.date === "string" ? item.date : "",
    seen: flags.includes("seen"),
    flagged: flags.includes("flagged"),
    answered: flags.includes("answered"),
    draft: flags.includes("draft"),
    hasAttachment: item.has_attachment === true,
  };
}

/**
 * Splits Himalaya's rendered message into headers and body. It prints a plain
 * RFC-822-style block, so the first blank line ends the headers.
 */
function parseMessage(id: string, rendered: string): MailMessageDto {
  const normalised = rendered.replace(/\r\n/g, "\n");
  const split = normalised.indexOf("\n\n");
  const head = split === -1 ? normalised : normalised.slice(0, split);
  const body = split === -1 ? "" : normalised.slice(split + 2);
  const header = (label: string): string => {
    const match = head.match(new RegExp(`^${label}:\\s*(.+)$`, "im"));
    return match?.[1]?.trim() ?? "";
  };
  return {
    id,
    subject: header("Subject") || "(no subject)",
    from: header("From") ? parseAddress(header("From")) : null,
    to: splitAddresses(header("To")),
    cc: splitAddresses(header("Cc")),
    date: header("Date"),
    body: renderBody(body),
    html: extractHtml(body),
    attachments: listAttachments(body),
    messageId: header("Message-ID") || null,
    // In-Reply-To is the immediate parent; References is the chain. Together
    // they are what a reply must echo back for the thread to survive.
    references: [...splitIds(header("References")), ...splitIds(header("In-Reply-To"))].filter(
      (id, index, all) => all.indexOf(id) === index,
    ),
  };
}

interface MessagePart {
  /** MIME type from the marker's `type=` attribute, null for bare text. */
  type: string | null;
  attachment: boolean;
  /** Name from the marker's `filename=` attribute, when it carries one. */
  filename: string | null;
  content: string;
}

/**
 * Himalaya wraps each MIME part it prints in Emacs-MML markers —
 * `<#part type=text/html>` … `<#/part>` — and leaves HTML parts as raw markup
 * with their entities intact. None of that is for a reader's eyes, so the body
 * is interpreted here: when a message carries a plain-text alternative it wins,
 * HTML parts are converted to text, and attachment stubs are dropped.
 */
export function renderBody(raw: string): string {
  const parts = splitParts(raw).filter(
    (part) =>
      !part.attachment &&
      (part.type === null || part.type === "text/plain" || part.type === "text/html"),
  );
  // A typed plain part is the sender's own text alternative; showing the HTML
  // part too would print the same message twice.
  const hasPlain = parts.some((part) => part.type === "text/plain" && part.content.trim());
  const chosen = hasPlain ? parts.filter((part) => part.type !== "text/html") : parts;
  const text = chosen
    .map((part) =>
      part.type === "text/html" || isHtmlDocument(part.content)
        ? htmlToText(part.content)
        : part.content.trim(),
    )
    .filter(Boolean)
    .join("\n\n");
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * The sender's own HTML, joined when a message carries more than one such
 * part, or null when it is text all the way down. Handed on as written:
 * sanitising is the reader's job, and doing it here would leave the main
 * process pretending markup is safe that the renderer must re-check anyway.
 */
/** The files a message announces, read off the part markers Himalaya prints. */
export function listAttachments(raw: string): MailAttachmentDto[] {
  return splitParts(raw)
    .filter((part) => part.attachment)
    .map((part) => ({
      name: part.filename ?? "attachment",
      mime: part.type,
    }));
}

function splitIds(value: string): string[] {
  return [...value.matchAll(/<[^>]+>/g)].map((match) => match[0]);
}

export function extractHtml(raw: string): string | null {
  const html = splitParts(raw)
    .filter(
      (part) =>
        !part.attachment &&
        (part.type === "text/html" ||
          (part.type === null && isHtmlDocument(part.content))),
    )
    .map((part) => part.content.trim())
    .filter(Boolean)
    .join("\n");
  return html || null;
}

function splitParts(raw: string): MessagePart[] {
  const parts: MessagePart[] = [];
  const push = (part: MessagePart): void => {
    // Multipart markers only group parts; they carry no content of their own.
    const content = part.content.replace(/<#\/?multipart[^>]*>/gi, "");
    // An attachment marker is usually empty — it announces a file rather than
    // carrying one — so it counts even when there is nothing between the tags.
    if (content.trim() || part.attachment) parts.push({...part, content});
  };
  let cursor = 0;
  for (const match of raw.matchAll(/<#part([^>]*)>([\s\S]*?)(?:<#\/part>|$)/gi)) {
    push({type: null, attachment: false, filename: null, content: raw.slice(cursor, match.index)});
    const attributes = match[1] ?? "";
    push({
      type: /type="?([\w.+-]+\/[\w.+-]+)/i.exec(attributes)?.[1]?.toLowerCase() ?? null,
      attachment: /filename=|disposition="?attachment/i.test(attributes),
      filename: /filename="?([^"\s>]+)/i.exec(attributes)?.[1] ?? null,
      content: match[2] ?? "",
    });
    cursor = match.index + match[0].length;
  }
  push({type: null, attachment: false, filename: null, content: raw.slice(cursor)});
  return parts;
}

/** Only a document-level opener marks bare text as HTML — a stray tag in a
 * plain-text message must not get that message rewritten. */
function isHtmlDocument(content: string): boolean {
  return /<!doctype html|<html[\s>]|<body[\s>]/i.test(content);
}

function htmlToText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(style|script|head|title)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br[^>]*>/gi, "\n")
    // Block-level boundaries become line breaks so adjacent paragraphs do not
    // run together once their tags are gone.
    .replace(/<\/?(p|div|h[1-6]|li|ul|ol|tr|table|blockquote|pre|section|article|header|footer)[^>]*>/gi, "\n")
    .replace(/<\/(td|th)>/gi, " ")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text)
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "©",
  reg: "®",
  trade: "™",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  middot: "·",
  bull: "•",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
    if (code.startsWith("#")) {
      const hex = code[1] === "x" || code[1] === "X";
      const value = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isNaN(value) || value > 0x10ffff ? whole : String.fromCodePoint(value);
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? whole;
  });
}

function splitAddresses(value: string): MailAddressDto[] {
  if (!value.trim()) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map(parseAddress);
}

/** Parses `Name <addr@host>` and bare-address header forms. */
function parseAddress(value: string): MailAddressDto {
  const match = value.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (match) return {name: match[1].replace(/^"|"$/g, "") || null, address: match[2].trim()};
  return {name: null, address: value.trim()};
}

/** `security` command arguments are shell-like, so values need quoting. */
function quote(value: string): string {
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

/**
 * Himalaya reports failures as a numbered cause chain wrapped in ANSI colour.
 * The innermost cause is the useful one for a settings row.
 */
function firstError(output: string): string {
  const lines = output
    // eslint-disable-next-line no-control-regex -- stripping ANSI colour codes
    .replace(/\u001b\[[0-9;]*m/g, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\d+:\s*/, "").trim())
    .filter((line) => line && !line.startsWith("Note:") && line !== "Error:");
  return lines[lines.length - 1] ?? "Connection failed";
}

/**
 * Himalaya sometimes fails while still exiting 0, printing a tracing log and a
 * caret-annotated diagnostic to stderr. Only the leading `Error:` sentence is
 * worth showing; the log lines and the box drawing under it are not.
 */
function diagnostic(output: string): string {
  const line = output
    // eslint-disable-next-line no-control-regex -- stripping ANSI colour codes
    .replace(/\u001b\[[0-9;]*m/g, "")
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item.startsWith("Error:"));
  return line ? line.replace(/^Error:\s*/, "") : "";
}
