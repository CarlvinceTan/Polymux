import {expect, test, type Page} from '@playwright/test';

async function setup(page: Page, theme = 'light'): Promise<void> {
  await page.goto('/?coldStart=0');
  await page.waitForFunction(() => typeof (window as any).polymuxDemoSetWeChatGroup === 'function');
  await page.evaluate(theme => {
    document.documentElement.dataset.theme = theme;
    (window as any).polymuxDemoSetPlatformLinked('wechat', true);
    (window as any).polymuxDemoSetWeChatGroup({name: 'Study group'});
  }, theme);
  await page.getByRole('button', {name: 'Toggle Workspace'}).click();
  await page.locator('.workspace-launcher-row', {hasText: 'Hub'}).click();
  if ((page.viewportSize()?.width ?? 1280) < 1000)
    await page.getByRole('button', {name: 'Toggle Chats', exact: true}).click();
  await page.locator('.hub-view-row', {hasText: 'Study group'}).click();
  await page.locator('.hub-view-chat-more').click();
  await page.getByRole('menuitem', {name: 'Rename group', exact: true}).click();
  await expect(page.getByLabel('Group name', {exact: true})).toHaveValue('Study group');
}

for (const variant of [{theme: 'light', width: 1280}, {theme: 'dark', width: 1280}, {theme: 'light', width: 900}]) {
  test(`renames a WeChat group with confirmation at ${variant.width}px in ${variant.theme}`, async ({page}, testInfo) => {
    await page.setViewportSize({width: variant.width, height: 900});
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await setup(page, variant.theme);
    const form = page.getByRole('form', {name: 'Rename group'});
    const input = page.getByLabel('Group name', {exact: true});
    await expect(input).toBeFocused();
    await expect(form.getByRole('button', {name: 'Save', exact: true})).toBeDisabled();
    await input.fill('学习小组 🐷');
    // IME composition must not dispatch the form's Enter action.
    await input.dispatchEvent('keydown', {key: 'Enter', isComposing: true});
    await expect(form).toBeVisible();
    await page.screenshot({path: testInfo.outputPath('rename-form.png')});
    await page.evaluate(() => (window as any).polymuxDemoSetWeChatGroup({renameDelayMs: 1200}));
    await input.press('Enter');
    await expect(form.getByRole('button', {name: 'Saving…', exact: true})).toBeDisabled();
    await expect(page.locator('.hub-view-chat-head h2')).toHaveText('Study group');
    await expect(form).toHaveCount(0);
    await expect(page.locator('.hub-view-chat-head h2')).toHaveText('学习小组 🐷');
    await expect(page.locator('.hub-view-chat-more')).toBeFocused();
    await page.locator('.hub-view-chat-more').click();
    await page.getByRole('menuitem', {name: 'Rename group', exact: true}).click();
    await expect(input).toHaveValue('学习小组 🐷');
    await input.fill('Cancel this change');
    await input.press('Escape');
    await expect(form).toHaveCount(0);
    await expect(page.locator('.hub-view-chat-head h2')).toHaveText('学习小组 🐷');
    expect(errors).toEqual([]);
  });
}

test('preserves a failed draft, reloads a concurrent rename, and hides renaming in direct chats', async ({page}, testInfo) => {
  await setup(page);
  const form = page.getByRole('form', {name: 'Rename group'});
  const input = page.getByLabel('Group name', {exact: true});
  await input.fill('My requested name');
  await page.evaluate(() => (window as any).polymuxDemoSetWeChatGroup({name: 'Changed elsewhere'}));
  await form.getByRole('button', {name: 'Save', exact: true}).click();
  await expect(form.getByRole('alert')).toContainText('group name changed');
  await expect(input).toHaveValue('My requested name');
  await expect(form.getByRole('button', {name: 'Save', exact: true})).toBeDisabled();
  await page.screenshot({path: testInfo.outputPath('rename-conflict.png')});
  await form.getByRole('button', {name: 'Reload current name'}).click();
  await expect(input).toHaveValue('Changed elsewhere');
  await form.getByRole('button', {name: 'Cancel'}).click();
  await page.locator('.hub-view-chat-head').getByRole('button', {name: 'Back', exact: true}).click();
  await page.locator('.hub-view-row', {hasText: 'File Transfer'}).click();
  await page.locator('.hub-view-chat-more').click();
  await expect(page.getByRole('menuitem', {name: 'Rename group', exact: true})).toHaveCount(0);
});

test('pending name reads and saves do not take focus from the composer', async ({page}) => {
  await setup(page);
  let composer = page.getByRole('textbox', {name: 'Message Study group', exact: true});
  const form = page.getByRole('form', {name: 'Rename group'});
  await page.getByLabel('Group name', {exact: true}).fill('Confirmed name');
  await page.evaluate(() => (window as any).polymuxDemoSetWeChatGroup({renameDelayMs: 1200}));
  await form.getByRole('button', {name: 'Save', exact: true}).click();
  await composer.fill('Keep typing this draft');
  await expect(form).toHaveCount(0);
  composer = page.getByRole('textbox', {name: 'Message Confirmed name', exact: true});
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue('Keep typing this draft');
  await page.evaluate(() => (window as any).polymuxDemoSetWeChatGroup({readDelayMs: 1200}));
  await page.locator('.hub-view-chat-more').click();
  await page.getByRole('menuitem', {name: 'Rename group', exact: true}).click();
  await composer.click();
  await expect(page.getByLabel('Group name', {exact: true})).toHaveValue('Confirmed name');
  await expect(composer).toBeFocused();
});
