import {expect, test} from '@playwright/test';

test('Team search shows bot avatars and roles and opens the selected bot', async ({page}) => {
  await page.goto('/?coldStart=0');
  const drawer = page.locator('aside.chat-drawer');
  await drawer.getByRole('button', {name: 'Team', exact: true}).click();
  await drawer.getByRole('button', {name: 'Search', exact: true}).click();
  const modal = page.getByRole('dialog', {name: 'Search chats', exact: true});
  const input = modal.getByRole('textbox', {name: 'Search chats', exact: true});
  await input.fill('Product researcher');
  const result = modal.getByRole('option', {name: 'Maya', exact: true});
  await expect(result.getByRole('img', {name: 'Maya avatar'})).toBeVisible();
  await expect(result.locator('.team-role-label')).toHaveText('Product researcher');
  await input.fill('no matching bot 8392');
  await expect(modal.getByRole('option')).toHaveCount(0);
  await input.fill('Maya');
  // Enter activates the highlighted result; the Team group also matches "Maya"
  // through its history, so assert the highlighted Maya row opens instead of
  // assuming which row sorts first.
  await result.click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Edit bot Maya', exact: true})).toBeVisible();

  await drawer.getByRole('button', {name: 'Search', exact: true}).click();
  await input.fill('onboarding findings');
  await expect(result).toBeVisible();
  await expect(result.getByRole('img', {name: 'Maya avatar'})).toBeVisible();
  await expect(result.locator('.team-role-label')).toHaveText('Product researcher');
  await expect(result.locator('..').locator('.chat-search-snippet mark')).toHaveText('onboarding findings');
  await expect(modal.getByRole('option')).toHaveCount(2);
});
