import {qrMatrix, formatTeamHostSetupCode} from '@polymux/protocol';
import {expect, test} from '@playwright/test';

for (const theme of ['light', 'dark'] as const) {
  test(`Device pairing, installation and tooltips in ${theme}`, async ({page}, info) => {
    const errors: string[] = [];
    page.on('pageerror', error => { errors.push(error.message); console.log(error.message); });
    await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', {value: {writeText: async (text: string) => { (window as any).__copied = text; }}}));
    await page.goto('/?coldStart=0&splashSettled=1');
    await page.getByRole('button', {name: 'Settings', exact: true}).click();
    const settings = page.getByRole('region', {name: 'Settings'});
    await settings.getByRole('radiogroup', {name: 'Theme'}).getByRole('radio', {name: theme === 'light' ? 'Light' : 'Dark', exact: true}).click();
    await page.getByRole('button', {name: 'Close Settings'}).click();
    const trigger = page.getByRole('button', {name: 'Devices', exact: true});
    await trigger.hover(); await expect(page.getByRole('tooltip')).toHaveText('Devices');
    await trigger.click();
    const panel = page.getByRole('dialog', {name: 'Devices', exact: true});
    await expect(panel).toBeVisible();
    const opened = (await panel.boundingBox())!;
    const triggerBox = (await trigger.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(opened.y).toBeGreaterThanOrEqual(8);
    expect(opened.y + opened.height).toBeLessThanOrEqual(viewport.height - 7);
    expect(opened.y + opened.height).toBeLessThanOrEqual(triggerBox.y + 1);
    await expect(panel.getByRole('img', {name: 'Polymux pairing QR code'})).toBeVisible();
    await expect(panel).toHaveCSS('opacity', '1');
    await expect(panel.getByText('Default', {exact: true})).toHaveCount(0);
    await expect(panel.getByRole('button', {name: 'Make default'})).toHaveCount(0);
    for (const [name, icon] of [['This Mac', 'laptop'], ['Studio Linux', 'server']]) {
      const row = panel.locator('.host-row').filter({hasText: name});
      await expect(row).toContainText('Online');
      await expect(row.locator(`[data-icon=${icon}]`)).toHaveCount(1);
      expect((await row.boundingBox())!.height).toBeLessThanOrEqual(28);
    }
    const dividerBox = (await panel.locator('.host-install').boundingBox())!;
    const dividerRight = dividerBox.x + dividerBox.width;
    const localStatus = (await panel.locator('.host-row').filter({hasText: 'This Mac'}).locator('.device-status').boundingBox())!;
    expect(Math.abs(localStatus.x + localStatus.width - dividerRight)).toBeLessThan(1.5);
    const remoteActions = (await panel.locator('.host-row').filter({hasText: 'Studio Linux'}).locator('.host-row-actions').boundingBox())!;
    expect(Math.abs(remoteActions.x + remoteActions.width - dividerRight)).toBeLessThan(1.5);
    const platforms = (await panel.locator('.platforms').boundingBox())!;
    expect(Math.abs(platforms.x + platforms.width - dividerRight)).toBeLessThan(1.5);
    await panel.screenshot({path: info.outputPath(`connected-devices-align-${theme}.png`), animations: 'disabled'});
    const initialHeight = (await panel.boundingBox())!.height;
    const expectStableHeight = async () => expect((await panel.boundingBox())!.height).toBe(initialHeight);
    const qr = await panel.locator('.pair-qr').screenshot({path: info.outputPath('source-qr.png')});
    await panel.getByRole('button', {name: 'Code', exact: true}).click();
    await expect(panel.getByRole('button', {name: 'Copy pairing code'})).toHaveText('K7M2P9X4Q');
    await expectStableHeight();
    await expect(panel.getByRole('button', {name: 'Copy pairing link'})).toHaveCount(0);
    await panel.getByRole('button', {name: 'Copy pairing code'}).click();
    expect(await page.evaluate(() => (window as any).__copied)).toBe('K7M2P9X4Q');
    await expect(panel.getByText('Copied', {exact: true})).toBeVisible();
    await panel.getByRole('button', {name: 'Connect', exact: true}).click();
    await expectStableHeight();
    const gaps = await panel.locator('.digits span').evaluateAll((spans) =>
      spans.slice(1).map((span, index) => span.getBoundingClientRect().left - spans[index].getBoundingClientRect().right),
    );
    expect(gaps.length).toBeGreaterThan(1);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(1);
    const code = panel.getByRole('textbox', {name: 'Device pairing code'});
    await code.fill('k7m 2p9 x4q'); await expect(code).toHaveValue('K7M2P9X4Q');
    await panel.getByRole('button', {name: 'Connect Device', exact: true}).click();
    await expect(panel.getByText('Select this number on your other device.')).toBeVisible();
    await expect(panel.locator('.pair-code')).toHaveText('42');
    await expectStableHeight();
    await page.screenshot({path: info.outputPath(`confirmation-${theme}.png`), animations: 'disabled'});
    await panel.getByRole('button', {name: 'Cancel connection'}).click();
    await panel.getByRole('button', {name: 'Scan QR code', exact: true}).click();
    await expectStableHeight();
    await panel.locator('input[type=file]').setInputFiles({name: 'device.png', mimeType: 'image/png', buffer: qr});
    await expect(panel.locator('.pair-code')).toHaveText('42');
    await panel.getByRole('button', {name: 'Cancel connection'}).click();
    await panel.getByRole('button', {name: 'QR code', exact: true}).click();
    await panel.getByRole('button', {name: 'Copy Command'}).click();
    const copied = panel.getByLabel('Command copied', {exact: true});
    await expect(copied).toHaveCSS('white-space', 'nowrap');
    await expect(copied).toHaveCSS('text-overflow', 'ellipsis');
    const copiedMark = panel.locator('.install-copied');
    const success = theme === 'light' ? 'rgb(52, 112, 73)' : 'rgb(117, 200, 141)';
    await expect(copiedMark).toHaveCSS('gap', '4px');
    await expect(copiedMark).toHaveCSS('color', success);
    await expect(copiedMark.locator('svg')).toHaveCSS('stroke', success);
    await panel.screenshot({path: info.outputPath(`copied-command-${theme}.png`), animations: 'disabled'});
    expect(await page.evaluate(() => (window as any).__copied)).toContain('sh -s -- connect ');
    await expect(panel.locator('.install-slider')).not.toHaveClass(/feedback/, {timeout: 5000});
    await page.evaluate(() => {
      window.open = ((url?: string | URL) => {
        (window as unknown as {polymuxOpenedUrl?: string}).polymuxOpenedUrl = String(url ?? '');
        return null;
      }) as typeof window.open;
    });
    for (const platform of ['MacOS', 'Windows', 'Linux']) {
      await panel.getByRole('button', {name: platform, exact: true}).hover();
      await expect(page.getByRole('tooltip')).toHaveText(platform);
      await panel.getByRole('button', {name: platform, exact: true}).click();
      await expect.poll(() => page.evaluate(
        () => (window as unknown as {polymuxOpenedUrl?: string}).polymuxOpenedUrl,
      )).toBe('https://polymux.com/releases/');
      await expect(panel.getByRole('button', {name: 'Close download'})).toHaveCount(0);
      await expectStableHeight();
    }
    await page.screenshot({path: info.outputPath(`devices-${theme}.png`), animations: 'disabled'});
    await page.keyboard.press('Escape'); await expect(panel).toHaveCount(0); await expect(trigger).toBeFocused();
    await page.setViewportSize({width: 390, height: 640}); await trigger.click();
    const bounds = await panel.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(8); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(382);
    expect(bounds!.y).toBeGreaterThanOrEqual(8); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(633);
    for (const method of ['Code', 'Connect', 'QR code']) {
      await panel.getByRole('button', {name: method, exact: true}).click();
      expect((await panel.boundingBox())!.height).toBe(bounds!.height);
    }
    await page.screenshot({path: info.outputPath(`devices-narrow-${theme}.png`), animations: 'disabled'});
    expect(errors).toEqual([]);
  });
}

test('Assistant execution device is selected independently from pairing', async ({page}) => {
  await page.goto('/?coldStart=0&splashSettled=1');
  await page.getByRole('button', {name: 'Assistant device', exact: true}).click();
  const menu = page.getByRole('menu', {name: 'Assistant device'});
  await menu.getByRole('menuitem', {name: 'Studio Linux'}).click();
  await expect(page.getByRole('button', {name: 'Assistant device', exact: true})).toContainText('Studio Linux');
  await page.getByRole('button', {name: 'Devices', exact: true}).click();
  const panel = page.getByRole('dialog', {name: 'Devices', exact: true});
  await expect(panel.locator('.host-row').filter({hasText: 'This Mac'})).toContainText('Online');
  await expect(panel.getByText('Default', {exact: true})).toHaveCount(0);
});

test('camera scanning decodes a device QR and stops capture after connecting', async ({page}) => {
  await page.goto('/?coldStart=0&splashSettled=1');
  const matrix = qrMatrix(formatTeamHostSetupCode('https://connect.polymux.com/h/test', '318204771'));
  await page.evaluate(matrix => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = (matrix.length + 8) * 8;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#000';
    matrix.forEach((row, y) => row.forEach((dark, x) => { if (dark) context.fillRect((x + 4) * 8, (y + 4) * 8, 8, 8); }));
    navigator.mediaDevices.getUserMedia = async () => {
      const stream = canvas.captureStream(0); (window as any).__camera = stream;
      setInterval(() => { context.fillStyle = '#fff'; context.fillRect(0, 0, 1, 1); (stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack).requestFrame(); }, 100);
      return stream;
    };
  }, matrix);
  await page.getByRole('button', {name: 'Devices', exact: true}).click();
  const panel = page.getByRole('dialog', {name: 'Devices', exact: true});
  await panel.getByRole('button', {name: 'Connect', exact: true}).click();
  await panel.getByRole('button', {name: 'Scan QR code', exact: true}).click();
  await expect(panel.locator('.pair-code')).toHaveText('42').catch(async error => {
    console.log(await page.evaluate(() => { const video = document.querySelector('video'); return {video: video && {width: video.videoWidth, height: video.videoHeight, state: video.readyState, paused: video.paused}, stream: (window as any).__camera?.getTracks().map((t: MediaStreamTrack) => ({state: t.readyState, enabled: t.enabled, muted: t.muted}))}; }));
    throw error;
  });
  await expect.poll(() => page.evaluate(() => (window as any).__camera.getTracks()[0].readyState)).toBe('ended');
});

test('number matching shows choices, connects only on a match, and supports decline', async ({page}, info) => {
  await page.goto('/?coldStart=0&splashSettled=1&deviceApproval=1');
  await page.getByRole('button', {name: 'Devices', exact: true}).click();
  let panel = page.getByRole('dialog', {name: 'Devices', exact: true});
  await expect(panel.getByText('Connect Test Phone?')).toBeVisible();
  await expect(panel).toHaveCSS('opacity', '1');
  await page.screenshot({path: info.outputPath('approve-device.png')});
  await panel.getByRole('button', {name: 'Decline', exact: true}).click();
  await expect(panel.getByText('Test Phone', {exact: true})).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', {name: 'Devices', exact: true}).click();
  panel = page.getByRole('dialog', {name: 'Devices', exact: true});
  await panel.getByRole('button', {name: '42', exact: true}).click();
  await expect(panel.getByText('Test Phone', {exact: true})).toBeVisible();
  await expect(panel.locator('.host-row').filter({hasText: 'Test Phone'}).locator('[data-icon=phone]')).toHaveCount(1);
});
