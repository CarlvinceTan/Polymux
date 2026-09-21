import {expect, test} from '@playwright/test';

test('Team chat keeps avatars out of history and messages agents inline', async ({page}) => {
  await page.setViewportSize({width: 1340, height: 860});
  await page.goto('/?coldStart=0');

  const drawer = page.locator('aside.chat-drawer');
  await drawer.getByRole('button', {name: 'Team', exact: true}).click();
  await drawer.getByRole('button', {name: 'Open Maya, Product researcher'}).click();

  const activity = page.locator('.team-chat-activity', {hasText: 'Messaged Linus'});
  await expect(activity).toBeVisible();
  await expect(activity.locator('.team-chat-activity-avatar svg')).toBeVisible();
  await expect(page.locator('.team-chat-message-row.agent:not(.detached-typing) .team-chat-avatar')).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Stop Agent', exact: true})).toHaveCount(0);

  await page.evaluate(() => {
    (window as unknown as {
      polymuxDemoSetTeamStatus?: (id: string, status: 'working') => void;
    }).polymuxDemoSetTeamStatus?.('maya', 'working');
  });

  const typing = page.locator('.team-chat-message-row.detached-typing');
  await expect(typing.locator('.team-chat-avatar svg')).toBeVisible();
  await expect(typing.locator('.team-chat-typing i')).toHaveCount(3);
});
