import type {Storage, JsonValue} from '@polymux/storage';
import {randomUUID} from 'node:crypto';
import path from 'node:path';

export function updateDeviceMessage(storage: Storage, id: string, patch: {conversationId?: string; content?: JsonValue; metadata?: JsonValue; attachments?: string[]}) {
  if (!patch || patch.attachments !== undefined && (!Array.isArray(patch.attachments) || patch.attachments.some(file => typeof file !== 'string'))) throw new Error('Invalid message update.');
  const message = storage.getMessage(id);
  if (!message || message.conversationId !== patch.conversationId) throw new Error('Message does not belong to this conversation.');
  const updated = storage.updateMessage(id, {content: patch.content, metadata: patch.metadata});
  const existing = new Set(storage.listAttachments(id).map(file => file.path));
  for (const file of patch.attachments ?? []) {
    if (typeof file !== 'string') throw new Error('Invalid attachment.');
    if (existing.has(file)) continue;
    storage.addAttachment({id: randomUUID(), messageId: id, name: path.basename(file), path: file, mimeType: null, size: null, sha256: null});
    existing.add(file);
  }
  return updated;
}
