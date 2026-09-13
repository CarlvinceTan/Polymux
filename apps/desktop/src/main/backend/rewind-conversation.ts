import {randomUUID} from "node:crypto";
import path from "node:path";
import type {JsonValue, Storage, StoredMessage} from "@polymux/storage";

/** Replaces a stored user prompt and drops every turn after it. */
export function rewindConversation(
  storage: Storage,
  input: {
    conversationId: string;
    messageId: string;
    content: JsonValue;
    attachments?: string[];
  },
): StoredMessage {
  return storage.transaction(() => {
    const current = storage.getMessage(input.messageId);
    if (!current || current.conversationId !== input.conversationId)
      throw new Error("Message does not belong to this conversation.");
    if (current.role !== "user")
      throw new Error("Only a user message can be resent.");
    const updated = storage.updateMessage(input.messageId, {
      content: input.content,
    });
    if (!updated) throw new Error("Message not found.");
    const existing = new Set(
      storage.listAttachments(input.messageId).map((file) => file.path),
    );
    for (const file of input.attachments ?? []) {
      if (existing.has(file)) continue;
      storage.addAttachment({
        id: randomUUID(),
        messageId: input.messageId,
        name: path.basename(file),
        path: file,
        mimeType: null,
        size: null,
        sha256: null,
      });
      existing.add(file);
    }
    storage.deleteMessagesAfter(input.conversationId, current.sequence);
    return storage.getMessage(input.messageId) ?? updated;
  });
}
