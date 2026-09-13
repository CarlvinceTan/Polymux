import {expect, test} from '@playwright/test';

for (const theme of ['light', 'dark']) {
  test(`chat duplication, folder submenu and dragging in ${theme}`, async ({page}, info) => {
    await page.addInitScript(() => localStorage.setItem('polymuxChatFolders', JSON.stringify([
      {id: 'work', name: 'Work', collapsed: false, chatIds: []},
      {id: 'personal', name: 'Personal', collapsed: false, chatIds: []},
    ])));
    await page.goto('/?coldStart=0');
    if (theme === 'dark') {
      await page.getByRole('button', {name: 'Settings', exact: true}).click();
      const settings = page.getByRole('region', {name: 'Settings'});
      await settings.getByRole('radiogroup', {name: 'Theme'}).getByRole('radio', {name: 'Dark', exact: true}).click();
      await page.getByRole('button', {name: 'Close Settings'}).click();
    }
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

    const drawer = page.locator('aside.chat-drawer');
    const title = 'Planning a product launch';
    const row = drawer.locator('.chat-drawer-row').filter({has: page.getByRole('button', {name: `Open chat: ${title}`, exact: true})});
    await row.locator('.chat-drawer-more').click();
    const main = drawer.locator('.chat-drawer-row-menu').first();
    await expect(main.getByRole('menuitem', {name: 'Duplicate', exact: true})).toBeVisible();
    await expect(main.getByRole('menuitem', {name: 'Work', exact: true})).toHaveCount(0);
    const move = main.getByRole('menuitem', {name: 'Move to folder', exact: true});
    await move.hover();
    const sub = drawer.getByRole('menu', {name: 'Move to folder', exact: true});
    await expect(sub).toBeVisible();
    const a = await main.boundingBox(), b = await sub.boundingBox();
    expect(b!.x).toBeGreaterThan(a!.x + a!.width);
    await page.waitForTimeout(1000);
    await page.screenshot({path: info.outputPath(`chat-menu-${theme}.png`)});
    await move.focus();
    await page.keyboard.press('ArrowRight');
    await expect(sub.getByRole('menuitem', {name: 'Work', exact: true})).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(sub).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('polymuxChatFolders')!)[0].chatIds)).toEqual(['welcome']);

    await row.dragTo(drawer.locator('.chat-drawer-folder-row').filter({hasText: 'Personal'}));
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('polymuxChatFolders')!)[1].chatIds)).toEqual(['welcome']);

    await row.locator('.chat-drawer-more').click();
    await drawer.getByRole('menuitem', {name: 'Duplicate', exact: true}).click();
    await expect(page.getByText('Help me outline a simple launch plan.', {exact: true})).toBeVisible();

    const unfiledTarget = drawer.getByRole('list', {name: 'Chats', exact: true});
    const folderedRow = drawer.locator('.chat-drawer-row').filter({has: page.getByRole('button', {name: `Open chat: ${title}`, exact: true})});
    await folderedRow.dragTo(unfiledTarget);
    // Duplicating keeps the copy in the same folder; dragging the original
    // must remove only that original and preserve the copy.
    await expect.poll(() => page.evaluate(() => {
      const ids: string[] = JSON.parse(localStorage.getItem('polymuxChatFolders')!)[1].chatIds;
      return {hasOriginal: ids.includes('welcome'), remaining: ids.length};
    })).toEqual({hasOriginal: false, remaining: 1});
    await expect(unfiledTarget.locator('.chat-drawer-row').filter({has: page.getByRole('button', {name: `Open chat: ${title}`, exact: true})}).first()).toBeVisible();

    // Pin the welcome chat
    const unfiledRow = unfiledTarget.locator('.chat-drawer-row').filter({has: page.getByRole('button', {name: `Open chat: ${title}`, exact: true})}).first();
    await unfiledRow.click({button: 'right'});
    await drawer.getByRole('menuitem', {name: 'Pin Chat', exact: true}).click();
    const pinnedList = drawer.getByRole('list', {name: 'Pinned', exact: true});
    await expect(pinnedList.getByRole('button', {name: `Open chat: ${title}`, exact: true})).toBeVisible();

    // Drag from pinned to a folder row -> unpins and transfers into folder
    const pinnedRow = pinnedList.locator('.chat-drawer-row').filter({has: page.getByRole('button', {name: `Open chat: ${title}`, exact: true})});
    const personalFolder = drawer.locator('.chat-drawer-folder-row').filter({hasText: 'Personal'});
    await pinnedRow.dragTo(personalFolder);
    await expect.poll(() => page.evaluate(() => {
      const pins = JSON.parse(localStorage.getItem('polymuxChatPins') ?? '{}');
      const folders = JSON.parse(localStorage.getItem('polymuxChatFolders') ?? '[]');
      return {
        pinned: pins?.chats?.includes('welcome') ?? false,
        personal: folders[1]?.chatIds?.includes('welcome') ?? false,
      };
    })).toEqual({pinned: false, personal: true});
    await expect(pinnedList.getByRole('button', {name: `Open chat: ${title}`, exact: true})).toHaveCount(0);
    await expect(personalFolder.locator('..').getByRole('button', {name: `Open chat: ${title}`, exact: true})).toBeVisible();

    // Re-pin from folder
    const folderChatRow = personalFolder.locator('..').locator('.chat-drawer-row').filter({has: page.getByRole('button', {name: `Open chat: ${title}`, exact: true})});
    await folderChatRow.click({button: 'right'});
    await drawer.getByRole('menuitem', {name: 'Pin Chat', exact: true}).click();
    await expect(pinnedList.getByRole('button', {name: `Open chat: ${title}`, exact: true})).toBeVisible();

    // Drag from pinned to unfiled Chats section title button -> unpins and transfers to unfiled Chats
    const rePinnedRow = pinnedList.locator('.chat-drawer-row').filter({has: page.getByRole('button', {name: `Open chat: ${title}`, exact: true})});
    const chatsHeading = drawer.getByRole('button', {name: 'Chats', exact: true});
    await rePinnedRow.dragTo(chatsHeading);
    await expect.poll(() => page.evaluate(() => {
      const pins = JSON.parse(localStorage.getItem('polymuxChatPins') ?? '{}');
      const folders = JSON.parse(localStorage.getItem('polymuxChatFolders') ?? '[]');
      return {
        pinned: pins?.chats?.includes('welcome') ?? false,
        foldered: folders.some((f: {chatIds: string[]}) => f.chatIds.includes('welcome')),
      };
    })).toEqual({pinned: false, foldered: false});
    await expect(pinnedList.getByRole('button', {name: `Open chat: ${title}`, exact: true})).toHaveCount(0);
    const finalRow = unfiledTarget.locator('.chat-drawer-row').filter({has: page.getByRole('button', {name: `Open chat: ${title}`, exact: true})}).first();
    await expect(finalRow).toBeVisible();

    const unfiledSection = drawer.locator('.chat-drawer-group').filter({hasText: 'Chats'});
    const sectionBox = await unfiledSection.boundingBox();
    const rowBox = await finalRow.boundingBox();
    const groupsBox = await drawer.locator('.chat-drawer-groups').boundingBox();
    expect(sectionBox).not.toBeNull();
    expect(rowBox).not.toBeNull();
    expect(groupsBox).not.toBeNull();
    expect(sectionBox!.width).toBeGreaterThanOrEqual(rowBox!.width);
    expect(sectionBox!.x).toBeGreaterThanOrEqual(groupsBox!.x);
    expect(sectionBox!.x + sectionBox!.width).toBeLessThanOrEqual(groupsBox!.x + groupsBox!.width);
    const outlineStyle = await unfiledSection.evaluate((node) => getComputedStyle(node).outlineStyle);
    expect(outlineStyle).toBe('none');

    await expect(row).toBeVisible();
  });
}
