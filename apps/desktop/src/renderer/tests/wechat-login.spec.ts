import {readFile} from 'node:fs/promises';
import {expect, test} from '@playwright/test';

const qr = `data:image/png;base64,${(await readFile(new URL('./fixtures/wechat-login-qr.png', import.meta.url))).toString('base64')}`;

for (const theme of ['light', 'dark']) {
  test(`Hub keeps WeChat sign-in centred without capturing the native QR (${theme})`, async ({page}, info) => {
    await page.setViewportSize({width: 1280, height: 900});
    await page.goto('/?coldStart=0');
    await page.waitForFunction(() => typeof (window as any).polymuxDemoWeChatLogin === 'function');
    await page.evaluate(({theme}) => {
      document.documentElement.dataset.theme = theme;
      (window as any).polymuxDemoWeChatAttention({title: 'Sign in to WeChat Desktop',
        detail: 'We’ll check automatically after you sign in.'});
    }, {theme});
    // The shell can hand back a live Desktop login QR. The Hub sign-in surface
    // deliberately does not capture or display it: signing in, scanning and
    // login options all stay in Desktop, which the Open WeChat action opens.
    await page.evaluate(qr => (window as any).polymuxDemoWeChatLogin({state: 'interactive_login', qrDataUrl: qr,
      expiresAt: Date.now() + 30_000, optionsReady: true}), qr);
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    await page.locator('.workspace-launcher-row', {hasText: 'Hub'}).click();
    await page.getByRole('button', {name: 'WeChat', exact: true}).click();
    const notice = page.locator('.hub-view-attention');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('Sign in to WeChat Desktop');
    await expect(notice).toContainText('We’ll check automatically after you sign in.');
    await expect(notice.getByRole('button', {name: 'Open WeChat', exact: true})).toBeVisible();
    // Neither the QR image nor its bytes reach the Hub surface or local storage.
    await expect(page.getByAltText('WeChat sign-in QR code')).toHaveCount(0);
    await expect(notice.locator(`img[src=${JSON.stringify(qr)}]`)).toHaveCount(0);
    const geometry = await notice.evaluate(element => {
      const pane = element.parentElement!.getBoundingClientRect();
      const content = element.firstElementChild!.getBoundingClientRect();
      return {x: Math.abs(pane.x + pane.width / 2 - content.x - content.width / 2),
        y: Math.abs(pane.y + pane.height / 2 - content.y - content.height / 2)};
    });
    expect(geometry.x).toBeLessThan(3);
    expect(geometry.y).toBeLessThan(3);
    await page.screenshot({path: info.outputPath('login-open-wechat.png')});
    expect(await page.evaluate(() => JSON.stringify(localStorage).includes('data:image/png;base64'))).toBe(false);

    // A QR that has expired changes nothing here: the guidance is the same
    // centred message rather than a login control Hub would have to own.
    await page.evaluate(qr => (window as any).polymuxDemoWeChatLogin({state: 'interactive_login',
      qrDataUrl: qr, expiresAt: Date.now() - 1, optionsReady: true}), qr);
    await expect(notice).toContainText('Sign in to WeChat Desktop');
    await expect(page.getByAltText('WeChat sign-in QR code')).toHaveCount(0);

    // Signing in clears the surface once the shell reports signed_in.
    await page.evaluate(() => {
      (window as any).polymuxDemoWeChatLogin({state: 'signed_in', qrDataUrl: null, expiresAt: null, optionsReady: true});
      (window as any).polymuxDemoWeChatAttention(null);
    });
    await expect(page.locator('.hub-view-attention')).toHaveCount(0);
  });
}
