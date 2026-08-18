import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { SqliteStorage } from "../src/sqlite/sqlite-storage.js";

function fixture() {
  let tick = 0;
  const storage = new SqliteStorage(":memory:", {
    clock: () => `2026-08-13T00:00:${String(tick++).padStart(2, "0")}.000Z`,
  });
  return storage;
}

test("persists user configuration after the database is reopened", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "flareai-preferences-"));
  const databasePath = path.join(directory, "flareai.sqlite");
  try {
    const firstSession = new SqliteStorage(databasePath);
    firstSession.setPreference("general-access", {
      theme: "dark",
      timeEnabled: false,
      locationEnabled: false,
      location: null,
    });
    firstSession.close();

    const nextSession = new SqliteStorage(databasePath);
    try {
      assert.deepEqual(nextSession.getPreference("general-access")?.value, {
        theme: "dark",
        timeEnabled: false,
        locationEnabled: false,
        location: null,
      });
    } finally {
      nextSession.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("stores conversations, ordered messages, attachments and archive state", () => {
  const storage = fixture();
  try {
    const created = storage.createConversation({
      id: "conversation-1",
      title: "New chat",
      metadata: { source: "test" },
    });
    assert.equal(created.title, "New chat");
    assert.deepEqual(created.metadata, { source: "test" });

    const first = storage.appendMessage({
      id: "message-1",
      conversationId: created.id,
      role: "user",
      content: { text: "Hello" },
    });
    const second = storage.appendMessage({
      id: "message-2",
      conversationId: created.id,
      role: "assistant",
      content: [{ type: "text", text: "Hi" }],
    });
    assert.equal(first.sequence, 1);
    assert.equal(second.sequence, 2);
    assert.deepEqual(
      storage
        .listMessages(created.id, { afterSequence: 1 })
        .map((item) => item.id),
      ["message-2"],
    );
    assert.equal(storage.getMessage(first.id)?.id, first.id);
    assert.deepEqual(
      storage.updateMessage(first.id, {
        content: "Hello again",
        metadata: { feedback: "up" },
      }),
      {...first, content: "Hello again", metadata: { feedback: "up" }},
    );

    storage.addAttachment({
      id: "attachment-1",
      messageId: first.id,
      name: "brief.pdf",
      path: "/managed/brief.pdf",
      mimeType: "application/pdf",
      size: 120,
      sha256: null,
    });
    assert.equal(storage.listAttachments(first.id)[0]?.name, "brief.pdf");

    storage.updateConversation(created.id, {
      title: "Greeting",
      archived: true,
    });
    assert.equal(storage.listConversations().length, 0);
    assert.equal(
      storage.listConversations({ includeArchived: true })[0]?.title,
      "Greeting",
    );
  } finally {
    storage.close();
  }
});

test("persists replayable run events and lifecycle state", () => {
  const storage = fixture();
  try {
    storage.createConversation({ id: "conversation-1", title: "Run" });
    storage.createRun({
      id: "run-1",
      conversationId: "conversation-1",
      model: "provider/model",
    });
    const running = storage.updateRun("run-1", { status: "running" });
    assert.ok(running?.startedAt);

    storage.appendRunEvent("run-1", "run.started", { model: "provider/model" });
    storage.appendRunEvent("run-1", "message.delta", { text: "hello" });
    storage.appendRunEvent("run-1", "run.completed", { stopReason: "end" });
    assert.deepEqual(
      storage
        .listRunEvents("run-1", 1)
        .map((item) => [item.sequence, item.type]),
      [
        [2, "message.delta"],
        [3, "run.completed"],
      ],
    );

    const completed = storage.updateRun("run-1", {
      status: "completed",
      usage: { input: 10, output: 3 },
    });
    assert.ok(completed?.finishedAt);
    assert.deepEqual(completed?.usage, { input: 10, output: 3 });
  } finally {
    storage.close();
  }
});

test("a store written before summaries were fingerprinted still opens", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "flareai-compaction-"));
  const databasePath = path.join(directory, "flareai.sqlite");
  try {
    const before = new SqliteStorage(databasePath);
    before.createConversation({ id: "conversation-1", title: "Chat" });
    before.close();

    // Wind the store back to how the previous version wrote it: a compaction
    // row with no fingerprint recorded against it.
    const old = new DatabaseSync(databasePath);
    old.exec("ALTER TABLE compactions DROP COLUMN prefix_fingerprint");
    old
      .prepare(
        "INSERT INTO compactions (id,conversation_id,through_message_sequence,summary,token_count,created_at) VALUES (?,?,?,?,?,?)",
      )
      .run("compact-old", "conversation-1", 8, "summary from before", 80, "2026-01-01T00:00:00.000Z");
    old.exec("PRAGMA user_version = 4");
    old.close();

    const after = new SqliteStorage(databasePath);
    try {
      const saved = after.getLatestCompaction("conversation-1");
      assert.equal(saved?.summary, "summary from before");
      // Empty reads as "cannot be checked", which is what keeps an unverifiable
      // summary from being reused rather than trusted blindly.
      assert.equal(saved?.prefixFingerprint, "");
    } finally {
      after.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("recompacting the same prefix replaces its summary", () => {
  const storage = fixture();
  try {
    storage.createConversation({ id: "conversation-1", title: "Memory" });
    storage.saveCompaction({
      id: "compact-1",
      conversationId: "conversation-1",
      throughMessageSequence: 8,
      summary: "stale summary",
      tokenCount: 80,
      prefixFingerprint: "user:12",
    });
    const replaced = storage.saveCompaction({
      id: "compact-2",
      conversationId: "conversation-1",
      throughMessageSequence: 8,
      summary: "fresh summary",
      tokenCount: 90,
      prefixFingerprint: "user:14",
    });

    assert.equal(replaced.summary, "fresh summary");
    assert.equal(storage.getLatestCompaction("conversation-1")?.id, "compact-2");
    assert.equal(
      storage.getLatestCompaction("conversation-1")?.summary,
      "fresh summary",
    );
  } finally {
    storage.close();
  }
});

test("keeps compaction, durable memory and preferences distinct", () => {
  const storage = fixture();
  try {
    storage.createConversation({ id: "conversation-1", title: "Memory" });
    storage.saveCompaction({
      id: "compact-1",
      conversationId: "conversation-1",
      throughMessageSequence: 8,
      summary: "Earlier context",
      tokenCount: 80,
      prefixFingerprint: "user:12",
    });
    storage.saveCompaction({
      id: "compact-2",
      conversationId: "conversation-1",
      throughMessageSequence: 14,
      summary: "Later context",
      tokenCount: 120,
      prefixFingerprint: "user:20",
    });
    assert.equal(
      storage.getLatestCompaction("conversation-1")?.id,
      "compact-2",
    );

    storage.upsertMemory({
      id: "memory-1",
      scope: "user",
      kind: "preference",
      content: "Keep responses concise",
    });
    storage.upsertMemory({
      id: "memory-2",
      scope: "conversation",
      scopeId: "conversation-1",
      kind: "decision",
      content: "Use SQLite",
      confidence: 0.9,
    });
    assert.deepEqual(
      storage
        .listMemories({ scope: "conversation", scopeId: "conversation-1" })
        .map((item) => item.id),
      ["memory-2"],
    );
    assert.equal(storage.deleteMemory("memory-2"), true);
    assert.equal(
      storage.listMemories({ scope: "conversation", scopeId: "conversation-1" })
        .length,
      0,
    );
    assert.equal(
      storage.listMemories({
        scope: "conversation",
        scopeId: "conversation-1",
        includeDeleted: true,
      }).length,
      1,
    );

    storage.setPreference("system.responseStyle", { verbosity: "concise" });
    assert.deepEqual(storage.getPreference("system.responseStyle")?.value, {
      verbosity: "concise",
    });
  } finally {
    storage.close();
  }
});

test("stores artifacts and references without putting file contents in SQLite", () => {
  const storage = fixture();
  try {
    storage.createConversation({ id: "conversation-1", title: "Resources" });
    storage.createRun({ id: "run-1", conversationId: "conversation-1" });
    storage.createArtifact({
      id: "artifact-1",
      conversationId: "conversation-1",
      runId: "run-1",
      kind: "document",
      name: "Plan.docx",
      path: "/managed/Plan.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 400,
    });
    storage.createReference({
      id: "reference-1",
      conversationId: "conversation-1",
      runId: "run-1",
      kind: "web",
      title: "FlareAI",
      uri: "https://flarehq.co",
    });
    assert.equal(
      storage.listArtifacts("conversation-1")[0]?.path,
      "/managed/Plan.docx",
    );
    assert.equal(
      storage.listReferences("conversation-1")[0]?.uri,
      "https://flarehq.co",
    );
  } finally {
    storage.close();
  }
});

test("transactions roll back atomically and deleting a conversation cascades", () => {
  const storage = fixture();
  try {
    assert.throws(
      () =>
        storage.transaction(() => {
          storage.createConversation({ id: "rolled-back", title: "Temporary" });
          throw new Error("abort");
        }),
      /abort/,
    );
    assert.equal(storage.getConversation("rolled-back"), null);

    storage.createConversation({ id: "conversation-1", title: "Cascade" });
    storage.createRun({ id: "run-1", conversationId: "conversation-1" });
    storage.appendRunEvent("run-1", "run.started", {});
    storage.appendMessage({
      id: "message-1",
      conversationId: "conversation-1",
      runId: "run-1",
      role: "user",
      content: { text: "Delete me" },
    });
    assert.equal(storage.deleteConversation("conversation-1"), true);
    assert.equal(storage.getRun("run-1"), null);
    assert.deepEqual(storage.listRunEvents("run-1"), []);
  } finally {
    storage.close();
  }
});

test("prevents resources from crossing conversation boundaries", () => {
  const storage = fixture();
  try {
    storage.createConversation({ id: "conversation-1", title: "One" });
    storage.createConversation({ id: "conversation-2", title: "Two" });
    storage.createRun({ id: "run-1", conversationId: "conversation-1" });
    assert.throws(
      () =>
        storage.appendMessage({
          id: "message-1",
          conversationId: "conversation-2",
          runId: "run-1",
          role: "assistant",
          content: { text: "wrong thread" },
        }),
      /another conversation/,
    );
    assert.throws(
      () =>
        storage.createReference({
          id: "reference-1",
          conversationId: "conversation-2",
          runId: "run-1",
          kind: "web",
          title: "Wrong",
          uri: "https://example.com",
        }),
      /another conversation/,
    );
  } finally {
    storage.close();
  }
});

test("searches message history newest first, ignoring tool noise", () => {
  const storage = fixture();
  try {
    storage.createConversation({ id: "older", title: "Rust questions" });
    storage.createConversation({ id: "newer", title: "Deployment" });
    storage.appendMessage({
      id: "a",
      conversationId: "older",
      role: "user",
      content: "I prefer Rust for the API layer",
    });
    storage.appendMessage({
      id: "b",
      conversationId: "newer",
      role: "assistant",
      content: [{ type: "text", text: "Rust it is, then." }],
    });
    storage.appendMessage({
      id: "c",
      conversationId: "newer",
      role: "tool",
      content: "Rust appears in this tool output too",
    });

    const hits = storage.searchMessages("Rust");

    // Tool output is excluded by default; newest match comes first.
    assert.deepEqual(
      hits.map((hit) => hit.messageId),
      ["b", "a"],
    );
    assert.equal(hits[0]?.conversationTitle, "Deployment");
    // Block content is rendered to plain text rather than returned as JSON.
    assert.equal(hits[0]?.text, "Rust it is, then.");
    assert.equal(storage.searchMessages("Rust", { roles: ["tool"] }).length, 1);
    assert.equal(storage.searchMessages("   ").length, 0);
    assert.equal(storage.searchMessages("Rust", { conversationId: "older" }).length, 1);
  } finally {
    storage.close();
  }
});

test("a literal wildcard in a search is not treated as a pattern", () => {
  const storage = fixture();
  try {
    storage.createConversation({ id: "c", title: "Chat" });
    storage.appendMessage({
      id: "a",
      conversationId: "c",
      role: "user",
      content: "discount is 50% off",
    });
    storage.appendMessage({
      id: "b",
      conversationId: "c",
      role: "user",
      content: "nothing relevant here",
    });

    assert.equal(storage.searchMessages("50% off").length, 1);
    // Would match everything if % leaked through as a wildcard.
    assert.equal(storage.searchMessages("%%%").length, 0);
  } finally {
    storage.close();
  }
});

test("drops web references the reply never cited when upgrading an old store", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "flareai-refs-"));
  const databasePath = path.join(directory, "flareai.sqlite");
  try {
    const before = new SqliteStorage(databasePath);
    before.createConversation({ id: "conversation-1", title: "Research" });
    before.createRun({ id: "run-1", conversationId: "conversation-1" });
    before.appendMessage({
      id: "message-1",
      conversationId: "conversation-1",
      runId: "run-1",
      role: "assistant",
      content: [
        { type: "toolCall", id: "call-1", name: "browser_control", arguments: { url: "https://search.example/?q=ai" } },
        { type: "text", text: "The one worth your time is [AI Summit](https://one.example/summit)." },
      ],
    });
    // Cited in the reply, a page only opened along the way, and a file the
    // user attached by hand.
    for (const [id, uri] of [
      ["kept", "https://one.example/summit"],
      ["opened", "https://search.example/?q=ai"],
    ] as const)
      before.createReference({ id, conversationId: "conversation-1", runId: "run-1", kind: "web", title: id, uri });
    before.createReference({
      id: "attached",
      conversationId: "conversation-1",
      kind: "file",
      title: "notes.md",
      uri: "/home/me/notes.md",
    });
    before.close();

    // Reopen as a store written by the previous version.
    const rollback = new DatabaseSync(databasePath);
    rollback.exec("PRAGMA user_version = 3");
    rollback.close();

    const after = new SqliteStorage(databasePath);
    try {
      assert.deepEqual(
        after.listReferences("conversation-1").map((item) => item.id).sort(),
        ["attached", "kept"],
      );
    } finally {
      after.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("remembers a site's permission decisions and forgets them on request", () => {
  const storage = fixture();
  try {
    storage.setSitePermission("https://maps.example", "geolocation", "allow");
    storage.setSitePermission("https://maps.example", "notifications", "deny");
    storage.setSitePermission("https://other.example", "media", "allow");

    assert.equal(
      storage.getSitePermission("https://maps.example", "geolocation")?.decision,
      "allow",
    );
    // A later decision replaces the earlier one rather than stacking beside it.
    storage.setSitePermission("https://maps.example", "geolocation", "deny");
    assert.equal(
      storage.getSitePermission("https://maps.example", "geolocation")?.decision,
      "deny",
    );
    assert.equal(storage.listSitePermissions("https://maps.example").length, 2);
    assert.equal(storage.listSitePermissions().length, 3);

    // Clearing one site leaves the others alone.
    assert.equal(storage.clearSitePermissions("https://maps.example"), 2);
    assert.equal(storage.listSitePermissions().length, 1);
    assert.equal(
      storage.getSitePermission("https://maps.example", "geolocation"),
      null,
    );
  } finally {
    storage.close();
  }
});

test("a download stamps its finish once and keeps it through later updates", () => {
  const storage = fixture();
  try {
    storage.startDownload({
      id: "download-1",
      url: "https://files.example/report.pdf",
      filename: "report.pdf",
      path: "/tmp/report.pdf",
      totalBytes: 1000,
    });
    const progressing = storage.updateDownload("download-1", {
      receivedBytes: 400,
    });
    assert.equal(progressing?.state, "progressing");
    assert.equal(progressing?.finishedAt, null);

    const done = storage.updateDownload("download-1", {
      state: "completed",
      receivedBytes: 1000,
    });
    assert.equal(done?.state, "completed");
    assert.ok(done?.finishedAt, "a finished download records when it finished");

    // A late progress event must not wind the finish time back to null.
    const late = storage.updateDownload("download-1", { receivedBytes: 1000 });
    assert.equal(late?.finishedAt, done?.finishedAt);

    assert.equal(storage.updateDownload("missing", { state: "completed" }), null);
    assert.equal(storage.listDownloads().length, 1);
    assert.equal(storage.deleteDownload("download-1"), true);
    assert.equal(storage.listDownloads().length, 0);
  } finally {
    storage.close();
  }
});

test("re-saving a login keeps the row id the vault filed the password under", () => {
  const storage = fixture();
  try {
    const first = storage.upsertSavedLogin({
      id: "login-1",
      origin: "https://shop.example",
      username: "me@example.com",
      source: "import",
    });
    // The same account saved again must not mint a second id, or the password
    // already stored under the first one would be stranded.
    const second = storage.upsertSavedLogin({
      id: "login-2",
      origin: "https://shop.example",
      username: "me@example.com",
    });
    assert.equal(second.id, first.id);
    assert.equal(second.source, "import", "the original source survives");
    assert.equal(storage.listSavedLogins("https://shop.example").length, 1);

    // A different account on the same site is its own row.
    storage.upsertSavedLogin({
      id: "login-3",
      origin: "https://shop.example",
      username: "other@example.com",
    });
    assert.equal(storage.listSavedLogins("https://shop.example").length, 2);

    assert.equal(storage.getSavedLogin("login-1")?.lastUsedAt, null);
    assert.ok(storage.touchSavedLogin("login-1")?.lastUsedAt);
    assert.equal(storage.deleteSavedLogin("login-1"), true);
    assert.equal(storage.getSavedLogin("login-1"), null);
  } finally {
    storage.close();
  }
});

test("a page visited twice is one row that counts both", () => {
  const storage = fixture();
  storage.recordVisit({url: "https://example.com/a", title: "A", visitedAt: "2026-08-01T10:00:00.000Z"});
  const second = storage.recordVisit({
    url: "https://example.com/a",
    title: "A again",
    visitedAt: "2026-08-02T10:00:00.000Z",
  });

  assert.equal(second.visitCount, 2, "a local visit adds one; history is pages, not visits");
  assert.equal(second.visitedAt, "2026-08-02T10:00:00.000Z");
  assert.equal(second.title, "A again", "the newer title wins");
  assert.equal(storage.listHistory().length, 1);
});

test("an older visit does not drag a page back down the list", () => {
  const storage = fixture();
  storage.recordVisit({url: "https://example.com/a", visitedAt: "2026-08-10T10:00:00.000Z"});
  // What an import carries: real visits, but last made long before the local
  // one. The page must keep the time it was actually last opened.
  const merged = storage.recordVisit({
    url: "https://example.com/a",
    visitedAt: "2024-01-01T10:00:00.000Z",
    visitCount: 9,
    source: "import",
  });
  assert.equal(merged.visitedAt, "2026-08-10T10:00:00.000Z", "the newer time stands");
  assert.equal(merged.visitCount, 9, "and the browser's own total is taken up");
});

test("a blank title does not overwrite one already known", () => {
  const storage = fixture();
  storage.recordVisit({url: "https://example.com/a", title: "Real title"});
  const after = storage.recordVisit({url: "https://example.com/a", title: ""});
  assert.equal(after.title, "Real title");
});

test("history lists newest first and searches url and title", () => {
  const storage = fixture();
  storage.recordVisit({url: "https://alpha.example/x", title: "Alpha", visitedAt: "2026-08-01T00:00:00.000Z"});
  storage.recordVisit({url: "https://beta.example/y", title: "Beta", visitedAt: "2026-08-03T00:00:00.000Z"});
  storage.recordVisit({url: "https://gamma.example/z", title: "Gamma", visitedAt: "2026-08-02T00:00:00.000Z"});

  assert.deepEqual(
    storage.listHistory().map((entry) => entry.title),
    ["Beta", "Gamma", "Alpha"],
  );
  assert.deepEqual(storage.listHistory({query: "beta"}).map((e) => e.title), ["Beta"]);
  assert.deepEqual(storage.listHistory({query: "gamma.example"}).map((e) => e.title), ["Gamma"]);
  assert.equal(storage.listHistory({limit: 2}).length, 2);
});

test("a search term's wildcards are matched literally", () => {
  const storage = fixture();
  storage.recordVisit({url: "https://example.com/100%", title: "Percent"});
  storage.recordVisit({url: "https://example.com/other", title: "Other"});
  // Unescaped, "%" matches everything and the search silently returns the lot.
  assert.deepEqual(storage.listHistory({query: "100%"}).map((e) => e.title), ["Percent"]);
});

test("a bulk import writes every row in one go", () => {
  const storage = fixture();
  const written = storage.recordVisits([
    {url: "https://a.example", title: "A", source: "import", visitCount: 1},
    {url: "https://b.example", title: "B", source: "import"},
    {url: "https://a.example", title: "A", source: "import", visitCount: 3},
  ]);
  assert.equal(written, 3);
  const rows = storage.listHistory();
  assert.equal(rows.length, 2, "the repeat collapses onto its url");
  // 3, not 4: an exported count is that browser's running total for the page,
  // so the larger stands rather than the two being added together.
  assert.equal(rows.find((r) => r.url === "https://a.example")!.visitCount, 3);
});

test("importing the same profile again changes nothing", () => {
  const storage = fixture();
  const batch = [
    {url: "https://a.example", title: "A", visitCount: 40, source: "import" as const},
    {url: "https://b.example", title: "B", visitCount: 7, source: "import" as const},
  ];
  storage.recordVisits(batch);
  const once = storage.listHistory().map((row) => `${row.url}=${row.visitCount}`).sort();
  storage.recordVisits(batch);
  storage.recordVisits(batch);

  assert.deepEqual(
    storage.listHistory().map((row) => `${row.url}=${row.visitCount}`).sort(),
    once,
    "a re-import is idempotent rather than doubling every count",
  );
  assert.equal(storage.listHistory().length, 2, "and never duplicates a page");
});

test("a later export that has more visits still raises the count", () => {
  const storage = fixture();
  storage.recordVisits([{url: "https://a.example", visitCount: 40, source: "import"}]);
  storage.recordVisits([{url: "https://a.example", visitCount: 51, source: "import"}]);
  assert.equal(storage.listHistory()[0]!.visitCount, 51);
  // A smaller total is a staler export, and must not lower what is known.
  storage.recordVisits([{url: "https://a.example", visitCount: 3, source: "import"}]);
  assert.equal(storage.listHistory()[0]!.visitCount, 51);
});

test("browsing a page yourself keeps adding to an imported total", () => {
  const storage = fixture();
  storage.recordVisits([{url: "https://a.example", visitCount: 40, source: "import"}]);
  storage.recordVisit({url: "https://a.example", source: "local"});
  storage.recordVisit({url: "https://a.example", source: "local"});
  // A local visit is a delta — one more — where an import is an absolute.
  assert.equal(storage.listHistory()[0]!.visitCount, 42);
});

test("clearing can take just what was imported", () => {
  const storage = fixture();
  storage.recordVisit({url: "https://local.example", source: "local"});
  storage.recordVisit({url: "https://imported.example", source: "import"});

  assert.equal(storage.clearHistory({source: "import"}), 1);
  assert.deepEqual(storage.listHistory().map((e) => e.url), ["https://local.example"]);
  assert.equal(storage.deleteHistoryEntry("https://local.example"), true);
  assert.equal(storage.deleteHistoryEntry("https://gone.example"), false);
  assert.equal(storage.listHistory().length, 0);
});

test("the hub's cache hands back what it was given, newest first", () => {
  const storage = fixture();
  storage.writeCommsCache("mail:work|INBOX", "[1]");
  storage.writeCommsCache("mail:work|Sent", "[2]");
  assert.equal(storage.readCommsCache("mail:work|INBOX")!.value, "[1]");
  assert.deepEqual(
    storage.listCommsCache("mail:").map((entry) => entry.key),
    ["mail:work|Sent", "mail:work|INBOX"],
  );
  // A second write of the same key is a refresh, not a second row.
  storage.writeCommsCache("mail:work|INBOX", "[3]");
  assert.equal(storage.listCommsCache("mail:").length, 2);
  assert.equal(storage.readCommsCache("mail:work|INBOX")!.value, "[3]");
  assert.equal(storage.readCommsCache("mail:nothing"), null);
});

test("a prefix stays a prefix, and trimming keeps the head", () => {
  const storage = fixture();
  // `%` and `_` are LIKE wildcards; a key holding them must not match its
  // neighbours.
  storage.writeCommsCache("body:100%|a", "a");
  storage.writeCommsCache("body:1000|b", "b");
  assert.deepEqual(storage.listCommsCache("body:100%|").map((e) => e.key), ["body:100%|a"]);

  for (const id of ["c", "d", "e"]) storage.writeCommsCache(`body:x|${id}`, id);
  assert.equal(storage.trimCommsCache("body:x|", 2), 1);
  assert.deepEqual(storage.listCommsCache("body:x|").map((e) => e.value), ["e", "d"]);
  assert.equal(storage.deleteCommsCache("body:"), 4);
  assert.equal(storage.listCommsCache("body:").length, 0);
});
