import {expect, test} from '@playwright/test';

test('fork copies through a response, duplicate copies all, both retain folder and increment titles', async ({page}, info) => {
  await page.addInitScript(() => localStorage.setItem('polymuxChatFolders', JSON.stringify([
    {id: 'work', name: 'Work', collapsed: false, chatIds: ['welcome']},
  ])));
  await page.goto('/?coldStart=0&forkChat=1');
  const source = 'Planning a product launch';
  const openSource = async () => page.getByRole('button', {name: `Open chat: ${source}`, exact: true}).click();
  const folder = page.locator('.chat-drawer-folder-row').filter({hasText: 'Work'}).locator('..');
  await openSource();
  await page.locator('.message.assistant').filter({hasText: 'First answer'}).getByRole('button', {name: 'Fork', exact: true}).click();
  await expect(folder.getByRole('button', {name: `Open chat: ${source} (1)`, exact: true})).toBeVisible();
  await expect(page.locator('.message')).toHaveCount(2);
  await expect(page.locator('.message.assistant')).toContainText('First answer');
  await expect(page.getByText('Later answer', {exact: true})).toHaveCount(0);
  await openSource();
  await page.locator('.message.assistant').filter({hasText: 'First answer'}).getByRole('button', {name: 'Fork', exact: true}).click();
  await expect(folder.getByRole('button', {name: `Open chat: ${source} (2)`, exact: true})).toBeVisible();
  const sourceRow = folder.locator('.chat-drawer-row').filter({has: page.getByRole('button', {name: `Open chat: ${source}`, exact: true})});
  await sourceRow.locator('.chat-drawer-more').click();
  const duplicate = page.getByRole('menuitem', {name: 'Duplicate', exact: true});
  await expect(duplicate.locator('svg')).toHaveAttribute('data-icon', 'copy-plus');
  await duplicate.click();
  await expect(folder.getByRole('button', {name: `Open chat: ${source} (3)`, exact: true})).toBeVisible();
  await expect(page.locator('.message')).toHaveCount(4);
  await expect(page.getByText('Later answer', {exact: true})).toBeVisible();
  await sourceRow.click({button: 'right'});
  await page.getByRole('menuitem', {name: 'Duplicate', exact: true}).click();
  await expect(folder.getByRole('button', {name: `Open chat: ${source} (4)`, exact: true})).toBeVisible();
  await expect(page.locator('.message')).toHaveCount(4);
  await page.waitForTimeout(500);
  await page.screenshot({path: info.outputPath('fork-and-duplicate.png')});
});
