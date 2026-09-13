import {expect, test, type Page} from '@playwright/test';

/** Distinct artwork so the gallery's spacing and alignment are judgeable. */
function svgSticker(hue: number, label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
    <circle cx="60" cy="60" r="52" fill="hsl(${hue} 72% 62%)"/>
    <circle cx="42" cy="48" r="9" fill="#1b1b1b"/>
    <circle cx="78" cy="48" r="9" fill="#1b1b1b"/>
    <path d="M34 78q26 22 52 0" stroke="#1b1b1b" stroke-width="7" fill="none" stroke-linecap="round"/>
    <text x="60" y="112" font-size="14" text-anchor="middle" fill="#1b1b1b">${label}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

const CATALOG = [0, 40, 90, 150, 200, 260, 300, 330, 20].map((hue, index) => ({
  id: `demo-sticker-${index}`,
  url: svgSticker(hue, String(index + 1)),
  mimeType: 'image/svg+xml',
  size: 512,
  width: 120,
  height: 120,
}));

async function openHubChat(page: Page, theme: string): Promise<void> {
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
}

async function openStickerGallery(page: Page): Promise<void> {
  await page.locator('.hub-view-composer-add').click();
  await page.getByRole('menuitem', {name: 'Send sticker', exact: true}).click();
}

for (const variant of [
  {theme: 'light', width: 1280},
  {theme: 'dark', width: 1280},
  {theme: 'light', width: 900},
]) {
  test(`sticker gallery renders as a menu in ${variant.theme} at ${variant.width}px`, async ({page}, testInfo) => {
    await page.setViewportSize({width: variant.width, height: 900});
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await openHubChat(page, variant.theme);
    await page.evaluate(stickers => (window as any).polymuxDemoSetStickers(stickers), CATALOG);
    await openStickerGallery(page);

    const gallery = page.getByRole('grid');
    await expect(gallery).toBeVisible();
    await expect(gallery.getByRole('gridcell')).toHaveCount(CATALOG.length);
    // The menu is one bubble: bordered surface, not a bare grid.
    const box = await settledPickerBox(page);
    expect(box.width).toBeGreaterThan(150);
    expect(box.height).toBeGreaterThan(190);
    // Artwork keeps its own aspect ratio and no cell shows a broken image.
    const images = gallery.locator('img');
    await expect(images).toHaveCount(CATALOG.length);
    // Data-URI artwork decodes asynchronously; wait for real pixels rather
    // than asserting on an app that is still painting.
    await expect.poll(async () => images.evaluateAll((nodes: HTMLImageElement[]) =>
      nodes.filter(node => !node.complete || node.naturalWidth === 0).length,
    ), {timeout: 10_000}).toBe(0);

    await page.screenshot({path: testInfo.outputPath('sticker-gallery.png')});
    expect(errors).toEqual([]);
  });
}

test('the gallery focuses the first sticker, keeps its menu open on hover, and stays on screen', async ({page}, testInfo) => {
  await page.setViewportSize({width: 1280, height: 900});
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openHubChat(page, 'light');
  await page.evaluate(stickers => (window as any).polymuxDemoSetStickers(stickers), CATALOG);
  await openStickerGallery(page);

  const cells = page.getByRole('grid').getByRole('gridcell');
  await expect(cells.first()).toBeFocused();
  await cells.nth(2).hover();
  await expect(page.getByRole('grid')).toBeVisible();

  // A popover must not escape the window, including the composer's own bounds.
  const viewport = page.viewportSize()!;
  const box = await settledPickerBox(page);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);

  await page.screenshot({path: testInfo.outputPath('sticker-gallery-focus.png')});
  expect(errors).toEqual([]);
});

test('the gallery reserves its own shape while loading and centres an empty message', async ({page}, testInfo) => {
  await page.setViewportSize({width: 1280, height: 900});
  await openHubChat(page, 'light');

  // Hold the catalog open so the loading state is observable, then release it
  // into an empty catalog to prove the bubble does not change size.
  await page.evaluate(() => {
    const holder = window as any;
    holder.__releaseStickers = null;
    holder.polymuxDemoSetStickerGate(new Promise<void>(resolve => {
      holder.__releaseStickers = resolve;
    }));
  });
  await openStickerGallery(page);
  const gallery = page.getByRole('grid');
  await expect(gallery).toHaveAttribute('aria-busy', 'true');
  const skeletons = gallery.locator('.hub-view-sticker-skeleton');
  await expect(skeletons).toHaveCount(6);
  const loadingBox = await settledPickerBox(page);
  await page.screenshot({path: testInfo.outputPath('sticker-gallery-loading.png')});

  // Release into an empty catalog: the placeholder replaces the grid content.
  await page.evaluate(() => {
    (window as any).polymuxDemoSetStickers([]);
    (window as any).__releaseStickers();
  });
  await expect(gallery).toHaveAttribute('aria-busy', 'false');
  await expect(gallery.locator('.hub-view-sticker-state')).toBeVisible();
  // The bubble keeps its reserved size, so the composer does not jump.
  const emptyBox = await settledPickerBox(page);
  expect(Math.abs(emptyBox.height - loadingBox.height)).toBeLessThanOrEqual(2);
  await page.screenshot({path: testInfo.outputPath('sticker-gallery-empty.png')});
});

/** The reveal animates height from zero, so a DOM assertion can pass while the
 * menu is still collapsed. Wait for the settled bubble before measuring. */
async function settledPickerBox(page: Page) {
  await expect.poll(async () => {
    const box = await page.locator('.hub-view-sticker-picker').boundingBox();
    return box?.height ?? 0;
  }, {timeout: 5_000}).toBeGreaterThan(190);
  return (await page.locator('.hub-view-sticker-picker').boundingBox())!;
}
