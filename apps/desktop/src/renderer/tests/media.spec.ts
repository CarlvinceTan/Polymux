import {expect, test} from '@playwright/test';

test('Media opens from the workspace as its own app', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name: 'Toggle Workspace', exact: true}).click();
  const launcher = page.locator('.workspace-launcher');
  await launcher.getByRole('button', {name: 'Media', exact: true}).click();

  const empty = page.locator('.new-tab-empty');
  await expect(empty.getByRole('heading', {name: 'Media'})).toBeVisible();
  await expect(empty.getByRole('button', {name: 'Open'})).toBeVisible();
});
