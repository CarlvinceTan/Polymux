import assert from "node:assert/strict";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {
  EmailAccounts,
  type CommandResult,
  keychainService,
} from "../src/email.js";
import {mimeMessage} from "../src/email-mime.js";
import {MailStore, searchCriteria} from "../src/mail-store.js";
import {
  startImapServer,
  type FakeImapServer,
  type FakeMailbox,
  type FakeMessage,
} from "./fixtures/imap-server.js";
import {startSmtpServer, type FakeSmtpServer} from "./fixtures/smtp-server.js";

interface Call {
  command: string;
  args: string[];
  input?: string;
}

function harness(options: {
  results?: (call: Call) => CommandResult | undefined;
} = {}) {
  const calls: Call[] = [];
  const run = async (command: string, args: string[], input?: string): Promise<CommandResult> => {
    const call = {command, args, input};
    calls.push(call);
    return options.results?.(call) ?? {code: 0, stdout: "", stderr: ""};
  };
  return {calls, run};
}

async function withConfig(
  source: string,
  body: (accounts: EmailAccounts, storePath: string, harnessed: ReturnType<typeof harness>) => Promise<void>,
  results?: (call: Call) => CommandResult | undefined,
): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-email-"));
  const storePath = path.join(directory, "email-accounts.json");
  if (source) await writeFile(storePath, source, "utf8");
  const harnessed = harness({results});
  try {
    await body(
      new EmailAccounts({
        storePath,
        downloadsDir: path.join(directory, "Downloads"),
        run: harnessed.run,
      }),
      storePath,
      harnessed,
    );
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
}

/** An account file as Polymux writes it, for tests that start from one. */
const EXISTING = JSON.stringify(
  {
    version: 1,
    accounts: [
      {
        id: "work",
        email: "me@work.com",
        displayName: "Me At Work",
        isDefault: true,
        imap: {host: "imap.gmail.com", port: 993, encryption: "tls", login: "me@work.com"},
        smtp: {host: "smtp.gmail.com", port: 587, encryption: "start-tls", login: "me@work.com"},
        auth: {kind: "password"},
      },
    ],
  },
  null,
  2,
);

/** The same account, signing in with a token instead of a password. */
const OAUTH = JSON.stringify({
  version: 1,
  accounts: [
    {
      id: "work",
      email: "me@work.com",
      imap: {host: "imap.gmail.com", port: 993, encryption: "tls", login: "me@work.com"},
      smtp: {host: "smtp.gmail.com", port: 587, encryption: "start-tls", login: "me@work.com"},
      auth: {
        kind: "oauth2",
        provider: "google",
        clientId: "client-1",
        hasClientSecret: true,
      },
    },
  ],
});

async function stored(file: string): Promise<{accounts: Record<string, unknown>[]}> {
  return JSON.parse(await readFile(file, "utf8")) as {accounts: Record<string, unknown>[]};
}

const BASE = {
  email: "new@example.com",
  preset: "custom" as const,
  imapHost: "imap.example.com",
  imapPort: 993,
  imapEncryption: "tls" as const,
  smtpHost: "smtp.example.com",
  smtpPort: 587,
  smtpEncryption: "start-tls" as const,
};

test("reads accounts without exposing their secrets", async () => {
  await withConfig(EXISTING, async (accounts) => {
    const [account] = await accounts.list();
    assert.equal(account.id, "work");
    assert.equal(account.email, "me@work.com");
    assert.equal(account.displayName, "Me At Work");
    assert.equal("isDefault" in account, false);
    assert.equal(account.incoming.host, "imap.gmail.com");
    assert.equal(account.incoming.auth, "password");
    assert.equal(account.outgoing.port, 587);
    assert.equal(account.outgoing.encryption, "start-tls");
    assert.deepEqual(account.signatures, []);
    assert.equal(account.defaultSignatureId, null);
    // Nothing on the wire to the renderer carries the credential itself —
    // only whether one is held.
    assert.equal(account.secretStored, false);
    assert.equal(JSON.stringify(account).includes("hunter2"), false);
  });
});

test("persists multiple signatures and the account default", async () => {
  await withConfig(EXISTING, async (accounts, file) => {
    await accounts.saveSignatures({
      account: "work",
      signatures: [
        {id: "usual", name: "Usual", body: "Kind regards,\nCarlvince", html: "<b>Kind regards,</b><br>Carlvince"},
        {id: "short", name: "Short", body: "Thanks,\nCarlvince", html: null},
      ],
      defaultSignatureId: "usual",
    });
    const [account] = await accounts.list();
    assert.deepEqual(account.signatures.map((signature) => signature.name), ["Usual", "Short"]);
    assert.equal(account.defaultSignatureId, "usual");
    const saved = (await stored(file)).accounts[0];
    assert.deepEqual(saved.signatures, [
      {id: "usual", name: "Usual", body: "Kind regards,\nCarlvince", html: "<b>Kind regards,</b><br>Carlvince"},
      {id: "short", name: "Short", body: "Thanks,\nCarlvince", html: null},
    ]);
    assert.equal(saved.defaultSignatureId, "usual");
  });
});

test("editing mailbox connection settings keeps its signatures", async () => {
  await withConfig(EXISTING, async (accounts) => {
    await accounts.saveSignatures({
      account: "work",
      signatures: [{id: "usual", name: "Usual", body: "Best,\nCarlvince", html: null}],
      defaultSignatureId: "usual",
    });
    await accounts.save({
      ...BASE,
      id: "work",
      originalId: "work",
      email: "me@work.com",
    });
    const [account] = await accounts.list();
    assert.deepEqual(account.signatures, [{id: "usual", name: "Usual", body: "Best,\nCarlvince", html: null}]);
    assert.equal(account.defaultSignatureId, "usual");
  });
});

test("reports an oauth2 account's auth kind", async () => {
  await withConfig(OAUTH, async (accounts) => {
    const [account] = await accounts.list();
    assert.equal(account.incoming.auth, "oauth2");
    assert.equal(account.outgoing.auth, "oauth2");
  });
});

