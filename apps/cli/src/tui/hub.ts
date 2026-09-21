import type {ChatDto, ChatMessageDto} from '@polymux/protocol';
import {confirm, type WorkspaceUi} from './workspace-ui.js';

/** Reading never marks a conversation read implicitly. */
export async function browseHub(ui: WorkspaceUi): Promise<void> {
  for (;;) {
    const chats = await ui.client.call<ChatDto[]>('hub.chats');
    const id = await ui.pick('Hub', [{value: 'refresh', label: 'Refresh'}, ...chats.map(chat => ({
      value: chat.id, label: chat.name, description: chat.preview ?? chat.platform,
      status: chat.unread ? `${chat.unread} unread` : chat.platform,
    }))]);
    if (!id) return;
    const chat = chats.find(c => c.id === id);
    if (!chat) continue;
    let before: string | undefined;
    for (;;) {
      const {messages, nextBefore} = await ui.client.call<{messages: ChatMessageDto[]; nextBefore: string | null}>('hub.messages', before ? [id, 50, before] : [id, 50]);
      const selected = await ui.pick(chat.name, [
        {value: 'compose', label: 'Write message'},
        {value: 'read', label: 'Mark read'},
        ...(nextBefore ? [{value: 'more', label: 'Load older messages'}] : []),
        ...(before ? [{value: 'latest', label: 'Latest messages'}] : []),
        ...messages.map(m => ({value: m.id, label: m.senderName ?? m.sender, description: m.body,
          status: m.deliveryStatus === 'unconfirmed' ? 'Unconfirmed' : new Date(m.sentAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})})),
      ]);
      if (!selected) break;
      if (selected === 'more' && nextBefore) {before = nextBefore; continue;}
      if (selected === 'latest') {before = undefined; continue;}
      if (selected === 'read') {
        const last = messages.at(-1);
        if (last) await ui.client.call('hub.markRead', [id, last.id]);
        continue;
      }
      if (selected === 'compose') {
        const body = await ui.prompt(`Message to ${chat.name}`);
        if (body?.trim()) {
          await ui.show(`Message to ${chat.name}`, body);
          if (!await confirm(ui, `Send to ${chat.name}?`)) continue;
          await ui.client.call('hub.send', [id, body]);
          ui.notify('Message submitted');
        }
        continue;
      }
      const message = messages.find(m => m.id === selected);
      if (message) await ui.show(message.senderName ?? message.sender,
        `${message.sentAt}\n\n${message.body}${message.attachments?.length ? `\n\n${message.attachments.length} attachments` : ''}`);
    }
  }
}
