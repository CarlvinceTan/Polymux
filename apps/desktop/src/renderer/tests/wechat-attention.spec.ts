import {expect, test} from '@playwright/test';

for (const variant of [{theme: 'light', width: 1280}, {theme: 'dark', width: 900}]) {
  test(`WeChat attention is centred and clears after sign-in (${variant.theme})`, async ({page}, info) => {
    await page.setViewportSize({width: variant.width, height: 900});
    await page.goto('/?coldStart=0');
    await page.waitForFunction(() => typeof (window as any).polymuxDemoWeChatAttention === 'function');
    await page.evaluate(theme => {
      document.documentElement.dataset.theme = theme;
      (window as any).polymuxDemoWeChatAttention({title: 'WeChat is signed out', detail: 'Open WeChat and sign in to continue.'}, false);
    }, variant.theme);
    if (variant.width < 1000) await page.getByRole('button', {name: 'Toggle Chats', exact: true}).click();
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    await page.locator('.workspace-launcher-row', {hasText: 'Hub'}).click();
    await page.getByRole('button', {name: 'WeChat', exact: true}).click();
    const notice = page.locator('.hub-view-attention');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('WeChat is signed out');
    await expect(notice).toContainText('Open WeChat and sign in to continue.');
    const geometry = await notice.evaluate(element => {
      const pane = element.parentElement!.getBoundingClientRect();
      const copy = element.firstElementChild!.getBoundingClientRect();
      return {x: Math.abs(copy.x + copy.width / 2 - pane.x - pane.width / 2),
        y: Math.abs(copy.y + copy.height / 2 - pane.y - pane.height / 2)};
    });
    expect(geometry.x).toBeLessThan(3);
    expect(geometry.y).toBeLessThan(3);
    await page.screenshot({path: info.outputPath('signed-out.png')});
    await page.evaluate(() => (window as any).polymuxDemoWeChatAttention({
      title: 'Finish signing in to WeChat', detail: 'Scan the QR code in WeChat or approve sign-in on your phone.',
    }));
    await expect(notice).toContainText('Scan the QR code');
    await page.screenshot({path: info.outputPath('qr-login.png')});
    await page.evaluate(() => (window as any).polymuxDemoWeChatAttention({
      title: 'Install WeChat Desktop', detail: 'Install WeChat and sign in to use it in Hub.',
      installUrl: 'https://mac.weixin.qq.com/',
    }, false));
    await expect(notice).toContainText('Install WeChat Desktop');
    await expect(notice).toContainText('Install WeChat and sign in to use it in Hub.');
    await expect(notice.getByRole('button', {name: 'Download WeChat', exact: true})).toBeVisible();
    await expect(notice.locator('img')).toHaveCount(0);
    await page.screenshot({path: info.outputPath('install-wechat.png')});
    await page.evaluate(() => (window as any).polymuxDemoWeChatAttention({
      title: 'WeChat hasn’t synced yet',
      detail: 'Your chats aren’t available in Hub yet. Open WeChat Desktop and try again.',
      retry: true,
    }));
    await expect(notice).toContainText('WeChat hasn’t synced yet');
    await expect(notice.getByRole('button', {name: 'Try again', exact: true})).toBeVisible();
    await expect(page.getByText('No conversations yet.', {exact: true})).toHaveCount(0);
    await page.screenshot({path: info.outputPath('sync-unavailable.png')});
    await page.evaluate(() => (window as any).polymuxDemoWeChatAttention(null));
    await expect(notice).toHaveCount(0);
  });
}
