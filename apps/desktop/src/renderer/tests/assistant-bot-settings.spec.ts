import {expect, test, type Page} from '@playwright/test';

async function editBot(page: Page, name = 'Maya') {
  const drawer = page.locator('aside.chat-drawer');
  await drawer.getByRole('button', {name:'Team', exact:true}).click();
  await drawer.getByRole('button', {name:new RegExp(`^Open ${name},`)}).click();
  await page.getByRole('button', {name:`Edit bot ${name}`, exact:true}).click();
  const dialog = page.locator('aside.workspace-drawer').getByRole('region', {name:`Edit ${name}`, exact:true});
  await expect(dialog.getByRole('radiogroup', {name:'Bot agent', exact:true})).toBeVisible();
  await expect(dialog.getByRole('button', {name:'Save', exact:true})).toBeEnabled();
  return dialog;
}

for (const theme of ['light', 'dark']) {
  test(`Assistant has Models and Providers; bots own the agent grid (${theme})`, async ({page}, info) => {
    await page.goto('/?coldStart=0&splashSettled=1');
    await page.getByRole('button', {name:'Settings', exact:true}).click();
    await page.getByRole('radio', {name:theme === 'light' ? 'Light' : 'Dark', exact:true}).click();
    const settings = page.getByRole('region', {name:'Settings', exact:true});
    await expect(settings.getByRole('tab', {name:'Agent', exact:true})).toHaveCount(0);
    for (const tab of ['Models', 'Providers']) {
      await settings.getByRole('tab', {name:tab, exact:true}).click();
      await expect(settings.getByRole('tab', {name:tab, exact:true})).toHaveAttribute('aria-selected','true');
      await expect(settings.getByRole('heading', {name:tab, exact:true})).toBeVisible();
      await expect(settings.getByRole('radiogroup', {name:'Agent runtime'})).toHaveCount(0);
      await settings.screenshot({path:info.outputPath(`${tab}.png`)});
    }
    const dialog = await editBot(page);
    await dialog.getByRole('radio', {name:'Codex', exact:true}).click();
    await dialog.getByRole('button', {name:'Save', exact:true}).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button', {name:'Edit bot Maya', exact:true}).click();
    await expect(dialog.getByRole('radio', {name:'Codex', exact:true})).toHaveAttribute('aria-checked','true');
    await dialog.getByRole('button', {name:'Model', exact:true}).click();
    await page.getByRole('menu', {name:'Model', exact:true}).getByRole('menuitemradio', {name:'Claude Opus', exact:true}).click();
    await expect(dialog.getByRole('button', {name:'Model', exact:true})).toHaveText('Claude Opus');
    await dialog.getByRole('button', {name:'Model', exact:true}).click();
    await page.getByRole('menu', {name:'Model',exact:true}).getByRole('menuitemradio', {name:'Claude Opus',exact:true}).press('Escape');
    await expect(page.getByRole('menu', {name:'Model',exact:true})).toHaveCount(0);
    await dialog.screenshot({path:info.outputPath('bot-configured.png')});
    await page.setViewportSize({width:390,height:760});
    await dialog.getByRole('heading', {name:'Agent',exact:true}).scrollIntoViewIfNeeded();
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate(n => n.scrollWidth <= n.clientWidth)).toBe(true);
    await dialog.screenshot({path:info.outputPath('bot-narrow.png')});
    await dialog.getByRole('button', {name:'Cancel', exact:true}).click();
    await page.setViewportSize({width:1280,height:900});
    const other = await editBot(page, 'Linus');
    await expect(other.getByRole('radio', {name:'Polymux Built in',exact:true})).toHaveAttribute('aria-checked','true');
    await other.getByRole('button', {name:'Cancel', exact:true}).click();
    await page.getByLabel('Settings', {exact:true}).click();
    await settings.getByRole('tab', {name:'Models',exact:true}).click();
    await expect(settings.getByRole('heading', {name:'Models',exact:true})).toBeVisible();
  });
}

