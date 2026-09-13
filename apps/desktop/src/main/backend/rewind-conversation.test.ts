import assert from "node:assert/strict";
import test from "node:test";
import {SqliteStorage} from "@polymux/storage";
import {rewindConversation} from "./rewind-conversation";

test("rewinding a user message replaces it and drops later turns", () => {
  const storage = new SqliteStorage(":memory:");
  try {
    storage.createConversation({id: "chat", title: "Chat"});
    const first = storage.appendMessage({
      id: "user-1",
      conversationId: "chat",
      role: "user",
      content: "Original",
    });
    storage.appendMessage({
      id: "assistant-1",
      conversationId: "chat",
      role: "assistant",
      content: "Reply",
    });
    storage.appendMessage({
      id: "user-2",
      conversationId: "chat",
      role: "user",
      content: "Follow-up",
    });

    const updated = rewindConversation(storage, {
      conversationId: "chat",
      messageId: first.id,
      content: "Revised",
      attachments: ["/tmp/notes.txt"],
    });

    assert.equal(updated.content, "Revised");
    assert.deepEqual(
      storage.listMessages("chat").map((message) => message.id),
      ["user-1"],
    );
    assert.equal(storage.listAttachments(first.id)[0]?.name, "notes.txt");
    assert.throws(
      () =>
        rewindConversation(storage, {
          conversationId: "chat",
          messageId: "missing",
          content: "Nope",
        }),
      /does not belong/,
    );
  } finally {
    storage.close();
  }
});