test("a new account's password goes to the keychain, never to the file", async () => {
  await withConfig("", async (accounts, file, harnessed) => {
    await accounts.save({...BASE, id: "personal", password: "hunter2"});
    const written = await readFile(file, "utf8");
    assert.equal(written.includes("hunter2"), false, "the file must never hold a secret");
    const saved = (await stored(file)).accounts[0];
    assert.equal(saved.id, "personal");
    assert.deepEqual(saved.auth, {kind: "password"});
    // The secret goes over stdin, so it never appears in the process table.
    const call = harnessed.calls.find((item) => item.command === "security");
    assert.ok(call, "the password has to reach the keychain");
    assert.equal(call.args.join(" ").includes("hunter2"), false);
    assert.match(call.input ?? "", /add-generic-password/);
    assert.match(call.input ?? "", new RegExp(keychainService("personal")));
    assert.match(call.input ?? "", /hunter2/);
  });
});

test("round-trips a saved account back through list()", async () => {
  await withConfig("", async (accounts) => {
    await accounts.save({...BASE, id: "personal", displayName: "Personal", password: "x"});
    const [account] = await accounts.list();
    assert.equal(account.id, "personal");
    assert.equal(account.displayName, "Personal");
    assert.equal(account.incoming.host, "imap.example.com");
    assert.equal(account.outgoing.host, "smtp.example.com");
  });
});

test("editing an OAuth2 account keeps the client it was registered with", async () => {
  await withConfig(OAUTH, async (accounts, file) => {
    // The settings form collects servers, not client ids — so saving one must
    // not turn a working token account into an unusable password account.
    await accounts.save({
      ...BASE,
      id: "work",
      originalId: "work",
      email: "me@work.com",
      imapHost: "imap.gmail.com",
      smtpHost: "smtp.gmail.com",
    });
    const saved = (await stored(file)).accounts[0];
    assert.deepEqual(saved.auth, {
      kind: "oauth2",
      provider: "google",
      clientId: "client-1",
      hasClientSecret: true,
    });
  });
});

test("giving an OAuth2 account a password makes it a password account", async () => {
  await withConfig(OAUTH, async (accounts, file) => {
    await accounts.save({
      ...BASE,
      id: "work",
      originalId: "work",
      email: "me@work.com",
      password: "typed-by-hand",
    });
    assert.deepEqual((await stored(file)).accounts[0].auth, {kind: "password"});
  });
});

test("moves the keychain entries when an account is renamed", async () => {
  await withConfig(
    EXISTING,
    async (accounts, file, harnessed) => {
      await accounts.save({
        ...BASE,
        id: "office",
        originalId: "work",
        email: "me@work.com",
      });
      const saved = await stored(file);
      assert.deepEqual(saved.accounts.map((item) => item.id), ["office"]);
      const inputs = harnessed.calls.map((call) => call.input ?? "").join("\n");
      // Read from the old id, written under the new one, then dropped.
      assert.match(inputs, new RegExp(`find-generic-password -s '${keychainService("work")}'`));
      assert.match(inputs, new RegExp(`add-generic-password -U -s '${keychainService("office")}'`));
      assert.match(inputs, new RegExp(`delete-generic-password -s '${keychainService("work")}'`));
    },
    (call) =>
      (call.input ?? "").startsWith("find-generic-password")
        ? {code: 0, stdout: "carried-over\n", stderr: ""}
        : undefined,
  );
});

test("drops legacy default metadata when accounts are saved", async () => {
  await withConfig(EXISTING, async (accounts, file) => {
    await accounts.save({...BASE, id: "personal", password: "x"});
    const saved = await stored(file);
    assert.equal(saved.accounts.some((item) => "isDefault" in item), false);
  });
});

test("a bare operation requires an account when several mailboxes exist", async () => {
  const configured = JSON.parse(EXISTING) as {accounts: Array<Record<string, unknown>>};
  configured.accounts.push({
    ...configured.accounts[0],
    id: "personal",
    email: "me@example.com",
  });
  await withConfig(JSON.stringify(configured), async (accounts) => {
    await assert.rejects(
      accounts.folders(),
      /More than one email account is set up\. Choose an account explicitly\./,
    );
  });
});

test("removing an account drops it and every secret filed under it", async () => {
  await withConfig(EXISTING, async (accounts, file, harnessed) => {
    await accounts.remove("work");
    assert.deepEqual((await stored(file)).accounts, []);
    const inputs = harnessed.calls.map((call) => call.input ?? "").join("\n");
    for (const kind of ["me@work.com", "me@work.com (access-token)", "me@work.com (refresh-token)"])
      assert.match(
        inputs,
        new RegExp(`delete-generic-password -s '${keychainService("work")}' -a '${kind.replace(/[()]/g, (c) => `\\${c}`)}'`),
      );
  });
});

/**
 * The outgoing message itself, built directly. Sending puts it on an SMTP
 * connection and saving a draft appends it to a folder; what both carry is
 * this, so it is tested as the document it is.
 */
const OUTGOING: {from: string; to: string[]; cc: string[]; bcc: string[]; subject: string; body: string} = {
  from: "me@work.com",
  to: ["dana@example.com"],
  cc: [],
  bcc: [],
  subject: "Friday",
  body: "Are we still on?",
};

test("writes an attachment into the message", async () => {
  const file = path.join(await mkdtemp(path.join(tmpdir(), "polymux-mime-")), "note.txt");
  await writeFile(file, "the quick brown fox", "utf8");
  const raw = mimeMessage({
    ...OUTGOING,
    attachments: [
      {name: "note.txt", mime: "text/plain", content: await readFile(file)},
    ],
  });
  assert.match(raw, /Content-Type: multipart\/mixed/);
  assert.match(raw, /Content-Disposition: attachment; filename="note.txt"/);
  assert.match(raw, new RegExp(Buffer.from("the quick brown fox").toString("base64")));
});