test('bot settings failures keep the agent selection and support retry', async ({page}) => {
  await page.goto('/?coldStart=0&splashSettled=1&botAgentSettings=fail');
  const dialog = await editBot(page);
  await expect(dialog.getByRole('alert')).toHaveText(/Could not load this bot/);
  await expect(dialog.getByRole('radio', {name:'Codex',exact:true})).toBeEnabled();
  await expect(dialog.getByRole('button', {name:'Try again',exact:true})).toBeEnabled();
});

test('bots expose advertised authentication and preserve it through metadata saves', async ({page}) => {
  await page.goto('/?coldStart=0&splashSettled=1');
  let dialog = await editBot(page);
  await dialog.getByRole('radio', {name:'Codex',exact:true}).click();
  await dialog.getByRole('button', {name:'Save',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', {name:'Edit bot Maya',exact:true}).click();
  dialog = page.locator('aside.workspace-drawer').getByRole('region', {name:'Edit Maya',exact:true});
  await dialog.getByRole('button', {name:'Sign out',exact:true}).click();
  await expect(dialog.getByRole('button', {name:'Model',exact:true})).toHaveCount(0);
  await dialog.getByRole('button', {name:'Save',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', {name:'Edit bot Maya',exact:true}).click();
  await expect(dialog.getByRole('button', {name:'Model',exact:true})).toHaveCount(0);
  await dialog.getByRole('button', {name:'Sign in with agent account',exact:true}).click();
  await expect(dialog.getByRole('button', {name:'Model',exact:true})).toBeVisible();
});

for (const name of ['Junie', 'Poolside']) {
  test(`bots retain ${name} registry configuration`, async ({page}) => {
    await page.goto('/?coldStart=0&splashSettled=1');
    const dialog = await editBot(page);
    await dialog.getByRole('radio', {name,exact:true}).click();
    await dialog.getByRole('button', {name:'Save',exact:true}).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button', {name:'Edit bot Maya',exact:true}).click();
    await expect(dialog.getByRole('radio', {name,exact:true})).toHaveAttribute('aria-checked','true');
    await expect(dialog.getByRole('textbox', {name:'Command',exact:true})).toHaveCount(0);
  });
}

test('custom bot commands validate and persist independently', async ({page}) => {
  await page.goto('/?coldStart=0&splashSettled=1');
  const dialog = await editBot(page);
  await dialog.getByRole('radio', {name:'Custom Name and command',exact:true}).click();
  await expect(dialog.getByRole('button', {name:'Save',exact:true})).toBeDisabled();
  const agent = dialog.getByRole('region', {name:'Bot agent settings',exact:true});
  await agent.getByRole('textbox', {name:'Name',exact:true}).fill('A custom agent with a deliberately long display name');
  await agent.getByRole('textbox', {name:'Command',exact:true}).fill('fixture-acp');
  await agent.getByRole('textbox', {name:'Arguments',exact:true}).fill('--mode\nresearch');
  await dialog.getByRole('button', {name:'Save',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', {name:'Edit bot Maya',exact:true}).click();
  await expect(agent.getByRole('textbox', {name:'Command',exact:true})).toHaveValue('fixture-acp');
  await expect(agent.getByRole('textbox', {name:'Arguments',exact:true})).toHaveValue('--mode\nresearch');
});

test('bots can choose from grouped advertised model catalogues', async ({page}) => {
  await page.goto('/?coldStart=0&splashSettled=1');
  const dialog = await editBot(page);
  await dialog.getByRole('radio', {name:'pi ACP',exact:true}).click();
  await dialog.getByRole('button', {name:'Save',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', {name:'Edit bot Maya',exact:true}).click();
  await dialog.getByRole('button', {name:'Model',exact:true}).click();
  const menu = page.getByRole('menu', {name:'Model',exact:true});
  const options = menu.getByRole('menuitemradio');
  expect(await options.count()).toBe(8);
  const choice = await options.last().innerText();
  await options.last().click();
  await expect(dialog.getByRole('button', {name:'Model',exact:true})).toHaveText(choice.trim());
});
