import {expect, test} from '@playwright/test';

/**
 * A Host is drawn with its own kind wherever it is named, so the laptop in the
 * list is not confused with the Linux server beside it.
 */
test('names the Host device kind in Runs on and the conversation header', async ({page}) => {
  await page.goto('/?coldStart=0');
  const drawer = page.locator('aside.chat-drawer');
  await drawer.getByRole('button', {name: 'Team', exact: true}).click();
  await drawer.getByRole('button', {name: 'Open Maya, Product researcher'}).click();
  const header = page.locator('.team-conversation-title-bar .team-identity');
  await expect(header.locator('span [data-icon="laptop"]')).toHaveCount(1);

  await drawer.getByRole('button', {name: 'Options for Maya', exact: true}).click();
  await page.getByRole('menu', {name: 'Options for Maya', exact: true}).getByRole('menuitem', {name: 'Edit', exact: true}).click();
  const editor = page.locator('aside.workspace-drawer').getByRole('region', {name: 'Edit Maya'});
  const host = editor.getByRole('button', {name: 'Bot Host'});
  await expect(host.locator('[data-icon="laptop"]')).toHaveCount(1);

  await host.click();
  const menu = page.getByRole('menu', {name: 'Bot Host'});
  await expect(menu.getByRole('menuitemradio', {name: 'This Mac · This computer', exact: true}).locator('[data-icon="laptop"]')).toHaveCount(1);
  await expect(menu.getByRole('menuitemradio', {name: 'Studio Linux', exact: true}).locator('[data-icon="server"]')).toHaveCount(1);
  await menu.getByRole('menuitemradio', {name: 'Studio Linux', exact: true}).click();
  await expect(host.locator('[data-icon="server"]')).toHaveCount(1);

  await editor.getByRole('button', {name: 'Save'}).click();
  await expect(editor).toHaveCount(0);
  await expect(header.locator('span [data-icon="server"]')).toHaveCount(1);
  await expect(header.locator('span')).toContainText('Studio Linux');
});