test("writes formatted mail as text and HTML alternatives", () => {
  const raw = mimeMessage({
    ...OUTGOING,
    html: "<div>Are we <b>still</b> on?</div>",
    attachments: [],
  });
  assert.match(raw, /Content-Type: multipart\/alternative/);
  assert.match(raw, /Content-Type: text\/plain; charset=utf-8\r?\n\r?\nAre we still on\?/);
  assert.match(raw, /Content-Type: text\/html; charset=utf-8\r?\n\r?\n<div>Are we <b>still<\/b> on\?<\/div>/);
});

test("keeps formatted alternatives together when files are attached", () => {
  const raw = mimeMessage({
    ...OUTGOING,
    html: "<b>Are we still on?</b>",
    attachments: [{name: "note.txt", mime: "text/plain", content: Buffer.from("note")}],
  });
  assert.match(raw, /Content-Type: multipart\/mixed/);
  assert.match(raw, /Content-Type: multipart\/alternative/);
  assert.match(raw, /Content-Disposition: attachment; filename="note.txt"/);
});

test("threading headers travel with a reply", () => {
  const raw = mimeMessage({
    ...OUTGOING,
    attachments: [],
    inReplyTo: "<b@example.com>",
    references: ["<a@example.com>", "<b@example.com>"],
  });
  assert.match(raw, /In-Reply-To: <b@example.com>/);
  assert.match(raw, /References: <a@example.com> <b@example.com>/);
});

test("an important message says so in both spellings clients read", () => {
  const raw = mimeMessage({...OUTGOING, attachments: [], importance: "high"});
  assert.match(raw, /^Importance: high$/m);
  assert.match(raw, /^X-Priority: 1 \(Highest\)$/m);
});

test("low priority is its own pair of headers", () => {
  const raw = mimeMessage({...OUTGOING, attachments: [], importance: "low"});
  assert.match(raw, /^Importance: low$/m);
  assert.match(raw, /^X-Priority: 5 \(Lowest\)$/m);
});

test("an ordinary message claims no priority at all", () => {
  const raw = mimeMessage({...OUTGOING, attachments: [], importance: "normal"});
  assert.equal(/Importance:/.test(raw), false);
  assert.equal(/X-Priority:/.test(raw), false);
});

test("a header cannot smuggle another header in", () => {
  const raw = mimeMessage({
    ...OUTGOING,
    subject: "Friday\r\nBcc: sneak@example.com",
    attachments: [],
  });
  assert.equal(/^Bcc:/m.test(raw), false, "a folded subject must not become a header");
  assert.match(raw, /^Subject: Friday Bcc: sneak@example.com$/m);
});

/**
 * The read paths run over a real IMAP conversation with a fake server, rather
 * than against a stubbed client. What can go wrong here is wire-level — a
 * section fetched by the wrong address, a BODYSTRUCTURE walked badly, a UID
 * range built by hand — and none of that shows up against a fake that answers
 * in JavaScript objects.
 */

const PLAIN_HEADERS = 'Content-Type: text/plain; charset="utf-8"\r\n\r\n';

function envelopeLine(options: {subject: string; from: [string, string]; to?: [string, string]; messageId?: string}): string {
  const address = ([name, mail]: [string, string]): string => {
    const [box, host] = mail.split("@");
    return `(("${name}" NIL "${box}" "${host}"))`;
  };
  const from = address(options.from);
  const to = options.to ? address(options.to) : "NIL";
  return `("Fri, 15 Aug 2026 10:00:00 +0000" "${options.subject}" ${from} ${from} ${from} ${to} NIL NIL NIL "${options.messageId ?? "<x@example.com>"}")`;
}

async function withMailbox(
  mailboxes: FakeMailbox[],
  body: (accounts: EmailAccounts, server: FakeImapServer, smtp: FakeSmtpServer) => Promise<void>,
  options: {rejectLogin?: boolean; run?: ReturnType<typeof harness>["run"]} = {},
): Promise<void> {
  const server = await startImapServer({mailboxes, rejectLogin: options.rejectLogin});
  const smtp = await startSmtpServer();
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-imap-"));
  const storePath = path.join(directory, "email-accounts.json");
  await writeFile(
    storePath,
    JSON.stringify({
      version: 1,
      accounts: [
        {
          id: "work",
          email: "me@work.com",
          imap: {host: "127.0.0.1", port: server.port, encryption: "none", login: "me@work.com"},
          smtp: {host: "127.0.0.1", port: smtp.port, encryption: "none", login: "me@work.com"},
          auth: {kind: "password"},
        },
      ],
    }),
    "utf8",
  );
  const accounts = new EmailAccounts({
    storePath,
    downloadsDir: path.join(directory, "Downloads"),
    // The password is the only secret these tests need, and it comes back the
    // way `security` prints one.
    run:
      options.run ??
      (async (command, _args, input) =>
        command === "security" && (input ?? "").startsWith("find-generic-password")
          ? {code: 0, stdout: "secret\n", stderr: ""}
          : {code: 0, stdout: "", stderr: ""}),
  });
  try {
    await body(accounts, server, smtp);
  } finally {
    await accounts.close();
    await server.close();
    await smtp.close();
    await rm(directory, {recursive: true, force: true});
  }
}

/** A message whose only body is HTML, as most mail is. */
function htmlOnly(uid: number, html: string): FakeMessage {
  return {
    uid,
    flags: ["\\Seen"],
    envelope: envelopeLine({subject: "Confirm your email", from: ["Instagram", "no-reply@mail.instagram.com"]}),
    bodyStructure: `("TEXT" "HTML" ("CHARSET" "utf-8") NIL NIL "7BIT" ${html.length} 1)`,
    parts: {"1": html, "1.MIME": PLAIN_HEADERS},
  };
}

/** The ordinary shape: a plain part and an HTML part saying the same thing. */
function alternative(uid: number, text: string, html: string): FakeMessage {
  return {
    uid,
    flags: [],
    envelope: envelopeLine({subject: "Q3 numbers", from: ["Priya", "priya@example.com"], to: ["Me", "me@work.com"]}),
    bodyStructure:
      `(("TEXT" "PLAIN" ("CHARSET" "utf-8") NIL NIL "7BIT" ${text.length} 1)` +
      `("TEXT" "HTML" ("CHARSET" "utf-8") NIL NIL "7BIT" ${html.length} 1) "ALTERNATIVE")`,
    parts: {"1": text, "2": html, "1.MIME": PLAIN_HEADERS, "2.MIME": PLAIN_HEADERS},
  };
}

