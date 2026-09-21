import {expect, test, type Page} from '@playwright/test';

async function editMaya(page: Page, query = '') {
  await page.goto(`/?coldStart=0&splashSettled=1${query}`);
  const drawer = page.locator('aside.chat-drawer');
  await drawer.getByRole('button', {name: 'Team', exact: true}).click();
  await drawer.getByRole('button', {name: /Open Maya, Product researcher/}).click();
  await page.getByRole('button', {name: 'Edit bot Maya', exact: true}).click();
  return page.locator('aside.workspace-drawer').getByRole('region', {name: 'Edit Maya', exact: true});
}

test('saves access per configured device and leaves other devices allowed', async ({page}) => {
  let dialog = await editMaya(page);
  const local = () => dialog.getByRole('button', {name: 'Access to This Mac', exact: true});
  const remote = () => dialog.getByRole('button', {name: 'Access to Studio Linux', exact: true});
  await expect(local()).toHaveText('Allowed');
  await expect(remote()).toHaveText('Allowed');
  await local().click();
  await page.getByRole('menu', {name: 'Access to This Mac', exact: true}).getByRole('menuitemradio', {name: 'Ask', exact: true}).click();
  await expect(local()).toHaveText('Ask');
  await expect(remote()).toHaveText('Allowed');
  await remote().click();
  await page.getByRole('menu', {name: 'Access to Studio Linux', exact: true}).getByRole('menuitemradio', {name: 'Blocked', exact: true}).click();
  await dialog.getByRole('button', {name: 'Save', exact: true}).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', {name: 'Edit bot Maya', exact: true}).click();
  dialog = page.locator('aside.workspace-drawer').getByRole('region', {name: 'Edit Maya', exact: true});
  await expect(local()).toHaveText('Ask');
  await expect(remote()).toHaveText('Blocked');
  await local().click();
  await page.getByRole('menu', {name: 'Access to This Mac', exact: true}).getByRole('menuitemradio', {name: 'Allowed', exact: true}).click();
  await dialog.getByRole('button', {name: 'Cancel', exact: true}).click();
  await page.getByRole('button', {name: 'Edit bot Maya', exact: true}).click();
  await expect(local()).toHaveText('Ask');
});

test('keeps offline device restrictions editable with long names at narrow widths', async ({page}) => {
  const dialog = await editMaya(page, '&teamDevices=varied');
  const remoteRow = dialog.locator('[data-device-id="demo-studio-host"]');
  await expect(remoteRow.getByText('Offline', {exact: true})).toBeVisible();
  for (const theme of ['light', 'dark']) {
    await page.locator('html').evaluate((element, value) => element.setAttribute('data-theme', value), theme);
    await page.setViewportSize({width: 390, height: 700});
    await remoteRow.scrollIntoViewIfNeeded();
    const menuButton = remoteRow.getByRole('button');
    await menuButton.click();
    const menu = page.getByRole('menu', {name: /Access to Studio workstation/});
    await expect(menu.getByRole('menuitemradio')).toHaveText(['Allowed', 'Ask', 'Blocked']);
    const bounds = await menu.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    await menu.getByRole('menuitemradio', {name: 'Ask', exact: true}).click();
    expect(await remoteRow.evaluate((row) => row.scrollWidth <= row.clientWidth)).toBe(true);
    expect(await remoteRow.locator('.team-access-device-copy strong').evaluate((name) => name.scrollWidth > name.clientWidth)).toBe(true);
  }
});

test('keeps the chosen policy visible after a failed save', async ({page}) => {
  const dialog = await editMaya(page, '&teamSave=fail');
  const local = dialog.getByRole('button', {name: 'Access to This Mac', exact: true});
  await local.click();
  await page.getByRole('menu', {name: 'Access to This Mac', exact: true}).getByRole('menuitemradio', {name: 'Blocked', exact: true}).click();
  await dialog.getByRole('button', {name: 'Save', exact: true}).click();
  await expect(dialog.getByRole('alert')).toContainText('Could not save device access');
  await expect(local).toHaveText('Blocked');
});
