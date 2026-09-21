import {expect, test} from '@playwright/test';

/**
 * The time grid's event blocks: the calendar's colour is a rounded bar inside
 * the block, and overlapping blocks step to the right so both bars stay in
 * view rather than lining up into one event.
 */
for (const theme of ['light', 'dark']) {
  test(`overlapping event blocks keep both accent bars visible (${theme})`, async ({page}, info) => {
    await page.goto('/?coldStart=0&splashSettled=1&calendarOverlap=1');
    await expect(page.locator('#startup-splash')).toHaveCount(0);
    await page.getByRole('button', {name: 'Settings', exact: true}).click();
    await page.getByRole('radio', {name: theme === 'light' ? 'Light' : 'Dark', exact: true}).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    if (await page.locator('.chat-drawer.open').count())
      await page.getByRole('button', {name: 'Toggle Chats', exact: true}).click();

    const drawer = page.locator('.workspace-drawer');
    await drawer.getByLabel('New tab', {exact: true}).click();
    await page.locator('.workspace-launcher').getByRole('button', {name: 'Calendar', exact: true}).click();
    await page.getByRole('button', {name: 'Day', exact: true}).click();

    const long = page.getByRole('button', {name: 'CS3210'});
    const short = page.getByRole('button', {name: 'Appian Interview'});
    const shortest = page.getByRole('button', {name: 'Coffee with Maya'});
    const twinA = page.getByRole('button', {name: 'EC1101E Tutorial'});
    const twinB = page.getByRole('button', {name: 'EC1101E Lecture'});
    await expect(long).toBeVisible();
    await expect(short).toBeVisible();

    const boxes = await Promise.all([long, short, shortest].map((block) => block.boundingBox()));
    const [longBox, shortBox, shortestBox] = boxes;
    expect(longBox).not.toBeNull();
    expect(shortBox).not.toBeNull();
    expect(shortestBox).not.toBeNull();
    // Each nested block starts further right, so the bar underneath is not covered.
    expect(shortBox!.x).toBeGreaterThan(longBox!.x + 6);
    expect(shortestBox!.x).toBeGreaterThan(shortBox!.x + 6);

    // 12-3pm sits inside its hours: 3px clear of the 12 and 3 o'clock rules,
    // the same gap it keeps from the day column.
    const column = await page.locator('.time-day-column').first().boundingBox();
    expect(column).not.toBeNull();
    const hour = 52;
    expect(Math.abs(longBox!.y - column!.y - (12 * hour + 3))).toBeLessThan(1.5);
    expect(Math.abs(longBox!.height - (3 * hour - 6))).toBeLessThan(1.5);
    expect(Math.abs(shortBox!.height - (hour - 6))).toBeLessThan(1.5);

    // The colour is an inset bar, not a border on the block's clipped edge.
    const style = await long.evaluate((element) => {
      const block = getComputedStyle(element);
      const bar = getComputedStyle(element, '::before');
      return {
        borderLeftWidth: block.borderLeftWidth,
        borderTopLeftRadius: block.borderTopLeftRadius,
        paddingLeft: Number.parseFloat(block.paddingLeft),
        barWidth: bar.width,
        barLeft: bar.left,
        barRadius: bar.borderTopLeftRadius,
        barBackground: bar.backgroundColor,
      };
    });
    expect(style.borderLeftWidth).toBe('0px');
    expect(Number.parseFloat(style.barWidth)).toBeGreaterThan(0);
    expect(Number.parseFloat(style.barLeft)).toBeGreaterThan(0);
    expect(Number.parseFloat(style.barRadius)).toBeGreaterThan(0);
    expect(style.barBackground).not.toBe('rgba(0, 0, 0, 0)');
    // Text clears the bar.
    expect(style.paddingLeft).toBeGreaterThan(Number.parseFloat(style.barLeft) + Number.parseFloat(style.barWidth));

    // The same slot twice: side by side, neither nested inside the other. Which
    // one lands on the left only depends on the order the session sorts them in.
    const twins = await Promise.all([twinA, twinB].map((block) => block.boundingBox()));
    const [twinABox, twinBBox] = twins.map((box) => box!);
    const [leftTwin, rightTwin] = twinABox.x <= twinBBox.x ? [twinABox, twinBBox] : [twinBBox, twinABox];
    expect(Math.abs(twinABox.y - twinBBox.y)).toBeLessThan(1.5);
    expect(Math.abs(twinABox.height - twinBBox.height)).toBeLessThan(1.5);
    expect(Math.abs(twinABox.width - twinBBox.width)).toBeLessThan(1.5);
    // Each takes half the column, and the two do not overlap.
    expect(Math.abs(leftTwin.width - (column!.width - 9) / 2)).toBeLessThan(2);
    expect(leftTwin.x + leftTwin.width).toBeLessThanOrEqual(rightTwin.x);
    expect(rightTwin.x + rightTwin.width).toBeLessThanOrEqual(column!.x + column!.width - 2);
    // Each keeps a bar of its own rather than one covering the other.
    for (const twin of [twinA, twinB]) {
      const bar = await twin.evaluate((element) => getComputedStyle(element, '::before').backgroundColor);
      expect(bar).not.toBe('rgba(0, 0, 0, 0)');
    }

    await page.locator('.calendar-main').screenshot({path: info.outputPath(`calendar-blocks-${theme}.png`)});

    // Bring the shared-slot pair into view and record it on its own.
    await page.locator('.time-scroll').evaluate((element) => {
      element.scrollTop = 16 * 52 - 80;
    });
    await expect(twinA).toBeInViewport();
    await expect(twinB).toBeInViewport();
    await page.locator('.calendar-main').screenshot({path: info.outputPath(`calendar-side-by-side-${theme}.png`)});
  });
}
