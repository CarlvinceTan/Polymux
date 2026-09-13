import { randomUUID } from "node:crypto";
import type { Storage } from "@polymux/storage";

/** A branch owns a new Polymux conversation; its source remains intact. */
export function forkConversation(
  storage: Storage,
  id: string,
  messageId: string,
) {
  return storage.transaction(() => {
    const source = storage.getConversation(id);
    const selected = storage.getMessage(messageId);
    if (
      !source ||
      !selected ||
      selected.conversationId !== id ||
      selected.role !== "user"
    )
      throw new Error("Choose a user message in this conversation.");
    const fork = storage.createConversation({
      id: randomUUID(),
      title: `${source.title} (fork)`,
      metadata: {
        deviceAssistant: true,
        parentConversationId: id,
        forkMessageId: messageId,
      },
    });
    let afterSequence = 0;
    while (true) {
      const messages = storage
        .listMessages(id, { afterSequence, limit: 2000 })
        .filter((message) => message.sequence < selected.sequence);
      if (!messages.length) break;
      for (const message of messages) {
        const messageId = randomUUID();
        storage.appendMessage({
          id: messageId,
          conversationId: fork.id,
          role: message.role,
          content: message.content,
          metadata: message.metadata,
        });
        for (const attachment of storage.listAttachments(message.id))
          storage.addAttachment({ ...attachment, id: randomUUID(), messageId });
      }
      afterSequence = messages[messages.length - 1].sequence;
    }
    return storage.getConversation(fork.id)!;
  });
}
