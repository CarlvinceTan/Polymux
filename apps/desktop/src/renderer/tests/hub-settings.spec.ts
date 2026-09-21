import {expect, test} from '@playwright/test';

for (const theme of ['light', 'dark']) {
  test(`Hub settings stays beneath Contacts and saves privacy and account changes (${theme})`, async ({page}, info) => {
    await page.goto('/?coldStart=0');
    await expect(page.locator('#startup-splash')).toHaveCount(0);
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.getByRole('button', {name: 'Toggle Workspace', exact: true}).click();
    await page.locator('.workspace-launcher-row', {hasText: 'Hub'}).click();
    const view = page.locator('.hub-view');
    const settings = view.getByRole('button', {name: 'Hub settings', exact: true});
    const contacts = view.getByRole('button', {name: 'Contacts', exact: true});
    const [s, c] = await Promise.all([settings.boundingBox(), contacts.boundingBox()]);
    expect(s!.y).toBeGreaterThan(c!.y + c!.height);
    expect(Math.abs(s!.x + s!.width / 2 - c!.x - c!.width / 2)).toBeLessThan(1);
    await settings.click();
    const pane = view.getByRole('region', {name: 'Hub settings'});
    await expect(pane).toBeVisible();
    const toggle = pane.getByRole('switch', {name: 'Enable Hub incognito mode'});
    await expect(toggle).toBeEnabled();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await contacts.click();
    await expect(pane).toHaveCount(0);
    await settings.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', {name: 'Toggle Chats', exact: true}).click();
    await page.setViewportSize({width: 420, height: 780});
    // The rail folds into a platform picker at this width, and Mail stays the
    // platform the pane is showing.
    const picker = pane.getByRole('tablist', {name: 'Account platform'});
    await expect(picker).toBeVisible();
    await expect(picker.getByRole('tab', {name: 'WeChat', exact: true})).toBeVisible();
    await expect(picker.getByRole('tab', {name: 'Mail', exact: true})).toHaveAttribute('aria-selected', 'true');
    await pane.getByRole('button', {name: 'Add mailbox', exact: true}).click();
    await pane.getByLabel('Account name', {exact: true}).fill('fixture');
    await pane.getByLabel('Email address', {exact: true}).fill('fixture@example.com');
    await pane.getByLabel('Display name', {exact: true}).fill('A long account name to check the Hub settings layout');
    await pane.getByLabel('Password', {exact: true}).fill('synthetic-only');
    await expect(pane.getByRole('button', {name: 'Save mailbox', exact: true})).toBeEnabled();
    await pane.screenshot({path: info.outputPath('hub-settings-form.png'), animations: 'disabled'});
    expect(await pane.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    await pane.getByRole('button', {name: 'Save mailbox', exact: true}).click();
    await expect(pane.getByText('fixture@example.com', {exact: true})).toBeVisible();
    await page.setViewportSize({width: 1280, height: 900});
    await page.getByRole('button', {name: 'Expand Workspace', exact: true}).click();
    await expect(pane.locator('.comms-rail-column')).toBeVisible();
    await expect(picker).toBeHidden();
    await pane.screenshot({path: info.outputPath('hub-settings-expanded.png'), animations: 'disabled'});
  });
}