test("renders an HTML-only message as readable text", async () => {
  const html = "<p>Hi carlvincetan,</p><p>Your code:848323</p><p>&copy; Instagram</p>";
  await withMailbox([{path: "INBOX", messages: [htmlOnly(7, html)]}], async (accounts) => {
    const message = await accounts.message({id: "7", account: "work", folder: "INBOX"});
    assert.equal(message.subject, "Confirm your email");
    assert.equal(message.from?.address, "no-reply@mail.instagram.com");
    assert.equal(message.body.includes("<p"), false, "tags must not reach the reader");
    assert.match(message.body, /^Hi carlvincetan,/);
    assert.match(message.body, /Your code:848323/);
  });
});

test("carries the sender's HTML alongside the text version", async () => {
  await withMailbox(
    [{path: "INBOX", messages: [alternative(7, "Plain words.", "<p>HTML <b>words</b>.</p>")]}],
    async (accounts) => {
      const message = await accounts.message({id: "7", account: "work", folder: "INBOX"});
      // The markup goes over as written: sanitising is the reader's job, and
      // half-cleaning it here would only make the reader trust it wrongly.
      assert.equal(message.html, "<p>HTML <b>words</b>.</p>");
      assert.equal(message.body, "Plain words.", "the text fallback still stands");
    },
  );
});

test("reports no HTML for a message that has none", async () => {
  const message: FakeMessage = {
    uid: 7,
    flags: [],
    envelope: envelopeLine({subject: "Just words", from: ["Priya", "priya@example.com"]}),
    bodyStructure: '("TEXT" "PLAIN" ("CHARSET" "utf-8") NIL NIL "7BIT" 11 1)',
    parts: {"1": "Just words.", "1.MIME": PLAIN_HEADERS},
  };
  await withMailbox([{path: "INBOX", messages: [message]}], async (accounts) => {
    const read = await accounts.message({id: "7", account: "work", folder: "INBOX"});
    assert.equal(read.html, null);
    assert.equal(read.body, "Just words.");
  });
});

test("leaves a plain-text body untouched, entities included", async () => {
  const body = "Columns  align:\n  a  1\n  b  2\n\nLiterally &#064; and <not a tag.";
  const message: FakeMessage = {
    uid: 7,
    flags: [],
    envelope: envelopeLine({subject: "Table", from: ["Priya", "priya@example.com"]}),
    bodyStructure: `("TEXT" "PLAIN" ("CHARSET" "utf-8") NIL NIL "7BIT" ${body.length} 1)`,
    parts: {"1": body, "1.MIME": PLAIN_HEADERS},
  };
  await withMailbox([{path: "INBOX", messages: [message]}], async (accounts) => {
    const read = await accounts.message({id: "7", account: "work", folder: "INBOX"});
    assert.equal(read.body, body);
  });
});

test("lists the files a message announces without downloading them", async () => {
  const message: FakeMessage = {
    uid: 7,
    flags: [],
    envelope: envelopeLine({subject: "Invoice", from: ["Accounts", "accounts@kinnov.com"]}),
    bodyStructure:
      '(("TEXT" "PLAIN" ("CHARSET" "utf-8") NIL NIL "7BIT" 13 1)' +
      '("APPLICATION" "PDF" ("NAME" "report.pdf") NIL NIL "BASE64" 90000 NIL ' +
      '("ATTACHMENT" ("FILENAME" "report.pdf")) NIL NIL) "MIXED")',
    parts: {"1": "See attached.", "1.MIME": PLAIN_HEADERS, "2": "%PDF-nope", "2.MIME": PLAIN_HEADERS},
  };
  await withMailbox([{path: "INBOX", messages: [message]}], async (accounts, server) => {
    const read = await accounts.message({id: "7", account: "work", folder: "INBOX"});
    assert.deepEqual(read.attachments, [{name: "report.pdf", mime: "application/pdf"}]);
    assert.equal(read.body, "See attached.");
    // The whole point of reading the structure first: the PDF is named in the
    // reader without a byte of it crossing the wire.
    const fetched = server.commands.filter((line) => /BODY\.PEEK\[2\]/.test(line));
    assert.deepEqual(fetched, [], "an attachment must not be fetched to show the body");
  });
});

test("carries the ids a reply needs to thread", async () => {
  const message: FakeMessage = {
    uid: 7,
    flags: [],
    envelope: envelopeLine({
      subject: "Re: Q3",
      from: ["Priya", "priya@example.com"],
      to: ["Me", "me@work.com"],
      messageId: "<c@example.com>",
    }),
    bodyStructure: '("TEXT" "PLAIN" ("CHARSET" "utf-8") NIL NIL "7BIT" 6 1)',
    parts: {
      "1": "Words.",
      "1.MIME": PLAIN_HEADERS,
      HEADER: "References: <a@example.com> <b@example.com>\r\nIn-Reply-To: <b@example.com>\r\n\r\n",
    },
  };
  await withMailbox([{path: "INBOX", messages: [message]}], async (accounts) => {
    const read = await accounts.message({id: "7", account: "work", folder: "INBOX"});
    assert.equal(read.messageId, "<c@example.com>");
    // In-Reply-To repeats the last reference; the chain must not double it.
    assert.deepEqual(read.references, ["<a@example.com>", "<b@example.com>"]);
  });
});

test("lists a folder newest first, and pages through the older ones", async () => {
  const messages = Array.from({length: 5}, (_, index) => ({
    ...alternative(index + 1, `Body ${index + 1}`, `<p>Body ${index + 1}</p>`),
    envelope: envelopeLine({subject: `Message ${index + 1}`, from: ["Priya", "priya@example.com"]}),
  }));
  await withMailbox([{path: "INBOX", messages}], async (accounts) => {
    const first = await accounts.envelopes({account: "work", folder: "INBOX", pageSize: 2});
    assert.deepEqual(first.map((item) => item.id), ["5", "4"]);
    const second = await accounts.envelopes({account: "work", folder: "INBOX", pageSize: 2, page: 2});
    assert.deepEqual(second.map((item) => item.id), ["3", "2"]);
  });
});

