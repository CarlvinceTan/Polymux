import {expect, test} from '@playwright/test';

async function openUsage(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.locator('#startup-splash')).toHaveCount(0, {timeout: 15_000});
  await page.getByRole('button', {name: 'Toggle Workspace', exact: true}).click();
  const launcher = page.locator('.workspace-launcher');
  await launcher.getByRole('button', {name: 'More apps'}).click();
  await launcher.getByRole('button', {name: 'Usage', exact: true}).click();
  return page.getByRole('application', {name: 'Usage'});
}

test('Usage home fits without scrolling and More opens section depth', async ({page}) => {
  await page.setViewportSize({width: 1280, height: 800});
  const usage = await openUsage(page);

  await expect(usage.getByRole('heading', {name: 'Usage', exact: true})).toBeVisible();
  await expect(usage.locator('.usage-profile')).toHaveCount(0);
  await expect(usage.getByText('Account', {exact: true})).toHaveCount(0);
  await expect(usage.locator('.usage-home')).toBeVisible();

  const overflow = await usage.evaluate((node) => node.scrollHeight - node.clientHeight);
  expect(overflow).toBeLessThanOrEqual(1);

  const cell = usage.locator('button.usage-cell').first();
  await expect(cell).toBeVisible();
  const box = await cell.boundingBox();
  expect(box).toBeTruthy();
  expect(Math.abs((box?.width ?? 0) - (box?.height ?? 0))).toBeLessThan(1.5);
  expect(box!.width).toBeLessThanOrEqual(10);
  expect(box!.width).toBeGreaterThanOrEqual(5);
  await expect(usage.getByRole('radio', {name: 'Polymux'}).locator('img')).toHaveAttribute('src', 'polymux.svg');
  await expect(usage.getByRole('radio', {name: 'Codex'}).locator('.usage-runtime-logo')).toHaveCount(1);
  const card = usage.getByRole('radio', {name: 'All'});
  const heading = await card.locator('.usage-agent-heading').boundingBox();
  const summary = await card.locator('.usage-agent-summary').boundingBox();
  expect(summary!.y).toBeGreaterThanOrEqual(heading!.y + heading!.height);
  const total = await usage.locator('.usage-metric strong').first().innerText();

  await usage.getByRole('tab', {name: 'Weekly'}).click();
  await expect(usage.getByRole('tab', {name: 'Weekly'})).toHaveAttribute('aria-selected', 'true');
  const weekly = await cell.boundingBox();
  expect(Math.abs((weekly?.width ?? 0) - (weekly?.height ?? 0))).toBeLessThan(1.5);

  await expect(usage.getByText('background-gui')).toBeVisible();
  await expect(usage.getByText('GitHub')).toBeVisible();
  await page.getByRole('button', {name: 'Expand Workspace'}).click();
  await expect(usage.getByText('GitHub')).toBeVisible();
  await expect(usage.getByRole('button', {name: 'Next agents'})).toHaveCount(0);
  await page.getByRole('button', {name: 'Minimise Workspace'}).click();
  await expect(usage.getByRole('radio', {name: 'All'})).toHaveAttribute('aria-checked', 'true');
  await usage.getByRole('radio', {name: 'Codex'}).click();
  await expect(usage.getByRole('radio', {name: 'Codex'})).toHaveAttribute('aria-checked', 'true');
  await expect(usage.getByText('window-control')).toBeVisible();
  await expect(usage.getByText('background-gui')).toHaveCount(0);
  await expect(usage.locator('.usage-metric strong').first()).not.toHaveText(total);

  await usage.getByRole('radio', {name: 'All'}).click();
  await expect(usage.locator('.usage-metric strong').first()).toHaveText(total);
  await page.setViewportSize({width: 1280, height: 600});
  await usage.getByRole('button', {name: 'More: Most used plugins'}).click();
  await expect(usage.locator('.usage-depth')).toBeVisible();
  await expect(usage.getByRole('heading', {name: 'Most used plugins'})).toBeVisible();
  await expect(usage.getByText('email-use')).toBeVisible();
  await usage.getByRole('button', {name: 'Back'}).click();
  await expect(usage.locator('.usage-home')).toBeVisible();

  await usage.getByRole('button', {name: 'More: Token activity'}).click();
  await expect(usage.getByRole('heading', {name: 'Token activity', level: 1})).toBeVisible();
  await usage.getByRole('button', {name: 'Back'}).click();
  await expect(usage.locator('.usage-home')).toBeVisible();
  expect(await usage.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeLessThanOrEqual(1);
});

test('Usage home still fits in a narrow drawer and a short pane', async ({page}) => {
  const usage = await openUsage(page);
  await page.getByRole('button', {name: 'Toggle Chats', exact: true}).click();

  await page.setViewportSize({width: 420, height: 720});
  await expect(usage.getByRole('heading', {name: 'Usage', exact: true})).toBeVisible();
  expect(await usage.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeLessThanOrEqual(1);
  const metrics = usage.locator('.usage-metric:visible');
  await expect(metrics.last()).toHaveCSS('border-right-width', '0px');
  await expect(metrics.first()).toHaveCSS('border-left-width', '0px');
  const months = await usage.locator('.usage-month-slot').evaluateAll(nodes => nodes.map(node => {
    const label = node.firstElementChild as HTMLElement;
    return {top: node.getBoundingClientRect().top, visible: getComputedStyle(label).visibility !== 'hidden',
      width: node.clientWidth, labelWidth: label.getBoundingClientRect().width};
  }));
  expect(new Set(months.map(month => month.top)).size).toBe(1);
  for (const month of months.filter(month => month.visible)) expect(month.labelWidth).toBeLessThanOrEqual(month.width);
  await usage.screenshot({path: '/tmp/polymux-usage-narrow.png', animations: 'disabled'});
  const narrow = await usage.locator('button.usage-cell').first().boundingBox();
  expect(Math.abs((narrow?.width ?? 0) - (narrow?.height ?? 0))).toBeLessThan(1.5);
  expect(narrow!.width).toBeLessThanOrEqual(10);

  await page.setViewportSize({width: 1100, height: 520});
  await expect(usage.locator('.usage-home')).toBeVisible();
  expect(await usage.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeLessThanOrEqual(1);
  const short = await usage.locator('button.usage-cell').first().boundingBox();
  expect(Math.abs((short?.width ?? 0) - (short?.height ?? 0))).toBeLessThan(1.5);
  expect(short!.width).toBeLessThanOrEqual(10);
});

test('agent carousel stops at both ends and keeps selection and order stable', async ({page}, testInfo) => {
  const usage = await openUsage(page);
  await page.getByRole('button', {name: 'Toggle Chats', exact: true}).click();
  await page.setViewportSize({width: 420, height: 900});
  const rail = usage.getByRole('radiogroup', {name: 'Agents'});
  const previous = usage.getByRole('button', {name: 'Previous agents'});
  const next = usage.getByRole('button', {name: 'Next agents'});
  await expect(previous).toBeDisabled();
  await expect(next).toBeEnabled();
  await next.click();
  await expect(next).toBeDisabled();
  await expect(previous).toBeEnabled();
  await expect.poll(() => rail.evaluate(node => Math.abs(node.scrollWidth - node.clientWidth - node.scrollLeft))).toBeLessThanOrEqual(1);
  await usage.getByRole('radio', {name: 'Codex'}).click();
  await expect(usage.getByRole('radio', {name: 'Codex'})).toHaveAttribute('aria-checked', 'true');
  await expect(next).toBeDisabled();
  expect(await rail.getByRole('radio').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')))).toEqual(['All', 'Polymux', 'Claude Code', 'Codex']);
  await previous.click();
  await expect(previous).toBeDisabled();
  await expect.poll(() => rail.evaluate(node => node.scrollLeft)).toBe(0);
  await usage.getByRole('radio', {name: 'All'}).click();
  await usage.getByRole('radio', {name: 'All'}).press('ArrowLeft');
  await expect(usage.getByRole('radio', {name: 'All'})).toBeFocused();
  await usage.getByRole('radio', {name: 'All'}).press('End');
  await expect(usage.getByRole('radio', {name: 'Codex'})).toBeFocused();
  await usage.getByRole('radio', {name: 'Codex'}).press('ArrowRight');
  await expect(usage.getByRole('radio', {name: 'Codex'})).toBeFocused();
  await usage.getByRole('radio', {name: 'Codex'}).press('Home');
  await expect(usage.getByRole('radio', {name: 'All'})).toBeFocused();
  await expect(previous).toBeDisabled();
  await expect(usage).toHaveAttribute('aria-busy', 'false');
  // Render both themes without changing the demo account's settings.
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await expect(usage.locator('.usage-polymux-logo')).toHaveCSS('filter', 'brightness(0) invert(1)');
  await usage.screenshot({path: testInfo.outputPath('usage-narrow.png'), animations: 'disabled'});
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await page.setViewportSize({width: 1280, height: 1000});
  await page.getByRole('button', {name: 'Expand Workspace'}).click();
  await expect(next).toHaveCount(0);
  await expect(previous).toHaveCount(0);
  await expect.poll(() => usage.evaluate(node => node.clientWidth)).toBeGreaterThan(1000);
  await usage.screenshot({path: testInfo.outputPath('usage-wide.png'), animations: 'disabled'});
});

test('Assistant and Team show the runtimes used in each and scope every detail', async ({page}, testInfo) => {
  const usage = await openUsage(page);
  const scopes = usage.getByRole('tablist', {name: 'Usage scope'});
  const rail = usage.getByRole('radiogroup', {name: 'Agents'});
  const total = usage.locator('.usage-metric strong').first();
  const combined = await total.innerText();
  await scopes.getByRole('tab', {name: 'Assistant', exact: true}).click();
  await expect(usage).toHaveAttribute('aria-busy', 'false');
  await expect(rail.getByRole('radio', {name: 'Codex'})).toHaveCount(0);
  await expect(rail.getByRole('radio', {name: 'Claude Code'})).toBeVisible();
  await expect(rail.getByRole('radio', {name: 'Polymux'})).toBeVisible();
  const assistant = await total.innerText();
  expect(assistant).not.toBe(combined);
  await rail.getByRole('radio', {name: 'Claude Code'}).click();
  await expect(total).not.toHaveText(assistant);
  await expect(rail.getByRole('radio', {name: 'Claude Code'}).locator('img')).toHaveCount(1);
  await usage.screenshot({path: testInfo.outputPath('usage-assistant.png'), animations: 'disabled'});
  await scopes.getByRole('tab', {name: 'Team', exact: true}).click();
  await expect(usage).toHaveAttribute('aria-busy', 'false');
  await expect(rail.getByRole('radio', {name: 'All', exact: true})).toHaveAttribute('aria-checked', 'true');
  await expect(rail.getByRole('radio', {name: 'Claude Code'})).toHaveCount(0);
  await expect(rail.getByRole('radio', {name: 'Codex'})).toBeVisible();
  await expect(usage.getByRole('radio', {name: 'Reviewer'})).toHaveCount(0);
  await expect(total).not.toHaveText(assistant);
  await expect(usage.getByText('background-gui')).toHaveCount(0);
  await expect(usage.getByText('window-control')).toBeVisible();
  await rail.getByRole('radio', {name: 'Codex'}).click();
  await expect(usage.getByText('window-control')).toBeVisible();
  await expect(usage.getByText('background-gui')).toHaveCount(0);
  await expect(scopes.getByRole('tab', {name: 'Team', exact: true})).toHaveAttribute('aria-selected', 'true');
  await expect(rail.getByRole('radio', {name: 'Codex'})).toHaveAttribute('aria-checked', 'true');
  await usage.screenshot({path: testInfo.outputPath('usage-team.png'), animations: 'disabled'});
  await scopes.getByRole('tab', {name: 'All', exact: true}).click();
  await expect(total).toHaveText(combined);
  await expect(rail.getByRole('radio', {name: 'All', exact: true})).toHaveAttribute('aria-checked', 'true');
});


test('section More actions only appear for hidden rows and align right', async ({page}, testInfo) => {
  await page.setViewportSize({width: 1280, height: 1200});
  const usage = await openUsage(page);
  const activity = usage.getByRole('region', {name: 'Activity', exact: true});
  await expect(usage.getByRole('button', {name: 'More: Activity', exact: true})).toHaveCount(0);
  await expect(usage.getByRole('button', {name: 'More: Most used plugins', exact: true})).toHaveCount(0);
  await expect(usage.getByRole('button', {name: 'More: Most used connections', exact: true})).toHaveCount(0);
  await expect(usage.getByRole('button', {name: 'More: Spend by model', exact: true})).toHaveCount(0);
  await expect(usage.getByText('email-use', {exact: true})).toBeVisible();
  await usage.screenshot({path: testInfo.outputPath('usage-full-sections.png'), animations: 'disabled'});
  await page.setViewportSize({width: 1280, height: 600});
  const more = usage.getByRole('button', {name: 'More: Activity', exact: true});
  await expect(more).toBeVisible();
  const sectionBox = await activity.boundingBox();
  const moreBox = await more.boundingBox();
  expect(Math.abs(sectionBox!.x + sectionBox!.width - moreBox!.x - moreBox!.width)).toBeLessThanOrEqual(1);
  await expect(usage.getByRole('heading', {name: 'Most used connections', exact: true})).toBeVisible();
  await expect(usage.getByRole('heading', {name: 'Spend by model', exact: true})).toBeVisible();
  await usage.screenshot({path: testInfo.outputPath('usage-compact-sections.png'), animations: 'disabled'});
  await more.click();
  await expect(usage.getByText('Skills explored', {exact: true})).toBeVisible();
  await expect(usage.getByText('Total skills used', {exact: true})).toBeVisible();
  await usage.getByRole('button', {name: 'Back', exact: true}).click();
  await usage.getByRole('button', {name: 'More: Most used plugins', exact: true}).click();
  await expect(usage.getByText('email-use', {exact: true})).toBeVisible();
});
