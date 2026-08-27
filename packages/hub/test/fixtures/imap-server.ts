import net from "node:net";

/**
 * Just enough IMAP to answer the commands MailStore sends.
 *
 * The alternative was a fake at the library's edge, which would have proved
 * only that our code calls the functions we wrote it to call. The bugs worth
 * catching here are wire-level — a fetch that asks for the wrong section, a
 * BODYSTRUCTURE walked incorrectly, a UID range built by hand — and none of
 * them survive contact with a server that answers in the protocol's own words.
 *
 * It speaks no TLS. By default it advertises no AUTH extensions, so the client
 * falls back to plain LOGIN; an OAuth test can instead give it the one bearer
 * token it should accept.
 */

export interface FakeMessage {
  uid: number;
  flags: string[];
  /** The ENVELOPE response, exactly as the server would write it. */
  envelope: string;
  /** The BODYSTRUCTURE response, exactly as the server would write it. */
  bodyStructure: string;
  /** Body sections by their fetch address, e.g. "1.2" or "HEADER.FIELDS". */
  parts: Record<string, string>;
  /** What a SEARCH matches this message on, lowercased by the server. */
  searchText?: string;
}

export interface FakeMailbox {
  path: string;
  /** The special-use attribute LIST reports, e.g. "\\Trash". */
  specialUse?: string;
  messages: FakeMessage[];
}

export interface FakeImapServer {
  port: number;
  /** Every command line the server was sent, in order, tags stripped. */
  commands: string[];
  mailbox: (path: string) => FakeMailbox | undefined;
  close: () => Promise<void>;
}