test("a folder with no search runs no SEARCH at all", async () => {
  await withMailbox(
    [{path: "INBOX", messages: [alternative(1, "a", "<p>a</p>")]}],
    async (accounts, server) => {
      await accounts.envelopes({account: "work", folder: "INBOX"});
      assert.deepEqual(
        server.commands.filter((line) => line.includes("SEARCH")),
        [],
        "the newest page is a window on the mailbox, not a question about it",
      );
    },
  );
});

test("a subject search asks the server, and only for what matched", async () => {
  const wanted = {
    ...alternative(2, "b", "<p>b</p>"),
    envelope: envelopeLine({subject: "Tax Invoice 21762", from: ["Accounts", "accounts@kinnov.com"]}),
    searchText: "tax invoice 21762",
  };
  const other = {
    ...alternative(1, "a", "<p>a</p>"),
    envelope: envelopeLine({subject: "Lunch", from: ["Priya", "priya@example.com"]}),
    searchText: "lunch",
  };
  await withMailbox([{path: "INBOX", messages: [other, wanted]}], async (accounts, server) => {
    const found = await accounts.envelopes({
      account: "work",
      folder: "INBOX",
      query: 'subject "Tax Invoice 21762"',
    });
    assert.deepEqual(found.map((item) => item.id), ["2"]);
    assert.ok(
      server.commands.some((line) => /SEARCH.*SUBJECT/i.test(line)),
      "a field query has to reach the server as a field search",
    );
  });
});

test("flags, moves and deletes reach the server by uid", async () => {
  const inbox: FakeMailbox = {path: "INBOX", messages: [alternative(7, "a", "<p>a</p>")]};
  const trash: FakeMailbox = {path: "Trash", specialUse: "\\Trash", messages: []};
  await withMailbox([inbox, trash], async (accounts, server) => {
    await accounts.flag({ids: ["7"], flag: "seen", on: true, account: "work", folder: "INBOX"});
    assert.deepEqual(server.mailbox("INBOX")?.messages[0]?.flags, ["\\Seen"]);
    await accounts.flag({ids: ["7"], flag: "seen", on: false, account: "work", folder: "INBOX"});
    assert.deepEqual(server.mailbox("INBOX")?.messages[0]?.flags, []);
    await accounts.move({ids: ["7"], target: "Trash", account: "work", folder: "INBOX"});
    assert.equal(server.mailbox("INBOX")?.messages.length, 0);
    assert.equal(server.mailbox("Trash")?.messages.length, 1);
  });
});

test("folders are classified by the special-use flags the server reports", async () => {
  await withMailbox(
    [
      {path: "INBOX", messages: []},
      {path: "[Gmail]/Spam", specialUse: "\\Junk", messages: []},
      {path: "[Gmail]/Sent Mail", specialUse: "\\Sent", messages: []},
      {path: "Receipts", messages: []},
    ],
    async (accounts) => {
      const folders = await accounts.folders("work");
      // The inbox leads and the rest are alphabetical: the order the client
      // library settles on, which the folder list shows as it comes.
      assert.deepEqual(
        folders.map((folder) => [folder.name, folder.role, folder.label]),
        [
          ["INBOX", "inbox", "Inbox"],
          ["[Gmail]/Sent Mail", "sent", "Sent Mail"],
          ["[Gmail]/Spam", "junk", "Spam"],
          ["Receipts", "other", "Receipts"],
        ],
      );
    },
  );
});

test("one connection serves every message opened after it", async () => {
  const messages = Array.from({length: 3}, (_, index) => alternative(index + 1, `b${index}`, `<p>b${index}</p>`));
  await withMailbox([{path: "INBOX", messages}], async (accounts, server) => {
    for (const message of messages)
      await accounts.message({id: String(message.uid), account: "work", folder: "INBOX"});
    // The whole reason for this module: the login is paid once, not per read.
    assert.equal(
      server.commands.filter((line) => line.startsWith("LOGIN")).length,
      1,
      "every message after the first must reuse the open connection",
    );
  });
});

test("a failed login is reported rather than cached as a broken account", async () => {
  await withMailbox(
    [{path: "INBOX", messages: []}],
    async (accounts) => {
      const tested = await accounts.test("work");
      assert.equal(tested.status, "error");
      assert.match(tested.error ?? "", /Invalid credentials/);
      // A second attempt must reach the server again: caching the failure
      // would leave the account broken until the app restarts.
      const again = await accounts.test("work");
      assert.equal(again.status, "error");
    },
    {rejectLogin: true},
  );
});

test("an ImapFlow OAuth rejection refreshes the access token and reconnects", async () => {
  const server = await startImapServer({
    mailboxes: [{path: "INBOX", messages: []}],
    oauthAccessToken: "fresh-access",
  });
  let accessToken = "expired-access";
  let renewals = 0;
  const store = new MailStore({
    credentials: async () => ({
      host: "127.0.0.1",
      port: server.port,
      encryption: "none",
      login: "me@example.com",
      kind: "oauth2",
      secret: accessToken,
    }),
    renew: async () => {
      renewals += 1;
      accessToken = "fresh-access";
    },
  });
  try {
    assert.deepEqual(await store.folders("work"), [
      {name: "INBOX", label: "Inbox", role: "inbox"},
    ]);
    assert.equal(renewals, 1);
    assert.equal(
      server.commands.filter((line) => line.startsWith("AUTHENTICATE OAUTHBEARER")).length,
      2,
    );
  } finally {
    await store.close();
    await server.close();
  }
});

