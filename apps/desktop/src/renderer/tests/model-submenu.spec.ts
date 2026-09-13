import {expect, test, type Locator} from '@playwright/test';

/** True when the element's own top-right is what hit-testing finds — not a
 * drawer or scroller painted over it. */
const paintsOnTop = (locator: Locator) => locator.evaluate(node => {
  const box = node.getBoundingClientRect();
  const hit = document.elementFromPoint(box.right - 6, box.top + 8);
  return Boolean(hit && node.contains(hit));
});

test('reasoning submenu escapes clipping and flips at the window edge', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name: 'MODEL', exact: true}).click();
  const menu = page.getByRole('menu', {name: 'Model options', exact: true});
  await expect(menu).toBeVisible();
  expect(await menu.evaluate(node => node.parentElement === document.body)).toBe(true);
  // Wait out the menu's first layout pass, then park it on the right edge so
  // the submenu has to flip rather than hang off the window.
  await menu.evaluate(async node => {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    node.style.left = 'auto';
    node.style.right = '20px';
    node.style.top = '200px';
    node.style.bottom = 'auto';
    node.style.transform = 'none';
    const shift = window.innerWidth - 20 - node.getBoundingClientRect().right;
    node.style.transform = `translateX(${shift}px)`;
  });
  await menu.getByRole('menuitem').first().dispatchEvent('mouseenter');
  const submenu = page.locator('.model-submenu');
  await expect(submenu).toBeVisible();
  const bounds = await submenu.boundingBox();
  const parent = await menu.boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(parent!.x);
  expect(await submenu.evaluate(node => node.parentElement === document.body)).toBe(true);
  await submenu.getByRole('menuitemradio').first().click();
  await expect(menu).toHaveCount(0);
});

test('model menu and reasoning submenu paint above the workspace drawer', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name: 'Toggle Workspace'}).click();
  await expect(page.locator('main')).toHaveClass(/workspace-open/);
  await page.getByRole('button', {name: 'MODEL', exact: true}).click();
  const menu = page.getByRole('menu', {name: 'Model options', exact: true});
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem').first().dispatchEvent('mouseenter');
  const submenu = page.locator('.model-submenu');
  await expect(submenu).toBeVisible();
  expect(await paintsOnTop(menu)).toBe(true);
  expect(await paintsOnTop(submenu)).toBe(true);
});
