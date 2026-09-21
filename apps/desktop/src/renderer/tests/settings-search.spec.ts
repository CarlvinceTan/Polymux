import {expect, test} from '@playwright/test';

for (const width of [1340, 640]) {
  for (const theme of ['Light', 'Dark'] as const) {
    test(`settings search finds nested controls at ${width}px in ${theme.toLowerCase()} mode`, async ({page}, testInfo) => {
      await page.setViewportSize({width, height: 859});
      await page.goto('/?coldStart=0&splashSettled=1');
      await page.getByRole('button', {name: 'Settings', exact: true}).click();
      const settings = page.getByRole('region', {name: 'Settings', exact: true});
      await expect(settings).toBeVisible();

      const search = settings.getByRole('searchbox', {name: 'Search settings...', exact: true});
      const back = settings.getByRole('button', {name: 'Back to Settings', exact: true});
      await expect(back.or(search)).toBeVisible();
      if (await back.isVisible()) await back.click();
      await expect(search).toBeVisible();
      await settings.getByRole('tab', {name: 'Appearance', exact: true}).click();
      await settings.getByRole('radiogroup', {name: 'Theme'}).getByRole('radio', {name: theme, exact: true}).click();
      if (width === 640) await expect(back).toBeVisible();
      if (await back.isVisible()) await back.click();
      await expect(search).toBeVisible();

      await search.fill('no such setting');
      await expect(settings.locator('.options-nav-empty')).toHaveText('No settings found');

      await search.fill('interface uses');
      const described = settings.locator('.options-nav-result').filter({hasText: 'Language'});
      await expect(described).toHaveCount(1);
      await expect(described).toBeVisible();

      await search.fill('Top bar');
      const result = settings.locator('.options-nav-result').filter({hasText: 'Top bar'});
      await expect(result).toHaveCount(1);
      await expect(result).toBeVisible();
      await settings.screenshot({path: testInfo.outputPath('search-results.png'), animations: 'disabled'});
      await result.click();

      await expect(settings.getByRole('heading', {name: 'Appearance', exact: true})).toBeVisible();
      const target = settings.locator('[data-settings-search-id="appearance-top-bar"]');
      await expect(target).toBeVisible();
      await expect(target).toHaveClass(/settings-search-highlight/);
      await settings.screenshot({path: testInfo.outputPath('found-target.png')});
      if (width === 640) {
        await back.click();
        await expect(search).toBeVisible();
      }
      await expect(search).toHaveValue('');
      expect(await settings.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    });
  }
}
