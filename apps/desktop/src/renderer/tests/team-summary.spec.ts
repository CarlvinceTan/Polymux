import {expect, test} from '@playwright/test';

for (const theme of ['light', 'dark']) {
  test(`bot summary and schedules stay scoped to the bot (${theme})`, async ({page}, info) => {
    page.setDefaultTimeout(5000);
    await page.goto('/?coldStart=0&splashSettled=1');
    await page.locator('html').evaluate((node, value) => node.setAttribute('data-theme', value), theme);
    const chats = page.locator('aside.chat-drawer');
    await chats.getByRole('button', {name: 'Team', exact: true}).click();
    await chats.getByRole('button', {name: /Open Maya, Product researcher/}).click();
    const summary = page.getByRole('complementary', {name: 'Summary', exact: true});
    await expect(summary).toBeVisible();
    await expect(summary.getByRole('heading', {name: 'Schedule', exact: true})).toBeVisible();
    await expect(summary.getByRole('heading', {name: 'References', exact: true})).toBeVisible();
    await expect(summary.getByRole('heading', {name: 'Computer Use', exact: true})).toBeVisible();
    await expect(summary.getByRole('button', {name: 'Subagents', exact: true})).toHaveCount(0);
    await summary.screenshot({path: info.outputPath('bot-summary.png')});
    await summary.getByRole('button', {name: 'Open Maya schedule', exact: true}).click();
    const workspace = page.locator('.workspace-drawer');
    await expect(workspace.getByText('Morning brief', {exact: true})).toHaveCount(0);
    await workspace.getByRole('button', {name: 'New schedule', exact: true}).first().click();
    await workspace.getByLabel('Name', {exact: true}).fill('Maya weekly research with a deliberately long descriptive title');
    await workspace.getByLabel('Instruction', {exact: true}).fill('Review the saved reference documents and prepare a research note.');
    await workspace.getByRole('button', {name: 'Save', exact: true}).click();
    const row = workspace.locator('.schedule-row', {hasText: 'Maya weekly research'});
    await expect(row).toBeVisible();
    await row.getByRole('button', {name: /^Pause /}).click();
    await expect(row).toContainText('Paused');
    await workspace.screenshot({path: info.outputPath('bot-schedule.png')});
    await page.getByRole('button', {name: 'Toggle Workspace', exact: true}).click();
    await expect(summary).toContainText('Maya weekly research');
    await expect(summary).toContainText('Paused');
    await page.getByRole('button', {name: 'Toggle Chats', exact: true}).click();
    await page.setViewportSize({width: 420, height: 780});
    if (!(await summary.isVisible())) await page.getByRole('button', {name: 'Toggle Summary', exact: true}).click();
    await summary.screenshot({path: info.outputPath('bot-summary-narrow.png')});
    expect(await summary.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    await page.setViewportSize({width:1280, height:900});
    await page.getByRole('button', {name: 'Toggle Chats', exact: true}).click();
    await chats.getByRole('button', {name: /Open Linus, Software engineer/}).click();
    await expect(summary).not.toContainText('Maya weekly research');
    await summary.getByRole('button', {name: 'Open Linus schedule', exact: true}).click();
    await expect(workspace.locator('.schedule-row')).toHaveCount(0);
  });
}
