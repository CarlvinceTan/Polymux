import {expect, test} from '@playwright/test';

test('shell panels, composer, voice, and logo behave together', async ({page}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', {name: 'What can I help with?'})).toBeVisible();

  const logo = await page.evaluate(async () => fetch('/polymux.svg').then((response) => response.text()));
  expect(logo).toContain('fill="#000"');
  expect(logo).not.toContain('<rect');

  const history = page.locator('aside[aria-label="History"]');
  await page.getByRole('button', {name: 'Show History'}).click();
  await expect(history).toHaveClass(/open/);
  await page.getByRole('button', {name: 'Hide History'}).click();
  await expect(history).not.toHaveClass(/open/);

  await page.getByRole('button', {name: 'Show Summary'}).click();
  await expect(page.getByRole('complementary', {name: 'Summary'})).toBeVisible();
  await page.getByRole('button', {name: 'Show Workspace'}).click();
  await expect(page.getByRole('complementary', {name: 'Summary'})).toHaveCount(0);
  await expect(page.getByRole('complementary', {name: 'Workspace'})).toHaveClass(/open/);

  await page.getByLabel('New chat', {exact: true}).click();
  await page.getByRole('textbox', {name: 'Message Midas'}).fill('Test the assembled chat');
  await page.getByRole('button', {name: 'Send message'}).click();
  await expect(page.getByRole('paragraph').filter({hasText: 'Test the assembled chat'})).toBeVisible();
  await expect(page.getByRole('paragraph').filter({hasText: /assembled Midas chat surface/})).toBeVisible({timeout: 3000});

  await page.getByRole('button', {name: 'Voice'}).click();
  await expect(page.getByRole('region', {name: 'Voice conversation'})).toBeVisible();
  await page.getByRole('button', {name: 'Exit voice'}).click();
  await expect(page.getByRole('region', {name: 'Voice conversation'})).toHaveCount(0);
});
