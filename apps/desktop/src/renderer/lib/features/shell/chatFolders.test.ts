import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createChatFolder,
  deleteChatFolder,
  folderForChat,
  moveChatToFolder,
  renameChatFolder,
  toggleChatFolder,
  type ChatFolder,
} from './chatFolders';

test('chat folders stay one level deep and keep each chat in one folder', () => {
  let folders: ChatFolder[] = [];
  folders = createChatFolder(folders, 'work', ' Work ');
  folders = createChatFolder(folders, 'personal', 'Personal');
  folders = moveChatToFolder(folders, 'chat-1', 'work');
  folders = moveChatToFolder(folders, 'chat-1', 'personal');

  assert.deepEqual(folders.map(({id, chatIds}) => ({id, chatIds})), [
    {id: 'work', chatIds: []},
    {id: 'personal', chatIds: ['chat-1']},
  ]);
  assert.equal(folderForChat(folders, 'chat-1')?.id, 'personal');
});

test('renaming, collapsing, deleting, and unfiling do not affect chats', () => {
  let folders = createChatFolder([], 'work', 'Work');
  folders = moveChatToFolder(folders, 'chat-1', 'work');
  folders = renameChatFolder(folders, 'work', 'Projects');
  folders = toggleChatFolder(folders, 'work');

  assert.deepEqual(folders[0], {id: 'work', name: 'Projects', collapsed: true, chatIds: ['chat-1']});
  assert.deepEqual(moveChatToFolder(folders, 'chat-1', null)[0]?.chatIds, []);
  assert.deepEqual(deleteChatFolder(folders, 'work'), []);
});