test("a failed OAuth refresh surfaces the provider error", async () => {
  const server = await startImapServer({
    mailboxes: [{path: "INBOX", messages: []}],
    oauthAccessToken: "fresh-access",
  });
  const store = new MailStore({
    credentials: async () => ({
      host: "127.0.0.1",
      port: server.port,
      encryption: "none",
      login: "me@example.com",
      kind: "oauth2",
      secret: "expired-access",
    }),
    renew: async () => {
      throw new Error("The refresh token was revoked; sign in again.");
    },
  });
  try {
    await assert.rejects(
      store.folders("work"),
      /refresh token was revoked; sign in again/i,
    );
  } finally {
    await store.close();
    await server.close();
  }
});

test("a passing connection test clears the error", async () => {
  await withMailbox([{path: "INBOX", messages: []}], async (accounts) => {
    const tested = await accounts.test("work");
    assert.equal(tested.status, "ok");
    assert.equal(tested.error, null);
  });
});

test("two reads at once queue down the one connection", async () => {
  const messages = Array.from({length: 4}, (_, index) => alternative(index + 1, `b${index}`, `<p>b${index}</p>`));
  await withMailbox([{path: "INBOX", messages}], async (accounts) => {
    // IMAP carries one command at a time; without a queue the second of these
    // interleaves with the first and the library rejects it.
    const read = await Promise.all(
      messages.map((message) =>
        accounts.message({id: String(message.uid), account: "work", folder: "INBOX"}),
      ),
    );
    assert.deepEqual(read.map((item) => item.id), ["1", "2", "3", "4"]);
  });
});

/**
 * Answers the two requests the OAuth library makes: the provider's discovery
 * document, then the token exchange. Faking at this level keeps the real
 * library in the path — the part worth testing is that a rotated refresh token
 * is stored, and that a refusal reaches the user in the provider's own words.
 */
function fakeProvider(token: (body: string) => Response): typeof fetch {
  return (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/.well-known/openid-configuration"))
      return new Response(
        JSON.stringify({
          issuer: "https://accounts.google.com",
          authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
          token_endpoint: "https://oauth2.googleapis.com/token",
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
        }),
        {status: 200, headers: {"content-type": "application/json"}},
      );
    // The library may hand the body over as a string, as URLSearchParams, or
    // inside a Request; the test cares about what was actually sent, so all
    // three are read the same way.
    const body =
      typeof init?.body === "string"
        ? init.body
        : init?.body instanceof URLSearchParams
          ? init.body.toString()
          : input instanceof Request
            ? await input.clone().text()
            : init?.body
              ? String(init.body)
              : "";
    return token(body);
  }) as unknown as typeof fetch;
}

test("an expired token is renewed against the provider, and the new one stored", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-oauth-"));
  const storePath = path.join(directory, "email-accounts.json");
  await writeFile(storePath, OAUTH, "utf8");
  const written: string[] = [];
  let sent = "";
  const accounts = new EmailAccounts({
    storePath,
    downloadsDir: path.join(directory, "Downloads"),
    run: async (_command, _args, input) => {
      const text = input ?? "";
      if (text.startsWith("add-generic-password")) written.push(text);
      // No access token is held; the refresh token and client secret are.
      if (text.startsWith("find-generic-password") && text.includes("(refresh-token)"))
        return {code: 0, stdout: "the-refresh-token\n", stderr: ""};
      if (text.startsWith("find-generic-password") && text.includes("(client-secret)"))
        return {code: 0, stdout: "shh\n", stderr: ""};
      if (text.startsWith("find-generic-password")) return {code: 1, stdout: "", stderr: ""};
      return {code: 0, stdout: "", stderr: ""};
    },
    fetch: fakeProvider((body) => {
      sent = body;
      return new Response(
        JSON.stringify({
          access_token: "fresh-access",
          refresh_token: "rotated",
          token_type: "Bearer",
          expires_in: 3599,
        }),
        {status: 200, headers: {"content-type": "application/json"}},
      );
    }),
  });
  // Any operation needing the mailbox resolves the credential, which is what
  // triggers the exchange. It fails to connect afterwards — there is no server
  // — and that is not what is being tested.
  await accounts.folders("work").catch((): undefined => undefined);
  assert.match(sent, /grant_type=refresh_token/);
  assert.match(sent, /refresh_token=the-refresh-token/);
  // A rotated refresh token must be kept, or the account can never renew again.
  assert.ok(written.some((line) => line.includes("(refresh-token)") && line.includes("rotated")));
  assert.ok(written.some((line) => line.includes("(access-token)") && line.includes("fresh-access")));
  await accounts.close();
  await rm(directory, {recursive: true, force: true});
});

test("a refusal from the provider is reported in its own words", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-oauth-"));
  const storePath = path.join(directory, "email-accounts.json");
  await writeFile(storePath, OAUTH, "utf8");
  const accounts = new EmailAccounts({
    storePath,
    downloadsDir: path.join(directory, "Downloads"),
    run: async (_command, _args, input) =>
      (input ?? "").includes("(refresh-token)")
        ? {code: 0, stdout: "stale\n", stderr: ""}
        : {code: 1, stdout: "", stderr: ""},
    fetch: fakeProvider(
      () =>
        new Response(
          JSON.stringify({
            error: "invalid_grant",
            error_description: "Token has been expired or revoked.",
          }),
          {status: 400, headers: {"content-type": "application/json"}},
        ),
    ),
  });
  const tested = await accounts.test("work");
  assert.equal(tested.status, "error");
  assert.match(tested.error ?? "", /invalid_grant|expired or revoked/i);
  await accounts.close();
  await rm(directory, {recursive: true, force: true});
});

