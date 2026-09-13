import {expect, test} from '@playwright/test';

test('folder new-chat drafts stay separate across reload and send into their folder', async ({page}) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('polymuxChatFolders')) localStorage.setItem('polymuxChatFolders', JSON.stringify([
      {id: 'work', name: 'Work', collapsed: false, chatIds: []},
      {id: 'personal', name: 'Personal', collapsed: false, chatIds: []},
    ]));
  });
  await page.goto('/?coldStart=0');
  const drawer = page.locator('aside.chat-drawer');
  const editor = page.getByRole('textbox', {name: 'Message Polymux'});
  const open = async (name: string) => {
    const row = drawer.locator('.chat-drawer-folder-row').filter({hasText: name});
    await row.hover();
    await row.getByRole('button', {name: `New Chat: ${name}`, exact: true}).click();
  };
  await open('Work');
  await editor.fill('Work unfinished');
  await open('Personal');
  await expect(editor).toHaveText('');
  await editor.fill('Personal unfinished');
  await drawer.getByRole('button', {name: 'New Chat', exact: true}).click();
  await expect(editor).toHaveText('');
  await editor.fill('General unfinished');
  await open('Work');
  await expect(editor).toHaveText('Work unfinished');
  const search = await drawer.getByRole('button', {name: 'Search', exact: true}).boundingBox();
  const button = await drawer.getByRole('button', {name: 'New Chat: Work', exact: true}).boundingBox();
  expect(Math.abs(search!.x + search!.width / 2 + 1 - button!.x - button!.width / 2)).toBeLessThanOrEqual(1);
  await page.reload();
  await open('Personal');
  await expect(editor).toHaveText('Personal unfinished');
  await open('Work');
  await expect(editor).toHaveText('Work unfinished');
  await page.getByRole('button', {name: 'Send message', exact: true}).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('polymuxChatFolders')!)[0].chatIds.length)).toBe(1);
  await open('Work');
  await expect(editor).toHaveText('');
  await open('Personal');
  await expect(editor).toHaveText('Personal unfinished');
  await drawer.getByRole('button', {name: 'New Chat', exact: true}).click();
  await expect(editor).toHaveText('General unfinished');
});
