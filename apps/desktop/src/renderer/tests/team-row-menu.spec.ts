import {expect, test} from '@playwright/test';

for (const theme of ['light', 'dark'] as const) {
  test(`Team row Edit and Delete target the selected bot in ${theme}`, async ({page}, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/?coldStart=0');
    await page.getByRole('button', {name: 'Settings', exact: true}).click();
    const settings = page.getByRole('region', {name: 'Settings'});
    await settings.getByRole('radiogroup', {name: 'Theme'}).getByRole('radio', {name: theme === 'light' ? 'Light' : 'Dark', exact: true}).click();
    await page.getByRole('button', {name: 'Close Settings'}).click();
    const drawer = page.locator('aside.chat-drawer');
    await drawer.getByRole('button', {name: 'Team', exact: true}).click();
    const options = drawer.getByRole('button', {name: 'Options for Maya', exact: true});
    await options.click();
    const menu = drawer.getByRole('menu', {name: 'Options for Maya', exact: true});
    await menu.getByRole('menuitem', {name: 'Edit', exact: true}).click();
    const editor = page.getByRole('dialog', {name: 'Edit Maya', exact: true});
    await expect(editor).toBeVisible();
    await expect(menu).toHaveCount(0);
    await expect(editor.getByRole('textbox', {name: 'Name', exact: true})).toHaveValue('Maya');
    await editor.getByRole('button', {name: 'Cube shape', exact: true}).click();
    await editor.getByRole('button', {name: 'Pink colour', exact: true}).click();
    await expect(editor.getByRole('button', {name: 'Cube shape', exact: true})).toHaveClass(/selected/);
    await editor.locator('.team-avatar-preview').screenshot({path: info.outputPath(`cube-${theme}.png`), animations: 'disabled'});
    await editor.getByRole('textbox', {name: 'Role', exact: true}).fill('Menu regression check');
    await editor.getByRole('button', {name: 'Save', exact: true}).click();
    await expect(editor).toHaveCount(0);
    await expect(drawer.getByRole('button', {name: 'Open Maya, Menu regression check', exact: true})).toBeVisible();
    await options.click();
    await menu.getByRole('menuitem', {name: 'Edit', exact: true}).click();
    await expect(editor.getByRole('textbox', {name: 'Role', exact: true})).toHaveValue('Menu regression check');
    await expect(editor.getByRole('button', {name: 'Cube shape', exact: true})).toHaveClass(/selected/);
    await editor.getByRole('button', {name: 'Cancel', exact: true}).click();

    await options.click();
    const confirmation = page.waitForEvent('dialog');
    const deletion = menu.getByRole('menuitem', {name: 'Delete', exact: true}).click();
    const dialog = await confirmation;
    expect(dialog.message()).toBe('Delete Maya and their private conversation?');
    await dialog.dismiss();
    await deletion;
    await expect(options).toBeVisible();
    await expect(menu).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('configures bot connections from the pool in BotDialog', async ({page}) => {
  await page.goto('/?coldStart=0');
  const drawer = page.locator('aside.chat-drawer');
  await drawer.getByRole('button', {name: 'Team', exact: true}).click();
  const options = drawer.getByRole('button', {name: 'Options for Linus', exact: true});
  await options.click();
  const menu = drawer.getByRole('menu', {name: 'Options for Linus', exact: true});
  await menu.getByRole('menuitem', {name: 'Edit', exact: true}).click();
  const editor = page.getByRole('dialog', {name: 'Edit Linus', exact: true});
  await expect(editor).toBeVisible();

  const connectionsSection = editor.locator('.team-connections');
  await expect(connectionsSection).toBeVisible();
  await expect(connectionsSection.getByText('Connections')).toBeVisible();

  const pdfChip = connectionsSection.getByRole('button', {name: 'PDF', exact: true});
  const githubChip = connectionsSection.getByRole('button', {name: 'GitHub', exact: true});
  await expect(pdfChip).toBeVisible();
  await expect(githubChip).toBeVisible();

  await pdfChip.click();
  await expect(pdfChip).toHaveClass(/selected/);
  await expect(pdfChip).toHaveAttribute('aria-pressed', 'true');

  await githubChip.click();
  await expect(githubChip).toHaveClass(/selected/);
  await expect(githubChip).toHaveAttribute('aria-pressed', 'true');

  await editor.getByRole('button', {name: 'Save', exact: true}).click();
  await expect(editor).toHaveCount(0);

  // Re-open and verify selections persisted
  await options.click();
  await menu.getByRole('menuitem', {name: 'Edit', exact: true}).click();
  await expect(editor).toBeVisible();
  await expect(editor.locator('.team-connections').getByRole('button', {name: 'PDF', exact: true})).toHaveClass(/selected/);
  await expect(editor.locator('.team-connections').getByRole('button', {name: 'GitHub', exact: true})).toHaveClass(/selected/);
  await editor.getByRole('button', {name: 'Cancel', exact: true}).click();
});
