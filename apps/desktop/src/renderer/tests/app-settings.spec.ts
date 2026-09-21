import {expect, test} from '@playwright/test';

for (const theme of ['light', 'dark']) {
  test(`apps manage settings in their own workspace tab (${theme})`, async ({page}, info) => {
    await page.goto('/?coldStart=0&splashSettled=1');
    await expect(page.locator('#startup-splash')).toHaveCount(0);
    await page.getByRole('button', {name:'Settings', exact:true}).click();
    await page.getByRole('radio', {name:theme === 'light' ? 'Light' : 'Dark', exact:true}).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    if (await page.locator('.chat-drawer.open').count()) await page.getByRole('button', {name:'Toggle Chats', exact:true}).click();
    const drawer = page.locator('.workspace-drawer');
    // Terminal exposes no per-tab settings entry point.
    for (const name of ['Browser', 'Drive', 'Calendar', 'Hub', 'Tasks', 'Media', 'Mobile', 'Vault', 'IDE', 'Finance', 'Usage']) {
      await drawer.getByLabel('New tab', {exact:true}).click();
      await page.locator('.workspace-launcher').getByRole('button', {name, exact:true}).click();
      // The IDE only offers settings from its status bar once a project is open.
      if (name === 'IDE') {
        await page.getByRole('button', {name:'Open project', exact:true}).click();
        await expect(page.locator('.ide-tree-row').first()).toBeVisible();
      }
      const tabTitle = await drawer.locator('.tab.active .tab-main').innerText();
      if (name === 'Browser') {
        await drawer.getByRole('button', {name:'More', exact:true}).click();
        await drawer.getByRole('menuitem', {name:'Browser settings', exact:true}).click();
      } else if (name === 'Vault') {
        await drawer.getByRole('textbox', {name:'Master password', exact:true}).fill('review-pass');
        await drawer.getByRole('textbox', {name:'Confirm', exact:true}).fill('review-pass');
        await drawer.getByRole('button', {name:'Create Vault', exact:true}).click();
        await expect(drawer.getByRole('button', {name:'More', exact:true})).toBeVisible();
        await drawer.getByRole('button', {name:'More', exact:true}).click();
        await drawer.getByRole('menuitem', {name:'Settings', exact:true}).click();
      } else {
        await drawer.getByRole('button', {name:`${name} settings`, exact:true}).click();
      }
      const settings = drawer.getByRole('region', {name:`${name} settings`, exact:true});
      await expect(settings).toBeVisible();
      await expect(drawer.locator('.tab.active .tab-main')).toHaveText(tabTitle);
      if (name === 'Hub') {
        await expect(settings.getByRole('switch', {name:'Enable Hub incognito mode'})).toBeVisible();
        await drawer.getByRole('button', {name:'Contacts', exact:true}).click();
      } else {
        if (name === 'Browser') await expect(settings.locator('.browser-rail')).toBeVisible();
        if (name === 'Drive') await expect(settings.locator('.drive')).toBeVisible();
        if (name === 'Finance') await expect(settings.getByRole('heading', {name:'Bank connections', exact:true})).toBeVisible();
        if (name === 'Calendar') await expect(settings.getByRole('button', {name:'Manage accounts…', exact:true})).toBeVisible();
        await settings.screenshot({path:info.outputPath(`${name.toLowerCase()}-settings.png`)});
        await settings.getByRole('button', {name:`Back to ${name}`, exact:true}).click();
        await expect(settings).toHaveCount(0);
        if (name === 'Browser') {
          await drawer.getByRole('button', {name:'More', exact:true}).click();
          await expect(drawer.getByRole('menuitem', {name:'Browser settings', exact:true})).toBeVisible();
          await drawer.getByRole('button', {name:'More', exact:true}).click();
        } else if (name === 'Vault') {
          await drawer.getByRole('button', {name:'More', exact:true}).click();
          await expect(drawer.getByRole('menuitem', {name:'Settings', exact:true})).toBeVisible();
          await drawer.getByRole('button', {name:'More', exact:true}).click();
        } else {
          await expect(drawer.getByRole('button', {name:`${name} settings`, exact:true})).toBeVisible();
        }
      }
    }
  });
}

test('Connections opens item details without replacing the app tab', async ({page}) => {
  await page.goto('/?coldStart=0&splashSettled=1');
  await page.getByRole('button', {name:'Connections', exact:true}).click();
  const connections = page.getByRole('region', {name:'Connections', exact:true});
  const activeTab = page.locator('.workspace-drawer .tab.active');
  await expect(activeTab).toContainText('Connections');
  await connections.getByRole('button', {name:/Documents/}).first().click();
  const dialog = page.getByRole('dialog', {name:'Documents', exact:true});
  await expect(dialog).toBeVisible();
  await expect(activeTab).toContainText('Connections');
  await dialog.getByRole('button', {name:'Close', exact:true}).click();
  await expect(dialog).toHaveCount(0);
});

test('settings preserve unsaved editor text and the browser address draft', async ({page}) => {
  await page.goto('/?coldStart=0&splashSettled=1');
  await page.getByRole('button', {name:'Toggle Workspace', exact:true}).click();
  const drawer = page.locator('.workspace-drawer');
  await page.locator('.workspace-launcher').getByRole('button', {name:'IDE', exact:true}).click();
  await page.getByRole('button', {name:'Open project', exact:true}).click();
  await page.locator('.ide-tree-row').filter({has:page.getByText('README.md', {exact:true})}).click();
  const editor = page.getByRole('textbox', {name:'README.md', exact:true});
  await editor.press('ControlOrMeta+Home');
  await editor.pressSequentially('Unsaved settings roundtrip\n');
  const draft = await editor.innerText();
  await drawer.getByRole('button', {name:'IDE settings', exact:true}).click();
  await drawer.getByRole('button', {name:'Back to IDE', exact:true}).click();
  await expect(editor).toHaveText(draft, {useInnerText:true});
  await expect(page.locator('.ide-tab.active .ide-tab-dirty')).toHaveClass(/on/);
  await expect(drawer.getByRole('button', {name:'IDE settings', exact:true})).toBeFocused();

  await drawer.getByLabel('New tab', {exact:true}).click();
  await page.locator('.workspace-launcher').getByRole('button', {name:'Browser', exact:true}).click();
  const address = drawer.getByRole('combobox', {name:'Address', exact:true});
  await address.fill('http://localhost/a-draft-that-has-not-been-opened');
  await drawer.getByRole('button', {name:'More', exact:true}).click();
  await drawer.getByRole('menuitem', {name:'Browser settings', exact:true}).click();
  await drawer.getByRole('button', {name:'Back to Browser', exact:true}).click();
  await expect(address).toHaveValue('http://localhost/a-draft-that-has-not-been-opened');
  // A hidden, persistent IDE must not receive the return focus.
  await expect(drawer.getByRole('button', {name:'More', exact:true})).toBeFocused();
});
