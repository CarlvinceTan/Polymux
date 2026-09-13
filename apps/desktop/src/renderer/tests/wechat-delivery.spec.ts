import {expect, test} from '@playwright/test';

for (const theme of ['light', 'dark']) {
  test(`unconfirmed delivery keeps one bubble and an empty submitted draft (${theme})`, async ({page}, info) => {
    await page.goto('/?coldStart=0');
    await page.waitForFunction(() => typeof (window as any).polymuxDemoUnconfirmNextChatSend === 'function');
    await page.evaluate(theme => {
      document.documentElement.dataset.theme = theme;
      (window as any).polymuxDemoWeChatAttention(null);
    }, theme);
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    await page.locator('.workspace-launcher-row', {hasText: 'Hub'}).click();
    await page.getByRole('button', {name: 'WeChat', exact: true}).click();
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-row', {hasText: 'File Transfer'}).click();
    const field = view.locator('.hub-view-composer textarea');
    const body = 'Unconfirmed delivery fixture';
    await page.evaluate(() => (window as any).polymuxDemoUnconfirmNextChatSend());
    await field.fill(body);
    await view.locator('.hub-view-composer').getByRole('button', {name: 'Send message', exact: true}).click();
    await expect(view.getByText('Delivery unconfirmed', {exact: true})).toBeVisible();
    await expect(field).toHaveValue('');
    await expect(view.locator('.hub-view-bubble', {hasText: body})).toHaveCount(1);
    await field.fill('The next draft');
    await page.screenshot({path: info.outputPath('delivery-unconfirmed.png')});
    const row = view.locator('.hub-view-bubble-row', {hasText: body});
    const id = await row.getAttribute('data-message-id');
    expect(id).toBeTruthy();
    await page.evaluate(id => (window as any).polymuxDemoConfirmChatMessage(id), id);
    await expect(view.getByText('Delivery unconfirmed', {exact: true})).toHaveCount(0);
    await expect(view.locator('.hub-view-bubble', {hasText: body})).toHaveCount(1);
    await expect(field).toHaveValue('The next draft');
    expect(await page.evaluate(() => (window as any).polymuxDemoChatActions().filter((action: any) => action.kind === 'text').length)).toBe(1);
  });
}
