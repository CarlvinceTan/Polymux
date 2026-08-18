import assert from "node:assert/strict";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {parse as parseToml} from "smol-toml";
import {
  EmailAccounts,
  type CommandResult,
  keychainService,
  searchQuery,
} from "../src/email.js";

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
  body: (accounts: EmailAccounts, configPath: string, harnessed: ReturnType<typeof harness>) => Promise<void>,
  results?: (call: Call) => CommandResult | undefined,
): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), "flareai-email-"));
  const configPath = path.join(directory, "config.toml");
  if (source) await writeFile(configPath, source, "utf8");
  const harnessed = harness({results});
  try {
    await body(new EmailAccounts({configPath, run: harnessed.run}), configPath, harnessed);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
}

const EXISTING = `[accounts.work]
email = "me@work.com"
display-name = "Me At Work"
default = true
folder.alias.sent = "[Gmail]/Sent Mail"
backend.type = "imap"
backend.host = "imap.gmail.com"
backend.port = 993
backend.encryption.type = "tls"
backend.login = "me@work.com"
backend.auth.type = "password"
backend.auth.raw = "inline-secret"
message.send.backend.type = "smtp"
message.send.backend.host = "smtp.gmail.com"
message.send.backend.port = 587
message.send.backend.encryption.type = "start-tls"
message.send.backend.login = "me@work.com"
message.send.backend.auth.type = "password"
message.send.backend.auth.raw = "inline-secret"
`;

test("reads accounts without exposing their secrets", async () => {
  await withConfig(EXISTING, async (accounts) => {
    const list = await accounts.list();
    assert.equal(list.length, 1);
    const [account] = list;
    assert.equal(account.id, "work");
    assert.equal(account.email, "me@work.com");
    assert.equal(account.displayName, "Me At Work");
    assert.equal(account.isDefault, true);
    assert.equal(account.incoming.kind, "imap");
    assert.equal(account.incoming.host, "imap.gmail.com");
    assert.equal(account.incoming.port, 993);
    assert.equal(account.incoming.encryption, "tls");
    assert.equal(account.incoming.auth, "password");
    assert.equal(account.outgoing.kind, "smtp");
    assert.equal(account.outgoing.port, 587);
    assert.equal(account.outgoing.encryption, "start-tls");
    // A hand-written inline password is not one we hold.
    assert.equal(account.secretStored, false);
    assert.equal(
      JSON.stringify(account).includes("inline-secret"),
      false,
      "account DTOs must never carry the mailbox password",
    );
  });
});

test("reports an oauth2 account's auth kind", async () => {
  const source = `[accounts.oauth]
email = "me@corp.com"
backend.type = "imap"
backend.host = "imap.corp.com"
backend.port = 993
backend.encryption.type = "tls"
backend.login = "me@corp.com"
backend.auth.type = "oauth2"
backend.auth.method = "xoauth2"
backend.auth.access-token.cmd = "print-token"
`;
  await withConfig(source, async (accounts) => {
    const [account] = await accounts.list();
    assert.equal(account.incoming.auth, "oauth2");
  });
});

test("writes a new account that reads its password from the keychain", async () => {
  await withConfig("", async (accounts, configPath, harnessed) => {
    await accounts.save({
      id: "personal",
      email: "me@example.com",
      displayName: "Me",
      preset: "gmail",
      imapHost: "imap.gmail.com",
      imapPort: 993,
      imapEncryption: "tls",
      smtpHost: "smtp.gmail.com",
      smtpPort: 587,
      smtpEncryption: "start-tls",
      password: "app-password",
      isDefault: true,
    });

    const written = parseToml(await readFile(configPath, "utf8")) as Record<string, any>;
    const account = written.accounts.personal;
    assert.equal(account.email, "me@example.com");
    assert.equal(account["display-name"], "Me");
    assert.equal(account.default, true);
    assert.equal(account.backend.host, "imap.gmail.com");
    assert.equal(account.backend.encryption.type, "tls");
    assert.equal(account.message.send.backend.port, 587);
    assert.match(account.backend.auth.cmd, /^security find-generic-password /);
    assert.match(account.backend.auth.cmd, /FlareAI Email: personal/);
    assert.equal(
      (await readFile(configPath, "utf8")).includes("app-password"),
      false,
      "the password must never be written into the config file",
    );

    const keychainCall = harnessed.calls.find((call) => call.command === "security");
    assert.ok(keychainCall, "expected the password to be stored in the keychain");
    assert.deepEqual(keychainCall.args, ["-i"]);
    assert.match(keychainCall.input ?? "", /^add-generic-password -U /);
    assert.match(keychainCall.input ?? "", /"app-password"/);
    assert.equal(
      harnessed.calls.some((call) => call.args.includes("app-password")),
      false,
      "the password must never appear in a process argument",
    );
  });
});

