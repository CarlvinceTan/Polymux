import {expect, test} from '@playwright/test';

/**
 * A bot's role and Host line is drawn in two places — under the name in an
 * empty conversation, and beside the name in the title bar — and it has to
 * read as the same line in both: same type, and the Host's device glyph
 * centred on the text's x-height. The glyph is nearly as tall as the role's
 * capitals, so centring it on the cap height instead leaves it looking perched
 * above a run that is mostly lowercase (`This Mac` has no ascenders).
 *
 * Sol is idle with no history, so opening its chat leaves the title bar and
 * the empty identity on screen together and both can be measured at once.
 */
test('the role and Host line matches in the title bar and an empty conversation', async ({page}) => {
  await page.setViewportSize({width: 1340, height: 860});
  await page.goto('/?coldStart=0');
  const drawer = page.locator('aside.chat-drawer');
  await drawer.getByRole('button', {name: 'Team', exact: true}).click();
  await drawer.getByRole('button', {name: 'Open Sol, Operations coordinator'}).click();
  await expect(page.locator('.team-chat-empty-identity')).toBeVisible();

  const lines = await page.evaluate(() => {
    const measure = (span: Element) => {
      const svg = span.querySelector('svg')!;
      const node = Array.from(span.childNodes).find(
        (candidate) => candidate.nodeType === Node.TEXT_NODE && candidate.textContent!.trim(),
      )!;
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, node.textContent!.length);
      const text = range.getBoundingClientRect();
      const style = getComputedStyle(span);
      const context = document.createElement('canvas').getContext('2d')!;
      context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const baseline = text.top + context.measureText('Hg').fontBoundingBoxAscent;
      const glyph = svg.getBoundingClientRect();
      return {
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        // Both measured as distances above the text baseline, so the two
        // lines can be compared even though they sit at different heights.
        glyphCentre: baseline - (glyph.top + glyph.height / 2),
        xCentre: context.measureText('x').actualBoundingBoxAscent / 2,
      };
    };
    return {
      title: measure(document.querySelector('.team-identity > span')!),
      empty: measure(document.querySelector('.team-chat-empty-identity > span')!),
    };
  });

  expect(lines.empty.fontSize).toBe(lines.title.fontSize);
  expect(lines.empty.fontWeight).toBe(lines.title.fontWeight);
  expect(Math.abs(lines.empty.glyphCentre - lines.title.glyphCentre)).toBeLessThan(0.25);
  for (const line of [lines.title, lines.empty])
    expect(Math.abs(line.glyphCentre - line.xCentre)).toBeLessThan(0.5);
});
