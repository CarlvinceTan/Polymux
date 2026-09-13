import {expect, test, type Page} from '@playwright/test';

async function microphone(page: Page) {
  await page.addInitScript(() => {
    const context = new AudioContext();
    const tone = context.createOscillator();
    tone.frequency.value = 180;
    tone.start();
    const streams: MediaStream[] = [];
    (window as any).__messageStreams = streams;
    navigator.mediaDevices.getUserMedia = async () => {
      await context.resume();
      const destination = context.createMediaStreamDestination();
      tone.connect(destination);
      streams.push(destination.stream);
      return destination.stream;
    };
  });
}

async function team(page: Page) {
  await page.goto('/?coldStart=0');
  const drawer = page.locator('aside.chat-drawer');
  await drawer.getByRole('button', {name: 'Team', exact: true}).click();
  await drawer.getByRole('button', {name: /Open Maya, Product researcher/}).click();
  return page.getByRole('region', {name: 'Conversation with Maya'});
}

for (const theme of ['light', 'dark']) {
  test(`bot dictation and separate voice recording in ${theme}`, async ({page}, info) => {
    await microphone(page);
    const pane = await team(page);
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    const input = pane.getByRole('textbox', {name: 'Message Maya'});
    await expect(pane.getByRole('button', {name: 'Dictate message'})).toBeVisible();
    await page.screenshot({path: info.outputPath(`message-input-${theme}.png`)});
    await pane.getByRole('button', {name: 'Dictate message'}).click();
    await expect(input).toHaveValue(/this is/, {timeout: 10000});
    await pane.getByRole('button', {name: 'Stop dictation'}).click();
    await expect(pane.getByRole('button', {name: 'Send message', exact: true})).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as any).__messageStreams.every((stream: MediaStream) => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
    await pane.getByRole('button', {name: 'More'}).click();
    await page.getByRole('menuitem', {name: 'Record voice message'}).click();
    await expect(pane.getByRole('button', {name: 'Stop recording'})).toBeEnabled();
    await page.waitForTimeout(800);
    await pane.getByRole('button', {name: 'Stop recording'}).click();
    await expect(pane.locator('audio')).toHaveAttribute('src', /^blob:/);
    await expect(pane.getByRole('button', {name: 'Send recording'})).toBeVisible();
    if (theme === 'dark') {
      await pane.getByRole('button', {name: 'Send recording'}).click();
      await expect(pane.getByText('Voice recording.webm', {exact: true}).first()).toBeVisible();
    } else await pane.getByRole('button', {name: 'Discard recording'}).click();
    await expect(input).toHaveValue(/this is/);
    // A pending permission request must not reopen the mic after changing chats.
    await input.fill('');
    await pane.getByRole('button', {name: 'Dictate message'}).click();
    await page.locator('aside.chat-drawer').getByRole('button', {name: /Open Linus, Software engineer/}).click();
    await page.waitForTimeout(800);
    await expect(page.getByRole('textbox', {name: 'Message Linus'})).toHaveValue('');
    await expect.poll(() => page.evaluate(() => (window as any).__messageStreams.every((stream: MediaStream) => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
  });
}

test('Hub uses dictation and keeps voice recording in the add menu', async ({page}) => {
  await microphone(page);
  await page.goto('/?coldStart=0');
  await page.waitForFunction(() => typeof (window as any).polymuxDemoSetPlatformLinked === 'function');
  await page.evaluate(() => {
    (window as any).polymuxDemoSetPlatformLinked('wechat', true);
    (window as any).polymuxDemoSetWeChatGroup({name: 'Study group'});
  });
  await page.getByRole('button', {name: 'Toggle Workspace'}).click();
  await page.locator('.workspace-launcher-row', {hasText: 'Hub'}).click();
  await page.locator('.hub-view-row', {hasText: 'Study group'}).click();
  const composer = page.locator('.hub-view-composer-row').last();
  await composer.getByRole('button', {name: 'Dictate message'}).click();
  await expect(composer.getByRole('textbox')).toHaveValue(/this is/, {timeout: 10000});
  await composer.getByRole('button', {name: 'Stop dictation'}).click();
  await composer.locator('.hub-view-composer-add').click();
  await expect(composer.getByRole('menuitem', {name: /Record.*voice/i})).toBeVisible();
});
