import {expect, test} from '@playwright/test';
import type {ChatMessageDto} from '@polymux/protocol';

for (const variant of [
  {theme: 'light', width: 1280}, {theme: 'dark', width: 1280}, {theme: 'light', width: 900},
]) {
  test(`reads forwarded WeChat bundles at ${variant.width}px in ${variant.theme}`, async ({page}, testInfo) => {
    await page.setViewportSize({width: variant.width, height: 900});
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/?coldStart=0');
    await page.waitForFunction(() => typeof (window as unknown as {
      polymuxDemoSetPlatformLinked?: unknown;
    }).polymuxDemoSetPlatformLinked === 'function');
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
      (window as unknown as {polymuxDemoSetPlatformLinked: (platform: string, linked: boolean) => void})
        .polymuxDemoSetPlatformLinked('wechat', true);
    }, variant.theme);
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    await page.locator('.workspace-launcher-row', {hasText: 'Hub'}).click();
  if ((page.viewportSize()?.width ?? 1280) < 1000)
    await page.getByRole('button', {name: 'Toggle Chats', exact: true}).click();
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-row', {hasText: 'File Transfer'}).click();
    await page.evaluate(() => {
      (window as unknown as {
        polymuxDemoIncomingChatMessage: (chatId: string, body: string, details: Pick<ChatMessageDto, 'forwarded' | 'viewIn'>) => void;
      }).polymuxDemoIncomingChatMessage('!wx-filehelper:local', 'Forwarded test conversation', {
        forwarded: {title: 'Forwarded test conversation', truncated: false, messages: [
          {senderName: 'Alice', sentAt: '2026-09-05 12:34:56', kind: 'text', body: 'Literal <img src=x onerror=alert(1)> stays text.\n第二行 👋'},
          {senderName: 'Bob with a very long display name for the forwarded transcript fixture', sentAt: null, kind: 'file', body: 'notes-with-a-long-unbroken-name-'.repeat(5) + '.pdf'},
          {senderName: 'Native sticker', sentAt: null, kind: 'unknown', body: '[Sticker]'},
          {senderName: 'Carol', sentAt: null, kind: 'record', body: '', forwarded: {
            title: 'Earlier conversation', truncated: true,
            messages: [{senderName: 'Dan', sentAt: null, kind: 'text', body: 'The nested message is readable here.'}],
          }},
        ]},
        viewIn: {app: 'WeChat', url: 'weixin://'},
      });
    });
    const bundle = view.locator('.hub-view-bubble > .forwarded-messages');
    const summary = bundle.locator(':scope > summary');
    await expect(summary).toContainText('Forwarded test conversation');
    await expect(bundle.locator(':scope > ol')).toBeHidden();
    await summary.focus();
    await summary.press('Enter');
    await expect(bundle.locator(':scope > ol')).toBeVisible();
    await expect(bundle.getByText('第二行 👋', {exact: false})).toBeVisible();
    await expect(bundle.locator('img')).toHaveCount(0);
    const sticker = bundle.locator('li', {has: page.getByText('Native sticker', {exact: true})});
    await expect(sticker.getByText('[Sticker]', {exact: true})).toBeVisible();
    await expect(sticker.locator('.forwarded-kind')).toHaveCount(0);
    await bundle.locator('details > summary').click();
    await expect(bundle.getByText('The nested message is readable here.', {exact: true})).toBeVisible();
    await expect(bundle.getByText('View the remaining messages in WeChat.')).toBeVisible();
    const overflow = await bundle.evaluate((node) => [...node.querySelectorAll('p, summary')]
      .some((element) => element.scrollWidth > element.clientWidth + 1));
    expect(overflow).toBe(false);
    const fullSender = 'Bob with a very long display name for the forwarded transcript fixture';
    const sender = bundle.locator('.forwarded-author strong', {hasText: fullSender});
    await expect(sender).toHaveAttribute('tabindex', '0');
    await sender.focus();
    await expect(page.getByRole('tooltip')).toHaveText(fullSender);
    await expect(sender).toHaveAttribute('aria-describedby', 'polymux-shared-tooltip');
    await page.screenshot({path: testInfo.outputPath(`forwarded-${variant.theme}-${variant.width}-tooltip.png`), animations: 'disabled'});
    await sender.evaluate((node) => (node as HTMLElement).blur());
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    const titleClipped = await summary.locator('.forwarded-title').evaluate((node) => node.scrollWidth > node.clientWidth + 1);
    if (titleClipped) {
      const started = Date.now();
      await summary.hover();
      await expect(page.getByRole('tooltip')).toHaveText('Forwarded test conversation');
      expect(Date.now() - started).toBeGreaterThanOrEqual(1400);
    }
    await bundle.locator('.forwarded-author strong', {hasText: 'Alice'}).hover();
    await page.waitForTimeout(1600);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await bundle.scrollIntoViewIfNeeded();
    await page.screenshot({path: testInfo.outputPath(`forwarded-${variant.theme}-${variant.width}.png`), animations: 'disabled'});
    await summary.focus();
    await summary.press('Space');
    await expect(bundle.locator(':scope > ol')).toBeHidden();
    expect(errors).toEqual([]);
  });
}