test("a draft is appended to the mailbox's own Drafts folder", async () => {
  const drafts: FakeMailbox = {path: "[Gmail]/Drafts", specialUse: "\\Drafts", messages: []};
  await withMailbox([{path: "INBOX", messages: []}, drafts], async (accounts, server) => {
    const result = await accounts.send({
      account: "work",
      from: "me@work.com",
      to: ["dana@example.com"],
      cc: [],
      bcc: [],
      subject: "Friday",
      body: "Are we still on?",
      draft: true,
    });
    assert.deepEqual(result, {draft: {id: '1', folder: '[Gmail]/Drafts'}});
    // Named from the server's own special-use flag, not guessed from "Drafts".
    const appended = server.commands.find((line) => line.startsWith("APPEND"));
    assert.ok(appended, "the draft should be appended over IMAP");
    // Named from the server's own special-use flag rather than guessed.
    assert.match(appended, /\[Gmail\]\/Drafts/);
    assert.match(appended, /\\Draft/);
    // And the message itself actually landed there, headers and all.
    const saved = server.mailbox("[Gmail]/Drafts")?.messages ?? [];
    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0]?.flags, ["\\Draft"]);
    assert.match(saved[0]?.parts["1"] ?? "", /^Subject: Friday$/m);
    assert.match(saved[0]?.parts["1"] ?? "", /^To: dana@example\.com$/m);
    assert.match(saved[0]?.parts["1"] ?? "", /Are we still on\?/);
  });
});

test("attachments are saved next to each other rather than over each other", async () => {
  const message: FakeMessage = {
    uid: 7,
    flags: [],
    envelope: envelopeLine({subject: "Invoices", from: ["Accounts", "accounts@kinnov.com"]}),
    bodyStructure:
      '(("TEXT" "PLAIN" ("CHARSET" "utf-8") NIL NIL "7BIT" 13 1)' +
      '("APPLICATION" "PDF" ("NAME" "report.pdf") NIL NIL "7BIT" 9 NIL ' +
      '("ATTACHMENT" ("FILENAME" "report.pdf")) NIL NIL)' +
      '("APPLICATION" "PDF" ("NAME" "report.pdf") NIL NIL "7BIT" 9 NIL ' +
      '("ATTACHMENT" ("FILENAME" "report.pdf")) NIL NIL) "MIXED")',
    parts: {
      "1": "See attached.",
      "1.MIME": PLAIN_HEADERS,
      "2": "first-pdf",
      "2.MIME": PLAIN_HEADERS,
      "3": "second-pdf",
      "3.MIME": PLAIN_HEADERS,
    },
  };
  await withMailbox([{path: "INBOX", messages: [message]}], async (accounts) => {
    const paths = await accounts.download({id: "7", account: "work", folder: "INBOX"});
    assert.equal(paths.length, 2);
    assert.match(paths[0], /report\.pdf$/);
    assert.match(paths[1], /report \(1\)\.pdf$/, "two files of one name must both survive");
    assert.equal(await readFile(paths[0], "utf8"), "first-pdf");
    assert.equal(await readFile(paths[1], "utf8"), "second-pdf");
  });
});

test("an attachment cannot write outside the downloads directory", async () => {
  const message: FakeMessage = {
    uid: 7,
    flags: [],
    envelope: envelopeLine({subject: "Nice try", from: ["Someone", "someone@example.com"]}),
    bodyStructure:
      '(("TEXT" "PLAIN" ("CHARSET" "utf-8") NIL NIL "7BIT" 3 1)' +
      '("APPLICATION" "OCTET-STREAM" ("NAME" "x") NIL NIL "7BIT" 3 NIL ' +
      '("ATTACHMENT" ("FILENAME" "../../escaped.txt")) NIL NIL) "MIXED")',
    parts: {"1": "hi", "1.MIME": PLAIN_HEADERS, "2": "no", "2.MIME": PLAIN_HEADERS},
  };
  await withMailbox([{path: "INBOX", messages: [message]}], async (accounts) => {
    const [written] = await accounts.download({id: "7", account: "work", folder: "INBOX"});
    assert.match(written, /Downloads\/escaped\.txt$/);
    assert.equal(written.includes(".."), false, "a filename is not a path");
  });
});

test("a query understands dates and flags, not just fields", () => {
  // IMAP refuses the words a person types; `since` has to arrive as a Date.
  const since = searchCriteria('from alice@example.com since 1-Aug-2026') as Record<string, unknown>;
  assert.equal(since.from, "alice@example.com");
  assert.ok(since.since instanceof Date, "a date bound must survive as a date");
  assert.equal((since.since as Date).getUTCFullYear(), 2026);
  assert.deepEqual(searchCriteria("flag unread"), {unseen: true});
  assert.deepEqual(searchCriteria("flag starred"), {flagged: true});
  // A term the server cannot use is dropped rather than sent as nonsense.
  assert.deepEqual(searchCriteria("since not-a-date"), {
    or: [{subject: "since not-a-date"}, {from: "since not-a-date"}, {body: "since not-a-date"}],
  });
});

test("`or` inside a quoted phrase is part of the phrase", () => {
  // Read off the raw string, this became a disjunction of unrelated terms.
  assert.deepEqual(searchCriteria('subject "cats or dogs" from alice'), {
    subject: "cats or dogs",
    from: "alice",
  });
  assert.deepEqual(searchCriteria("subject invoice or from alice"), {
    or: [{subject: "invoice"}, {from: "alice"}],
  });
});

test("two terms on one field are both kept", () => {
  // Merged into one object, the second silently replaced the first.
  assert.deepEqual(searchCriteria("from alice from bob"), {
    from: "alice",
    and: [{from: "bob"}],
  });
});

test("a grouped field disjunction stays bounded by its date and other fields", () => {
  const criteria = searchCriteria(
    "since 1-Jan-2025 subject (assessment OR interview OR offer OR rejection)",
  ) as Record<string, unknown>;
  assert.ok(criteria.since instanceof Date);
  assert.deepEqual(criteria.or, [
    {subject: "assessment"},
    {subject: "interview"},
    {subject: "offer"},
    {subject: "rejection"},
  ]);
  assert.deepEqual(searchCriteria("from (nus.edu.sg OR mom.gov.sg OR ica.gov.sg)"), {
    or: [{from: "nus.edu.sg"}, {from: "mom.gov.sg"}, {from: "ica.gov.sg"}],
  });
  const natural = searchCriteria(
    "since 21-Aug-2026 (NUS OR National University of Singapore)",
  ) as Record<string, unknown>;
  assert.ok(natural.since instanceof Date);
  assert.deepEqual(natural.or, [
    {subject: "NUS"}, {from: "NUS"}, {body: "NUS"},
    {subject: "National University of Singapore"},
    {from: "National University of Singapore"},
    {body: "National University of Singapore"},
  ]);
});

