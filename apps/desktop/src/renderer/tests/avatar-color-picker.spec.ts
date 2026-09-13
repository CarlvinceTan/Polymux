import {expect, test, type Locator} from '@playwright/test';

async function adaptiveSwatchPaint(swatch: Locator): Promise<{cornerSpread: number; split: number; interiorInk: boolean; cardinalInk: boolean}> {
  const screenshot = await swatch.screenshot({animations: 'disabled'});
  return swatch.evaluate(async (_node, imageUrl) => {
    const image = new Image();
    image.src = imageUrl;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const sample = (x: number, y: number) => {
      const [r = 0, g = 0, b = 0] = context.getImageData(x, y, 1, 1).data;
      return [r, g, b];
    };
    const dist = (left: number[], right: number[]) => Math.hypot(
      (left[0] ?? 0) - (right[0] ?? 0),
      (left[1] ?? 0) - (right[1] ?? 0),
      (left[2] ?? 0) - (right[2] ?? 0),
    );
    const ink = ([r, g, b]: number[]) => r < 40 && g < 40 && b < 40;
    const inset = 1;
    const corners = [
      sample(inset, inset),
      sample(canvas.width - 1 - inset, inset),
      sample(inset, canvas.height - 1 - inset),
      sample(canvas.width - 1 - inset, canvas.height - 1 - inset),
    ];
    const topLeft = sample(Math.floor(canvas.width * .32), Math.floor(canvas.height * .32));
    const bottomRight = sample(Math.floor(canvas.width * .68), Math.floor(canvas.height * .68));
    const top = sample(Math.floor(canvas.width / 2), 1);
    const left = sample(1, Math.floor(canvas.height / 2));
    return {
      cornerSpread: Math.max(...corners.map((corner) => dist(corner, corners[0] ?? corner))),
      split: dist(topLeft, bottomRight),
      interiorInk: ink(topLeft),
      cardinalInk: ink(top) && ink(left),
    };
  }, `data:image/png;base64,${screenshot.toString('base64')}`);
}

for (const theme of ['light', 'dark'] as const) {
  test(`custom avatar colour picker in ${theme}`, async ({page}, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/?coldStart=0');
    await page.getByRole('button', {name: 'Settings', exact: true}).click();
    const settings = page.getByRole('region', {name: 'Settings'});
    await settings.getByRole('radiogroup', {name: 'Theme'}).getByRole('radio', {name: theme === 'light' ? 'Light' : 'Dark', exact: true}).click();
    await page.getByRole('button', {name: 'Close Settings'}).click();
    const drawer = page.locator('aside.chat-drawer');
    await drawer.getByRole('button', {name: 'Team', exact: true}).click();
    await drawer.getByRole('button', {name: 'Options for Maya', exact: true}).click();
    await drawer.getByRole('menuitem', {name: 'Edit', exact: true}).click();
    const editor = page.getByRole('dialog', {name: 'Edit Maya', exact: true});
    const adaptive = editor.getByRole('button', {name: 'Ink in Light, Cream in Dark', exact: true});
    await expect(adaptive).toHaveAttribute('aria-pressed', 'false');
    await editor.getByRole('textbox', {name: 'Name', exact: true}).click();
    await expect(adaptive).not.toBeFocused();
    await editor.locator('.team-avatar-choices.colors').screenshot({path: info.outputPath(`colour-row-${theme}.png`), animations: 'disabled'});
    await adaptive.screenshot({path: info.outputPath(`adaptive-swatch-${theme}.png`), animations: 'disabled'});
    const unfocused = await adaptiveSwatchPaint(adaptive);
    expect(unfocused.cornerSpread).toBeLessThan(25);
    expect(unfocused.split).toBeGreaterThan(80);
    expect(unfocused.interiorInk).toBe(true);
    expect(unfocused.cardinalInk).toBe(true);
    await adaptive.click();
    await editor.getByRole('textbox', {name: 'Name', exact: true}).click();
    await expect(adaptive).toHaveAttribute('aria-pressed', 'true');
    await expect(adaptive).not.toBeFocused();
    const selected = await adaptiveSwatchPaint(adaptive);
    expect(selected.cornerSpread).toBeLessThan(25);
    expect(selected.split).toBeGreaterThan(80);
    expect(selected.interiorInk).toBe(true);
    await editor.getByRole('button', {name: 'Violet colour', exact: true}).click();
    const trigger = editor.getByRole('button', {name: 'Custom avatar colour', exact: true});
    await trigger.click();
    const picker = page.getByRole('dialog', {name: 'Custom avatar colour', exact: true});
    await expect(picker).toBeVisible();
    await expect(picker).toHaveCSS('border-radius', '12px');
    await expect(editor.locator('input[type=color]')).toHaveCount(0);
    const hex = picker.getByRole('textbox', {name: 'Hex colour'});
    await hex.fill('#ff0000');
    const preview = editor.locator('.team-avatar-preview .bloub-body');
    await expect(preview).toHaveCSS('fill', 'rgb(255, 0, 0)');
    await picker.getByRole('slider', {name: 'Hue', exact: true}).fill('120');
    await expect(preview).toHaveCSS('fill', 'rgb(0, 255, 0)');
    await picker.getByRole('slider', {name: 'Saturation and brightness'}).press('ArrowDown');
    await expect(preview).toHaveCSS('fill', 'rgb(0, 252, 0)');
    await hex.fill('#8b5cf6');
    await picker.screenshot({path: info.outputPath(`color-picker-${theme}.png`), animations: 'disabled'});
    await hex.fill('invalid');
    await expect(preview).toHaveCSS('fill', 'rgb(139, 92, 246)');
    await hex.press('Escape');
    await expect(picker).not.toBeVisible();
    await expect(editor).toBeVisible();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(hex).toHaveValue('#8b5cf6');
    await page.setViewportSize({width: 620, height: 680});
    await expect.poll(async () => {
      const bounds = await picker.boundingBox();
      return !!bounds && bounds.x >= 8 && bounds.y >= 8 && bounds.x + bounds.width <= 612 && bounds.y + bounds.height <= 672;
    }).toBe(true);
    await picker.getByRole('button', {name: 'Done'}).click();
    await editor.getByRole('button', {name: 'Save', exact: true}).click();
    await expect(editor).toHaveCount(0);
    await expect(drawer.getByRole('img', {name: 'Maya avatar'}).locator('.bloub-body')).toHaveCSS('fill', 'rgb(139, 92, 246)');
    expect(errors).toEqual([]);
  });
}