test("round-trips a saved account back through list()", async () => {
  await withConfig("", async (accounts) => {
    await accounts.save({
      id: "personal",
      email: "me@example.com",
      preset: "custom",
      imapHost: "imap.example.com",
      imapPort: 993,
      imapEncryption: "tls",
      smtpHost: "smtp.example.com",
      smtpPort: 465,
      smtpEncryption: "tls",
      password: "secret",
    });
    const [account] = await accounts.list();
    assert.equal(account.id, "personal");
    assert.equal(account.secretStored, true);
    assert.equal(account.incoming.auth, "command");
    assert.equal(account.outgoing.port, 465);
  });
});

test("preserves hand-written keys the settings form does not own", async () => {
  await withConfig(EXISTING, async (accounts, configPath) => {
    await accounts.save({
      originalId: "work",
      id: "work",
      email: "me@work.com",
      preset: "gmail",
      imapHost: "imap.gmail.com",
      imapPort: 993,
      imapEncryption: "tls",
      smtpHost: "smtp.gmail.com",
      smtpPort: 587,
      smtpEncryption: "start-tls",
      password: "new-password",
    });
    const written = parseToml(await readFile(configPath, "utf8")) as Record<string, any>;
    assert.equal(
      written.accounts.work.folder.alias.sent,
      "[Gmail]/Sent Mail",
      "folder aliases set by hand must survive a re-save",
    );
    // The inline password was replaced by a keychain lookup.
    assert.equal(written.accounts.work.backend.auth.raw, undefined);
    assert.match(written.accounts.work.backend.auth.cmd, /find-generic-password/);
  });
});

test("editing an OAuth2 account leaves its auth block intact", async () => {
  const source = `[accounts.corp]
email = "me@corp.com"
backend.type = "imap"
backend.host = "imap.corp.com"
backend.port = 993
backend.encryption.type = "tls"
backend.login = "me@corp.com"
backend.auth.type = "oauth2"
backend.auth.method = "xoauth2"
backend.auth.client-id = "client-123"
backend.auth.auth-url = "https://accounts.example.com/authorize"
backend.auth.token-url = "https://accounts.example.com/token"
backend.auth.scope = "https://mail.example.com/"
backend.auth.access-token.cmd = "print-token"
message.send.backend.type = "smtp"
message.send.backend.host = "smtp.corp.com"
message.send.backend.port = 587
message.send.backend.encryption.type = "start-tls"
message.send.backend.login = "me@corp.com"
message.send.backend.auth.type = "oauth2"
message.send.backend.auth.method = "xoauth2"
message.send.backend.auth.client-id = "client-123"
message.send.backend.auth.access-token.cmd = "print-token"
`;
  await withConfig(source, async (accounts, configPath) => {
    // Changing only the port must not cost the account its credentials: the
    // form never collects a client id, so rewriting auth would break it.
    await accounts.save({
      originalId: "corp",
      id: "corp",
      email: "me@corp.com",
      preset: "custom",
      imapHost: "imap.corp.com",
      imapPort: 993,
      imapEncryption: "tls",
      smtpHost: "smtp.corp.com",
      smtpPort: 465,
      smtpEncryption: "tls",
    });
    const written = parseToml(await readFile(configPath, "utf8")) as Record<string, any>;
    assert.equal(written.accounts.corp.backend.auth.type, "oauth2");
    assert.equal(written.accounts.corp.backend.auth["client-id"], "client-123");
    assert.equal(written.accounts.corp.backend.auth["access-token"].cmd, "print-token");
    assert.equal(written.accounts.corp.message.send.backend.auth.type, "oauth2");
    // The server change the user actually asked for still landed.
    assert.equal(written.accounts.corp.message.send.backend.port, 465);
  });
});

