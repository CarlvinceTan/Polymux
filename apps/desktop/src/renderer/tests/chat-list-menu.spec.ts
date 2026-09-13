import {expect, test} from '@playwright/test';

test.describe('chat list filter layout', () => {
  for (const size of [
    {width: 1280, height: 800, theme: 'light'},
    {width: 700, height: 500, theme: 'dark'},
    {width: 360, height: 260, theme: 'light'},
    {width: 640, height: 180, theme: 'light'},
  ] as const) {
    test(`keeps controls separate at ${size.width}x${size.height} in ${size.theme}`, async ({page}, info) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setViewportSize(size);
      await page.goto('/?coldStart=0');
      if (size.theme === 'dark') {
        await page.getByRole('button', {name:'Settings'}).click();
        const settings = page.getByRole('region', {name:'Settings'});
        await settings.getByRole('radiogroup', {name:'Theme'}).getByRole('radio', {name:'Dark',exact:true}).click();
        await page.getByRole('button', {name: 'Toggle Chats', exact: true}).click();
        await page.getByRole('button', {name: 'Close Settings'}).click();
        await page.getByRole('button', {name: 'Toggle Chats', exact: true}).click();
      }
      await expect(page.locator('html')).toHaveAttribute('data-theme', size.theme);
      const drawer = page.locator('aside.chat-drawer');
      const trigger = drawer.getByRole('button', {name: 'Arrange'});
      const header = drawer.locator('.chat-drawer-heading');
      const before = await header.boundingBox();
      await trigger.click();
      const main = drawer.getByRole('menu', {name: 'Chat list options'});
      await expect(main).toBeVisible();
      const after = await header.boundingBox();
      expect(after!.height).toBe(before!.height);
      expect(after!.y).toBeCloseTo(before!.y, 0);
      expect(after!.width).toBe(before!.width);

      const parent = main.getByRole('menuitem', {name: 'Filter', exact: true});
      await parent.hover();
      const submenu = drawer.getByRole('menu', {name: 'Filter', exact: true});
      await expect(submenu).toBeVisible();
      await expect.poll(() => submenu.evaluate(sub => [...sub.querySelectorAll('button')].every(button => {
        const r = button.getBoundingClientRect();
        if (r.top < sub.getBoundingClientRect().top || r.bottom > sub.getBoundingClientRect().bottom) return true;
        return button.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
      }))).toBe(true);
      const geometry = await page.evaluate(() => {
        const main = document.querySelector('.chat-list-options-menu')!;
        const sub = document.querySelector('.chat-list-options-submenu')!;
        const trigger = document.querySelector('.chat-list-options > button')!;
        const rect = (node: Element) => {const r = node.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};};
        return {main:rect(main),sub:rect(sub),trigger:rect(trigger),
          unobstructed: [...sub.querySelectorAll('button')].every(button => {
            const r = button.getBoundingClientRect();
            if (r.top < sub.getBoundingClientRect().top || r.bottom > sub.getBoundingClientRect().bottom) return true;
            return button.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
          })};
      });
      for (const rect of [geometry.main, geometry.sub]) {
        expect(rect.left).toBeGreaterThanOrEqual(7.5);
        expect(rect.right).toBeLessThanOrEqual(size.width - 7.5);
        expect(rect.top).toBeGreaterThanOrEqual(7.5);
        expect(rect.bottom).toBeLessThanOrEqual(size.height - 7.5);
      }
      expect(geometry.main.top).toBeGreaterThan(geometry.trigger.bottom);
      expect(geometry.sub.right <= geometry.main.left || geometry.sub.left >= geometry.main.right).toBe(true);
      expect(geometry.unobstructed).toBe(true);
      await page.screenshot({path:info.outputPath(`filter-${size.width}-${size.height}-${size.theme}.png`),animations:'disabled'});

      await submenu.getByRole('menuitemradio', {name:'Running',exact:true}).click();
      await expect(submenu.getByRole('menuitemradio', {name:'Running',exact:true})).toHaveAttribute('aria-checked','true');
      await expect(drawer.getByText('No chats match this filter', {exact:true})).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(main).toHaveCount(0);
      await expect(trigger).toBeFocused();
      expect(errors).toEqual([]);
    });
  }

  test('repositions after a resize and supports keyboard choices', async ({page}) => {
    await page.setViewportSize({width:1280,height:800});
    await page.goto('/?coldStart=0');
    const drawer = page.locator('aside.chat-drawer');
    const trigger = drawer.getByRole('button', {name:'Arrange'});
    await trigger.click();
    await page.keyboard.press('End');
    const parent = drawer.getByRole('menuitem', {name:'Filter',exact:true});
    await expect(parent).toBeFocused();
    const submenu = drawer.getByRole('menu', {name:'Filter',exact:true});
    await expect(submenu).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(submenu.getByRole('menuitemradio', {name:'All chats',exact:true})).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(submenu.getByRole('menuitemradio', {name:'Running',exact:true})).toHaveAttribute('aria-checked','true');
    await page.setViewportSize({width:360,height:260});
    await expect.poll(async () => {
      const box = await submenu.boundingBox();
      return !!box && box.x >= 8 && box.x + box.width <= 352 && box.y + box.height <= 252;
    }).toBe(true);
    await page.keyboard.press('ArrowLeft');
    await expect(submenu).toHaveCount(0);
    await expect(parent).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  });
});
