import {expect, test} from '@playwright/test';

for (const theme of ['light', 'dark']) {
  test(`memory citations open after Share and dismiss in ${theme}`, async ({page, context}, info) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/?coldStart=0&memoryCitations=1');
    if (theme === 'dark') {
      await page.getByRole('button', {name: 'Settings', exact: true}).click();
      await page.getByRole('region', {name: 'Settings'}).getByRole('radio', {name: 'Dark', exact: true}).click();
      await page.getByRole('button', {name: 'Close Settings'}).click();
    }
    await page.getByRole('button', {name: 'Open chat: Planning a product launch', exact: true}).click();
    // Let the chat panel finish its opening transition before measuring anchors.
    await page.waitForTimeout(500);
    const reply = page.locator('.message.assistant');
    const trigger = reply.getByRole('button', {name: 'Memories cited', exact: true});
    await expect(reply.locator('.markdown-body')).toHaveText('Here is your concise launch plan.');
    const labels = await reply.locator('.message-actions button').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
    expect(labels.indexOf('Memories cited')).toBe(labels.indexOf('Share') + 1);
    await trigger.click();
    const panel = page.getByRole('dialog', {name: 'Memories cited'});
    await expect(panel.locator('li')).toHaveText(['Maintained personal pi presentation preferences', 'Prefers concise project updates']);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toHaveCSS('opacity', '1');
    await page.screenshot({path: info.outputPath(`memories-${theme}.png`)});
    const box = (await panel.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await reply.locator('.markdown-body').click();
    await expect(panel).toHaveCount(0);
    await reply.getByRole('button', {name: 'Copy', exact: true}).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Here is your concise launch plan.');
  });
}

test('ordinary replies have no memory action', async ({page}) => {
  await page.goto('/?coldStart=0');
  await page.getByRole('button', {name: 'Open chat: Planning a product launch', exact: true}).click();
  await expect(page.locator('.message.assistant')).toBeVisible();
  await expect(page.getByRole('button', {name: 'Memories cited'})).toHaveCount(0);
});