test("a credential command is written as Himalaya's password-plus-cmd pair", async () => {
  await withConfig("", async (accounts, configPath, harnessed) => {
    await accounts.save({
      id: "cmd",
      email: "me@example.com",
      preset: "custom",
      imapHost: "imap.example.com",
      imapPort: 993,
      imapEncryption: "tls",
      smtpHost: "smtp.example.com",
      smtpPort: 465,
      smtpEncryption: "tls",
      tokenCommand: "print-my-secret",
    });
    const written = parseToml(await readFile(configPath, "utf8")) as Record<string, any>;
    // `oauth2` would require a client id and scope this form never collects.
    assert.equal(written.accounts.cmd.backend.auth.type, "password");
    assert.equal(written.accounts.cmd.backend.auth.cmd, "print-my-secret");
    assert.equal(written.accounts.cmd.message.send.backend.auth.cmd, "print-my-secret");
    assert.equal(
      harnessed.calls.some((call) => call.command === "security"),
      false,
      "a credential command needs no keychain entry of its own",
    );
  });
});

test("re-saving a keychain account without a new password keeps its lookup", async () => {
  await withConfig("", async (accounts, configPath) => {
    const base = {
      id: "keep",
      email: "me@example.com",
      preset: "custom" as const,
      imapHost: "imap.example.com",
      imapPort: 993,
      imapEncryption: "tls" as const,
      smtpHost: "smtp.example.com",
      smtpPort: 587,
      smtpEncryption: "start-tls" as const,
    };
    await accounts.save({...base, password: "secret"});
    await accounts.save({...base, originalId: "keep", smtpPort: 465, smtpEncryption: "tls"});
    const written = parseToml(await readFile(configPath, "utf8")) as Record<string, any>;
    assert.match(written.accounts.keep.backend.auth.cmd, /FlareAI Email: keep/);
    assert.equal(written.accounts.keep.message.send.backend.port, 465);
  });
});

test("moves the keychain entry when an account is renamed", async () => {
  await withConfig(
    "",
    async (accounts, configPath, harnessed) => {
      await accounts.save({
        id: "old",
        email: "me@example.com",
        preset: "custom",
        imapHost: "imap.example.com",
        imapPort: 993,
        imapEncryption: "tls",
        smtpHost: "smtp.example.com",
        smtpPort: 465,
        smtpEncryption: "tls",
        password: "secret",
      });
      harnessed.calls.length = 0;
      await accounts.save({
        originalId: "old",
        id: "new",
        email: "me@example.com",
        preset: "custom",
        imapHost: "imap.example.com",
        imapPort: 993,
        imapEncryption: "tls",
        smtpHost: "smtp.example.com",
        smtpPort: 465,
        smtpEncryption: "tls",
      });

      const written = parseToml(await readFile(configPath, "utf8")) as Record<string, any>;
      assert.equal(written.accounts.old, undefined);
      assert.match(written.accounts.new.backend.auth.cmd, /FlareAI Email: new/);

      const inputs = harnessed.calls.map((call) => call.input ?? "").join("\n");
      assert.match(inputs, /find-generic-password -s "FlareAI Email: old"/);
      assert.match(inputs, /add-generic-password -U -s "FlareAI Email: new"/);
      assert.match(inputs, /delete-generic-password -s "FlareAI Email: old"/);
    },
    (call) =>
      call.input?.startsWith("find-generic-password")
        ? {code: 0, stdout: "secret\n", stderr: ""}
        : undefined,
  );
});

