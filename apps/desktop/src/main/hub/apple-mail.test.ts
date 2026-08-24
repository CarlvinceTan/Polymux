import assert from "node:assert/strict";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import test from "node:test";
import {createAppleMailSearcher} from "./apple-mail.js";

test("Apple Mail fallback is inert off macOS", async () => {
  const search = createAppleMailSearcher({platform: "linux", indexPath: "/does/not/exist"});
  assert.deepEqual(await search({queries: ["subject NUS"], maxResults: 5, timeoutMs: 20}), {messages: [], errors: []});
});

test("Apple Mail fallback searches the local index read-only and stays bounded", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "polymux-mail-index-"));
  const indexPath = path.join(directory, "Envelope Index");
  const database = new DatabaseSync(indexPath);
  database.exec(`
    CREATE TABLE messages (ROWID INTEGER PRIMARY KEY, document_id TEXT, sender INTEGER, subject INTEGER, summary INTEGER, date_received INTEGER, mailbox INTEGER, deleted INTEGER);
    CREATE TABLE subjects (ROWID INTEGER PRIMARY KEY, subject TEXT);
    CREATE TABLE addresses (ROWID INTEGER PRIMARY KEY, address TEXT, comment TEXT);
    CREATE TABLE summaries (ROWID INTEGER PRIMARY KEY, summary TEXT);
    CREATE TABLE mailboxes (ROWID INTEGER PRIMARY KEY, url TEXT);
    INSERT INTO mailboxes VALUES (1, 'imap://student@example.edu/INBOX');
    INSERT INTO subjects VALUES (1, 'NUS interview booking'), (2, 'Unrelated note');
    INSERT INTO addresses VALUES (1, 'recruitment@nus.edu.sg', 'NUS Recruitment'), (2, 'friend@example.com', 'Friend');
    INSERT INTO summaries VALUES (1, 'Choose an interview slot today.'), (2, 'Nothing relevant.');
    INSERT INTO messages VALUES (1, 'm1', 1, 1, 1, 1787274000, 1, 0);
    INSERT INTO messages VALUES (2, 'm2', 2, 2, 2, 1787273000, 1, 0);
  `);
  database.close();
  try {
    const search = createAppleMailSearcher({platform: "darwin", indexPath});
    const result = await search({queries: ["since 20-Aug-2026 subject NUS"], maxResults: 99, timeoutMs: 100});
    assert.deepEqual(result.messages.map((message) => message.id), ["m1"]);
    assert.equal(result.messages[0]?.preview, "Choose an interview slot today.");
    const reopened = new DatabaseSync(indexPath, {readOnly: true});
    assert.equal(reopened.prepare("SELECT count(*) AS count FROM messages").get()?.count, 2);
    reopened.close();
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test("Apple Mail fallback quietly handles an absent index", async () => {
  const search = createAppleMailSearcher({platform: "darwin", home: "/does/not/exist"});
  assert.deepEqual(await search({queries: ["subject NUS"], maxResults: 5, timeoutMs: 100}), {messages: [], errors: []});
});
