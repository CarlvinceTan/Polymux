import {expect, test} from '@playwright/test';

test('opens an updated version in the workspace Browser exactly once', async ({page}) => {
  await page.goto('/?releaseNotesPreview=1&coldStart=0');

  const drawer = page.locator('aside.workspace-drawer');
  await expect(drawer).toHaveClass(/open/);
  await expect(drawer.locator('.tab.active')).toContainText('Polymux 0.2.2 release notes');
  await expect(drawer.getByRole('combobox', {name: 'Address'})).toHaveValue(
    'https://polymux.com/releases/0.2.2/',
  );

  await page.reload();
  await expect(drawer).not.toHaveClass(/open/);
  await expect(drawer.locator('.tab')).toHaveCount(0);
});