test("keeps exactly one default account", async () => {
  await withConfig(EXISTING, async (accounts, configPath) => {
    await accounts.save({
      id: "second",
      email: "me@other.com",
      preset: "custom",
      imapHost: "imap.other.com",
      imapPort: 993,
      imapEncryption: "tls",
      smtpHost: "smtp.other.com",
      smtpPort: 587,
      smtpEncryption: "start-tls",
      isDefault: true,
    });
    const written = parseToml(await readFile(configPath, "utf8")) as Record<string, any>;
    assert.equal(written.accounts.second.default, true);
    assert.equal(written.accounts.work.default, undefined);
  });
});

test("removing an account drops its table and its keychain entry", async () => {
  await withConfig(EXISTING, async (accounts, configPath, harnessed) => {
    await accounts.remove("work");
    const written = parseToml(await readFile(configPath, "utf8")) as Record<string, any>;
    assert.deepEqual(written.accounts, {});
    assert.match(
      harnessed.calls.map((call) => call.input ?? "").join("\n"),
      new RegExp(`delete-generic-password -s "${keychainService("work")}"`),
    );
  });
});

/** Wraps a rendered body in the header block Himalaya prints before it. */
function readResult(body: string): (call: Call) => CommandResult | undefined {
  const rendered = [
    "From: Instagram <no-reply@mail.instagram.com>",
    "To: Carl <me@work.com>",
    "Subject: Confirm your email",
    "Date: Fri, 15 Aug 2026 10:00:00 +0000",
    "",
    body,
  ].join("\n");
  return (call) =>
    call.args.includes("read") ? {code: 0, stdout: JSON.stringify(rendered), stderr: ""} : undefined;
}

test("renders an HTML-only message as readable text", async () => {
  const body = [
    "<#part type=text/html>",
    '<img height="33" src="https://static.example.com/logo.png" style="border:0;" />',
    "<p>Hi carlvincetan,</p>",
    "<p>You recently added carlvincetan@gmail.com to your Instagram profile.<br>Please confirm this email address. Your code:848323</p>",
    "<p>This message was sent to carlvincetan&#064;gmail.com. &copy; Instagram</p>",
    "<#/part>",
  ].join("\n");
  await withConfig(
    EXISTING,
    async (accounts) => {
      const message = await accounts.message({id: "7", account: "work"});
      assert.equal(message.subject, "Confirm your email");
      assert.equal(message.from?.address, "no-reply@mail.instagram.com");
      assert.equal(message.body.includes("<#part"), false, "MML markers must not reach the reader");
      assert.equal(message.body.includes("<img"), false, "tags must not reach the reader");
      assert.match(message.body, /^Hi carlvincetan,/);
      assert.match(message.body, /profile\.\nPlease confirm/);
      assert.match(message.body, /sent to carlvincetan@gmail\.com\. © Instagram/);
    },
    readResult(body),
  );
});

test("carries the sender's HTML alongside the text version", async () => {
  const body =
    "<#multipart type=alternative><#part type=text/plain>Plain words.<#/part>" +
    '<#part type=text/html><p>HTML <b>words</b>.</p><#/part><#/multipart>';
  await withConfig(
    EXISTING,
    async (accounts) => {
      const message = await accounts.message({id: "7", account: "work"});
      // The markup goes over as written: sanitising is the reader's job, and
      // half-cleaning it here would only make the reader trust it wrongly.
      assert.equal(message.html, "<p>HTML <b>words</b>.</p>");
      assert.equal(message.body, "Plain words.", "the text fallback still stands");
    },
    readResult(body),
  );
});

test("reports no HTML for a message that has none", async () => {
  await withConfig(
    EXISTING,
    async (accounts) => {
      const message = await accounts.message({id: "7", account: "work"});
      assert.equal(message.html, null);
    },
    readResult("Just words."),
  );
});

test("prefers the plain-text part of an alternative message", async () => {
  const body =
    "<#multipart type=alternative><#part type=text/plain>Plain words.<#/part>" +
    "<#part type=text/html><p>HTML <b>words</b>.</p><#/part><#/multipart>";
  await withConfig(
    EXISTING,
    async (accounts) => {
      const message = await accounts.message({id: "7", account: "work"});
      assert.equal(message.body, "Plain words.");
    },
    readResult(body),
  );
});

