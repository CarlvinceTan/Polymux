import {expect, test} from '@playwright/test';

test('Phone opens from the workspace and exposes the complete setup state', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name: 'Toggle Workspace'}).click();
  const launcher = page.locator('.workspace-launcher');
  await launcher.getByRole('button', {name: 'Phone'}).click();

  const phone = page.locator('.phone-view');
  await expect(phone.getByRole('heading', {name: 'Set up this iPhone'})).toBeVisible();
  await expect(phone).toContainText('iPhone 16 Pro');
  await expect(phone).toContainText('Developer Mode');
  await expect(phone.getByRole('button', {name: 'Start phone control'})).toBeEnabled();
});

test('Phone remains available when its view closes and stops only on request', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name: 'Toggle Workspace'}).click();
  const launcher = page.locator('.workspace-launcher');
  await launcher.getByRole('button', {name: 'Phone'}).click();

  const phone = page.locator('.phone-view');
  await phone.getByRole('button', {name: 'Start phone control'}).click();
  await expect(phone.getByRole('button', {name: 'Stop phone control'})).toBeVisible();
  await expect(phone.getByRole('img', {name: 'Live iPhone screen'})).toBeVisible();
  await expect(phone.getByRole('button', {name: 'Home'})).toBeVisible();
  await expect(phone.getByRole('textbox', {name: 'Type on iPhone'})).toBeVisible();
  await expect(phone).toContainText('Phone stays available to you and your agent');

  await page.getByRole('button', {name: 'Toggle Workspace'}).click();
  await page.getByRole('button', {name: 'Toggle Workspace'}).click();
  await expect(phone.getByRole('button', {name: 'Stop phone control'})).toBeVisible();

  await phone.getByRole('button', {name: 'Stop phone control'}).click();
  await expect(phone.getByRole('button', {name: 'Start phone control'})).toBeVisible();
});

test('Phone pairs Android wirelessly without a developer tool workflow', async ({page}) => {
  await page.goto('/?phone=android-pair');
  await page.getByRole('button', {name: 'Toggle Workspace'}).click();
  const launcher = page.locator('.workspace-launcher');
  await launcher.getByRole('button', {name: 'Phone'}).click();

  const phone = page.locator('.phone-view');
  await expect(phone.getByRole('heading', {name: 'Connect your phone'})).toBeVisible();
  await phone.getByRole('button', {name: 'Pair Android wirelessly'}).click();
  await phone.getByRole('textbox', {name: 'Android pairing address'}).fill('192.168.1.24:37123');
  await phone.getByRole('textbox', {name: 'Android pairing code'}).fill('123456');
  await expect(phone.getByRole('textbox', {name: 'Android connection address'})).toBeVisible();
  await phone.getByRole('button', {name: 'Pair Android', exact: true}).click();

  await expect(phone.getByRole('button', {name: 'Stop phone control'})).toBeVisible();
  await expect(phone.getByRole('img', {name: 'Live Android screen'})).toBeVisible();
  await expect(phone.getByRole('textbox', {name: 'Type on Android'})).toBeVisible();
});

test('Phone locally signs an iPhone through Apple Account verification', async ({page}) => {
  await page.goto('/?phone=ios-signing');
  await page.getByRole('button', {name: 'Toggle Workspace'}).click();
  const launcher = page.locator('.workspace-launcher');
  await launcher.getByRole('button', {name: 'Phone'}).click();

  const phone = page.locator('.phone-view');
  await expect(phone.getByRole('heading', {name: 'Set up this iPhone'})).toBeVisible();
  await phone.getByRole('textbox', {name: 'Apple Account email'}).fill('owner@example.com');
  await phone.getByLabel('Apple Account password').fill('private-password');
  await phone.getByRole('button', {name: 'Continue'}).click();

  await expect(phone.getByText('Enter the six-digit code Apple shows on a trusted device.')).toBeVisible();
  await phone.getByRole('textbox', {name: 'Apple verification code'}).fill('123456');
  await phone.getByRole('button', {name: 'Verify & start'}).click();

  await expect(phone.getByRole('button', {name: 'Stop phone control'})).toBeVisible();
  await expect(phone.getByRole('img', {name: 'Live iPhone screen'})).toBeVisible();
});
