import {type Page, expect, test} from '@playwright/test';

async function getPinnedChatIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const value = JSON.parse(localStorage.getItem('polymuxChatPins') ?? '{}');
    return Array.isArray(value?.chats) ? value.chats : [];
  });
}

test('pins chats and folders, persists them, and keeps disclosure arrows beside labels', async ({page}, info) => {
  await page.goto('/?coldStart=0');
  await page.evaluate(() => localStorage.setItem('polymuxChatFolders', JSON.stringify([
    {id: 'pin-folder', name: 'Favourite folder', collapsed: false, chatIds: []},
    {id: 'other-folder', name: 'Other folder', collapsed: false, chatIds: []},
  ])));
  await page.reload();
  const drawer = page.locator('aside.chat-drawer');
  await drawer.locator('.chat-drawer-folder-row').filter({hasText: 'Favourite folder'}).click({button: 'right'});
  await drawer.getByRole('menuitem', {name: 'Pin Folder', exact: true}).click();
  const pinned = drawer.getByRole('list', {name: 'Pinned', exact: true});
  await expect(pinned.getByText('Favourite folder', {exact: true})).toBeVisible();
  const title = 'Planning a product launch';
  const pinnedChat = drawer.locator('.chat-drawer-row').filter({has: page.getByRole('button', {name: `Open chat: ${title}`, exact: true})});
  const researchTitle = 'Research notes';
  const researchRow = drawer.locator('.chat-drawer-row').filter({has: page.getByRole('button', {name: `Open chat: ${researchTitle}`, exact: true})});

  await pinnedChat.click({button: 'right'});
  await drawer.getByRole('menuitem', {name: 'Pin Chat', exact: true}).click();
  await expect(pinned.getByText(title, {exact: true})).toBeVisible();
  await expect(pinned.getByRole('button', {name: `Open chat: ${title}`, exact: true})).toBeVisible();

  await expect.poll(() => getPinnedChatIds(page)).toEqual(expect.arrayContaining(['welcome']));

  await researchRow.dragTo(pinned);
  await expect.poll(() => getPinnedChatIds(page)).toHaveLength(2);
  await expect(pinned.getByRole('button', {name: `Open chat: ${researchTitle}`, exact: true})).toBeVisible();
  await expect.poll(() => getPinnedChatIds(page)).toEqual(expect.arrayContaining(['welcome', 'research']));

  const pinnedResearchRow = pinned.locator('.chat-drawer-row').filter({has: page.getByRole('button', {name: `Open chat: ${researchTitle}`, exact: true})});
  await pinnedResearchRow.dragTo(pinned);
  await expect.poll(() => getPinnedChatIds(page)).toHaveLength(2);
  await expect.poll(() => getPinnedChatIds(page)).toEqual(expect.arrayContaining(['welcome', 'research']));

  const otherFolder = drawer.locator('.chat-drawer-folder-row').filter({hasText: 'Other folder'});
  await pinnedResearchRow.dragTo(otherFolder);
  await expect.poll(() => getPinnedChatIds(page)).toEqual(['welcome']);
  await expect.poll(() => page.evaluate(() => {
    const folders = JSON.parse(localStorage.getItem('polymuxChatFolders') ?? '[]');
    return folders.find((f: {id: string}) => f.id === 'other-folder')?.chatIds ?? [];
  })).toEqual(['research']);
  await expect(otherFolder.locator('..').getByRole('button', {name: `Open chat: ${researchTitle}`, exact: true})).toBeVisible();
  await expect(pinned.getByRole('button', {name: `Open chat: ${researchTitle}`, exact: true})).toHaveCount(0);

  const pinnedWelcomeRow = pinned.locator('.chat-drawer-row').filter({has: page.getByRole('button', {name: `Open chat: ${title}`, exact: true})});
  const unfiledSection = drawer.locator('.chat-drawer-group').filter({hasText: 'Chats'});
  await pinnedWelcomeRow.dragTo(unfiledSection);
  await expect.poll(() => getPinnedChatIds(page)).toEqual([]);
  await expect(pinned.getByRole('button', {name: `Open chat: ${title}`, exact: true})).toHaveCount(0);
  await expect(unfiledSection.getByRole('button', {name: `Open chat: ${title}`, exact: true})).toBeVisible();

  // Re-pin welcome chat so persistence and unpin flows remain fully exercised
  const unfiledWelcomeRow = unfiledSection.locator('.chat-drawer-row').filter({has: page.getByRole('button', {name: `Open chat: ${title}`, exact: true})});
  await unfiledWelcomeRow.dragTo(drawer.getByRole('button', {name: 'Pinned', exact: true}));
  await expect.poll(() => getPinnedChatIds(page)).toEqual(['welcome']);
  await expect(pinned.getByRole('button', {name: `Open chat: ${title}`, exact: true})).toBeVisible();

  for (const button of await drawer.locator('.chat-drawer-group-toggle').all()) {
    const labelText = (await button.locator('span').innerText()).trim();
    if (!labelText) continue;
    const label = await button.locator('span').boundingBox();
    const arrow = await button.locator('svg').boundingBox();
    expect(label).not.toBeNull();
    expect(arrow).not.toBeNull();
    expect(arrow!.x - label!.x - label!.width).toBeGreaterThanOrEqual(0);
  }
  await page.screenshot({path: info.outputPath('pinned-drawer.png')});
  await page.reload();
  if (!await drawer.isVisible()) await page.getByRole('button', {name: 'Toggle Chats'}).click();
  await expect(pinned.getByText(title, {exact: true})).toBeVisible();
  await expect(drawer.locator('.chat-drawer-folder-row').filter({hasText: 'Other folder'}).locator('..').getByRole('button', {name: `Open chat: ${researchTitle}`, exact: true})).toBeVisible();
  await pinned.getByText(title, {exact: true}).click({button: 'right'});
  await drawer.getByRole('menuitem', {name: 'Unpin', exact: true}).click();
  await expect(pinned.getByText(title, {exact: true})).toHaveCount(0);
  await expect(drawer.getByText(title, {exact: true})).toHaveCount(1);
  await pinned.getByText('Favourite folder', {exact: true}).click({button: 'right'});
  await drawer.getByRole('menuitem', {name: 'Unpin', exact: true}).click();
  await expect(pinned).toHaveCount(0);
  await expect(drawer.getByRole('list', {name: 'Folders', exact: true}).getByText('Favourite folder')).toBeVisible();
});