test("leaves a plain-text body untouched, entities included", async () => {
  const body = "Columns  align:\n  a  1\n  b  2\n\nLiterally &#064; and <not a tag.";
  await withConfig(
    EXISTING,
    async (accounts) => {
      const message = await accounts.message({id: "7", account: "work"});
      assert.equal(message.body, body, "plain text is already rendered; rewriting it can only lose");
    },
    readResult(body),
  );
});

test("drops attachment stubs from the reading body", async () => {
  const body =
    "<#part type=text/plain>See attached.<#/part>\n" +
    "<#part filename=report.pdf type=application/pdf><#/part>";
  await withConfig(
    EXISTING,
    async (accounts) => {
      const message = await accounts.message({id: "7", account: "work"});
      assert.equal(message.body, "See attached.");
    },
    readResult(body),
  );
});

test("turns typed words into a query Himalaya can parse", () => {
  // A bare word is not a condition, so it has to become one — against the
  // three fields someone means when they search a mailbox.
  assert.equal(
    searchQuery("invoice"),
    'subject "invoice" or from "invoice" or body "invoice"',
  );
  // Anyone who does speak the language keeps it, which is also how the
  // agent's own tool calls reach the backend.
  assert.equal(searchQuery("from alice@example.com"), "from alice@example.com");
  assert.equal(searchQuery("", "date-asc"), "order by date asc");
  assert.equal(searchQuery("hi", "from"), 'subject "hi" or from "hi" or body "hi" order by from asc');
  assert.equal(searchQuery(undefined), "");
});

test("lists the files a message announces", async () => {
  const body =
    "<#part type=text/plain>See attached.<#/part>\n" +
    "<#part filename=report.pdf type=application/pdf><#/part>";
  await withConfig(
    EXISTING,
    async (accounts) => {
      const message = await accounts.message({id: "7", account: "work"});
      assert.deepEqual(message.attachments, [{name: "report.pdf", mime: "application/pdf"}]);
    },
    readResult(body),
  );
});

test("carries the ids a reply needs to thread", async () => {
  const rendered = [
    "From: Priya <priya@example.com>",
    "To: Me <me@work.com>",
    "Subject: Re: Q3",
    "Date: Fri, 15 Aug 2026 10:00:00 +0000",
    "Message-ID: <c@example.com>",
    "References: <a@example.com> <b@example.com>",
    "In-Reply-To: <b@example.com>",
    "",
    "Words.",
  ].join("\n");
  await withConfig(
    EXISTING,
    async (accounts, _configPath, harnessed) => {
      const message = await accounts.message({id: "7", account: "work"});
      assert.equal(message.messageId, "<c@example.com>");
      // In-Reply-To repeats the last reference; the chain must not double it.
      assert.deepEqual(message.references, ["<a@example.com>", "<b@example.com>"]);
      const read = harnessed.calls.find((call) => call.args.includes("read"));
      assert.ok(
        read?.args.includes("Message-ID"),
        "the headers have to be asked for, or Himalaya prints none of them",
      );
    },
    (call) =>
      call.args.includes("read") ? {code: 0, stdout: JSON.stringify(rendered), stderr: ""} : undefined,
  );
});