export async function startImapServer(options: {
  mailboxes: FakeMailbox[];
  password?: string;
  /** Fails every login, the way an expired token does. */
  rejectLogin?: boolean;
  /** Advertises OAUTHBEARER and accepts only this access token. */
  oauthAccessToken?: string;
}): Promise<FakeImapServer> {
  const commands: string[] = [];
  const mailboxes = options.mailboxes;
  const find = (name: string): FakeMailbox | undefined =>
    mailboxes.find((box) => box.path.toLowerCase() === name.toLowerCase());

  const server = net.createServer((socket) => {
    let selected: FakeMailbox | undefined;
    let buffer = "";
    /** Set while the client is sending the bytes an APPEND announced. */
    let literal: {tag: string; box: FakeMailbox | undefined; flags: string[]; bytes: number} | null =
      null;
    const send = (line: string): void => void socket.write(`${line}\r\n`);
    const capabilities = `IMAP4rev1 UIDPLUS MOVE${options.oauthAccessToken ? " AUTH=OAUTHBEARER" : ""}`;
    send(`* OK [CAPABILITY ${capabilities}] fake ready`);

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        // A literal is counted bytes, not a line: the message being appended
        // contains newlines of its own, so reading it as lines would tear it
        // apart and leave its body being parsed as commands.
        if (literal) {
          if (Buffer.byteLength(buffer) < literal.bytes) break;
          const raw = buffer.slice(0, literal.bytes);
          buffer = buffer.slice(literal.bytes).replace(/^\r\n/, "");
          if (literal.box) {
            const uid = nextUid(literal.box);
            literal.box.messages.push({
              uid,
              flags: [...literal.flags],
              envelope: appendedEnvelope(raw),
              bodyStructure: `("TEXT" "PLAIN" ("CHARSET" "utf-8") NIL NIL "7BIT" ${raw.length} 1)`,
              parts: {"1": raw, TEXT: raw},
              searchText: raw.toLowerCase(),
            });
            send(`${literal.tag} OK [APPENDUID 1 ${uid}] appended`);
          } else send(`${literal.tag} NO no such mailbox`);
          literal = null;
          continue;
        }
        const end = buffer.indexOf("\r\n");
        if (end === -1) break;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const space = line.indexOf(" ");
        const tag = line.slice(0, space);
        const rest = line.slice(space + 1);
        commands.push(rest);
        const [name, ...args] = rest.split(" ");
        const command = name.toUpperCase();

        if (command === "CAPABILITY") {
          send(`* CAPABILITY ${capabilities}`);
          send(`${tag} OK done`);
        } else if (command === "AUTHENTICATE") {
          const payload = Buffer.from(args[1] ?? "", "base64").toString("utf8");
          const token = /(?:^|\x01)auth=Bearer ([^\x01]+)/.exec(payload)?.[1];
          if (token && token === options.oauthAccessToken) send(`${tag} OK authenticated`);
          else send(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials (Failure)`);
        } else if (command === "LOGIN") {
          if (options.rejectLogin) send(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials`);
          else send(`${tag} OK logged in`);
        } else if (command === "LIST" || command === "XLIST" || command === "LSUB") {
          // A client asks three different questions with this one command. The
          // empty pattern is only ever "what is your delimiter"; a reference
          // other than the root is a question about one subtree, and answering
          // it with the whole list makes the client prefix every name with the
          // reference it asked under.
          const reference = unquote(args[0] ?? "");
          const pattern = unquote(args[1] ?? "");
          if (pattern === "") {
            send('* LIST (\\Noselect) "/" ""');
          } else if (reference === "" && command !== "LSUB") {
            for (const box of mailboxes) {
              const attrs = box.specialUse ? `\\HasNoChildren ${box.specialUse}` : "\\HasNoChildren";
              send(`* LIST (${attrs}) "/" "${box.path}"`);
            }
          }
          send(`${tag} OK done`);
        } else if (command === "SELECT" || command === "EXAMINE") {
          selected = find(mailboxArg(args));
          if (!selected) {
            send(`${tag} NO no such mailbox`);
          } else {
            send(`* FLAGS (\\Seen \\Flagged \\Answered \\Draft \\Deleted)`);
            send(`* ${selected.messages.length} EXISTS`);
            send(`* OK [UIDVALIDITY 1] uids valid`);
            send(`* OK [UIDNEXT ${nextUid(selected)}] next`);
            send(`${tag} OK [READ-WRITE] selected`);
          }
        } else if (command === "UID" && (args[0] ?? "").toUpperCase() === "FETCH") {
          fetch(send, selected, args.slice(1), true);
          send(`${tag} OK done`);
        } else if (command === "FETCH") {
          fetch(send, selected, args, false);
          send(`${tag} OK done`);
        } else if (command === "UID" && (args[0] ?? "").toUpperCase() === "SEARCH") {
          const found = search(selected, args.slice(1).join(" "));
          send(`* SEARCH ${found.join(" ")}`);
          send(`${tag} OK done`);
        } else if (command === "UID" && (args[0] ?? "").toUpperCase() === "STORE") {
          store(selected, args.slice(1));
          send(`${tag} OK done`);
        } else if (command === "UID" && (args[0] ?? "").toUpperCase() === "MOVE") {
          const moved = move(selected, find(mailboxArg(args, 2)), args[1] ?? "");
          send(`${tag} ${moved ? "OK" : "NO"} done`);
        } else if (command === "UID" && (args[0] ?? "").toUpperCase() === "EXPUNGE") {
          send(`${tag} OK done`);
        } else if (command === "CLOSE" || command === "UNSELECT") {
          selected = undefined;
          send(`${tag} OK done`);
        } else if (command === "APPEND") {
          // `APPEND "folder" (\Flag) {bytes}` — the client waits for a
          // continuation before sending a byte of the message.
          const size = /\{(\d+)\+?\}\s*$/.exec(rest);
          const flagList = /\(([^)]*)\)/.exec(rest);
          literal = {
            tag,
            box: find(mailboxArg(args)),
            flags: (flagList?.[1] ?? "").split(" ").filter(Boolean),
            bytes: Number(size?.[1] ?? 0),
          };
          send("+ go ahead");
        } else if (command === "LOGOUT") {
          send("* BYE later");
          send(`${tag} OK done`);
          socket.end();
        } else {
          // NAMESPACE, ID, ENABLE and anything else the client tries: a bare
          // OK is a truthful "nothing to report" for all of them.
          send(`${tag} OK done`);
        }
      }
    });
    socket.on("error", () => {});
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    port,
    commands,
    mailbox: find,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/** Enough of a part header for a client to know how to decode the bytes. */
const MIME_HEADERS = 'Content-Type: text/plain; charset="utf-8"\r\nContent-Transfer-Encoding: 7bit\r\n\r\n';

/** Enough of an ENVELOPE for an appended message to list like any other. */
function appendedEnvelope(raw: string): string {
  const header = (name: string): string =>
    new RegExp(`^${name}:\\s*(.*)$`, "im").exec(raw)?.[1]?.trim() ?? "";
  const subject = header("subject").replace(/"/g, "");
  return `("Fri, 15 Aug 2026 10:00:00 +0000" "${subject}" NIL NIL NIL NIL NIL NIL NIL NIL)`;
}

function nextUid(box: FakeMailbox): number {
  return Math.max(0, ...box.messages.map((message) => message.uid)) + 1;
}

function unquote(value: string): string {
  return value.replace(/^"(.*)"$/, "$1");
}

/**
 * The mailbox a command names. Splitting the line on spaces loses any folder
 * whose name contains one — "[Gmail]/Sent Mail" arrives as two arguments — so
 * a quoted name is read whole and only an unquoted one falls back to the word.
 */
function mailboxArg(args: string[], index = 0): string {
  const rest = args.slice(index).join(" ");
  const quoted = /^\s*"([^"]*)"/.exec(rest);
  return quoted ? quoted[1] : (args[index] ?? "");
}

