import {conversationCopyTitle} from '../../shared/conversation-copy';
import type {Storage} from '@polymux/storage';

/** Copies saved history, never the source's live runs or team identity. */
export function duplicateConversation(storage: Storage, id: string, throughMessageId?: string) {
  return storage.transaction(() => {
    const source = storage.getConversation(id);
    if (!source) throw new Error('Conversation not found');
    const boundary = throughMessageId === undefined ? null : storage.getMessage(throughMessageId);
    if (throughMessageId !== undefined && (!boundary || boundary.conversationId !== id)) throw new Error('Fork message not found in conversation');
    const titles: string[] = [];
    for (let offset = 0; ; offset += 500) {
      const page = storage.listConversations({includeArchived: true, limit: 500, offset});
      titles.push(...page.map(item => item.title));
      if (page.length < 500) break;
    }
    const copy = storage.createConversation({id: crypto.randomUUID(), title: conversationCopyTitle(source.title, titles)});
    let afterSequence = 0;
    while (true) {
      const messages = storage.listMessages(id, {afterSequence, limit: 2000});
      if (!messages.length) break;
      for (const message of messages) {
        if (boundary && message.sequence > boundary.sequence) return storage.getConversation(copy.id)!;
        const messageId = crypto.randomUUID();
        storage.appendMessage({id: messageId, conversationId: copy.id, role: message.role,
          content: message.content, metadata: message.metadata});
        for (const attachment of storage.listAttachments(message.id)) {
          storage.addAttachment({...attachment, id: crypto.randomUUID(), messageId});
        }
      }
      afterSequence = messages[messages.length - 1].sequence;
    }
    return storage.getConversation(copy.id)!;
  });
}
