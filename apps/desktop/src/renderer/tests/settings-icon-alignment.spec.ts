import {expect, test} from '@playwright/test';

/**
 * A setting's rounded icon square starts at the top of its title, not at the
 * centre of a row that may carry several lines of description and stats.
 */
for (const width of [1340, 640]) {
  test(`setting icon squares align with setting titles at ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height: 859});
    await page.goto('/?coldStart=0&splashSettled=1');
    await page.getByRole('button', {name: 'Settings', exact: true}).click();
    if (await page.locator('aside.chat-drawer.open').count()) {
      await page.getByRole('button', {name: 'Toggle Chats', exact: true}).click();
    }
    const settings = page.getByRole('region', {name: 'Settings', exact: true});
    await expect(settings).toBeVisible();
    // The workspace drawer animates open, and Settings is briefly compact while
    // it does. At a wide window it settles back into the two-pane layout, which
    // is where the back button goes away — wait for that rather than racing it.
    if (width > 720) await expect(settings).not.toHaveClass(/compact-detail/);
    // A narrow window opens straight into a detail view; the rail with the tabs
    // sits behind it, so step back before choosing a tab.
    const back = settings.getByRole('button', {name: 'Back to Settings', exact: true});
    if (await back.count()) await back.click();
    await expect(settings.getByRole('tab', {name: 'Appearance', exact: true})).toBeVisible();
    for (const name of ['Appearance', 'Memory']) {
      const tab = settings.getByRole('tab', {name, exact: true});
      if (!await tab.isVisible()) await back.click();
      await tab.click();
      const rows = settings.locator(':is(.general-setting-row,.memory-setting-row):has(>.option-mark.large)');
      await expect(rows.first()).toBeVisible();
      for (const row of await rows.all()) {
        const icon = await row.locator(':scope > .option-mark.large').boundingBox();
        const title = await row.locator('h4').boundingBox();
        expect(icon).not.toBeNull();
        expect(title).not.toBeNull();
        // The 2px optical adjustment accounts for the title's line-box leading.
        expect(Math.abs(icon!.y - title!.y - 2)).toBeLessThan(1);
      }
    }
  });
}

/**
 * A row without a leading icon square — the role table under Assistant, for
 * example — keeps its copy centred between the dividers, rather than being
 * pulled up to the row's top edge the way an icon row's title is.
 */
test('role rows centre their copy vertically', async ({page}) => {
  await page.setViewportSize({width: 1340, height: 900});
  await page.goto('/?coldStart=0&splashSettled=1');
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  const settings = page.getByRole('region', {name: 'Settings', exact: true});
  await expect(settings).toBeVisible();
  await settings.getByRole('tab', {name: 'Agent', exact: true}).click();
  await settings.getByRole('button', {name: /Models.*Configure/}).click();
  const rows = settings.locator('.role-options .general-setting-row');
  await expect(rows.first()).toBeVisible();
  for (const row of await rows.all()) {
    const rowBox = await row.boundingBox();
    const copyBox = await row.locator('.general-setting-copy').boundingBox();
    expect(rowBox).not.toBeNull();
    expect(copyBox).not.toBeNull();
    const offsets = [
      copyBox!.y - rowBox!.y,
      rowBox!.y + rowBox!.height - (copyBox!.y + copyBox!.height),
    ];
    // The row's bottom border is inside its box, which accounts for a pixel.
    expect(Math.abs(offsets[0] - offsets[1])).toBeLessThanOrEqual(1.5);
  }
});