/** Expands "1:3", "2,5" and "1:*" against the mailbox, by uid or by position. */
function select(box: FakeMailbox, range: string, uid: boolean): FakeMessage[] {
  const keys = box.messages.map((message, index) => (uid ? message.uid : index + 1));
  const highest = Math.max(0, ...keys);
  const wanted = new Set<number>();
  for (const piece of range.split(",")) {
    const [from, to] = piece.split(":");
    const start = Number(from);
    if (!to) {
      wanted.add(start);
      continue;
    }
    const end = to === "*" ? highest : Number(to);
    for (let value = Math.min(start, end); value <= Math.max(start, end); value++)
      wanted.add(value);
  }
  return box.messages.filter((_, index) => wanted.has(keys[index]));
}

function fetch(
  send: (line: string) => void,
  box: FakeMailbox | undefined,
  args: string[],
  uid: boolean,
): void {
  if (!box) return;
  const range = args[0] ?? "";
  const query = args.slice(1).join(" ").toUpperCase();
  for (const message of select(box, range, uid)) {
    const seq = box.messages.indexOf(message) + 1;
    const items: string[] = [`UID ${message.uid}`];
    if (query.includes("FLAGS")) items.push(`FLAGS (${message.flags.join(" ")})`);
    if (query.includes("ENVELOPE")) items.push(`ENVELOPE ${message.envelope}`);
    if (query.includes("BODYSTRUCTURE")) items.push(`BODYSTRUCTURE ${message.bodyStructure}`);
    // Body sections are answered as literals, which is the only way a part
    // carrying newlines can travel. A fetch may ask for several at once —
    // ImapFlow asks for a part's MIME headers alongside the part itself — and
    // answering only the first leaves it waiting for bytes that never come.
    const sections = args.slice(1).join(" ").matchAll(
      /BODY(?:\.PEEK)?\[([^\]]*)\](?:<(\d+)\.\d+>)?/g,
    );
    for (const section of sections) {
      const name = section[1];
      const key = name.toUpperCase().startsWith("HEADER") ? "HEADER" : name;
      // TEXT is the body of a message with no parts to number, which is the
      // section a client asks for when BODYSTRUCTURE reports a single part.
      const fallback =
        key.toUpperCase() === "TEXT"
          ? (message.parts["1"] ?? "")
          : key.toUpperCase().endsWith(".MIME")
            ? MIME_HEADERS
            : "";
      const content = message.parts[key] ?? fallback;
      // A partial fetch is answered with the origin it asked from, which is
      // what tells the client the bytes line up with what it requested.
      const origin = section[2] === undefined ? "" : `<${section[2]}>`;
      items.push(`BODY[${name}]${origin} {${Buffer.byteLength(content)}}\r\n${content}`);
    }
    send(`* ${seq} FETCH (${items.join(" ")})`);
  }
}

function search(box: FakeMailbox | undefined, query: string): number[] {
  if (!box) return [];
  // Only what the translator actually emits: quoted terms against a field. Any
  // message whose text carries every term matches.
  const terms = [...query.matchAll(/"([^"]*)"/g)].map((match) => match[1].toLowerCase());
  if (terms.length === 0) return box.messages.map((message) => message.uid);
  const wantsAny = /\bOR\b/.test(query);
  return box.messages
    .filter((message) => {
      const text = (message.searchText ?? message.envelope).toLowerCase();
      return wantsAny ? terms.some((term) => text.includes(term)) : terms.every((term) => text.includes(term));
    })
    .map((message) => message.uid);
}

function store(box: FakeMailbox | undefined, args: string[]): void {
  if (!box) return;
  const [range, operation, ...rest] = args;
  const flags = rest.join(" ").replace(/[()]/g, "").split(" ").filter(Boolean);
  for (const message of select(box, range, true)) {
    const current = new Set(message.flags);
    for (const flag of flags)
      if (operation.toUpperCase().startsWith("-FLAGS")) current.delete(flag);
      else current.add(flag);
    message.flags = [...current];
  }
}

function move(
  box: FakeMailbox | undefined,
  target: FakeMailbox | undefined,
  range: string,
): boolean {
  if (!box || !target) return false;
  for (const message of select(box, range, true)) {
    box.messages.splice(box.messages.indexOf(message), 1);
    target.messages.push(message);
  }
  return true;
}
