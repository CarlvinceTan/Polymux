import {expect, test} from '@playwright/test';

test('shares from the chat menu and response action with a readonly copy link', async ({page, context}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const payloads: any[] = [];
  const url = `https://polymux.com/share/${'a'.repeat(32)}`;
  await page.route('https://polymux.com/api/shares', async route => {
    payloads.push(route.request().postDataJSON());
    await route.fulfill({status: 201, contentType: 'application/json', body: JSON.stringify({url, expiresAt: Date.now() + 86400000})});
  });
  await page.goto('/?coldStart=0');
  const drawer = page.locator('aside.chat-drawer');
  for (const toggle of await drawer.locator('.chat-drawer-group-toggle').all())
    if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  await drawer.getByRole('button', {name: 'More actions: Planning a product launch', exact: true}).click();
  await page.getByRole('menuitem', {name: 'Share', exact: true}).click();
  const modal = page.getByRole('dialog', {name: 'Share conversation'});
  const input = modal.getByRole('textbox', {name: 'Share link'});
  await expect(input).toHaveValue(url);
  await expect(input).toHaveAttribute('readonly', '');
  expect(payloads[0].messages).toHaveLength(2);
  await modal.getByRole('button', {name: 'Copy link'}).click();
  await expect(modal.getByRole('button', {name: 'Copied', exact: true})).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  await expect(page.locator('.share-backdrop')).toHaveCSS('opacity', '1');
  await modal.screenshot({path: '/tmp/polymux-share-modal.png'});
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  await drawer.getByRole('button', {name: 'Open chat: Planning a product launch', exact: true}).click();
  await page.locator('.message-actions').getByRole('button', {name: 'Share', exact: true}).click();
  await expect(input).toHaveValue(url);
  expect(payloads[1].messages).toHaveLength(2);
  expect(payloads[1].messages.at(-1).role).toBe('assistant');
});