test("a sent message does not carry its Bcc, a draft does", () => {
  const options = {...OUTGOING, bcc: ["quiet@example.com"], attachments: [] as never[]};
  // The envelope carries blind recipients; a Bcc header in the body is
  // delivered to everyone, which is the one thing blind copying prevents.
  assert.equal(/^Bcc:/m.test(mimeMessage(options)), false);
  // A draft is the opposite: the header is the only record of the choice, and
  // coming back to the draft must not have lost it.
  assert.match(mimeMessage({...options, retainBcc: true}), /^Bcc: quiet@example\.com$/m);
});

test("every outgoing message carries a Message-ID of our own", () => {
  const raw = mimeMessage({...OUTGOING, attachments: []});
  assert.match(raw, /^Message-ID: <[^@]+@work\.com>$/m);
});

test("a Sent copy is filed when the provider files none", async () => {
  const sent: FakeMailbox = {path: "[Gmail]/Sent Mail", specialUse: "\\Sent", messages: []};
  await withMailbox([{path: "INBOX", messages: []}, sent], async (accounts, server, smtp) => {
    await accounts.send({
      account: "work",
      from: "me@work.com",
      to: ["dana@example.com"],
      cc: [],
      bcc: ["quiet@example.com"],
      subject: "Friday",
      body: "Are we still on?",
    });
    // Delivered, and the blind recipient is in the envelope where it belongs.
    assert.equal(smtp.messages.length, 1);
    assert.deepEqual(smtp.recipients, ["dana@example.com", "quiet@example.com"]);
    assert.equal(/^Bcc:/m.test(smtp.messages[0]), false, "a Bcc header would reach everyone");
    // Sent is asked before anything is written to it — that question is what
    // stops a duplicate on a provider that files its own copy.
    assert.ok(server.commands.some((line) => /SEARCH HEADER MESSAGE-ID/i.test(line)));
    assert.equal(server.mailbox("[Gmail]/Sent Mail")?.messages.length, 1);
  });
});

test("a provider that files its own copy is not given a second", async () => {
  const sent: FakeMailbox = {path: "[Gmail]/Sent Mail", specialUse: "\\Sent", messages: []};
  await withMailbox([{path: "INBOX", messages: []}, sent], async (accounts, server, smtp) => {
    // Stand in for Gmail: the moment the message is accepted for delivery, a
    // copy appears in Sent carrying the same Message-ID.
    const box = server.mailbox("[Gmail]/Sent Mail");
    const original = smtp.messages;
    const watch = setInterval(() => {
      const raw = original[0];
      if (!raw || box?.messages.length) return;
      box?.messages.push({
        uid: 1,
        flags: ["\\Seen"],
        envelope: envelopeLine({subject: "Friday", from: ["Me", "me@work.com"]}),
        bodyStructure: '("TEXT" "PLAIN" ("CHARSET" "utf-8") NIL NIL "7BIT" 5 1)',
        parts: {"1": raw},
        searchText: raw.toLowerCase(),
      });
    }, 10);
    try {
      await accounts.send({
        account: "work",
        from: "me@work.com",
        to: ["dana@example.com"],
        cc: [],
        bcc: [],
        subject: "Friday",
        body: "Are we still on?",
      });
    } finally {
      clearInterval(watch);
    }
    assert.equal(box?.messages.length, 1, "the provider's own copy must not be doubled");
    assert.equal(
      server.commands.some((line) => line.startsWith("APPEND")),
      false,
      "nothing should be appended once the copy is found",
    );
  });
});

test("what the first send discovered is not asked again", async () => {
  const sent: FakeMailbox = {path: "[Gmail]/Sent Mail", specialUse: "\\Sent", messages: []};
  await withMailbox([{path: "INBOX", messages: []}, sent], async (accounts, server) => {
    const message = {
      account: "work",
      from: "me@work.com",
      to: ["dana@example.com"],
      cc: [] as string[],
      bcc: [] as string[],
      subject: "Friday",
      body: "Are we still on?",
    };
    await accounts.send(message);
    const afterFirst = server.commands.filter((line) => /SEARCH HEADER MESSAGE-ID/i.test(line)).length;
    assert.ok(afterFirst > 0, "the first send has to find out");
    await accounts.send(message);
    const afterSecond = server.commands.filter((line) => /SEARCH HEADER MESSAGE-ID/i.test(line)).length;
    // Whether a provider files its own copy belongs to the account, not the
    // message, so the second send acts on the answer rather than re-asking.
    assert.equal(afterSecond, afterFirst, "the question should be asked once");
    assert.equal(server.mailbox("[Gmail]/Sent Mail")?.messages.length, 2);
  });
});

test("a provider set up as Other keeps the ports only it needs", async () => {
  await withConfig("", async (accounts, file) => {
    // "Other" collects hostnames and nothing else, and its generic SMTP
    // default is 587/STARTTLS — which Lark's listener does not complete. The
    // host is what says otherwise.
    await accounts.save({
      ...BASE,
      id: "team",
      email: "team@lightrig.co",
      preset: "custom",
      imapHost: "imap.larksuite.com",
      smtpHost: "smtp.larksuite.com",
      password: "x",
    });
    const saved = (await stored(file)).accounts[0] as {smtp: {port: number; encryption: string}};
    assert.equal(saved.smtp.port, 465);
    assert.equal(saved.smtp.encryption, "tls");
  });
});

test("an unknown host keeps the settings it was given", async () => {
  await withConfig("", async (accounts, file) => {
    await accounts.save({
      ...BASE,
      id: "other",
      email: "me@example.com",
      preset: "custom",
      imapHost: "imap.example.com",
      smtpHost: "smtp.example.com",
      password: "x",
    });
    const saved = (await stored(file)).accounts[0] as {smtp: {port: number; encryption: string}};
    assert.equal(saved.smtp.port, 587);
    assert.equal(saved.smtp.encryption, "start-tls");
  });
});