test("writes an attachment into the message it sends", async () => {
  await withConfig(EXISTING, async (accounts, configPath, harnessed) => {
    const file = path.join(path.dirname(configPath), "note.txt");
    await writeFile(file, "hello", "utf8");
    await accounts.send({
      account: "work",
      from: "me@work.com",
      to: ["you@example.com"],
      cc: [],
      bcc: [],
      subject: "With a file",
      body: "See attached.",
      attachments: [file],
      inReplyTo: "<b@example.com>",
      references: ["<a@example.com>"],
    });
    const sent = harnessed.calls.find((call) => call.args.includes("send"))?.input ?? "";
    assert.match(sent, /Content-Type: multipart\/mixed; boundary="/);
    assert.match(sent, /Content-Disposition: attachment; filename="note.txt"/);
    assert.match(sent, new RegExp(Buffer.from("hello").toString("base64")));
    // Without both headers the reply starts a new thread for the recipient.
    assert.match(sent, /In-Reply-To: <b@example.com>/);
    assert.match(sent, /References: <a@example.com> <b@example.com>/);
  });
});

test("reports Himalaya as missing when the binary does not run", async () => {
  await withConfig(
    "",
    async (accounts) => {
      const tooling = await accounts.tooling();
      assert.equal(tooling.installed, false);
      assert.match(tooling.error ?? "", /not installed/);
    },
    (call) => (call.command === "himalaya" ? {code: 127, stdout: "", stderr: "not found"} : undefined),
  );
});

test("surfaces the innermost cause when a connection test fails", async () => {
  await withConfig(
    EXISTING,
    async (accounts) => {
      const tested = await accounts.test("work");
      assert.equal(tested.status, "error");
      assert.equal(tested.error, "authentication failed");
    },
    (call) =>
      call.args.includes("folder")
        ? {
            code: 1,
            stdout: "",
            stderr:
              "Error: \n   0: [91mcannot build IMAP client[0m\n   1: [91mauthentication failed[0m\n\nNote: Run with --debug\n",
          }
        : undefined,
  );
});

test("a passing connection test clears the error", async () => {
  await withConfig(EXISTING, async (accounts) => {
    const tested = await accounts.test("work");
    assert.equal(tested.status, "ok");
    assert.equal(tested.error, null);
  });
});

test("keeps the search query after every flag Himalaya expects first", async () => {
  await withConfig(
    EXISTING,
    async (accounts, _configPath, harnessed) => {
      await accounts.envelopes({folder: "INBOX", sort: "date-desc"});
      const args = harnessed.calls[0]?.args ?? [];
      assert.equal(args[args.length - 1], "order by date desc");
      assert.ok(args.indexOf("--output") < args.length - 1);
    },
    (call) => (call.command === "himalaya" ? {code: 0, stdout: "[]", stderr: ""} : undefined),
  );
});

test("reports the diagnostic when Himalaya fails but still exits zero", async () => {
  await withConfig(
    EXISTING,
    async (accounts) => {
      await assert.rejects(
        accounts.envelopes({folder: "INBOX"}),
        /cannot parse search emails query/,
      );
    },
    (call) =>
      call.command === "himalaya"
        ? {
            code: 0,
            stdout: "",
            stderr: "2026 WARN imap_codec\nError: cannot parse search emails query `x`\n   ╭─[query:1:11]\n───╯\n",
          }
        : undefined,
  );
});

test("an important message says so in both spellings clients read", async () => {
  await withConfig(EXISTING, async (accounts, _configPath, harnessed) => {
    await accounts.send({
      account: "work",
      from: "me@work.com",
      to: ["dana@example.com"],
      cc: [],
      bcc: [],
      subject: "Friday",
      body: "Are we still on?",
      importance: "high",
    });
    const sent = harnessed.calls.at(-1)?.input ?? "";
    assert.match(sent, /^Importance: high$/m);
    assert.match(sent, /^X-Priority: 1 \(Highest\)$/m);
  });
});

test("low priority is its own pair of headers", async () => {
  await withConfig(EXISTING, async (accounts, _configPath, harnessed) => {
    await accounts.send({
      account: "work",
      from: "me@work.com",
      to: ["dana@example.com"],
      cc: [],
      bcc: [],
      subject: "Whenever",
      body: "No rush.",
      importance: "low",
    });
    const sent = harnessed.calls.at(-1)?.input ?? "";
    assert.match(sent, /^Importance: low$/m);
    assert.match(sent, /^X-Priority: 5 \(Lowest\)$/m);
  });
});

test("an ordinary message claims no priority at all", async () => {
  await withConfig(EXISTING, async (accounts, _configPath, harnessed) => {
    await accounts.send({
      account: "work",
      from: "me@work.com",
      to: ["dana@example.com"],
      cc: [],
      bcc: [],
      subject: "Notes",
      body: "Attached.",
      importance: "normal",
    });
    const sent = harnessed.calls.at(-1)?.input ?? "";
    assert.doesNotMatch(sent, /Importance:/);
    assert.doesNotMatch(sent, /X-Priority:/);
  });
});
