import {readFileSync} from 'node:fs';
import {expect, test} from '@playwright/test';

const currentVersion = (JSON.parse(
  readFileSync(new URL('../../../../../package.json', import.meta.url), 'utf8'),
) as {version: string}).version;

test('opens an updated version in the workspace Browser exactly once', async ({page}) => {
  await page.goto('/?releaseNotesPreview=1&coldStart=0');

  const drawer = page.locator('aside.workspace-drawer');
  await expect(drawer).toHaveClass(/open/);
  await expect(drawer.locator('.tab.active')).toContainText(`Polymux ${currentVersion} release notes`);
  await expect(drawer.getByRole('combobox', {name: 'Address'})).toHaveValue(
    `https://polymux.com/releases/${currentVersion}/`,
  );

  await page.reload();
  await expect(drawer).not.toHaveClass(/open/);
  await expect(drawer.locator('.tab')).toHaveCount(0);
});
