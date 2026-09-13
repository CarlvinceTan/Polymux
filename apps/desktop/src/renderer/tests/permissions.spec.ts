import {expect, test} from '@playwright/test';

for (const theme of ['light', 'dark'] as const) {
  test(`permission links, independent grants and return from Settings in ${theme}`, async ({page}, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({width: 1200, height: 1000});
    await page.goto('/?coldStart=0&splashSettled=1&permissions=preview');
    await page.getByRole('button', {name: 'Settings', exact: true}).click();
    const settings = page.getByRole('region', {name: 'Settings'});
    await settings.getByRole('radiogroup', {name: 'Theme'}).getByRole('radio', {name: theme === 'light' ? 'Light' : 'Dark', exact: true}).click();
    await settings.getByRole('tab', {name: 'Permissions', exact: true}).click();
    const permissions = settings.getByRole('tabpanel');
    for (const name of ['Microphone', 'Accessibility', 'Screen recording', 'Full Disk Access', 'Enable app access']) {
      await expect(permissions.getByRole('switch', {name, exact: true})).toHaveCount(0);
    }
    await expect(permissions.getByRole('button', {name: 'Allow', exact: true})).toHaveCount(0);
    const screen = permissions.locator('[data-permission="screen-recording"]');
    await expect(screen.getByRole('heading')).toHaveText('Screen recording');
    await expect(permissions.locator('[data-permission="accessibility"]').getByRole('heading')).toHaveText('Accessibility');
    await expect(permissions.getByRole('heading', {name: 'Screen reading', exact: true})).toHaveCount(0);
    await expect(screen.getByRole('status')).toHaveText('Missing');
    await screen.getByRole('button', {name: 'Open Screen Recording', exact: true}).click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('polymux.demo.permission.opened'))).toBe('screen-recording');
    await expect(permissions.getByRole('heading', {name: 'App Access', exact: true})).toHaveCount(0);
    await expect(permissions.getByRole('button', {name: 'Review App Access'})).toHaveCount(0);
    await permissions.screenshot({path: testInfo.outputPath(`missing-${theme}.png`), animations: 'disabled'});

    // A grant changed in another application is reflected when Polymux regains focus.
    await page.evaluate(() => {
      localStorage.setItem('polymux.demo.permission.screen-recording', 'granted');
      window.dispatchEvent(new Event('focus'));
    });
    await expect(screen.getByRole('status')).toHaveText('Granted');
    await expect(screen.getByRole('button')).toHaveCount(0);
    const accessibility = permissions.locator('[data-permission="accessibility"]');
    await expect(accessibility.getByRole('status')).toHaveText('Missing');
    await accessibility.getByRole('button', {name: 'Open Accessibility'}).click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('polymux.demo.permission.opened'))).toBe('accessibility');
    await permissions.screenshot({path: testInfo.outputPath(`partial-${theme}.png`), animations: 'disabled'});

    await page.evaluate(() => {
      for (const kind of ['microphone', 'accessibility', 'full-disk-access']) localStorage.setItem(`polymux.demo.permission.${kind}`, 'granted');
      window.dispatchEvent(new Event('focus'));
    });
    for (const name of ['Microphone', 'Accessibility', 'Screen recording', 'Full Disk Access']) {
      const row = permissions.locator('.general-setting-row').filter({has: page.getByRole('heading', {name, exact: true})});
      await expect(row.getByRole('status')).toHaveText('Granted');
      await expect(row.getByRole('button')).toHaveCount(0);
    }
    await permissions.screenshot({path: testInfo.outputPath(`granted-${theme}.png`), animations: 'disabled'});
    await page.setViewportSize({width: 640, height: 1000});
    await page.evaluate(() => {
      localStorage.setItem('polymux.demo.permission.screen-recording', 'unknown');
      window.dispatchEvent(new Event('focus'));
    });
    await expect(permissions.locator('[data-permission="screen-recording"]').getByRole('status')).toHaveText('Unknown');
    await permissions.screenshot({path: testInfo.outputPath(`narrow-${theme}.png`), animations: 'disabled'});
    expect(await settings.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}
