import type {VaultItemDto, VaultItemInputDto, VaultListDto, VaultSecretsDto, VaultStatusDto, JsonValue} from '@polymux/protocol';
import {confirm, type WorkspaceUi} from './workspace-ui.js';

/** Vault secrets are shown only inside dismissible overlays, never notices/transcripts. */
export async function browseVault(ui: WorkspaceUi): Promise<void> {
  for (;;) {
    const state = await ui.client.call<VaultStatusDto>('vault.status');
    if (!state.unlocked) {
      const password = await ui.prompt(state.exists ? 'Unlock Vault' : 'Create Vault password', true);
      if (!password) return;
      await ui.client.call(state.exists ? 'vault.unlock' : 'vault.create', [password]);
      continue;
    }
    const list = await ui.client.call<VaultListDto>('vault.list');
    const selected = await ui.pick('Vault', [
      {value: '+', label: 'Add password'}, {value: 'lock', label: 'Lock'},
      {value: 'sync', label: 'Sync'}, {value: 'trash', label: 'Trash', status: String(list.trash.length)},
      ...list.items.map(item => ({value: item.id, label: item.title, description: item.username || item.url, status: item.pinned ? 'Pinned' : ''})),
    ]);
    if (!selected) return;
    if (selected === '+') {await editItem(ui); continue;}
    if (selected === 'lock') {await ui.client.call('vault.lock'); return;}
    if (selected === 'sync') {await ui.client.call('vault.sync'); continue;}
    if (selected === 'trash') {
      const id = await ui.pick('Trash', list.trash.map(item => ({value: item.id, label: item.title})));
      if (!id) continue;
      const action = await ui.pick('Deleted item', [{value: 'restore', label: 'Restore'}, {value: 'purge', label: 'Delete permanently'}]);
      if (action && (action === 'restore' || await confirm(ui, 'Permanently delete this item?')))
        await ui.client.call(`vault.${action}`, [[id]]);
      continue;
    }
    const item = list.items.find(i => i.id === selected);
    if (!item) continue;
    const action = await ui.pick(item.title, [
      {value: 'details', label: 'Details'}, {value: 'reveal', label: 'Show password and codes'},
      {value: 'edit', label: 'Edit'}, {value: 'pin', label: item.pinned ? 'Unpin' : 'Pin'},
      {value: 'remove', label: 'Move to trash'},
    ]);
    if (action === 'details') await ui.show(item.title, `${item.username}\n${item.url}\n\n${item.notes}`);
    if (action === 'reveal') {
      const secret = await ui.client.call<VaultSecretsDto>('vault.reveal', [item.id]);
      await ui.show(item.title, `Password: ${secret.password || 'None'}\n\nCode: ${secret.totp?.code ?? 'None'}\n\nRecovery codes:\n${secret.recoveryCodes.join('\n')}`);
    }
    if (action === 'edit') await editItem(ui, item);
    if (action === 'pin') await ui.client.call('vault.pin', [[item.id], !item.pinned]);
    if (action === 'remove' && await confirm(ui, `Move ${item.title} to trash?`)) await ui.client.call('vault.remove', [item.id]);
  }
}

async function editItem(ui: WorkspaceUi, item?: VaultItemDto): Promise<void> {
  if (item) {
    const field = await ui.pick('Edit item', ['title', 'username', 'url', 'notes', 'password', 'totpSecret'].map(value => ({value, label: ({url: 'Website', totpSecret: 'Authenticator secret'} as Record<string, string>)[value] ?? value[0].toUpperCase() + value.slice(1)})));
    if (!field) return;
    const value = await ui.prompt(`New ${field}`, ['password', 'totpSecret'].includes(field));
    if (value === undefined) return;
    await ui.client.call('vault.save', [{id: item.id, title: item.title, username: item.username,
      url: item.url, notes: item.notes, groupName: item.groupName, [field]: value}]);
    return;
  }
  const title = await ui.prompt('Title');
  if (!title?.trim()) return;
  const username = await ui.prompt('Username');
  if (username === undefined) return;
  const password = await ui.prompt('Password', true);
  if (password === undefined) return;
  const input: VaultItemInputDto = {title, username, password};
  await ui.client.call('vault.save', [input as unknown as JsonValue]);
}
