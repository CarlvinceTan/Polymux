import {expect, test} from '@playwright/test';

test('Mobile opens from the workspace and exposes the complete setup state', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name: 'Toggle Workspace', exact: true}).click();
  const launcher = page.locator('.workspace-launcher');
  await launcher.getByRole('button', {name: 'Mobile', exact: true}).click();

  const mobile = page.locator('.mobile-view');
  await expect(mobile.getByRole('heading', {name: 'Set up this iPhone'})).toBeVisible();
  await expect(mobile).toContainText('iPhone 16 Pro');
  await expect(mobile).toContainText('Developer Mode');
  await expect(mobile.getByRole('button', {name: 'Start mobile control'})).toBeEnabled();
});

test('Mobile remains available when its view closes and stops only on request', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name: 'Toggle Workspace', exact: true}).click();
  const launcher = page.locator('.workspace-launcher');
  await launcher.getByRole('button', {name: 'Mobile', exact: true}).click();

  const mobile = page.locator('.mobile-view');
  await mobile.getByRole('button', {name: 'Start mobile control'}).click();
  await expect(mobile.getByRole('button', {name: 'Stop mobile control'})).toBeVisible();
  await expect(mobile.getByRole('img', {name: 'Live iPhone screen'})).toBeVisible();
  await expect(mobile.getByRole('button', {name: 'Home'})).toBeVisible();
  await expect(mobile.getByRole('textbox', {name: 'Type on iPhone'})).toBeVisible();
  await expect(mobile).toContainText('Mobile stays available to you and your agent');

  await page.getByRole('button', {name: 'Toggle Workspace', exact: true}).click();
  await page.getByRole('button', {name: 'Toggle Workspace', exact: true}).click();
  await expect(mobile.getByRole('button', {name: 'Stop mobile control'})).toBeVisible();

  await mobile.getByRole('button', {name: 'Stop mobile control'}).click();
  await expect(mobile.getByRole('button', {name: 'Start mobile control'})).toBeVisible();
});

test('Mobile pairs Android wirelessly without a developer tool workflow', async ({page}) => {
  await page.goto('/?mobile=android-pair');
  await page.getByRole('button', {name: 'Toggle Workspace', exact: true}).click();
  const launcher = page.locator('.workspace-launcher');
  await launcher.getByRole('button', {name: 'Mobile', exact: true}).click();

  const mobile = page.locator('.mobile-view');
  await expect(mobile.getByRole('heading', {name: 'Connect your mobile'})).toBeVisible();
  await mobile.getByRole('button', {name: 'Pair Android wirelessly'}).click();
  await mobile.getByRole('textbox', {name: 'Android pairing address'}).fill('192.168.1.24:37123');
  await mobile.getByRole('textbox', {name: 'Android pairing code'}).fill('123456');
  await expect(mobile.getByRole('textbox', {name: 'Android connection address'})).toBeVisible();
  await mobile.getByRole('button', {name: 'Pair Android', exact: true}).click();

  await expect(mobile.getByRole('button', {name: 'Stop mobile control'})).toBeVisible();
  await expect(mobile.getByRole('img', {name: 'Live Android screen'})).toBeVisible();
  await expect(mobile.getByRole('textbox', {name: 'Type on Android'})).toBeVisible();
});

test('Mobile locally signs an iPhone through Apple Account verification', async ({page}) => {
  await page.goto('/?mobile=ios-signing');
  await page.getByRole('button', {name: 'Toggle Workspace', exact: true}).click();
  const launcher = page.locator('.workspace-launcher');
  await launcher.getByRole('button', {name: 'Mobile', exact: true}).click();

  const mobile = page.locator('.mobile-view');
  await expect(mobile.getByRole('heading', {name: 'Set up this iPhone'})).toBeVisible();
  await mobile.getByRole('textbox', {name: 'Apple Account email'}).fill('owner@example.com');
  await mobile.getByLabel('Apple Account password').fill('private-password');
  await mobile.getByRole('button', {name: 'Continue'}).click();

  await expect(mobile.getByText('Enter the six-digit code Apple shows on a trusted device.')).toBeVisible();
  await mobile.getByRole('textbox', {name: 'Apple verification code'}).fill('123456');
  await mobile.getByRole('button', {name: 'Verify & start'}).click();

  await expect(mobile.getByRole('button', {name: 'Stop mobile control'})).toBeVisible();
  await expect(mobile.getByRole('img', {name: 'Live iPhone screen'})).toBeVisible();
});
