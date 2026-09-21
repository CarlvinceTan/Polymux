import {readFileSync} from 'node:fs';
import {expect, test, type Locator, type Page} from '@playwright/test';
import {
  MAX_CHAT_DRAWER_WIDTH,
  MAX_WORKSPACE_WIDTH,
  MIN_CHAT_DRAWER_WIDTH,
  SPLIT_LAYOUT_MIN_WIDTH,
} from '../lib/shared/layout/layoutSizing';
import {MENU_EDGE_MARGIN} from '../lib/shared/layout/menuPlacement';

const editor = (page: Page) => page.getByRole('textbox', {name: 'Message Polymux'});
const chatDrawer = (page: Page) => page.locator('aside.chat-drawer');
const workspaceDrawer = (page: Page) => page.locator('aside.workspace-drawer');
const summaryCard = (page: Page) => page.locator('aside.summary-panel');

async function openConnections(page: Page) {
  await chatDrawer(page).getByRole('button', {name: 'Connections'}).click();
  const view = page.getByRole('region', {name: 'Connections'});
  await expect(view).toBeVisible();
  return view;
}
/** Opens an app's own workspace tab from the launcher. */
async function openWorkspaceApp(page: Page, name: string): Promise<Locator> {
  const toggle = page.getByRole('button', {name: 'Toggle Workspace', exact: true});
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
  const drawer = workspaceDrawer(page);
  await drawer.locator('.workspace-launcher-row').filter({hasText: new RegExp(`^${name}$`)}).click();
  return drawer;
}
/** Configuration opens inside the app's workspace tab, beside the app itself. */
async function openAppConnection(page: Page, name: string) {
  const drawer = await openWorkspaceApp(page, name);
  const settingsName = `${name} settings`;
  if (name === 'Browser') {
    // Browser keeps its app settings behind the More menu.
    await drawer.getByRole('button', {name: 'More', exact: true}).click();
    await drawer.getByRole('menuitem', {name: settingsName, exact: true}).click();
  } else {
    await drawer.getByRole('button', {name: settingsName, exact: true}).click();
  }
  const settings = page.getByRole('region', {name: settingsName, exact: true});
  await expect(settings).toBeVisible();
  return settings;
}
/** The launcher's Recent rows: the second group, since the first is the fixed
 * list of views to open. */
const recentRows = (drawer: Locator) =>
  drawer.locator('.workspace-launcher-rows').last().locator('.workspace-launcher-row');

async function paintedTrafficLightColours(lights: Locator): Promise<number[][]> {
  const screenshot = await lights.screenshot();
  return lights.evaluate(async (node, imageUrl) => {
    const image = new Image();
    image.src = imageUrl;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const group = node.getBoundingClientRect();
    return [...node.children].map((dot) => {
      const rect = dot.getBoundingClientRect();
      const x = Math.floor((rect.x + rect.width / 2 - group.x) * canvas.width / group.width);
      const y = Math.floor((rect.y + rect.height / 2 - group.y) * canvas.height / group.height);
      return [...context.getImageData(x, y, 1, 1).data].slice(0, 3);
    });
  }, `data:image/png;base64,${screenshot.toString('base64')}`);
}

async function openAgentSection(settings: Locator, section: 'Models' | 'Providers') {
  await settings.getByRole('tab', {name: section, exact: true}).click();
}

async function toastIconVerticalOffset(toast: Locator): Promise<number> {
  const screenshot = await toast.screenshot({animations: 'disabled'});
  return toast.evaluate(async (node, imageUrl) => {
    const image = new Image();
    image.src = imageUrl;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const toastRect = node.getBoundingClientRect();
    const xScale = canvas.width / toastRect.width;
    const yScale = canvas.height / toastRect.height;
    const pixel = (x: number, y: number): [number, number, number] => {
      const index = (y * canvas.width + x) * 4;
      return [pixels[index]!, pixels[index + 1]!, pixels[index + 2]!];
    };
    const background = pixel(Math.max(1, Math.floor(5 * xScale)), Math.floor(canvas.height / 2));
    const paintedCentre = (element: Element, coloured: boolean): number => {
      const rect = element.getBoundingClientRect();
      const left = Math.max(0, Math.floor((rect.left - toastRect.left) * xScale));
      const right = Math.min(canvas.width - 1, Math.ceil((rect.right - toastRect.left) * xScale));
      const top = Math.max(0, Math.floor((rect.top - toastRect.top) * yScale));
      const bottom = Math.min(canvas.height - 1, Math.ceil((rect.bottom - toastRect.top) * yScale));
      let paintedTop = canvas.height;
      let paintedBottom = -1;
      for (let y = top; y <= bottom; y++) {
        for (let x = left; x <= right; x++) {
          const [red, green, blue] = pixel(x, y);
          const distance = Math.max(Math.abs(red - background[0]), Math.abs(green - background[1]), Math.abs(blue - background[2]));
          const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
          if (distance <= 3 || (coloured ? chroma <= 6 : chroma > 6)) continue;
          paintedTop = Math.min(paintedTop, y);
          paintedBottom = Math.max(paintedBottom, y);
        }
      }
      if (paintedBottom < paintedTop) throw new Error('Expected painted pixels');
      return (paintedTop + paintedBottom) / 2;
    };
    return paintedCentre(node.querySelector('.agent-notice-icon')!, true)
      - paintedCentre(node.querySelector('.agent-notice-message')!, false);
  }, `data:image/png;base64,${screenshot.toString('base64')}`);
}

async function toastHorizontalSpacing(toast: Locator): Promise<number[]> {
  return toast.evaluate((node) => {
    const toastRect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    const severityIcon = node.querySelector('.agent-notice-icon svg')!.getBoundingClientRect();
    const message = node.querySelector('.agent-notice-message')!.getBoundingClientRect();
    const dismissIcon = node.querySelector('.agent-notice-dismiss svg')!.getBoundingClientRect();
    const contentLeft = toastRect.left + Number.parseFloat(style.borderLeftWidth);
    const contentRight = toastRect.right - Number.parseFloat(style.borderRightWidth);
    return [
      severityIcon.left - contentLeft,
      message.left - severityIcon.right,
      dismissIcon.left - message.right,
      contentRight - dismissIcon.right,
    ];
  });
}

/** The conversation and composer derive their geometry from the same animated
 * insets as the drawers. Checking the live frame catches a second, lagging
 * width transition even when everything happens to agree at rest. */
async function expectContentToFollowDrawerInsets(page: Page, label: string) {
  const geometry = await page.evaluate(() => {
    const main = document.querySelector('main')!;
    const style = getComputedStyle(main);
    const leftInset = Number.parseFloat(style.getPropertyValue('--chat-drawer-offset')) || 0;
    const rightInset = Number.parseFloat(style.getPropertyValue('--content-right-column')) || 0;
    const composerRightInset = Number.parseFloat(style.getPropertyValue('--content-composer-column')) || 0;
    const conversation = document.querySelector('.conversation-column')!.getBoundingClientRect();
    const composer = document.querySelector('.composer-column-content')!.getBoundingClientRect();
    const availableWidth = window.innerWidth - leftInset - rightInset;
    const composerAvailableWidth = window.innerWidth - leftInset - composerRightInset;
    return {
      conversationWidth: conversation.width,
      conversationCentre: conversation.left + conversation.width / 2,
      expectedConversationWidth: Math.min(792, availableWidth - 8),
      expectedConversationCentre: leftInset + availableWidth / 2,
      composerWidth: composer.width,
      composerCentre: composer.left + composer.width / 2,
      expectedComposerWidth: Math.min(760, composerAvailableWidth - 40),
      expectedComposerCentre: leftInset + composerAvailableWidth / 2,
    };
  });
  expect(Math.abs(geometry.conversationWidth - geometry.expectedConversationWidth), `${label} conversation width`).toBeLessThanOrEqual(2);
  expect(Math.abs(geometry.conversationCentre - geometry.expectedConversationCentre), `${label} conversation centre`).toBeLessThanOrEqual(2);
  expect(Math.abs(geometry.composerWidth - geometry.expectedComposerWidth), `${label} composer width`).toBeLessThanOrEqual(2);
  expect(Math.abs(geometry.composerCentre - geometry.expectedComposerCentre), `${label} composer centre`).toBeLessThanOrEqual(2);
}

/** Drags from the visible divider rather than the middle of its deliberately
 * generous hit target, then checks the edge and the adjacent content at every
 * stop. This catches both dropped early events and a divider that trails the
 * pointer behind a second layout transition. */
async function dragDrawerDivider(
  page: Page,
  handle: Locator,
  drawer: Locator,
  edge: 'left' | 'right',
  direction: -1 | 1,
  resizingClass: string,
) {
  const [handleBox, drawerBox] = await Promise.all([handle.boundingBox(), drawer.boundingBox()]);
  expect(handleBox).not.toBeNull();
  expect(drawerBox).not.toBeNull();
  const startX = edge === 'left' ? drawerBox!.x - .5 : drawerBox!.x + drawerBox!.width - .5;
  const y = handleBox!.y + handleBox!.height / 2;

  await page.mouse.move(startX, y);
  await page.mouse.down();
  await expect(page.locator('main')).toHaveClass(new RegExp(resizingClass));

  for (const distance of [48, 96, 32]) {
    const targetX = startX + direction * distance;
    await page.mouse.move(targetX, y, {steps: 4});
    await expect.poll(async () => {
      const box = await drawer.boundingBox();
      if (!box) return Number.POSITIVE_INFINITY;
      const drawerEdge = edge === 'left' ? box.x : box.x + box.width;
      return Math.abs(drawerEdge - targetX);
    }).toBeLessThanOrEqual(1);
    await expectContentToFollowDrawerInsets(page, `${resizingClass} at ${distance}px`);
  }

  await page.mouse.up();
  await expect(page.locator('main')).not.toHaveClass(new RegExp(resizingClass));
}

/** The composer's contenteditable does not take synthetic key events from
    `fill`, so a prompt is typed the way a person types it. */
async function send(page: Page, text: string) {
  await editor(page).click();
  await page.keyboard.type(text);
  await page.getByRole('button', {name: 'Send message'}).click();
}

test.describe('welcome view', () => {
  test('shows a restrained Polymux startup screen', async ({page}) => {
    await page.goto('/');
    const splash = page.getByRole('status', {name: 'Loading Polymux'});
    await expect(splash).toBeVisible();
    await expect(splash.locator('svg.startup-mark')).toBeVisible();
    await expect(splash.locator('.startup-word')).toHaveText('Polymux');
    await expect(splash.locator('.startup-status')).toHaveCount(0);
    await expect(splash).not.toContainText('WeChat');
    // Freeze the sequence before reading it so the moving lockup stays put.
    await page.evaluate(() => document.getAnimations().forEach((a) => a.pause()));
    // The mark itself stays complete and still. The only beats are the lockup
    // travelling left and the wordmark sliding right out from behind it.
    const beats = await splash.evaluate((node) => {
      const of = (selector: string) => {
        const style = getComputedStyle(node.querySelector(selector)!);
        return [style.animationName, style.animationDuration, style.animationDelay];
      };
      return {
        mark: of('.startup-mark path'),
        brand: of('.startup-brand'),
        slide: of('.startup-word-slide'),
        // The edge the wordmark comes through does not move, so it is a static
        // mask and not a beat at all. Pinned here because a mask that starts
        // travelling again is exactly the regression to catch — and because it
        // has to begin at the mark's right edge, 18px, so the fade lands on the
        // text and never on the logo.
        edge: getComputedStyle(node.querySelector('.startup-word')!).maskImage,
      };
    });
    expect(beats).toEqual({
      mark: ['none', '0s', '0s'],
      // Last to end — the extra .22s past the travel is the settled hold, and
      // its end is what lifts the cover.
      brand: ['startup-brand-in', '1.22s', '1.08s'],
      slide: ['startup-word-slide', '1s', '1.08s'],
      edge: 'linear-gradient(to right, rgba(0, 0, 0, 0) 18px, rgba(0, 0, 0, 0.12) 21px, rgba(0, 0, 0, 0.5) 24px, rgba(0, 0, 0, 0.88) 27px, rgb(0, 0, 0) 30px)',
    });
    const startupLockup = await splash.locator('.startup-brand').evaluate((node) => {
      const mark = node.querySelector('svg')!.getBoundingClientRect();
      const word = node.querySelector('.startup-word')!;
      const style = getComputedStyle(word);
      // The lockup slides in under a transform, so a box measured mid-flight
      // carries the compositor's sub-pixel remainder — 63.99996948242188 for a
      // mark that is 64 wide. Two decimals is finer than any real regression
      // and coarser than that noise.
      const round = (value: number) => Math.round(value * 100) / 100;
      return {markWidth: round(mark.width), markHeight: round(mark.height), gap: getComputedStyle(node).gap, fontSize: style.fontSize, fontWeight: style.fontWeight, tracking: style.letterSpacing};
    });
    // The mark keeps a square optical box so the lockup does not move at handoff.
    expect(startupLockup).toEqual({markWidth: 64, markHeight: 64, gap: '12px', fontSize: '48px', fontWeight: '750', tracking: '-2.16px'});
    const darkLockup = await splash.locator('.startup-brand').evaluate((node) => {
      document.documentElement.dataset.theme = 'dark';
      return {
        brand: getComputedStyle(node).color,
        mark: getComputedStyle(node.querySelector('.startup-mark')!).color,
      };
    });
    expect(darkLockup).toEqual({brand: 'rgb(250, 250, 250)', mark: 'rgb(250, 250, 250)'});
  });

  test('restores an unfinished prompt after the app document reloads', async ({page}) => {
    await page.goto('/?coldStart=0');
    await editor(page).click();
    await page.keyboard.type('Keep this unfinished prompt');
    await page.reload();
    await expect(editor(page)).toHaveText('Keep this unfinished prompt');
  });

  /**
   * How long the splash stays is a wall-clock property, so it is measured on
   * its own: sharing a test with the geometry above meant the reads had to
   * finish inside the splash's life, which is not something a machine running
   * the rest of this suite alongside it can promise. Here the wait begins the
   * moment the splash is first seen, with nothing in between.
   *
   * The sequence's last beat ends at 2.30s and the cover fades over the .24s
   * after it, so the splash is still up at 2s and gone shortly past 2.5s. The
   * point of the lower bound is that the cover cannot lift early and cut the
   * animation short — the app waits for the lockup, not for a timer.
   */
  test('holds the startup splash for the whole sequence', async ({page}) => {
    await page.goto('/');
    const splash = page.getByRole('status', {name: 'Loading Polymux'});
    await expect(splash).toBeVisible();
    await page.waitForTimeout(2000);
    await expect(splash).toBeVisible();
    await expect(splash).toHaveCount(0, {timeout: 1600});
  });

  /**
   * The handoff document: main navigates the startup-shell window to the real
   * renderer with `splashSettled=1` once the shell's animation has finished.
   * This document must open on the settled lockup — no replay of the sequence
   * — and still leave through the staged exit rather than being torn out.
   */
  test('opens the settled handoff document on the finished lockup', async ({page}) => {
    await page.goto('/?coldStart=0&splashSettled=1');
    const splash = page.getByRole('status', {name: 'Loading Polymux'});
    await expect(splash).toBeVisible();
    const pose = await splash.evaluate((node) => {
      const brand = node.querySelector('.startup-brand')!;
      const slide = node.querySelector('.startup-word-slide')!;
      return {
        state: document.documentElement.dataset.splash,
        brandAnimation: getComputedStyle(brand).animationName,
        slideAnimation: getComputedStyle(slide).animationName,
        // Travel 0: the lockup holds its final centred position, so the only
        // translation left is the sub-pixel snap — under a pixel. The opening
        // pose would sit half the wordmark to the right of it.
        settledTravel:
          Math.abs(new DOMMatrixReadOnly(getComputedStyle(brand).transform).e) < 1,
      };
    });
    expect(pose.state).toBe('settled');
    // The handoff can begin its exit between the splash becoming visible and
    // this read. Either pose is valid; replaying the entrance is not.
    expect(['none', 'startup-brand-out']).toContain(pose.brandAnimation);
    expect(pose.slideAnimation).toBe('none');
    expect(pose.settledTravel).toBe(true);
    // The exit is the staged two-beat fade — lockup out, then the cover — and
    // the brand-in replay a fresh document would otherwise start must not be
    // in its animation list, or the lockup snaps to the opening pose mid-fade.
    await expect(splash).toHaveClass(/leaving/);
    const exit = await splash.evaluate((node) =>
      getComputedStyle(node.querySelector('.startup-brand')!).animationName,
    );
    expect(exit).toBe('startup-brand-out');
    await expect(splash).toHaveCount(0, {timeout: 2000});
  });

  test('shows the Polymux mark, heading and composer, and nothing else', async ({page}) => {
    await page.goto('/');
    await expect(page.getByRole('heading', {name: 'What can I help with?'})).toBeVisible();

    const welcomeGeometry = await page.locator('.welcome-heading').evaluate((node) => {
      const mark = node.querySelector('.brand-mark')!.getBoundingClientRect();
      const heading = node.querySelector('h1')!.getBoundingClientRect();
      return {markWidth: mark.width, markToHeading: heading.top - mark.bottom};
    });
    expect(welcomeGeometry).toEqual({markWidth: 44, markToHeading: 10});

    const logo = await page.evaluate(() => fetch('/polymux.svg').then((response) => response.text()));
    expect(logo).toContain('fill="#000"');
    expect(logo).toContain('M 40 40 L 120 40 A 60 60');
    expect(logo).not.toContain('<rect');

    // Intentional Polymux simplification: no recent chats, no suggestion cards.
    await expect(page.locator('.welcome-features')).toHaveCount(0);
    await expect(page.locator('.welcome-recents')).toHaveCount(0);
    await expect(page.locator('.recent-grid')).toHaveCount(0);

    // The composer's own centre is placed on the viewport centre.
    const offset = await page.locator('.welcome-chat-pane').evaluate((node) =>
      getComputedStyle(node).getPropertyValue('--welcome-offset').trim());
    expect(offset).not.toBe('');
  });

  test('exposes Attach, Voice, Goal and Options without plugins or teams', async ({page}) => {
    await page.goto('/');
    const toolbar = page.locator('.polymux-prompt-toolbar');
    await expect(toolbar.getByText('ATTACH')).toBeVisible();
    await expect(toolbar.getByText('VOICE')).toBeVisible();
    await expect(toolbar.getByText('GOAL')).toBeVisible();
    await expect(toolbar.getByText('MODEL')).toBeVisible();
    const modelButton = toolbar.getByRole('button', {name: 'MODEL'});
    await expect(modelButton.locator('[data-icon="brain"]')).toBeVisible();
    await expect(modelButton.locator('.provider-logo')).toHaveCount(0);
    await toolbar.getByText('MODEL').click();
    await expect(page.getByRole('menu', {name: 'Model options'}).locator('.model-menu-mark .provider-logo').first()).toBeVisible();
    await expect(toolbar.getByText('PLUGINS')).toHaveCount(0);
    await expect(toolbar.getByText('TEAMS')).toHaveCount(0);
  });

  test('opens Settings as an expanded workspace tab with connections, models and memory controls', async ({page}) => {
    await page.route('https://api.frankfurter.dev/v2/rates**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        {base: 'USD', quote: 'AUD', rate: 1.5},
        {base: 'USD', quote: 'EUR', rate: .9},
        {base: 'USD', quote: 'GBP', rate: .8},
        {base: 'USD', quote: 'SGD', rate: 1.35},
        {base: 'USD', quote: 'JPY', rate: 150},
      ]),
    }));
    await page.goto('/');
    await page.getByRole('button', {name: 'Settings'}).click();

    const modal = page.getByRole('region', {name: /^(Settings|Connections)$/});
    await expect(modal).toBeVisible();
    await expect(page.locator('main')).toHaveClass(/workspace-expanded/);
    await expect(page.locator('.workspace-drawer')).toHaveClass(/expanded/);
    await expect(page.locator('.workspace-drawer .tab.active')).toContainText('Settings');
    await expect(modal.getByRole('heading', {name: 'Appearance'})).toBeVisible();
    await expect(modal.getByText('Choose the theme, language and top bar.')).toBeVisible();
    const modalBounds = await modal.boundingBox();
    expect(modalBounds).not.toBeNull();
    expect(modalBounds!.x).toBeGreaterThan(0);
    await expect(modal).toHaveCSS('border-style', 'none');
    await expect(page.locator('.workspace-drawer .tab')).toHaveCount(1);
    await expect(page.locator('.workspace-drawer .tab.active')).toContainText('Settings');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(modal.getByRole('tab')).toHaveText(['Appearance', 'Notifications', 'Permissions', 'Models', 'Providers', 'Voice', 'Memory', 'Archived chats', 'About']);
    const tabMetrics = await modal.getByRole('tab').first().evaluate((node) => {
      const style = getComputedStyle(node);
      return {fontSize: style.fontSize, height: style.height, radius: style.borderRadius, icons: node.querySelectorAll('svg').length};
    });
    expect(tabMetrics).toEqual({fontSize: '13px', height: '32px', radius: '9px', icons: 1});
    // The theme is a setting on Appearance; the grants are their own tab.
    const theme = modal.getByRole('radiogroup', {name: 'Theme'});
    await expect(theme.getByRole('radio', {name: 'Light'})).toHaveAttribute('aria-checked', 'true');
    await theme.getByRole('radio', {name: 'Dark'}).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('.brand-mark')).toHaveCSS('filter', 'invert(1)');
    await expect(page.locator('.polymux-prompt-shell').first()).toHaveCSS('background-color', 'rgb(43, 43, 43)');

    await modal.getByRole('tab', {name: 'Permissions'}).click();
    await expect(modal.getByRole('heading', {name: 'Permissions'})).toBeVisible();
    const timeAccess = modal.getByRole('switch', {name: 'Enable time access'});
    const locationAccess = modal.getByRole('switch', {name: 'Enable location access'});
    // Each independent OS grant has its own status row.
    for (const name of ['Accessibility', 'Screen recording']) {
      await expect(modal.getByRole('switch', {name, exact: true})).toHaveCount(0);
      await expect(modal.locator('.general-setting-row').filter({has: page.getByRole('heading', {name, exact: true})})).toContainText('Granted');
    }
    await expect(modal.getByText(Intl.DateTimeFormat().resolvedOptions().timeZone, {exact: true})).toBeVisible();
    await expect(modal.getByText(/refreshed|updated/i)).toHaveCount(0);
    await expect(modal.getByRole('button', {name: 'Refresh location'})).toHaveCount(0);
    await expect(timeAccess).toHaveCSS('background-color', 'rgb(231, 231, 231)');
    await expect(timeAccess.locator('span')).toHaveCSS('background-color', 'rgb(36, 36, 36)');
    await expect(timeAccess).toHaveAttribute('aria-checked', 'true');
    await expect(locationAccess).toHaveAttribute('aria-checked', 'true');
    await locationAccess.click();
    await expect(locationAccess).toHaveAttribute('aria-checked', 'false');
    await locationAccess.click();
    await expect(locationAccess).toHaveAttribute('aria-checked', 'true');
    await locationAccess.click();
    await expect(locationAccess).toHaveAttribute('aria-checked', 'false');
    await timeAccess.click();
    await expect(timeAccess).toHaveAttribute('aria-checked', 'false');
    await timeAccess.click();
    await expect(timeAccess).toHaveAttribute('aria-checked', 'true');

    await modal.getByRole('tab', {name: 'Appearance'}).click();
    await theme.getByRole('radio', {name: 'Light'}).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.emulateMedia({colorScheme: 'dark'});
    await theme.getByRole('radio', {name: 'System'}).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.emulateMedia({colorScheme: 'light'});
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await chatDrawer(page).getByRole('button', {name: 'Connections'}).click();
    await expect(page.locator('.workspace-drawer .tab.active')).toContainText('Connections');
    // The landing is the marketplace directory; its MCP section links into
    // the rail-and-detail view the rest of this test covers.
    await modal.locator('.marketplace-section', {hasText: 'Recommended MCPs'}).getByRole('button', {name: 'See all'}).click();
    await modal.getByRole('button', {name: /Filesystem/}).click();
    const dividerSpacing = await modal.locator('.options-body').evaluate((body) => {
      const bounds = body.getBoundingClientRect();
      const firstColumn = Number.parseFloat(getComputedStyle(body).gridTemplateColumns);
      const dividerX = bounds.left + firstColumn;
      const railEdge = body.querySelector('.options-search')!.getBoundingClientRect().right;
      const detailEdge = body.querySelector('.options-detail-header')!.getBoundingClientRect().left;
      return {left: Math.round(dividerX - railEdge), right: Math.round(detailEdge - dividerX)};
    });
    expect(dividerSpacing).toEqual({left: 15, right: 15});
    await expect(modal.locator('.options-rail')).toHaveCSS('width', '220px');
    await expect(modal.getByRole('heading', {name: 'Filesystem'})).toBeVisible();
    await expect(modal.getByRole('heading', {name: 'Filesystem'})).toHaveCSS('font-size', '16px');
    await expect(modal.getByText('Access local files and directories.')).toBeVisible();
    await expect(modal.getByText('documents', {exact: true})).toBeVisible();
    await expect(modal.getByText('filesystem://documents', {exact: true})).toHaveCount(0);
    const officialMcp = modal.getByRole('button', {name: /GitHub Official/});
    await expect(officialMcp.locator('.official-rail-stamp')).toBeVisible();
    await expect(officialMcp.locator('.mcp-name-status')).toHaveCount(0);
    await expect(officialMcp.locator('small')).toHaveText('MCP server · Polymux · Connected');
    await officialMcp.click();
    await expect(modal.getByRole('heading', {name: 'GitHub'})).toBeVisible();
    await expect(modal.locator('.options-detail-header .options-badge')).toHaveCount(0);
    await expect(modal.locator('.skill-meta')).toContainText('Bundled with Polymux');
    await expect(modal.locator('.skill-meta')).toContainText('Connected');
    await expect(modal.getByText('Last error')).toHaveCount(0);
    await modal.getByRole('button', {name: /Filesystem/}).click();
    await expect(modal.getByRole('heading', {name: 'Filesystem'})).toBeVisible();
    await expect(modal.getByRole('button', {name: 'Add MCP server'})).toBeVisible();
    const mcpMarketplace = modal.getByRole('button', {name: 'Browse MCP Marketplace'});
    await expect(mcpMarketplace).toBeVisible();
    await mcpMarketplace.click();
    await expect(modal.getByRole('heading', {name: 'MCP Marketplace'})).toBeVisible();
    await expect(modal.getByRole('searchbox', {name: 'Search MCP Marketplace'})).toBeVisible();
    await modal.getByRole('button', {name: /Filesystem/}).click();
    await expect(modal.getByRole('heading', {name: 'Filesystem'})).toBeVisible();
    await mcpMarketplace.click();
    const marketplaceFiles = modal.locator('.skill-registry-results li').filter({hasText: 'Browse and manage files'});
    await marketplaceFiles.getByRole('button', {name: 'Install'}).click();
    await expect(marketplaceFiles.getByRole('button', {name: 'Uninstall'})).toBeVisible();
    await expect(modal.locator('.skill-registry-results li').filter({hasText: 'Issues'}).getByRole('button', {name: 'Configure'})).toBeVisible();
    await modal.getByRole('button', {name: 'Done'}).click();
    await expect(modal.getByRole('heading', {name: 'Filesystem'})).toBeVisible();
    await modal.getByRole('button', {name: /^Files MCP server · Custom/}).click();
    await expect(modal.getByRole('button', {name: 'Delete MCP server'})).toBeVisible();
    await modal.getByRole('button', {name: 'Delete MCP server'}).click();
    await expect(modal.getByRole('button', {name: /^Files MCP server · Custom/})).toHaveCount(0);
    await expect(modal.getByRole('heading', {name: 'Filesystem'})).toBeVisible();
    await expect(modal.getByRole('button', {name: 'Filter Connections'})).toBeVisible();
    await expect(modal.getByRole('button', {name: 'Sort Connections'})).toBeVisible();
    await modal.getByRole('button', {name: 'Filter Connections'}).click();
    const mcpFilterMenu = modal.getByRole('menu', {name: 'Filter Connections'});
    await expect(mcpFilterMenu.getByRole('menuitemradio')).toHaveText(['All', 'Enabled', 'Disabled', 'Skills', 'MCP', 'Plugins']);
    await mcpFilterMenu.getByRole('menuitemradio', {name: 'MCP'}).click();
    await expect(modal.getByRole('button', {name: /Filesystem/})).toBeVisible();
    await modal.getByRole('button', {name: 'Filter Connections'}).click();
    await modal.getByRole('menuitemradio', {name: 'All', exact: true}).click();
    await modal.getByRole('button', {name: 'Sort Connections'}).click();
    await expect(modal.getByRole('menu', {name: 'Sort Connections'}).getByRole('menuitemradio')).toHaveText(['A–Z', 'Z–A']);
    await modal.getByRole('menuitemradio', {name: 'A–Z'}).click();
    await expect(modal.getByRole('button', {name: 'Refresh MCP'})).toHaveCount(0);
    const mcpSearch = modal.getByRole('searchbox', {name: 'Search Connections'});
    await expect(mcpSearch).toHaveAttribute('placeholder', 'Search Connections');
    await mcpSearch.fill('does-not-exist');
    const emptyMcp = modal.getByText('No connections found');
    await expect(emptyMcp).toBeVisible();
    await expect(modal.locator('.options-rail-list')).toHaveClass(/empty-state/);
    const emptyMcpAlignment = await emptyMcp.evaluate((node) => ({
      justifyContent: getComputedStyle(node).justifyContent,
      textAlign: getComputedStyle(node).textAlign,
    }));
    expect(emptyMcpAlignment).toEqual({justifyContent: 'center', textAlign: 'center'});
    await mcpSearch.fill('');
    await modal.getByRole('button', {name: 'Add MCP server'}).click();
    await expect(modal.getByRole('menuitem', {name: 'Create Custom'})).toBeVisible();
    await expect(modal.getByRole('menuitem', {name: 'Auto Discovery'})).toBeVisible();
    await modal.getByRole('menuitem', {name: 'Create Custom'}).click();
    await expect(modal.getByRole('heading', {name: 'Add MCP server'})).toBeVisible();
    await modal.getByRole('button', {name: /Filesystem/}).click();

    await modal.getByRole('button', {name: /Documents/}).click();
    await expect(modal.getByRole('heading', {name: 'Documents'})).toBeVisible();
    await expect(modal.getByRole('heading', {name: 'Documents'})).toHaveCSS('font-size', '15px');
    await expect(modal.getByText('Create and edit document files.')).toBeVisible();
    const officialPdf = modal.getByRole('button', {name: /PDF Official/});
    await expect(officialPdf).toBeVisible();
    await expect(officialPdf.locator('[data-icon="verified"]')).toBeVisible();
    await expect(officialPdf.locator('small')).toHaveText('Skill · Polymux · Active');
    await expect(officialPdf.locator('.integration-state')).toHaveCount(0);
    const officialSealGap = await officialPdf.evaluate((row) => {
      const name = row.querySelector('.skill-name-line strong')!.getBoundingClientRect();
      const seal = row.querySelector('.official-rail-stamp')!.getBoundingClientRect();
      return Math.round(seal.left - name.right);
    });
    expect(officialSealGap).toBe(4);
    await expect(modal.getByRole('button', {name: 'Add Skills'})).toBeVisible();
    await modal.getByRole('button', {name: 'Add Skills'}).click();
    await expect(modal.getByRole('menuitem', {name: 'Create Custom'})).toBeVisible();
    await expect(modal.getByRole('menuitem', {name: 'Upload Skills'})).toBeVisible();
    // The Vercel directory is a marketplace, so it rides the storefront icon
    // beside the +, exactly as the MCP marketplace does.
    await expect(modal.getByRole('menuitem', {name: 'Install from Vercel Skills'})).toHaveCount(0);
    await expect(modal.getByRole('button', {name: 'Install from Vercel Skills'})).toBeVisible();
    await modal.getByRole('menuitem', {name: 'Create Custom'}).click();
    await expect(modal.getByRole('heading', {name: 'Add Skill'})).toBeVisible();
    await modal.getByRole('button', {name: 'Cancel'}).click();
    await modal.getByRole('button', {name: 'Install from Vercel Skills'}).click();
    await expect(modal.getByRole('heading', {name: 'Vercel Skills'})).toBeVisible();
    // Searching the directory lists registry entries with install counts.
    await modal.getByLabel('Search Vercel Skills').fill('find');
    const findRow = modal.locator('.skill-registry-results li').filter({hasText: 'find-skills'});
    await expect(findRow).toContainText('vercel-labs/skills');
    await expect(findRow).toContainText('120.3k installs');
    await findRow.getByRole('button', {name: 'Install'}).click();
    // The row flips to Uninstall, and the browser stays open for more changes.
    await expect(findRow.getByRole('button', {name: 'Uninstall'})).toBeVisible();
    await findRow.getByRole('button', {name: 'Uninstall'}).click();
    await expect(findRow.getByRole('button', {name: 'Install'})).toBeVisible();
    await findRow.getByRole('button', {name: 'Install'}).click();
    await expect(findRow.getByRole('button', {name: 'Uninstall'})).toBeVisible();
    await expect(modal.getByRole('heading', {name: 'Vercel Skills'})).toBeVisible();
    await expect(modal.getByLabel('Package')).toHaveCount(0);
    const directoryLayout = await modal.locator('.options-detail.directory-open').evaluate((detail) => ({
      overflowY: getComputedStyle(detail).overflowY,
      resultsOverflowY: getComputedStyle(detail.querySelector('.skill-registry-results')!).overflowY,
    }));
    expect(directoryLayout).toEqual({overflowY: 'hidden', resultsOverflowY: 'auto'});
    await modal.getByRole('button', {name: 'Done'}).click();
    await expect(modal.getByRole('heading', {name: 'Find Skills'})).toBeVisible();
    await expect(modal.getByRole('button', {name: /Find Skills.*Active/})).toBeVisible();
    await expect(modal.getByRole('button', {name: 'Filter Connections'})).toBeVisible();
    await expect(modal.getByRole('button', {name: 'Sort Connections'})).toBeVisible();
    await modal.getByRole('button', {name: 'Filter Connections'}).click();
    const skillFilterMenu = modal.getByRole('menu', {name: 'Filter Connections'});
    await expect(skillFilterMenu.getByRole('menuitemradio')).toHaveText(['All', 'Enabled', 'Disabled', 'Skills', 'MCP', 'Plugins']);
    await skillFilterMenu.getByRole('menuitemradio', {name: 'Skills'}).click();
    await expect(modal.getByRole('button', {name: /PDF Official/})).toBeVisible();
    await modal.getByRole('button', {name: 'Filter Connections'}).click();
    await modal.getByRole('menuitemradio', {name: 'All', exact: true}).click();
    await modal.getByRole('button', {name: 'Sort Connections'}).click();
    await expect(modal.getByRole('menu', {name: 'Sort Connections'}).getByRole('menuitemradio')).toHaveText(['A–Z', 'Z–A']);
    await modal.getByRole('menuitemradio', {name: 'A–Z'}).click();
    await expect(modal.getByRole('button', {name: 'Refresh Skills'})).toHaveCount(0);
    const browserSkill = modal.getByRole('button', {name: /Spreadsheets Official/});
    // Skill rows carry no logos or icon marks — the name and stamp are the row.
    await expect(browserSkill.locator('img, .option-mark')).toHaveCount(0);
    await browserSkill.click();
    await expect(modal.getByRole('heading', {name: 'Spreadsheets'})).toBeVisible();
    const officialBadge = modal.locator('.options-detail-header .official-badge');
    await expect(officialBadge).toHaveText('Official');
    await expect(officialBadge).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(officialBadge).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 1)');
    await expect(officialBadge.locator('[data-icon="verified"]')).toBeVisible();
    const officialMeta = modal.locator('.skill-meta');
    await expect(officialMeta.locator('dt')).toHaveText(['Author', 'Category', 'Last edited', 'Source']);
    await expect(officialMeta).toContainText('Polymux');
    await expect(officialMeta).toContainText('Documents');
    await expect(officialMeta).toContainText('Bundled with Polymux');
    const customSkill = modal.getByRole('button', {name: /Personal Research.*Active/});
    await expect(customSkill).toBeVisible();
    await customSkill.click();
    await expect(modal.locator('.options-detail-header .options-badge')).toHaveCount(0);
    await expect(modal.locator('.skill-detail > .options-detail-header > .options-title-group')).toHaveCSS('align-self', 'flex-start');
    await expect(modal.locator('.skill-detail > .options-detail-header')).toHaveCSS('height', '20px');
    const customMeta = modal.locator('.skill-meta');
    await expect(customMeta).toContainText('Custom');
    await expect(customMeta).toContainText('Polymux · ~/.polymux/skills');
    const skillPathBottomGap = await modal.locator('.skill-detail').evaluate((detail) => {
      const path = detail.querySelector('.options-path')!.getBoundingClientRect();
      const bounds = detail.getBoundingClientRect();
      return Math.round(bounds.bottom - path.bottom);
    });
    expect(skillPathBottomGap).toBe(20);

    await chatDrawer(page).getByRole('button', {name: 'Settings', exact: true}).click();
    await expect(page.locator('.workspace-drawer .tab.active')).toContainText('Settings');
    await openAgentSection(modal, 'Models');
    await expect(modal.getByRole('heading', {name: 'Models'})).toBeVisible();
    await expect(modal.getByText('Set the model and reasoning level for each role.')).toBeVisible();
    await expect(modal.getByLabel(/Selected model:/)).toHaveCount(0);
    // The tab opens on the roles, not the catalogue: the directory is how one
    // of them is filled, and it is reached from that role's own row.
    await expect(modal.locator('.role-options .general-setting-copy h4')).toHaveText(['Main', 'Subagent', 'Judge', 'Compaction', 'Speech', 'Image generation', 'Video generation']);
    await modal.getByRole('button', {name: /as the main model/}).click();
    // The directory asks for something different, and says so.
    await expect(modal.getByText('Click a model to assign it to a role.')).toBeVisible();
    // It opens filtered to the only kind of model the job can take, and the
    // rail's own filter carries that rather than narrowing behind its back.
    await modal.getByRole('button', {name: 'Filter models'}).click();
    await expect(modal.getByRole('menu', {name: 'Filter models'}).getByRole('menuitemradio', {name: 'Text models'})).toHaveAttribute('aria-checked', 'true');
    await modal.getByRole('menuitemradio', {name: 'All Companies'}).click();
    const companySearch = modal.getByRole('searchbox', {name: 'Search model'});
    await expect(companySearch).toHaveAttribute('placeholder', 'Search model');
    await companySearch.fill('Haiku');
    await expect(modal.locator('.options-rail-list .options-rail-copy strong')).toHaveText(['Anthropic']);
    await companySearch.fill('');
    await expect(modal.getByRole('button', {name: /OpenAI.*2 models/})).toBeVisible();
    await expect(modal.getByRole('button', {name: /Google.*1 model/})).toBeVisible();
    await expect(modal.getByRole('button', {name: /Anthropic.*2 models/})).toBeVisible();
    await expect(modal.locator('.options-rail-list')).not.toContainText('~');
    await expect(modal.locator('.options-rail-list')).not.toContainText('Active');
    const railSpacing = await modal.locator('.options-rail').evaluate((rail) => {
      const search = rail.querySelector('.options-search')!.getBoundingClientRect();
      const list = rail.querySelector('.options-rail-list')!.getBoundingClientRect();
      const firstRow = rail.querySelector('.options-rail-row')!.getBoundingClientRect();
      return {
        boundaryGap: Math.round(list.top - search.bottom),
        rowGap: Math.round(firstRow.top - search.bottom),
      };
    });
    expect(railSpacing).toEqual({boundaryGap: 6, rowGap: 14});
    await expect(modal.getByRole('button', {name: /OpenRouter.*model/})).toHaveCount(0);
    await expect(modal.getByRole('button', {name: 'Refresh Model'})).toHaveCount(0);
    await expect(modal.getByRole('button', {name: 'Filter models'})).toBeVisible();
    await expect(modal.getByRole('button', {name: 'Sort models'})).toBeVisible();
    await modal.getByRole('button', {name: 'Filter models'}).click();
    const modelFilterMenu = modal.getByRole('menu', {name: 'Filter models'});
    await expect(modelFilterMenu.getByRole('menuitemradio')).toHaveText(['Default', 'All Companies', 'Custom Provider', 'Text models', 'Image models', 'Video models', 'Speech models', 'Embedding models']);
    await modal.getByRole('menuitemradio', {name: 'Default', exact: true}).click();
    await expect(modal.locator('.options-rail-list .options-rail-copy strong')).toHaveText(['OpenAI']);
    await expect(modal.getByRole('heading', {name: 'OpenAI'})).toBeVisible();
    await expect(modal.locator('.model-table tbody tr')).toHaveCount(2);
    await expect(modal.locator('.model-table tbody')).toContainText('openai/');
    await expect(modal.locator('.model-table tbody')).not.toContainText('anthropic/');
    await modal.getByRole('button', {name: 'Filter models'}).click();
    await modal.getByRole('menuitemradio', {name: 'All Companies'}).click();
    await expect(modal.locator('.options-rail-list .options-rail-copy strong')).toHaveText(['OpenAI', 'Anthropic', 'Google']);
    await modal.getByRole('button', {name: /Anthropic.*2 models/}).click();
    await expect(modal.getByRole('heading', {name: 'Anthropic'})).toBeVisible();
    await expect(modal.locator('.model-table tbody tr')).toHaveCount(2);
    await expect(modal.locator('.model-table tbody')).toContainText('anthropic/');
    await expect(modal.locator('.model-table tbody')).not.toContainText('openai/');
    await modal.getByRole('button', {name: /Google.*1 model/}).click();
    await expect(modal.locator('.model-table tbody tr')).toHaveCount(1);
    await expect(modal.locator('.model-table tbody')).toContainText('openrouter/');
    await modal.getByRole('button', {name: 'Sort models'}).click();
    await expect(modal.getByRole('menuitemradio', {name: 'Recommended'})).toBeVisible();
    await expect(modal.getByRole('menuitemradio', {name: 'Popularity'})).toHaveCount(0);
    await modal.getByRole('menuitemradio', {name: 'Company A–Z'}).click();
    await expect(modal.locator('.options-rail-list .options-rail-copy strong')).toHaveText(['Anthropic', 'Google', 'OpenAI']);
    await modal.getByRole('button', {name: 'Sort models'}).click();
    await modal.getByRole('menuitemradio', {name: 'Company Z–A'}).click();
    await expect(modal.locator('.options-rail-list .options-rail-copy strong')).toHaveText(['OpenAI', 'Google', 'Anthropic']);
    await modal.getByRole('button', {name: 'Sort models'}).click();
    await modal.getByRole('menuitemradio', {name: 'Fewest models'}).click();
    await expect(modal.locator('.options-rail-list .options-rail-copy strong')).toHaveText(['Google', 'Anthropic', 'OpenAI']);
    await modal.getByRole('button', {name: 'Sort models'}).click();
    await modal.getByRole('menuitemradio', {name: 'Recommended'}).click();
    await expect(modal.locator('.options-rail-list .options-rail-copy strong')).toHaveText(['OpenAI', 'Anthropic', 'Google']);
    await modal.getByRole('button', {name: /Google.*1 model/}).click();
    await expect(modal.getByText('openrouter/google/gemini-3.1-pro-preview')).toBeVisible();
    await modal.getByRole('button', {name: /Anthropic.*2 models/}).click();
    const paneAlignment = await modal.evaluate((dialog) => {
      const search = dialog.querySelector('.options-rail .options-search')!.getBoundingClientRect();
      const detail = dialog.querySelector('.options-detail-header')!.getBoundingClientRect();
      return Math.round(detail.top - search.top);
    });
    expect(paneAlignment).toBe(0);
    const companyLogo = modal.locator('.provider-detail-header .provider-logo img');
    await expect(companyLogo).toBeVisible();
    await expect(companyLogo).toHaveAttribute('src', /Anthropic/i);
    const modelTableStyle = await modal.locator('.model-table-wrap').evaluate((wrapper) => {
      const count = document.querySelector('.model-count')!;
      // The headings are pinned above the scroller rather than inside it, so
      // only the rows move under them.
      const header = document.querySelector('.model-table-head th')!;
      const detailHeader = count.closest('.options-detail-header')!;
      return {
        wrapperBorder: getComputedStyle(wrapper).borderStyle,
        headerBackground: getComputedStyle(header).backgroundColor,
        countBackground: getComputedStyle(count).backgroundColor,
        countRightOffset: Math.round(detailHeader.getBoundingClientRect().right - count.getBoundingClientRect().right),
      };
    });
    expect(modelTableStyle).toEqual({wrapperBorder: 'none', headerBackground: 'rgba(0, 0, 0, 0)', countBackground: 'rgba(0, 0, 0, 0)', countRightOffset: 0});
    await expect(modal.getByText('Prices are per 1M tokens. Some rates may be unavailable or not applicable.')).toBeVisible();
    await expect(modal.getByRole('button', {name: 'Clear model search'})).toHaveCount(0);
    const currencyMenu = modal.getByRole('button', {name: 'Currency'});
    await expect(currencyMenu).toContainText('USD');
    const currencyPosition = await modal.locator('.pricing-toolbar').evaluate((toolbar) => {
      const note = toolbar.querySelector('.pricing-note')!.getBoundingClientRect();
      const picker = toolbar.querySelector('.select-menu-trigger')!.getBoundingClientRect();
      return {
        topOffset: Math.round(picker.top - note.top),
        rightGap: Math.round(toolbar.getBoundingClientRect().right - picker.right),
      };
    });
    // The trigger rides slightly above the note's first line rather than
    // sharing its top edge, so the two read as optically level.
    expect(currencyPosition).toEqual({topOffset: -5, rightGap: 0});
    await currencyMenu.click();
    await modal.getByRole('menuitemradio', {name: 'AUD'}).click();
    const sonnetRow = modal.getByRole('button', {name: /Set Claude Sonnet 4.5 as the/}).locator('xpath=ancestor::tr');
    await expect(sonnetRow.locator('td').nth(1)).toHaveText('A$4.50');
    await currencyMenu.click();
    await modal.getByRole('menuitemradio', {name: 'USD'}).click();
    await expect(modal.locator('.model-columns thead')).toContainText('InputOutputCache hitCache writeContext');
    const sonnet = modal.getByRole('button', {name: /Set Claude Sonnet 4.5 as the/});
    await expect(sonnet).toBeVisible();
    await expect(sonnet.locator('xpath=ancestor::tr')).toContainText('$3.00$15.00$0.300$3.75');
    // The row is the whole gesture — no level to pick first, no job to choose:
    // the directory was opened for one. An unconfigured provider fails on that
    // pick, and the directory stays open rather than reporting from elsewhere.
    await expect(modal.locator('.options-error')).toHaveCount(0);
    await sonnet.click();
    await expect(modal.locator('.options-error')).toContainText('Anthropic is not configured');
    await expect(modal.locator('.model-table')).toBeVisible();
    // The price cells belong to the same row, so they pick from it too.
    await sonnetRow.locator('td').nth(2).click();
    await expect(modal.locator('.options-error')).toContainText('Anthropic is not configured');
    // The way back sits with the rail's own controls, beside filter and sort.
    await modal.getByRole('button', {name: 'Back to roles', exact: true}).click();
    await expect(modal.locator('.model-table')).toHaveCount(0);

    // A role with no consumer yet still records the choice, and the roles view
    // reads it back the moment the directory closes.
    const judgeRow = modal.locator('.role-options .general-setting-row').nth(2);
    await judgeRow.getByRole('button', {name: /as the judge model/}).click();
    await modal.getByRole('button', {name: /OpenAI.*2 models/}).click();
    await modal.getByRole('button', {name: /Set GPT-5.6 Sol as the judge model/}).click();
    await expect(modal.locator('.model-table')).toHaveCount(0);
    await expect(judgeRow).toContainText('GPT-5.6 Sol');

    await modal.getByRole('button', {name: /as the main model/}).click();
    await modal.getByRole('button', {name: /Anthropic.*2 models/}).click();
    await modal.getByRole('button', {name: /Google.*1 model/}).click();
    await expect(modal.getByRole('heading', {name: 'Google'})).toBeVisible();

    await openAgentSection(modal, 'Providers');
    await expect(modal.locator('.options-rail-list .configured-check')).toHaveCount(1);
    await expect(modal.locator('.options-rail-list .provider-row').first()).toHaveClass(/has-check/);
    await expect(modal.locator('.options-rail-list')).not.toContainText('Configured');
    const configuredRowStyle = await modal.locator('.provider-row.has-check').first().evaluate((row) => {
      const copy = row.querySelector('.options-rail-copy')!;
      const tick = row.querySelector('.configured-check')!;
      return {mask: getComputedStyle(copy).maskImage, tickPosition: getComputedStyle(tick).position};
    });
    expect(configuredRowStyle.mask).toContain('linear-gradient');
    expect(configuredRowStyle.tickPosition).toBe('absolute');
    await expect(modal.getByRole('button', {name: 'Refresh Provider'})).toHaveCount(0);
    await expect(modal.getByRole('button', {name: 'Filter providers'})).toBeVisible();
    await expect(modal.getByRole('button', {name: 'Sort providers'})).toBeVisible();
    await modal.getByRole('button', {name: 'Filter providers'}).click();
    const providerFilterMenu = modal.getByRole('menu', {name: 'Filter providers'});
    await expect(providerFilterMenu.getByRole('menuitemradio')).toHaveText(['All providers', 'Configured', 'Not configured']);
    await expect(providerFilterMenu.getByRole('menuitemradio', {name: 'With models'})).toHaveCount(0);
    await providerFilterMenu.getByRole('menuitemradio', {name: 'Configured', exact: true}).click();
    await expect(modal.locator('.options-rail-list .options-rail-copy strong')).toHaveText(['OpenAI']);
    await expect(modal.getByRole('heading', {name: 'OpenAI'})).toBeVisible();
    await modal.getByRole('button', {name: 'Filter providers'}).click();
    await modal.getByRole('menuitemradio', {name: 'Not configured'}).click();
    // The local runtimes sit in the same list as the hosted providers, and
    // count as not configured until one is connected.
    await expect(modal.locator('.options-rail-list .options-rail-copy strong'))
      .toHaveText(['Anthropic', 'OpenRouter', 'Llama.cpp', 'LM Studio', 'Ollama', 'vLLM']);
    await expect(modal.getByRole('heading', {name: 'Anthropic'})).toBeVisible();
    await modal.getByRole('button', {name: 'Filter providers'}).click();
    await modal.getByRole('menuitemradio', {name: 'All providers'}).click();
    await modal.getByRole('button', {name: 'Sort providers'}).click();
    await expect(modal.getByRole('menuitemradio')).toHaveText(['Default', 'Recommended', 'Provider A–Z', 'Provider Z–A', 'Most models', 'Fewest models']);
    await expect(modal.getByRole('menuitemradio', {name: 'Default'})).toHaveAttribute('aria-checked', 'true');
    await expect(modal.getByRole('menuitemradio', {name: 'Popularity'})).toHaveCount(0);
    await expect(modal.getByRole('menuitemradio', {name: 'Most models'})).toBeVisible();
    await modal.getByRole('menuitemradio', {name: 'Recommended'}).click();
    await expect(modal.locator('.options-rail-list .options-rail-copy strong'))
      .toHaveText(['OpenAI', 'Anthropic', 'OpenRouter', 'Llama.cpp', 'LM Studio', 'Ollama', 'vLLM']);
    await modal.getByRole('button', {name: 'Sort providers'}).click();
    await modal.getByRole('menuitemradio', {name: 'Provider A–Z'}).click();
    await expect(modal.locator('.options-rail-list .options-rail-copy strong'))
      .toHaveText(['Anthropic', 'Llama.cpp', 'LM Studio', 'Ollama', 'OpenAI', 'OpenRouter', 'vLLM']);
    await modal.getByRole('button', {name: 'Sort providers'}).click();
    await modal.getByRole('menuitemradio', {name: 'Fewest models'}).click();
    await expect(modal.locator('.options-rail-list .options-rail-copy strong'))
      .toHaveText(['Llama.cpp', 'LM Studio', 'Ollama', 'vLLM', 'OpenRouter', 'Anthropic', 'OpenAI']);
    await modal.getByRole('button', {name: 'Sort providers'}).click();
    await modal.getByRole('menuitemradio', {name: 'Default'}).click();
    await expect(modal.locator('.options-rail-list .options-rail-copy strong'))
      .toHaveText(['OpenAI', 'Anthropic', 'OpenRouter', 'Llama.cpp', 'LM Studio', 'Ollama', 'vLLM']);
    await modal.getByRole('button', {name: /Anthropic.*2 models/}).click();
    const apiKey = modal.getByLabel('API key');
    await expect(apiKey).toHaveAttribute('placeholder', 'Enter API key');
    const credentialControlMetrics = await modal.locator('.credential-input-row').evaluate((row) => {
      const input = row.querySelector('input')!;
      const button = row.querySelector('button')!;
      return {
        inputHeight: Math.round(input.getBoundingClientRect().height),
        inputFontSize: getComputedStyle(input).fontSize,
        buttonHeight: Math.round(button.getBoundingClientRect().height),
        buttonFontSize: getComputedStyle(button).fontSize,
      };
    });
    expect(credentialControlMetrics).toEqual({inputHeight: 32, inputFontSize: '11.5px', buttonHeight: 32, buttonFontSize: '11.5px'});
    await apiKey.fill('sk-test-secret');
    await modal.getByRole('button', {name: 'Add key'}).click();
    await expect(modal.locator('.credential-key-row')).toHaveCount(1);
    await expect(apiKey).toHaveAttribute('placeholder', 'Enter API key');
    await expect(apiKey).toHaveValue('');
    await expect(modal).not.toContainText('sk-test-secret');
    await apiKey.fill('sk-second-secret');
    await modal.getByRole('button', {name: 'Add key'}).click();
    await expect(modal.locator('.credential-key-row')).toHaveCount(2);
    await expect(modal.locator('.credential-key-row small')).toHaveText(['Ready', 'Ready']);
    await expect(modal.locator('.credential-key-row .credential-key-state')).toHaveCount(0);
    await expect(modal.locator('.credential-keys')).not.toContainText('Standby');
    const removeKey = modal.getByRole('button', {name: /Remove sk-t/});
    await expect(removeKey).toHaveAttribute('data-tooltip-label', 'Remove');
    await removeKey.click();
    await expect(modal.locator('.credential-key-row')).toHaveCount(1);
    await expect(modal.locator('.credential-status')).toHaveCount(0);

    const addCustomProvider = modal.getByRole('button', {name: 'Add custom provider'});
    await expect(addCustomProvider).toBeVisible();
    await addCustomProvider.click();
    await expect(modal.getByRole('heading', {name: 'Add custom provider'})).toBeVisible();
    await modal.getByLabel('Custom provider image').setInputFiles({
      name: 'local-lab.png',
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
    });
    await expect(modal.locator('.custom-provider-logo-preview img')).toBeVisible();
    await modal.getByLabel('Custom provider name').fill('Local Lab');
    await modal.getByLabel('Custom provider base URL').fill('http://localhost:9000/v1');
    await modal.getByLabel('Custom provider API key').fill('local-secret');
    // Typing an address is enough — the endpoint is asked what it serves.
    await expect(modal.getByText('2 models found')).toBeVisible();
    await expect(modal.locator('.models-summary-list')).toHaveText('llama3.1:8b, qwen2.5-coder:14b');
    // The detected list is still editable by hand.
    await modal.getByRole('button', {name: 'Edit list'}).click();
    await modal.getByLabel('Custom provider models').fill('local-chat | Local Chat\nlocal-reasoner | Local Reasoner');
    await modal.getByRole('button', {name: 'Add provider'}).click();
    await expect(modal.getByRole('button', {name: /Local Lab.*2 models/})).toBeVisible();
    await expect(modal.getByRole('heading', {name: 'Local Lab'})).toBeVisible();
    await expect(modal.locator('.provider-detail-header .provider-logo img')).toBeVisible();

    await modal.getByRole('button', {name: 'Edit Local Lab'}).click();
    await expect(modal.getByRole('heading', {name: 'Edit custom provider'})).toBeVisible();
    await expect(modal.getByLabel('Custom provider base URL')).toHaveValue('http://localhost:9000/v1');
    await modal.getByLabel('Custom provider name').fill('Local Studio');
    await modal.getByRole('button', {name: 'Edit list'}).click();
    await modal.getByLabel('Custom provider models').fill('local-chat | Studio Chat');
    await modal.getByRole('button', {name: 'Save changes'}).click();
    await expect(modal.getByRole('button', {name: /Local Studio.*1 model/})).toBeVisible();
    await expect(modal.getByRole('heading', {name: 'Local Studio'})).toBeVisible();

    await openAgentSection(modal, 'Models');
    await modal.getByRole('button', {name: /as the main model/}).click();
    await modal.getByRole('button', {name: 'Filter models'}).click();
    await modal.getByRole('menuitemradio', {name: 'Custom Provider'}).click();
    await expect(modal.locator('.options-rail-list .options-rail-copy strong')).toHaveText(['Local Studio']);
    await expect(modal.getByRole('heading', {name: 'Local Studio'})).toBeVisible();
    await expect(modal.locator('.provider-detail-header .provider-logo img')).toBeVisible();
    await modal.getByRole('button', {name: /Set Studio Chat as the main model/}).click();
    await expect(modal.locator('.role-options .general-setting-row').first()).toContainText('Studio Chat');

    await modal.getByRole('tab', {name: 'Memory'}).click();
    await expect(modal.getByRole('switch', {name: 'Enable Memory'})).toBeVisible();
    const memoryToggle = modal.getByRole('switch', {name: 'Enable Memory'});
    await expect(memoryToggle).toHaveAttribute('aria-checked', 'true');
    const memoryMetrics = modal.getByLabel('Memory storage');
    await expect(memoryMetrics.getByText('2 memories', {exact: true})).toBeVisible();
    await expect(memoryMetrics.getByText('17.8 KB', {exact: true})).toBeVisible();
    await expect(memoryMetrics.getByText('Latest:', {exact: false})).toBeVisible();
    const computerHistoryMetrics = modal.getByLabel('Computer history storage');
    await expect(computerHistoryMetrics.getByText('0 captures', {exact: true})).toBeVisible();
    await expect(computerHistoryMetrics.getByText('0 B', {exact: true})).toBeVisible();
    await expect(computerHistoryMetrics.getByText('Latest:', {exact: false})).toBeVisible();
    await expect(computerHistoryMetrics.getByText('0 interactions', {exact: true})).toBeVisible();
    const computerHistoryToggle = modal.getByRole('switch', {name: 'Enable ComputerHistory'});
    await memoryToggle.click();
    await expect(memoryToggle).toHaveAttribute('aria-checked', 'false');
    await expect(computerHistoryToggle).toBeEnabled();
    const memoryLayout = await modal.locator('.memory-options').evaluate((node) => {
      return {
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
      };
    });
    expect(memoryLayout.scrollHeight).toBeLessThanOrEqual(memoryLayout.clientHeight);
    // The page title and the panel headings below it share one left edge.
    const sharedLeftEdge = await modal.evaluate((node) => {
      const pageTitle = node.querySelector('.options-header h2')!.getBoundingClientRect();
      const memoryTitle = node.querySelector('.memory-options h3')!.getBoundingClientRect();
      return Math.round(memoryTitle.left - pageTitle.left);
    });
    expect(sharedLeftEdge).toBe(0);
    await expect(computerHistoryToggle).toHaveAttribute('aria-checked', 'true');
    await expect(modal.getByRole('radiogroup', {name: 'ComputerHistory capture mode'})).toHaveCount(0);
    await computerHistoryToggle.click();
    await expect(computerHistoryToggle).toHaveAttribute('aria-checked', 'false');

    await page.getByRole('button', {name: 'Close Settings'}).click();
    await page.getByRole('button', {name: 'Close Connections'}).click();
    await expect(modal).toHaveCount(0);
  });

  test('has no profile switcher in Settings', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Settings'}).click();
    const settings = page.getByRole('region', {name: 'Settings'});
    await expect(settings.locator('.profile-switcher')).toHaveCount(0);
    await expect(settings.getByRole('menu', {name: 'Profiles'})).toHaveCount(0);
    await expect(settings.getByRole('button', {name: 'New profile'})).toHaveCount(0);
    await expect(settings.getByRole('tab', {name: 'Models', exact: true})).toBeVisible();
    await expect(settings.getByRole('tab', {name: 'Profile'})).toHaveCount(0);
  });

  test('presents Computer History as summarized activities with raw evidence on demand', async ({page}) => {
    // The demo captures precede now by 20 minutes; keep them on the selected day.
    await page.clock.setFixedTime(new Date(2026, 8, 8, 12));
    await page.goto('/?history=summary');
    await page.getByRole('button', {name: 'Settings'}).click();
    const settings = page.getByRole('region', {name: 'Settings'});
    await settings.getByRole('tab', {name: 'Memory'}).click();

    const activity = settings.locator('.history-activity');
    await expect(activity.getByRole('heading', {name: 'Computer History timeline redesign'})).toBeVisible();
    await expect(activity).toContainText('concise semantic summaries');
    await expect(activity.locator('.history-activity-apps').locator('img, span')).toHaveCount(3);
    await expect(settings.getByText('0×0')).toHaveCount(0);
    await expect(settings.getByText('Activity continued')).toHaveCount(0);

    await activity.getByRole('button', {name: '3 captures'}).click();
    await expect(activity.locator('.history-evidence-row')).toHaveCount(3);
    await expect(activity).toContainText('ChatGPT — Computer History comparison');
    await expect(activity.getByRole('button', {name: 'Hide details'})).toBeVisible();
  });

  // Per-bot ACP selection, options and authentication are covered in assistant-bot-settings.spec.ts.

  test('a local runtime sits with the other providers and needs only connecting', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Settings'}).click();
    const modal = page.getByRole('region', {name: 'Settings'});
    await openAgentSection(modal, 'Providers');

    // Found by name, in the same rail as the hosted providers.
    await modal.getByLabel('Search provider').fill('ollama');
    const ollama = modal.getByRole('button', {name: /Ollama/}).first();
    await expect(ollama).toBeVisible();
    await ollama.click();
    await expect(modal.getByRole('heading', {name: 'Ollama'})).toBeVisible();
    // No key to paste — an address and a Connect button.
    await expect(modal.getByText('Local runtime', {exact: true})).toBeVisible();
    await expect(modal.getByLabel('API key')).toHaveCount(0);
    await expect(modal.getByLabel('Base URL')).toHaveValue('http://localhost:11434/v1');
    await modal.getByRole('button', {name: 'Connect', exact: true}).click();
    await expect(modal.locator('.provider-detail-header .options-badge')).toHaveText('Configured');
    await expect(modal.getByRole('button', {name: /Ollama.*2 models/})).toBeVisible();

    await page.getByRole('button', {name: 'Close Settings'}).click();
    await expect(modal).toHaveCount(0);
  });

  test('auto discovery lists other agents\' skills grouped by where they were found', async ({page}) => {
    await page.goto('/');
    const modal = await openConnections(page);
    await modal.locator('.marketplace-section', {hasText: 'Recommended Skills'}).getByRole('button', {name: /^Documents/}).click();
    // The row opens a detail modal; the discovery tools live in the full
    // rail-and-detail view behind it.
    await modal.getByRole('button', {name: 'Open full view'}).click();
    await modal.getByRole('button', {name: 'Add Skills'}).click();
    await modal.getByRole('menuitem', {name: 'Auto Discovery'}).click();
    await expect(modal.getByRole('heading', {name: 'Auto Discovery'})).toBeVisible();

    // One group per agent the skills were found under, each headed by the
    // agent's name and the directory that was read. Several agents open folded
    // so the pane reads as a survey of who has skills.
    await expect(modal.locator('.discovery-group h4')).toHaveText(['Claude', 'Codex', 'Shared skills']);
    for (const header of await modal.locator('.discovery-group-header').all())
      await expect(header).toHaveAttribute('aria-expanded', 'false');
    await expect(modal.locator('.discovery-groups li:visible')).toHaveCount(0);
    const claude = modal.locator('.discovery-group').filter({hasText: 'Claude'});
    await expect(claude.locator('.discovery-group-header code')).toHaveText('~/.claude/skills');
    await claude.locator('.discovery-group-header').click();
    const commitWriter = claude.locator('li').filter({hasText: 'commit-writer'});
    await expect(commitWriter).toContainText('~/.claude/skills/commit-writer');

    // A skill Polymux already has reads as in use rather than offering to add
    // it a second time, and so does anything under the shared directory.
    await expect(claude.locator('li').filter({hasText: 'pdf'})).toContainText('In use');
    const shared = modal.locator('.discovery-group').filter({hasText: 'Shared skills'});
    await shared.locator('.discovery-group-header').click();
    await expect(shared.locator('li')).toContainText('In use');

    // The group list scrolls behind the same edge fade the rail carries, and
    // the agent's name leads its group rather than sitting at row weight.
    const groupsLayout = await modal.locator('.discovery-groups').evaluate((groups) => ({
      overflowY: getComputedStyle(groups).overflowY,
      masked: getComputedStyle(groups).maskImage.includes('gradient'),
      headingSize: getComputedStyle(groups.querySelector('.discovery-group h4')!).fontSize,
      rowSize: getComputedStyle(groups.querySelector('.skill-registry-copy strong')!).fontSize,
    }));
    expect(groupsLayout.overflowY).toBe('auto');
    expect(groupsLayout.masked).toBe(true);
    expect(Number.parseFloat(groupsLayout.headingSize)).toBeGreaterThan(Number.parseFloat(groupsLayout.rowSize));

    // Each group heading is its own control: it counts what was found and
    // folds the list away without disturbing the others.
    const claudeHeader = claude.locator('.discovery-group-header');
    await expect(claudeHeader).toContainText('2 skills');
    await expect(modal.locator('.discovery-group').filter({hasText: 'Codex'}).locator('.discovery-group-header')).toContainText('1 skill');
    // The chevron sits on the heading's own centre line, not the header box's,
    // and turns to the right when the group is folded away.
    const chevronAlignment = await claudeHeader.evaluate((header) => {
      const chevron = header.querySelector('.discovery-chevron')!.getBoundingClientRect();
      const heading = header.querySelector('h4')!.getBoundingClientRect();
      return {
        offset: Math.abs((chevron.top + chevron.height / 2) - (heading.top + heading.height / 2)),
        size: Math.round(chevron.height),
      };
    });
    expect(chevronAlignment.offset).toBeLessThanOrEqual(1);
    expect(chevronAlignment.size).toBeGreaterThanOrEqual(16);
    // Bigger box, same painted line: stroke scales with the icon's viewBox, so
    // the chevron has to be thinned to sit at the app's icon weight.
    const strokeWeights = await modal.evaluate((dialog) => {
      const weight = (svg: SVGSVGElement) =>
        Number(svg.getAttribute('stroke-width')) * (svg.width.baseVal.value / svg.viewBox.baseVal.width);
      return {
        chevron: weight(dialog.querySelector('.discovery-chevron svg')!),
        railTool: weight(dialog.querySelector('.rail-tool svg')!),
      };
    });
    expect(strokeWeights.chevron).toBeCloseTo(strokeWeights.railTool, 2);
    // Hovering the heading darkens the whole row — path, count and chevron —
    // the way the chat drawer's date headers do.
    const resting = await claudeHeader.evaluate((header) => [
      getComputedStyle(header.querySelector('code')!).color,
      getComputedStyle(header.querySelector('.discovery-count')!).color,
      getComputedStyle(header.querySelector('.discovery-chevron')!).color,
    ]);
    await claudeHeader.hover();
    await expect
      .poll(() => claudeHeader.evaluate((header) => [
        getComputedStyle(header.querySelector('code')!).color,
        getComputedStyle(header.querySelector('.discovery-count')!).color,
        getComputedStyle(header.querySelector('.discovery-chevron')!).color,
      ]))
      .toEqual(resting.map(() => 'rgb(26, 26, 26)'));
    await modal.getByRole('heading', {name: 'Auto Discovery'}).hover();

    await expect(claudeHeader).toHaveAttribute('aria-expanded', 'true');
    await expect(claudeHeader.locator('.discovery-chevron')).toHaveCSS('transform', 'none');
    await claudeHeader.click();
    await expect(claudeHeader).toHaveAttribute('aria-expanded', 'false');
    // matrix(0, -1, 1, 0, …) is a quarter turn anticlockwise: down becomes right.
    await expect(claudeHeader.locator('.discovery-chevron')).toHaveCSS('transform', 'matrix(0, -1, 1, 0, 0, 0)');
    await expect(commitWriter).toBeHidden();
    const codex = modal.locator('.discovery-group').filter({hasText: 'Codex'});
    await codex.locator('.discovery-group-header').click();
    await expect(codex.locator('li')).toBeVisible();
    await claudeHeader.click();
    await expect(commitWriter).toBeVisible();

    await commitWriter.getByRole('button', {name: 'Add'}).click();
    // Adding keeps the scan open and flips the row it came from.
    await expect(commitWriter).toContainText('In use');
    await expect(modal.getByRole('heading', {name: 'Auto Discovery'})).toBeVisible();
    await modal.getByRole('button', {name: 'Done'}).click();
    await expect(modal.getByRole('button', {name: /Commit Writer/})).toBeVisible();
  });

  test('a scan that finds one agent opens it, since there is nothing to survey', async ({page}) => {
    await page.goto('/?one-agent');
    const modal = await openConnections(page);
    await modal.locator('.marketplace-section', {hasText: 'Recommended Skills'}).getByRole('button', {name: /^Documents/}).click();
    await modal.getByRole('button', {name: 'Open full view'}).click();
    await modal.getByRole('button', {name: 'Add Skills'}).click();
    await modal.getByRole('menuitem', {name: 'Auto Discovery'}).click();
    await expect(modal.locator('.discovery-group h4')).toHaveText(['Codex']);
    await expect(modal.locator('.discovery-group-header')).toHaveAttribute('aria-expanded', 'true');
    await expect(modal.locator('.discovery-groups li').filter({hasText: 'repo-map'})).toBeVisible();
  });

  test('toggles integrations and edits Polymux-owned skills and MCP servers', async ({page}) => {
    await page.goto('/');
    const modal = await openConnections(page);
    await modal.locator('.marketplace-section', {hasText: 'Recommended MCPs'}).getByRole('button', {name: /^Filesystem/}).click();
    await modal.getByRole('button', {name: 'Open full view'}).click();
    const mcpToggle = modal.getByRole('switch', {name: 'Enable MCP server'});
    await expect(mcpToggle).toHaveAttribute('aria-checked', 'true');
    await mcpToggle.click();
    await expect(mcpToggle).toHaveAttribute('aria-checked', 'false');
    await modal.getByRole('button', {name: 'Edit MCP server'}).click();
    await expect(modal.getByRole('heading', {name: 'Edit MCP server'})).toBeVisible();
    await modal.getByLabel('Name', {exact: true}).fill('Local Files');
    await modal.getByRole('button', {name: 'Save', exact: true}).click();
    await expect(modal.getByRole('heading', {name: 'Local Files'})).toBeVisible();

    await modal.getByRole('button', {name: /Documents/}).click();
    const skillToggle = modal.getByRole('switch', {name: 'Enable skill'});
    await expect(skillToggle).toHaveAttribute('aria-checked', 'true');
    await skillToggle.click();
    await expect(skillToggle).toHaveAttribute('aria-checked', 'false');
    const inactiveSkillRow = modal.getByRole('button', {name: /Documents.*Inactive/});
    await expect(inactiveSkillRow).toBeVisible();
    await expect(inactiveSkillRow).toHaveClass(/integration-disabled/);
    await modal.getByRole('button', {name: 'Edit skill'}).click();
    await expect(modal.getByRole('heading', {name: 'Edit Skill'})).toBeVisible();
    const skillFormWidth = await modal.locator('.skill-form').evaluate((form) => ({
      form: Math.round(form.getBoundingClientRect().width),
      detail: Math.round(form.parentElement!.getBoundingClientRect().width - 33),
    }));
    expect(skillFormWidth.form).toBe(skillFormWidth.detail);
    await modal.getByLabel('Description').fill('Create polished document files.');
    await modal.getByRole('button', {name: 'Save', exact: true}).click();
    await expect(modal.getByText('Create polished document files.')).toBeVisible();
    await expect(modal.getByRole('button', {name: 'Delete skill'})).toBeVisible();
    await modal.getByRole('button', {name: 'Delete skill'}).click();
    await expect(modal.getByRole('button', {name: /Documents.*Active/})).toHaveCount(0);
    await modal.getByRole('button', {name: /PDF Official/}).click();
    await expect(modal.getByRole('button', {name: 'Delete skill'})).toHaveCount(0);
  });

  test('falls back to a network location when the platform service fails', async ({page}) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: {
          getCurrentPosition: (_success: PositionCallback, failure: PositionErrorCallback) =>
            failure({code: 3, message: 'Timed out', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3} as GeolocationPositionError),
        },
      });
    });
    await page.goto('/');
    await page.getByRole('button', {name: 'Settings'}).click();
    const modal = page.getByRole('region', {name: 'Settings'});
    // Settings now regroups its rows into sections; Location sits under
    // Permissions rather than on the first page.
    await modal.getByRole('tab', {name: 'Permissions'}).click();
    const locationRow = modal.locator('.general-setting-row').filter({hasText: 'Location'});
    const retry = locationRow.getByRole('button', {name: 'Try again'});
    await expect(retry).toBeVisible();
    await retry.click();
    // The broken platform provider no longer strands the row: the network
    // fallback resolves, and the retry affordance stands down.
    await expect(locationRow).toContainText('Shared with the agent');
    await expect(retry).toHaveCount(0);
  });

  test('the provider panel explains that extra keys rotate automatically', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Settings'}).click();
    const modal = page.getByRole('region', {name: 'Settings'});
    await openAgentSection(modal, 'Providers');
    await expect(modal.getByRole('switch', {name: 'Enable auto API key rotation'})).toHaveCount(0);
    await expect(modal.getByText('rotates through them automatically')).toBeVisible();
  });

  test('the primary button offers speech until there is something to send', async ({page}) => {
    await page.goto('/');
    const speech = page.getByRole('button', {name: 'Start speech mode'});
    await expect(speech).toBeVisible();
    await speech.hover();
    await expect(speech).toHaveAttribute('data-tooltip', 'none');
    await expect(page.locator('.shared-tooltip')).toHaveCount(0);
    await editor(page).click();
    await page.keyboard.type('hello');
    await expect(page.getByRole('button', {name: 'Send message'})).toBeVisible();
  });

  test('speech mode can be disabled and replaced by the Send button without a tooltip', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Settings'}).click();
    const modal = page.getByRole('region', {name: 'Settings'});
    // Speech mode now lives in its own Voice section of the settings rail.
    await modal.getByRole('tab', {name: 'Voice'}).click();
    const speechMode = modal.getByRole('switch', {name: 'Enable speech mode'});
    await expect(speechMode).toHaveAttribute('aria-checked', 'true');
    await speechMode.click();
    await expect(speechMode).toHaveAttribute('aria-checked', 'false');
    await page.getByRole('button', {name: 'Close Settings'}).click();

    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    const send = page.getByRole('button', {name: 'Send message'});
    await expect(send).toBeVisible();
    await expect(page.getByRole('button', {name: 'Start speech mode'})).toHaveCount(0);
    await expect(send).toHaveAttribute('data-tooltip', 'none');
    await send.hover();
    await expect(page.locator('.shared-tooltip')).toHaveCount(0);
  });

  test('the installed section names each connection and opens the full installed list', async ({page}) => {
    await page.goto('/');
    const connections = await openConnections(page);
    const installed = connections.locator('.marketplace-section', {has: page.getByRole('heading', {name: /^Installed/})});
    await expect(installed).toBeVisible();
    // Installed rows are labelled: every one carries its name and its type,
    // never a bare symbol.
    const rows = installed.locator('.marketplace-row');
    await expect(rows.first()).toBeVisible();
    const shown = await rows.count();
    expect(shown).toBeGreaterThan(0);
    for (let index = 0; index < shown; index += 1) {
      const rowText = await rows.nth(index).innerText();
      expect(rowText).toMatch(/Skill ·|MCP server ·|Plugin ·/);
    }

    // Narrow content drops the installed grid to one column.
    await page.setViewportSize({width: 620, height: 700});
    const columns = await installed.locator('.marketplace-grid').evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length);
    expect(columns).toBe(1);

    // The heading counts everything installed, and "Manage installed" opens
    // the rail that lists all of them.
    const total = Number(await installed.locator('h3 .marketplace-count').innerText());
    expect(total).toBeGreaterThanOrEqual(shown);
    const manage = connections.getByRole('button', {name: 'Manage installed'});
    await expect(manage).toBeVisible();
    await manage.click();
    await expect(connections.getByRole('heading', {name: 'Installed', exact: true, level: 2})).toBeVisible();
    const installedRows = connections.locator('.options-rail-row');
    await expect(installedRows.first()).toBeVisible();
    await expect(installedRows).toHaveCount(total);
    // A mixed rail names each row's kind.
    expect(await installedRows.first().innerText()).toMatch(/Skill ·|MCP server ·|Plugin ·/);

    const back = connections.getByRole('button', {name: 'Back to Connections', exact: true});
    await expect(back.locator('svg[data-icon="back"]')).toBeVisible();
    await back.click();
    await expect(connections.getByRole('heading', {name: 'Connections', exact: true, level: 2})).toBeVisible();
  });

  test('See all names each category and returns to Connections', async ({page}) => {
    await page.goto('/');
    const connections = await openConnections(page);
    for (const category of ['Plugins', 'Skills', 'MCPs']) {
      await connections.locator('.marketplace-section').filter({has: page.getByRole('heading', {name: `Recommended ${category}`, exact: true})}).getByRole('button', {name: 'See all', exact: true}).click();
      await expect(connections.getByRole('heading', {name: category, exact: true, level: 2})).toBeVisible();
      const back = connections.getByRole('button', {name: 'Back to Connections', exact: true});
      await expect(back.locator('svg[data-icon="back"]')).toBeVisible();
      await back.click();
      await expect(connections.getByRole('heading', {name: 'Connections', exact: true, level: 2})).toBeVisible();
      await expect(back).toHaveCount(0);
    }
  });

  test('discovers and installs marketplace plugins and MCPs from Connections', async ({page}) => {
    await page.goto('/');
    const connections = await openConnections(page);
    const plugins = connections.getByRole('region', {name: 'Recommended Plugins', exact: true});
    const mcps = connections.getByRole('region', {name: 'Recommended MCPs', exact: true});
    const pluginRow = plugins.locator('.marketplace-row').filter({has: page.getByText('commit-commands', {exact: true})});
    const filesRow = mcps.locator('.marketplace-row').filter({has: page.getByText('Files', {exact: true})});
    const issuesRow = mcps.locator('.marketplace-row').filter({has: page.getByText('Issues', {exact: true})});
    // Catalog entries state their action as a word, not a bare plus.
    await expect(pluginRow.getByRole('button', {name: 'Install', exact: true})).toBeVisible();
    await expect(filesRow.getByRole('button', {name: 'Install', exact: true})).toBeVisible();
    await expect(connections.locator('.marketplace-section h3').filter({hasText: /^Recommended/})).toHaveText([
      'Recommended Bots', 'Recommended Plugins', 'Recommended Skills', 'Recommended MCPs',
    ]);
    await pluginRow.getByRole('button', {name: 'Install', exact: true}).click();
    await expect(pluginRow.locator('.marketplace-status.active')).toHaveText('Enabled');
    await filesRow.getByRole('button', {name: 'Install', exact: true}).click();
    await expect(filesRow.locator('.marketplace-status.active')).toHaveText('Enabled');
    await issuesRow.getByRole('button', {name: 'Configure', exact: true}).click();
    await expect(connections.locator('textarea')).toHaveValue('Authorization=');
  });

  test('the connections landing is a marketplace directory with detail modals', async ({page}) => {
    await page.goto('/');
    const connections = await openConnections(page);
    // Directory A: title, a search field that spans the directory width, and
    // category cards with counts, in the order the sections below use.
    await expect(connections.getByRole('heading', {name: 'Connections', exact: true})).toBeVisible();
    await expect(connections.getByRole('searchbox', {name: 'Search skills, MCPs and plugins'})).toBeVisible();
    const chips = connections.getByRole('group', {name: 'Connections categories'});
    for (const name of ['All', 'Bots', 'Plugins', 'Skills', 'MCPs'])
      await expect(chips.getByRole('button', {name: new RegExp(`^${name}`)})).toBeVisible();
    // The field and the leftmost card share one left edge, and the field
    // reaches the far edge of the cards' row rather than stopping short.
    const directoryHeader = await connections.locator('.marketplace-scroll').evaluate((scroll) => {
      const search = scroll.querySelector('.marketplace-search')!.getBoundingClientRect();
      const cards = scroll.querySelector('.marketplace-chips')!.getBoundingClientRect();
      const first = scroll.querySelector('.marketplace-chip')!.getBoundingClientRect();
      return {searchLeft: search.left, searchRight: search.right, cardsLeft: cards.left, cardsRight: cards.right, firstLeft: first.left};
    });
    expect(directoryHeader.firstLeft).toBeCloseTo(directoryHeader.searchLeft, 0);
    // The chips row bleeds 4px on each side for its scroll fade, so the field
    // reaches the cards' row rather than stopping short of it.
    expect(directoryHeader.searchRight).toBeGreaterThan(directoryHeader.cardsRight - 6);
    expect(directoryHeader.searchRight).toBeGreaterThan(directoryHeader.searchLeft + 200);
    // Recommended sections list rows; the Bots card has no catalog yet.
    await expect(connections.locator('.marketplace-section', {hasText: 'Recommended Skills'})).toBeVisible();
    await expect(connections.locator('.marketplace-section', {hasText: 'Recommended Bots'})).toContainText('Bots bundle skills, MCP servers and plugins into an assistant.');
    // Team bots are not listed here: the Bots card is placeholder-only.
    await expect(chips.getByRole('button', {name: /^Bots/})).toContainText('0');
    await chips.getByRole('button', {name: /^Bots/}).click();
    await expect(connections.locator('.marketplace-section')).toHaveCount(1);
    const directorySearch = connections.getByRole('searchbox', {name: 'Search skills, MCPs and plugins'});
    await directorySearch.fill('filesystem');
    await expect(connections.getByText('No bots match your search.')).toBeVisible();
    await directorySearch.fill('');
    await chips.getByRole('button', {name: /^All/}).click();
    // A category card narrows the page to that kind.
    await chips.getByRole('button', {name: /^MCPs/}).click();
    await expect(connections.locator('.marketplace-section', {hasText: 'Recommended Skills'})).toHaveCount(0);
    await chips.getByRole('button', {name: /^All/}).click();
    await expect(connections.locator('.marketplace-section', {hasText: 'Recommended Skills'})).toBeVisible();
    // A row opens a centred detail modal with the same enable switch as the
    // full view, and the modal links into that rail-and-detail view.
    await connections.locator('.marketplace-section', {hasText: 'Recommended Skills'}).getByRole('button', {name: /^Documents/}).first().click();
    const dialog = connections.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Create and edit document files.');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await connections.locator('.marketplace-section', {hasText: 'Recommended Skills'}).getByRole('button', {name: /^Documents/}).first().click();
    const skillToggle = dialog.getByRole('switch', {name: 'Enable skill'});
    await expect(skillToggle).toHaveAttribute('aria-checked', 'true');
    await skillToggle.click();
    await expect(skillToggle).toHaveAttribute('aria-checked', 'false');
    await skillToggle.click();
    await expect(skillToggle).toHaveAttribute('aria-checked', 'true');
    await dialog.getByRole('button', {name: 'Open full view'}).click();
    await expect(dialog).toHaveCount(0);
    await expect(connections.getByRole('heading', {name: 'Documents'})).toBeVisible();
  });

  test('keeps the grouped Settings rail scrollable', async ({page}) => {
    await page.setViewportSize({width: 920, height: 672});
    await page.goto('/');
    await page.getByRole('button', {name: 'Settings'}).click();
    const settings = page.getByRole('region', {name: 'Settings'});
    const rail = settings.locator('.options-nav-list');
    const metrics = await rail.evaluate((node) => ({
      overflowY: getComputedStyle(node).overflowY,
      scrollbarWidth: getComputedStyle(node).scrollbarWidth,
    }));
    expect(metrics.overflowY).toBe('auto');
    expect(metrics.scrollbarWidth).toBe('none');
    await expect(settings.locator('.profile-switcher')).toHaveCount(0);
  });
});

test.describe('top bar settings', () => {
  test('expands as one section and applies checkbox changes immediately', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Settings'}).click();
    const settings = page.getByRole('region', {name: 'Settings'});
    await settings.getByRole('tab', {name: 'Appearance'}).click();

    const row = settings.getByRole('button', {name: /Top bar.*Configure/});
    const chevron = row.locator('.pinned-views-chevron');
    await expect(row).toHaveAttribute('aria-expanded', 'false');
    await row.click();
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    await expect(chevron).toHaveCSS('transform', 'matrix(-1, 0, 0, -1, 0, 0)');
    await expect(row).toHaveCSS('border-bottom-color', 'rgba(0, 0, 0, 0)');

    const drive = settings.getByRole('checkbox', {name: 'Drive', exact: true});
    await expect(drive).toHaveAttribute('aria-checked', 'false');
    await drive.click();
    await expect(drive).toHaveAttribute('aria-checked', 'true');
    await expect(settings.locator('[data-pinned-view="drive"]')).toHaveCount(1);
    await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
    await expect(drive.locator('.pinned-view-check')).toHaveCSS('background-color', 'rgb(239, 239, 239)');
    await expect(drive.locator('.pinned-view-check')).toHaveCSS('color', 'rgb(17, 17, 17)');
    await drive.click();
    await expect(drive).toHaveAttribute('aria-checked', 'false');
    await expect(settings.locator('[data-pinned-view="drive"]')).toHaveCount(0);
  });

  test('clears the grabbed colour after an icon is reordered and released', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Settings'}).click();
    const settings = page.getByRole('region', {name: 'Settings'});
    await settings.getByRole('tab', {name: 'Appearance'}).click();
    await settings.getByRole('button', {name: /Top bar.*Configure/}).click();

    for (const name of ['Drive', 'Calendar', 'Tasks']) {
      const option = settings.getByRole('checkbox', {name, exact: true});
      await option.click();
      await expect(option).toHaveAttribute('aria-checked', 'true');
      await expect(option).toBeEnabled();
    }

    await page.waitForTimeout(180);
    const icons = settings.locator('.top-bar-mock-button');
    const drive = settings.locator('[data-pinned-view="drive"]');
    const source = await drive.boundingBox();
    const destination = await icons.last().boundingBox();
    expect(source).not.toBeNull();
    expect(destination).not.toBeNull();

    await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
    await page.mouse.down();
    await expect(drive).toHaveClass(/dragging/);
    await page.mouse.move(destination!.x + destination!.width + 4, destination!.y + destination!.height / 2, {steps: 8});
    await page.mouse.up();

    await expect(settings.locator('.top-bar-mock-button.dragging')).toHaveCount(0);
    await expect(drive).toHaveCSS('opacity', '1');
    await expect(settings.locator('.top-bar-mock-button[data-pinned-view]').first()).not.toHaveAttribute('data-pinned-view', 'drive');
  });
});

test.describe('design system', () => {
  test('every icon name the sheet declares is one it can actually draw', () => {
    // A name in the union with no branch in the `{#if}` chain type-checks
    // perfectly and renders an empty <svg> — the icon is simply absent, which
    // is how three of the browser tab's rail marks shipped blank. Nothing but
    // reading the file catches it.
    const sheet = readFileSync(
      new URL('../lib/shared/components/Icon.svelte', import.meta.url),
      'utf8',
    );
    const union = sheet.slice(sheet.indexOf('export let name:'), sheet.indexOf('export let size'));
    const declared = [...union.matchAll(/'([a-z0-9-]+)'/gi)].map((match) => match[1]!);
    const drawn = new Set(
      [...sheet.matchAll(/name === '([a-z0-9-]+)'/gi)].map((match) => match[1]!),
    );
    expect(declared.length).toBeGreaterThan(50);

    const undrawn = declared.filter((name) => !drawn.has(name));
    expect(undrawn, `declared but never drawn: ${undrawn.join(', ')}`).toEqual([]);

    // And the reverse: a branch for a name the union dropped is dead code.
    const undeclared = [...drawn].filter((name) => !declared.includes(name));
    expect(undeclared, `drawn but not declared: ${undeclared.join(', ')}`).toEqual([]);

    // Each name is drawn once; a second branch for it is unreachable.
    const duplicated = [...new Set(declared.filter((n, i) => declared.indexOf(n) !== i))];
    expect(duplicated, `declared twice: ${duplicated.join(', ')}`).toEqual([]);
  });

  test('publishes the shared motion and colour tokens', async ({page}) => {
    await page.goto('/');
    const tokens = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return {
        motion: style.getPropertyValue('--drawer-motion-duration').trim(),
        fade: style.getPropertyValue('--drawer-fade-duration').trim(),
        ease: style.getPropertyValue('--drawer-motion-ease').trim(),
        neutral200: style.getPropertyValue('--neutral-200').trim(),
        topbar: style.getPropertyValue('--app-topbar-height').trim(),
      };
    });
    expect(tokens).toEqual({
      motion: '440ms',
      fade: '260ms',
      ease: 'cubic-bezier(.45,0,.55,1)',
      neutral200: '#ececec',
      topbar: '50px',
    });
  });

  test('every chrome icon draws at one size and weight', async ({page}) => {
    await page.goto('/');
    await expect(page.getByRole('button', {name: 'Toggle Chats'})).toBeVisible();
    const icons = await page.locator('.left-controls svg, .top-controls button:not([aria-label="Settings"]) svg').evaluateAll((nodes) =>
      nodes.map((node) => ({
        box: node.getAttribute('viewBox'),
        width: node.getAttribute('width'),
        stroke: node.getAttribute('stroke-width'),
      })));
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) {
      expect(icon.box).toBe('0 0 24 24');
      expect(icon.width).toBe('16');
      expect(icon.stroke).toBe('1.5');
    }
    // The gear is the one optical correction: its teeth fill the box edge to
    // edge, so it draws a notch smaller. Strokes are authored in the 24-unit
    // box and thin with the icon, so its own stroke scales back up to render at
    // the same line weight as the rest of the set.
    const gear = chatDrawer(page).getByRole('button', {name: 'Settings', exact: true}).locator('svg');
    await expect(gear).toHaveAttribute('viewBox', '0 0 24 24');
    await expect(gear).toHaveAttribute('width', '13');
    const lineWeight = (icon: {width: string | null; stroke: string | null}) =>
      Number(icon.stroke) * Number(icon.width) / 24;
    const gearWeight = await gear.evaluate((node) =>
      Number(node.getAttribute('stroke-width')) * Number(node.getAttribute('width')) / 24);
    expect(gearWeight).toBeCloseTo(lineWeight(icons[0]), 2);
  });

  test('every chrome control names itself through the shared tooltip', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Toggle Chats'}).hover();
    await expect(page.locator('.shared-tooltip')).toHaveText('Chats');
    await page.getByLabel('Chat controls', {exact: true}).getByRole('button', {name: 'New Chat'}).hover();
    await expect(page.locator('.shared-tooltip')).toHaveText('New Chat');
    await page.getByRole('button', {name: 'Toggle Workspace'}).hover();
    await expect(page.locator('.shared-tooltip')).toHaveText('Workspace');
  });

  test('the new-tab control creates a selected launcher tab without opening a menu', async ({page}) => {
    await page.goto('/');
    await send(page, 'new tab launcher');
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    const newTab = page.getByLabel('New tab', {exact: true});

    await newTab.hover();
    await expect(page.locator('.shared-tooltip')).toHaveText('New tab');
    await newTab.click();
    await expect(workspaceDrawer(page).locator('.tab.active')).toContainText('New tab');
    await expect(workspaceDrawer(page).locator('.workspace-launcher')).toBeVisible();
    await expect(page.getByRole('menu')).toHaveCount(0);
  });

  test('model rows reveal a rich tooltip only after a deliberate pause', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Settings'}).click();
    const modal = page.getByRole('region', {name: 'Settings'});
    await openAgentSection(modal, 'Models');
    await modal.getByRole('button', {name: /as the main model/}).click();
    await modal.getByRole('button', {name: 'Filter models'}).click();
    await modal.getByRole('menuitemradio', {name: 'All Companies'}).click();
    await modal.getByRole('button', {name: /Anthropic.*2 models/}).click();
    const sonnet = modal.getByRole('button', {name: /Set Claude Sonnet 4.5 as the/});

    // No tooltip is raised while the startup cover is up — it is click-through,
    // so the pointer reaches the app behind it, and a pill then would float
    // over the brand alone. The pause being measured here is the tooltip's own,
    // so wait for the cover to go before starting it.
    await expect(page.locator('#startup-splash')).toHaveCount(0, {timeout: 10_000});
    await sonnet.hover();
    await expect(page.locator('.shared-tooltip')).toHaveCount(0);
    await expect(page.locator('.shared-tooltip.wide')).toHaveCount(0);

    const tooltip = page.getByRole('tooltip', {name: /anthropic.*claude-sonnet/});
    await expect(tooltip).toBeVisible({timeout: 3500});
    await expect(tooltip).toContainText('Balanced model for coding agents and careful analysis.');
    await expect(tooltip).toContainText('Knowledge cutoff: 2025-08-31');
    await expect(tooltip).toContainText('Supports: tools, structured output, attachments');
    await expect(tooltip).toHaveCSS('white-space', 'pre-line');
  });

  test('a role takes a model from the directory and its level from a menu', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Settings'}).click();
    const modal = page.getByRole('region', {name: 'Settings'});
    await openAgentSection(modal, 'Models');
    const roles = modal.locator('.role-options .general-setting-row');
    const taskRow = roles.nth(1);

    // The columns are named once and each control sits under its own title.
    await expect(modal.locator('.role-columns')).toHaveText('Role ReasoningModel');
    const columnCentres = await modal.locator('.role-options').evaluate((view) => {
      const centre = (node: Element) => {
        const box = node.getBoundingClientRect();
        return Math.round(box.left + box.width / 2);
      };
      const left = (node: Element) => Math.round(node.getBoundingClientRect().left);
      const titles = view.querySelectorAll('.role-columns .role-controls > span');
      const controls = view.querySelector('.general-setting-row .role-controls')!;
      const trigger = controls.querySelector('.select-menu-trigger')!;
      const model = controls.querySelector('.role-model')!;
      return {
        effort: centre(titles[0]) - centre(trigger),
        model: centre(titles[1]) - centre(model),
        // Titles and values start on the same line, not centred in the column.
        effortLeft: Math.round(left(titles[0]) + Number.parseFloat(getComputedStyle(titles[0]).paddingLeft)) - Math.round(left(trigger) + Number.parseFloat(getComputedStyle(trigger).paddingLeft)),
        modelLeft: Math.round(left(titles[1]) + Number.parseFloat(getComputedStyle(titles[1]).paddingLeft)) - Math.round(left(model) + Number.parseFloat(getComputedStyle(model).paddingLeft)),
      };
    });
    expect(columnCentres).toEqual({effort: 0, model: 0, effortLeft: 0, modelLeft: 0});

    // One click in the directory fills the job it was opened for and hands the
    // roles back: there is nothing else to press.
    await taskRow.getByRole('button', {name: /as the subagent model/}).click();
    await expect(modal.locator('.model-table')).toBeVisible();
    await modal.getByRole('button', {name: /OpenAI.*2 models/}).click();
    await modal.getByRole('button', {name: /Set GPT-5.6 Sol as the subagent model/}).click();
    await expect(modal.locator('.model-table')).toHaveCount(0);
    await expect(taskRow).toContainText('GPT-5.6 Sol');

    // The pick carries a level with it — one step up from the chat model's,
    // because this job runs unattended — and the menu is where it changes.
    const level = taskRow.getByRole('button', {name: /Reasoning for/});
    await expect(level).toContainText('Medium');
    await level.click();
    await modal.getByRole('menuitemradio', {name: 'Low'}).click();
    await expect(level).toContainText('Low');
    await expect(taskRow).toContainText('GPT-5.6 Sol');
    // Not reasoning at all is a level like any other, and it is what None means.
    await level.click();
    await expect(modal.getByRole('menu', {name: /Reasoning for/}).getByRole('menuitemradio')).toHaveText(['None', 'Low', 'Medium', 'High']);
    await modal.getByRole('menuitemradio', {name: 'None'}).click();
    await expect(level).toContainText('None');

    // A job filled by a model that cannot reason keeps the column's width with
    // an inert placeholder rather than a menu whose only answer is None.
    const speechRow = modal.locator('.role-options .general-setting-row').nth(4);
    await expect(speechRow.getByRole('button', {name: /Reasoning for/})).toHaveCount(0);
    const effortWidths = await modal.locator('.role-options').evaluate((view) => {
      const rows = [...view.querySelectorAll('.general-setting-row')];
      const placeholder = rows[4].querySelector('.role-effort-placeholder')!.getBoundingClientRect();
      const trigger = rows[1].querySelector('.select-menu-trigger')!.getBoundingClientRect();
      return {placeholder: Math.round(placeholder.width), trigger: Math.round(trigger.width)};
    });
    expect(effortWidths.placeholder).toBe(effortWidths.trigger);
  });

  test('MODEL lists the available models and picks a reasoning level per model', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'MODEL'}).click();

    const menu = page.getByRole('menu', {name: 'Model options'});
    await expect(menu).toBeVisible();
    // The search takes the caret, so a filter can be typed without aiming.
    await expect(menu.getByRole('textbox', {name: 'Search models'})).toBeFocused();
    const rows = menu.getByRole('menuitem');
    await expect(rows.first()).toContainText('GPT-5.6 Terra');

    // Each row opens its own reasoning submenu to the side.
    await rows.first().click();
    const submenu = page.getByRole('menu', {name: 'Reasoning for GPT-5.6 Terra'});
    await expect(submenu).toContainText('Reasoning');
    const options = submenu.getByRole('menuitemradio');
    await expect(options).toHaveText(['Off', 'Low', 'Medium', 'High']);
    await expect(submenu.getByRole('menuitemradio', {name: 'Medium'})).toHaveAttribute('aria-checked', 'true');

    // Choosing a level settles both halves and closes the pair.
    await submenu.getByRole('menuitemradio', {name: 'High'}).click();
    await expect(submenu).toHaveCount(0);
    await expect(menu).toHaveCount(0);

    await page.getByRole('button', {name: 'MODEL'}).click();
    await menu.getByRole('menuitem').first().click();
    await expect(submenu.getByRole('menuitemradio', {name: 'High'})).toHaveAttribute('aria-checked', 'true');
    await expect(submenu.getByRole('menuitemradio', {name: 'Medium'})).toHaveAttribute('aria-checked', 'false');

    // The toolbar is an affordance for choosing a model, not a provider badge:
    // changing the model must never replace its brain glyph.
    await page.keyboard.press('Escape');
    await menu.getByRole('menuitem', {name: /GPT-5.6 Sol/}).click();
    await page.getByRole('menu', {name: 'Reasoning for GPT-5.6 Sol'}).getByRole('menuitemradio', {name: 'Low'}).click();
    const modelButton = page.getByRole('button', {name: 'MODEL'});
    await expect(modelButton.locator('[data-icon="brain"]')).toBeVisible();
    await expect(modelButton.locator('.provider-logo')).toHaveCount(0);
  });

  test('the model menu searches the list and stays a few rows tall', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'MODEL'}).click();
    const menu = page.getByRole('menu', {name: 'Model options'});
    const list = menu.locator('.model-menu-list');

    // Bound long catalogues while allowing the current short fixture to fit.
    await expect(list).toHaveCSS('overflow-y', 'auto');
    await expect(list).toHaveCSS('max-height', '140px');
    const metrics = await list.evaluate((node) => ({height: node.clientHeight, content: node.scrollHeight}));
    expect(metrics.height).toBe(Math.min(140, metrics.content));

    // Every row carries its company mark to the left of the name.
    await expect(menu.getByRole('menuitem').first().locator('.provider-logo')).toBeVisible();

    const search = menu.getByRole('textbox', {name: 'Search models'});
    // The clear control only exists while there is something to clear, and it
    // stays untooltipped — an x on a search field explains itself.
    await expect(menu.getByRole('button', {name: 'Clear search'})).toHaveCount(0);
    await search.fill('sol');
    await expect(menu.getByRole('menuitem')).toHaveText([/GPT-5.6 Sol/]);
    const clear = menu.getByRole('button', {name: 'Clear search'});
    await expect(clear).not.toHaveAttribute('data-tooltip-label', /.*/);
    await expect(clear).not.toHaveAttribute('title', /.*/);
    await clear.click();
    await expect(search).toHaveValue('');
    await expect(search).toBeFocused();

    await search.fill('nothing here');
    await expect(menu.getByRole('menuitem')).toHaveCount(0);
    await expect(menu).toContainText('No models available');
  });

  test('a reasoning submenu low in the list rests against the window edge', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'MODEL'}).click();
    const menu = page.getByRole('menu', {name: 'Model options'});
    const rows = menu.getByRole('menuitem');

    // The submenu is taller than a row, so the lowest row cannot keep its
    // alignment without hanging off the bottom — it slides up instead.
    await rows.last().click();
    const submenu = page.locator('.model-submenu');
    const box = (await submenu.boundingBox())!;
    const viewport = page.viewportSize()!.height;
    expect(box.y).toBeGreaterThanOrEqual(MENU_EDGE_MARGIN);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport - MENU_EDGE_MARGIN + 1);

    // A row that does fit keeps lining up with its own row.
    await rows.first().click();
    const first = (await submenu.boundingBox())!;
    const rowBox = (await rows.first().boundingBox())!;
    expect(first.y).toBeCloseTo(rowBox.y - 4, 0);
  });

  test('the model menu opens away from whatever the prompt sits against', async ({page}) => {
    await page.goto('/');
    const menu = page.getByRole('menu', {name: 'Model options'});
    // The menu lines up with the MODEL word, not the button box: the icon
    // sits left of the label, so centring on the box reads as off-centre.
      const label = page.getByRole('button', {name: 'MODEL'}).locator('span').last();
    const gap = async () => {
      const button = (await page.getByRole('button', {name: 'MODEL'}).boundingBox())!;
      const word = (await label.boundingBox())!;
      const box = (await menu.boundingBox())!;
      return {
        above: button.y - (box.y + box.height),
        below: box.y - (button.y + button.height),
        offCentre: (box.x + box.width / 2) - (word.x + word.width / 2),
      };
    };

    // The welcome prompt is centred under the greeting, so the menu drops down.
    await page.getByRole('button', {name: 'MODEL'}).click();
    const welcome = await gap();
    expect(welcome.below).toBeCloseTo(6);
    expect(Math.abs(welcome.offCentre)).toBeLessThanOrEqual(1);

    // In a conversation the composer sits on the floor, so it opens upward.
    await page.keyboard.press('Escape');
    await send(page, 'menu placement');
    await page.getByRole('button', {name: 'MODEL'}).click();
    const conversation = await gap();
    expect(conversation.above).toBeCloseTo(6);
    expect(Math.abs(conversation.offCentre)).toBeLessThanOrEqual(1);
    const box = (await menu.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  });

  test('Chats and New Chat use the same icon-button hover treatment', async ({page}) => {
    await page.goto('/');
    const chatDrawerToggle = page.getByRole('button', {name: 'Toggle Chats'});
    const newChat = page.getByLabel('Chat controls', {exact: true}).getByRole('button', {name: 'New Chat'});

    const appearance = async (button: typeof chatDrawerToggle) => button.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        width: style.width,
        height: style.height,
        radius: style.borderRadius,
        background: style.backgroundColor,
        color: style.color,
      };
    });

    expect(await appearance(chatDrawerToggle)).toEqual(await appearance(newChat));
    await expect(newChat).not.toHaveCSS('position', 'fixed');
    const centres = await newChat.evaluate((button) => {
      const buttonRect = button.getBoundingClientRect();
      const artworkRect = button.querySelector('[data-icon="new-chat"] > g')!.getBoundingClientRect();
      return {
        buttonX: buttonRect.left + buttonRect.width / 2,
        buttonY: buttonRect.top + buttonRect.height / 2,
        artworkX: artworkRect.left + artworkRect.width / 2,
        artworkY: artworkRect.top + artworkRect.height / 2,
      };
    });
    expect(centres.artworkX).toBeCloseTo(centres.buttonX);
    expect(centres.artworkY).toBeCloseTo(centres.buttonY);
    await chatDrawerToggle.hover();
    await page.waitForTimeout(180);
    const chatDrawerHover = await appearance(chatDrawerToggle);
    await newChat.hover();
    await page.waitForTimeout(180);
    expect(await appearance(newChat)).toEqual(chatDrawerHover);
  });

  test('Search Chats rides the drawer and opens a search modal', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Toggle Chats'}).click();
    const search = page.getByRole('button', {name: 'Search', exact: true});
    await expect(search).toHaveCount(0);

    await send(page, 'Original chat message');
    await expect(page.locator('.message.assistant')).toBeVisible({timeout: 4000});
    await page.getByLabel('Chat controls', {exact: true}).getByRole('button', {name: 'New Chat'}).click();
    await page.getByRole('button', {name: 'Toggle Chats'}).click();
    await expect(search).toBeVisible();
    const heading = chatDrawer(page).locator('.chat-drawer-heading');
    await expect(page.locator('.left-controls').getByRole('button', {name: 'Search', exact: true})).toHaveCount(0);
    await expect(heading.getByRole('button', {name: 'Search', exact: true})).toHaveCount(1);
    const arrange = heading.getByRole('button', {name: 'Arrange'});
    await expect(arrange).toHaveCount(1);
    const [searchBox, arrangeBox] = await Promise.all([search.boundingBox(), arrange.boundingBox()]);
    expect(searchBox).not.toBeNull();
    expect(arrangeBox).not.toBeNull();
    expect(searchBox!.x + searchBox!.width).toBeLessThanOrEqual(arrangeBox!.x);
    expect(Math.abs(searchBox!.y - arrangeBox!.y)).toBeLessThan(2);

    await heading.getByRole('button', {name: 'Team', exact: true}).click();
    const addTeam = heading.getByRole('button', {name: 'New chat', exact: true});
    await expect(arrange).toHaveCount(0);
    await expect(addTeam).toBeVisible();
    const [teamSearchBox, addTeamBox] = await Promise.all([search.boundingBox(), addTeam.boundingBox()]);
    expect(teamSearchBox).not.toBeNull();
    expect(addTeamBox).not.toBeNull();
    expect(teamSearchBox!.x + teamSearchBox!.width).toBeLessThanOrEqual(addTeamBox!.x);
    expect(Math.abs(teamSearchBox!.y - addTeamBox!.y)).toBeLessThan(2);
    await heading.getByRole('button', {name: 'Assistant', exact: true}).click();

    await search.click();
    const dialog = page.getByRole('dialog', {name: 'Search chats'});
    await expect(dialog).toBeVisible();
    await dialog.getByRole('textbox', {name: 'Search chats'}).fill('Original');
    await dialog.getByRole('option').first().click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.message:not(.assistant)').first()).toContainText('Original chat message');

    // Closing the drawer takes its search affordance with it.
    await page.getByRole('button', {name: 'Toggle Chats'}).click();
    await expect(search).toHaveCount(0);
  });

  test('Team search finds team chats instead of assistant chats', async ({page}) => {
    await page.goto('/?coldStart=0');
    const heading = chatDrawer(page).locator('.chat-drawer-heading');
    await heading.getByRole('button', {name: 'Team', exact: true}).click();
    await heading.getByRole('button', {name: 'Search', exact: true}).click();
    const dialog = page.getByRole('dialog', {name: 'Search chats'});
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('option', {name: 'Maya', exact: true})).toBeVisible();
    await expect(dialog.getByRole('option', {name: 'Linus', exact: true})).toBeVisible();
    await expect(dialog.getByRole('option', {name: 'Launch room', exact: true})).toBeVisible();
    await expect(dialog.getByRole('option', {name: 'Planning a product launch'})).toHaveCount(0);
    await expect(dialog.getByRole('option', {name: 'Research notes'})).toHaveCount(0);
    // A query also lists matching message excerpts as their own options, so the
    // chat row is matched by its exact title rather than any excerpt containing it.
    await dialog.getByRole('textbox', {name: 'Search chats'}).fill('Maya');
    await expect(dialog.getByRole('option', {name: 'Maya', exact: true})).toBeVisible();
    await dialog.getByRole('option', {name: 'Maya', exact: true}).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('region', {name: 'Conversation with Maya'})).toBeVisible();

    await heading.getByRole('button', {name: 'Assistant', exact: true}).click();
    await heading.getByRole('button', {name: 'Search', exact: true}).click();
    const assistantDialog = page.getByRole('dialog', {name: 'Search chats'});
    await expect(assistantDialog).toBeVisible();
    await expect(assistantDialog.getByRole('option', {name: 'Planning a product launch'})).toBeVisible();
    await expect(assistantDialog.getByRole('option', {name: 'Maya'})).toHaveCount(0);
  });

  test('Team search finds chats by conversation history', async ({page}) => {
    await page.goto('/?coldStart=0');
    const heading = chatDrawer(page).locator('.chat-drawer-heading');
    await heading.getByRole('button', {name: 'Team', exact: true}).click();
    await heading.getByRole('button', {name: 'Search', exact: true}).click();
    const dialog = page.getByRole('dialog', {name: 'Search chats'});
    await expect(dialog).toBeVisible();
    const search = dialog.getByRole('textbox', {name: 'Search chats'});
    await search.fill('onboarding findings');
    await expect(dialog.getByRole('option', {name: 'Maya', exact: true})).toBeVisible();
    await expect(dialog.getByRole('option')).toHaveCount(2);
    const maya = dialog.getByRole('option', {name: 'Maya', exact: true});
    await expect(maya.locator('..').locator('.chat-search-snippet')).toHaveCount(1);
    await expect(maya.locator('..').locator('mark')).toHaveText(/onboarding findings/i);
    await search.fill('blocking launch');
    const launchRoom = dialog.getByRole('option', {name: 'Launch room', exact: true});
    await expect(launchRoom).toBeVisible();
    await expect(dialog.getByRole('option')).toHaveCount(2);
    await expect(launchRoom.locator('..').locator('.chat-search-snippet')).toHaveCount(1);
    await expect(launchRoom.locator('..').locator('mark')).toHaveText(/blocking launch/i);
    await expect(dialog.getByRole('option', {name: 'Planning a product launch', exact: true})).toHaveCount(0);
  });

  test('Assistant search shows matching history snippets under the chat name', async ({page}) => {
    await page.goto('/?coldStart=0');
    await chatDrawer(page).locator('.chat-drawer-heading').getByRole('button', {name: 'Search', exact: true}).click();
    const dialog = page.getByRole('dialog', {name: 'Search chats'});
    await expect(dialog).toBeVisible();
    const search = dialog.getByRole('textbox', {name: 'Search chats'});

    await search.fill('milestones');
    const launch = dialog.getByRole('option', {name: 'Planning a product launch', exact: true});
    await expect(launch).toBeVisible();
    await expect(dialog.getByRole('option')).toHaveCount(2);
    await expect(launch.locator('..').locator('.chat-search-snippet')).toHaveCount(1);
    await expect(launch.locator('..').locator('mark')).toHaveText(/milestones/i);

    await search.fill('plan');
    await expect(launch.locator('..').locator('.chat-search-snippet')).toHaveCount(2);
    await expect(launch.locator('..').locator('.chat-search-snippet mark')).toHaveText([/plan/i, /plan/i]);
    await launch.locator('..').locator('.chat-search-match').nth(1).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('#message-m2')).toBeInViewport();
    await expect(dialog.getByRole('option', {name: 'Research notes'})).toHaveCount(0);
  });

  test('keeps chat actions visible over an expanded workspace and minimises only after acting', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Toggle Chats'}).click();
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    await page.getByRole('button', {name: 'Expand Workspace'}).click();

    const workspace = page.locator('main');
    const toggleChats = page.getByRole('button', {name: 'Toggle Chats'});
    const newChat = page.locator('.left-controls').getByRole('button', {name: 'New Chat'});
    const search = page.getByRole('button', {name: 'Search', exact: true});
    await expect(page.locator('.left-controls button')).toHaveCount(1);
    await expect(toggleChats).toBeVisible();
    await expect(newChat).toHaveCount(0);
    await expect(search).toHaveCount(0);

    await toggleChats.click();
    await expect(workspace).toHaveClass(/workspace-expanded/);
    await expect(newChat).toBeVisible();
    await expect(search).toBeVisible();

    await search.click();
    const dialog = page.getByRole('dialog', {name: 'Search chats'});
    await expect(dialog).toBeVisible();
    await expect(workspace).toHaveClass(/workspace-expanded/);

    await dialog.getByRole('option').first().click();
    await expect(dialog).toHaveCount(0);
    await expect(workspace).not.toHaveClass(/workspace-expanded/);
    await expect(workspace).toHaveClass(/workspace-open/);

    await page.getByRole('button', {name: 'Expand Workspace'}).click();
    await expect(workspace).toHaveClass(/workspace-expanded/);
    await newChat.click();
    await expect(workspace).not.toHaveClass(/workspace-expanded/);
    await expect(workspace).toHaveClass(/workspace-open/);
  });

  test('right-side controls use the same aligned icon-button treatment', async ({page}) => {
    await page.goto('/');
    const chatDrawerToggle = page.getByRole('button', {name: 'Toggle Chats'});
    const workspace = page.getByRole('button', {name: 'Toggle Workspace'});
    await expect(workspace).toHaveClass(/title-bar-icon-button/);
    await expect(workspace).toHaveCSS('width', '28px');
    await expect(workspace).toHaveCSS('height', '28px');
    const workspaceCentres = await workspace.evaluate((button) => {
      const buttonRect = button.getBoundingClientRect();
      const iconRect = button.querySelector('svg')!.getBoundingClientRect();
      return {
        button: [buttonRect.left + buttonRect.width / 2, buttonRect.top + buttonRect.height / 2],
        icon: [iconRect.left + iconRect.width / 2, iconRect.top + iconRect.height / 2],
      };
    });
    expect(workspaceCentres.icon).toEqual(workspaceCentres.button);
    await workspace.hover();
    await page.waitForTimeout(180);
    await expect(workspace).toHaveCSS('background-color', 'rgb(243, 243, 243)');
    await expect(workspace).toHaveCSS('color', 'rgb(10, 10, 10)');
    await expect(workspace).toHaveCSS('border-radius', await chatDrawerToggle.evaluate((node) => getComputedStyle(node).borderRadius));
  });

  test('the full title bar clears the window chrome and sits on one centre line', async ({page}) => {
    await page.goto('/');
    await send(page, 'Alignment audit');

    const boxes = await page.locator(
      '.left-controls button, .conversation-title-bar > button, .top-controls button',
    ).evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return {left: rect.left, width: rect.width, centre: rect.top + rect.height / 2};
      }));
    expect(boxes).toHaveLength(5);
    // Every icon button shares the 26px line; the text title retains its
    // optical 25px line.
    expect(boxes.map((box) => box.centre)).toEqual([26, 26, 26, 26, 25]);
    const chatDrawerGlyph = await page.locator('[data-icon="panel-left"]').boundingBox();
    const newChatGlyph = await page.locator('.left-controls [data-icon="new-chat"]').boundingBox();
    expect(chatDrawerGlyph!.y + chatDrawerGlyph!.height / 2).toBe(26);
    expect(newChatGlyph!.y + newChatGlyph!.height / 2).toBe(26);
    const rightGlyphCentres = await page.locator('.top-controls button > svg').evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return rect.top + rect.height / 2;
      }));
    for (const centre of rightGlyphCentres) expect(centre).toBe(26);

    // On macOS the row starts clear of the traffic lights, which end at 72px.
    const inset = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--chrome-inset').trim());
    const leftControls = boxes.slice(0, 2);
    if (inset !== '0px') expect(leftControls[0].left).toBeGreaterThanOrEqual(72);
    // A small optical gap preserves equal visible spacing after matching both
    // outlines to the wider native traffic lights.
    expect(leftControls[1].left - (leftControls[0].left + leftControls[0].width)).toBeCloseTo(1.5);
  });

  test('keeps one neutral traffic-light set ready for an inactive macOS window', async ({page}) => {
    await page.goto('/');
    const isMacLayout = await page.evaluate(() => document.documentElement.dataset.platform === 'darwin');
    const inactiveSet = page.locator('.inactive-traffic-lights');
    await expect(inactiveSet.locator('i')).toHaveCount(3);
    await expect(inactiveSet).not.toHaveClass(/visible/);
    if (isMacLayout) await expect(inactiveSet.locator('i').first()).toBeHidden();
  });

  for (const theme of ['Light', 'Dark'] as const) {
    test(`keeps inactive traffic lights visible throughout startup in ${theme.toLowerCase()} mode`, async ({page}) => {
      await page.goto('/?coldStart=1');
      const content = page.locator('main');
      await expect(content).toHaveClass(/app-under-splash/);
      await page.evaluate((theme) => {
        document.documentElement.dataset.platform = 'darwin';
        document.documentElement.dataset.theme = theme.toLowerCase();
        document.getAnimations().forEach((animation) => animation.pause());
        window.dispatchEvent(new Event('blur'));
      }, theme);
      const lights = page.locator('.inactive-traffic-lights');
      const colour = theme === 'Light' ? 200 : 69;
      const expectedPixels = Array.from({length: 3}, () => [colour, colour, colour]);
      await expect(content).toHaveCSS('opacity', '0');
      expect(await paintedTrafficLightColours(lights)).toEqual(expectedPixels);

      await page.evaluate(() => document.dispatchEvent(new Event('polymux:splash-done')));
      await expect(content).toHaveClass(/app-entering/);
      // Check the delay and midpoint of the real app fade, not just its end.
      for (const time of [0, 560]) {
        await content.evaluate((node, time) => {
          const animation = node.getAnimations().find((item) =>
            item instanceof CSSAnimation && item.animationName === 'app-fade-in');
          if (!animation) throw new Error('Expected the startup fade');
          animation.pause();
          animation.currentTime = time;
        }, time);
        expect(await paintedTrafficLightColours(lights)).toEqual(expectedPixels);
      }
      await expect(page.locator('#startup-splash')).toHaveCount(0);
      expect(await paintedTrafficLightColours(lights)).toEqual(expectedPixels);
    });

    test(`paints inactive traffic lights above Settings in ${theme.toLowerCase()} mode`, async ({page}, testInfo) => {
      await page.goto('/');
      await page.evaluate(() => document.documentElement.dataset.platform = 'darwin');
      await page.getByRole('button', {name: 'Settings'}).click();
      const settings = page.getByRole('region', {name: 'Settings'});
      await settings.getByRole('radiogroup', {name: 'Theme'}).getByRole('radio', {name: theme}).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme.toLowerCase());
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));

      const lights = page.locator('.inactive-traffic-lights');
      await expect(lights).toHaveClass(/visible/);
      // Visibility and computed colours alone pass even when the opaque
      // Settings page covers the dots. Read the pixels actually painted.
      const pixels = await paintedTrafficLightColours(lights);
      const colour = theme === 'Light' ? 200 : 69;
      expect(pixels).toEqual(Array.from({length: 3}, () => [colour, colour, colour]));
      await page.screenshot({path: testInfo.outputPath('settings-traffic-lights.png'), clip: {x: 0, y: 0, width: 500, height: 180}});
      await expect(lights).toHaveCSS('pointer-events', 'none');

      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(lights).toBeHidden();
      await page.evaluate(() => {
        document.documentElement.dataset.fullscreen = 'true';
        window.dispatchEvent(new Event('blur'));
      });
      await expect(lights).toBeHidden();
      await page.evaluate(() => {
        document.documentElement.dataset.fullscreen = 'false';
        document.documentElement.dataset.platform = 'win32';
      });
      await expect(lights).toBeHidden();
    });
  }

});

test.describe('conversation', () => {
  test('lays out user and assistant messages differently with always-visible actions', async ({page}) => {
    await page.goto('/');
    await send(page, 'Test the assembled chat');

    const user = page.locator('.message:not(.assistant)').first();
    const assistant = page.locator('.message.assistant').first();
    await expect(user).toContainText('Test the assembled chat');
    await expect(assistant).toContainText(/assembled Polymux chat surface/, {timeout: 4000});

    // The user's turn is a right-aligned pill; the assistant's is full width.
    const bubble = await user.locator('.message-content').evaluate((node) => {
      const style = getComputedStyle(node);
      return {radius: style.borderRadius, background: style.backgroundColor};
    });
    expect(bubble.radius).toBe('20px');
    expect(bubble.background).toBe('rgb(232, 232, 232)');
    await expect(assistant.locator('.message-content')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

    // Actions stay visible without hovering the turn.
    const actions = user.locator('.message-actions');
    await expect(actions).toHaveCSS('opacity', '1');
    await user.hover();
    await expect(actions).toHaveCSS('opacity', '1');
    await expect(user.getByRole('button', {name: 'Edit'})).toBeVisible();
    await expect(assistant.getByRole('button', {name: 'Share', exact: true})).toBeVisible();

    const composerMask = await page.locator('.sticky-composer').evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      return {
        bottom: Math.round(bounds.bottom),
        viewportBottom: window.innerHeight,
        background: getComputedStyle(node).backgroundImage,
      };
    });
    expect(composerMask.bottom).toBe(composerMask.viewportBottom);
    expect(composerMask.background).not.toBe('none');
  });

  test('attaches files from the bottom-left of the sent-message editor', async ({page}) => {
    await page.goto('/');
    await send(page, 'Edit this message');
    const user = page.locator('.message:not(.assistant)').first();
    await user.hover();
    await user.getByRole('button', {name: 'Edit'}).click();

    const shell = user.locator('.message-edit-shell');
    const attach = shell.getByRole('button', {name: 'Attach files'});
    await expect(attach).toBeVisible();
    const geometry = await shell.evaluate((node) => {
      const shellBounds = node.getBoundingClientRect();
      const buttonBounds = node.querySelector('.edit-attach')!.getBoundingClientRect();
      const sendBounds = node.querySelector('.save')!.getBoundingClientRect();
      return {
        attachNearLeft: buttonBounds.left - shellBounds.left < 20,
        attachLeftOfSend: buttonBounds.right < sendBounds.left,
        attachNearBottom: shellBounds.bottom - buttonBounds.bottom < 20,
      };
    });
    expect(geometry).toEqual({attachNearLeft: true, attachLeftOfSend: true, attachNearBottom: true});

    await shell.locator('input[type=file]').setInputFiles({name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('notes')});
    await expect(shell.getByLabel('New attachments')).toContainText('notes.txt');
    await shell.getByRole('button', {name: 'Send'}).click();
    await expect(user.locator('.message-files')).toContainText('notes.txt');
  });

  test('resending an edited earlier message drops later turns and starts from there', async ({page}) => {
    await page.goto('/');
    await send(page, 'First question');
    await expect(page.locator('.message.assistant').first()).toContainText(/assembled Polymux chat surface/, {timeout: 4000});
    await send(page, 'Second question');
    await expect(page.locator('.message.assistant').nth(1)).toContainText(/assembled Polymux chat surface/, {timeout: 4000});
    await expect(page.locator('.message:not(.assistant)')).toHaveCount(2);
    await expect(page.locator('.message.assistant')).toHaveCount(2);

    const firstUser = page.locator('.message:not(.assistant)').first();
    await firstUser.hover();
    await firstUser.getByRole('button', {name: 'Edit'}).click();
    await firstUser.getByRole('textbox', {name: 'Edit message'}).fill('Revised first question');
    await firstUser.getByRole('button', {name: 'Send'}).click();

    await expect(page.getByText('Second question')).toHaveCount(0);
    await expect(page.locator('.message:not(.assistant)')).toHaveCount(1);
    await expect(firstUser).toContainText('Revised first question');
    await expect(page.locator('.message.assistant')).toHaveCount(1);
    await expect(page.locator('.message.assistant').first()).toContainText(/assembled Polymux chat surface/, {timeout: 4000});
  });

  test('persists the revised conversation after starting and reopening a chat', async ({page}) => {
    await page.goto('/');
    await send(page, 'Original chat message');

    const user = page.locator('.message:not(.assistant)').first();
    const assistant = page.locator('.message.assistant').first();
    await expect(assistant).toContainText(/assembled Polymux chat surface/, {timeout: 4000});

    await user.hover();
    await user.getByRole('button', {name: 'Edit'}).click();
    await user.getByRole('textbox', {name: 'Edit message'}).fill('Updated chat message');
    await user.getByRole('button', {name: 'Send'}).click();
    await expect(user).toContainText('Updated chat message');

    await expect(page.locator('.message.assistant').first()).toContainText(/assembled Polymux chat surface/, {timeout: 4000});

    await page.getByLabel('Chat controls').getByRole('button', {name: 'New Chat'}).click();
    await expect(page.getByRole('heading', {name: 'What can I help with?'})).toBeVisible();
    await chatDrawer(page).getByRole('button', {name: /Open chat: Original chat message/}).click();

    const restoredUser = page.locator('.message:not(.assistant)').first();
    const restoredAssistant = page.locator('.message.assistant').first();
    await expect(restoredUser).toContainText('Updated chat message');
    await expect(restoredAssistant).toContainText(/assembled Polymux chat surface/);
    await expect(restoredAssistant.getByRole('button', {name: 'Share', exact: true})).toBeVisible();
    await expect(restoredUser).not.toContainText('Original chat message');
  });

  test('renders assistant markdown, including a titled code block', async ({page}) => {
    await page.goto('/');
    await send(page, 'markdown please');
    await expect(page.locator('.message.assistant .markdown-body')).toBeVisible({timeout: 4000});
  });

  test('keeps a failed assistant row and explains an unconfigured provider', async ({page}) => {
    await page.goto('/');
    await send(page, '__demo_provider_failure__');
    const assistant = page.locator('.message.assistant').first();
    await expect(assistant).toContainText('Unable to respond: OpenCode Go is not configured.');
    await expect(assistant).toContainText('Settings → Provider');
  });

  test('replaces raw authentication failures with an actionable provider message', async ({page}) => {
    await page.goto('/');
    await send(page, '__demo_auth_failure__');
    const assistant = page.locator('.message.assistant').first();
    await expect(assistant).toContainText('The selected provider rejected its saved API key.');
    await expect(assistant).toContainText('Settings → Provider');
    await expect(assistant).not.toContainText('Missing Authentication header');
  });

  test('shows an agent warning as a toast instead of assistant prose', async ({page}) => {
    await page.goto('/?coldStart=0');
    await send(page, '__demo_agent_notice__');

    const toast = page.locator('.agent-notice-toast');
    await expect(toast).toHaveAttribute('role', 'status');
    await expect(toast).toHaveText('Fast mode turned off: requires extra usage to be enabled for this account.');
    await expect(toast.locator('[data-icon="warning"]')).toBeVisible();
    const warningOffset = await toastIconVerticalOffset(toast);
    // A triangle's broad base reads lower than its geometric midpoint. Keep
    // its painted centre one pixel above the text's ink centre.
    expect(warningOffset).toBeGreaterThan(-1.25);
    expect(warningOffset).toBeLessThan(-.75);
    const horizontalSpacing = await toastHorizontalSpacing(toast);
    expect(Math.max(...horizontalSpacing) - Math.min(...horizontalSpacing)).toBeLessThan(.1);
    const assistant = page.locator('.message.assistant').last();
    await expect(assistant).not.toContainText('Fast mode turned off');
    await expect(assistant).toContainText('This is the assembled Polymux chat surface.');
    await toast.getByRole('button', {name: 'Dismiss warning'}).click();
    await expect(toast).toHaveCount(0);
  });

  test('shows an external-agent connection failure as an error toast without an empty assistant row', async ({page}) => {
    await page.goto('/?coldStart=0');
    await send(page, '__demo_external_connection_failure__');

    const toast = page.locator('.agent-notice-toast');
    await expect(toast).toHaveAttribute('role', 'alert');
    await expect(toast).toHaveText('External agent connection lost');
    await expect(toast.locator('[data-icon="error"]')).toBeVisible();
    const errorOffset = await toastIconVerticalOffset(toast);
    expect(errorOffset).toBeGreaterThan(-.25);
    expect(errorOffset).toBeLessThan(.25);
    await expect(page.locator('.message.assistant')).toHaveCount(0);
    const dismiss = toast.getByRole('button', {name: 'Dismiss error'});
    await dismiss.focus();
    await page.keyboard.press('Enter');
    await expect(toast).toHaveCount(0);
  });

  test('does not list the main agent response as a delegated task', async ({page}) => {
    await page.goto('/');
    await send(page, 'timing');
    await expect(summaryCard(page).getByText('Prepare the response')).toHaveCount(0);
  });

  test('a dispatched task keeps working after the call that started it returns', async ({page}) => {
    await page.goto('/');
    await send(page, '__demo_task__');

    // `task` returns the moment the subagent starts, so neither the row nor the
    // activity that dispatched it may read as finished while the run is still
    // going — the delegated run's own ending is what settles them.
    const row = summaryCard(page).getByRole('button', {name: /Compare the two providers/});
    await expect(row.locator('svg.task-glyph.running')).toBeVisible({timeout: 4000});
    // …and the delegated run ending is what settles both.
    await expect(row.locator('svg.task-glyph.running')).toHaveCount(0, {timeout: 4000});
    await expect(row.locator('svg.task-glyph')).toBeVisible();
  });

  test('opens a delegated task as a read-only run in the workspace', async ({page}) => {
    await page.goto('/');
    await send(page, '__demo_task__');

    const row = summaryCard(page).getByRole('button', {name: /Compare the two providers/});
    await expect(row).toBeVisible({timeout: 4000});
    // The mark carries the status by motion alone: its arms travel outward while
    // the subagent works, and the same lines sit still once it is done.
    const arms = await row.locator('svg.task-glyph.running path').evaluateAll((nodes) =>
      nodes.map((node) => {
        const style = getComputedStyle(node);
        return {
          cycle: `${style.animationName}|${style.animationDuration}|${style.animationDelay}`,
          // The offset one cycle costs. Negative is what makes the travel
          // outward, and |end| === dash + gap is what closes the loop seamlessly.
          end: parseFloat(node.style.getPropertyValue('--end')),
          span: parseFloat(node.style.getPropertyValue('--bar')) + parseFloat(node.style.getPropertyValue('--gap')),
        };
      }));
    expect(arms.length).toBeGreaterThan(3);
    expect(arms.every((arm) => arm.cycle.startsWith('task-flare|'))).toBe(true);
    // Symmetric: every arm shares one period and one start, so the mark keeps
    // its symmetry right through the travel.
    expect(new Set(arms.map((arm) => arm.cycle)).size).toBe(1);
    // Outward only, and one whole cycle per period.
    expect(arms.every((arm) => arm.end < 0)).toBe(true);
    expect(arms.every((arm) => Math.abs(Math.abs(arm.end) - arm.span) < 0.02)).toBe(true);
    // The browser has admitted the animation into its running state. Sampling
    // two painted frames is unreliable when several headless pages are
    // background-throttled, while the neighbouring test covers run lifetime.
    expect(await row.locator('svg.task-glyph.running path').first()
      .evaluate((node) => getComputedStyle(node).animationPlayState)).toBe('running');
    await expect(row.locator('svg.task-glyph.done')).toBeVisible({timeout: 6000});
    expect(await row.locator('svg.task-glyph path').first()
      .evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
    await row.click();

    const view = page.locator('.task-view');
    await expect(view).toBeVisible();
    // The orchestrator's half of the exchange, then the subagent's own.
    await expect(view).toContainText('Compare the two providers and report which is cheaper.');
    await expect(view).toContainText('The second provider is cheaper at this volume.');
    // The subagent's own tool trail, folded exactly as the chat pane folds the
    // main run's.
    await view.locator('.agent-activity-heading').click();
    await expect(view.locator('.agent-activity-list')).toContainText('Read 1 file');
    await view.locator('.activity-group-toggle').first().click();
    await expect(view.locator('.activity-children')).toContainText('Reading Files');

    // Nothing here is addressed to anyone: the subagent answers to the run that
    // sent it, so the transcript offers no composer and no way to edit it.
    await expect(view.getByRole('textbox')).toHaveCount(0);
    await view.locator('.message').first().hover();
    await expect(view.getByRole('button', {name: 'Edit'})).toHaveCount(0);
    await expect(view.getByRole('button', {name: 'Good response'})).toHaveCount(0);
  });

  test('reports how long the agent worked', async ({page}) => {
    await page.goto('/');
    await send(page, 'timing');
    await expect(page.locator('.agent-activity-heading')).toContainText(/Work(ing|ed) for \d+s/);
  });

  test('shows one readable activity block for a multi-step agent run', async ({page}) => {
    await page.goto('/');
    await send(page, '__demo_activity__');

    const heading = page.locator('.agent-activity-heading').first();
    // The live block is one heading and the work under it: the trail is in
    // view while the run goes, the way ChatGPT's activity reads.
    await expect(heading).toContainText(/Working for \d+s/);
    await expect(page.locator('.agent-activity-list')).toBeVisible();
    await expect(page.locator('.message.assistant')).toContainText('assembled Polymux chat surface', {timeout: 4000});
    await expect(heading).toContainText(/Worked for \d+s/);
    await expect(heading).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.agent-activity-list')).toHaveCount(0);
    await heading.click();
    await expect(heading).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.message.assistant')).toHaveCount(1);
    await expect(page.locator('.activity-commentary')).toContainText('I’ll read the skill files first');
    const thinking = page.locator('.agent-activity-list li').filter({hasText: 'Thinking'}).first();
    const thinkingDetail = thinking.locator('.activity-detail-toggle');
    await expect(thinkingDetail).toHaveAttribute('aria-expanded', 'false');
    await thinkingDetail.click();
    await expect(thinking.locator('.activity-thinking')).toHaveText('Thinking');
    const commentary = page.locator('.activity-commentary');
    await expect(commentary.locator('button, svg')).toHaveCount(0);

    // The calls behind one summary row wait behind that row's own chevron.
    const groupToggle = page.locator('.activity-group-toggle').first();
    await expect(groupToggle).toHaveAttribute('aria-expanded', 'false');
    await groupToggle.click();
    await expect(groupToggle).toHaveAttribute('aria-expanded', 'true');

    const children = page.locator('.activity-children');
    const computerRow = children.locator('li').filter({hasText: 'Using Window Control'});
    const browserRow = children.locator('li').filter({hasText: 'Using Browser'});
    const computerToggle = computerRow.locator('.activity-preview-toggle');
    const browserToggle = browserRow.locator('.activity-preview-toggle');
    // The disclosure chevron is the row's only glyph, and the frame it opens
    // sits under the row rather than inside its control.
    await expect(computerToggle.locator('svg')).toHaveCount(1);
    await expect(computerToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(browserToggle).toHaveAttribute('aria-expanded', 'false');
    await computerToggle.click();
    await expect(computerRow.locator('.live-activity-preview img')).toBeVisible();
    await expect(page.locator('.agent-activity .live-activity-preview')).toHaveCount(1);
    expect(await computerRow.evaluate((row) => {
      const label = row.querySelector('.activity-label')?.getBoundingClientRect();
      const preview = row.querySelector('.live-activity-preview')?.getBoundingClientRect();
      return label && preview ? Math.abs(label.left - preview.left) : Infinity;
    })).toBeLessThanOrEqual(1);
    await expect(computerRow.locator('.activity-steps, .activity-result, .activity-thinking')).toHaveCount(0);
    await browserToggle.click();
    await expect(computerToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(browserToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(browserRow.locator('.live-activity-preview img')).toBeVisible();
    await expect(page.locator('.agent-activity .live-activity-preview')).toHaveCount(1);
    await browserToggle.click();
    await expect(page.locator('.agent-activity .live-activity-preview')).toHaveCount(0);

    // The main Summary panel independently uses the same minimal component.
    const summary = summaryCard(page);
    const computerSection = summary.locator('.summary-preview-section').filter({hasText: 'Computer Use'});
    const browserSection = summary.locator('.summary-preview-section').filter({hasText: 'Browser Use'});
    await expect(computerSection).toBeVisible();
    await expect(browserSection).toBeVisible();
    const computerPreview = computerSection.getByRole('button', {name: 'Using Window Control'});
    const browserPreview = browserSection.getByRole('button', {name: 'polymux.com'});
    await expect(summary.locator('.summary-preview-row > svg')).toHaveCount(0);
    await expect(computerPreview).toHaveAttribute('aria-expanded', 'false');
    await expect(browserPreview).toHaveAttribute('aria-expanded', 'false');
    await computerPreview.click();
    await expect(computerPreview.locator('.live-activity-preview img')).toBeVisible();
    await expect(summary.locator('.live-activity-preview')).toHaveCount(1);
    expect(await computerPreview.evaluate((row) => {
      const label = row.querySelector('.summary-preview-label')?.getBoundingClientRect();
      const preview = row.querySelector('.live-activity-preview')?.getBoundingClientRect();
      return label && preview ? Math.abs(label.left - preview.left) : Infinity;
    })).toBeLessThanOrEqual(1);
    await browserPreview.click();
    await expect(computerPreview).toHaveAttribute('aria-expanded', 'false');
    await expect(browserPreview).toHaveAttribute('aria-expanded', 'true');
    await expect(browserPreview.locator('.live-activity-preview img')).toBeVisible();
    await expect(summary.locator('.live-activity-preview')).toHaveCount(1);
    await browserPreview.click();
    await expect(summary.locator('.live-activity-preview')).toHaveCount(0);
  });

  test('hides the activity group entirely for a run that used no tools', async ({page}) => {
    await page.goto('/');
    await send(page, 'just a question');
    await expect(page.locator('.message.assistant')).toContainText('assembled Polymux chat surface', {timeout: 4000});
    await expect(page.locator('.agent-activity')).toHaveCount(0);
  });

  test('restores the worked-duration and activity list for a past chat', async ({page}) => {
    await page.goto('/');
    await send(page, '__demo_activity__');
    await expect(page.locator('.message.assistant')).toContainText('assembled Polymux chat surface', {timeout: 4000});
    await expect(page.locator('.agent-activity-heading')).toContainText(/Work(ing|ed) for \d+s/);

    await page.getByLabel('Chat controls', {exact: true}).getByRole('button', {name: 'New Chat'}).click();
    await expect(page.getByRole('heading', {name: 'What can I help with?'})).toBeVisible();
    await chatDrawer(page).getByRole('button', {name: /Open chat: .*/}).first().click();

    const heading = page.locator('.agent-activity-heading');
    await expect(heading).toContainText(/Work(ing|ed) for \d+s/);
    await heading.click();
    await expect(page.locator('.agent-activity-list')).toContainText('Read 1 file, Ran 1 command');
    await page.locator('.activity-group-toggle').first().click();
    await expect(page.locator('.activity-children')).toContainText('Using Window Control');
  });

  test('sends the next prompt as a one-shot goal and shows its status', async ({page}) => {
    await page.goto('/');
    const goalToggle = page.getByRole('button', {name: 'Send next message as a goal'});
    await goalToggle.click();
    const selectedGoal = page.getByRole('button', {name: 'Disable goal for next message'});
    await expect(selectedGoal).toHaveAttribute('aria-pressed', 'true');
    await expect(selectedGoal).toHaveCSS('background-color', 'rgb(236, 236, 236)');
    await expect(selectedGoal).toHaveCSS('border-radius', '8px');
    await send(page, 'research cool mechatronic project ideas');

    const user = page.locator('.message:not(.assistant)').first();
    await expect(user.locator('.message-goal-label')).toHaveText('Sent as goal');
    await expect(user.locator('.message-time')).toHaveText(/^\d{1,2}:\d{2}\s[AP]M$/);
    await expect(page.getByRole('region', {name: 'Current goal'})).toContainText(/Pursuing goal.*research cool mechatronic project ideas.*· \d+s/);
    await expect(page.getByRole('button', {name: 'Send next message as a goal'})).toHaveAttribute('aria-pressed', 'false');
  });

  test('the live activity shimmer is the only working indicator', async ({page}) => {
    await page.goto('/');
    await send(page, '__demo_run_10000__');
    // The activity block's live row carries the working state, ChatGPT-style;
    // pulse dots under it would be a second, redundant indicator.
    const liveRow = page.locator('.agent-activity-list li.live');
    await expect(liveRow).toHaveCount(1);
    await expect(page.getByRole('status', {name: 'Assistant is responding'})).toHaveCount(0);
    // The wave is painted into the row's own ink — a blended overlay band would
    // light the row's background too, which on dark mode read as a grey box.
    // One animation drives the whole row: the glyph and the label both read its
    // head position, so they light in the order the wave reaches them.
    const label = await liveRow.evaluate((node) => {
      const style = getComputedStyle(node);
      const text = getComputedStyle(node.querySelector('.activity-label')!);
      return {name: style.animationName, timing: style.animationTimingFunction, clip: text.webkitBackgroundClip ?? text.backgroundClip, glyphAnimation: getComputedStyle(node.querySelector('svg')!).animationName};
    });
    expect(label).toEqual({name: 'activity-glint-pass', timing: 'linear', clip: 'text', glyphAnimation: 'none'});

    await page.getByRole('button', {name: 'Stop agent'}).click();
    await expect(liveRow).toHaveCount(0);
  });

  test('keeps streamed reasoning behind an explicit disclosure', async ({page}) => {
    await page.goto('/');
    await send(page, '__demo_run_10000__');

    const thinking = page.locator('.agent-activity-list li').filter({hasText: 'Thinking'}).first();
    const detail = thinking.locator('.activity-detail-toggle');
    await expect(detail).toHaveAttribute('aria-expanded', 'false');
    await expect(thinking.locator('.activity-thinking')).toHaveCount(0);
    await detail.click();
    await expect(thinking.locator('.activity-thinking')).toHaveText('Thinking');

    await page.getByRole('button', {name: 'Stop agent'}).click();
  });

  test('a prompt typed mid-run waits in the queue, then sends itself', async ({page}) => {
    await page.goto('/');
    await send(page, '__demo_run_1500__');
    await editor(page).click();
    await page.keyboard.type('second prompt');
    await page.getByRole('button', {name: 'Send message'}).click();

    const queue = page.getByRole('region', {name: 'Queued messages'});
    await expect(queue).toContainText('second prompt');
    await expect(page.locator('.message:not(.assistant)')).toHaveCount(1);

    await expect(queue).toHaveCount(0, {timeout: 4000});
    await expect(page.locator('.message:not(.assistant)').nth(1)).toContainText('second prompt');
  });

  test('⌘Enter skips the queue and steers the running agent', async ({page}) => {
    await page.goto('/');
    await send(page, '__demo_run_10000__');
    await editor(page).click();
    await page.keyboard.type('urgent prompt');
    await page.keyboard.press('ControlOrMeta+Enter');

    await expect(page.getByRole('region', {name: 'Queued messages'})).toHaveCount(0);
    await expect(page.locator('.message:not(.assistant)').nth(1)).toContainText('urgent prompt');
    // Steering puts the user's message after the assistant that is still
    // writing; the turn it steered has not stopped and must not say so.
    await expect(page.locator('.message-stopped')).toHaveCount(0);
  });

  test('a steered run reads in the order its work happened', async ({page}) => {
    await page.goto('/');
    await send(page, '__demo_activity_10000__');
    // Wait for work to have happened before the steer, so the split has a
    // before and an after to draw.
    await expect(page.locator('.agent-activity-list')).toContainText('Read 1 file, Ran 1 command');
    await editor(page).click();
    await page.keyboard.type('urgent steer');
    await page.keyboard.press('ControlOrMeta+Enter');

    // The trail is cut at the steer: what the run had already done stays above
    // the message that interrupted it, and what it does next reads below it.
    const blocks = page.locator('.agent-activity');
    await expect(blocks).toHaveCount(2);
    const [earlier, later] = [blocks.nth(0), blocks.nth(1)];
    await expect(earlier.locator('.agent-activity-heading')).toContainText(/Worked for \d+s/);
    await expect(later.locator('.agent-activity-heading')).toContainText(/Working for \d+s/);
    const steer = page.locator('.message:not(.assistant)').nth(1);
    await expect(steer).toContainText('urgent steer');
    const [earlierBox, steerBox, laterBox] = await Promise.all([earlier.boundingBox(), steer.boundingBox(), later.boundingBox()]);
    expect(earlierBox!.y).toBeLessThan(steerBox!.y);
    expect(laterBox!.y).toBeGreaterThan(steerBox!.y);

    // The two halves are one trail split, not a copy of it.
    await earlier.locator('.agent-activity-heading').click();
    await expect(earlier.locator('.agent-activity-list')).toContainText('Read 1 file, Ran 1 command');
    await earlier.locator('.activity-group-toggle').first().click();
    await expect(earlier.locator('.activity-children')).toContainText('Using Window Control');
    await expect(later.locator('.agent-activity-list')).toHaveCount(0);

    // Stopping cancels the turn the steer started. The work that had already
    // finished, above the steer, is untouched by it.
    await page.getByRole('button', {name: 'Stop agent'}).click();
    await expect(earlier.locator('.agent-activity-heading')).toContainText(/Worked for \d+s/);
    await expect(page.locator('.message-stopped')).toHaveCount(1);
  });

  test('leaving and returning to a steered run keeps it live', async ({page}) => {
    await page.goto('/');
    await send(page, '__demo_activity_10000__');
    await expect(page.locator('.agent-activity-list')).toContainText('Read 1 file, Ran 1 command');
    await editor(page).click();
    await page.keyboard.type('urgent steer');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(page.locator('.message:not(.assistant)').nth(1)).toContainText('urgent steer');

    // The steer is stored against the run as soon as it lands. Opening the chat
    // again must not read that as "the run is on record", or the live row — and
    // every step still to come — would be dropped on the floor.
    await page.getByLabel('Chat controls', {exact: true}).getByRole('button', {name: 'New Chat'}).click();
    await expect(page.getByRole('heading', {name: 'What can I help with?'})).toBeVisible();
    await page.locator('.chat-drawer-open-chat').first().click();
    await expect(page.locator('.agent-activity').last().locator('.agent-activity-heading')).toContainText(/Working for \d+s/);
    await expect(page.locator('.message:not(.assistant)').nth(1)).toContainText('urgent steer');
    await page.getByRole('button', {name: 'Stop agent'}).click();
  });

  test('a queued message can be steered, or edited back into the composer', async ({page}) => {
    await page.goto('/');
    await send(page, '__demo_run_10000__');
    await editor(page).click();
    await page.keyboard.type('queued prompt');
    await page.getByRole('button', {name: 'Send message'}).click();

    const queue = page.getByRole('region', {name: 'Queued messages'});
    await queue.getByRole('button', {name: 'Edit queued message'}).click();
    await expect(queue).toHaveCount(0);
    await expect(editor(page)).toHaveText('queued prompt');

    await page.getByRole('button', {name: 'Send message'}).click();
    await queue.getByRole('button', {name: 'Steer'}).click();
    await expect(queue).toHaveCount(0);
    await expect(page.locator('.message:not(.assistant)').nth(1)).toContainText('queued prompt');
  });

  test('empty immediate send steers only the earliest queued draft', async ({page}) => {
    await page.goto('/');
    await send(page, '__demo_run_10000__');
    await send(page, 'first queued prompt');
    await send(page, 'second queued prompt');
    await editor(page).press('Control+Enter');
    const queue = page.getByRole('region', {name: 'Queued messages'});
    await expect(queue).not.toContainText('first queued prompt');
    await expect(queue).toContainText('second queued prompt');
    await expect(page.locator('.message:not(.assistant)').last()).toContainText('first queued prompt');
    await page.getByRole('button', {name: 'Stop agent'}).click();
    await expect(queue).toContainText('second queued prompt');
  });

  test('stopping the agent holds queued drafts for explicit retry', async ({page}) => {
    await page.goto('/');
    await send(page, '__demo_run_10000__');
    await editor(page).click();
    await page.keyboard.type('queued prompt');
    await page.getByRole('button', {name: 'Send message'}).click();
    await expect(page.getByRole('region', {name: 'Queued messages'})).toContainText('queued prompt');

    await page.getByRole('button', {name: 'Stop agent'}).click();
    await expect(page.getByRole('region', {name: 'Queued messages'})).toContainText('queued prompt');
    await expect(page.locator('.message:not(.assistant)')).toHaveCount(1);
  });

  test('shows a time beneath assistant messages too', async ({page}) => {
    await page.goto('/');
    await send(page, 'show timestamps');
    const assistant = page.locator('.message.assistant').first();
    const time = assistant.locator('.message-time');
    await expect(time).toHaveText(/^\d{1,2}:\d{2}\s[AP]M$/, {timeout: 4000});
    await expect(time).toHaveCSS('opacity', '1');
    await assistant.hover();
    await expect(time).toHaveCSS('opacity', '1');
  });

  test('the title bar renames the conversation', async ({page}) => {
    await page.goto('/');
    await send(page, 'Rename me');
    const title = page.locator('.conversation-title-bar button');
    await expect(title).toBeVisible();
    await title.click();
    const titleInput = page.getByRole('textbox', {name: 'Rename conversation'});
    await expect(titleInput).toHaveCSS('min-width', '96px');
    expect((await titleInput.boundingBox())!.width).toBeLessThan(300);
    await titleInput.fill('hi');
    await page.keyboard.press('Enter');
    const renamedTitle = page.locator('.conversation-title-bar button');
    await expect(renamedTitle).toHaveText('hi');
    await expect(renamedTitle).toHaveCSS('min-width', '200px');
    expect((await renamedTitle.boundingBox())!.width).toBeGreaterThanOrEqual(200);
  });

  test('centres the title within the conversation pane when panels toggle', async ({page}) => {
    await page.goto('/');
    await send(page, 'centred title');
    const title = page.locator('.conversation-title-bar button');
    const centreOffset = async () => title.evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      const conversation = document.querySelector('.conversation-column')!.getBoundingClientRect();
      return Math.abs(Math.round(bounds.left + bounds.width / 2 - (conversation.left + conversation.width / 2)));
    });
    await expect.poll(centreOffset).toBe(0);
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    await expect(workspaceDrawer(page)).toHaveClass(/open/);
    await expect(page.locator('.conversation-title-bar')).not.toHaveCSS('transition-property', /right|left/);
    await expect.poll(centreOffset).toBe(0);
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    await expect(summaryCard(page)).toBeVisible();
    await expect.poll(centreOffset).toBe(0);
  });

  test('keeps the conversation scroll control centred above its composer', async ({page}) => {
    await page.goto('/');
    await send(page, 'scroll control placement');
    const column = page.locator('.conversation-column');

    await column.locator('.message-list').evaluate((node) => {
      const filler = document.createElement('div');
      filler.style.height = '1200px';
      node.append(filler);
      node.parentElement!.scrollTop = 0;
      node.parentElement!.dispatchEvent(new Event('scroll'));
    });

    const control = page.getByRole('button', {name: 'Scroll to bottom'});
    await expect(control).toBeVisible();
    const layout = await control.evaluate((node) => {
      const button = node.getBoundingClientRect();
      const conversation = document.querySelector('.conversation-column')!.getBoundingClientRect();
      const prompt = document.querySelector('.sticky-composer .polymux-prompt-shell')!.getBoundingClientRect();
      return {
        buttonCentre: button.left + button.width / 2,
        conversationCentre: conversation.left + conversation.width / 2,
        insideConversation: button.left >= conversation.left && button.right <= conversation.right,
        abovePrompt: button.bottom < prompt.top,
      };
    });
    expect(layout.insideConversation).toBe(true);
    expect(layout.abovePrompt).toBe(true);
    expect(Math.abs(layout.buttonCentre - layout.conversationCentre)).toBeLessThanOrEqual(1);

    await control.click();
    await expect.poll(() => column.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThan(1);
  });
});

test.describe('panels', () => {
  test('Summary opens itself once a conversation has started', async ({page}) => {
    await page.goto('/');
    await expect(summaryCard(page)).toHaveCount(0);
    await send(page, 'open the summary');
    await expect(summaryCard(page)).toBeVisible();
    await expect(page.locator('main')).toHaveClass(/summary-open/);
  });

  test('Workspace borrows Summary’s space and gives it back', async ({page}) => {
    await page.goto('/');
    await send(page, 'borrowing');
    await expect(summaryCard(page)).toBeVisible();

    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    await expect(workspaceDrawer(page)).toHaveClass(/open/);
    await expect(summaryCard(page)).toHaveCount(0);

    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    await expect(workspaceDrawer(page)).not.toHaveClass(/open/);
    await expect(summaryCard(page)).toBeVisible();
  });

  test('a New tab becomes the Hub in place, and another New tab stops offering it', async ({page}) => {
    await page.goto('/');
    await send(page, 'hub from a new tab');
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    const drawer = workspaceDrawer(page);
    await drawer.getByLabel('New tab', {exact: true}).click();
    await expect(drawer.locator('.tab.active')).toContainText('New tab');
    const tabCount = await drawer.locator('.tab').count();
    await drawer.locator('.workspace-launcher').getByRole('button', {name: 'Hub'}).click();
    await expect(drawer.locator('.tab')).toHaveCount(tabCount);
    await expect(drawer.locator('.tab.active')).toContainText('Hub');
    await expect(page.locator('.hub-view')).toBeVisible();

    await drawer.getByLabel('New tab', {exact: true}).click();
    await expect(drawer.locator('.workspace-launcher').getByRole('button', {name: 'Hub'})).toHaveCount(0);
  });

  test('clicking away from the address bar drops the caret and keeps the typed text', async ({page}) => {
    await page.goto('/');
    await send(page, 'address focus');
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    await page.getByLabel('New tab', {exact: true}).click();
    await workspaceDrawer(page).locator('.workspace-launcher').getByRole('button', {name: 'Browser'}).click();

    const address = page.getByLabel('Address', {exact: true}).last();
    await address.click();
    await address.fill('asds');
    await expect(address).toBeFocused();

    // A spot that takes no focus of its own, so the field is left holding
    // whatever the user typed once the caret goes.
    await page.locator('.browser-bar').last().click({position: {x: 60, y: 4}});
    await expect(address).not.toBeFocused();
    await expect(address).toHaveValue('asds');
  });

  test('a dismissed Summary stays closed for that conversation', async ({page}) => {
    await page.goto('/');
    await send(page, 'dismissal');
    await page.getByRole('button', {name: 'Toggle Summary'}).click();
    await expect(summaryCard(page)).toHaveCount(0);

    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    await expect(workspaceDrawer(page)).not.toHaveClass(/open/);
    await expect(summaryCard(page)).toHaveCount(0);
  });

  test('the Summary control returns with the other title-bar controls when the Workspace closes', async ({page}) => {
    await page.goto('/');
    await send(page, 'latch');
    const summaryButton = page.getByRole('button', {name: 'Toggle Summary'});

    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    await expect(summaryButton).toHaveCount(0);

    // Closing brings it straight back, in step with the rest of the title bar
    // rather than as a straggler after the slide.
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    await expect(summaryButton).toBeVisible();
  });

  test('opening a panel never reflows the conversation column away from centre', async ({page}) => {
    // Wide enough to keep the split layout, narrow enough that the 420px docked
    // workspace actually compresses the column (100vw - 420 < 792 at 1220px).
    await page.setViewportSize({width: 1000, height: 720});
    await page.goto('/');
    await send(page, 'stability');
    const column = page.locator('.conversation-column');
    const before = await column.boundingBox();

    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    await expect(workspaceDrawer(page)).toHaveClass(/open/);
    for (let frame = 0; frame < 6; frame++) {
      await page.waitForTimeout(60);
      await expectContentToFollowDrawerInsets(page, `workspace open frame ${frame}`);
    }
    const midway = await column.boundingBox();
    await page.waitForTimeout(300);
    const docked = await column.boundingBox();

    // Docking progressively resizes the pane instead of jumping to its final
    // measure or waiting until the end of the Workspace slide. The frame loop
    // above verifies that content follows every sampled inset; the transition
    // declaration stays deterministic even when a loaded browser skips paints.
    expect(midway!.width).toBeLessThan(before!.width);
    expect(docked!.width).toBeLessThanOrEqual(before!.width);
    const mainTransition = await page.locator('main').evaluate((node) => {
      const style = getComputedStyle(node);
      return {properties: style.transitionProperty, durations: style.transitionDuration};
    });
    expect(mainTransition.properties).toContain('--content-right-column');
    expect(mainTransition.durations).not.toMatch(/(^|, )0s(,|$)/);

    // Expanding is a slide, not a resize: the column keeps the docked width.
    const contentsBeforeExpand = await column.locator('.message-list').evaluate((node) => ({
      opacity: getComputedStyle(node).opacity,
      transform: getComputedStyle(node).transform,
    }));
    const dockedDrawer = await workspaceDrawer(page).boundingBox();
    await page.getByRole('button', {name: 'Expand Workspace'}).click();
    await page.waitForTimeout(200);
    const expandingDrawer = await workspaceDrawer(page).boundingBox();
    expect(expandingDrawer!.width).toBeGreaterThan(dockedDrawer!.width);
    expect(expandingDrawer!.width).toBeLessThan(page.viewportSize()!.width);
    const divider = await workspaceDrawer(page).evaluate((node) => {
      const style = getComputedStyle(node, '::before');
      return {display: style.display, width: style.width, colour: style.backgroundColor};
    });
    expect(divider).toEqual({display: 'block', width: '1px', colour: 'rgb(236, 236, 236)'});
    await page.waitForTimeout(400);
    const expandedBox = await column.boundingBox();
    const expandedDrawer = await workspaceDrawer(page).boundingBox();
    expect(Math.round(expandedBox!.width)).toBe(Math.round(docked!.width));
    await expect(column.locator('.message-list')).toHaveCSS('opacity', contentsBeforeExpand.opacity);
    await expect(column.locator('.message-list')).toHaveCSS('transform', contentsBeforeExpand.transform);

    await page.getByRole('button', {name: 'Minimise Workspace'}).click();
    await page.waitForTimeout(200);
    const minimisingDrawer = await workspaceDrawer(page).boundingBox();
    expect(minimisingDrawer!.width).toBeGreaterThan(dockedDrawer!.width);
    expect(minimisingDrawer!.width).toBeLessThan(page.viewportSize()!.width);
    expect(Math.round(minimisingDrawer!.x + minimisingDrawer!.width)).toBe(
      Math.round(expandedDrawer!.x + expandedDrawer!.width),
    );
    expect(minimisingDrawer!.x).toBeGreaterThan(expandedDrawer!.x);

    await page.waitForTimeout(400);
    const minimisedDrawer = await workspaceDrawer(page).boundingBox();
    expect(Math.round(minimisedDrawer!.width)).toBe(Math.round(dockedDrawer!.width));
    expect(Math.round(minimisedDrawer!.x + minimisedDrawer!.width)).toBe(
      Math.round(expandedDrawer!.x + expandedDrawer!.width),
    );

    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    for (let frame = 0; frame < 6; frame++) {
      await page.waitForTimeout(60);
      await expectContentToFollowDrawerInsets(page, `workspace close frame ${frame}`);
    }
  });
});

/** Past chats open with older groups collapsed, so a test that needs two
 * different conversations expands every group first. */
const expandAllChatGroups = async (page: Page) => {
  const toggles = chatDrawer(page).locator('.chat-drawer-group-toggle');
  for (const toggle of await toggles.all())
    if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
  return chatDrawer(page).getByRole('button', {name: /Open chat:/});
};

async function openChatListSubmenu(drawer: Locator, section: 'Group by' | 'Sort by' | 'Order' | 'Filter'): Promise<Locator> {
  const menu = drawer.getByRole('menu', {name: 'Chat list options'});
  if (!await menu.isVisible()) await drawer.getByRole('button', {name: 'Arrange'}).click();
  await menu.getByRole('menuitem', {name: section, exact: true}).hover();
  const submenu = drawer.getByRole('menu', {name: section, exact: true});
  await expect(submenu).toBeVisible();
  return submenu;
}

async function chooseChatListOption(
  drawer: Locator,
  section: 'Group by' | 'Sort by' | 'Order' | 'Filter',
  option: string,
): Promise<void> {
  const submenu = await openChatListSubmenu(drawer, section);
  await submenu.getByRole('menuitemradio', {name: option, exact: true}).click();
}

test.describe('chat drawer', () => {
  async function expectProfileRowPinnedToDrawerFloor(drawer: Locator, options?: {connections?: boolean}) {
    const footer = drawer.locator('.chat-drawer-footer');
    const body = drawer.locator('.chat-drawer-body');
    const profile = drawer.getByRole('button', {name: 'Sign in'});
    const devices = drawer.getByRole('button', {name: 'Devices', exact: true});
    const settings = drawer.getByRole('button', {name: 'Settings'});
    const connections = drawer.getByRole('button', {name: 'Connections'});
    await expect(footer).toBeVisible();
    await expect(body).toBeVisible();
    await expect(profile).toBeVisible();
    await expect(devices).toBeVisible();
    await expect(settings).toBeVisible();
    const drawerBox = (await drawer.boundingBox())!;
    const bodyBox = (await body.boundingBox())!;
    const footerBox = (await footer.boundingBox())!;
    const profileBox = (await profile.boundingBox())!;
    const devicesBox = (await devices.boundingBox())!;
    const settingsBox = (await settings.boundingBox())!;
    expect(footerBox.y + footerBox.height).toBeGreaterThan(drawerBox.y + drawerBox.height - 24);
    expect(bodyBox.height).toBeGreaterThan(footerBox.height);
    if (options?.connections === false) {
      await expect(connections).toHaveCount(0);
      expect(bodyBox.y + bodyBox.height).toBeLessThanOrEqual(footerBox.y + 1);
    } else {
      await expect(connections).toBeVisible();
      const connectionsBox = (await connections.boundingBox())!;
      expect(bodyBox.y + bodyBox.height).toBeLessThanOrEqual(connectionsBox.y + 1);
      const ruleGap = footerBox.y - (connectionsBox.y + connectionsBox.height);
      expect(Math.abs(ruleGap - 8)).toBeLessThan(1);
    }
    await expect(footer).toHaveCSS('padding-top', '8px');
    expect(profileBox.x).toBeLessThan(devicesBox.x);
    expect(devicesBox.x).toBeLessThan(settingsBox.x);
    expect(profileBox.y).toBeGreaterThan(bodyBox.y);
    const profileToDevices = devicesBox.x - (profileBox.x + profileBox.width);
    expect(profileToDevices).toBeGreaterThanOrEqual(0);
    expect(profileToDevices).toBeLessThan(12);
    expect(profileBox.width).toBeGreaterThan(devicesBox.width * 2);
  }

  test('stretches the profile highlight across the footer slot', async ({page}) => {
    await page.goto('/');
    const drawer = chatDrawer(page);
    const footer = drawer.locator('.chat-drawer-footer');
    const profile = drawer.getByRole('button', {name: 'Sign in'});
    const devices = drawer.getByRole('button', {name: 'Devices', exact: true});
    const name = drawer.locator('.chat-drawer-profile-name');
    await expect(profile).toBeVisible();
    const footerBox = (await footer.boundingBox())!;
    const profileBox = (await profile.boundingBox())!;
    const nameBox = (await name.boundingBox())!;
    const devicesBox = (await devices.boundingBox())!;
    expect(profileBox.width).toBeGreaterThan(nameBox.width + 40);
    expect(devicesBox.x - (profileBox.x + profileBox.width)).toBeGreaterThanOrEqual(0);
    expect(devicesBox.x - (profileBox.x + profileBox.width)).toBeLessThan(12);
    expect(profileBox.y).toBeGreaterThan(footerBox.y + 4);
    await profile.hover();
    await expect(profile).toHaveCSS('background-color', 'rgba(217, 217, 217, 0.6)');
    const avatar = drawer.locator('.chat-drawer-profile-avatar');
    const hoveredProfile = (await profile.boundingBox())!;
    const avatarBox = (await avatar.boundingBox())!;
    const leftInset = avatarBox.x - hoveredProfile.x;
    const topInset = avatarBox.y - hoveredProfile.y;
    const bottomInset = hoveredProfile.y + hoveredProfile.height - (avatarBox.y + avatarBox.height);
    expect(leftInset).toBeGreaterThan(4);
    expect(leftInset).toBeLessThan(7);
    expect(Math.abs(leftInset - topInset)).toBeLessThan(1.5);
    expect(Math.abs(leftInset - bottomInset)).toBeLessThan(1.5);
    const connections = drawer.getByRole('button', {name: 'Connections'});
    const connectionsIcon = connections.locator('svg');
    const connectionsSlot = connections.locator('.chat-drawer-connections-icon');
    const connectionsLabel = connections.locator('span:not(.chat-drawer-connections-icon)');
    const connectionsIconBox = (await connectionsIcon.boundingBox())!;
    const connectionsSlotBox = (await connectionsSlot.boundingBox())!;
    const connectionsLabelBox = (await connectionsLabel.boundingBox())!;
    const devicesIconBox = (await devices.locator('svg').boundingBox())!;
    const connectionsIconCenter = connectionsIconBox.x + connectionsIconBox.width / 2;
    const avatarCenter = avatarBox.x + avatarBox.width / 2;
    expect(Math.abs(connectionsIconCenter - avatarCenter)).toBeLessThan(1);
    expect(Math.abs(connectionsLabelBox.x - nameBox.x)).toBeLessThan(2);
    expect(Math.abs((connectionsLabelBox.x - connectionsSlotBox.x - connectionsSlotBox.width) - 8)).toBeLessThan(2);
    expect(Math.abs(connectionsIconBox.width - devicesIconBox.width)).toBeLessThan(1);
    await expect(connectionsIcon).toHaveAttribute('stroke-width', '1.5');
    await expect(devices.locator('svg')).toHaveAttribute('stroke-width', '1.5');
    await connections.hover();
    await expect(connections).toHaveCSS('background-color', 'rgba(217, 217, 217, 0.6)');
    await expect(connections).toHaveCSS('border-radius', '10px');
    const hoveredConnections = (await connections.boundingBox())!;
    expect(hoveredConnections.width).toBeGreaterThan(connectionsLabelBox.width + 40);
    expect(hoveredConnections.y + hoveredConnections.height).toBeLessThan(footerBox.y);
    await devices.hover();
    await expect(devices).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  });

  test('uses official Google and Apple marks on the sign-in dialog', async ({page}) => {
    await page.goto('/');
    await chatDrawer(page).getByRole('button', {name: 'Sign in'}).click();
    const dialog = page.getByRole('dialog', {name: 'Welcome back'});
    const google = dialog.getByRole('button', {name: 'Continue with Google'});
    const apple = dialog.getByRole('button', {name: 'Continue with Apple'});
    await expect(google.locator('img')).toBeVisible();
    await expect(google.locator('[data-icon="google"]')).toHaveCount(0);
    await expect(apple.locator('.account-brand-apple')).toBeVisible();
    await expect(apple.locator('[data-icon="apple"]')).toHaveCount(0);
    const googleMark = google.locator('img');
    const googleLabel = google.locator('span');
    const googleMarkBox = (await googleMark.boundingBox())!;
    const googleLabelBox = (await googleLabel.boundingBox())!;
    expect(Math.abs((googleMarkBox.y + googleMarkBox.height / 2) - (googleLabelBox.y + googleLabelBox.height / 2))).toBeLessThan(3);
    await page.locator('html').evaluate((node) => node.setAttribute('data-theme', 'dark'));
    await expect(apple.locator('.account-brand-apple')).toHaveCSS('background-color', 'rgb(222, 222, 222)');
    await dialog.getByRole('button', {name: 'Close'}).click();
  });

  test('signed-in profile opens an account menu above the row', async ({page}) => {
    await page.goto('/');
    const drawer = chatDrawer(page);
    await drawer.getByRole('button', {name: 'Sign in'}).click();
    const dialog = page.getByRole('dialog', {name: 'Welcome back'});
    await dialog.getByRole('button', {name: 'Continue with Google'}).click();
    await expect(dialog).toHaveCount(0);

    const profile = drawer.getByRole('button', {name: 'Demo'});
    await expect(profile).toBeVisible();
    await profile.click();
    const menu = page.getByRole('menu', {name: 'Account'});
    await expect(menu).toBeVisible();
    await expect(profile).toHaveCSS('background-color', 'rgba(217, 217, 217, 0.6)');
    await menu.getByRole('menuitem', {name: 'Documentation', exact: true}).hover();
    await expect(profile).toHaveAttribute('aria-expanded', 'true');
    await expect(profile).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await profile.hover();
    await expect(profile).toHaveCSS('background-color', 'rgba(217, 217, 217, 0.6)');
    await expect(menu.getByText('owner@example.com')).toBeVisible();
    for (const item of ['Language', 'Documentation', 'Report bug', 'Contact us', 'Switch account', 'Sign out'])
      await expect(menu.getByRole('menuitem', {name: item})).toBeVisible();
    await expect(menu.getByRole('menuitem', {name: 'Help'})).toHaveCount(0);
    await expect(menu.getByRole('menuitem', {name: 'Report bug'}).locator('[data-icon="bug"]')).toBeVisible();
    const profileBox = (await profile.boundingBox())!;
    const menuBox = (await menu.boundingBox())!;
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(profileBox.y + 2);
    const insets = await page.evaluate(() => {
      const drawer = document.querySelector('.chat-drawer')!;
      const panel = document.querySelector('.chat-drawer-profile-menu')!;
      const drawerBox = drawer.getBoundingClientRect();
      const panelBox = panel.getBoundingClientRect();
      return {left: panelBox.left - drawerBox.left, right: drawerBox.right - panelBox.right};
    });
    expect(insets.left).toBeGreaterThanOrEqual(MENU_EDGE_MARGIN - 0.5);
    expect(insets.right).toBeGreaterThanOrEqual(MENU_EDGE_MARGIN - 0.5);
    expect(Math.abs(insets.left - insets.right)).toBeLessThan(2);

    await menu.getByRole('menuitem', {name: 'Language'}).click();
    const languages = page.getByRole('menu', {name: 'Language'});
    await expect(languages).toBeVisible();
    const languageList = languages.locator('.language-menu-list');
    const languageSearch = languages.getByRole('searchbox', {name: 'Search languages'});
    await expect(languageSearch).toBeVisible();
    expect(await languageList.evaluate((node) => getComputedStyle(node).overflowY)).toBe('auto');
    expect(await languageList.evaluate((node) => getComputedStyle(node).scrollbarWidth)).toBe('none');
    // Exactly five 28px rows: enough to browse without the submenu matching the
    // full catalogue, and a whole number of them so the resting view ends on a
    // row edge rather than on the blank half of a clipped sixth.
    expect((await languageList.boundingBox())!.height).toBe(140);
    expect((await languageList.boundingBox())!.height % 28).toBe(0);
    await expect(languageList).toHaveClass(/at-top/);
    await expect(languageList).not.toHaveClass(/at-bottom/);

    await expect(languages.getByRole('button', {name: 'Clear search'})).toHaveCount(0);
    await languageSearch.fill('ja');
    await expect(languages.getByRole('menuitemradio')).toHaveText(['日本語']);
    const languageClear = languages.getByRole('button', {name: 'Clear search'});
    await expect(languageClear).not.toHaveAttribute('data-tooltip-label', /.*/);
    await expect(languageClear).not.toHaveAttribute('title', /.*/);
    await languageClear.click();
    await expect(languageSearch).toHaveValue('');
    await expect(languageSearch).toBeFocused();
    await languageSearch.fill('nothing here');
    await expect(languages.getByRole('menuitemradio')).toHaveCount(0);
    await expect(languages).toContainText('No language matches that search.');
    await languageSearch.fill('');
    await expect(languages.getByRole('menuitemradio', {name: 'System'})).toBeVisible();
    const languageInsets = await page.evaluate((edge) => {
      const drawer = document.querySelector('.chat-drawer')!;
      const main = document.querySelector('.chat-drawer-profile-menu')!;
      const panel = document.querySelector('.chat-drawer-profile-submenu')!;
      const drawerBox = drawer.getBoundingClientRect();
      const mainBox = main.getBoundingClientRect();
      const panelBox = panel.getBoundingClientRect();
      return {
        width: panelBox.width,
        mainWidth: mainBox.width,
        left: panelBox.left - drawerBox.left,
        right: drawerBox.right - panelBox.right,
        beside: panelBox.left >= mainBox.right - 1 || panelBox.right <= mainBox.left + 1,
        onScreen: panelBox.left >= edge - 0.5 && panelBox.right <= window.innerWidth - (edge - 0.5)
          && panelBox.top >= edge - 0.5 && panelBox.bottom <= window.innerHeight - (edge - 0.5),
      };
    }, MENU_EDGE_MARGIN);
    expect(languageInsets.width).toBeCloseTo(languageInsets.mainWidth, 0);
    expect(languageInsets.onScreen).toBe(true);
    if (languageInsets.beside) {
      expect(languageInsets.width).toBeCloseTo(languageInsets.mainWidth, 0);
    } else {
      expect(Math.abs(languageInsets.left - languageInsets.right)).toBeLessThan(2);
    }
    const languagePanel = page.locator('.chat-drawer-profile-submenu');
    await expect(languagePanel.getByRole('menuitemradio', {name: 'System'})).toHaveAttribute('aria-checked', 'true');
    await languagePanel.getByRole('menuitemradio', {name: 'Français'}).click();
    await expect(languagePanel.getByRole('menuitemradio', {name: 'Français'})).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.chat-drawer-profile-menu')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await languagePanel.getByRole('menuitemradio', {name: 'English'}).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.keyboard.press('Escape');
    await expect(languagePanel).toHaveCount(0);
    await expect(menu).toBeVisible();

    await page.evaluate(() => {
      window.open = ((url?: string | URL) => {
        (window as unknown as {__opened: string}).__opened = String(url ?? '');
        return null;
      }) as typeof window.open;
    });
    await menu.getByRole('menuitem', {name: 'Documentation'}).click();
    await expect(menu).toHaveCount(0);
    await expect(page.locator('iframe.browser-frame')).toHaveAttribute('src', 'https://polymux.com/docs/');
    expect(await page.evaluate(() => (window as unknown as {__opened?: string}).__opened)).toBeUndefined();

    await profile.click();
    const accountMenu = page.getByRole('menu', {name: 'Account'});
    await accountMenu.getByRole('menuitem', {name: 'Switch account'}).click();
    const switcher = page.getByRole('menu', {name: 'Switch account'});
    await expect(switcher.getByRole('menuitem', {name: 'Add another account'})).toBeVisible();
    await switcher.getByRole('menuitem', {name: 'Add another account'}).click();
    await expect(page.getByRole('dialog', {name: 'Welcome back'})).toBeVisible();
    await page.getByRole('dialog', {name: 'Welcome back'}).getByRole('textbox', {name: 'Email'}).fill('alt@example.com');
    await page.getByRole('dialog', {name: 'Welcome back'}).locator('#account-signin-password').fill('secret-secret');
    await page.getByRole('dialog', {name: 'Welcome back'}).getByRole('button', {name: 'Sign in', exact: true}).click();
    await expect(page.getByRole('dialog', {name: 'Welcome back'})).toHaveCount(0);
    await expect(drawer.getByRole('button', {name: 'alt'})).toBeVisible();

    await drawer.getByRole('button', {name: 'alt'}).click();
    await page.getByRole('menu', {name: 'Account'}).getByRole('menuitem', {name: 'Switch account'}).click();
    const afterAdd = page.getByRole('menu', {name: 'Switch account'});
    await expect(afterAdd.getByRole('menuitem', {name: 'owner@example.com'})).toBeVisible();
    await afterAdd.getByRole('menuitem', {name: 'owner@example.com'}).click();
    await expect(drawer.getByRole('button', {name: 'Demo'})).toBeVisible();

    await drawer.getByRole('button', {name: 'Demo'}).click();
    await page.getByRole('menu', {name: 'Account'}).getByRole('menuitem', {name: 'Sign out'}).click();
    await expect(drawer.getByRole('button', {name: 'Sign in'})).toBeVisible();
  });

  test('hides the account menu as soon as a pointer presses outside it', async ({page}) => {
    await page.setViewportSize({width: 1300, height: 800});
    await page.goto('/');
    const drawer = chatDrawer(page);
    await drawer.getByRole('button', {name: 'Sign in'}).click();
    await page.getByRole('dialog', {name: 'Welcome back'}).getByRole('button', {name: 'Continue with Google'}).click();

    const profile = drawer.getByRole('button', {name: 'Demo'});
    const menu = page.getByRole('menu', {name: 'Account'});
    async function openAccountMenu() {
      await profile.click();
      await expect(menu).toBeVisible();
    }

    await openAccountMenu();
    const [drawerBox, handleBox] = await Promise.all([
      drawer.boundingBox(),
      page.getByRole('button', {name: 'Resize Chats'}).boundingBox(),
    ]);
    expect(drawerBox).not.toBeNull();
    expect(handleBox).not.toBeNull();
    await page.mouse.move(drawerBox!.x + drawerBox!.width - .5, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();
    await expect(menu).toHaveCount(0);
    await page.mouse.up();

    await openAccountMenu();
    const separator = (await menu.locator('[role="separator"]').first().boundingBox())!;
    await page.mouse.move(separator.x + separator.width / 2, separator.y + separator.height / 2);
    await page.mouse.down();
    await expect(menu).toHaveCount(0);
    await page.mouse.up();

    await openAccountMenu();
    await page.locator('main').click({position: {x: 400, y: 200}});
    await expect(menu).toHaveCount(0);
  });

  test('pins the profile row to the drawer floor with devices and settings on the right', async ({page}) => {
    const drawer = chatDrawer(page);

    await page.goto('/');
    await expectProfileRowPinnedToDrawerFloor(drawer);
    await expect(page.locator('.top-controls').getByRole('button', {name: 'Settings'})).toHaveCount(0);
    await expect(page.locator('.top-controls').getByRole('button', {name: 'Devices', exact: true})).toHaveCount(0);

    await page.goto('/?coldStart=0');
    await expectProfileRowPinnedToDrawerFloor(drawer);

    await page.goto('/?coldStart=0&team=empty');
    await drawer.getByRole('button', {name: 'Team', exact: true}).click();
    await expect(drawer.getByText('No bots yet')).toBeVisible();
    await expectProfileRowPinnedToDrawerFloor(drawer);
  });

  test('opens Connections from the labeled drawer strip', async ({page}) => {
    await page.goto('/');
    const drawer = chatDrawer(page);
    const connections = drawer.getByRole('button', {name: 'Connections'});
    await expect(connections).toBeVisible();
    await expect(connections.locator('[data-icon="connections"]')).toBeVisible();
    await connections.click();
    await expect(page.locator('main')).toHaveClass(/workspace-expanded/);
    await expect(page.locator('.workspace-drawer .tab.active')).toContainText('Connections');
    const view = page.getByRole('region', {name: 'Connections'});
    await expect(view.getByRole('heading', {name: 'Connections', exact: true})).toBeVisible();
    await expect(view.getByRole('tab')).toHaveCount(0);
    // The Connections surface is the marketplace directory now, so the
    // capability rail that used to sit here is a category strip and search.
    await expect(view.locator('.marketplace-directory')).toBeVisible();
    await expect(view.locator('.marketplace-chips')).toBeVisible();
    await expect(view.locator('.profile-switcher')).toHaveCount(0);
    await page.getByRole('button', {name: 'Close Connections'}).click();
    await drawer.getByRole('button', {name: 'Team', exact: true}).click();
    await expect(connections).toBeVisible();
    await expect(drawer.getByRole('button', {name: 'Sign in'})).toBeVisible();
    await connections.click();
    await expect(page.locator('.workspace-drawer .tab.active')).toContainText('Connections');
    await expect(page.getByRole('region', {name: 'Connections'})).toBeVisible();
    await page.getByRole('button', {name: 'Close Connections'}).click();
    await drawer.getByRole('button', {name: 'Assistant', exact: true}).click();
    await expect(connections).toBeVisible();
  });

  test('toggles Settings back to the previous workspace state', async ({page}) => {
    await page.goto('/');
    const settingsButton = chatDrawer(page).getByRole('button', {name: 'Settings', exact: true});
    await settingsButton.click();
    await expect(page.locator('main')).toHaveClass(/workspace-expanded/);
    await expect(page.locator('.workspace-drawer .tab.active')).toContainText('Settings');
    await expect(page.locator('.workspace-drawer .tab')).toHaveCount(1);

    await settingsButton.click();
    await expect(page.locator('main')).not.toHaveClass(/workspace-expanded/);
    await expect(page.locator('main')).not.toHaveClass(/workspace-open/);

    await settingsButton.click();
    await expect(page.locator('main')).toHaveClass(/workspace-expanded/);
    await page.locator('.workspace-drawer').getByLabel('New tab', {exact: true}).click();
    await page.locator('.workspace-launcher').getByRole('button', {name: 'Hub'}).click();
    await expect(page.locator('.workspace-drawer .tab.active')).toContainText('Hub');
    await expect(page.locator('.workspace-drawer .tab')).toHaveCount(2);

    await settingsButton.click();
    await expect(page.locator('.workspace-drawer .tab.active')).toContainText('Settings');
    await expect(page.locator('main')).toHaveClass(/workspace-expanded/);
    await expect(page.locator('.workspace-drawer .tab')).toHaveCount(2);

    await settingsButton.click();
    await expect(page.locator('main')).toHaveClass(/workspace-expanded/);
    await expect(page.locator('.workspace-drawer .tab.active')).toContainText('Hub');

    await page.getByRole('button', {name: 'Minimise Workspace'}).click();
    await expect(page.locator('main')).not.toHaveClass(/workspace-expanded/);
    await expect(page.locator('.workspace-drawer')).toHaveCSS('width', '480px');

    await settingsButton.click();
    await expect(page.locator('main')).toHaveClass(/workspace-expanded/);
    await expect(page.locator('.workspace-drawer .tab.active')).toContainText('Settings');

    await settingsButton.click();
    await expect(page.locator('main')).not.toHaveClass(/workspace-expanded/);
    await expect(page.locator('main')).toHaveClass(/workspace-open/);
    await expect(page.locator('.workspace-drawer')).toHaveCSS('width', '480px');
    await expect(page.locator('.workspace-drawer .tab.active')).toContainText('Hub');
  });

  test('Settings drills down at the workspace drawer minimum width', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Settings'}).click();
    await page.getByRole('button', {name: 'Minimise Workspace'}).click();
    const drawer = page.locator('.workspace-drawer');
    await expect(drawer).not.toHaveClass(/expanded/);
    await expect(drawer).toHaveCSS('width', '480px');

    const settings = page.getByRole('region', {name: 'Settings'});
    await expect(settings.getByRole('heading', {name: 'Appearance'})).toBeVisible();
    await expect(settings.getByRole('button', {name: 'Back to Settings'})).toBeVisible();
    await expect(settings.getByRole('button', {name: 'Back to Settings'})).toHaveText('');
    await expect(settings.getByRole('tab', {name: 'Connections'})).toHaveCount(0);
    const overflow = await settings.evaluate((node) => node.scrollWidth > node.clientWidth + 1);
    expect(overflow).toBe(false);
    await expect(settings.getByRole('radiogroup', {name: 'Theme'})).toBeVisible();
    await expect(settings.getByRole('heading', {name: 'Appearance'})).toBeVisible();
    await expect(settings.getByRole('heading', {name: 'Account'})).toHaveCount(0);
    await expect(settings.getByRole('button', {name: 'Sign in'})).toHaveCount(0);

    await settings.getByRole('button', {name: 'Back to Settings'}).click();
    await expect(settings.getByRole('tab', {name: 'Appearance'})).toBeVisible();
    await expect(settings.getByRole('tab', {name: 'Connections'})).toHaveCount(0);
    await expect(settings.getByRole('heading', {name: 'Appearance'})).toHaveCount(0);
    await expect(settings.getByRole('button', {name: 'Back to Settings'})).toHaveCount(0);
    await settings.getByRole('tab', {name: 'Models', exact: true}).click();
    await expect(settings.getByRole('heading', {name: 'Models', exact: true})).toBeVisible();
    await expect(settings.getByRole('button', {name: 'Back to Settings'})).toBeVisible();
    const agentOverflow = await settings.evaluate((node) => node.scrollWidth > node.clientWidth + 1);
    expect(agentOverflow).toBe(false);

    await page.getByRole('button', {name: 'Expand Workspace'}).click();
    await expect(settings.getByRole('heading', {name: 'Models', exact: true})).toBeVisible();
    await expect(settings.getByRole('tab', {name: 'Models', exact: true})).toBeVisible();
    await expect(settings.getByRole('button', {name: 'Back to Settings'})).toHaveCount(0);
  });

  test('Connections drills down at the workspace drawer minimum width', async ({page}) => {
    await page.goto('/');
    await chatDrawer(page).getByRole('button', {name: 'Connections'}).click();
    await page.getByRole('button', {name: 'Minimise Workspace'}).click();
    const drawer = page.locator('.workspace-drawer');
    await expect(drawer).not.toHaveClass(/expanded/);
    await expect(drawer).toHaveCSS('width', '480px');

    const view = page.getByRole('region', {name: 'Connections'});
    await expect(view.getByRole('heading', {name: 'Connections', exact: true})).toBeVisible();
    await expect(view.getByRole('searchbox', {name: 'Search skills, MCPs and plugins'})).toBeVisible();
    await expect(view.getByRole('tab')).toHaveCount(0);
    await expect(view.getByRole('button', {name: 'Back to Settings'})).toHaveCount(0);
    const overflow = await view.evaluate((node) => node.scrollWidth > node.clientWidth + 1);
    expect(overflow).toBe(false);

    await page.getByRole('button', {name: 'Expand Workspace'}).click();
    await expect(view.getByRole('heading', {name: 'Connections', exact: true})).toBeVisible();
    await expect(view.getByRole('searchbox', {name: 'Search skills, MCPs and plugins'})).toBeVisible();
  });

  test('opens bot editing from the highlighted identity header', async ({page}) => {
    await page.goto('/?coldStart=0');
    await chatDrawer(page).getByRole('button', {name: 'Team', exact: true}).click();
    await chatDrawer(page).getByRole('button', {name: /Open Maya, Product researcher/}).click();
    const identity = page.getByRole('button', {name: 'Edit bot Maya'});
    await expect(identity).toContainText('Product researcher');
    for (const theme of ['light', 'dark']) {
      await page.locator('html').evaluate((html, value) => html.setAttribute('data-theme', value), theme);
      await identity.hover();
      await expect(identity).toHaveCSS('background-color', theme === 'light' ? 'rgb(243, 243, 243)' : 'rgb(42, 42, 42)');
    }
    await identity.click();
    const editor = workspaceDrawer(page).getByRole('region', {name: 'Edit Maya'});
    await expect(editor).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);
    await identity.focus();
    await identity.press('Enter');
    await expect(editor).toBeVisible();
  });

  test('creates a bot from the To: bar and opens its editor from the empty conversation', async ({page}) => {
    await page.goto('/?coldStart=0');
    const drawer = chatDrawer(page);
    await drawer.getByRole('button', {name: 'Team', exact: true}).click();
    const addChat = drawer.getByRole('button', {name: 'New chat', exact: true});
    await addChat.click();

    // The chooser is the To: band in the title bar, not a dialog, and its rows
    // carry their shortcuts.
    const bar = page.locator('.team-new-chat-bar');
    await expect(bar).toBeVisible();
    const search = bar.getByRole('textbox', {name: 'Search or create Bots'});
    await expect(search).toBeFocused();
    await expect(bar.getByRole('button', {name: 'Create new Bot'})).toHaveAttribute('aria-keyshortcuts', /\+1$/);
    await expect(bar.getByRole('button', {name: 'Create group chat'})).toHaveAttribute('aria-keyshortcuts', /\+2$/);
    await expect(bar.getByRole('button', {name: 'Open Maya'})).toHaveAttribute('aria-keyshortcuts', /\+3$/);
    // Clicking away leaves the mode. Focus is not pulled back to the +: the
    // click belongs to whatever the user pointed at.
    await page.getByRole('heading', {name: 'Chats', level: 2}).click();
    await expect(bar).toHaveCount(0);

    await addChat.click();
    await page.locator('.team-new-chat-bar').getByRole('button', {name: 'Create new Bot', exact: true}).click();

    // A bot appears named New Chat with no role, so the pane offers the editor.
    await expect(bar).toHaveCount(0);
    const pane = page.getByRole('region', {name: 'Conversation with New Chat', exact: true});
    const emptyIdentity = pane.getByRole('button', {name: 'Edit New Chat', exact: true});
    await expect(emptyIdentity).toBeVisible();
    await expect(emptyIdentity).toContainText('Message New Chat');

    // The editor is a workspace page, opened expanded over whatever was there.
    await expect(page.locator('main')).not.toHaveClass(/workspace-expanded/);
    await emptyIdentity.click();
    const editor = workspaceDrawer(page).getByRole('region', {name: 'Edit New Chat', exact: true});
    await expect(editor).toBeVisible();
    await expect(page.locator('main')).toHaveClass(/workspace-expanded/);
    await expect(editor.getByRole('textbox', {name: 'Name', exact: true})).toHaveValue('New Chat');

    // Closing the page hands the workspace back.
    await editor.getByRole('button', {name: 'Close', exact: true}).click();
    await expect(editor).toHaveCount(0);
    await expect(page.locator('main')).not.toHaveClass(/workspace-expanded/);
  });

  test('restores each section conversation and expanded workspace', async ({page}) => {
    await page.goto('/?coldStart=0');
    const drawer = chatDrawer(page);
    const rows = await expandAllChatGroups(page);
    const assistantName = await rows.first().getAttribute('aria-label');
    await rows.first().click();
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    await workspaceDrawer(page).getByRole('button', {name: 'Drive', exact: true}).click();
    await page.getByRole('button', {name: 'Expand Workspace'}).click();

    await drawer.getByRole('button', {name: 'Team', exact: true}).click();
    await drawer.getByRole('button', {name: /Open Maya, Product researcher/}).click();
    await expect(page.getByRole('textbox', {name: 'Message Maya'})).toBeVisible();
    await expect(page.locator('main')).not.toHaveClass(/workspace-expanded/);
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    await workspaceDrawer(page).getByRole('button', {name: 'Hub', exact: true}).click();

    for (let round = 0; round < 2; round++) {
      await drawer.getByRole('button', {name: 'Assistant', exact: true}).click();
      await expect(drawer.getByRole('button', {name: assistantName!, exact: true})).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('main')).toHaveClass(/workspace-expanded/);
      await expect(workspaceDrawer(page).locator('.tab.active')).toContainText('Drive');
      await drawer.getByRole('button', {name: 'Team', exact: true}).click();
      await expect(page.getByRole('textbox', {name: 'Message Maya'})).toBeVisible();
      await expect(page.locator('main')).not.toHaveClass(/workspace-expanded/);
      await expect(workspaceDrawer(page).locator('.tab.active')).toContainText('Hub');
    }
  });

  test('matches the static Team Chats label to Assistant Chats', async ({page}) => {
    await page.goto('/?coldStart=0');
    const drawer = chatDrawer(page);
    const assistantChats = drawer.getByRole('button', {name: 'Chats', exact: true});
    const assistantStyle = await assistantChats.evaluate((node) => {
      const style = getComputedStyle(node);
      return {fontSize: style.fontSize, fontWeight: style.fontWeight, color: style.color};
    });

    await drawer.getByRole('button', {name: 'Team', exact: true}).click();
    const teamChats = drawer.getByRole('heading', {name: 'Chats', level: 2});
    await expect(drawer.getByRole('button', {name: 'Chats', exact: true})).toHaveCount(0);
    await expect(teamChats.locator('[data-icon="chevron"]')).toHaveCount(0);
    expect(await teamChats.evaluate((node) => {
      const style = getComputedStyle(node);
      return {fontSize: style.fontSize, fontWeight: style.fontWeight, color: style.color};
    })).toEqual(assistantStyle);
    await expect(drawer.locator('.chat-drawer-team-row')).toHaveCount(3);
  });

  test('stays in the Team view after deleting the last bot', async ({page}) => {
    await page.goto('/?coldStart=0');
    page.on('dialog', (dialog) => void dialog.accept());
    const drawer = chatDrawer(page);

    await drawer.getByRole('button', {name: 'Team', exact: true}).click();
    await expect(drawer.locator('.chat-drawer-team-row')).toHaveCount(3);

    for (const name of ['Maya', 'Linus']) {
      await drawer.getByRole('button', {name: `Options for ${name}`}).click();
      await drawer.getByRole('menu', {name: `Options for ${name}`}).getByRole('menuitem', {name: 'Delete'}).click();
      await expect(drawer.getByRole('button', {name: `Options for ${name}`})).toHaveCount(0);
    }
    await expect(drawer.locator('.chat-drawer-team-row')).toHaveCount(1);

    await drawer.getByRole('button', {name: /Open Sol, /}).click();
    await expect(drawer.getByRole('button', {name: 'Team', exact: true})).toHaveAttribute('aria-current', 'page');

    await drawer.getByRole('button', {name: 'Options for Sol'}).click();
    await drawer.getByRole('menu', {name: 'Options for Sol'}).getByRole('menuitem', {name: 'Delete'}).click();

    await expect(drawer.getByRole('button', {name: 'Team', exact: true})).toHaveAttribute('aria-current', 'page');
    await expect(drawer.locator('.chat-drawer-team-row')).toHaveCount(0);
    await expect(page.getByRole('region', {name: 'Conversation with Sol'})).toHaveCount(0);
  });

  test('switches between Assistant chats, Team groups, and individual agents', async ({page}) => {
    await page.goto('/?coldStart=0');
    const drawer = chatDrawer(page);
    const assistant = drawer.getByRole('button', {name: 'Assistant', exact: true});
    const team = drawer.getByRole('button', {name: 'Team', exact: true});
    await expect(assistant).toHaveAttribute('aria-current', 'page');
    expect(await assistant.evaluate((node) => getComputedStyle(node).fontSize))
      .toBe(await team.evaluate((node) => getComputedStyle(node).fontSize));

    await team.click();
    await expect(team).toHaveAttribute('aria-current', 'page');
    await expect(drawer.locator('.chat-drawer-team-row')).toHaveCount(3);
    await expect(drawer.locator('.chat-drawer-team-group-row')).toHaveCount(1);
    await expect(drawer.locator('.chat-drawer-group')).toHaveCount(0);
    await expect(drawer.getByText('Groups', {exact: true})).toBeVisible();
    await expect(drawer.getByRole('heading', {name: 'Chats', level: 2})).toBeVisible();
    await expect(drawer.getByText('Launch room', {exact: true})).toBeVisible();
    await expect(drawer.getByText('Two claims still need primary sources.', {exact: true})).toBeVisible();
    await expect(drawer.getByText('Maya', {exact: true})).toBeVisible();
    await expect(drawer.getByText('Product researcher', {exact: true})).toBeVisible();
    await expect(drawer.getByText('Comparing the latest primary sources.', {exact: true})).toBeVisible();
    await expect(drawer.getByRole('img', {name: 'Maya avatar'})).toHaveAttribute('data-bloub-expression', 'attentive');
    await expect(drawer.getByRole('img', {name: 'Maya avatar'})).toHaveAttribute('data-bloub-activity', 'working');

    const launchRow = drawer.locator('.chat-drawer-team-group-row', {hasText: 'Launch room'});
    const groupAvatarTreatment = () => launchRow.evaluate((row) => {
      const avatar = row.querySelector('.team-group-avatar')!;
      const people = [...avatar.querySelectorAll<HTMLElement>('.team-group-avatar-person')];
      return {
        drawerBackground: getComputedStyle(row.closest('.chat-drawer')!).backgroundColor,
        rowBackground: getComputedStyle(row).backgroundColor,
        wrappers: people.map((person) => ({
          border: getComputedStyle(person).borderWidth,
          background: getComputedStyle(person).backgroundColor,
        })),
        paper: people.map((person) => getComputedStyle(person.querySelector('.bloub-paper')!).fill),
        centres: people.map((person) => {
          const bounds = person.getBoundingClientRect();
          return `${Math.round(bounds.x + bounds.width / 2)},${Math.round(bounds.y + bounds.height / 2)}`;
        }),
      };
    });
    await page.locator('html').evaluate((element) => element.setAttribute('data-theme', 'dark'));
    await page.waitForTimeout(180);
    const restingGroupAvatar = await groupAvatarTreatment();
    expect(restingGroupAvatar.paper).toEqual(Array(3).fill(restingGroupAvatar.drawerBackground));
    await launchRow.hover();
    await page.waitForTimeout(180);
    const hoveredGroupAvatar = await groupAvatarTreatment();
    expect(hoveredGroupAvatar.paper).toEqual(Array(3).fill(hoveredGroupAvatar.rowBackground));

    await drawer.getByRole('button', {name: 'Open group Launch room'}).click();
    const groupPane = page.getByRole('region', {name: 'Conversation with Launch room'});
    const groupTitle = page.locator('.team-conversation-title-bar');
    await expect(groupTitle).toHaveAttribute('aria-label', 'Conversation with Launch room');
    await expect(groupTitle.locator('strong')).toHaveText('Launch room');
    await expect(groupTitle.getByText('3 agents · Maya, Linus, Sol', {exact: true})).toBeVisible();
    await page.waitForTimeout(180);
    const selectedGroupAvatar = await groupAvatarTreatment();
    expect(selectedGroupAvatar.wrappers).toEqual([
      {border: '0px', background: 'rgba(0, 0, 0, 0)'},
      {border: '0px', background: 'rgba(0, 0, 0, 0)'},
      {border: '0px', background: 'rgba(0, 0, 0, 0)'},
    ]);
    expect(selectedGroupAvatar.paper).toEqual(Array(3).fill(selectedGroupAvatar.rowBackground));
    expect(new Set(selectedGroupAvatar.centres).size).toBe(3);
    await page.locator('html').evaluate((element) => element.setAttribute('data-theme', 'light'));
    await expect(groupPane.locator('.team-chat-message-row.human .message-content')).toContainText('What is still blocking launch?');
    const mayaGroupMessage = groupPane.locator('[data-team-speaker="team:maya"]');
    await expect(mayaGroupMessage).toContainText('Two claims still need primary sources.');
    const mayaOrigin = mayaGroupMessage.locator('.message-peer-origin');
    await expect(mayaOrigin.locator('strong')).toHaveText('Maya');
    await expect(mayaOrigin.locator('small')).toHaveCount(0);
    const mayaRole = mayaOrigin.locator('.role-badge');
    await expect(mayaRole).toHaveText('Product researcher');
    await expect(mayaRole).toHaveCSS('text-transform', 'none');
    await expect(mayaRole).toHaveCSS('background-color', 'rgb(237, 237, 237)');
    await expect(mayaRole).toHaveCSS('border-color', 'rgb(221, 221, 221)');
    await expect(mayaRole).toHaveCSS('color', 'rgb(93, 93, 93)');
    await page.locator('html').evaluate((element) => element.setAttribute('data-theme', 'dark'));
    await expect(mayaRole).toHaveCSS('background-color', 'rgb(41, 41, 41)');
    await expect(mayaRole).toHaveCSS('border-color', 'rgb(56, 56, 56)');
    await expect(mayaRole).toHaveCSS('color', 'rgb(176, 176, 176)');
    await page.locator('html').evaluate((element) => element.setAttribute('data-theme', 'light'));
    await expect(mayaOrigin).not.toContainText('Agent');
    await expect(groupPane.locator('[data-team-speaker="team:linus"]')).toContainText('The release build is green.');
    await expect(groupPane.getByRole('button', {name: 'Dictate message'})).toBeVisible();
    await expect(groupPane.getByRole('button', {name: 'More'})).toHaveCount(0);
    await expect(groupPane.getByRole('status', {name: 'Maya working'})).toBeVisible();
    await expect(page.getByRole('button', {name: 'Toggle Summary'})).toBeVisible();
    const groupWorkspace = page.getByRole('button', {name: 'Toggle Workspace'});
    await expect(groupWorkspace).toBeVisible();
    await groupWorkspace.click();
    await expect(workspaceDrawer(page)).toHaveClass(/open/);
    await groupWorkspace.click();
    await expect(workspaceDrawer(page)).not.toHaveClass(/open/);
    const groupComposer = groupPane.getByRole('textbox', {name: 'Message Launch room'});
    await groupComposer.fill('Post the final launch verdict here.');
    await groupComposer.press('Enter');
    await expect(groupPane.locator('.team-chat-message-row.human .message-content').last()).toContainText('Post the final launch verdict here.');

    const mayaConversation = drawer.getByRole('button', {name: /Open Maya, Product researcher/});
    const mayaOptions = drawer.getByRole('button', {name: 'Options for Maya'});
    await expect(drawer.getByRole('button', {name: 'More actions for Maya'})).toHaveCount(0);
    await mayaOptions.click();
    const botMenu = drawer.getByRole('menu', {name: 'Options for Maya'});
    await expect(botMenu.getByRole('menuitem')).toHaveText(['Edit', 'Delete']);
    await expect(mayaOptions).toHaveAttribute('aria-expanded', 'true');
    const teamRowChrome = await drawer.locator('.chat-drawer-team-row').first().evaluate((row) => {
      const rowStyle = getComputedStyle(row);
      const triggerStyle = getComputedStyle(row.querySelector('.chat-drawer-team-avatar-trigger')!);
      return {
        overflow: rowStyle.overflow,
        corners: [rowStyle.borderTopLeftRadius, rowStyle.borderTopRightRadius, rowStyle.borderBottomRightRadius, rowStyle.borderBottomLeftRadius],
        avatarBackground: triggerStyle.backgroundColor,
        avatarBackgroundImage: triggerStyle.backgroundImage,
        avatarShadow: triggerStyle.boxShadow,
      };
    });
    expect(teamRowChrome).toEqual({
      overflow: 'hidden',
      corners: ['10px', '10px', '10px', '10px'],
      avatarBackground: 'rgba(0, 0, 0, 0)',
      avatarBackgroundImage: 'none',
      avatarShadow: 'none',
    });
    await expect(mayaConversation).not.toHaveAttribute('aria-current', 'page');
    await mayaOptions.click();
    await expect(botMenu).toHaveCount(0);

    await mayaConversation.click();
    const teamPane = page.getByRole('region', {name: 'Conversation with Maya'});
    const teamTitle = page.locator('.team-conversation-title-bar');
    await expect(teamTitle).toHaveAttribute('aria-label', 'Conversation with Maya');
    await expect(teamTitle.locator('strong')).toHaveText('Maya');
    await expect(teamTitle.locator('span')).toHaveText('Product researcher · This Mac');
    // The header names the conversation and opens the bot editor. Its options
    // live on the drawer row, so no second menu hangs off the title bar.
    await expect(teamTitle.locator('[data-icon="ellipsis"]')).toHaveCount(0);
    await expect(teamTitle.getByRole('button', {name: 'Conversation options for Maya'})).toHaveCount(0);
    await expect(teamPane.locator('.team-chat-header')).toHaveCount(0);
    const titleTheme = () => teamTitle.evaluate((header) => {
      const name = getComputedStyle(header.querySelector('strong')!);
      const role = getComputedStyle(header.querySelector('span')!);
      return {
        name: name.color,
        role: role.color,
      };
    });
    await page.evaluate(() => document.documentElement.dataset.theme = 'light');
    expect(await titleTheme()).toEqual({
      name: 'rgb(10, 10, 10)',
      role: 'rgb(89, 89, 89)',
    });
    await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
    expect(await titleTheme()).toEqual({
      name: 'rgb(250, 250, 250)',
      role: 'rgb(193, 193, 193)',
    });
    await page.evaluate(() => document.documentElement.dataset.theme = 'light');
    const [titleBounds, identityBounds, roleBounds, threadBounds] = await Promise.all([
      teamTitle.boundingBox(),
      teamTitle.locator('.team-conversation-title').boundingBox(),
      teamTitle.locator('span').boundingBox(),
      teamPane.locator('.team-chat-thread').boundingBox(),
    ]);
    expect(identityBounds!.x - titleBounds!.x).toBe(16);
    // The identity button keeps its own 7px trailing padding, with no control
    // following it now that options moved to the drawer row.
    expect(identityBounds!.x + identityBounds!.width - (roleBounds!.x + roleBounds!.width)).toBe(7);
    expect(threadBounds!.y).toBe(titleBounds!.y + titleBounds!.height);
    await expect(teamPane.getByRole('textbox', {name: 'Message Maya'})).toBeVisible();
    await expect(teamPane.getByRole('status', {name: 'Maya is typing'}).locator('i')).toHaveCount(3);
    await expect(page.locator('.agent-activity')).toHaveCount(0);
    await expect(page.locator('.polymux-prompt-shell')).toHaveCount(0);
    await expect(page.locator('.conversation-title-bar')).toHaveCount(1);

    // Options belong to the drawer row, so the header keeps no menu of its own.
    await mayaOptions.hover();
    await expect(mayaOptions).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(mayaOptions).toHaveCSS('background-image', 'none');
    await expect(mayaOptions).toHaveCSS('box-shadow', 'none');
    await mayaOptions.click();
    await expect(mayaOptions).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const conversationMenu = drawer.getByRole('menu', {name: 'Options for Maya'});
    await expect(conversationMenu.getByRole('menuitem')).toHaveText(['Edit', 'Delete']);
    await page.keyboard.press('Escape');
    await expect(conversationMenu).toHaveCount(0);

    await mayaOptions.click();
    await drawer.getByRole('menu', {name: 'Options for Maya'}).getByRole('menuitem', {name: 'Edit'}).click();
    const editMaya = workspaceDrawer(page).getByRole('region', {name: 'Edit Maya'});
    const mayaHost = editMaya.getByRole('button', {name: 'Bot Host'});
    await expect(mayaHost).toContainText('This Mac');
    await mayaHost.click();
    await page.getByRole('menu', {name: 'Bot Host'}).getByRole('menuitemradio', {name: 'Studio Linux', exact: true}).click();
    await expect(editMaya).toContainText('Saving moves the bot, conversation and attachments to this Host.');
    await editMaya.getByRole('button', {name: 'Save'}).click();
    await expect(editMaya).toHaveCount(0);
    await expect(teamTitle.locator('span')).toContainText('Studio Linux');

    const peerRow = teamPane.locator('.team-chat-message-row.agent.peer');
    const peer = peerRow.locator('.message.peer');
    await expect(peerRow).toHaveAttribute('data-team-speaker', 'assistant:research');
    // A settled peer carries its identity in the origin line rather than an
    // avatar; avatars now mark only work in progress.
    await expect(peerRow.locator('.team-chat-avatar')).toHaveCount(0);
    await expect(peerRow).not.toHaveClass(/human/);
    await expect(peer).toContainText('Research notes');
    await expect(peer.locator('.message-peer-origin')).not.toContainText('Agent');
    await expect(peer.locator('.message-peer-origin i')).toHaveCount(0);
    await expect(peer.locator('.message-content')).toContainText('Please compare the onboarding findings');
    await expect(peer.getByRole('button', {name: 'Edit'})).toHaveCount(0);

    const teamComposer = teamPane.getByRole('textbox', {name: 'Message Maya'});
    const teamSend = teamPane.getByRole('button', {name: 'Send message'});
    await expect(teamPane.getByRole('button', {name: 'Dictate message'})).toBeVisible();
    await expect(teamSend).toHaveCount(0);
    await teamComposer.fill('Please continue checking.');
    await expect(teamPane.getByRole('button', {name: 'Dictate message'})).toHaveCount(0);
    await expect(teamSend).toBeEnabled();
    await expect(teamSend).toHaveAttribute('data-tooltip', 'none');
    await teamComposer.press('Enter');
    await expect(teamPane.locator('.team-chat-message-row.human .message-content').last()).toContainText('Please continue checking.');
    const liveAgent = teamPane.locator('.team-chat-message-row.agent .thinking').last();
    await expect(liveAgent).toHaveAttribute('aria-label', 'Maya is typing');
    const thinkingAvatar = teamPane.locator('.team-chat-message-row.agent [data-bloub-activity="thinking"]').last();
    await expect(thinkingAvatar).toBeVisible();
    expect(await thinkingAvatar.locator('.bloub-state-motion').evaluate((node) => getComputedStyle(node).animationName))
      .toContain('bloub-thinking-focus');
    expect(await thinkingAvatar.locator('.bloub-activity-ring').evaluate((node) => getComputedStyle(node).animationName))
      .toContain('bloub-thinking-orbit');
    await expect(page.locator('.agent-activity')).toHaveCount(0);

    await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
    await drawer.getByRole('button', {name: 'New chat', exact: true}).click();
    await page.locator('.team-new-chat-bar').getByRole('button', {name: 'Create new Bot', exact: true}).click();
    await page.getByRole('region', {name: 'Conversation with New Chat'}).getByRole('button', {name: 'Edit New Chat', exact: true}).click();
    const bot = workspaceDrawer(page).getByRole('region', {name: 'Edit New Chat', exact: true});
    const typography = await bot.evaluate((dialog) => {
      const read = (selector: string) => {
        const style = getComputedStyle(dialog.querySelector(selector)!);
        return {family: style.fontFamily, size: style.fontSize, weight: style.fontWeight};
      };
      const dialogFamily = getComputedStyle(dialog).fontFamily;
      const styles = {
        title: read('h2'),
        subtitle: read('header p'),
        fieldLabel: read('.team-identity-fields label > span'),
        field: read('.team-identity-fields input'),
        agent: read('.team-agent-menu .select-menu-trigger'),
        previewTitle: read('.team-avatar-preview strong'),
        previewDetail: read('.team-avatar-preview span'),
        settingTitle: read('.team-setting-row strong'),
        settingDetail: read('.team-setting-row small'),
        laptopAccess: read('.team-device-access-menu .select-menu-trigger'),
        footerButton: read('footer .team-cancel'),
      };
      return {
        styles,
        oneFamily: Object.values(styles).every(({family}) => family === dialogFamily),
      };
    });
    expect(typography.oneFamily).toBe(true);
    expect(typography.styles).toMatchObject({
      title: {size: '16px', weight: '590'},
      subtitle: {size: '11.5px', weight: '450'},
      fieldLabel: {size: '11px', weight: '600'},
      field: {size: '12px', weight: '450'},
      agent: {size: '12px', weight: '450'},
      previewTitle: {size: '12.5px', weight: '590'},
      previewDetail: {size: '10.5px', weight: '450'},
      settingTitle: {size: '12.5px', weight: '590'},
      settingDetail: {size: '10.5px', weight: '450'},
      laptopAccess: {size: '12px', weight: '450'},
      footerButton: {size: '11.5px', weight: '550'},
    });
    await expect(bot.locator('select')).toHaveCount(0);
    await expect(bot.getByRole('radio', {name: 'Polymux Built in', exact: true})).toHaveAttribute('aria-checked', 'true');
    await bot.getByRole('radio', {name: 'Claude Agent', exact: true}).click();
    await expect(bot.getByRole('radio', {name: 'Claude Agent', exact: true})).toHaveAttribute('aria-checked', 'true');
    await bot.getByRole('radio', {name: 'Polymux Built in', exact: true}).click();
    await expect(bot.locator('.team-avatar-choices.shapes button')).toHaveCount(9);
    const colours = bot.locator('.team-avatar-choices.colors > button[aria-pressed]');
    await expect(colours).toHaveCount(11);
    await expect(colours.first()).toHaveAttribute('aria-label', 'Ink in Light, Cream in Dark');
    await expect(colours.last()).toHaveAttribute('aria-label', 'Brown colour');
    await expect(colours.first()).toHaveAttribute('aria-pressed', 'true');
    await expect(colours.first()).toHaveCSS('background-image', /linear-gradient/);
    const previewTheme = bot.getByRole('radiogroup', {name: 'Avatar preview theme'});
    // Created from the To: bar, so the preview carries the chat's name.
    const previewAvatar = bot.getByRole('img', {name: 'New Chat avatar'});
    await expect(previewTheme.getByRole('radio', {name: 'Dark'})).toHaveAttribute('aria-checked', 'true');
    await expect(previewAvatar.locator('.bloub-body')).toHaveCSS('fill', 'rgb(241, 239, 233)');
    await previewTheme.getByRole('radio', {name: 'Light'}).click();
    await expect(previewTheme.getByRole('radio', {name: 'Light'})).toHaveAttribute('aria-checked', 'true');
    await expect(previewAvatar.locator('.bloub-body')).toHaveCSS('fill', 'rgb(10, 10, 12)');
    await expect(bot.locator('.team-avatar-preview')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await previewTheme.getByRole('radio', {name: 'Dark'}).click();
    const shapeOffsets = await bot.locator('.team-avatar-choices.shapes button').evaluateAll((buttons) =>
      buttons.map((button) => {
        const control = button.getBoundingClientRect();
        const shape = button.querySelector('svg')!.getBoundingClientRect();
        return {
          x: Math.abs(control.left + control.width / 2 - (shape.left + shape.width / 2)),
          y: Math.abs(control.top + control.height / 2 - (shape.top + shape.height / 2)),
        };
      }),
    );
    expect(shapeOffsets.every(({x, y}) => x <= .5 && y <= .5)).toBe(true);
    await expect(bot.getByText('Expression', {exact: true})).toHaveCount(0);
    await expect(bot.getByRole('button', {name: 'Expression'})).toHaveCount(0);
    await bot.getByRole('button', {name: 'Triangle shape'}).click();
    await bot.getByRole('button', {name: 'Violet colour'}).click();
    await expect(bot.getByRole('button', {name: 'Triangle shape'})).toHaveAttribute('aria-pressed', 'true');
    await expect(bot.getByRole('button', {name: 'Violet colour'})).toHaveAttribute('aria-pressed', 'true');
    await expect(colours.first()).toHaveAttribute('aria-pressed', 'false');
    await colours.first().click();
    await expect(colours.first()).toHaveAttribute('aria-pressed', 'true');
    const laptopAccess = bot.getByRole('button', {name: 'Access to This Mac', exact: true});
    await expect(laptopAccess).toContainText('Allowed');
    const laptopAccessLayout = await laptopAccess.evaluate((button) => {
      const box = button.getBoundingClientRect();
      const label = button.querySelector(':scope > span:not(.select-menu-icon)')!.getBoundingClientRect();
      const chevron = button.querySelector('[data-icon="chevron"]')!.getBoundingClientRect();
      return {
        labelToChevron: chevron.left - label.right,
        chevronRightInset: box.right - chevron.right,
        centreOffset: Math.abs(
          label.top + label.height / 2 - (chevron.top + chevron.height / 2),
        ),
      };
    });
    expect(laptopAccessLayout.labelToChevron).toBeGreaterThanOrEqual(8);
    expect(laptopAccessLayout.chevronRightInset).toBeGreaterThanOrEqual(8);
    expect(laptopAccessLayout.centreOffset).toBeLessThanOrEqual(1);
    const originalViewport = page.viewportSize()!;
    await page.setViewportSize({width: 640, height: 420});
    await laptopAccess.scrollIntoViewIfNeeded();
    await laptopAccess.click();
    const laptopAccessMenu = page.getByRole('menu', {name: 'Access to This Mac', exact: true});
    await expect(laptopAccessMenu.getByRole('menuitemradio')).toHaveText(['Allowed', 'Ask', 'Blocked']);
    const menuPlacement = await laptopAccessMenu.evaluate((menu) => {
      const menuBox = menu.getBoundingClientRect();
      const triggerBox = document.querySelector('.team-device-access-menu .select-menu-trigger')!.getBoundingClientRect();
      return {
        portaled: menu.parentElement === document.body,
        overlapsTrigger: !(
          menuBox.bottom <= triggerBox.top
          || menuBox.top >= triggerBox.bottom
          || menuBox.right <= triggerBox.left
          || menuBox.left >= triggerBox.right
        ),
        left: menuBox.left,
        top: menuBox.top,
        right: menuBox.right,
        bottom: menuBox.bottom,
      };
    });
    expect(menuPlacement.portaled).toBe(true);
    expect(menuPlacement.overlapsTrigger).toBe(false);
    expect(menuPlacement.left).toBeGreaterThanOrEqual(MENU_EDGE_MARGIN);
    expect(menuPlacement.top).toBeGreaterThanOrEqual(MENU_EDGE_MARGIN);
    expect(menuPlacement.right).toBeLessThanOrEqual(page.viewportSize()!.width - MENU_EDGE_MARGIN);
    expect(menuPlacement.bottom).toBeLessThanOrEqual(page.viewportSize()!.height - MENU_EDGE_MARGIN);
    await laptopAccessMenu.getByRole('menuitemradio', {name: 'Blocked', exact: true}).click();
    await expect(laptopAccess).toContainText('Blocked');
    await page.setViewportSize(originalViewport);
    const botHost = bot.getByRole('button', {name: 'Bot Host'});
    await expect(botHost).toContainText('This Mac');
    await botHost.click();
    await page.getByRole('menu', {name: 'Bot Host'}).getByRole('menuitemradio', {name: 'Studio Linux', exact: true}).click();
    await expect(botHost).toContainText('Studio Linux');
    await bot.getByRole('textbox', {name: 'Name'}).fill('Ari');
    await bot.getByRole('textbox', {name: 'Role'}).fill('Design reviewer');
    await bot.getByRole('button', {name: 'Save', exact: true}).click();
    await expect(bot).toHaveCount(0);
    await expect(drawer.getByText('Ari', {exact: true})).toBeVisible();
    await expect(drawer.getByText('Design reviewer', {exact: true})).toBeVisible();
    await expect(drawer.getByText('No messages yet', {exact: true})).toBeVisible();
    const ariAvatar = drawer.getByRole('img', {name: 'Ari avatar'}).locator('.bloub-body');
    await expect(ariAvatar).toHaveCSS('fill', 'rgb(241, 239, 233)');

    await drawer.getByRole('button', {name: 'Settings', exact: true}).click();
    const settings = page.getByRole('region', {name: 'Settings'});
    await settings.getByRole('radiogroup', {name: 'Theme'}).getByRole('radio', {name: 'Light'}).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(ariAvatar).toHaveCSS('fill', 'rgb(10, 10, 12)');
    await page.getByRole('button', {name: 'Close Settings'}).click();
    await expect(settings).toHaveCount(0);

    await page.getByRole('button', {name: 'Devices', exact: true}).click();
    const host = page.getByRole('dialog', {name: 'Devices', exact: true});
    await expect(host).toContainText('Connected Devices');
    await expect(host).toContainText('Studio Linux');
    await expect(host.getByRole('img', {name: 'Polymux pairing QR code'})).toBeVisible();
    await expect(host).toContainText('Scan with Polymux on your other device');
    const copyHostInstall = host.getByRole('button', {name: 'Copy Command'});
    await copyHostInstall.click();
    await expect(host.getByLabel('Command copied', {exact: true})).toBeVisible();
    await host.getByRole('button', {name: 'Connect', exact: true}).click();
    const code = host.getByRole('textbox', {name: 'Device pairing code'});
    await code.fill('318204771');
    await host.getByRole('button', {name: 'Connect Device', exact: true}).click();
    await expect(host.getByText('Select this number on your other device.')).toBeVisible();
    await expect(host).toContainText('Home Mac mini');
  });

  test('presents and refreshes the device pairing code without an endpoint field', async ({page}) => {
    await page.goto('/?coldStart=0');
    const drawer = chatDrawer(page);
    await drawer.getByRole('button', {name: 'Team', exact: true}).click();
    await page.getByRole('button', {name: 'Devices', exact: true}).click();

    const host = page.getByRole('dialog', {name: 'Devices', exact: true});
    await host.getByRole('button', {name: 'Code', exact: true}).click();
    await expect(host).toContainText('K7M2P9X4Q');
    await expect(host).toContainText(/Refreshes in 4:5\d/);
    await expect(host.getByRole('button', {name: 'Copy pairing link'})).toHaveCount(0);
    await page.evaluate(() => {
      const now = Date.now();
      Date.now = () => now + 10 * 60_000;
    });
    await expect(host).toContainText(/Refreshes in (?:5:00|4:59)/);
    await expect(host).not.toContainText('Pairing window closed');
  });

  test('keeps the chosen agent on the individual bot', async ({page}) => {
    await page.goto('/?coldStart=0');
    const drawer = chatDrawer(page);
    await drawer.getByRole('button', {name: 'Team', exact: true}).click();
    await drawer.getByRole('button', {name: 'New chat', exact: true}).click();
    const bar = page.locator('.team-new-chat-bar');
    await bar.getByRole('textbox', {name: 'Search or create Bots'}).fill('Cora');
    await bar.getByRole('button', {name: 'Create bot “Cora”', exact: true}).click();

    // Options live on the drawer row rather than the conversation header.
    const coraOptions = drawer.getByRole('button', {name: 'Options for Cora'});
    await coraOptions.click();
    await drawer.getByRole('menu', {name: 'Options for Cora'}).getByRole('menuitem', {name: 'Edit'}).click();
    const edit = workspaceDrawer(page).getByRole('region', {name: 'Edit Cora', exact: true});
    await expect(edit).toBeVisible();
    // A bot created from the To: bar starts on Polymux; this one moves to an ACP agent.
    await expect(edit.getByRole('radio', {name: 'Polymux Built in', exact: true})).toHaveAttribute('aria-checked', 'true');
    await edit.getByRole('radio', {name: 'Claude Agent', exact: true}).click();
    await expect(edit.getByRole('button', {name: 'Profile', exact: true})).toHaveCount(0);
    await edit.getByRole('textbox', {name: 'Role'}).fill('Code reviewer');
    await edit.getByRole('button', {name: 'Save', exact: true}).click();
    await expect(edit).toHaveCount(0);

    await coraOptions.click();
    await drawer.getByRole('menu', {name: 'Options for Cora'}).getByRole('menuitem', {name: 'Edit'}).click();
    const reopened = workspaceDrawer(page).getByRole('region', {name: 'Edit Cora', exact: true});
    await expect(reopened.getByRole('radio', {name: 'Claude Agent', exact: true})).toHaveAttribute('aria-checked', 'true');
    await expect(reopened.getByRole('button', {name: 'Profile', exact: true})).toHaveCount(0);
  });

  test('rings only for live work and shows the completion handoff', async ({page}) => {
    await page.goto('/?coldStart=0');
    const drawer = chatDrawer(page);
    await drawer.getByRole('button', {name: 'Team', exact: true}).click();
    const avatar = drawer.getByRole('img', {name: 'Maya avatar'});

    async function setStatus(status: 'idle' | 'working' | 'waiting-for-device' | 'computer-offline' | 'error'): Promise<void> {
      await page.evaluate((next) => {
        (window as unknown as {
          polymuxDemoSetTeamStatus: (id: string, status: typeof next) => void;
        }).polymuxDemoSetTeamStatus('maya', next);
      }, status);
    }

    async function expectMotion(activity: string, motionName: string, ringName?: string): Promise<void> {
      await expect(avatar).toHaveAttribute('data-bloub-activity', activity);
      const motion = await avatar.locator('.bloub-state-motion').evaluate((node) => ({
        name: getComputedStyle(node).animationName,
        playState: getComputedStyle(node).animationPlayState,
      }));
      expect(motion.name).toContain(motionName);
      expect(motion.playState).toBe('running');
      if (!ringName) return;
      const ring = await avatar.locator('.bloub-activity-ring').evaluate((node) => ({
        name: getComputedStyle(node).animationName,
        playState: getComputedStyle(node).animationPlayState,
      }));
      expect(ring.name).toContain(ringName);
      expect(ring.playState).toBe('running');
    }

    async function expectRingHidden(): Promise<void> {
      await expect
        .poll(() => avatar.locator('.bloub-activity-ring').evaluate((node) => getComputedStyle(node).opacity))
        .toBe('0');
    }

    await expectMotion('working', 'bloub-working-float', 'bloub-working-orbit');
    for (const status of ['waiting-for-device', 'computer-offline', 'error', 'idle'] as const) {
      await setStatus(status);
      await expectMotion('idle', 'bloub-idle-breathe');
      await expectRingHidden();
    }

    await setStatus('working');
    await expectMotion('working', 'bloub-working-float', 'bloub-working-orbit');
    await setStatus('idle');
    await expectMotion('complete', 'bloub-complete-settle', 'bloub-complete-ring');
    await expect(avatar).toHaveAttribute('data-bloub-activity', 'idle', {timeout: 1_500});

    await page.emulateMedia({reducedMotion: 'reduce'});
    expect(await avatar.locator('.bloub-state-motion').evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
    expect(await avatar.locator('.bloub-activity-ring').evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
  });

  test('fills the available Team canvas and follows Summary and Workspace edges', async ({page}) => {
    await page.setViewportSize({width: 1440, height: 900});
    await page.goto('/?coldStart=0');
    const chats = chatDrawer(page);
    await chats.getByRole('button', {name: 'Team', exact: true}).click();
    await chats.getByRole('button', {name: 'Open group Launch room'}).click();
    await page.waitForTimeout(500);

    const pane = page.getByRole('region', {name: 'Conversation with Launch room'});
    const geometry = () => pane.evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      const messages = node.querySelector('.team-chat-messages')!.getBoundingClientRect();
      const composer = node.querySelector('.team-chat-composer-row')!.getBoundingClientRect();
      const root = getComputedStyle(node.closest('main')!);
      return {
        pane: {left: bounds.left, right: bounds.right, width: bounds.width},
        messages: {left: messages.left, right: messages.right, width: messages.width},
        composer: {left: composer.left, right: composer.right, width: composer.width},
        rightColumn: Number.parseFloat(root.getPropertyValue('--content-right-column')) || 0,
      };
    });
    const expectFullTeamTrack = async () => {
      const measured = await geometry();
      expect(Math.abs(measured.messages.left - measured.pane.left - 18)).toBeLessThanOrEqual(1);
      expect(Math.abs(measured.pane.right - measured.messages.right - 18)).toBeLessThanOrEqual(1);
      expect(Math.abs(measured.composer.left - measured.pane.left - 14)).toBeLessThanOrEqual(1);
      expect(Math.abs(measured.pane.right - measured.composer.right - 14)).toBeLessThanOrEqual(1);
      return measured;
    };

    // Summary is the conversation's default companion and an open panel wins
    // over the next conversation, so the full track is measured with it closed.
    const summaryToggle = page.getByRole('button', {name: 'Toggle Summary'});
    if ((await summaryToggle.getAttribute('aria-pressed')) === 'true') await summaryToggle.click();
    await expect(summaryCard(page)).toHaveCount(0);
    await expect.poll(async () => (await geometry()).rightColumn).toBe(0);

    const open = await expectFullTeamTrack();
    expect(open.messages.width).toBeGreaterThan(1_000);
    expect(open.composer.width).toBeGreaterThan(1_000);

    await summaryToggle.click();
    await expect(summaryCard(page)).toBeVisible();
    await expect.poll(async () => (await geometry()).rightColumn).toBe(337);
    const withSummary = await expectFullTeamTrack();
    expect(withSummary.pane.width).toBeLessThan(open.pane.width);
    expect(withSummary.rightColumn).toBe(337);
    const summaryBox = await summaryCard(page).boundingBox();
    expect(summaryBox).not.toBeNull();
    expect(summaryBox!.x).toBeGreaterThanOrEqual(withSummary.pane.right);

    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    const workspace = workspaceDrawer(page);
    await expect(workspace).toHaveClass(/open/);
    await expect(summaryCard(page)).toHaveCount(0);
    await page.waitForTimeout(500);
    const docked = await expectFullTeamTrack();
    const dockedWorkspace = await workspace.boundingBox();
    expect(dockedWorkspace).not.toBeNull();
    expect(Math.abs(docked.pane.right - dockedWorkspace!.x)).toBeLessThanOrEqual(1);

    const handle = page.getByRole('button', {name: 'Resize Workspace'});
    const handleBox = await handle.boundingBox();
    expect(handleBox).not.toBeNull();
    const startX = dockedWorkspace!.x - .5;
    const y = handleBox!.y + handleBox!.height / 2;
    await page.mouse.move(startX, y);
    await page.mouse.down();
    await expect(page.locator('main')).toHaveClass(/workspace-resizing/);
    for (const distance of [48, 96]) {
      const targetX = startX - distance;
      await page.mouse.move(targetX, y, {steps: 4});
      await expect.poll(async () => {
        const [team, drawer] = await Promise.all([pane.boundingBox(), workspace.boundingBox()]);
        if (!team || !drawer) return Number.POSITIVE_INFINITY;
        return Math.max(Math.abs(team.x + team.width - drawer.x), Math.abs(drawer.x - targetX));
      }).toBeLessThanOrEqual(1);
      await expectFullTeamTrack();
    }
    await page.mouse.up();
    await expect(page.locator('main')).not.toHaveClass(/workspace-resizing/);
  });

  test('filters Team contacts and creates a named bot from the To: bar', async ({page}) => {
    await page.goto('/?coldStart=0');
    const drawer = chatDrawer(page);
    await drawer.getByRole('button', {name: 'Team', exact: true}).click();
    await drawer.getByRole('button', {name: 'New chat', exact: true}).click();
    const bar = page.locator('.team-new-chat-bar');
    const search = bar.getByRole('textbox', {name: 'Search or create Bots'});
    await expect(search).toBeFocused();
    await expect(bar.getByRole('button', {name: 'Open Maya'})).toBeVisible();
    await expect(bar.getByRole('button', {name: 'Open Sol'})).toBeVisible();

    await search.fill('Zara');
    await expect(bar.getByRole('button', {name: 'Open Maya'})).toHaveCount(0);
    await expect(bar.getByRole('status')).toHaveText('No bots found');
    await bar.getByRole('button', {name: 'Create bot “Zara”'}).click();

    await expect(bar).toHaveCount(0);
    await expect(page.getByRole('region', {name: 'Conversation with Zara'})).toBeVisible();
    await expect(drawer.getByRole('button', {name: /Open Zara/})).toBeVisible();
  });


  test('creates a Team group from the To: bar and manages it from the title bar', async ({page}) => {
    await page.goto('/?coldStart=0');
    const drawer = chatDrawer(page);
    await drawer.getByRole('button', {name: 'Team', exact: true}).click();

    await drawer.getByRole('button', {name: 'New chat', exact: true}).click();
    const bar = page.locator('.team-new-chat-bar');
    await bar.getByRole('button', {name: 'Create group chat', exact: true}).click();

    // Group mode drops the two create rows and picks members as chips.
    await expect(bar.getByRole('button', {name: 'Create new Bot'})).toHaveCount(0);
    await expect(bar.getByRole('button', {name: 'Create group chat'})).toHaveCount(0);
    await bar.getByRole('button', {name: 'Add Maya'}).click();
    await expect(bar.getByRole('status')).toHaveText('Choose at least two bots');
    await bar.getByRole('button', {name: 'Add Linus'}).click();
    // A chosen bot leaves the list and becomes a chip that can be removed.
    await expect(bar.getByRole('button', {name: 'Add Maya'})).toHaveCount(0);
    await expect(bar.locator('.team-new-chat-chip')).toHaveCount(2);
    await bar.getByRole('button', {name: 'Remove Maya'}).click();
    await expect(bar.getByRole('button', {name: 'Add Maya'})).toBeVisible();

    // Escaping group mode drops the selection; the numbered shortcuts pick a
    // fresh pair by their position in the list.
    await page.keyboard.press('Escape');
    await expect(bar.getByRole('button', {name: 'Create group chat'})).toBeVisible();
    await bar.getByRole('button', {name: 'Create group chat'}).click();
    // The shortcuts number the list as it stands, so the second pick is the
    // first bot still on offer.
    await page.keyboard.press('Control+1');
    await page.keyboard.press('Control+1');
    await expect(bar.locator('.team-new-chat-chip')).toHaveCount(2);
    await page.keyboard.press('Enter');

    await expect(bar).toHaveCount(0);
    await expect(page.getByRole('region', {name: 'Conversation with Maya, Linus'})).toBeVisible();
    await expect(drawer.locator('.chat-drawer-team-group-row')).toHaveCount(2);
    await expect(drawer.getByRole('button', {name: 'Open group Maya, Linus'})).toBeVisible();
    // The title bar names the group as you plus its members.
    const titleIdentity = page.getByRole('button', {name: 'Edit group You, Maya, Linus', exact: true});
    await expect(titleIdentity).toBeVisible();

    // The identity opens the group's own surface: rename, members, add.
    await titleIdentity.click();
    const menu = page.locator('.team-group-menu');
    await expect(menu).toBeVisible();
    await menu.getByRole('textbox', {name: 'Chat name'}).fill('Release pair');
    await menu.getByRole('textbox', {name: 'Chat name'}).press('Enter');
    await expect(page.locator('.team-conversation-title-bar').getByText('Release pair', {exact: true})).toBeVisible();
    await expect(drawer.getByRole('button', {name: 'Open group Release pair'})).toBeVisible();

    await menu.getByRole('button', {name: 'Add Member', exact: true}).click();
    await menu.getByRole('textbox', {name: 'Add Member'}).fill('Sol');
    await menu.getByRole('button', {name: 'Add Sol', exact: true}).click();
    await expect(menu.getByRole('button', {name: 'Remove Sol', exact: true})).toBeVisible();
    await menu.getByRole('button', {name: 'Remove Sol', exact: true}).click();
    await expect(menu.getByRole('button', {name: 'Remove Sol', exact: true})).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  });

  test('reaches the group surface from the drawer row menu', async ({page}) => {
    await page.goto('/?coldStart=0');
    const drawer = chatDrawer(page);
    await drawer.getByRole('button', {name: 'Team', exact: true}).click();

    await drawer.getByRole('button', {name: 'Options for Launch room'}).click();
    const rowMenu = drawer.getByRole('menu', {name: 'Options for Launch room'});
    await expect(rowMenu.getByRole('menuitem')).toHaveText(['Edit group', 'Delete group']);
    await rowMenu.getByRole('menuitem', {name: 'Edit group'}).click();

    const menu = page.locator('.team-group-menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('textbox', {name: 'Chat name'})).toHaveValue('Launch room');
    await menu.getByRole('button', {name: 'Remove Sol', exact: true}).click();
    await expect(menu.getByRole('button', {name: 'Remove Sol', exact: true})).toHaveCount(0);
  });


  test('queues rapid Team group sends and leaves historical replies settled', async ({page}) => {
    await page.goto('/?coldStart=0&teamGroupSend=slow');
    const drawer = chatDrawer(page);
    await drawer.getByRole('button', {name: 'Team', exact: true}).click();
    await drawer.getByRole('button', {name: 'Open group Launch room'}).click();
    const group = page.getByRole('region', {name: 'Conversation with Launch room'});
    const composer = group.getByRole('textbox', {name: 'Message Launch room'});

    await composer.fill('First queued update');
    await composer.press('Enter');
    await expect(group.getByText('Sending…', {exact: true})).toBeVisible();
    // The historical reply stays settled: nothing on it is still working, and
    // its time is still there while the new message sends.
    await expect(group.locator('[data-team-speaker="team:linus"] [data-bloub-activity="working"]')).toHaveCount(0);
    await expect(group.locator('[data-team-speaker="team:linus"] .message-time')).toBeVisible();
    await composer.fill('Second queued update');
    await composer.press('Enter');

    await expect(group.locator('.team-chat-message-row.human .message-content')).toContainText([
      'What is still blocking launch?',
      'First queued update',
      'Second queued update',
    ]);
    await expect(group.getByText('Sending…', {exact: true})).toHaveCount(0);
    await expect(group.getByText('Not sent', {exact: true})).toHaveCount(0);
    await expect(group.locator('.team-chat-message-row.human')).toHaveCount(3);
  });

  test('keeps a rejected Team group message visibly failed', async ({page}) => {
    await page.goto('/?coldStart=0&teamGroupSend=fail');
    const drawer = chatDrawer(page);
    await drawer.getByRole('button', {name: 'Team', exact: true}).click();
    await drawer.getByRole('button', {name: 'Open group Launch room'}).click();
    const group = page.getByRole('region', {name: 'Conversation with Launch room'});
    const composer = group.getByRole('textbox', {name: 'Message Launch room'});

    await composer.fill('Do not lose this rejected message');
    await composer.press('Enter');
    await expect(group.getByText('Not sent', {exact: true})).toBeVisible();
    await expect(group.locator('.team-chat-message-row.human').last()).toContainText('Do not lose this rejected message');
    await expect(page.getByRole('alert')).toContainText('Demo group delivery failed');
  });

  test('keeps keyboard focus inside the Team chooser and restores its opener', async ({page}) => {
    await page.goto('/?coldStart=0');
    const drawer = chatDrawer(page);
    await drawer.getByRole('button', {name: 'Team', exact: true}).click();

    const addChat = drawer.getByRole('button', {name: 'New chat', exact: true});
    await addChat.click();
    const bar = page.locator('.team-new-chat-bar');
    const search = bar.getByRole('textbox', {name: 'Search or create Bots'});
    await expect(search).toBeFocused();
    // Escape dismisses the band and the + takes focus back.
    await page.keyboard.press('Escape');
    await expect(bar).toHaveCount(0);
    await expect(addChat).toBeFocused();

    // Arrow keys read the list, and Enter takes the highlighted row.
    await addChat.click();
    await page.keyboard.press('ArrowDown');
    await expect(bar.getByRole('button', {name: 'Create new Bot', exact: true})).toHaveAttribute('data-active', 'true');
    await page.keyboard.press('Escape');
    await expect(addChat).toBeFocused();

    const hostTrigger = page.getByRole('button', {name: 'Devices', exact: true});
    await hostTrigger.click();
    const hostDialog = page.getByRole('dialog', {name: 'Devices', exact: true});
    await expect(hostDialog).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(hostDialog.getByRole('button', {name: 'Close Devices'})).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(hostTrigger).toBeFocused();

  });

  test('keeps Team metadata legible and exposes dark keyboard focus', async ({page}) => {
    await page.goto('/?coldStart=0');
    const drawer = chatDrawer(page);
    await drawer.getByRole('button', {name: 'Team', exact: true}).click();

    const metadata = drawer.locator('.chat-drawer-team-section, .chat-drawer-team-top small, .chat-drawer-team-top time, .chat-drawer-team-bottom');
    for (const item of await metadata.all()) {
      const style = await item.evaluate((element) => {
        const computed = getComputedStyle(element);
        return {color: computed.color, fontSize: Number.parseFloat(computed.fontSize)};
      });
      expect(style.color).toBe('rgb(94, 94, 94)');
      expect(style.fontSize).toBeGreaterThanOrEqual(11);
    }

    // The open bot's row raises its chip, so the resting palette is read from a row that is not active.
    const role = drawer.locator('.chat-drawer-team-row:not(.active)', {hasText: 'Linus'}).locator('.team-role-label');
    await expect(role).toHaveText('Software engineer');
    await expect(role).toHaveCSS('background-color', 'rgb(237, 237, 237)');
    await expect(role).toHaveCSS('border-color', 'rgb(221, 221, 221)');
    await expect(role).toHaveCSS('border-radius', '6px');
    await expect(role).toHaveCSS('color', 'rgb(93, 93, 93)');
    const roleClip = role.locator('..');
    await expect(roleClip).toHaveClass(/scroll-fade-x/);
    await expect(roleClip).toHaveClass(/at-start/);
    await expect(roleClip).not.toHaveClass(/at-end/);
    await expect.poll(() => roleClip.evaluate((element) => getComputedStyle(element).maskImage)).toContain('linear-gradient');

    await page.locator('html').evaluate((element) => element.setAttribute('data-theme', 'dark'));
    await expect(role).toHaveCSS('background-color', 'rgb(41, 41, 41)');
    await expect(role).toHaveCSS('border-color', 'rgb(56, 56, 56)');
    await expect(role).toHaveCSS('color', 'rgb(176, 176, 176)');
    const newGroup = drawer.getByRole('button', {name: 'New chat', exact: true});
    await newGroup.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(newGroup).toBeFocused();
    await expect(newGroup).toHaveCSS('outline-color', 'rgb(193, 193, 193)');
    await expect(newGroup).toHaveCSS('outline-width', '2px');

    await drawer.getByRole('button', {name: 'Open group Launch room'}).click();
    // The team title bar carries one control: the identity button that opens the editor.
    const titleIdentity = page.getByRole('button', {name: 'Edit group Launch room', exact: true});
    await titleIdentity.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(titleIdentity).toBeFocused();
    await expect(titleIdentity).toHaveCSS('outline-color', 'rgb(193, 193, 193)');
    await expect(titleIdentity).toHaveCSS('outline-width', '2px');
  });

  test('inverts the empty Team mascot with the active theme', async ({page}) => {
    await page.goto('/?coldStart=0&team=empty');
    const drawer = chatDrawer(page);
    await drawer.getByRole('button', {name: 'Team', exact: true}).click();

    const mascot = drawer.locator('.chat-drawer-team-empty-avatar');
    await expect(mascot).toBeVisible();
    const colors = await mascot.evaluate((node) => {
      const root = document.documentElement;
      const originalTheme = root.getAttribute('data-theme');
      const read = () => ({
        body: getComputedStyle(node.querySelector('.bloub-body')!).fill,
        eyes: getComputedStyle(node.querySelector('.bloub-paper')!).fill,
      });
      root.dataset.theme = 'light';
      const light = read();
      root.dataset.theme = 'dark';
      const dark = read();
      if (originalTheme === null) root.removeAttribute('data-theme');
      else root.dataset.theme = originalTheme;
      return {light, dark};
    });
    expect(colors).toEqual({
      light: {body: 'rgb(26, 26, 26)', eyes: 'rgb(243, 243, 243)'},
      dark: {body: 'rgb(239, 239, 239)', eyes: 'rgb(42, 42, 42)'},
    });
  });

  /**
   * The content beside the drawer is anchored to the drawer's own edge, so the
   * two have to move as one for the whole slide — not merely agree once it has
   * settled. Summary is the case that broke: its quicker column duration was
   * applied to every property `main` transitions, so the content arrived at its
   * drawer-closed place a third of a slide early and the drawer, still sliding,
   * ran over it.
   */
  for (const surface of ['summary', 'workspace'] as const) {
    test(`keeps the content beside it on its edge for the whole slide (${surface})`, async ({page}) => {
      await page.setViewportSize({width: 1300, height: 800});
      await page.goto('/');
      await send(page, 'in step');
      if (surface === 'workspace') {
        await page.getByRole('button', {name: 'Toggle Workspace'}).click();
        await expect(workspaceDrawer(page)).toHaveClass(/open/);
      } else {
        await expect(summaryCard(page)).toBeVisible();
      }
      await page.waitForTimeout(600);

      const edges = () => page.evaluate(() => {
        const right = (selector: string) => Math.round(document.querySelector(selector)!.getBoundingClientRect().right);
        const left = (selector: string) => Math.round(document.querySelector(selector)!.getBoundingClientRect().left);
        return {drawer: right('aside.chat-drawer'), composer: left('.sticky-composer'), title: left('.conversation-title-bar')};
      });

      for (const step of ['close', 'open']) {
        await page.getByRole('button', {name: 'Toggle Chats'}).click();
        for (let frame = 0; frame < 5; frame++) {
          await page.waitForTimeout(70);
          const {drawer, composer, title} = await edges();
          // A hairline of rounding is fine; a drawer riding over the content is not.
          expect(Math.abs(composer - drawer), `${step} frame ${frame} composer`).toBeLessThanOrEqual(2);
          expect(Math.abs(title - drawer), `${step} frame ${frame} title bar`).toBeLessThanOrEqual(2);
          await expectContentToFollowDrawerInsets(page, `${surface} chat ${step} frame ${frame}`);
        }
        await page.waitForTimeout(500);
      }
    });
  }

  test('starts open, groups by recency, and can close and reopen', async ({page}) => {
    await page.goto('/');
    const drawer = chatDrawer(page);
    await expect(drawer).toHaveClass(/open/);
    const chatDrawerButton = page.getByRole('button', {name: 'Toggle Chats'});
    await expect(chatDrawerButton).not.toHaveClass(/active/);
    await page.mouse.move(400, 200);
    await expect(chatDrawerButton).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(chatDrawerButton).toHaveCSS('color', 'rgb(160, 160, 160)');
    await expect(drawer.getByRole('button', {name: 'Assistant', exact: true})).toBeVisible();
    await expect(drawer.getByRole('button', {name: 'Team', exact: true})).toBeVisible();
    await expect(drawer.locator('.chat-drawer-group-toggle')).not.toHaveCount(0);

    // The drawer keeps its resting width and slides, rather than animating width.
    await expect(drawer).toHaveCSS('width', '240px');

    // Opening the drawer does not split the two chat controls across the bar.
    const controls = await page.locator('.left-controls button').evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return {left: rect.left, right: rect.right};
      }));
    expect(controls[1].left - controls[0].right).toBeCloseTo(1.5);

    // Selecting a conversation updates the active row without dismissing the
    // drawer, so another conversation remains one click away.
    const firstChat = drawer.getByRole('button', {name: /Open chat:/}).first();
    await firstChat.click();
    await expect(drawer).toHaveClass(/open/);
    await expect(firstChat).toHaveAttribute('aria-current', 'page');

    await page.getByRole('button', {name: 'Toggle Chats'}).click();
    await expect(drawer).not.toHaveClass(/open/);
    await page.getByRole('button', {name: 'Toggle Chats'}).click();
    await expect(drawer).toHaveClass(/open/);
  });

  test('renders chat list options as a bare icon action', async ({page}) => {
    await page.goto('/?coldStart=0');
    const listOptions = chatDrawer(page).getByRole('button', {name: 'Arrange'});

    await expect(listOptions).toHaveCSS('width', '24px');
    await expect(listOptions).toHaveCSS('height', '24px');
    await expect(listOptions).toHaveCSS('border-top-width', '0px');
    await expect(listOptions).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await listOptions.hover();
    await expect(listOptions).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  });

  test('groups, sorts, and filters chats from the heading menu', async ({page}) => {
    await page.goto('/?coldStart=0');
    const drawer = chatDrawer(page);
    const listOptions = drawer.getByRole('button', {name: 'Arrange'});
    const newFolder = drawer.getByRole('button', {name: 'New folder'});
    const newChat = drawer.getByRole('button', {name: 'New Chat'});
    const foldersHeading = drawer.getByRole('button', {name: 'Folders', exact: true});
    const chatsHeading = drawer.getByRole('button', {name: 'Chats', exact: true});

    // Folders and Chats stay on screen even before anything is filed. New
    // folder rides the Folders title; new chat rides Chats. Search sits
    // immediately left of Arrange in the heading.
    await expect(foldersHeading).toBeVisible();
    await expect(chatsHeading).toBeVisible();
    await expect(drawer.getByText('Chats will appear here')).toHaveCount(0);
    await expect(drawer.getByText('No folders yet')).toBeVisible();
    await expect(drawer.getByText('No chats yet', {exact: true})).toHaveCount(0);
    const assistant = drawer.getByRole('button', {name: 'Assistant', exact: true});
    const [headingBox, folderBox, foldersBox, chatsBox, arrangeBox, newChatBox] = await Promise.all([
      drawer.locator('.chat-drawer-heading').boundingBox(),
      newFolder.boundingBox(),
      foldersHeading.boundingBox(),
      chatsHeading.boundingBox(),
      listOptions.boundingBox(),
      newChat.boundingBox(),
    ]);
    const [assistantLeft, foldersLeft, chatsLeft, emptyFoldersLeft] = await Promise.all([
      assistant.evaluate((node) => node.getBoundingClientRect().left),
      foldersHeading.locator('span').evaluate((node) => node.getBoundingClientRect().left),
      chatsHeading.locator('span').evaluate((node) => node.getBoundingClientRect().left),
      drawer.getByText('No folders yet').evaluate((node) => node.getBoundingClientRect().left),
    ]);
    expect(headingBox).not.toBeNull();
    expect(folderBox).not.toBeNull();
    expect(foldersBox).not.toBeNull();
    expect(chatsBox).not.toBeNull();
    expect(arrangeBox).not.toBeNull();
    expect(newChatBox).not.toBeNull();
    expect(folderBox!.y).toBeGreaterThanOrEqual(headingBox!.y + headingBox!.height);
    expect(folderBox!.height).toBe(24);
    expect(newChatBox!.height).toBe(24);
    expect(foldersBox!.height).toBe(24);
    expect(chatsBox!.height).toBe(24);
    expect(Math.abs(folderBox!.y - foldersBox!.y)).toBeLessThan(1);
    expect(Math.abs(newChatBox!.y - chatsBox!.y)).toBeLessThan(1);
    const sectionIconCentres = await Promise.all([
      foldersHeading.evaluate((button) => {
        const head = button.closest('.chat-drawer-section-head')!;
        const label = button.querySelector('span')!.getBoundingClientRect();
        const artwork = head.querySelector('[data-icon="folder-plus"]')!.getBoundingClientRect();
        return {label: label.top + label.height / 2, artwork: artwork.top + artwork.height / 2};
      }),
      chatsHeading.evaluate((button) => {
        const head = button.closest('.chat-drawer-section-head')!;
        const label = button.querySelector('span')!.getBoundingClientRect();
        const artwork = head.querySelector('[data-icon="new-chat"] > g')!.getBoundingClientRect();
        return {label: label.top + label.height / 2, artwork: artwork.top + artwork.height / 2};
      }),
    ]);
    const [foldersRowCentres, chatsRowCentres] = sectionIconCentres;
    expect(Math.abs(foldersRowCentres.artwork - foldersRowCentres.label)).toBeLessThan(2);
    expect(Math.abs(chatsRowCentres.artwork - chatsRowCentres.label)).toBeLessThan(2);
    expect(Math.abs(
      (foldersRowCentres.artwork - foldersRowCentres.label)
      - (chatsRowCentres.artwork - chatsRowCentres.label),
    )).toBeLessThan(2);
    expect(arrangeBox!.x).toBeGreaterThan(headingBox!.x);
    expect(Math.abs(foldersLeft - assistantLeft)).toBeLessThan(2);
    expect(Math.abs(chatsLeft - assistantLeft)).toBeLessThan(2);
    expect(Math.abs(emptyFoldersLeft - foldersLeft)).toBeLessThan(2);
    expect(Math.abs((folderBox!.x + folderBox!.width) - (arrangeBox!.x + arrangeBox!.width))).toBeLessThan(2);
    expect(Math.abs((newChatBox!.x + newChatBox!.width) - (arrangeBox!.x + arrangeBox!.width))).toBeLessThan(2);
    const drawerBox = await drawer.boundingBox();
    expect(folderBox!.x + folderBox!.width).toBeLessThanOrEqual(drawerBox!.x + drawerBox!.width);
    expect(folderBox!.x + folderBox!.width).toBeGreaterThanOrEqual(drawerBox!.x + drawerBox!.width - 28);

    await listOptions.click();
    let menu = drawer.getByRole('menu', {name: 'Chat list options'});
    await expect(menu.getByRole('menuitem')).toHaveText(['Group by', 'Sort by', 'Order', 'Filter']);
    const triggerIconBox = await listOptions.locator('svg').boundingBox();
    const optionsMenuBox = await menu.boundingBox();
    expect(triggerIconBox).not.toBeNull();
    expect(optionsMenuBox).not.toBeNull();
    // The menu hangs from the trigger's icon rather than centring on the button.
    expect(optionsMenuBox!.x).toBeCloseTo(triggerIconBox!.x, 0);
    let submenu = await openChatListSubmenu(drawer, 'Group by');
    await expect(submenu.getByRole('menuitemradio')).toHaveText([
      'Date', 'Folder', 'State', 'None',
    ]);
    const [menuBox, submenuBox] = await Promise.all([menu.boundingBox(), submenu.boundingBox()]);
    expect(menuBox).not.toBeNull();
    expect(submenuBox).not.toBeNull();
    expect(submenuBox!.x).toBeGreaterThanOrEqual(menuBox!.x + menuBox!.width);
    await expect(submenu.getByRole('menuitemradio', {name: 'Folder', exact: true})).toHaveAttribute('aria-checked', 'true');
    await submenu.getByRole('menuitemradio', {name: 'None'}).click();
    await expect(newFolder).toHaveCount(0);
    await expect(menu).toBeVisible();
    await expect(submenu).toBeVisible();

    submenu = await openChatListSubmenu(drawer, 'Sort by');
    await expect(submenu.getByRole('menuitemradio')).toHaveText([
      'Last activity', 'Date created', 'Name',
    ]);
    await submenu.getByRole('menuitemradio', {name: 'Name'}).click();
    await expect(menu).toBeVisible();
    await expect(submenu).toBeVisible();

    submenu = await openChatListSubmenu(drawer, 'Order');
    await expect(submenu.getByRole('menuitemradio')).toHaveText([
      'Descending', 'Ascending',
    ]);
    await submenu.getByRole('menuitemradio', {name: 'Ascending'}).click();

    submenu = await openChatListSubmenu(drawer, 'Filter');
    await expect(submenu.getByRole('menuitemradio')).toHaveText([
      'All chats', 'Running', 'Idle', 'In folders', 'Unfiled',
    ]);

    const titles = await drawer.locator('.chat-drawer-flat-list .chat-drawer-open-chat > span').allTextContents();
    expect(titles).toEqual([...titles].sort((left, right) => left.localeCompare(right, undefined, {numeric: true, sensitivity: 'base'})));

    await chooseChatListOption(drawer, 'Group by', 'State');
    await expect(drawer.getByRole('button', {name: 'Idle', exact: true})).toBeVisible();

    await chooseChatListOption(drawer, 'Filter', 'Running');
    await expect(drawer.getByText('No chats match this filter', {exact: true})).toBeVisible();
    await chooseChatListOption(drawer, 'Filter', 'All chats');
    await expect(drawer.getByRole('button', {name: 'Idle', exact: true})).toBeVisible();
    await expect(drawer.getByRole('menu', {name: 'Chat list options'})).toBeVisible();
    await expect(drawer.getByRole('menu', {name: 'Filter', exact: true})).toBeVisible();

    await page.mouse.click(500, 500);
    await expect(drawer.getByRole('menu', {name: 'Chat list options'})).toHaveCount(0);
    await expect(drawer.getByRole('menu', {name: 'Filter', exact: true})).toHaveCount(0);

    await page.reload();
    const restoredDrawer = chatDrawer(page);
    await restoredDrawer.getByRole('button', {name: 'Arrange'}).click();
    await expect((await openChatListSubmenu(restoredDrawer, 'Group by')).getByRole('menuitemradio', {name: 'State'})).toHaveAttribute('aria-checked', 'true');
    await expect((await openChatListSubmenu(restoredDrawer, 'Sort by')).getByRole('menuitemradio', {name: 'Name'})).toHaveAttribute('aria-checked', 'true');
    await expect((await openChatListSubmenu(restoredDrawer, 'Order')).getByRole('menuitemradio', {name: 'Ascending'})).toHaveAttribute('aria-checked', 'true');
  });

  test('shows no chats yet under Chats when the list is empty', async ({page}) => {
    await page.goto('/?coldStart=0&chats=empty');
    const drawer = chatDrawer(page);
    const emptyChats = drawer.getByText('No chats yet', {exact: true});
    await expect(emptyChats).toBeVisible();
    await expect(drawer.locator('.chat-drawer-row')).toHaveCount(0);
    await expect(drawer.getByText('Chats will appear here')).toHaveCount(0);
    await expect(drawer.getByText('No folders yet')).toBeVisible();
    await expect(drawer.getByRole('button', {name: 'Chats', exact: true})).toBeVisible();
    await expect(drawer.getByRole('button', {name: 'New Chat'})).toBeVisible();
    const [chatsLeft, emptyChatsLeft] = await Promise.all([
      drawer.getByRole('button', {name: 'Chats', exact: true}).locator('span').evaluate((node) => node.getBoundingClientRect().left),
      emptyChats.evaluate((node) => node.getBoundingClientRect().left),
    ]);
    expect(Math.abs(emptyChatsLeft - chatsLeft)).toBeLessThan(2);
  });

  test('leaves the side panels alone when the chat changes', async ({page}) => {
    await page.goto('/');
    const rows = await expandAllChatGroups(page);
    await rows.first().click();

    // Workspace open and docked: switching chats keeps it open.
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    await expect(page.locator('main')).toHaveClass(/workspace-open/);
    await rows.nth(1).click();
    await expect(page.locator('main')).toHaveClass(/workspace-open/);

    // Closed stays closed too, rather than the next chat reopening Summary.
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    await page.getByRole('button', {name: 'Toggle Summary'}).click();
    await expect(page.locator('main')).not.toHaveClass(/panel-open/);
    await rows.first().click();
    await expect(page.locator('main')).not.toHaveClass(/panel-open/);
  });

  test('hands back an expanded workspace when another chat is picked', async ({page}) => {
    await page.goto('/');
    const rows = await expandAllChatGroups(page);
    await rows.first().click();
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    await page.getByRole('button', {name: 'Expand Workspace'}).click();
    await expect(page.locator('main')).toHaveClass(/workspace-expanded/);

    await rows.nth(1).click();
    await expect(page.locator('main')).not.toHaveClass(/workspace-expanded/);
    await expect(page.locator('main')).toHaveClass(/workspace-open/);
  });

  test('collapses a group, and renames a chat from its row menu', async ({page}) => {
    await page.goto('/');
    const drawer = chatDrawer(page);

    const group = drawer.locator('.chat-drawer-group-toggle').first();
    await group.click();
    await expect(group).toHaveClass(/collapsed/);
    await group.click();
    await expect(group).not.toHaveClass(/collapsed/);

    const row = drawer.locator('.chat-drawer-row').first();
    await row.hover();
    const more = row.getByRole('button', {name: /More actions/});
    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    const menu = drawer.getByRole('menu');
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', {name: 'Rename'}).click();
    await page.locator('.chat-drawer-edit input').fill('Renamed from the drawer');
    await page.keyboard.press('Enter');
    await expect(drawer.getByText('Renamed from the drawer')).toBeVisible();
  });

  test('matches the Folders disclosure header to Chats', async ({page}) => {
    await page.addInitScript(() => {
      localStorage.setItem('polymuxChatFolders', JSON.stringify([
        {id: 'fixture-folder', name: 'Fixture folder', collapsed: false, chatIds: []},
      ]));
    });
    await page.goto('/?coldStart=0');
    const drawer = chatDrawer(page);
    const foldersHeading = drawer.getByRole('button', {name: 'Folders', exact: true});
    const chatsHeading = drawer.getByRole('button', {name: 'Chats', exact: true});
    const folder = drawer.getByRole('button', {name: 'Collapse folder: Fixture folder'});

    await expect(foldersHeading).toHaveClass(/chat-drawer-group-toggle/);
    await expect(foldersHeading.locator('[data-icon="chevron"]')).toBeVisible();
    await expect(foldersHeading).toHaveCSS('height', await chatsHeading.evaluate((node) => getComputedStyle(node).height));
    await expect(foldersHeading).toHaveCSS('font-size', await chatsHeading.evaluate((node) => getComputedStyle(node).fontSize));
    await foldersHeading.click();
    await expect(foldersHeading).toHaveAttribute('aria-expanded', 'false');
    await expect(foldersHeading).toHaveClass(/collapsed/);
    await expect(folder).toHaveCount(0);
    await expect(chatsHeading).toBeVisible();
    await foldersHeading.click();
    await expect(folder).toBeVisible();

    const folderRow = drawer.locator('.chat-drawer-folder-row').filter({hasText: 'Fixture folder'});
    await folderRow.hover();
    await expect(folderRow.locator('.chat-drawer-more')).toHaveCSS('width', '20px');
    const trailingCentres = await drawer.evaluate((root) => {
      const centreX = (selector: string) => {
        const node = root.querySelector(selector);
        if (!node) return null;
        const box = node.getBoundingClientRect();
        return box.left + box.width / 2;
      };
      return {
        arrange: centreX('.chat-list-options [data-icon="filter"]'),
        folderPlus: centreX('[data-icon="folder-plus"]'),
        newChat: centreX('.chat-drawer-section-head [data-icon="new-chat"]'),
        more: centreX('.chat-drawer-folder-row .chat-drawer-more [data-icon="ellipsis"]'),
      };
    });
    expect(trailingCentres.arrange).not.toBeNull();
    expect(trailingCentres.folderPlus).not.toBeNull();
    expect(trailingCentres.newChat).not.toBeNull();
    expect(trailingCentres.more).not.toBeNull();
    expect(Math.abs(trailingCentres.arrange! - trailingCentres.more!)).toBeLessThan(2);
    expect(Math.abs(trailingCentres.folderPlus! - trailingCentres.more!)).toBeLessThan(2);
    expect(Math.abs(trailingCentres.newChat! - trailingCentres.more!)).toBeLessThan(2);
  });

  test('creates a one-level folder and moves an indented chat into it', async ({page}) => {
    await page.goto('/?coldStart=0');
    const drawer = chatDrawer(page);

    const newFolder = drawer.getByRole('button', {name: 'New folder'});
    await expect(newFolder).toHaveCSS('appearance', 'none');
    await newFolder.hover();
    await expect(newFolder).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(newFolder).toHaveCSS('box-shadow', 'none');
    await newFolder.focus();
    await expect(newFolder).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(newFolder).toHaveCSS('box-shadow', 'none');
    await newFolder.click();
    const nameField = drawer.getByRole('textbox', {name: 'Folder name'});
    await expect(nameField).toHaveValue('New folder');
    await nameField.fill('Polymux');
    await page.keyboard.press('Enter');

    const chat = drawer.getByRole('button', {name: 'Open chat: Planning a product launch'});
    const row = chat.locator('..');
    await row.hover();
    const more = row.getByRole('button', {name: 'More actions: Planning a product launch'});
    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    const move = drawer.getByRole('menuitem', {name: 'Move to folder', exact: true});
    await move.hover();
    const sub = drawer.getByRole('menu', {name: 'Move to folder', exact: true});
    await expect(sub).toBeVisible();
    await sub.getByRole('menuitem', {name: 'Polymux', exact: true}).click();

    await chooseChatListOption(drawer, 'Group by', 'Folder');
    await page.mouse.click(500, 500);

    const folder = drawer.getByRole('button', {name: 'Collapse folder: Polymux'});
    const nested = drawer.locator('.chat-drawer-folder-chats .chat-drawer-row');
    await expect(folder).toBeVisible();
    await expect(folder.locator('[data-icon="folder-open"]')).toBeVisible();
    await expect(nested).toHaveCount(1);
    const indentation = await nested.locator('.chat-drawer-open-chat').evaluate((node) =>
      Number.parseFloat(getComputedStyle(node).paddingLeft));
    expect(indentation).toBeGreaterThan(10);
    const foldersHeading = drawer.getByRole('button', {name: 'Folders', exact: true});
    const chatsHeading = drawer.getByRole('button', {name: 'Chats', exact: true});
    const [headingBox, folderBox, chatsBox] = await Promise.all([
      foldersHeading.boundingBox(),
      folder.boundingBox(),
      chatsHeading.boundingBox(),
    ]);
    expect(headingBox).not.toBeNull();
    expect(folderBox).not.toBeNull();
    expect(chatsBox).not.toBeNull();
    expect(folderBox!.y).toBeGreaterThan(headingBox!.y);
    expect(chatsBox!.y).toBeGreaterThan(folderBox!.y);
    await expect(foldersHeading).toHaveClass(/chat-drawer-group-toggle/);
    await expect(foldersHeading.locator('[data-icon="chevron"]')).toBeVisible();
    await expect(foldersHeading).toHaveCSS('font-size', await chatsHeading.evaluate((node) => getComputedStyle(node).fontSize));
    await foldersHeading.click();
    await expect(foldersHeading).toHaveClass(/collapsed/);
    await expect(folder).toHaveCount(0);
    await foldersHeading.click();
    await expect(folder).toBeVisible();

    await chooseChatListOption(drawer, 'Group by', 'Date');
    await page.mouse.click(500, 500);
    await expect(folder).toHaveCount(0);
    await expect(drawer.getByRole('button', {name: 'Open chat: Planning a product launch'})).toBeVisible();
    await chooseChatListOption(drawer, 'Group by', 'Folder');
    await page.mouse.click(500, 500);

    await folder.click();
    const collapsedFolder = drawer.getByRole('button', {name: 'Expand folder: Polymux'});
    await expect(collapsedFolder.locator('[data-icon="folder"]')).toBeVisible();
    await expect(nested).toHaveCount(0);

    // Folder identity, membership, and collapse state survive a renderer reload.
    await page.reload();
    await expect(chatDrawer(page).getByRole('button', {name: 'Expand folder: Polymux'})).toBeVisible();
    await expect(chatDrawer(page).getByRole('button', {name: 'New folder'})).toHaveCount(1);
  });

  test('prefills a new folder name and increments when that name is taken', async ({page}) => {
    await page.addInitScript(() => {
      localStorage.setItem('polymuxChatFolders', JSON.stringify([
        {id: 'existing', name: 'New folder', collapsed: false, chatIds: []},
      ]));
    });
    await page.goto('/?coldStart=0');
    const drawer = chatDrawer(page);
    await drawer.getByRole('button', {name: 'New folder', exact: true}).click();
    const nameField = drawer.getByRole('textbox', {name: 'Folder name'});
    await expect(nameField).toHaveValue('New folder 1');
    await expect(nameField).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(drawer.getByRole('button', {name: 'Collapse folder: New folder 1'})).toBeVisible();
  });

  test('opens folder and chat menus from the right-clicked row position', async ({page}) => {
    await page.goto('/?coldStart=0');
    const drawer = chatDrawer(page);

    await drawer.getByRole('button', {name: 'New folder'}).click();
    await drawer.getByRole('textbox', {name: 'Folder name'}).fill('Context Folder');
    await page.keyboard.press('Enter');
    await chooseChatListOption(drawer, 'Group by', 'Folder');
    await page.mouse.click(500, 500);

    const folderRow = drawer.getByRole('button', {name: 'Collapse folder: Context Folder'}).locator('..');
    const folderRowBox = await folderRow.boundingBox();
    expect(folderRowBox).not.toBeNull();
    const folderClickX = folderRowBox!.width - 60;
    await folderRow.click({button: 'right', position: {x: folderClickX, y: 17}});

    let menu = drawer.getByRole('menu');
    await expect(menu.getByRole('menuitem')).toHaveText(['Pin Folder', 'Rename', 'Delete folder']);
    let menuBox = await menu.boundingBox();
    expect(menuBox).not.toBeNull();
    expect(Math.abs(menuBox!.x - (folderRowBox!.x + folderClickX))).toBeLessThan(2);
    expect(Math.abs(menuBox!.y - (folderRowBox!.y + 17))).toBeLessThan(2);

    await page.keyboard.press('Escape');
    const chatRow = drawer.getByRole('button', {name: 'Open chat: Planning a product launch'}).locator('..');
    const chatRowBox = await chatRow.boundingBox();
    expect(chatRowBox).not.toBeNull();
    const chatClickX = chatRowBox!.width - 60;
    await chatRow.click({button: 'right', position: {x: chatClickX, y: 17}});

    menu = drawer.getByRole('menu');
    await expect(menu.getByRole('menuitem')).toHaveText(['Pin Chat', 'Rename', 'Share', 'Duplicate', 'Move to folder', 'Archive']);
    menuBox = await menu.boundingBox();
    expect(menuBox).not.toBeNull();
    expect(Math.abs(menuBox!.x - (chatRowBox!.x + chatClickX))).toBeLessThan(2);
    expect(Math.abs(menuBox!.y - (chatRowBox!.y + 17))).toBeLessThan(2);
  });

  test('shows a running ring in the row action slot and swaps it for more actions on hover', async ({page}) => {
    await page.goto('/?coldStart=0');
    await send(page, '__demo_run_2400__');
    const drawer = chatDrawer(page);
    const row = drawer.getByRole('button', {name: 'Open chat: __demo_run_2400__'}).locator('..');
    const ring = row.locator('.chat-drawer-running-ring');
    const more = row.getByRole('button', {name: /More actions:/});

    await expect(row).toHaveClass(/running/);
    await expect(ring).toBeVisible();
    await expect(ring).toHaveCSS('opacity', '1');
    await expect(more).toHaveCSS('opacity', '0');
    await row.hover();
    await expect(ring).toHaveCSS('opacity', '0');
    await expect(more).toHaveCSS('opacity', '1');

    await page.mouse.move(420, 420);
    await expect(row).not.toHaveClass(/running/, {timeout: 4000});
    await expect(row.locator('.chat-drawer-running-ring')).toHaveCount(0);
  });

  test('archives a chat from its row menu and restores or deletes it in Settings', async ({page}) => {
    await page.goto('/');
    const drawer = chatDrawer(page);
    const row = drawer.locator('.chat-drawer-row').first();
    await expect(row).toBeVisible();
    const title = (await row.getByRole('button', {name: /Open chat:/}).getAttribute('aria-label'))?.replace(/^Open chat:\s*/, '') ?? '';
    expect(title).not.toBe('');
    const before = await drawer.locator('.chat-drawer-row').count();

    await row.hover();
    const more = row.getByRole('button', {name: /More actions/});
    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    const menu = drawer.getByRole('menu');
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', {name: 'Archive'}).click();
    await expect(drawer.locator('.chat-drawer-row')).toHaveCount(before - 1);
    await expect(drawer.getByRole('button', {name: `Open chat: ${title}`})).toHaveCount(0);

    await page.getByRole('button', {name: 'Settings'}).click();
    const settings = page.getByRole('region', {name: 'Settings'});
    await settings.getByRole('tab', {name: 'Archived chats'}).click();
    await expect(settings.getByRole('heading', {name: 'Archived chats'})).toBeVisible();
    await expect(settings.getByRole('searchbox', {name: 'Search archived chats'})).toBeVisible();
    await expect(settings.getByText(title, {exact: true})).toBeVisible();

    await settings.getByRole('searchbox', {name: 'Search archived chats'}).fill('zzzz-no-match');
    await expect(settings.getByText(/No archived chats match/)).toBeVisible();
    await settings.getByRole('button', {name: 'Clear'}).click();
    await expect(settings.getByText(title, {exact: true})).toBeVisible();

    await settings.getByRole('button', {name: `Unarchive ${title}`}).click();
    await expect(settings.getByText(title, {exact: true})).toHaveCount(0);
    await expect(drawer.getByRole('button', {name: `Open chat: ${title}`})).toBeVisible();

    const restored = drawer.getByRole('button', {name: `Open chat: ${title}`}).locator('..');
    await restored.hover();
    await restored.getByRole('button', {name: /More actions/}).click();
    await drawer.getByRole('menu').getByRole('menuitem', {name: 'Archive'}).click();
    await expect(drawer.getByRole('button', {name: `Open chat: ${title}`})).toHaveCount(0);

    await expect(settings.getByText(title, {exact: true})).toBeVisible();
    await settings.getByRole('button', {name: `Delete ${title}`}).click();
    await settings.getByRole('button', {name: `Delete permanently ${title}`}).click();
    await expect(settings.getByText(title, {exact: true})).toHaveCount(0);
    await expect(drawer.getByRole('button', {name: `Open chat: ${title}`})).toHaveCount(0);
  });

  test('resizes with the keyboard within its bounds', async ({page}) => {
    await page.goto('/');
    const handle = page.getByRole('button', {name: 'Resize Chats'});
    await handle.focus();
    await page.keyboard.press('ArrowRight');
    await expect(chatDrawer(page)).not.toHaveCSS('width', '240px');
  });

  test('keeps its divider and adjacent content on the pointer while dragging', async ({page}) => {
    await page.setViewportSize({width: 1300, height: 800});
    await page.goto('/');
    await send(page, 'in step');
    await page.waitForTimeout(500);

    await dragDrawerDivider(
      page,
      page.getByRole('button', {name: 'Resize Chats'}),
      chatDrawer(page),
      'right',
      1,
      'chat-drawer-resizing',
    );
  });

  test('dragging past the chat max into the window half minimises an expanded workspace', async ({page}) => {
    await page.setViewportSize({width: 1300, height: 800});
    await page.goto('/');
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    await page.getByRole('button', {name: 'Expand Workspace'}).click();
    await expect(page.locator('main')).toHaveClass(/workspace-expanded/);
    await expect(chatDrawer(page)).toHaveClass(/open/);

    const handle = page.getByRole('button', {name: 'Resize Chats'});
    const [drawerBox, handleBox] = await Promise.all([chatDrawer(page).boundingBox(), handle.boundingBox()]);
    expect(drawerBox).not.toBeNull();
    expect(handleBox).not.toBeNull();
    const startX = drawerBox!.x + drawerBox!.width - .5;
    const y = handleBox!.y + handleBox!.height / 2;
    const halfway = 1300 / 2;

    // Reaching the chat max is still a resize: the workspace stays expanded
    // and the drawer sits on its ceiling rather than jumping width.
    await page.mouse.move(startX, y);
    await page.mouse.down();
    await expect(page.locator('main')).toHaveClass(/chat-drawer-resizing/);
    await page.mouse.move(MAX_CHAT_DRAWER_WIDTH + 8, y, {steps: 8});
    await expect(page.locator('main')).toHaveClass(/workspace-expanded/);
    await expect(chatDrawer(page)).toHaveCSS('width', `${MAX_CHAT_DRAWER_WIDTH}px`);

    // Crossing the window midpoint completes the gesture immediately.
    await page.mouse.move(halfway + 8, y, {steps: 8});
    await expect(page.locator('main')).not.toHaveClass(/workspace-expanded/);
    await expect(page.locator('main')).toHaveClass(/workspace-open/);
    await expect(chatDrawer(page)).toHaveCSS('width', `${MIN_CHAT_DRAWER_WIDTH}px`);
    await expect(page.locator('main')).not.toHaveClass(/chat-drawer-resizing/);
    await page.mouse.up();
  });

  test('drawers yield to the conversation floor instead of squeezing the composer', async ({page}) => {
    // This is the renderer's split-layout threshold: both drawer floors, the
    // conversation floor and its 1px handover boundary.
    await page.setViewportSize({width: SPLIT_LAYOUT_MIN_WIDTH, height: 640});
    await page.goto('/');
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    // Both drawers settle at their readable floors with a single spare pixel.
    const drawer = chatDrawer(page);
    await expect(drawer).toHaveCSS('width', `${MIN_CHAT_DRAWER_WIDTH}px`);
    const headingGap = () => drawer.locator('.chat-drawer-heading').evaluate((heading) => {
      const navigationButtons = [...heading.querySelectorAll<HTMLElement>('.chat-drawer-mode-switch button')];
      const navigationRight = Math.max(...navigationButtons.map((button) => button.getBoundingClientRect().right));
      const actionsLeft = heading.querySelector('.chat-drawer-heading-actions')!.getBoundingClientRect().left;
      return actionsLeft - navigationRight;
    });
    expect(await headingGap()).toBeGreaterThanOrEqual(0);
    await drawer.getByRole('button', {name: 'Team', exact: true}).click();
    expect(await headingGap()).toBeGreaterThanOrEqual(0);
    await drawer.getByRole('button', {name: 'Assistant', exact: true}).click();
    // One row of these buttons is under 20px tall; a wrap doubles it.
    const toolbarOnOneLine = () => page.locator('.polymux-prompt-toolbar').evaluate((bar) =>
      bar.getBoundingClientRect().height < 24);
    expect(await toolbarOnOneLine()).toBe(true);
    // The workspace and conversation are already at their floors, so the chat
    // drawer can consume only the single spare pixel.
    const handle = page.getByRole('button', {name: 'Resize Chats'});
    await handle.focus();
    for (let step = 0; step < 4; step += 1) await page.keyboard.press('ArrowRight');
    await expect(chatDrawer(page)).toHaveCSS('width', `${MIN_CHAT_DRAWER_WIDTH + 1}px`);
    await expect(workspaceDrawer(page)).toHaveCSS('width', '480px');
    expect(await toolbarOnOneLine()).toBe(true);
  });
});

test.describe('workspace drawer', () => {
  test('collapses only after its divider is dragged through half its width', async ({page}) => {
    await page.setViewportSize({width: 1300, height: 800});
    await page.goto('/');
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    await page.waitForTimeout(500);

    const drawer = workspaceDrawer(page);
    const handle = page.getByRole('button', {name: 'Resize Workspace'});
    const [drawerBox, handleBox] = await Promise.all([drawer.boundingBox(), handle.boundingBox()]);
    expect(drawerBox).not.toBeNull();
    expect(handleBox).not.toBeNull();
    const startX = drawerBox!.x - .5;
    const y = handleBox!.y + handleBox!.height / 2;

    // Stopping just before halfway keeps the workspace open at its readable
    // width floor.
    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX + drawerBox!.width / 2 - 8, y, {steps: 4});
    await page.mouse.up();
    await expect(drawer).toHaveClass(/open/);
    await expect(drawer).toHaveCSS('width', '480px');

    // Crossing the midpoint completes the gesture immediately.
    await page.mouse.move(startX, y);
    await page.mouse.down();
    await expect(page.locator('main')).toHaveClass(/workspace-resizing/);
    await page.mouse.move(startX + drawerBox!.width / 2 + 8, y, {steps: 4});
    await expect(drawer).not.toHaveClass(/open/);
    await expect(page.locator('main')).not.toHaveClass(/workspace-resizing/);
    await page.mouse.up();

    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    await expect(drawer).toHaveClass(/open/);
    await expect(drawer.locator('.workspace-launcher')).toBeVisible();
  });

  test('dragging past the workspace max into the left half of the main pane expands the workspace', async ({page}) => {
    await page.setViewportSize({width: 1600, height: 800});
    await page.goto('/?coldStart=0');
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    await page.waitForTimeout(500);
    await expect(page.locator('main')).toHaveClass(/workspace-open/);
    await expect(page.locator('main')).not.toHaveClass(/workspace-expanded/);
    await expect(workspaceDrawer(page)).toHaveCSS('width', '480px');

    const handle = page.getByRole('button', {name: 'Resize Workspace'});
    const [drawerBox, handleBox] = await Promise.all([workspaceDrawer(page).boundingBox(), handle.boundingBox()]);
    expect(drawerBox).not.toBeNull();
    expect(handleBox).not.toBeNull();
    const startX = drawerBox!.x - .5;
    const y = handleBox!.y + handleBox!.height / 2;
    const windowHalf = 1600 / 2;
    const maxLeft = 1600 - MAX_WORKSPACE_WIDTH;

    // Past the max, the docked edge stays on the ceiling. The pointer can
    // keep travelling without the drawer following it.
    await page.mouse.move(startX, y);
    await page.mouse.down();
    await expect(page.locator('main')).toHaveClass(/workspace-resizing/);
    await page.mouse.move(maxLeft, y, {steps: 8});
    await expect(page.locator('main')).not.toHaveClass(/workspace-expanded/);
    await expect(workspaceDrawer(page)).toHaveCSS('width', `${MAX_WORKSPACE_WIDTH}px`);
    const atMax = await page.evaluate(() => {
      const main = document.querySelector('main')!;
      const style = getComputedStyle(main);
      const conversation = document.querySelector('.conversation-column')!.getBoundingClientRect();
      return {
        rightColumn: Number.parseFloat(style.getPropertyValue('--content-right-column')),
        conversation: conversation.width,
        conversationMid: conversation.left + conversation.width / 2,
        drawer: document.querySelector('aside.workspace-drawer')!.getBoundingClientRect().width,
      };
    });
    expect(atMax.rightColumn).toBe(MAX_WORKSPACE_WIDTH);
    expect(atMax.drawer).toBe(MAX_WORKSPACE_WIDTH);
    expect(atMax.conversationMid).toBeLessThan(windowHalf);

    await page.mouse.move(maxLeft - 8, y, {steps: 8});
    await expect(page.locator('main')).not.toHaveClass(/workspace-expanded/);
    const heldAtMax = await page.evaluate(() => {
      const main = document.querySelector('main')!;
      const style = getComputedStyle(main);
      return {
        rightColumn: Number.parseFloat(style.getPropertyValue('--content-right-column')),
        conversation: document.querySelector('.conversation-column')!.getBoundingClientRect().width,
        drawer: document.querySelector('aside.workspace-drawer')!.getBoundingClientRect().width,
      };
    });
    expect(heldAtMax.rightColumn).toBe(MAX_WORKSPACE_WIDTH);
    expect(heldAtMax.conversation).toBe(atMax.conversation);
    expect(heldAtMax.drawer).toBe(MAX_WORKSPACE_WIDTH);

    // The window midpoint still sits in the right half of the conversation,
    // so crossing it must not expand — and the edge still must not follow.
    await page.mouse.move(windowHalf - 8, y, {steps: 8});
    await expect(page.locator('main')).not.toHaveClass(/workspace-expanded/);
    await expect(workspaceDrawer(page)).toHaveCSS('width', `${MAX_WORKSPACE_WIDTH}px`);

    // Crossing the conversation centre completes the gesture immediately.
    await page.mouse.move(atMax.conversationMid - 8, y, {steps: 8});
    await expect(page.locator('main')).toHaveClass(/workspace-expanded/);
    await expect(page.locator('main')).toHaveClass(/workspace-open/);
    await expect(page.locator('main')).not.toHaveClass(/workspace-resizing/);
    await page.mouse.up();
  });

  test('does not resize narrower than its 480px floor', async ({page}) => {
    await page.setViewportSize({width: 1300, height: 800});
    await page.goto('/');
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();

    const handle = page.getByRole('button', {name: 'Resize Workspace'});
    await handle.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(workspaceDrawer(page)).toHaveCSS('width', '496px');
    await page.keyboard.press('ArrowRight');
    await expect(workspaceDrawer(page)).toHaveCSS('width', '480px');
    await page.keyboard.press('ArrowRight');
    await expect(workspaceDrawer(page)).toHaveCSS('width', '480px');
  });

  test('keeps its divider and adjacent content on the pointer while dragging', async ({page}) => {
    await page.setViewportSize({width: 1300, height: 800});
    await page.goto('/');
    await send(page, 'in step');
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    await page.waitForTimeout(500);

    await dragDrawerDivider(
      page,
      page.getByRole('button', {name: 'Resize Workspace'}),
      workspaceDrawer(page),
      'left',
      -1,
      'workspace-resizing',
    );
  });

  test('keeps one divider between workspace chrome and tab content', async ({page}) => {
    await page.goto('/?coldStart=0');
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();

    const drawer = workspaceDrawer(page);
    const content = drawer.locator('.workspace-content');
    await expect(content).toHaveClass(/empty/);
    await expect(content).toHaveCSS('border-top-width', '0px');

    await drawer.getByRole('button', {name: 'Browser'}).click();
    await expect(content).not.toHaveClass(/empty/);
    await expect(content).toHaveClass(/browser/);
    await expect(content).toHaveCSS('border-top-width', '1px');
    await expect(drawer.locator('.browser-bar')).toHaveCSS('border-bottom-width', '1px');

    await drawer.getByLabel('New tab', {exact: true}).click();
    await expect(content).toHaveClass(/empty/);
    await expect(content).toHaveCSS('border-top-width', '1px');
    await drawer.locator('.workspace-launcher').getByRole('button', {name: 'Drive'}).click();
    await expect(content).not.toHaveClass(/browser/);
    await expect(content).toHaveCSS('border-top-width', '1px');
    await expect(drawer.locator('.fb')).toHaveCSS('border-top-width', '0px');

  });

  test('fits the browser page below its chrome without clipping the bottom', async ({page}) => {
    await page.goto('/?coldStart=0');
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    const drawer = workspaceDrawer(page);
    await drawer.getByRole('button', {name: 'Browser'}).click();

    const fit = await drawer.locator('.workspace-content').evaluate((content) => {
      const chrome = content.querySelector('.browser-bar')!.getBoundingClientRect();
      const frame = content.querySelector('.browser-frame')!.getBoundingClientRect();
      const bounds = content.getBoundingClientRect();
      return {
        top: Math.abs(frame.top - chrome.bottom),
        bottom: Math.abs(frame.bottom - bounds.bottom),
      };
    });
    expect(fit.top).toBeLessThanOrEqual(1);
    expect(fit.bottom).toBeLessThanOrEqual(1);
  });

  test('keeps passkey account choice in browser chrome and returns only the selected id', async ({page}) => {
    await page.goto('/?coldStart=0');
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    const drawer = workspaceDrawer(page);
    await drawer.getByRole('button', {name: 'Browser'}).click();

    const tabId = await drawer.locator('.browser-bar').getAttribute('data-browser-tab-id');
    expect(tabId).toBeTruthy();
    await page.evaluate((id) => {
      (window as unknown as {polymuxDemoRequestPasskey: (tabId: string) => void})
        .polymuxDemoRequestPasskey(id!);
    }, tabId);

    const prompt = drawer.getByRole('dialog', {name: 'Choose a passkey for github.com'});
    await expect(prompt).toBeVisible();
    await expect(prompt.getByRole('button', {name: /Carlvince/})).toContainText('carlvince@example.com');
    await prompt.getByRole('button', {name: /Work/}).click();
    await expect(prompt).toHaveCount(0);

    const answer = await page.evaluate(() =>
      (window as unknown as {
        polymuxDemoPasskeyAnswer: () => {id: string; credentialId?: string} | null;
      }).polymuxDemoPasskeyAnswer());
    expect(answer).toEqual({id: 'demo-passkey-prompt', credentialId: 'work-passkey'});
  });

  test('offers recent pages and search suggestions from the address bar with keyboard navigation', async ({page}) => {
    await page.goto('/?coldStart=0');
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    const drawer = workspaceDrawer(page);
    await drawer.getByRole('button', {name: 'Browser'}).click();

    const address = drawer.getByRole('combobox', {name: 'Address'});
    const suggestions = drawer.getByRole('listbox', {name: 'Address suggestions'});
    await address.focus();
    await expect(suggestions).toBeVisible();
    await expect(suggestions.getByText('Recently visited', {exact: true})).toBeVisible();

    await suggestions.getByRole('option').filter({hasText: 'Anthropic · GitHub'}).click();
    await expect(drawer.locator('iframe.browser-frame')).toHaveAttribute('src', 'https://github.com/anthropics');
    await expect(suggestions).toHaveCount(0);

    await address.fill('notion');
    await expect(suggestions).toBeVisible();
    await expect(suggestions.getByText('Search suggestions', {exact: true})).toBeVisible();
    await expect(suggestions.getByRole('option').filter({hasText: 'notion login'})).toBeVisible();
    await expect(suggestions.getByRole('option')).toHaveCount(7);

    for (let index = 0; index < 7; index += 1) await address.press('ArrowDown');
    const selectedAtBottom = suggestions.locator('[role="option"][aria-selected="true"]');
    const visibility = await Promise.all([suggestions.boundingBox(), selectedAtBottom.boundingBox()]);
    expect(visibility[0]).not.toBeNull();
    expect(visibility[1]).not.toBeNull();
    expect(visibility[1]!.y).toBeGreaterThanOrEqual(visibility[0]!.y);
    expect(visibility[1]!.y + visibility[1]!.height).toBeLessThanOrEqual(visibility[0]!.y + visibility[0]!.height + 1);

    await address.press('Escape');
    await expect(suggestions).toHaveCount(0);
    await address.fill('notion');
    await expect(suggestions.getByRole('option')).toHaveCount(7);

    // The list opens with its top row already highlighted, so the first
    // ArrowDown steps off that row rather than onto it.
    await expect(suggestions.getByRole('option').filter({hasText: 'Roadmap'})).toHaveAttribute('aria-selected', 'true');
    await address.press('ArrowDown');
    const firstSearch = suggestions.locator('.address-suggestion:has(svg[data-icon="search"])').first();
    await expect(firstSearch).toContainText('notion');
    await expect(firstSearch).toHaveAttribute('aria-selected', 'true');
    await address.press('Enter');
    await expect(drawer.locator('iframe.browser-frame')).toHaveAttribute('src', 'https://www.google.com/search?q=notion');
    await expect(suggestions).toHaveCount(0);
  });

  test('separate workspace opens directly with only its tabs and new-tab control', async ({page}) => {
    await page.goto('/?workspaceView=drive&coldStart=0');

    const drawer = workspaceDrawer(page);
    await expect(drawer).toHaveClass(/open/);
    await expect(drawer).toHaveClass(/expanded/);
    await expect(drawer.locator('.fb')).toBeVisible();
    const leftSpacing = await drawer.locator('.tab').first().evaluate((tab) => {
      const chromeInset = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--chrome-inset'));
      return tab.getBoundingClientRect().left - chromeInset;
    });
    expect(leftSpacing).toBe(8);
    await expect(page.getByRole('button', {name: 'Toggle Chats'})).toHaveCount(0);
    // The app's own settings button still lives in the drawer footer, so only
    // an exactly named Settings control counts as the main panel's chrome.
    await expect(page.getByRole('button', {name: 'Settings', exact: true})).toHaveCount(0);
    await expect(page.getByRole('button', {name: 'Toggle Workspace'})).toHaveCount(0);
    const newTab = drawer.getByRole('button', {name: 'New Tab'});
    await expect(newTab).toBeVisible();
    await newTab.click();
    await expect(drawer.locator('.tab.active')).toContainText('New tab');
    await expect(drawer.locator('.workspace-launcher')).toBeVisible();
    await expect(drawer.getByRole('menu')).toHaveCount(0);
  });

  test('releases global tab availability when its separate window closes', async ({page, context}) => {
    await page.goto('/?workspaceView=drive&coldStart=0');
    await expect(workspaceDrawer(page).locator('.fb')).toBeVisible();
    const hubWindow = await context.newPage();
    await hubWindow.goto('/?workspaceView=hub&coldStart=0');
    await expect(workspaceDrawer(hubWindow).locator('.hub-view')).toBeVisible();
    const tasksWindow = await context.newPage();
    await tasksWindow.goto('/?workspaceView=tasks&coldStart=0');
    await expect(workspaceDrawer(tasksWindow).locator('.tasks-view')).toBeVisible();

    const main = await context.newPage();
    await main.goto('/?coldStart=0');
    await main.getByRole('button', {name: 'Toggle Workspace'}).click();
    const drawer = workspaceDrawer(main);
    await drawer.getByRole('button', {name: 'Browser'}).click();
    await drawer.getByLabel('New tab', {exact: true}).click();
    const launcher = drawer.locator('.workspace-launcher');
    await expect(launcher.getByRole('button', {name: 'Drive'})).toHaveCount(0);
    await expect(launcher.getByRole('button', {name: 'Hub'})).toHaveCount(0);
    await expect(launcher.getByRole('button', {name: 'Tasks'})).toHaveCount(0);

    await page.close();
    await expect(launcher.getByRole('button', {name: 'Drive'})).toBeVisible();
    await expect(launcher.getByRole('button', {name: 'Hub'})).toHaveCount(0);
    await expect(launcher.getByRole('button', {name: 'Tasks'})).toHaveCount(0);

    await hubWindow.close();
    await expect(launcher.getByRole('button', {name: 'Hub'})).toBeVisible();
    await expect(launcher.getByRole('button', {name: 'Tasks'})).toHaveCount(0);

    await tasksWindow.close();
    await expect(launcher.getByRole('button', {name: 'Tasks'})).toBeVisible();
  });

  test('reorders workspace tabs by dragging them across the strip', async ({page}) => {
    await page.goto('/?coldStart=0');
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    const drawer = workspaceDrawer(page);
    await drawer.getByRole('button', {name: 'Drive'}).click();
    await drawer.getByRole('button', {name: 'New Tab'}).click();
    await drawer.locator('.workspace-launcher').getByRole('button', {name: 'Hub'}).click();

    const tabs = drawer.locator('.tab');
    await expect(tabs.locator('.tab-main')).toHaveText(['Drive', 'Hub']);
    await tabs.first().dragTo(tabs.last());
    await expect(tabs.locator('.tab-main')).toHaveText(['Hub', 'Drive']);
  });

  test('pulling a singleton tab outside the window detaches it', async ({page}) => {
    await page.goto('/?coldStart=0');
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    const drawer = workspaceDrawer(page);
    await drawer.getByRole('button', {name: 'Drive'}).click();
    const tab = drawer.locator('.tab').first();

    await tab.dispatchEvent('dragstart');
    await tab.dispatchEvent('dragend', {screenX: -10, screenY: -10});
    await expect(drawer.locator('.tab')).toHaveCount(0);
  });

  test('shows typed tabs, switches, expands and closes them', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    const drawer = workspaceDrawer(page);
    await expect(drawer).toHaveClass(/open/);
    await drawer.getByRole('button', {name: 'Drive'}).click();

    const tab = drawer.locator('.tab').first();
    await expect(tab).toHaveClass(/active/);
    await expect(tab).toHaveCSS('width', '156px');
    await expect(drawer.locator('.fb')).toBeVisible();

    await page.getByRole('button', {name: 'Expand Workspace'}).click();
    await expect(drawer).toHaveClass(/expanded/);
    await expect(page.locator('main')).toHaveClass(/workspace-expanded/);
    await page.getByRole('button', {name: 'Minimise Workspace'}).click();
    await expect(drawer).not.toHaveClass(/expanded/);

    await tab.hover();
    await tab.getByRole('button', {name: /^Close /}).click();
    await expect(drawer.locator('.tab')).toHaveCount(0);
  });

  test('keeps its divider on the pixel grid while it expands', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    const drawer = workspaceDrawer(page);
    await expect(drawer).toHaveClass(/open/);
    await page.waitForTimeout(500);

    // A fractional left edge anti-aliases the one-pixel divider across two
    // pixels at partial alpha, which at its weight reads as the edge vanishing
    // for the length of the slide. Every frame of the expansion lands on a
    // whole pixel instead.
    await page.getByRole('button', {name: 'Expand Workspace'}).click();
    const edges: number[] = [];
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(70);
      edges.push((await drawer.boundingBox())!.x);
    }
    expect(edges.every(Number.isInteger)).toBe(true);
    expect(edges[edges.length - 1]).toBeLessThan(edges[0]);
    await page.waitForTimeout(500);
    const chats = (await chatDrawer(page).boundingBox())!;
    expect((await drawer.boundingBox())!.x).toBe(chats.x + chats.width);
  });

  test('offers the launcher when nothing is open, and opens a typed view', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    const drawer = workspaceDrawer(page);

    await expect(drawer.locator('.workspace-launcher')).toBeVisible();
    await drawer.getByRole('button', {name: 'Tasks'}).click();
    await expect(drawer.locator('.tasks-view')).toBeVisible();
  });

  test('schedule orders unread results first and finished rows last', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    const drawer = workspaceDrawer(page);
    await drawer.getByRole('button', {name: 'Tasks'}).click();

    const rows = drawer.locator('.tasks-schedule-card');
    // Unread results at the top, then what is coming up, then the rows that
    // are finished with.
    await expect(rows.nth(0).locator('.tasks-unread')).toBeVisible();
  });

  test('schedule is written in a sheet, with its own prompt and cadence', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    const drawer = workspaceDrawer(page);
    await drawer.getByRole('button', {name: 'Tasks'}).click();
    await drawer.getByRole('button', {name: 'Add task'}).click();
    await drawer.locator('.tasks-composer-input').nth(0).fill('Evening wrap-up');
    await drawer.locator('.tasks-composer-input').nth(1).fill('Summarise what changed today.');
    await drawer.locator('.tasks-recurring-toggle input').check();
    await drawer.locator('.tasks-composer-submit').click();
    const sheet = drawer.locator('.schedule-composer');
    await expect(sheet).toBeVisible();
    // It takes the whole view rather than floating over the list.
    await expect(drawer.locator('.schedule-row')).toHaveCount(0);
    // The task composer carries both fields into the full cadence sheet.
    await expect(sheet.locator('input[type="text"]').first()).toHaveValue('Evening wrap-up');
    await expect(sheet.locator('textarea')).toHaveValue('Summarise what changed today.');
    await sheet.getByRole('button', {name: 'Save'}).click();

    await expect(sheet).toHaveCount(0);
    await expect(drawer.locator('.tasks-schedule-card', {hasText: 'Evening wrap-up'})).toBeVisible();
  });

  test('schedule time picker stays on screen when it opens near the bottom', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    const drawer = workspaceDrawer(page);
    await drawer.getByRole('button', {name: 'Tasks'}).click();
    await drawer.locator('.tasks-schedule-card').first().click();

    const sheet = drawer.locator('.schedule-composer');
    // The time row sits low in the sheet and its list carries forty-eight
    // rows, which is the case that used to run off the bottom of the window.
    await sheet.getByRole('button', {name: 'Time of day'}).click();
    const list = sheet.locator('.select-menu-list');
    await expect(list).toBeVisible();

    const box = (await list.boundingBox())!;
    const trigger = (await sheet.getByRole('button', {name: 'Time of day'}).boundingBox())!;
    const viewport = page.viewportSize()!;
    // Below the trigger, always — never flipped above it.
    expect(box.y).toBeGreaterThanOrEqual(trigger.y);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    // And it stays a short list: the fit is achieved by scrolling within the
    // row cap, not by growing the box to fill the window.
    expect(box.height).toBeLessThanOrEqual(220);
  });

  test('schedule editing opens the same sheet, filled in', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    const drawer = workspaceDrawer(page);
    await drawer.getByRole('button', {name: 'Tasks'}).click();

    // The cadence cell drops out at narrow widths, so the row menu is the way
    // in that is always there. Both open the same sheet.
    await drawer.locator('.tasks-schedule-card', {hasText: 'Morning brief'}).click();
    const sheet = drawer.locator('.schedule-composer');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('input[type="text"]').first()).toHaveValue('Morning brief');
    await expect(sheet.locator('textarea')).toHaveValue(/Summarise my inbox/);
    // The weekdays read as one dropdown rather than seven toggles.
    await expect(sheet.getByRole('button', {name: 'Days of the week'})).toContainText('weekdays');

    await sheet.locator('input[type="text"]').first().fill('Morning brief v2');
    await sheet.getByRole('button', {name: 'Save'}).click();
    await expect(drawer.locator('.tasks-schedule-card', {hasText: 'Morning brief v2'})).toBeVisible();
  });

  test('schedule cadence can be written as cron, and previews its next runs', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    const drawer = workspaceDrawer(page);
    await drawer.getByRole('button', {name: 'Tasks'}).click();
    await drawer.getByRole('button', {name: 'Add task'}).click();
    await drawer.locator('.tasks-composer-input').nth(0).fill('Queue sweep');
    await drawer.locator('.tasks-composer-input').nth(1).fill('Check the queue.');
    await drawer.locator('.tasks-recurring-toggle input').check();
    await drawer.locator('.tasks-composer-submit').click();

    const sheet = drawer.locator('.schedule-composer');
    // The gear carries the picked cadence across rather than starting blank.
    await sheet.getByRole('button', {name: 'Advanced'}).click();
    const cron = sheet.locator('.schedule-cron-input');
    await expect(cron).toHaveValue('0 9 * * *');
    await expect(sheet.locator('.schedule-cron-next em').first()).toBeVisible();

    // A bad expression says what is wrong and blocks the save.
    await cron.fill('0 0 * *');
    await expect(sheet.locator('.schedule-cron-error')).toContainText('five fields');
    await expect(sheet.getByRole('button', {name: 'Save'})).toBeDisabled();

    await cron.fill('*/15 9-17 * * 1-5');
    await expect(sheet.locator('.schedule-cron-error')).toHaveCount(0);
    await sheet.getByRole('button', {name: 'Save'}).click();

    const row = drawer.locator('.tasks-schedule-card', {hasText: 'Queue sweep'});
    await expect(row).toBeVisible();
    await expect(row).toContainText('*/15 9-17 * * 1-5');
  });

  test('offers the pages already visited, and opens one', async ({page}) => {
    await page.addInitScript(() => {
      localStorage.setItem('polymuxBrowserHistory', JSON.stringify([
        {url: 'https://example.com/one', title: 'Example One'},
        {url: 'https://example.com/two', title: 'Example Two'},
        {url: 'https://example.com/three', title: 'Example Three'},
      ]));
    });
    await page.goto('/');
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    const drawer = workspaceDrawer(page);

    await expect(drawer.locator('.workspace-launcher-heading').last()).toHaveText('Recent');
    await expect(recentRows(drawer)).toHaveCount(3);

    await drawer.getByRole('button', {name: 'Example Two'}).click();
    await expect(drawer.locator('.tab')).toHaveCount(1);
    await expect(drawer.locator('.tab')).toContainText('Example Two');
  });

  test('an icon stored with a visit is not trusted, since it was chosen for a theme', async ({page}) => {
    await page.addInitScript(() => {
      // A 1x1 black png: perfectly decodable, and exactly the kind of value
      // older builds wrote alongside the visit.
      const stored = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      localStorage.setItem('polymuxBrowserHistory', JSON.stringify([
        {url: 'https://example.com/one', title: 'Example One', favicon: stored},
        {url: 'https://example.com/two', title: 'Example Two'},
        {url: 'https://example.com/three', title: 'Example Three'},
      ]));
    });
    await page.goto('/');
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    const drawer = workspaceDrawer(page);

    await expect(recentRows(drawer)).toHaveCount(3);
    // Sites serve one mark per colour scheme, so stored bytes are dropped on
    // load and the icon is asked for again. This build has no main process to
    // ask, so every row keeps the globe rather than showing a mark chosen under
    // a theme nobody is in any more.
    await expect(recentRows(drawer).locator('.tab-favicon img')).toHaveCount(0);
    await expect(recentRows(drawer).locator('.tab-favicon svg')).toHaveCount(3);
  });

  test('leaves search-result pages out of the recent list', async ({page}) => {
    await page.addInitScript(() => {
      localStorage.setItem('polymuxBrowserHistory', JSON.stringify([
        {url: 'https://www.google.com/search?q=nus+chatgpt+edu', title: 'nus chatgpt edu - Google Search'},
        {url: 'https://duckduckgo.com/?q=ai+events+singapore', title: 'ai events singapore at DuckDuckGo'},
        {url: 'https://www.bing.com/search?q=luma+ai', title: 'luma ai - Search'},
        {url: 'https://example.com/one', title: 'Example One'},
        {url: 'https://lumalabs.ai/dream-machine', title: 'Luma AI'},
        {url: 'https://docs.google.com/document/d/abc', title: 'A shared doc'},
      ]));
    });
    await page.goto('/');
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    const drawer = workspaceDrawer(page);

    await expect(drawer.locator('.workspace-launcher-heading').last()).toHaveText('Recent');
    await expect(recentRows(drawer)).toHaveCount(3);
    await expect(recentRows(drawer)).toHaveText([
      'Example One',
      'Luma AI',
      'A shared doc',
    ]);
  });

  test('a recent row shows an open arrow on hover and shortens the title to fit it', async ({page}) => {
    await page.addInitScript(() => {
      localStorage.setItem('polymuxBrowserHistory', JSON.stringify([
        {url: 'https://example.com/long', title: 'Polymux vs Hermes Agent, OpenClaw, and Khoj: four takes on the personal assistant'},
        {url: 'https://example.com/two', title: 'Example Two'},
      ]));
    });
    await page.goto('/');
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    const drawer = workspaceDrawer(page);
    const row = recentRows(drawer).first();
    const title = row.locator('.workspace-launcher-recent-title');
    const arrow = row.locator('.workspace-launcher-recent-open');

    await expect(drawer.getByRole('button', {name: 'Browser'}).locator('.workspace-launcher-recent-open')).toHaveCount(0);
    await expect(arrow).toHaveCSS('opacity', '0');
    const restWidth = await title.evaluate((node) => node.getBoundingClientRect().width);

    await row.hover();
    await expect(arrow).toHaveCSS('opacity', '1');
    await expect.poll(async () => title.evaluate((node) => node.getBoundingClientRect().width)).toBeLessThan(restWidth);

    const titleBox = await title.boundingBox();
    const arrowBox = await arrow.boundingBox();
    expect(titleBox).not.toBeNull();
    expect(arrowBox).not.toBeNull();
    expect(arrowBox!.x).toBeGreaterThan(titleBox!.x + titleBox!.width);
    expect(arrowBox!.x + arrowBox!.width).toBeLessThanOrEqual(titleBox!.x + restWidth + 1);
  });

  test('offers however few pages have been visited, and no section at all with none', async ({page}) => {
    await page.addInitScript(() => {
      localStorage.setItem('polymuxBrowserHistory', JSON.stringify([
        {url: 'https://example.com/one', title: 'Example One'},
        {url: 'https://example.com/two', title: 'Example Two'},
      ]));
    });
    await page.goto('/');
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();

    const drawer = workspaceDrawer(page);
    await expect(drawer.locator('.workspace-launcher-heading').last()).toHaveText('Recent');
    await expect(recentRows(drawer)).toHaveCount(2);
  });

  test('leaves the launcher on the views alone when nothing has been visited', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();

    const drawer = workspaceDrawer(page);
    // Only "Open": an empty Recent heading over nothing is chrome, not a list.
    await expect(drawer.locator('.workspace-launcher-heading')).toHaveText(['Open']);
    await expect(drawer.getByRole('button', {name: 'Browser'})).toBeVisible();
  });

  test('a row dragged onto a folder moves into it', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    const drawer = workspaceDrawer(page);
    await drawer.getByRole('button', {name: 'Drive'}).click();

    const row = (name: string) => drawer.locator('.fb-row').filter({hasText: name});
    await expect(row('Launch brief.docx')).toBeVisible();

    await row('Launch brief.docx').dragTo(row('Reports'));
    await expect(drawer.locator('.fb-row.transferring')).toHaveCount(0);
    await expect(row('Launch brief.docx')).toHaveCount(0);

    // And it is in the folder it was dropped on, not merely gone from here.
    await row('Reports').dblclick();
    await expect(row('Launch brief.docx')).toBeVisible();
  });

  test('header actions ride the panel rather than appearing before it lands', async ({page}) => {
    await page.goto('/');
    const action = page.locator('.workspace-header-action').first();
    await expect(action).toHaveCSS('visibility', 'hidden');
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    await expect(action).toHaveCSS('visibility', 'visible');
    if (await page.locator('.workspace-header-action').count() === 1) {
      await workspaceDrawer(page).getByRole('button', {name: 'Drive'}).click();
    }

    const headerActions = await page.locator('.workspace-header-action').evaluateAll((nodes) =>
      nodes.map((node) => {
        const button = node.getBoundingClientRect();
        const icon = node.querySelector('svg')!.getBoundingClientRect();
        return {
          button: {top: button.top, size: button.width, centre: button.top + button.height / 2},
          icon: {size: icon.width, centre: icon.top + icon.height / 2},
        };
      }));
    expect(headerActions).toEqual([
      {button: {top: 12, size: 28, centre: 26}, icon: {size: 16, centre: 26}},
      {button: {top: 12, size: 28, centre: 26}, icon: {size: 14, centre: 26}},
    ]);

    const expand = page.getByRole('button', {name: 'Expand Workspace'});
    await expand.hover();
    await page.waitForTimeout(180);
    await expect(expand).toHaveCSS('background-color', 'rgb(243, 243, 243)');
    await expect(expand).toHaveCSS('color', 'rgb(10, 10, 10)');
    // Expand belongs to the right-hand control cluster: docked or expanded it
    // sits one standard gap to the left of Toggle Workspace. Settings lives
    // in the chat drawer now.
    const gapToWorkspace = async () => {
      const workspace = (await page.getByRole('button', {name: 'Toggle Workspace'}).boundingBox())!;
      const action = (await page.locator('.expand-workspace-action').boundingBox())!;
      return workspace.x - (action.x + action.width);
    };
    const gapBetweenHeaderActions = async () => {
      const plus = (await page.getByRole('button', {name: 'New tab'}).boundingBox())!;
      const action = (await page.locator('.expand-workspace-action').boundingBox())!;
      return action.x - (plus.x + plus.width);
    };
    const expectedGap = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement);
      return Number.parseFloat(styles.getPropertyValue('--main-control-gap'));
    });
    expect(await gapToWorkspace()).toBeCloseTo(expectedGap);
    expect(await gapBetweenHeaderActions()).toBeCloseTo(expectedGap);

    await expand.click();
    await expect(workspaceDrawer(page)).toHaveClass(/expanded/);
    await page.waitForTimeout(500);
    expect(await gapToWorkspace()).toBeCloseTo(expectedGap);
    expect(await gapBetweenHeaderActions()).toBeCloseTo(expectedGap);
  });
});

test.describe('speech orb', () => {
  test('opens full screen, docks into the chat, and closes', async ({page}) => {
    await page.goto('/');
    await send(page, 'voice please');

    // Voice takes the whole surface first; docking is an explicit choice.
    await page.getByRole('button', {name: 'Start speech mode'}).click();
    const orb = page.getByRole('region', {name: 'Realtime voice conversation'});
    await expect(orb).toBeVisible();
    await expect(orb).not.toHaveClass(/in-chat/);

    await page.getByRole('button', {name: 'Minimise'}).click();
    await expect(orb).toHaveClass(/in-chat/);
    // The composer stands down while the docked orb holds the turn.
    await expect(page.locator('.sticky-composer')).toBeHidden();

    await page.getByRole('button', {name: 'Expand'}).click();
    await expect(orb).not.toHaveClass(/in-chat/);

    await expect(orb.getByRole('button', {name: 'Mute microphone'})).toBeVisible();
    await expect(orb.getByRole('button', {name: 'Mute speaker'})).toBeVisible();
    await expect(orb.getByRole('button', {name: 'Pause voice'})).toBeVisible();

    await page.getByRole('button', {name: 'Exit speech mode'}).click();
    await expect(orb).toHaveCount(0);
    await expect(page.locator('.sticky-composer')).toBeVisible();
  });
});

test.describe('responsive', () => {
  test('reserves a gutter for the timeline rail beside conversation content', async ({page}) => {
    await page.setViewportSize({width: 1250, height: 720});
    await page.goto('/');
    await page.getByRole('button', {name: 'Toggle Chats'}).click();
    await send(page, 'first timeline turn');
    await expect(page.locator('.message.assistant').first()).toContainText(/assembled Polymux chat surface/, {timeout: 4000});
    const rail = page.locator('.timeline-rail');
    // The rail stands down until it has enough turns to draw its full hover
    // curve, so the gutter is only reserved once the conversation is long enough.
    await send(page, 'second timeline turn');
    await expect(rail).toBeHidden();
    for (const [index, turn] of ['third', 'fourth', 'fifth', 'sixth', 'seventh'].entries()) {
      await send(page, `${turn} timeline turn`);
      await expect(page.locator('.message.assistant')).toHaveCount(index + 3, {timeout: 4000});
    }
    await expect(rail).toBeVisible();
    const positions = await page.evaluate(() => {
      const rail = document.querySelector('.timeline-rail')!.getBoundingClientRect();
      const message = document.querySelector('.message.assistant')!.getBoundingClientRect();
      const prompt = document.querySelector('.polymux-prompt-shell')!.getBoundingClientRect();
      const chatDrawer = document.querySelector('.chat-drawer');
      const chatDrawerRect = chatDrawer?.getBoundingClientRect();
      const contentLeft = chatDrawer && chatDrawerRect && getComputedStyle(chatDrawer).position !== 'fixed'
        ? chatDrawerRect.right
        : 0;
      return {
        railLeft: Math.round(rail.left),
        contentLeft: Math.round(contentLeft),
        railRight: Math.round(rail.right),
        messageLeft: Math.round(message.left),
        promptLeft: Math.round(prompt.left)
      };
    });
    expect(positions.railLeft - positions.contentLeft).toBe(10);
    expect(positions.railRight).toBeLessThan(positions.messageLeft);
    expect(positions.messageLeft).toBe(positions.promptLeft);

    await page.getByRole('button', {name: 'Toggle Chats'}).click();
    await expect(rail).toBeHidden();
    await page.getByRole('button', {name: 'Toggle Chats'}).click();
    await expect(rail).toBeVisible();
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    await expect(rail).toBeHidden();
  });

  test('below the split-layout width both drawers become overlays', async ({page}) => {
    await page.setViewportSize({width: 900, height: 720});
    await page.goto('/');

    await expect(chatDrawer(page)).toHaveCSS('position', 'fixed');
    await expect(page.getByRole('button', {name: 'Resize Chats'})).toBeHidden();

    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    await expect(workspaceDrawer(page)).toHaveCSS('position', 'fixed');
    await expect(workspaceDrawer(page)).toHaveCSS('width', '900px');
    await expect(page.locator('.expand-workspace-action')).toBeHidden();
  });

  test('the timeline rail stands down on a narrow viewport', async ({page}) => {
    await page.setViewportSize({width: 600, height: 720});
    await page.goto('/');
    await page.getByRole('button', {name: 'Toggle Chats'}).click();
    await send(page, 'narrow');
    await expect(page.locator('.timeline-rail')).toBeHidden();
  });
});

test.describe('dictation', () => {
  /** A MediaStream with no device behind it, since the Chromium under test has
      no microphone. The tone stands in for a voice and `hush` for trailing off,
      which is what the silence window measures. An AudioContext starts
      suspended here, so it is resumed inside the call the button makes — that
      one runs from the click, and so counts as a gesture. */
  async function stubMicrophone(page: Page) {
    await page.addInitScript(() => {
      const context = new AudioContext();
      const level = context.createGain();
      const tone = context.createOscillator();
      tone.frequency.value = 180;
      tone.connect(level);
      tone.start();
      (globalThis as unknown as {__mic: unknown}).__mic = level;
      // A fresh stream per call, as a real microphone gives: the app stops the
      // tracks of the one it is done with.
      navigator.mediaDevices.getUserMedia = async () => {
        await context.resume();
        const destination = context.createMediaStreamDestination();
        level.connect(destination);
        return destination.stream;
      };
    });
  }

  const hush = (page: Page) =>
    page.evaluate(() => {
      (globalThis as unknown as {__mic: GainNode}).__mic.gain.value = 0;
    });

  const speak = (page: Page) =>
    page.evaluate(() => {
      (globalThis as unknown as {__mic: GainNode}).__mic.gain.value = 0.3;
    });

  async function setAutoStop(page: Page, label: string) {
    await page.getByRole('button', {name: 'Settings'}).click();
    await page.getByRole('region', {name: 'Settings'}).getByRole('tab', {name: 'Voice'}).click();
    const row = page.locator('.general-setting-row', {hasText: 'Stop dictation when silent'});
    await row.getByRole('button').first().click();
    await row.getByRole('menuitemradio', {name: label}).click();
    await expect(row.getByRole('button').first()).toContainText(label);
    await page.getByRole('button', {name: 'Close Settings'}).click();
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
  }

  const voiceButton = (page: Page) => page.locator('.polymux-prompt-toolbar button', {hasText: /VOICE|LISTENING/});

  test('the button reads LISTENING before the microphone has opened', async ({page}) => {
    await page.addInitScript(() => {
      // Never resolves: the label must not be waiting on this.
      navigator.mediaDevices.getUserMedia = () => new Promise(() => {});
    });
    await page.goto('/');
    await voiceButton(page).click();
    await expect(voiceButton(page)).toContainText('LISTENING');
    await expect(page.locator('.dictation-ping')).toBeVisible();
    await voiceButton(page).click();
    await expect(voiceButton(page)).toContainText('VOICE');
  });

  test('dictated text lands at the caret and survives the silence auto-off', async ({page}) => {
    await stubMicrophone(page);
    await page.goto('/');
    await setAutoStop(page, '3 seconds');

    await editor(page).click();
    await page.keyboard.type('before after');
    // Put the caret between the two words.
    for (let index = 0; index < ' after'.length; index += 1) await page.keyboard.press('ArrowLeft');

    await voiceButton(page).click();
    await expect(voiceButton(page)).toContainText('LISTENING');
    await speak(page);
    await expect(editor(page)).toContainText('this is', {timeout: 6000});

    // Trailing off ends the session on its own, and what it wrote stays put.
    await hush(page);
    await expect(voiceButton(page)).toContainText('VOICE', {timeout: 8000});
    const text = (await editor(page).innerText()).replace(/\s+/g, ' ').trim();
    expect(text.startsWith('before ')).toBe(true);
    expect(text.endsWith(' after')).toBe(true);
    expect(text).toContain('this is dictated');

    // A second press adds to that text rather than replacing it.
    const before = text;
    await voiceButton(page).click();
    await expect(voiceButton(page)).toContainText('LISTENING');
    await speak(page);
    await page.waitForTimeout(1500);
    await hush(page);
    await expect(voiceButton(page)).toContainText('VOICE', {timeout: 8000});
    const after = (await editor(page).innerText()).replace(/\s+/g, ' ').trim();
    expect(after.length).toBeGreaterThan(before.length);
    expect(after).toContain('before');
    expect(after).toContain('after');
  });
});

test.describe('hub settings mail', () => {
  test('the rail carries one Mail entry and the pane lists every mailbox', async ({page}) => {
    await page.goto('/');
    const modal = await openAppConnection(page, 'Hub');

    // One entry, summarising the set — not a row per account.
    const mail = modal.getByRole('tab', {name: 'Mail', exact: true});
    await expect(mail).toHaveCount(1);
    await mail.click();

    await expect(modal.getByRole('heading', {name: 'Mail', exact: true})).toBeVisible();
    for (const address of ['demo@example.com', 'demo@work.example', 'team@example.co'])
      await expect(modal.getByText(address, {exact: true})).toBeVisible();
    // Mailbox reachability is passive now; the pane keeps editing and removal
    // as the only user actions rather than asking people to run connection tests.
    await expect(modal.getByText('Connected', {exact: true})).toHaveCount(3);
    await expect(modal.getByRole('button', {name: 'Edit'})).toHaveCount(3);
    await expect(modal.getByRole('button', {name: 'Remove'})).toHaveCount(3);
    await expect(modal.locator('.comms-mailboxes').getByText('Default', {exact: true})).toHaveCount(0);

    // Busy mailbox actions stay deliberately muted without becoming black on
    // the dark surface. Opacity used to blend this label into the background.
    const disabledRemoveStyle = await modal.getByRole('button', {name: 'Remove'}).first().evaluate((button) => {
      const root = document.documentElement;
      const originalTheme = root.getAttribute('data-theme');
      const wasDisabled = (button as HTMLButtonElement).disabled;
      root.dataset.theme = 'dark';
      (button as HTMLButtonElement).disabled = true;
      const style = getComputedStyle(button);
      const result = {color: style.color, opacity: style.opacity};
      (button as HTMLButtonElement).disabled = wasDisabled;
      if (originalTheme === null) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', originalTheme);
      return result;
    });
    expect(disabledRemoveStyle).toEqual({color: 'rgb(156, 156, 156)', opacity: '1'});

    // Adding opens the form without leaving the Mail section.
    await modal.getByRole('button', {name: 'Add mailbox'}).click();
    await expect(modal.getByRole('heading', {name: 'Add a mailbox'})).toBeVisible();
    await expect(modal.getByText('Send from this mailbox by default', {exact: true})).toHaveCount(0);

    // These controls once referenced undefined legacy tokens, leaving their
    // labels at the browser's black default against the dark settings pane.
    const darkColours = await modal.getByRole('button', {name: 'Sign in with Google'}).evaluate((button) => {
      const root = document.documentElement;
      const originalTheme = root.getAttribute('data-theme');
      root.dataset.theme = 'dark';
      const buttonColour = getComputedStyle(button).color;
      const noteColour = getComputedStyle(document.querySelector('.comms-signin-note')!).color;
      if (originalTheme === null) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', originalTheme);
      return {buttonColour, noteColour};
    });
    expect(darkColours).toEqual({buttonColour: 'rgb(239, 239, 239)', noteColour: 'rgb(133, 133, 133)'});
  });

  test('signatures are managed per mailbox with a saved default', async ({page}) => {
    await page.setViewportSize({width: 760, height: 640});
    await page.goto('/');
    const modal = await openAppConnection(page, 'Hub');
    await modal.getByRole('button', {name: 'Manage signatures'}).click();

    const accountTabs = modal.getByRole('tablist', {name: 'Mail accounts'});
    await expect(accountTabs).toBeVisible();
    // One tab per mailbox, plus the combined view the pane opens on.
    for (const account of ['All Signatures', 'demo@example.com', 'demo@work.example', 'team@example.co'])
      await expect(accountTabs.getByRole('tab', {name: account, exact: true})).toHaveCount(1);
    await expect(accountTabs.getByRole('tab', {name: 'All Signatures', exact: true})).toHaveAttribute('aria-selected', 'true');
    await expect(modal.getByRole('region', {name: 'Signature choices'})).toContainText('Personal');
    await expect(modal.getByRole('region', {name: 'Signature choices'})).toContainText('Work');

    await accountTabs.getByRole('tab', {name: 'demo@work.example', exact: true}).click();
    await expect(accountTabs.getByRole('tab', {name: 'demo@work.example', exact: true})).toHaveAttribute('aria-selected', 'true');
    await expect(modal.getByRole('region', {name: 'Signature choices'})).toContainText('Work');
    await accountTabs.getByRole('tab', {name: 'All Signatures', exact: true}).click();
    await expect(accountTabs.getByRole('tab', {name: 'All Signatures', exact: true})).toHaveAttribute('aria-selected', 'true');

    // The account picker stays inside the settings pane rather than bleeding
    // past its edges, however many mailboxes are linked.
    const pickerBounds = await accountTabs.evaluate((list) => {
      const detail = list.closest('.comms-detail');
      if (!detail) throw new Error('Signature picker lost its detail pane');
      const picker = list.getBoundingClientRect();
      const pane = detail.getBoundingClientRect();
      return {left: picker.left, right: picker.right, paneLeft: pane.left, paneRight: pane.right};
    });
    expect(pickerBounds.left).toBeGreaterThanOrEqual(pickerBounds.paneLeft - 1);
    expect(pickerBounds.right).toBeLessThanOrEqual(pickerBounds.paneRight + 1);

    await modal.getByRole('button', {name: 'Add signature'}).click();
    const editor = modal.getByRole('region', {name: 'Signature editor'});
    await editor.getByLabel('Name').fill('Events');
    const signature = editor.getByLabel('Signature preview');
    await signature.fill('See you there,\nDemo User');
    await signature.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
    await editor.getByRole('button', {name: 'Bold'}).click();
    await expect(signature.locator('b').first()).toContainText('See you there,');

    const defaultControl = editor.getByRole('checkbox');
    await defaultControl.click();
    await expect(defaultControl).toBeChecked();
    const choices = modal.getByRole('region', {name: 'Signature choices'});
    await choices.getByRole('button', {name: /Personal/}).click();
    await expect(editor.getByRole('checkbox')).not.toBeChecked();
    await choices.getByRole('button', {name: /Events/}).click();
    await expect(editor.getByRole('checkbox')).toBeChecked();
    await expect(editor.locator('input[type="checkbox"]')).toHaveCount(0);
    const aligned = await editor.locator('.comms-signature-editor-footer').evaluate((footer) => {
      const centre = (node: Element | null) => {
        if (!node) throw new Error('Signature footer item is missing');
        const box = node.getBoundingClientRect();
        return box.top + box.height / 2;
      };
      const check = footer.querySelector('[role="checkbox"]');
      const checkmark = footer.querySelector('.comms-signature-checkmark');
      const checkLabel = check?.querySelector('span:last-child') ?? null;
      const remove = footer.querySelector('.destructive');
      return {
        row: centre(footer),
        check: centre(check),
        checkmark: centre(checkmark),
        checkLabel: centre(checkLabel),
        remove: centre(remove),
        removeIcon: centre(remove?.querySelector('svg') ?? null),
        removeLabel: centre(remove?.querySelector('span') ?? null),
      };
    });
    for (const value of Object.values(aligned)) expect(Math.abs(value - aligned.row)).toBeLessThanOrEqual(0.75);
    await modal.getByRole('button', {name: 'Save signatures'}).click();
    await expect(modal.getByRole('button', {name: 'Save signatures'})).toBeDisabled();

    await modal.getByRole('button', {name: 'Cancel'}).click();
    await modal.locator('.comms-mailboxes li', {hasText: 'demo@example.com'}).getByRole('button', {name: 'Signatures'}).click();
    await expect(modal.getByRole('region', {name: 'Signature choices'})).toContainText('Events');
    await modal.getByRole('region', {name: 'Signature choices'}).getByRole('button', {name: /Events/}).click();
    await expect(modal.getByRole('region', {name: 'Signature editor'}).getByRole('checkbox')).toBeChecked();
  });
});

test.describe('hub view', () => {
  /**
   * The reading pane's actions, wherever they currently live: a strip of bare
   * icons when the pane has room for all of them, and one ⋮ menu when it does
   * not. Returns whichever holds them, with the menu opened.
   */
  const mailActions = async (view: import('@playwright/test').Locator) => {
    const strip = view.locator('.hub-view-reader-actions');
    const more = strip.getByRole('button', {name: 'More actions'});
    if (await more.count()) await more.click();
    return strip;
  };

  /**
   * The hub opens on whatever sits at the top of the rail, which in the demo is
   * a platform, so a test about mail says which mailbox it means. Mail carries
   * several accounts, so its row folds open rather than selecting one.
   */
  const openMailbox = async (view: import('@playwright/test').Locator) => {
    await view.locator('.hub-view-source', {hasText: 'Mail'}).click();
    await view.locator('.hub-view-accounts button', {hasText: 'demo@example.com'}).click();
  };

  const openView = async (page: import('@playwright/test').Page) => {
    await page.goto('/');
    await page.waitForFunction(() =>
      typeof (window as unknown as {polymuxDemoSetPlatformLinked?: unknown})
        .polymuxDemoSetPlatformLinked === 'function',
    );
    await page.evaluate(() => {
      const setLinked = (window as unknown as {
        polymuxDemoSetPlatformLinked: (
          platform: 'telegram' | 'wechat',
          linked: boolean,
        ) => void;
      }).polymuxDemoSetPlatformLinked;
      // The demo carries native-shaped Telegram and WeChat conversations.
      // Connected-only Hub filtering should exercise those fixtures rather
      // than silently removing them from every shared-thread UI test.
      setLinked('telegram', true);
      setLinked('wechat', true);
    });
    // The workspace launcher opens the tab the same way Drive does.
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    await page.locator('.workspace-launcher-row', {hasText: 'Hub'}).click();
    await expect(page.locator('.hub-view')).toBeVisible();
  };

  test('opens the first Hub frame on All Platforms without flashing Pick a source', async ({page}) => {
    await page.addInitScript(() => {
      const seen = {pickSource: false};
      Object.defineProperty(window, '__polymuxHubOpeningStates', {value: seen});
      new MutationObserver(() => {
        const hub = document.querySelector('.hub-view');
        if (hub?.textContent?.includes('Pick a source.')) seen.pickSource = true;
      }).observe(document.documentElement, {childList: true, subtree: true, characterData: true});
    });
    await page.goto('/?coldStart=0');
    // This reproduces the real cold-launch order: Hub status is warm before
    // the workspace tab itself is created.
    await page.waitForTimeout(2_700);
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    await page.locator('.workspace-launcher-row', {hasText: 'Hub'}).click();

    const view = page.locator('.hub-view');
    await expect(view.locator('.hub-view-source').first()).toHaveText('All Platforms');
    await expect(view.locator('.hub-view-source').first()).toHaveClass(/active/);
    const sawPickSource = await page.evaluate(() =>
      (window as unknown as {__polymuxHubOpeningStates: {pickSource: boolean}})
        .__polymuxHubOpeningStates.pickSource,
    );
    expect(sawPickSource).toBe(false);
  });

  test('selecting WeChat refreshes its status and conversations without preparing the sender', async ({page}) => {
    await openView(page);
    const wakeCalls = async (): Promise<string[]> => page.evaluate(() =>
      (window as unknown as {
        polymuxDemoWakeCalls: () => string[];
      }).polymuxDemoWakeCalls(),
    );
    const chatReads = async (): Promise<number> => page.evaluate(() =>
      (window as unknown as {
        polymuxDemoChatReads: () => number;
      }).polymuxDemoChatReads(),
    );
    const wakesBefore = (await wakeCalls()).filter((platform) => platform === 'wechat').length;
    const readsBefore = await chatReads();

    await page.locator('.hub-view-source', {hasText: 'WeChat'}).click();

    // Selecting a source re-reads the list so its conversations appear, but it
    // stays a read: the wake that prepares the sender waits for an explicit
    // send, so a passive look at Hub never launches or primes WeChat.
    await expect.poll(chatReads).toBe(readsBefore + 1);
    expect((await wakeCalls()).filter((platform) => platform === 'wechat').length).toBe(wakesBefore);
  });

  test('paints known platforms still, then fades a live platform change', async ({page}) => {
    await page.goto('/?workspaceView=hub&coldStart=0');
    const rows = page.locator('.hub-view-source-row[data-rail-source]');
    await expect(rows).not.toHaveCount(0);

    // The first complete rail is a settled paint, even though the demo status
    // reaches the component asynchronously just as the real disk seed does.
    expect(await rows.evaluateAll((nodes) => nodes.flatMap((node) => node.getAnimations()).length)).toBe(0);

    const whatsapp = page.locator('[data-rail-source="platform:whatsapp"]');
    await expect(whatsapp).toBeVisible();
    await page.evaluate(() => {
      (window as unknown as {
        polymuxDemoSetPlatformLinked: (platform: 'whatsapp', linked: boolean) => void;
      }).polymuxDemoSetPlatformLinked('whatsapp', false);
    });

    await expect.poll(async () => whatsapp.evaluate((node) =>
      node.getAnimations().some((animation) => animation.effect?.getTiming().duration === 220),
    )).toBe(true);
    await expect(whatsapp).toHaveCount(0);

    await page.evaluate(() => {
      (window as unknown as {
        polymuxDemoSetPlatformLinked: (platform: 'whatsapp', linked: boolean) => void;
      }).polymuxDemoSetPlatformLinked('whatsapp', true);
    });
    await expect(whatsapp).toBeVisible();
    await expect.poll(async () => whatsapp.evaluate((node) =>
      node.getAnimations().some((animation) => animation.effect?.getTiming().duration === 220),
    )).toBe(true);
  });

  test('gives Hub search fields a subtle hover highlight', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await openMailbox(view);
    const search = view.getByPlaceholder('Search this folder');

    await expect(search).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(search).toHaveCSS('border-color', 'rgb(236, 236, 236)');
    await search.hover();
    await expect(search).toHaveCSS('background-color', 'rgb(243, 243, 243)');
    await expect(search).toHaveCSS('border-color', 'rgb(217, 217, 217)');
  });

  test('keeps the mail scroll-to-top control inside the message list', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await openMailbox(view);
    const rows = view.locator('.hub-view-rows');

    await rows.evaluate((node) => {
      const filler = document.createElement('li');
      filler.style.height = '1200px';
      node.append(filler);
      node.scrollTop = 450;
      node.dispatchEvent(new Event('scroll'));
    });

    const control = view.getByRole('button', {name: 'Scroll to top'});
    await expect(control).toBeVisible();
    const layout = await control.evaluate((node) => {
      const button = node.getBoundingClientRect();
      const wrapper = node.parentElement?.getBoundingClientRect();
      const header = node.closest('.hub-view-list')?.querySelector('.hub-view-list-head')?.getBoundingClientRect();
      return {
        inRowsWrapper: node.parentElement?.classList.contains('hub-view-rows-wrap') ?? false,
        buttonTop: button.top,
        wrapperTop: wrapper?.top ?? 0,
        headerBottom: header?.bottom ?? 0,
      };
    });
    expect(layout.inRowsWrapper).toBe(true);
    expect(layout.buttonTop).toBeGreaterThanOrEqual(layout.wrapperTop);
    expect(layout.buttonTop).toBeGreaterThanOrEqual(layout.headerBottom);

    await control.click();
    await expect.poll(() => rows.evaluate((node) => node.scrollTop)).toBeLessThan(1);
  });

  test('keeps the Hub chat scroll control attached above its composer', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-row', {hasText: 'File Transfer'}).click();
    await expect(workspaceDrawer(page)).toHaveCSS('width', '480px');
    const thread = view.locator('.hub-view-thread');

    await thread.evaluate((node) => {
      const filler = document.createElement('div');
      filler.style.height = '1200px';
      filler.style.flex = 'none';
      node.append(filler);
      node.style.flex = '0 0 100px';
      node.scrollTop = -400;
      node.dispatchEvent(new Event('scroll'));
    });

    const control = view.getByRole('button', {name: 'Scroll to bottom'});
    await expect(control).toBeVisible();
    const layout = await control.evaluate((node) => {
      const button = node.getBoundingClientRect();
      const footer = node.parentElement?.getBoundingClientRect();
      const reader = node.closest('.hub-view-reader')?.getBoundingClientRect();
      const label = node.querySelector('span')?.getBoundingClientRect();
      return {
        inChatFooter: node.parentElement?.classList.contains('hub-view-chat-footer') ?? false,
        aboveFooter: button.bottom <= (footer?.top ?? 0),
        insideReader: button.left >= (reader?.left ?? 0) && button.right <= (reader?.right ?? 0),
        whiteSpace: getComputedStyle(node).whiteSpace,
        buttonHeight: button.height,
        labelHeight: label?.height ?? 0,
      };
    });
    expect(layout.inChatFooter).toBe(true);
    expect(layout.aboveFooter).toBe(true);
    expect(layout.insideReader).toBe(true);
    expect(layout.whiteSpace).toBe('nowrap');
    expect(layout.buttonHeight).toBeLessThan(30);
    expect(layout.labelHeight).toBeLessThan(16);

    await control.click();
    await expect.poll(() => thread.evaluate((node) => Math.abs(node.scrollTop))).toBeLessThan(1);
  });

  test('keeps the minimum-width Hub composer hint on one ellipsized line', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-row', {hasText: 'File Transfer'}).click();
    await expect(workspaceDrawer(page)).toHaveCSS('width', '480px');

    const hint = view.getByRole('textbox', {name: 'Message File Transfer'});
    await expect(hint).toHaveAttribute('placeholder', 'Message File Transfer');
    const layout = await hint.evaluate((node) => {
      node.setAttribute('placeholder', 'Message a conversation name that is intentionally much wider than the composer');
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      return {
        overflow: style.overflow,
        textOverflow: style.textOverflow,
        whiteSpace: style.whiteSpace,
        height: box.height - Number.parseFloat(style.paddingTop) - Number.parseFloat(style.paddingBottom),
        lineHeight: Number.parseFloat(style.lineHeight),
      };
    });
    expect(layout).toMatchObject({
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    });
    expect(Math.abs(layout.height - layout.lineHeight)).toBeLessThanOrEqual(1);
  });

  test('new mail starts with the mailbox default and can swap it', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await openMailbox(view);
    await view.getByRole('button', {name: 'New', exact: true}).click();

    const picker = view.getByRole('button', {name: 'Choose signature'});
    await expect(picker).toContainText('Personal');
    await expect(view.getByRole('region', {name: 'Signature preview'})).toContainText('Kind regards,');

    await picker.click();
    await view.getByRole('menuitemradio', {name: 'No signature'}).click();
    await expect(view.getByRole('region', {name: 'Signature preview'})).toHaveCount(0);

    await picker.click();
    await view.getByRole('menuitemradio', {name: 'Personal'}).click();
    await expect(view.getByRole('region', {name: 'Signature preview'})).toContainText('Demo User');
  });

  test('remote WeChat media and events keep their native conversation shape', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-row', {hasText: 'File Transfer'}).click();

    const fileChip = view.locator('.hub-view-bubble-file', {hasText: 'Project notes.pdf'});
    await expect(fileChip).toBeVisible();
    const overflow = await fileChip.locator('.hub-view-bubble-file-name').evaluate((node) => {
      node.textContent = 'AQO35LDKTG5E80mb8IC1UxBCatqRtz5e1UfSQyGjSubW_6TuswMo_IDXhnFdRLTK0IsjSS6YM4A.mp4';
      const style = getComputedStyle(node);
      return {
        clipped: node.scrollWidth > node.clientWidth,
        overflow: style.overflow,
        textOverflow: style.textOverflow,
        whiteSpace: style.whiteSpace,
      };
    });
    expect(overflow).toEqual({clipped: true, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'});
    const voice = view.getByRole('group', {name: 'Voice message'});
    await expect(voice).toBeVisible();
    const voiceAudio = voice.locator('audio');
    await expect(voiceAudio).not.toHaveAttribute('controls', '');
    const voiceProgress = voice.getByRole('slider', {name: 'Recording position'});
    await expect(voiceProgress).toBeVisible();
    const voicePlay = voice.getByRole('button', {name: 'Play recording'});
    await expect(voicePlay).not.toHaveAttribute('title');
    // The fixture is intentionally tiny. Slow it enough that the assertion
    // can observe and pause the playing state before the clip naturally ends.
    await voiceAudio.evaluate((node: HTMLAudioElement) => {
      node.playbackRate = 0.25;
    });
    await voicePlay.click();
    await expect(voice.getByRole('button', {name: 'Pause recording'})).toBeVisible();
    await expect.poll(() => voiceAudio.evaluate((node: HTMLAudioElement) => node.currentTime)).toBeGreaterThan(0);
    await voice.getByRole('button', {name: 'Pause recording'}).click();
    await voiceProgress.evaluate((node: HTMLInputElement) => {
      node.value = '0.2';
      node.dispatchEvent(new Event('input', {bubbles: true}));
    });
    await expect.poll(() => voiceAudio.evaluate((node: HTMLAudioElement) => node.currentTime)).toBeCloseTo(.2, 1);
    const voiceLayout = await voice.evaluate((node) => ({
      width: node.getBoundingClientRect().width,
      height: node.getBoundingClientRect().height,
      nativeDisplay: getComputedStyle(node.querySelector('audio')!).display,
      overflow: node.scrollWidth > node.clientWidth,
    }));
    expect(voiceLayout.width).toBeGreaterThan(160);
    expect(voiceLayout.width).toBeLessThanOrEqual(220);
    expect(voiceLayout.height).toBe(32);
    expect(voiceLayout.nativeDisplay).toBe('none');
    expect(voiceLayout.overflow).toBe(false);
    // The inline player is wrapped in a labelled group whose accessible name it
    // shares, and it draws its own play/seek chrome instead of native controls.
    const reelName = 'AQO35LDKTG5E80mb8IC1UxBCatqRtz5e1UfSQbW_6TuswMo_IDXhnFdRLTK0IsjSS6YM4A.mp4';
    const reelGroup = view.getByRole('group', {name: reelName});
    const reel = reelGroup.locator('video.hub-view-bubble-video');
    await expect(reel).toBeVisible();
    await expect(reel).toHaveAttribute('playsinline', '');
    await expect(reel).not.toHaveAttribute('controls', '');
    await expect(reelGroup.getByRole('button', {name: 'Play video'})).toBeVisible();
    await expect.poll(() => reel.evaluate((node: HTMLVideoElement) => node.readyState)).toBeGreaterThanOrEqual(1);
    await reel.evaluate((node: HTMLVideoElement) => node.play());
    await expect.poll(() => reel.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(0);
    await expect.poll(() => reel.evaluate((node: HTMLVideoElement) => node.ended)).toBe(true);
    const completed = await reel.evaluate((node: HTMLVideoElement) => ({
      currentTime: node.currentTime,
      duration: node.duration,
    }));
    expect(completed.currentTime).toBeCloseTo(completed.duration, 2);
    expect(await reel.evaluate((node: HTMLVideoElement) => node.error?.code ?? null)).toBeNull();
    await expect(view.locator('.hub-view-notice', {hasText: 'A message was recalled'})).toBeVisible();
    const richReply = view.getByText('My answer\n↳ Alice: Earlier text', {exact: true});
    await expect(richReply).toBeVisible();
    const card = view.getByRole('link', {name: /Useful article/});
    await expect(card).toContainText('A short description');
    await expect(card).toContainText('example.test');
    await expect(card).toHaveAttribute('href', 'https://example.test/article');
    await expect(view.getByRole('button', {name: 'View in WeChat'})).toHaveCount(4);
    await expect(view.getByText('[File]', {exact: true})).toHaveCount(0);
    await expect(view.getByText('[Voice message]', {exact: true})).toHaveCount(0);
    await view.getByRole('button', {name: /^More actions:/}).click();
    await expect(view.getByRole('menuitem', {name: 'Record a voice message'})).toBeVisible();
    await page.keyboard.press('Escape');
    await richReply.click({button: 'right'});
    await expect(view.locator('.hub-view-emoji-row')).toHaveCount(0);
    // Replies remain available: the adapter carries their context in text.
    // The message menu is portalled to the body so Hub's containment cannot
    // clip it, so it is reached from the page rather than the view.
    await expect(page.getByRole('menuitem', {name: 'Reply'})).toBeVisible();
    const actionMenu = page.locator('.hub-view-message-menu');
    const wrapping = await actionMenu.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const labels = [...node.querySelectorAll<HTMLElement>('.polymux-dropdown-item > span')];
      return {
        width: box.width,
        trailingSpace: box.right - Math.max(...labels.map((label) => label.getBoundingClientRect().right)),
      };
    });
    // A text-only context menu follows its longest row instead of inheriting
    // the reaction grid's wider plate.
    expect(wrapping.width).toBeLessThan(120);
    expect(wrapping.trailingSpace).toBeLessThanOrEqual(14);
  });

  test('recalls an outgoing WeChat message instead of locally deleting it', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-row', {hasText: 'File Transfer'}).click();

    const message = view.locator('[data-message-id="wx4"]');
    await message.click({button: 'right'});
    const menu = page.locator('.hub-view-message-menu');
    // Selecting the control by its visible name proves the UI presents the
    // remote operation as Recall rather than a local Delete action.
    const recall = menu.getByRole('menuitem', {name: 'Recall'});
    // Chromium may report a scroll after the context menu opens even when the
    // reverse-column thread did not move. That notification must not detach
    // the action before the pointer can select it.
    await view.locator('.hub-view-thread').dispatchEvent('scroll');
    await recall.click();

    await expect(message).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (
      window as unknown as {
        polymuxDemoChatActions: () => Array<Record<string, unknown>>;
      }
    ).polymuxDemoChatActions())).toEqual([
      {kind: 'recall', chatId: '!wx-filehelper:local', messageId: 'wx4'},
    ]);
  });

  test('routes File Transfer text, replies, attachments, and stickers through outbound APIs', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-row', {hasText: 'File Transfer'}).click();
    const composer = view.locator('.hub-view-composer');
    const actions = () => page.evaluate(() => (
      window as unknown as {
        polymuxDemoChatActions: () => Array<Record<string, unknown>>;
      }
    ).polymuxDemoChatActions());

    await composer.locator('textarea').fill('Plain File Transfer text');
    await composer.getByRole('button', {name: 'Send'}).click();
    await expect.poll(actions).toHaveLength(1);

    await view.locator('[data-message-id="wx4"]').click({button: 'right'});
    await page.locator('.hub-view-message-menu').getByRole('menuitem', {name: 'Reply'}).click({force: true});
    await composer.locator('textarea').fill('Quoted File Transfer reply');
    await composer.getByRole('button', {name: 'Send'}).click();
    await expect.poll(actions).toHaveLength(2);

    const transfer = await page.evaluateHandle(() => {
      const value = new DataTransfer();
      value.items.add(new File(['image'], 'parity-image.png', {type: 'image/png'}));
      value.items.add(new File(['video'], 'parity-video.mp4', {type: 'video/mp4'}));
      value.items.add(new File(['file'], 'parity-file.txt', {type: 'text/plain'}));
      return value;
    });
    await view.locator('.hub-view-reader').dispatchEvent('drop', {dataTransfer: transfer});
    await expect(view.locator('.hub-view-chat-files')).toContainText('parity-image.png');
    await composer.getByRole('button', {name: 'Send'}).click();
    await expect.poll(actions).toHaveLength(5);

    const composerRow = view.locator('.hub-view-composer-row');
    await composerRow.getByRole('button', {name: 'More actions'}).click();
    await composerRow.locator('.hub-view-composer-tools-menu')
      .getByRole('menuitem', {name: 'Send sticker'}).click();
    await composerRow.locator('.hub-view-sticker-picker')
      .getByRole('gridcell', {name: 'Send sticker'}).click();

    await expect.poll(actions).toEqual([
      {
        kind: 'text', chatId: '!wx-filehelper:local',
        text: 'Plain File Transfer text', replyTo: null,
      },
      {
        kind: 'text', chatId: '!wx-filehelper:local',
        text: 'Quoted File Transfer reply', replyTo: 'wx4',
      },
      {kind: 'files', chatId: '!wx-filehelper:local', files: ['parity-image.png']},
      {kind: 'files', chatId: '!wx-filehelper:local', files: ['parity-video.mp4']},
      {kind: 'files', chatId: '!wx-filehelper:local', files: ['parity-file.txt']},
      {kind: 'sticker', chatId: '!wx-filehelper:local', stickerId: 'demo-native-sticker'},
    ]);
  });

  test('drops files into the composer under the pointer', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-row', {hasText: 'File Transfer'}).click();

    const hubDrop = await page.evaluateHandle(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['hub image'], 'hub-photo.png', {type: 'image/png'}));
      return transfer;
    });
    const reader = view.locator('.hub-view-reader');
    const main = page.locator('main');
    const hubOverlay = reader.locator('.hub-file-drop-pane-overlay');
    const agentOverlay = main.locator(':scope > .agent-file-drop-pane-overlay');
    await reader.dispatchEvent('dragenter', {dataTransfer: hubDrop});
    await reader.dispatchEvent('dragover', {dataTransfer: hubDrop});
    await expect(reader).toHaveClass(/file-drag-active/);
    await expect(page.locator('.polymux-prompt')).not.toHaveClass(/file-drag-active/);
    await expect(main).not.toHaveClass(/agent-file-drag-active/);
    await expect.poll(() => hubOverlay.evaluate((node) => getComputedStyle(node).opacity)).toBe('1');
    expect(await hubOverlay.evaluate((node) => getComputedStyle(node).pointerEvents)).toBe('none');
    await expect.poll(() => agentOverlay.evaluate((node) => getComputedStyle(node).opacity)).toBe('0');
    const hubCoverage = await reader.evaluate((node) => {
      const overlay = node.querySelector<HTMLElement>('.hub-file-drop-pane-overlay');
      if (!overlay) throw new Error('Hub pane overlay is missing');
      const paneBox = node.getBoundingClientRect();
      const overlayBox = overlay.getBoundingClientRect();
      return {
        top: overlayBox.top - paneBox.top,
        right: paneBox.right - overlayBox.right,
        bottom: paneBox.bottom - overlayBox.bottom,
        left: overlayBox.left - paneBox.left,
      };
    });
    for (const inset of Object.values(hubCoverage)) expect(Math.abs(inset)).toBeLessThanOrEqual(0.5);
    const themeTints = await hubOverlay.evaluate((node) => {
      const root = document.documentElement;
      const originalTheme = root.getAttribute('data-theme');
      root.setAttribute('data-theme', 'light');
      const light = getComputedStyle(node).backgroundColor;
      root.setAttribute('data-theme', 'dark');
      const dark = getComputedStyle(node).backgroundColor;
      if (originalTheme === null) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', originalTheme);
      return {light, dark};
    });
    expect(themeTints.light).not.toBe('transparent');
    expect(themeTints.dark).not.toBe('transparent');
    expect(themeTints.light).not.toBe(themeTints.dark);
    await reader.dispatchEvent('drop', {dataTransfer: hubDrop});

    await expect(view.locator('.hub-view-chat-files')).toContainText('hub-photo.png');
    const attachmentAlignment = await view.locator('.hub-view-chat-footer').evaluate((footer) => {
      const files = footer.querySelector<HTMLElement>('.hub-view-chat-files');
      const composer = footer.querySelector<HTMLElement>('.hub-view-composer');
      if (!files || !composer) throw new Error('Hub attachment row or composer is missing');
      const fileBox = files.getBoundingClientRect();
      const composerBox = composer.getBoundingClientRect();
      const composerStyle = getComputedStyle(composer);
      return {
        leading: fileBox.left - composerBox.left,
        trailing: composerBox.right - fileBox.right,
        paddingLeading: Number.parseFloat(composerStyle.paddingLeft),
      };
    });
    expect(attachmentAlignment.leading).toBe(attachmentAlignment.paddingLeading);
    expect(attachmentAlignment.trailing).toBe(attachmentAlignment.paddingLeading);
    const hubSend = view.locator('.hub-view-composer').getByRole('button', {name: 'Send'});
    await expect(hubSend).toBeVisible();
    await expect(page.locator('.polymux-prompt [data-chip]')).toHaveCount(0);
    await hubSend.click();
    await expect(view.locator('.hub-view-chat-files')).toHaveCount(0);

    const agentDrop = await page.evaluateHandle(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['agent note'], 'agent-note.txt', {type: 'text/plain'}));
      return transfer;
    });
    const prompt = page.locator('.polymux-prompt');
    const neutralHubRail = view.locator('.hub-view-rail');
    const [agentBox, neutralBox, readerBox] = await Promise.all([
      agentOverlay.boundingBox(),
      neutralHubRail.boundingBox(),
      reader.boundingBox(),
    ]);
    if (!agentBox || !neutralBox || !readerBox) throw new Error('File drop destinations are not measurable');
    const agentPoint = {clientX: agentBox.x + agentBox.width / 2, clientY: agentBox.y + agentBox.height / 2};
    const neutralPoint = {clientX: neutralBox.x + neutralBox.width / 2, clientY: neutralBox.y + neutralBox.height / 2};
    const hubPoint = {clientX: readerBox.x + readerBox.width / 2, clientY: readerBox.y + readerBox.height / 2};

    await prompt.dispatchEvent('dragenter', {dataTransfer: agentDrop, ...agentPoint});
    await prompt.dispatchEvent('dragover', {dataTransfer: agentDrop, ...agentPoint});
    await expect(prompt).toHaveClass(/file-drag-active/);
    await expect(main).toHaveClass(/agent-file-drag-active/);
    await expect.poll(() => agentOverlay.evaluate((node) => getComputedStyle(node).opacity)).toBe('1');
    expect(await agentOverlay.evaluate((node) => getComputedStyle(node).pointerEvents)).toBe('none');
    await expect.poll(() => hubOverlay.evaluate((node) => getComputedStyle(node).opacity)).toBe('0');

    // Leaving a destination for the neutral workspace rail clears both panes. Moving
    // directly from agent to Hub hands the tint across without preserving the
    // old one, even though Hub stops the bubbling drag event it owns.
    await neutralHubRail.dispatchEvent('dragover', {dataTransfer: agentDrop, ...neutralPoint});
    await expect(main).not.toHaveClass(/agent-file-drag-active/);
    await expect(reader).not.toHaveClass(/file-drag-active/);
    await expect.poll(() => agentOverlay.evaluate((node) => getComputedStyle(node).opacity)).toBe('0');
    await expect.poll(() => hubOverlay.evaluate((node) => getComputedStyle(node).opacity)).toBe('0');

    await reader.dispatchEvent('dragenter', {dataTransfer: agentDrop, ...hubPoint});
    await reader.dispatchEvent('dragover', {dataTransfer: agentDrop, ...hubPoint});
    await expect(reader).toHaveClass(/file-drag-active/);
    await expect(main).not.toHaveClass(/agent-file-drag-active/);
    await expect.poll(() => hubOverlay.evaluate((node) => getComputedStyle(node).opacity)).toBe('1');
    await expect.poll(() => agentOverlay.evaluate((node) => getComputedStyle(node).opacity)).toBe('0');

    await reader.dispatchEvent('dragleave', {dataTransfer: agentDrop, ...neutralPoint});
    await neutralHubRail.dispatchEvent('dragover', {dataTransfer: agentDrop, ...neutralPoint});
    await expect(reader).not.toHaveClass(/file-drag-active/);
    await expect(main).not.toHaveClass(/agent-file-drag-active/);
    await expect.poll(() => hubOverlay.evaluate((node) => getComputedStyle(node).opacity)).toBe('0');
    await expect.poll(() => agentOverlay.evaluate((node) => getComputedStyle(node).opacity)).toBe('0');

    await prompt.dispatchEvent('dragenter', {dataTransfer: agentDrop, ...agentPoint});
    await prompt.dispatchEvent('dragover', {dataTransfer: agentDrop, ...agentPoint});
    await expect(main).toHaveClass(/agent-file-drag-active/);
    const agentCoverage = await main.evaluate((node) => {
      const overlay = node.querySelector<HTMLElement>(':scope > .agent-file-drop-pane-overlay');
      const workspace = node.querySelector<HTMLElement>('.workspace-drawer.open');
      if (!overlay || !workspace) throw new Error('Agent pane overlay or open workspace is missing');
      const overlayBox = overlay.getBoundingClientRect();
      const workspaceBox = workspace.getBoundingClientRect();
      return {
        top: overlayBox.top,
        left: overlayBox.left - Number.parseFloat(getComputedStyle(node).getPropertyValue('--chat-drawer-offset')),
        rightGap: workspaceBox.left - overlayBox.right,
        bottomGap: window.innerHeight - overlayBox.bottom,
      };
    });
    for (const inset of Object.values(agentCoverage)) expect(Math.abs(inset)).toBeLessThanOrEqual(0.5);
    await prompt.dispatchEvent('drop', {dataTransfer: agentDrop, ...agentPoint});

    await expect(prompt.locator('[data-chip][data-name="agent-note.txt"]')).toHaveCount(1);
    await expect(view.locator('.hub-view-chat-files')).toHaveCount(0);
  });

  test('normal Hub mode marks a conversation read when it is opened', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-source', {hasText: 'WhatsApp'}).click();
    const chat = view.locator('.hub-view-row', {hasText: 'Family'});
    const unread = chat.locator('.hub-view-chat-unread');
    await expect(unread).toHaveText('2');
    await chat.click();
    await expect(unread).toHaveCount(0);
  });

  test('refreshes native read and unread changes while another chat is open', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-source', {hasText: 'WhatsApp'}).click();
    const family = view.locator('.hub-view-row', {hasText: 'Family'});
    const unread = family.locator('.hub-view-chat-unread');
    await expect(unread).toHaveText('2');

    await view.locator('.hub-view-row', {hasText: 'Jules Tan'}).click();
    await page.evaluate(() => {
      (window as unknown as {
        polymuxDemoSetChatUnread: (chatId: string, unread: number) => void;
      }).polymuxDemoSetChatUnread('!wa-family:local', 0);
      window.dispatchEvent(new Event('focus'));
    });
    await expect(unread).toHaveCount(0);

    await page.evaluate(() => {
      (window as unknown as {
        polymuxDemoSetChatUnread: (chatId: string, unread: number) => void;
      }).polymuxDemoSetChatUnread('!wa-family:local', 1);
      window.dispatchEvent(new Event('focus'));
    });
    await expect(unread).toHaveText('1');
  });

  test('Hub incognito mode keeps a conversation unread when it is opened', async ({page}) => {
    await page.goto('/');
    // Hub's own settings live in its connection detail.
    const settings = await openAppConnection(page, 'Hub');
    const incognito = settings.getByRole('switch', {name: 'Enable Hub incognito mode'});
    await expect(incognito).toHaveAttribute('aria-checked', 'false');
    await incognito.click();
    await expect(incognito).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    // The Hub tab is already the workspace's page, so leave its settings for
    // the conversation list rather than reopening the app.
    await page.locator('.hub-view').locator('.hub-view-source', {hasText: 'All Platforms'}).click();
    const view = page.locator('.hub-view');
    const chat = view.locator('.hub-view-row', {hasText: 'Family'});
    const unread = chat.locator('.hub-view-chat-unread');
    await expect(unread).toBeVisible();
    await chat.click();
    // The list is behind the reader while the chat is open, but its unread
    // badge stays in the DOM rather than being cleared as a normal read does.
    await expect(unread).toHaveText('2');
  });

  test('a drafted message is written into that chat’s box, not sent', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');

    await page.evaluate(() => {
      (window as unknown as {polymuxDemoReveal: (request: unknown) => void}).polymuxDemoReveal({
        surface: 'hub',
        chat: {name: 'Jules Tan', draft: 'Thursday works — see you at 2.'},
      });
    });

    await expect(view.locator('.hub-view-thread')).toBeVisible();
    await expect(view.locator('.hub-view-composer textarea')).toHaveValue('Thursday works — see you at 2.');
    // Prefilled, never sent: the thread still ends where it did.
    await expect(view.locator('.hub-view-thread')).not.toContainText('Thursday works');
  });

  test('an agent reveal opens the Drive drawer at the requested source', async ({page}) => {
    await page.goto('/');
    await page.waitForFunction(() =>
      typeof (window as unknown as {polymuxDemoReveal?: unknown}).polymuxDemoReveal === 'function');
    const drawer = workspaceDrawer(page);
    await expect(drawer).not.toHaveClass(/open/);

    await page.evaluate(() => {
      (window as unknown as {polymuxDemoReveal: (request: unknown) => void}).polymuxDemoReveal({
        surface: 'drive',
        drive: {source: 'google-drive#default', path: ''},
      });
    });

    await expect(drawer).toHaveClass(/open/);
    await expect(drawer.locator('.tab.active')).toContainText('Drive');
    await expect(drawer.locator('.fb')).toBeVisible();
    // The Google Drive demo source has two root entries. The virtual All
    // storage source also has Budget.xlsx, so its absence proves that the
    // requested source — not merely a generic Drive tab — was opened.
    await expect(drawer.locator('.fb-row[data-drive-id]')).toHaveCount(2);
    await expect(drawer.locator('.fb-row', {hasText: 'Launch brief.docx'})).toBeVisible();
    await expect(drawer.locator('.fb-row', {hasText: 'Budget.xlsx'})).toHaveCount(0);
  });

  test('agent reveals can open the Tasks and Calendar workspace apps', async ({page}) => {
    await page.goto('/');
    await page.waitForFunction(() =>
      typeof (window as unknown as {polymuxDemoReveal?: unknown}).polymuxDemoReveal === 'function');
    const drawer = workspaceDrawer(page);
    for (const [surface, label] of [['tasks', 'Tasks'], ['calendar', 'Calendar']] as const) {
      await page.evaluate((requested) => {
        (window as unknown as {polymuxDemoReveal: (request: unknown) => void})
          .polymuxDemoReveal({surface: requested});
      }, surface);
      await expect(drawer).toHaveClass(/open/);
      await expect(drawer.locator('.tab.active')).toContainText(label);
    }
  });

  test('a drafted mail opens the composer already written, saved nowhere', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');

    await page.evaluate(() => {
      (window as unknown as {polymuxDemoReveal: (request: unknown) => void}).polymuxDemoReveal({
        surface: 'hub',
        mail: {
          account: 'demo@example.com',
          compose: {to: 'dana@example.com', subject: 'Friday', body: 'Are we still on?'},
        },
      });
    });

    const composer = view.locator('.hub-view-compose-form');
    await expect(composer).toBeVisible();
    await expect(composer.locator('input').first()).toHaveValue('dana@example.com');
    await expect(composer.locator('textarea')).toHaveValue('Are we still on?');
  });

  test('a drafted reply answers the message it names, quoted above the box', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');

    await page.evaluate(() => {
      (window as unknown as {polymuxDemoReveal: (request: unknown) => void}).polymuxDemoReveal({
        surface: 'hub',
        chat: {name: 'Jules Tan', replyTo: 'c1', draft: 'Yes — 2pm works.'},
      });
    });

    // The composer says what it is answering, the same as pressing Reply does.
    const replying = view.locator('.hub-view-replying');
    await expect(replying).toContainText('Are we still on for Thursday?');
    await expect(replying.locator('[data-icon="reply"]')).toHaveCount(1);
    await expect(replying.locator('[data-icon="back"]')).toHaveCount(0);
    await expect(view.locator('.hub-view-composer textarea')).toHaveValue('Yes — 2pm works.');

    // The pill overlaps the thread rather than reserving an opaque horizontal
    // strip. Messages can remain visible around it until the real composer.
    const floating = await view.locator('.hub-view-chat-footer').evaluate((footer) => {
      const thread = footer.previousElementSibling!.getBoundingClientRect();
      const pill = footer.querySelector<HTMLElement>('.hub-view-replying')!.getBoundingClientRect();
      const composer = footer.querySelector<HTMLElement>('.hub-view-composer')!.getBoundingClientRect();
      const style = getComputedStyle(footer);
      return {
        overlap: thread.bottom - pill.top,
        composerGap: composer.top - pill.bottom,
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
      };
    });
    expect(floating.overlap).toBeGreaterThanOrEqual(25);
    expect(floating.composerGap).toBe(6);
    expect(floating.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(floating.backgroundImage).toBe('none');

    // The compact thread makes the older quoted message leave the viewport.
    // Pressing the reply pill brings that exact message back into view.
    const thread = view.locator('.hub-view-thread');
    const target = thread.locator('[data-message-id="c1"]');
    await thread.evaluate((node) => {
      node.style.flex = '0 0 40px';
      node.scrollTo({top: 0, behavior: 'instant'});
    });
    const targetIsVisible = () => target.evaluate((node) => {
      const targetBox = node.getBoundingClientRect();
      const threadBox = node.closest('.hub-view-thread')!.getBoundingClientRect();
      return targetBox.bottom > threadBox.top && targetBox.top < threadBox.bottom;
    });
    expect(await targetIsVisible()).toBe(false);
    await page.evaluate(() => (document.documentElement.dataset.theme = 'light'));
    await replying.locator('.hub-view-reply-jump').click();
    await expect.poll(targetIsVisible).toBe(true);
    const targetBubble = target.locator('.hub-view-bubble');
    await expect(targetBubble).toHaveClass(/reply-target-highlight/);
    await expect(targetBubble).toHaveCSS('animation-name', 'hub-view-reply-target-highlight');
    const pulsePaint = () => targetBubble.evaluate((node) => {
      const animation = node.getAnimations()[0];
      if (!animation) throw new Error('Reply target animation is missing');
      animation.pause();
      animation.currentTime = 0;
      const resting = getComputedStyle(node).backgroundColor;
      animation.currentTime = 500;
      const style = getComputedStyle(node);
      return {resting, highlighted: style.backgroundColor, shadow: style.boxShadow};
    });
    const brightness = (colour: string) => {
      const channels = colour.match(/[\d.]+/g)?.slice(0, 3).map(Number);
      if (!channels || channels.length !== 3) throw new Error(`Unreadable colour: ${colour}`);
      return channels.reduce((sum, channel) => sum + channel, 0) / channels.length;
    };
    const lightPaint = await pulsePaint();
    expect(brightness(lightPaint.highlighted)).toBeLessThan(brightness(lightPaint.resting));
    expect(lightPaint.shadow).toBe('none');
    await expect(targetBubble).not.toHaveClass(/reply-target-highlight/, {timeout: 2_500});

    // Dark mode uses the same fill-only cue in the other direction.
    await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
    await replying.locator('.hub-view-reply-jump').click();
    await expect(targetBubble).toHaveClass(/reply-target-highlight/);
    const darkPaint = await pulsePaint();
    expect(brightness(darkPaint.highlighted)).toBeGreaterThan(brightness(darkPaint.resting));
    expect(darkPaint.shadow).toBe('none');
    await expect(targetBubble).not.toHaveClass(/reply-target-highlight/, {timeout: 2_500});
  });

  test('a drafted mail reply opens as a real reply, with the words above the quote', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');

    await page.evaluate(() => {
      (window as unknown as {polymuxDemoReveal: (request: unknown) => void}).polymuxDemoReveal({
        surface: 'hub',
        mail: {
          account: 'demo@example.com',
          folder: 'INBOX',
          messageId: '1',
          compose: {mode: 'reply', body: 'Thanks — I will be there.'},
        },
      });
    });

    const composer = view.locator('.hub-view-compose-form');
    await expect(composer).toBeVisible();
    // Recipient and Re: subject come from the message, not from the agent.
    await expect(composer.locator('input').first()).toHaveValue(/example\.com/);
    await expect(composer.locator('input').nth(1)).toHaveValue(/^Re: /);
    const body = composer.locator('textarea');
    await expect(body).toHaveValue(/^Thanks — I will be there\./);
    await expect(body).toHaveValue(/wrote:|>/);
  });

  test('a drafted mail arrives with copies, attachments and the important flag set', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');

    await page.evaluate(() => {
      (window as unknown as {polymuxDemoReveal: (request: unknown) => void}).polymuxDemoReveal({
        surface: 'hub',
        mail: {
          account: 'demo@example.com',
          compose: {
            to: 'dana@example.com',
            cc: 'sam@example.com',
            bcc: 'records@example.com',
            subject: 'Friday',
            body: 'Are we still on?',
            attachments: ['/Users/demo/Documents/agenda.pdf'],
            importance: 'high',
          },
        },
      });
    });

    const composer = view.locator('.hub-view-compose-form');
    await expect(composer.locator('input').first()).toHaveValue('dana@example.com');
    // The copy lines unfold on their own, since there is something in them.
    await expect(composer.locator('input').nth(1)).toHaveValue('sam@example.com');
    await expect(composer.locator('input').nth(2)).toHaveValue('records@example.com');
    await expect(composer.locator('.hub-view-compose-attachment')).toContainText('agenda.pdf');
    await expect(composer.getByRole('switch', {name: 'Mark as important'})).toHaveAttribute('aria-checked', 'true');
  });

  test('lists linked platforms and mailbox folders, and reads a message', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await openMailbox(view);

    // Sources carry their platform mark, not a generic bubble.
    await expect(view.locator('.hub-view-source', {hasText: 'WhatsApp'})).toBeVisible();
    await expect(view.locator('svg[data-platform="whatsapp"]')).toBeVisible();
    await expect(view.locator('svg[data-platform="mail"]').first()).toBeVisible();

    // Mailboxes live in a dropdown over the list, not in the rail, and are
    // classified from IMAP special-use flags.
    await view.locator('.hub-view-folder-button').click();
    // The menu shows each folder's leaf label, not its IMAP path: "INBOX"
    // shouting beside Drafts and Sent Mail would be the only all-caps row.
    for (const folder of ['Inbox', 'Drafts', 'Sent Mail', 'Spam', 'Trash'])
      await expect(
        view.locator('.hub-view-folder-menu').getByRole('button', {name: folder, exact: true}),
      ).toBeVisible();
    await view.locator('.hub-view-folder-button').click();

    // Unread is carried by weight, so the first row is heavier than a read one.
    const rows = view.locator('.hub-view-row');
    await expect(rows.first()).toHaveClass(/unread/);
    await rows.first().click();

    await expect(view.getByRole('heading', {name: 'Q3 numbers'})).toBeVisible();
    await expect(view.getByLabel('Reading pane').getByText('The quarterly numbers are attached.')).toBeVisible();
    // Every action the message can take is reachable and named, whether the
    // pane is wide enough for the icon strip or has folded it into ⋮.
    const actions = await mailActions(view);
    for (const action of ['Reply', 'Reply all', 'Forward', 'Archive', 'Junk', 'Delete', 'Move to folder'])
      await expect(actions.getByRole('button', {name: action, exact: true})).toBeVisible();
    // Opening marks it read.
    await expect(rows.first()).not.toHaveClass(/unread/);
  });

  test('keeps All Platforms fixed at the top and opens on its combined list', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    const first = view.locator('.hub-view-source').first();
    await expect(first).toHaveText('All Platforms');
    await expect(first).toHaveClass(/active/);
    const chatRow = view.locator('.hub-view-row', {hasText: 'Jules Tan'});
    await expect(chatRow).toBeVisible();
    await expect(chatRow.locator('.hub-view-chat-avatar')).toHaveCount(1);
    const mailRow = view.locator('.hub-view-row', {hasText: 'Q3 numbers'}).first();
    await expect(mailRow).toBeVisible();
    await expect(mailRow.locator('.hub-view-chat-avatar')).toHaveCount(0);
    await expect(mailRow.locator('.hub-view-mail-mark svg[data-platform="mail"]')).toHaveCount(1);
    // And nothing is expanded for them: every multi-account source starts folded.
    await expect(view.locator('.hub-view-accounts')).toHaveCount(0);
  });

  test('creates a cross-platform broadcast and sends separate private messages', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    const fixedSources = view.locator('.hub-view-source-fixed .hub-view-source');
    await expect(fixedSources).toHaveText(['All Platforms', 'Broadcasts']);

    await fixedSources.filter({hasText: 'Broadcasts'}).click();
    const empty = view.locator('.hub-view-broadcast-empty');
    await expect(empty.getByRole('heading', {name: 'No broadcasts yet'})).toBeVisible();
    await expect(empty).toContainText('Recipients can’t see anyone else in the broadcast.');
    await empty.getByRole('button', {name: 'Create broadcast'}).click();

    await expect(view.getByText('Each person receives a separate message and can’t see the other recipients.')).toBeVisible();
    const contacts = view.locator('.hub-view-new-chat-contact');
    await contacts.filter({hasText: 'Jules Tan'}).click();
    await contacts.filter({hasText: 'Carl’s chat'}).click();
    await view.getByRole('textbox', {name: 'Broadcast name'}).fill('Launch update');
    await view.getByRole('button', {name: 'Create broadcast', exact: true}).click();

    await expect(view.getByRole('heading', {name: 'Launch update'})).toBeVisible();
    await expect(view.locator('.hub-view-broadcast-head')).toContainText('2 people · sent separately and privately');
    const composer = view.locator('.hub-view-broadcast-composer-row textarea');
    await composer.fill('We ship tomorrow.');
    await view.getByRole('button', {name: 'Send broadcast privately'}).click();
    await expect(view.locator('.hub-view-bubble.mine').first()).toContainText('We ship tomorrow.');
    await expect(view.locator('.hub-view-broadcast-delivery')).toContainText('Delivered privately to 2');

    await view.locator('.hub-view-back').click();
    const row = view.locator('.hub-view-broadcast-rows .hub-view-row', {hasText: 'Launch update'});
    await expect(row).toContainText('2 people');
    await expect(row).toContainText('We ship tomorrow.');
  });

  test('filters and sorts Hub conversations beside the new-chat control', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    const header = view.locator('.hub-view-list-head').first();
    const filter = header.getByRole('button', {name: 'Arrange'});

    await expect(filter).toBeVisible();
    await expect(filter).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const placement = await header.evaluate((node) => {
      const filterBox = node.querySelector<HTMLElement>('.hub-view-chat-filter-button')!.getBoundingClientRect();
      const newChatBox = node.querySelector<HTMLElement>('.hub-view-new-chat-icon')!.getBoundingClientRect();
      return {filterRight: filterBox.right, newChatLeft: newChatBox.left};
    });
    expect(placement.filterRight).toBeLessThanOrEqual(placement.newChatLeft);

    await filter.click();
    const menu = view.getByRole('menu', {name: 'Arrange'});
    await expect(menu).toBeVisible();
    await expect(filter).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const menuPlacement = await menu.evaluate((node) => {
      const menuBox = node.getBoundingClientRect();
      const filterBox = document.querySelector<HTMLElement>('.hub-view-chat-filter-button')!.getBoundingClientRect();
      return {top: menuBox.top, right: menuBox.right, filterRight: filterBox.right, filterBottom: filterBox.bottom};
    });
    expect(menuPlacement.top).toBeGreaterThan(menuPlacement.filterBottom);
    expect(Math.abs(menuPlacement.right - menuPlacement.filterRight)).toBeLessThanOrEqual(0.5);
    await expect(menu.getByRole('menuitemradio', {name: 'All', exact: true}).locator('svg')).toHaveCount(1);
    await expect(menu.getByRole('menuitemradio', {name: 'Latest'}).locator('svg')).toHaveCount(1);
    await expect(menu.getByRole('menuitemradio', {name: 'Unread'}).locator('svg')).toHaveCount(0);
    await expect(menu.getByRole('menuitemradio', {name: 'Earliest'}).locator('svg')).toHaveCount(0);

    await menu.getByRole('menuitemradio', {name: 'Unread'}).click();
    await expect(filter).toHaveClass(/on/);
    await expect(filter).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(view.locator('.hub-view-row', {hasText: 'Family'})).toBeVisible();
    await expect(view.locator('.hub-view-row', {hasText: 'Jules Tan'})).toHaveCount(0);
    await expect(view.locator('.hub-view-row', {hasText: 'Q3 numbers'}).first()).toBeVisible();

    await filter.click();
    await menu.getByRole('menuitemradio', {name: 'All', exact: true}).click();
    const rowLabels = view.locator('.hub-view-rows > li .hub-view-row strong');
    const latestFirst = await rowLabels.allInnerTexts();
    await filter.click();
    await menu.getByRole('menuitemradio', {name: 'Earliest'}).click();
    const earliestFirst = await rowLabels.allInnerTexts();
    expect(earliestFirst[0]).not.toBe(latestFirst[0]);

    await view.locator('.hub-view-source', {hasText: 'Contacts'}).click();
    await expect(view.getByRole('button', {name: 'Arrange'})).toHaveCount(0);
  });

  test('opens a bridged Space stack into its child chats and returns to the platform', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-source', {hasText: 'WhatsApp'}).click();

    await expect(view.getByRole('button', {name: /Open space: WhatsApp \(/})).toHaveCount(0);
    await expect(view.locator('.hub-view-row', {hasText: 'Jules Tan'})).toBeVisible();

    const space = view.getByRole('button', {
      name: 'Open space: NUS exchange students AY26/27, 3 chats',
    });
    await expect(space).toBeVisible();
    await expect(space.locator('.hub-view-space-layer')).toHaveCount(2);
    const avatarAlignment = await view.evaluate(() => {
      const normal = document.querySelector('.hub-view-row:not(.hub-view-space-row) .hub-view-chat-avatar')!;
      const front = document.querySelector('.hub-view-space-front .hub-view-chat-avatar')!;
      return Math.round(front.getBoundingClientRect().left - normal.getBoundingClientRect().left);
    });
    expect(avatarAlignment).toBe(0);
    const fanOffsets = await space.locator('.hub-view-space-stack').evaluate((stack) => {
      const offset = (selector: string) => (stack.querySelector<HTMLElement>(selector))!.offsetLeft;
      return [offset('.hub-view-space-layer-back'), offset('.hub-view-space-layer-middle'), offset('.hub-view-space-front')];
    });
    expect(fanOffsets).toEqual([-6, -3, 0]);
    // Child names describe the stack; they are not duplicate root chat rows.
    await expect(view.locator('.hub-view-row strong', {hasText: 'Social 💃'})).toHaveCount(0);

    await space.click();
    await expect(view.locator('.hub-view-space-heading strong')).toHaveText(
      'NUS exchange students AY26/27',
    );
    await expect(view.locator('.hub-view-rows > li > .hub-view-row strong')).toHaveText([
      'Social 💃',
      'School of Computing',
      'Running 👟',
    ]);

    await view.getByRole('button', {name: 'Back to WhatsApp'}).click();
    await expect(space).toBeVisible();
  });

  test('anchors Contacts at the bottom and lists direct contacts from every platform', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    const rail = view.getByRole('navigation', {name: 'Message sources'});
    const contacts = rail.getByRole('button', {name: 'Contacts'});

    await expect(contacts).toContainText('Contacts');
    await expect(contacts.locator('[data-icon="contacts"]')).toBeVisible();
    const placement = await rail.evaluate((node) => {
      const railBox = node.getBoundingClientRect();
      const footerBox = node.querySelector('.hub-view-rail-footer')!.getBoundingClientRect();
      const platformRows = [...node.querySelectorAll('.hub-view-rail-scroll .hub-view-source')];
      const lastPlatformBox = platformRows.at(-1)!.getBoundingClientRect();
      return {
        bottomGap: Math.round(railBox.bottom - footerBox.bottom),
        platformGap: Math.round(footerBox.top - lastPlatformBox.bottom),
      };
    });
    expect(placement.bottomGap).toBe(0);
    expect(placement.platformGap).toBeGreaterThan(40);

    await contacts.click();
    await expect(contacts).toHaveClass(/active/);
    const contactRows = view.locator('.hub-view-contact-row');
    await expect.poll(async () =>
      (await contactRows.locator('strong').allTextContents()).map((name) => name.trim()),
    ).toEqual([
      '+12262184662',
      'Carl’s chat',
      'File Transfer',
      'Jules Tan',
      'Polymux chat',
    ]);
    await expect(contactRows.filter({hasText: 'Family'})).toHaveCount(0);
    await expect(contactRows.filter({hasText: 'Dev Chat'})).toHaveCount(0);
    await expect(contactRows.locator('.hub-view-platform-badge')).toHaveCount(5);

    const search = view.getByRole('searchbox', {name: 'Search contacts'});
    await search.fill('WhatsApp');
    await expect(contactRows.locator('strong')).toHaveText(['+12262184662', 'Jules Tan']);
    await search.fill('');
    await view.getByRole('button', {name: 'Open Jules Tan on WhatsApp'}).click();
    await expect(view.getByRole('heading', {name: 'Jules Tan'})).toBeVisible();
  });

  test('renames a contact locally from its Hub profile', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.getByRole('navigation', {name: 'Message sources'}).getByRole('button', {name: 'Contacts'}).click();
    await view.getByRole('button', {name: 'Open Jules Tan on WhatsApp'}).click();

    await view.getByRole('button', {name: 'Rename Jules Tan'}).click();
    const name = view.getByRole('textbox', {name: 'Contact name'});
    await expect(name).toBeFocused();
    await name.fill('  小朱 🫶  ');
    await name.press('Enter');

    await expect(view.getByRole('heading', {name: '小朱 🫶'})).toBeVisible();
    await expect(view.getByRole('button', {name: 'Rename 小朱 🫶'})).toBeVisible();
    await expect(view.getByRole('button', {name: 'Separate chats'})).toHaveCount(0);

    await view.getByRole('button', {name: 'Back'}).click();
    await expect(view.locator('.hub-view-contact-row strong', {hasText: '小朱 🫶'})).toBeVisible();
    await view.getByRole('searchbox', {name: 'Search contacts'}).fill('Jules');
    await expect(view.locator('.hub-view-contact-row strong')).toHaveText(['小朱 🫶']);
  });

  test('limits the new-chat picker to the currently selected platform', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');

    await view.locator('.hub-view-source', {hasText: 'WhatsApp'}).click();
    await view.getByRole('button', {name: 'New chat'}).click();
    const pickerRows = view.locator('.hub-view-new-chat-contact');
    await expect(pickerRows.locator('strong')).toHaveText(['Jules Tan', '+12262184662']);
    await expect(pickerRows.locator('.hub-view-platform-badge')).toHaveCount(2);

    await view.getByRole('button', {name: 'Close new chat'}).click();
    await view.locator('.hub-view-source', {hasText: 'All Platforms'}).click();
    await view.getByRole('button', {name: 'New chat'}).click();
    await expect(pickerRows.locator('strong')).toHaveText([
      'File Transfer',
      'Jules Tan',
      '+12262184662',
      'Carl’s chat',
      'Polymux chat',
    ]);
  });

  test('uses a profile glyph when a bare phone number has no avatar initial', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-source', {hasText: 'WhatsApp'}).click();

    const phoneAvatar = view
      .locator('.hub-view-row', {hasText: '+12262184662'})
      .locator('.hub-view-chat-avatar.placeholder');
    await expect(phoneAvatar.locator('[data-icon="user"]')).toBeVisible();
    await expect(phoneAvatar).toHaveCSS('width', '28px');
    await expect(phoneAvatar).toHaveCSS('height', '28px');

    const namedAvatar = view
      .locator('.hub-view-row', {hasText: 'Jules Tan'})
      .locator('.hub-view-chat-avatar.placeholder');
    await expect(namedAvatar).toHaveText('J');
    await expect(namedAvatar.locator('[data-icon="user"]')).toHaveCount(0);
  });

  test('mutes chats from the context menu in All Platforms and every platform list', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    const allChat = view.locator('.hub-view-row', {hasText: 'Jules Tan'});

    await allChat.click({button: 'right'});
    const menu = view.getByRole('menu');
    await expect(menu.getByRole('menuitem')).toHaveText(['Pin to top', 'Mute', 'Hide']);
    await menu.getByRole('menuitem', {name: 'Mute'}).click();
    await expect(allChat.locator('.hub-view-chat-when [data-icon="speaker-off"]')).toBeVisible();

    await view.locator('.hub-view-source', {hasText: 'WhatsApp'}).click();
    const platformChat = view.locator('.hub-view-row', {hasText: 'Jules Tan'});
    await expect(platformChat.locator('.hub-view-chat-when [data-icon="speaker-off"]')).toBeVisible();
    await platformChat.click({button: 'right'});
    await expect(menu.getByRole('menuitem')).toHaveText(['Pin to top', 'Unmute', 'Hide']);
    await menu.getByRole('menuitem', {name: 'Unmute'}).click();
    await expect(platformChat.locator('.hub-view-chat-when [data-icon="speaker-off"]')).toHaveCount(0);
  });

  test('a dragged source is carried under the pointer and lands where it is let go', async ({
    page,
  }) => {
    await openView(page);
    const view = page.locator('.hub-view');
    const movable = view.locator('.hub-view-source-row:not(.hub-view-source-fixed) .hub-view-source');
    const names = () => movable.locator('span').allInnerTexts();
    const before = await names();

    const first = movable.first();
    const second = movable.nth(1);
    const from = (await first.boundingBox())!;
    const to = (await second.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    // Past the middle of the row below, which is where a row counts as passed.
    await page.mouse.move(from.x + from.width / 2, to.y + to.height * 0.75, {steps: 6});
    // Mid-drag the row is drawn under the pointer rather than left in place.
    await expect(view.locator('.hub-view-source-row.carried')).toHaveCount(1);
    await page.mouse.up();

    expect(await names()).toEqual([before[1], before[0], ...before.slice(2)]);
    // And the click the drag ends with does not also select what was dragged.
    await expect(view.locator('.hub-view-source-fixed .hub-view-source').first()).toHaveClass(/active/);
    await expect(view.locator('.hub-view-source').first()).toHaveText('All Platforms');
  });

  test('folds account lists under their platform row', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    const mailRow = view.locator('.hub-view-source', {hasText: 'Mail'});

    // Mail is one row, and it starts folded: a source with more than one
    // account waits to be asked rather than opening its list for you.
    await expect(mailRow).toHaveCount(1);
    await expect(view.locator('.hub-view-accounts button', {hasText: 'demo@work.example'})).toBeHidden();
    await mailRow.click();
    await expect(view.locator('.hub-view-accounts button', {hasText: 'demo@work.example'})).toBeVisible();
    await mailRow.click();
    await expect(view.locator('.hub-view-accounts button', {hasText: 'demo@work.example'})).toBeHidden();

    // A platform with more than one account behaves the same way.
    await view.locator('.hub-view-source', {hasText: 'Instagram'}).click();
    await expect(view.locator('.hub-view-accounts button', {hasText: '@carl.builds'})).toBeVisible();

    // One with a single account has nothing to fold, so its row selects it.
    await view.locator('.hub-view-source', {hasText: 'WhatsApp'}).click();
    await expect(view.locator('.hub-view-source', {hasText: 'WhatsApp'})).toHaveClass(/active/);
  });

  test('aligns expanded messaging accounts beneath their platform', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    const source = view.locator('.hub-view-source', {hasText: 'Instagram'});
    await source.click();

    const account = view.locator('.hub-view-accounts button', {hasText: '@carl.builds'});
    const avatar = account.locator('img.hub-view-chat-avatar.inline');
    await expect(avatar).toBeVisible();
    expect(await source.evaluate((button) => {
      const row = button.parentElement!;
      const list = row.querySelector<HTMLElement>('.hub-view-accounts')!;
      const item = list.querySelector<HTMLElement>('li')!;
      const accountButton = item.querySelector<HTMLButtonElement>('button')!;
      const image = accountButton.querySelector<HTMLImageElement>('img')!;
      const platformIcon = button.firstElementChild!.getBoundingClientRect();
      const platformLabel = button.lastElementChild!.getBoundingClientRect();
      const accountLabel = accountButton.lastElementChild!.getBoundingClientRect();
      const imageBox = image.getBoundingClientRect();
      return {
        avatarHeight: imageBox.height,
        textHeight: Number.parseFloat(getComputedStyle(accountButton).fontSize),
        guideContent: getComputedStyle(list, '::before').content,
        branchContent: getComputedStyle(item, '::before').content,
        avatarOffsetFromIconCentre: Number(Math.abs(
          imageBox.left - (platformIcon.left + platformIcon.width / 2),
        ).toFixed(2)),
        labelOffsetFromPlatformLabel: Number(Math.abs(
          accountLabel.left - platformLabel.left,
        ).toFixed(2)),
      };
    })).toEqual({
      avatarHeight: 11,
      textHeight: 11,
      guideContent: 'none',
      branchContent: 'none',
      avatarOffsetFromIconCentre: 0,
      labelOffsetFromPlatformLabel: 0.5,
    });
  });

  test('snaps the platform rail to icons and switches accounts beside search', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    const grid = view.locator('.hub-view-grid');
    const handle = view.getByRole('button', {name: 'Resize platform rail'});
    const railWidth = () => view.locator('.hub-view-rail').evaluate((rail) =>
      Math.round(rail.getBoundingClientRect().width));
    const railInsets = () => view.evaluate((node) => {
      const rail = node.querySelector('.hub-view-rail')!.getBoundingClientRect();
      const row = node.querySelector('.hub-view-source')!.getBoundingClientRect();
      return {
        top: Math.round(row.top - rail.top),
        side: Math.round(row.left - rail.left),
      };
    });

    await expect(grid).not.toHaveClass(/rail-compact/);
    await expect(view.getByRole('button', {name: 'Instagram'})).toContainText('Instagram');
    expect(await railInsets()).toEqual({top: 8, side: 8});

    const divider = (await handle.boundingBox())!;
    const dividerX = divider.x + divider.width / 2;
    await page.mouse.move(dividerX, divider.y + divider.height / 2);
    await page.mouse.down();
    await expect(grid).toHaveClass(/rail-resizing/);
    await page.mouse.move(dividerX - 40, divider.y + divider.height / 2);
    expect(await railWidth()).toBe(156);
    await page.mouse.move(dividerX - 60, divider.y + divider.height / 2);
    await expect.poll(railWidth).toBe(52);
    await page.mouse.up();

    await expect(grid).toHaveClass(/rail-compact/);
    await expect(view.locator('.hub-view-accounts')).toHaveCount(0);
    await expect(view.locator('.hub-view-source span').first()).toBeHidden();
    expect(await railInsets()).toEqual({top: 7, side: 7});

    await view.getByRole('button', {name: 'Instagram'}).click();
    const accounts = view.getByRole('button', {name: 'Choose account'});
    await expect(accounts).toHaveText(/@carl\.builds/);
    const accountBox = (await accounts.boundingBox())!;
    const searchBox = (await view.getByRole('searchbox', {name: 'Search conversations'}).boundingBox())!;
    expect(accountBox.x + accountBox.width).toBeLessThanOrEqual(searchBox.x + 1);
    await accounts.click();
    await view.getByRole('menuitemradio', {name: '@polymux'}).click();
    await expect(accounts).toHaveText(/@polymux/);
    await expect(view.locator('.hub-view-row', {hasText: 'Polymux chat'})).toBeVisible();
    await expect(view.locator('.hub-view-row', {hasText: 'Carl’s chat'})).toHaveCount(0);

    await view.getByRole('button', {name: 'Open space: Polymux community, 1 chat'}).click();
    await expect(view.locator('.hub-view-space-heading strong')).toHaveText('Polymux community');
    await expect(accounts).toHaveCount(0);
    await view.getByRole('button', {name: 'Back to Instagram'}).click();
    await expect(accounts).toHaveText(/@polymux/);

    const compactDivider = (await handle.boundingBox())!;
    const compactDividerX = compactDivider.x + compactDivider.width / 2;
    await page.mouse.move(compactDividerX, compactDivider.y + compactDivider.height / 2);
    await page.mouse.down();
    await expect(grid).toHaveClass(/rail-resizing/);
    await page.mouse.move(compactDividerX + 40, compactDivider.y + compactDivider.height / 2);
    expect(await railWidth()).toBe(52);
    await page.mouse.move(compactDividerX + 60, compactDivider.y + compactDivider.height / 2);
    await expect.poll(railWidth).toBe(156);
    await page.mouse.up();

    await expect(grid).not.toHaveClass(/rail-compact/);
    await expect(view.getByRole('button', {name: 'Instagram'})).toContainText('Instagram');
  });

  test('keeps each linked account to its own conversations', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-source', {hasText: 'Instagram'}).click();

    await view.locator('.hub-view-accounts button', {hasText: '@carl.builds'}).click();
    await expect(view.locator('.hub-view-row', {hasText: 'Carl’s chat'})).toBeVisible();
    await expect(view.locator('.hub-view-row', {hasText: 'Polymux chat'})).toHaveCount(0);

    await view.locator('.hub-view-accounts button', {hasText: '@polymux'}).click();
    await expect(view.locator('.hub-view-row', {hasText: 'Polymux chat'})).toBeVisible();
    await expect(view.locator('.hub-view-row', {hasText: 'Carl’s chat'})).toHaveCount(0);
  });

  test('does not badge a conversation whose latest message is mine', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    const replied = view.locator('.hub-view-row', {hasText: 'Jules Tan'});
    const waiting = view.locator('.hub-view-row', {hasText: 'Family'});

    await expect(replied).not.toHaveClass(/unread/);
    await expect(replied.locator('.hub-view-chat-unread')).toHaveCount(0);
    await expect(waiting.locator('.hub-view-chat-unread')).toHaveText('2');
  });

  test('filters the list down to unread messages', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await openMailbox(view);
    await expect(view.locator('.hub-view-row')).toHaveCount(3);

    await view.getByRole('button', {name: 'Filter messages'}).click();
    await view.getByRole('button', {name: 'Unread'}).click();
    // Only the unread row survives, and the filter reads as on.
    await expect(view.locator('.hub-view-row')).toHaveCount(1);
    await expect(view.locator('.hub-view-row').first()).toHaveClass(/unread/);
    await expect(view.getByRole('button', {name: 'Filter messages'})).toHaveClass(/on/);

    await view.getByRole('button', {name: 'Filter messages'}).click();
    await view.getByRole('button', {name: 'All', exact: true}).click();
    await expect(view.locator('.hub-view-row')).toHaveCount(3);
  });

  test('moves a message to junk', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await openMailbox(view);
    await expect(view.locator('.hub-view-row')).toHaveCount(3);
    await view.locator('.hub-view-row').first().click();
    await (await mailActions(view)).getByRole('button', {name: 'Junk', exact: true}).click();
    // The row leaves the folder it was moved out of.
    await expect(view.locator('.hub-view-row')).toHaveCount(2);
  });

  test('opens a chat thread and sends a message', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-source', {hasText: 'WhatsApp'}).click();
    await view.locator('.hub-view-row', {hasText: 'Jules Tan'}).click();

    // Two messages and a sticker.
    await expect(view.locator('.hub-view-bubble')).toHaveCount(3);
    // The incoming sticker quotes the account's bridge ghost. Ownership, not
    // that ghost's incomplete profile, decides how the quoted author reads.
    await expect(view.locator('.hub-view-quote strong')).toHaveText('You');
    await expect(view.getByText('Unknown user', {exact: true})).toHaveCount(0);
    await view.locator('.hub-view-composer textarea').fill('See you then.');
    // Send only appears once there is something to send; before that the
    // primary button is the microphone.
    await view.locator('.hub-view-composer button[aria-label="Send message"]').click();
    await expect(view.locator('.hub-view-bubble')).toHaveCount(4);
    // The sent message is attributed to the user, not the remote side.
    await expect(view.locator('.hub-view-bubble.mine').first()).toContainText('See you then.');
  });

  test('renders a Hub send normally while the bridge confirms delivery', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-source', {hasText: 'WhatsApp'}).click();
    await view.locator('.hub-view-row', {hasText: 'Jules Tan'}).click();

    await page.evaluate(() => {
      (window as unknown as {polymuxDemoHoldChatSends: () => void}).polymuxDemoHoldChatSends();
    });

    const field = view.locator('.hub-view-composer textarea');
    await field.fill('First message');
    await view.locator('.hub-view-composer button[aria-label="Send message"]').click();

    const pending = view.locator('[data-hub-message-pending="true"]', {hasText: 'First message'});
    await expect(pending).toBeVisible();
    await expect(pending).not.toContainText('Sending…');
    await expect(pending).toHaveCSS('opacity', '1');
    await expect(field).toHaveValue('');

    await field.fill('Next message');
    await expect(view.locator('.hub-view-composer button[aria-label="Send message"]')).toBeEnabled();
    await page.evaluate(() => {
      (window as unknown as {polymuxDemoReleaseChatSends: () => void}).polymuxDemoReleaseChatSends();
    });

    await expect(pending).toHaveCount(0);
    await expect(view.locator('.hub-view-bubble.mine', {hasText: 'First message'})).toHaveCount(1);
    await expect(field).toHaveValue('Next message');
  });

  test('shows one WeChat bubble immediately while background reconnect settles', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-source', {hasText: 'WeChat'}).click();
    await view.locator('.hub-view-row', {hasText: 'File Transfer'}).click();

    await page.evaluate(() => {
      (window as unknown as {
        polymuxDemoHoldWeChatWake: () => void;
      }).polymuxDemoHoldWeChatWake();
    });

    const field = view.locator('.hub-view-composer textarea');
    await field.fill('Wait for the real sender');
    await view.locator('.hub-view-composer button[aria-label="Send message"]').click();

    await expect(field).toHaveValue('');
    const pending = view.locator(
      '[data-hub-message-pending="true"]',
      {hasText: 'Wait for the real sender'},
    );
    await expect(pending).toBeVisible();
    await expect(pending).not.toContainText('Sending…');
    await expect(pending).toHaveCSS('opacity', '1');

    await page.evaluate(() => {
      (window as unknown as {
        polymuxDemoReleaseWeChatWake: () => void;
      }).polymuxDemoReleaseWeChatWake();
    });
    await expect(pending).toHaveCount(0);
    await expect(
      view.locator('.hub-view-bubble.mine', {hasText: 'Wait for the real sender'}),
    ).toHaveCount(1);
  });

  test('keeps a WeChat draft without creating a bubble when reconnect refuses', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-source', {hasText: 'WeChat'}).click();
    await view.locator('.hub-view-row', {hasText: 'File Transfer'}).click();

    await page.evaluate(() => {
      (window as unknown as {
        polymuxDemoSetWeChatWakeReady: (ready: boolean) => void;
      }).polymuxDemoSetWeChatWakeReady(false);
    });

    const field = view.locator('.hub-view-composer textarea');
    await field.fill('Keep this exact draft');
    await view.locator('.hub-view-composer button[aria-label="Send message"]').click();

    await expect(field).toHaveValue('Keep this exact draft');
    await expect(
      view.locator('[data-hub-message-pending="true"]', {hasText: 'Keep this exact draft'}),
    ).toHaveCount(0);
    await expect(
      view.locator('.hub-view-bubble.mine', {hasText: 'Keep this exact draft'}),
    ).toHaveCount(0);
  });

  test('keeps the Hub back chevron accessible and title-proportioned without a tooltip', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-source', {hasText: 'WhatsApp'}).click();
    await view.locator('.hub-view-row', {hasText: 'Jules Tan'}).click();
    await expect(page.locator('#startup-splash')).toHaveCount(0, {timeout: 10_000});

    const back = view.getByRole('button', {name: 'Back', exact: true});
    await expect(back.locator(':scope > [data-icon="back"]')).toBeVisible();
    const proportions = await view.locator('.hub-view-chat-head').evaluate((header) => {
      const icon = header.querySelector<SVGElement>('.hub-view-back-icon svg')!.getBoundingClientRect();
      const title = header.querySelector<HTMLElement>('.hub-view-chat-profile-trigger, h2')!;
      return {
        iconSize: Math.round(icon.width),
        titleFontSize: Math.round(Number.parseFloat(getComputedStyle(title).fontSize)),
      };
    });
    expect(proportions).toEqual({iconSize: 15, titleFontSize: 15});
    await back.hover();
    await expect(page.locator('.shared-tooltip')).toHaveCount(0);
  });

  test('returning to a conversation paints what it knew rather than reloading', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-source', {hasText: 'WhatsApp'}).click();
    await view.locator('.hub-view-row', {hasText: 'Jules Tan'}).click();
    await expect(view.locator('.hub-view-bubble').first()).toBeVisible();

    // Away and back. The second visit is served from what the first learned,
    // so there is no skeleton in between.
    await view.locator('.hub-view-back').click();
    await view.locator('.hub-view-row', {hasText: 'Jules Tan'}).click();
    await expect(view.locator('.hub-view-bubble-skeleton')).toHaveCount(0);
    await expect(view.locator('.hub-view-bubble').first()).toBeVisible();
  });

  test('leaving the hub and coming back keeps the pane rather than rebuilding it', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-source', {hasText: 'WhatsApp'}).click();
    await view.locator('.hub-view-row', {hasText: 'Jules Tan'}).click();
    await expect(view.locator('.hub-view-bubble').first()).toBeVisible();

    // The hub is a workspace tab, so leaving destroys it. What it was looking
    // at has to survive that, or coming back starts from a default source and
    // rebuilds the pane the user was already in.
    await page.getByRole('button', {name: 'New tab', exact: true}).click();
    await page.locator('.workspace-launcher').getByRole('button', {name: 'Browser'}).click();
    await page.locator('.tab', {hasText: 'Hub'}).locator('.tab-main').click();

    await expect(page.locator('.hub-view .hub-view-bubble').first()).toBeVisible();
    await expect(page.locator('.hub-view .hub-view-bubble-skeleton')).toHaveCount(0);
  });

  test('keeps each chat draft when conversations and workspace tabs change', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-source', {hasText: 'WhatsApp'}).click();
    await view.locator('.hub-view-row', {hasText: 'Jules Tan'}).click();
    await view.locator('.hub-view-composer textarea').fill('Draft for Jules');

    await view.locator('.hub-view-back').click();
    await view.locator('.hub-view-row', {hasText: 'Family'}).click();
    await view.locator('.hub-view-composer textarea').fill('Draft for Family');
    await view.locator('.hub-view-back').click();
    await view.locator('.hub-view-row', {hasText: 'Jules Tan'}).click();
    await expect(view.locator('.hub-view-composer textarea')).toHaveValue('Draft for Jules');

    await page.getByRole('button', {name: 'New tab', exact: true}).click();
    await page.locator('.workspace-launcher').getByRole('button', {name: 'Browser'}).click();
    await page.locator('.tab', {hasText: 'Hub'}).locator('.tab-main').click();
    await expect(page.locator('.hub-view-composer textarea')).toHaveValue('Draft for Jules');
  });

  test('recovers an email compose after leaving the Hub', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await openMailbox(view);
    await view.getByRole('button', {name: 'New'}).click();
    const compose = view.locator('.hub-view-compose-form');
    await compose.locator('input').first().fill('dana@example.com');
    await compose.locator('input').nth(1).fill('Friday plans');
    await compose.locator('textarea').fill('Are we still on?');

    await page.getByRole('button', {name: 'New tab', exact: true}).click();
    await page.locator('.workspace-launcher').getByRole('button', {name: 'Browser'}).click();
    await page.locator('.tab', {hasText: 'Hub'}).locator('.tab-main').click();

    const restored = page.locator('.hub-view-compose-form');
    await expect(restored.locator('input').first()).toHaveValue('dana@example.com');
    await expect(restored.locator('input').nth(1)).toHaveValue('Friday plans');
    await expect(restored.locator('textarea')).toHaveValue('Are we still on?');
  });

  test('every chat names incoming sender runs with the shared rounded-square avatar', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-source', {hasText: 'WhatsApp'}).click();
    await view.locator('.hub-view-row', {hasText: 'Family'}).click();

    // The label belongs to the row, outside the bubble, not inside it.
    await expect(view.locator('.hub-view-bubble .hub-view-bubble-who')).toHaveCount(0);
    const identities = view.locator('.hub-view-bubble-who');
    const names = identities.locator('.hub-view-bubble-sender');
    // Newest first: Dad, then Mum on each side of the group notice. A notice
    // deliberately starts a new sender run just like a date stamp does.
    await expect(names).toHaveText(['Dad', 'Mum', 'Mum']);
    const avatar = identities.filter({hasText: 'Mum'}).locator('img');
    await expect(avatar).toHaveCount(2);
    for (const image of await avatar.all()) {
      await expect(image).toHaveCSS('width', '11px');
      await expect(image).toHaveCSS('height', '11px');
      await expect(image).toHaveCSS('border-radius', '3px');
    }

    // Direct conversations use the same sender identity treatment. With no
    // source image in this fixture, the shared fallback supplies the initial.
    await view.locator('.hub-view-back').click();
    await view.locator('.hub-view-row', {hasText: 'Jules Tan'}).click();
    const directSender = view.locator('.hub-view-bubble-who');
    // One raw profile carries Matrix compatibility metadata and the other is
    // unresolved; both visible identities use the direct contact's real name.
    await expect(directSender.locator('.hub-view-bubble-sender')).toHaveText(['Jules Tan', 'Jules Tan']);
    await expect(view.getByText('Jules Tan (WA)', {exact: true})).toHaveCount(0);
    const fallback = directSender.locator('.hub-view-chat-avatar.placeholder');
    await expect(fallback).toHaveText(['J', 'J']);
    await expect(fallback.first()).toHaveCSS('border-radius', '3px');
  });

  test('each message row reveals its own vertically centred time on the outside edge', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-source', {hasText: 'WhatsApp'}).click();
    await view.locator('.hub-view-row', {hasText: 'Jules Tan'}).click();

    await expect(view.locator('.hub-view-bubble em')).toHaveCount(0);
    const incomingRow = view.locator('[data-message-id="c1"]');
    const incomingLine = incomingRow.locator('.hub-view-bubble-line');
    const incomingTime = incomingRow.locator('.hub-view-bubble-time');
    await expect(incomingTime).toHaveCSS('opacity', '0');
    const incomingLineBox = await incomingLine.boundingBox();
    if (!incomingLineBox) throw new Error('Incoming message row is missing');
    await incomingLine.hover({position: {x: incomingLineBox.width - 1, y: incomingLineBox.height / 2}});
    await expect(incomingTime).toHaveCSS('opacity', '1');

    const incomingPosition = await incomingRow.evaluate((node) => {
      const bubble = node.querySelector<HTMLElement>('.hub-view-bubble')!.getBoundingClientRect();
      const time = node.querySelector<HTMLElement>('.hub-view-bubble-time')!.getBoundingClientRect();
      return {
        outside: time.left >= bubble.right,
        gap: time.left - bubble.right,
        centreOffset: Math.abs((time.top + time.bottom - bubble.top - bubble.bottom) / 2),
      };
    });
    expect(incomingPosition.outside).toBe(true);
    expect(incomingPosition.gap).toBe(10);
    expect(incomingPosition.centreOffset).toBeLessThanOrEqual(0.5);

    const outgoingRow = view.locator('[data-message-id="c2"]');
    const outgoingSpacer = outgoingRow.locator('.hub-view-bubble-who-space');
    await expect(outgoingSpacer).toHaveCSS('visibility', 'hidden');
    const headerHeights = await view.evaluate((node) => ({
      incoming: node.querySelector('.hub-view-bubble-who')!.getBoundingClientRect().height,
      outgoing: node.querySelector('.hub-view-bubble-who-space')!.getBoundingClientRect().height,
    }));
    expect(headerHeights.outgoing).toBe(headerHeights.incoming);
    const outgoingLine = outgoingRow.locator('.hub-view-bubble-line');
    const outgoingTime = outgoingRow.locator('.hub-view-bubble-time');
    await expect(outgoingTime).toHaveCSS('opacity', '0');
    const outgoingLineBox = await outgoingLine.boundingBox();
    if (!outgoingLineBox) throw new Error('Outgoing message row is missing');
    await outgoingLine.hover({position: {x: 1, y: outgoingLineBox.height / 2}});
    await expect(outgoingTime).toHaveCSS('opacity', '1');
    await expect(incomingTime).toHaveCSS('opacity', '0');

    const outgoingPosition = await outgoingRow.evaluate((node) => {
      const bubble = node.querySelector<HTMLElement>('.hub-view-bubble')!.getBoundingClientRect();
      const time = node.querySelector<HTMLElement>('.hub-view-bubble-time')!.getBoundingClientRect();
      return {
        outside: time.right <= bubble.left,
        gap: bubble.left - time.right,
        centreOffset: Math.abs((time.top + time.bottom - bubble.top - bubble.bottom) / 2),
      };
    });
    expect(outgoingPosition.outside).toBe(true);
    expect(outgoingPosition.gap).toBe(10);
    expect(outgoingPosition.centreOffset).toBeLessThanOrEqual(0.5);

    await view.locator('.hub-view-back').click();
    await view.locator('.hub-view-source', {hasText: 'All Platforms'}).click();
    await view.locator('.hub-view-row', {hasText: 'File Transfer'}).click();
    const outgoingRun = view.locator('[data-message-id="wx4"]').locator('xpath=..');
    await expect(outgoingRun.locator('.hub-view-bubble-row')).toHaveCount(3);
    await expect(outgoingRun.locator('.hub-view-bubble-time')).toHaveCount(3);
    const olderTime = outgoingRun.locator('[data-message-id="wx4"] .hub-view-bubble-time');
    const newestLine = outgoingRun.locator('[data-message-id="wx6"] .hub-view-bubble-line');
    const newestTime = outgoingRun.locator('[data-message-id="wx6"] .hub-view-bubble-time');
    await newestLine.hover({position: {x: 1, y: 1}});
    await expect(newestTime).toHaveCSS('opacity', '1');
    await expect(olderTime).toHaveCSS('opacity', '0');
  });

  test('a direct chat replaces a generic bridge profile with the contact name', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-source', {hasText: 'WhatsApp'}).click();
    await view.locator('.hub-view-row', {hasText: 'Jules Tan'}).click();

    await expect(
      view.locator('.hub-view-bubble-sender'),
    ).toHaveText(['Jules Tan', 'Jules Tan']);
    await expect(view.getByText('Unknown user', {exact: true})).toHaveCount(0);
  });

  test('a conversation notice is centred text rather than an outgoing bubble', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-source', {hasText: 'WhatsApp'}).click();
    await view.locator('.hub-view-row', {hasText: 'Family'}).click();

    const notice = view.locator('.hub-view-notice', {hasText: 'Peter6C invited Percival'});
    await expect(notice).toHaveText('Peter6C invited Percival to the group chat');
    await expect(notice).toHaveCSS('text-align', 'center');
    await expect(view.locator('.hub-view-bubble', {hasText: 'Peter6C invited Percival'})).toHaveCount(0);
  });

  test('a WhatsApp membership change uses the same centred notice treatment', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-source', {hasText: 'WhatsApp'}).click();
    await view.locator('.hub-view-row', {hasText: 'Family'}).click();

    const notice = view.locator('.hub-view-notice', {hasText: 'Áron joined the group'});
    await expect(notice).toBeVisible();
    await expect(notice).toHaveCSS('text-align', 'center');
    await expect(view.locator('.hub-view-bubble', {hasText: 'Áron joined the group'})).toHaveCount(0);
  });

  test('Telegram service events and rich links use the shared thread treatment', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    // The demo keeps Telegram logged out to exercise setup, while its unified
    // inbox still carries a Telegram-shaped thread through the shared reader.
    await view.locator('.hub-view-row', {hasText: 'Dev Chat'}).click();

    const notice = view.locator('.hub-view-notice', {hasText: 'Manny Asbanu joined the group'});
    await expect(notice).toBeVisible();
    await expect(notice).toHaveCSS('text-align', 'center');

    const bubble = view.locator('.hub-view-bubble', {hasText: 'CS3210 Tutorial 1'});
    const rawLink = bubble.locator('.hub-view-message-link');
    const card = bubble.locator('.hub-view-link-card');
    await expect(rawLink).toHaveText('https://docs.google.com/presentation/d/tutorial/edit?usp=sharing');
    await expect(card).toContainText('Instrumentation, Profiling, Slurm, and Report Writing');
    await expect(card).toContainText('docs.google.com');
    await expect(card.locator('img')).toBeVisible();
    await expect(card.locator('img')).toHaveCSS('width', '64px');
    const rawLinkComesFirst = await bubble.evaluate((node) => {
      const link = node.querySelector('.hub-view-message-link');
      const preview = node.querySelector('.hub-view-link-card');
      return Boolean(link && preview && (link.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING));
    });
    expect(rawLinkComesFirst).toBe(true);
  });

  test('the composer offers the microphone until there is something to send', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-source', {hasText: 'WhatsApp'}).click();
    await view.locator('.hub-view-row', {hasText: 'Jules Tan'}).click();

    const row = view.locator('.hub-view-composer-row');
    const composer = row.locator('.hub-view-composer');
    const add = row.getByRole('button', {name: 'More actions'});
    // Empty: the plus stays outside the shared field, whose primary button
    // starts dictation until there is a message to send.
    let labels = await composer.locator('.message-input-primary').evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute('aria-label')),
    );
    expect(labels).toEqual(['Dictate message']);
    await expect(composer.locator('button[aria-label="Dictate message"]')).toBeVisible();
    await expect(composer.locator('button[aria-label="Send message"]')).toHaveCount(0);
    const geometry = await row.evaluate((node) => {
      const addBox = node.querySelector<HTMLElement>('.hub-view-composer-add')!.getBoundingClientRect();
      const fieldBox = node.querySelector<HTMLElement>('.hub-view-composer')!.getBoundingClientRect();
      return {
        addWidth: addBox.width,
        addHeight: addBox.height,
        fieldHeight: fieldBox.height,
        gap: fieldBox.left - addBox.right,
      };
    });
    expect(geometry).toEqual({addWidth: 42, addHeight: 42, fieldHeight: 42, gap: 6});

    await composer.locator('textarea').fill('typing');
    await expect(composer.locator('button[aria-label="Send message"]')).toBeVisible();
    await expect(composer.locator('button[aria-label="Dictate message"]')).toHaveCount(0);
    labels = await composer.locator('.message-input-primary').evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute('aria-label')),
    );
    expect(labels).toEqual(['Send message']);
    const sendGap = await composer.evaluate((node) => {
      const fieldBox = node.querySelector('textarea')!.getBoundingClientRect();
      const sendBox = node.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')!.getBoundingClientRect();
      return sendBox.left - fieldBox.right;
    });
    expect(sendGap).toBe(4);

    // Occasional tools stay available from the plus either way.
    await expect(add).toBeVisible();
    await composer.locator('textarea').fill('');
    await expect(composer.locator('button[aria-label="Dictate message"]')).toBeVisible();
  });

  test('records WeChat voice from the Hub microphone instead of its desktop shortcut', async ({page}) => {
    await page.addInitScript(() => {
      const context = new AudioContext();
      const tone = context.createOscillator();
      const level = context.createGain();
      level.gain.value = 0.08;
      tone.connect(level);
      tone.start();
      navigator.mediaDevices.getUserMedia = async () => {
        await context.resume();
        const destination = context.createMediaStreamDestination();
        level.connect(destination);
        return destination.stream;
      };
    });
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-source', {hasText: 'WeChat'}).click();
    await view.locator('.hub-view-row', {hasText: 'File Transfer'}).click();

    const composer = view.locator('.hub-view-composer');
    await view.getByRole('button', {name: /^More actions:/}).click();
    await view.getByRole('menuitem', {name: 'Record a voice message'}).click();
    await expect(composer).toHaveClass(/capturing/);
    await expect(composer.getByRole('button', {name: 'Discard recording'})).toBeVisible();
    await page.waitForTimeout(1_100);
    await composer.getByRole('button', {name: 'Send'}).click();

    await expect(composer).not.toHaveClass(/capturing/);
    await expect(composer.getByRole('button', {name: 'Dictate message'})).toBeVisible();
    await expect(view.locator('.hub-view-error:visible')).toHaveCount(0);
    const voiceActions = () => page.evaluate(() => (
      window as unknown as {
        polymuxDemoChatActions: () => Array<Record<string, unknown>>;
      }
    ).polymuxDemoChatActions());
    await expect.poll(voiceActions).toHaveLength(1);
    const [action] = await voiceActions();
    expect(action).toMatchObject({
      kind: 'audio',
      chatId: '!wx-filehelper:local',
      mimetype: 'audio/wav',
    });
    expect(Number(action?.size)).toBeGreaterThan(44);
  });

  test('opens a searchable emoji picker and inserts at the composer caret', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-source', {hasText: 'WhatsApp'}).click();
    await view.locator('.hub-view-row', {hasText: 'Jules Tan'}).click();

    const row = view.locator('.hub-view-composer-row');
    const composer = row.locator('.hub-view-composer');
    const field = composer.locator('textarea');
    await field.fill('Hello there');
    await field.evaluate((node) => (node as HTMLTextAreaElement).setSelectionRange(6, 6));
    await row.getByRole('button', {name: 'More actions'}).click();

    const menu = row.getByRole('menu', {name: 'More actions'});
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveText(['Attach files', 'Add emoji', 'Record a voice message']);
    const compactMenu = await row.evaluate((node) => {
      const menuBox = node.querySelector<HTMLElement>('.hub-view-composer-tools-menu')!.getBoundingClientRect();
      const addBox = node.querySelector<HTMLElement>('.hub-view-composer-add')!.getBoundingClientRect();
      return {top: menuBox.top, bottomGap: addBox.top - menuBox.bottom};
    });
    expect(compactMenu.bottomGap).toBe(7);

    // The actions menu owns only itself and its trigger. Clicking the draft is
    // outside it and dismisses it, even though the field shares the same row.
    await field.click();
    await expect(menu).toHaveCount(0);

    // Growing the message field does not push the menu upwards. It remains
    // fixed over the plus and may overlap the taller draft behind it.
    await field.fill('one\ntwo\nthree');
    await row.getByRole('button', {name: 'More actions'}).click();
    await expect(menu).toBeVisible();
    const tallMenu = await row.evaluate((node) => {
      const menuBox = node.querySelector<HTMLElement>('.hub-view-composer-tools-menu')!.getBoundingClientRect();
      const addBox = node.querySelector<HTMLElement>('.hub-view-composer-add')!.getBoundingClientRect();
      return {top: menuBox.top, bottomGap: addBox.top - menuBox.bottom};
    });
    expect(tallMenu).toEqual(compactMenu);
    await field.click();
    await field.fill('Hello there');
    await field.evaluate((node) => (node as HTMLTextAreaElement).setSelectionRange(6, 6));
    await row.getByRole('button', {name: 'More actions'}).click();
    await menu.getByRole('menuitem', {name: 'Add emoji'}).click();

    const picker = row.getByRole('group', {name: 'Emoji'});
    const search = picker.getByRole('searchbox', {name: 'Search'});
    await expect(picker).toBeVisible();
    await expect(search).toBeFocused();

    // Clicking back into the message keeps the picker available. It closes
    // only once that focus becomes an actual text edit.
    await field.click();
    await expect(picker).toBeVisible();
    await field.evaluate((node) => (node as HTMLTextAreaElement).setSelectionRange(6, 6));
    await search.fill('fire');
    await picker.getByRole('button', {name: 'fire', exact: true}).click();

    await expect(picker).toHaveCount(0);
    await expect(field).toBeFocused();
    await expect(field).toHaveValue('Hello 🔥there');
    await expect.poll(() => field.evaluate((node) => (node as HTMLTextAreaElement).selectionStart)).toBe(8);

    await row.getByRole('button', {name: 'More actions'}).click();
    await menu.getByRole('menuitem', {name: 'Add emoji'}).click();
    await field.click();
    await field.press('End');
    await field.type('!');
    await expect(picker).toHaveCount(0);
    await expect(field).toHaveValue('Hello 🔥there!');
  });

  test('the message composer grows to its height limit, then scrolls without a scrollbar', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-source', {hasText: 'WhatsApp'}).click();
    await view.locator('.hub-view-row', {hasText: 'Jules Tan'}).click();

    const composer = view.locator('.hub-view-composer');
    const field = composer.locator('textarea');
    const heights: number[] = [];
    for (const value of Array.from({length: 7}, (_, index) => Array(index + 1).fill('line').join('\n'))) {
      await field.fill(value);
      heights.push(await field.evaluate((node) => node.getBoundingClientRect().height));
    }
    expect(heights[1]).toBeGreaterThan(heights[0]);
    expect(heights[2]).toBeGreaterThan(heights[1]);
    expect(heights[4]).toBe(90);
    expect(heights[5]).toBe(heights[4]);
    expect(heights[6]).toBe(heights[4]);

    const overflow = await field.evaluate((node) => ({
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      scrollbarWidth: getComputedStyle(node).scrollbarWidth,
      webkitScrollbarDisplay: getComputedStyle(node, '::-webkit-scrollbar').display,
    }));
    expect(overflow.scrollHeight).toBeGreaterThan(overflow.clientHeight);
    expect(overflow.scrollbarWidth).toBe('none');
    expect(overflow.webkitScrollbarDisplay).toBe('none');

    const bottoms = await composer.evaluate((node) => ({
      field: node.querySelector('textarea')!.getBoundingClientRect().bottom,
      controls: [...node.querySelectorAll('button')].map((button) => button.getBoundingClientRect().bottom),
    }));
    for (const control of bottoms.controls) {
      expect(Math.abs(control - bottoms.field)).toBeLessThanOrEqual(0.5);
    }
  });

  test('reacts to a message, and answers it with the original quoted', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-source', {hasText: 'WhatsApp'}).click();
    await view.locator('.hub-view-row', {hasText: 'Jules Tan'}).click();

    // The actions live in a context menu on the message, opened where the
    // pointer is, rather than in a row of icons under every bubble.
    const first = view.locator('.hub-view-bubble-row').first();
    const menu = page.locator('.hub-view-message-menu');
    await first.click({button: 'right'});
    await expect(menu).toBeVisible();
    await menu.locator('.hub-view-emoji-row button', {hasText: '👍'}).click();
    await expect(menu).toHaveCount(0);
    await expect(first.locator('.hub-view-reaction')).toContainText('👍');

    // More reactions stay inside this compact menu: the + is the last quick
    // action. Its attached picker extends without moving the menu or strip.
    await first.click({button: 'right'});
    const moreReactions = menu.getByRole('button', {name: 'React'});
    await expect(menu.locator('.hub-view-emoji-row button').last()).toHaveAttribute('aria-label', 'React');
    const beforeExpansion = await menu.evaluate((node) => {
      const strip = node.querySelector<HTMLElement>('.hub-view-emoji-row');
      if (!strip) throw new Error('Quick reaction strip is missing');
      return {
        menu: node.getBoundingClientRect().toJSON(),
        strip: strip.getBoundingClientRect().toJSON(),
      };
    });
    await moreReactions.click();
    const picker = menu.locator('.hub-view-emoji-picker');
    const search = picker.getByRole('searchbox', {name: 'Search'});
    await expect(picker).toBeVisible();
    await expect(search).toBeFocused();
    await expect.poll(() => picker.evaluate((node) => node.getBoundingClientRect().height)).toBe(168);
    const proportions = await menu.evaluate((node) => {
      const quick = node.querySelector<HTMLElement>('.hub-view-emoji-row button:not(.hub-view-emoji-more)');
      const expanded = node.querySelector<HTMLElement>('.hub-view-emoji-grid button');
      const picker = node.querySelector<HTMLElement>('.hub-view-emoji-picker');
      if (!quick || !expanded || !picker) throw new Error('Reaction picker is incomplete');
      const pickerStyle = getComputedStyle(picker);
      const dividerStyle = getComputedStyle(picker, '::after');
      const menuStyle = getComputedStyle(node);
      const pickerRect = picker.getBoundingClientRect();
      return {
        quickSize: getComputedStyle(quick).fontSize,
        expandedSize: getComputedStyle(expanded).fontSize,
        pickerHeight: picker.getBoundingClientRect().height,
        menu: node.getBoundingClientRect().toJSON(),
        strip: node.querySelector<HTMLElement>('.hub-view-emoji-row')!.getBoundingClientRect().toJSON(),
        pickerWidth: pickerRect.width,
        pickerLeft: pickerRect.left,
        pickerRight: pickerRect.right,
        pickerTop: pickerRect.top,
        pickerBottom: pickerRect.bottom,
        viewportBottom: window.innerHeight - 8,
        pickerBorder: pickerStyle.borderTopStyle,
        pickerDivider: dividerStyle.backgroundColor,
        pickerDividerHeight: dividerStyle.height,
        pickerDividerOpacity: dividerStyle.opacity,
        pickerDividerAnimation: dividerStyle.animationName,
        pickerDividerY: pickerRect.bottom - parseFloat(dividerStyle.bottom),
        pickerBackground: pickerStyle.backgroundColor,
        pickerShadow: pickerStyle.boxShadow,
        menuBackground: menuStyle.backgroundColor,
        menuBorder: menuStyle.borderTopWidth,
        menuOutline: menuStyle.outlineStyle,
        menuRadius: menuStyle.borderTopLeftRadius,
        menuShadow: menuStyle.boxShadow,
      };
    });
    expect(proportions.expandedSize).toBe(proportions.quickSize);
    expect(proportions.pickerHeight).toBeLessThan(170);
    expect(proportions.menu.height).toBe(beforeExpansion.menu.height + 168);
    expect(proportions.menu.top).toBe(beforeExpansion.menu.top - 168);
    expect(proportions.menu.bottom).toBe(beforeExpansion.menu.bottom);
    expect(proportions.strip).toEqual(beforeExpansion.strip);
    // The picker is an ordinary content row inside the same menu. Its inset
    // divider matches the quick strip's divider above Reply and Copy.
    expect(proportions.pickerWidth).toBe(proportions.strip.width);
    expect(proportions.pickerLeft).toBe(proportions.strip.left);
    expect(proportions.pickerRight).toBe(proportions.strip.right);
    expect(proportions.pickerBorder).toBe('none');
    expect(proportions.pickerDivider).not.toBe('rgba(0, 0, 0, 0)');
    expect(proportions.pickerDividerHeight).toBe('1px');
    expect(proportions.pickerDividerOpacity).toBe('0.42');
    expect(proportions.pickerDividerAnimation).toBe('hub-view-emoji-divider-in');
    expect(proportions.pickerBackground).toBe('rgba(0, 0, 0, 0)');
    expect(proportions.pickerShadow).toBe('none');
    expect(proportions.menuBackground).not.toBe('rgba(0, 0, 0, 0)');
    expect(proportions.menuBorder).toBe('1px');
    expect(proportions.menuOutline).toBe('none');
    expect(proportions.menuRadius).toBe('12px');
    expect(proportions.menuShadow).not.toBe('none');
    expect(proportions.pickerTop).toBeGreaterThanOrEqual(8);
    expect(proportions.pickerBottom).toBeLessThanOrEqual(proportions.viewportBottom);

    // Pressing + again removes height from that same menu. The menu is anchored
    // by its bottom edge, so the quick strip stays fixed without ever entering
    // a transformed layer that could snap on the final animation frame.
    await moreReactions.click();
    await expect(picker).toHaveCount(1);
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    const closing = await menu.evaluate((node) => {
      const picker = node.querySelector<HTMLElement>('.hub-view-emoji-picker');
      const strip = node.querySelector<HTMLElement>('.hub-view-emoji-row');
      if (!picker || !strip) throw new Error('Closing reaction picker is missing');
      const style = getComputedStyle(picker);
      const dividerStyle = getComputedStyle(picker, '::after');
      const menuStyle = getComputedStyle(node);
      const pickerRect = picker.getBoundingClientRect();
      return {
        position: style.position,
        animatingHeight: style.overflow === 'clip',
        direction: picker.classList.contains('above') ? 'above' : 'below',
        dividerHeight: dividerStyle.height,
        dividerAnimation: dividerStyle.animationName,
        dividerAnimationDuration: dividerStyle.animationDuration,
        dividerY: pickerRect.bottom - parseFloat(dividerStyle.bottom),
        outline: style.outlineStyle,
        menuBorder: menuStyle.borderTopWidth,
        menuBorderColor: menuStyle.borderTopColor,
        menuOutline: menuStyle.outlineStyle,
        menuBackground: menuStyle.backgroundColor,
        menuShadow: menuStyle.boxShadow,
        menuRadius: menuStyle.borderTopLeftRadius,
        menuTop: node.style.top,
        menuBottom: node.style.bottom,
        menuTransform: menuStyle.transform,
        menu: node.getBoundingClientRect().toJSON(),
        strip: strip.getBoundingClientRect().toJSON(),
      };
    });
    expect(closing.position).toBe('relative');
    expect(closing.animatingHeight).toBe(true);
    expect(closing.dividerHeight).toBe('1px');
    expect(closing.dividerAnimation).toBe('hub-view-emoji-divider-out');
    expect(closing.dividerAnimationDuration).toBe('0.02s');
    expect(closing.dividerY).toBe(proportions.pickerDividerY);
    expect(closing.outline).toBe('none');
    expect(closing.menuBorder).toBe('1px');
    expect(closing.menuBorderColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(closing.menuOutline).toBe('none');
    expect(closing.menuBackground).not.toBe('rgba(0, 0, 0, 0)');
    expect(closing.menuShadow).not.toBe('none');
    expect(closing.menuRadius).toBe('12px');
    expect(closing.menuTop).toBe('auto');
    expect(closing.menuBottom).not.toBe('auto');
    expect(closing.menuTransform).toBe('none');
    expect(closing.menu.bottom).toBe(beforeExpansion.menu.bottom);
    expect(closing.strip).toEqual(beforeExpansion.strip);
    await expect(picker).toHaveCount(0);
    await expect.poll(() => menu.evaluate((node) => node.getBoundingClientRect().toJSON())).toEqual(beforeExpansion.menu);
    await expect(menu).toHaveCSS('border-top-left-radius', '12px');

    // The same control reverses cleanly and restores the searchable picker.
    await moreReactions.click();
    await expect(picker).toBeVisible();
    await expect(search).toBeFocused();
    await search.fill('fire');
    await picker.getByRole('button', {name: 'fire', exact: true}).click();
    await expect(menu).toHaveCount(0);
    // Narrow threads swap the full reaction plate for the compact emoji
    // stack, keeping the measured plate only as a hidden copy.
    await expect(first.locator('.hub-view-reaction:visible, .hub-view-reaction-emoji-button:visible', {hasText: '🔥'})).toBeVisible();

    await first.click({button: 'right'});
    await menu.getByRole('menuitem', {name: 'Reply'}).click();
    // The bar says what is being answered before the answer is written.
    const replying = view.locator('.hub-view-replying');
    await expect(replying).toBeVisible();
    await expect(replying).toHaveCSS('border-bottom-left-radius', '999px');
    await expect(replying).toHaveCSS('border-bottom-right-radius', '999px');
    const centres = await replying.evaluate((pill) => {
      const centre = (box: DOMRect) => box.top + box.height / 2;
      const iconInkCentre = (icon: SVGSVGElement) => {
        const path = icon.querySelector<SVGGraphicsElement>('path');
        if (!path) throw new Error('Reply icon is missing its visible path');
        const ink = path.getBBox();
        const box = icon.getBoundingClientRect();
        return box.top + ((ink.y + ink.height / 2) / 24) * box.height;
      };
      const text = pill.querySelector<HTMLElement>('.hub-view-reply-jump > span');
      const icons = pill.querySelectorAll<SVGSVGElement>('[data-icon]');
      if (!text || icons.length !== 2) throw new Error('Reply pill contents are incomplete');
      return {
        pill: centre(pill.getBoundingClientRect()),
        text: centre(text.getBoundingClientRect()),
        reply: iconInkCentre(icons[0]),
        close: iconInkCentre(icons[1]),
      };
    });
    for (const component of [centres.text, centres.reply, centres.close]) {
      expect(Math.abs(component - centres.pill)).toBeLessThanOrEqual(0.5);
    }
    await view.locator('.hub-view-composer textarea').fill('Works for me.');
    await view.locator('.hub-view-composer button[aria-label="Send message"]').click();
    await expect(replying).toHaveCount(0);
    await expect(view.locator('.hub-view-bubble.mine').first()).toContainText('Works for me.');
  });

  test('shows reactor profiles until separate reactions need a compact emoji stack', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-source', {hasText: 'WhatsApp'}).click();
    await view.locator('.hub-view-row', {hasText: 'Jules Tan'}).click();

    const profiled = view.locator('[data-message-id="c1"] .hub-view-reactions');
    await expect(profiled).toBeVisible();
    await expect(profiled).not.toHaveClass(/compact/);
    const separate = profiled.locator('.hub-view-reactions-normal .hub-view-reaction');
    await expect(separate).toHaveCount(2);
    await expect(separate.nth(0).locator('.hub-view-reaction-avatar')).toHaveCount(3);
    await expect(separate.nth(0).locator('img.hub-view-reaction-avatar')).toHaveCount(1);
    await expect(separate.nth(1).locator('.hub-view-reaction-avatar')).toHaveCount(0);
    await expect(separate.nth(1).locator('.hub-view-reaction-count')).toHaveText('4');
    await expect(profiled.locator('.hub-view-reactions-compact')).toHaveCount(0);

    await view.locator('.hub-view-source', {hasText: 'All Platforms'}).click();
    await view.locator('.hub-view-row', {hasText: 'Dev Chat'}).click();
    const overflowed = view.locator('[data-message-id="c4"] .hub-view-reactions');
    await expect(overflowed).toHaveClass(/compact/);
    const compact = overflowed.locator('.hub-view-reactions-compact');
    await expect(compact).toBeVisible();
    await expect(compact.locator('.hub-view-reaction-emoji-button')).toHaveCount(3);
    await expect(compact.locator('.hub-view-reaction-avatar')).toHaveCount(0);
    await expect(compact.locator('.hub-view-reaction-count')).toHaveText('99+');
  });

  test('refreshes a late reaction on an already loaded past message', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-source', {hasText: 'WhatsApp'}).click();
    await view.locator('.hub-view-row', {hasText: 'Jules Tan'}).click();

    const message = view.locator('[data-message-id="c1"]');
    await expect(message.getByRole('button', {name: /🔥/})).toHaveCount(0);
    await page.evaluate(() => {
      const demo = window as unknown as {
        polymuxDemoIncomingReaction: (chatId: string, messageId: string, key: string) => void;
      };
      demo.polymuxDemoIncomingReaction('!wa-jules:local', 'c1', '🔥');
    });

    await expect(message.getByRole('button', {name: /🔥, 1 reaction/})).toBeVisible();
  });

  test('flushes pushed chat activity that arrives during another Hub operation', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-row', {hasText: 'File Transfer'}).click();
    await page.evaluate(() => {
      (window as unknown as {polymuxDemoHoldChatPick: () => void})
        .polymuxDemoHoldChatPick();
    });

    await view.locator('.hub-view-composer-add').click();
    await view.getByRole('menuitem', {name: 'Attach files'}).click();
    await page.evaluate(() => {
      const demo = window as unknown as {
        polymuxDemoIncomingChatMessage: (chatId: string, body: string) => void;
        polymuxDemoReleaseChatPick: () => void;
      };
      demo.polymuxDemoIncomingChatMessage(
        '!wx-filehelper:local',
        'Arrived while File Transfer was busy',
      );
      demo.polymuxDemoReleaseChatPick();
    });

    await expect(view.getByText('Arrived while File Transfer was busy', {exact: true}))
      .toBeVisible();
  });

  test('reveals the reaction picker below without a final search-field shift', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-source', {hasText: 'WhatsApp'}).click();
    await view.locator('.hub-view-row', {hasText: 'Jules Tan'}).click();

    const first = view.locator('.hub-view-bubble-row').first();
    await first.evaluate((node) => {
      const hub = node.closest<HTMLElement>('.hub-view');
      if (!hub) throw new Error('Hub surface is missing');
      const rowRect = node.getBoundingClientRect();
      const hubRect = hub.getBoundingClientRect();
      node.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: rowRect.right - 10,
        clientY: hubRect.top + 12,
      }));
    });
    const menu = page.locator('.hub-view-message-menu');
    await expect(menu).toBeVisible();
    const before = await menu.evaluate((node) => {
      const strip = node.querySelector<HTMLElement>('.hub-view-emoji-row');
      if (!strip) throw new Error('Quick reaction strip is missing');
      return {
        menu: node.getBoundingClientRect().toJSON(),
        strip: strip.getBoundingClientRect().toJSON(),
      };
    });

    await menu.getByRole('button', {name: 'React'}).click();
    const picker = menu.locator('.hub-view-emoji-picker');
    await expect(picker).toHaveClass(/below/);
    await expect(picker.getByRole('searchbox', {name: 'Search'})).toBeFocused();
    const frames = await picker.evaluate(async (node) => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const reveal = node.getAnimations({subtree: true}).find((animation) =>
        !(animation.effect as KeyframeEffect).pseudoElement,
      );
      const search = node.querySelector<HTMLElement>('.hub-view-emoji-search');
      const content = node.querySelector<HTMLElement>('.hub-view-emoji-picker-content');
      if (!reveal || !search || !content) throw new Error('Picker reveal is incomplete');
      reveal.pause();
      const duration = reveal.effect?.getTiming().duration;
      const sample = async (time: number) => {
        reveal.currentTime = time;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        return {
          height: node.getBoundingClientRect().height,
          searchTop: search.getBoundingClientRect().top,
          scrollTop: node.scrollTop,
          opacity: getComputedStyle(node).opacity,
          edgeMask: getComputedStyle(node).webkitMaskImage,
        };
      };
      const halfway = await sample(160);
      const settled = await sample(319);
      reveal.finish();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const finished = {
        height: node.getBoundingClientRect().height,
        searchTop: search.getBoundingClientRect().top,
        scrollTop: node.scrollTop,
      };
      return {
        duration,
        rootPaddingTop: getComputedStyle(node).paddingTop,
        contentPaddingTop: getComputedStyle(content).paddingTop,
        halfway,
        settled,
        finished,
      };
    });
    expect(frames.duration).toBe(320);
    expect(frames.rootPaddingTop).toBe('0px');
    expect(frames.contentPaddingTop).toBe('2px');
    expect(frames.halfway.height).toBeGreaterThan(80);
    expect(frames.halfway.height).toBeLessThan(90);
    expect(frames.halfway.edgeMask).not.toBe('none');
    expect(frames.settled.height).toBeGreaterThan(167);
    expect(frames.settled.searchTop).toBe(frames.halfway.searchTop);
    expect(frames.finished.searchTop).toBe(frames.halfway.searchTop);
    expect(frames.halfway.scrollTop).toBe(0);
    expect(frames.settled.scrollTop).toBe(0);
    expect(frames.finished.scrollTop).toBe(0);

    const after = await menu.evaluate((node) => ({
      menu: node.getBoundingClientRect().toJSON(),
      strip: node.querySelector<HTMLElement>('.hub-view-emoji-row')!.getBoundingClientRect().toJSON(),
    }));
    expect(after.menu.top).toBe(before.menu.top);
    expect(after.menu.height).toBe(before.menu.height + 168);
    expect(after.strip).toEqual(before.strip);
  });

  test('filters the conversation list from the box above it', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-source', {hasText: 'WhatsApp'}).click();
    const rows = view.locator('.hub-view-rows .hub-view-row');
    const all = await rows.count();
    const listHead = view.locator('.hub-view-list-head');
    const search = listHead.locator('input[type="search"]');
    await search.fill('Jules');
    await expect(rows).toHaveCount(1);
    expect(await search.evaluate((input) =>
      getComputedStyle(input, '::-webkit-search-cancel-button').webkitAppearance,
    )).toBe('none');
    const clear = listHead.getByRole('button', {name: 'Clear search'});
    await expect(clear).toBeVisible();
    await expect(clear.locator('svg[data-icon="close"]')).toBeVisible();
    await clear.click();
    await expect(rows).toHaveCount(all);
    await expect(search).toBeFocused();
  });

  test('filters mailbox rows while search text is being typed', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await openMailbox(view);
    const rows = view.locator('.hub-view-rows .hub-view-row');
    const all = await rows.count();
    const search = view.locator('.hub-view-list-head input[type="search"]');

    await search.fill('billing');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Invoice ready');

    await search.fill('quarterly');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Q3 numbers');

    await view.locator('.hub-view-list-head').getByRole('button', {name: 'Clear search'}).click();
    await expect(rows).toHaveCount(all);
  });

  test('searches one chat across messages, media, files, and links', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-row', {hasText: 'File Transfer'}).click();

    await expect(view.getByRole('button', {name: 'Search this chat'})).toHaveCount(0);
    const more = view.locator('.hub-view-chat-more');
    await expect(more).toHaveAttribute('aria-label', 'More actions');
    expect(await more.evaluate((button) => {
      const header = button.closest('.hub-view-chat-head')!.getBoundingClientRect();
      return Math.round(header.right - button.getBoundingClientRect().right);
    })).toBe(18);
    await more.click();
    const menu = view.locator('.hub-view-chat-actions-menu');
    await expect(menu.getByRole('menuitem')).toHaveText([
      'View profile',
      'Search this chat',
      'Pin to top',
      'Mute',
    ]);
    await menu.getByRole('menuitem', {name: 'Search this chat'}).click();
    const search = view.getByRole('searchbox', {name: 'Search File Transfer'});
    await expect(search).toBeFocused();
    const results = view.locator('.hub-view-chat-search-result');
    await expect(results).toHaveCount(5);

    await view.getByRole('button', {name: 'Media', exact: true}).click();
    await expect(results).toHaveCount(2);
    await expect(results).toContainText([/\.mp4/, 'Voice message']);

    await view.getByRole('button', {name: 'Files', exact: true}).click();
    await expect(results).toHaveCount(1);
    await expect(results).toContainText('Project notes.pdf');

    await view.getByRole('button', {name: 'Links', exact: true}).click();
    await expect(results).toHaveCount(1);
    await expect(results).toContainText('Useful article');

    await view.getByRole('button', {name: 'Messages', exact: true}).click();
    await search.fill('answer');
    await expect(results).toHaveCount(1);
    await results.click();

    await expect(view.getByRole('searchbox', {name: 'Search File Transfer'})).toHaveCount(0);
    await expect(view.locator('[data-message-id="wx4"]')).toBeVisible();

    await more.click();
    await menu.getByRole('menuitem', {name: 'View profile'}).click();
    await expect(view.locator('.hub-view-profile-name')).toContainText('File Transfer');
  });

  test('aligns the chat list and conversation header rules', async ({page}) => {
    await openView(page);
    await page.getByRole('button', {name: 'Expand Workspace'}).click();
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-source', {hasText: 'WhatsApp'}).click();
    await view.locator('.hub-view-row', {hasText: 'Jules Tan'}).click();

    const geometry = await view.evaluate((hub) => {
      const list = hub.querySelector<HTMLElement>('.hub-view-list-head');
      const conversation = hub.querySelector<HTMLElement>('.hub-view-chat-head');
      if (!list || !conversation) throw new Error('Hub chat headers are missing');
      const listBox = list.getBoundingClientRect();
      const conversationBox = conversation.getBoundingClientRect();
      return {
        listHeight: listBox.height,
        conversationHeight: conversationBox.height,
        listBottom: listBox.bottom,
        conversationBottom: conversationBox.bottom,
      };
    });

    expect(geometry.conversationHeight).toBe(geometry.listHeight);
    expect(geometry.conversationBottom).toBe(geometry.listBottom);
  });

  test('hands Hub panes over continuously while the workspace expands and minimises', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-source', {hasText: 'WhatsApp'}).click();
    await view.locator('.hub-view-row', {hasText: 'Jules Tan'}).click();

    const sampleMotion = (label: 'Expand Workspace' | 'Minimise Workspace') =>
      page.evaluate(async (buttonLabel) => {
        const drawer = document.querySelector<HTMLElement>('.workspace-drawer');
        const list = document.querySelector<HTMLElement>('.hub-view-list');
        const reader = document.querySelector<HTMLElement>('.hub-view-reader');
        const button = [...document.querySelectorAll<HTMLButtonElement>('button')]
          .find((candidate) => candidate.getAttribute('aria-label') === buttonLabel);
        if (!drawer || !list || !reader || !button) throw new Error('Hub motion surface is incomplete');

        const frames: Array<{
          drawerWidth: number;
          listWidth: number;
          readerWidth: number;
          listDisplay: string;
          readerDisplay: string;
        }> = [];
        button.click();
        const started = performance.now();
        await new Promise<void>((resolve) => {
          const sample = (now: number) => {
            if (drawer.classList.contains('motion')) {
              frames.push({
                drawerWidth: drawer.getBoundingClientRect().width,
                listWidth: list.getBoundingClientRect().width,
                readerWidth: reader.getBoundingClientRect().width,
                listDisplay: getComputedStyle(list).display,
                readerDisplay: getComputedStyle(reader).display,
              });
            }
            if (now - started < 520) requestAnimationFrame(sample);
            else resolve();
          };
          requestAnimationFrame(sample);
        });
        return frames;
      }, label);

    const expanding = await sampleMotion('Expand Workspace');
    const minimising = await sampleMotion('Minimise Workspace');
    expect(expanding.length).toBeGreaterThan(10);
    expect(minimising.length).toBeGreaterThan(10);

    for (const frames of [expanding, minimising]) {
      expect(frames.every((frame) => frame.listDisplay === 'flex' && frame.readerDisplay === 'flex')).toBe(true);
      // One 60 Hz frame can move the whole drawer by roughly 60px at the
      // easing's midpoint. A larger internal jump means a pane swapped at a
      // breakpoint rather than travelling with that drawer frame.
      for (let index = 1; index < frames.length; index++) {
        expect(Math.abs(frames[index].listWidth - frames[index - 1].listWidth)).toBeLessThan(80);
        expect(Math.abs(frames[index].readerWidth - frames[index - 1].readerWidth)).toBeLessThan(80);
      }
    }
    for (let index = 1; index < expanding.length; index++) {
      expect(expanding[index].drawerWidth).toBeGreaterThanOrEqual(expanding[index - 1].drawerWidth);
      expect(expanding[index].listWidth).toBeGreaterThanOrEqual(expanding[index - 1].listWidth);
      expect(expanding[index].readerWidth).toBeGreaterThanOrEqual(expanding[index - 1].readerWidth);
    }
    for (let index = 1; index < minimising.length; index++) {
      expect(minimising[index].drawerWidth).toBeLessThanOrEqual(minimising[index - 1].drawerWidth);
      expect(minimising[index].listWidth).toBeLessThanOrEqual(minimising[index - 1].listWidth);
      expect(minimising[index].readerWidth).toBeLessThanOrEqual(minimising[index - 1].readerWidth);
    }
  });

  test('keeps the main conversation smooth when the workspace icon toggles a populated Hub', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-source', {hasText: 'WhatsApp'}).click();
    await view.locator('.hub-view-row', {hasText: 'Jules Tan'}).click();
    await expect(page.locator('.tab')).toHaveCount(1);
    await expect(page.locator('.tab')).toContainText('Hub');

    const sampleMotion = () => page.evaluate(async () => {
      const drawer = document.querySelector<HTMLElement>('.workspace-drawer');
      const hub = document.querySelector<HTMLElement>('.hub-view');
      const conversation = document.querySelector<HTMLElement>('.conversation-column');
      const toggle = [...document.querySelectorAll<HTMLButtonElement>('button')]
        .find((candidate) => candidate.getAttribute('aria-label') === 'Toggle Workspace');
      if (!drawer || !hub || !conversation || !toggle)
        throw new Error('Workspace toggle motion surface is incomplete');

      const frames: Array<{
        drawerLeft: number;
        drawerWidth: number;
        conversationWidth: number;
        conversationRight: number;
        hubRightColumn: string;
        hubComposerColumn: string;
      }> = [];
      toggle.click();
      const started = performance.now();
      await new Promise<void>((resolve) => {
        const sample = (now: number) => {
          const drawerBox = drawer.getBoundingClientRect();
          const conversationBox = conversation.getBoundingClientRect();
          const hubStyle = getComputedStyle(hub);
          frames.push({
            drawerLeft: drawerBox.left,
            drawerWidth: drawerBox.width,
            conversationWidth: conversationBox.width,
            conversationRight: conversationBox.right,
            hubRightColumn: hubStyle.getPropertyValue('--content-right-column').trim(),
            hubComposerColumn: hubStyle.getPropertyValue('--content-composer-column').trim(),
          });
          if (now - started < 520) requestAnimationFrame(sample);
          else resolve();
        };
        requestAnimationFrame(sample);
      });
      return frames;
    });

    const closing = await sampleMotion();
    const opening = await sampleMotion();
    expect(closing.length).toBeGreaterThan(10);
    expect(opening.length).toBeGreaterThan(10);

    for (const frames of [closing, opening]) {
      const drawerWidths = frames.map((frame) => frame.drawerWidth);
      expect(Math.max(...drawerWidths) - Math.min(...drawerWidths)).toBeLessThan(1);
      expect(frames.every((frame) => frame.hubRightColumn === '0px')).toBe(true);
      expect(frames.every((frame) => frame.hubComposerColumn === '0px')).toBe(true);
      for (let index = 1; index < frames.length; index++) {
        expect(Math.abs(frames[index].drawerLeft - frames[index - 1].drawerLeft)).toBeLessThan(80);
        expect(Math.abs(frames[index].conversationWidth - frames[index - 1].conversationWidth)).toBeLessThan(80);
        expect(Math.abs(frames[index].conversationRight - frames[index - 1].conversationRight)).toBeLessThan(80);
      }
    }

    expect(closing[0].drawerLeft).toBeLessThan(closing.at(-1)!.drawerLeft);
    expect(closing[0].conversationRight).toBeLessThan(closing.at(-1)!.conversationRight);
    expect(opening[0].drawerLeft).toBeGreaterThan(opening.at(-1)!.drawerLeft);
    expect(opening[0].conversationRight).toBeGreaterThan(opening.at(-1)!.conversationRight);
  });

  test('a sticker is drawn at a sticker\'s size, not the width of the thread', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-source', {hasText: 'WhatsApp'}).click();
    await view.locator('.hub-view-row', {hasText: 'Jules Tan'}).click();

    const sticker = view.locator('.hub-view-bubble-image.sticker');
    await expect(sticker).toBeVisible();
    // Blown up to the bubble's width a sticker reads as a photo of one, which
    // is not how any messenger shows them.
    const box = await sticker.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(140);
  });

  test('composes a new mail, with copies and attachments', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await openMailbox(view);
    await view.getByRole('button', {name: 'New'}).click();
    await expect(view.getByRole('heading', {name: 'New message'})).toBeVisible();
    await expect(view.getByRole('button', {name: 'Send'})).toBeDisabled();
    await view.locator('.hub-view-compose-form input').first().fill('someone@example.com');
    await expect(view.getByRole('button', {name: 'Send'})).toBeEnabled();
    await expect(view.getByRole('button', {name: 'Save draft'})).toBeVisible();

    // Cc and Bcc stay folded away until they are asked for.
    await expect(view.getByText('Cc', {exact: true})).toBeHidden();
    await view.getByRole('button', {name: 'Cc/Bcc'}).click();
    await expect(view.getByText('Cc', {exact: true})).toBeVisible();
    await expect(view.getByText('Bcc', {exact: true})).toBeVisible();

    await view.getByRole('button', {name: 'Attach'}).click();
    await expect(view.locator('.hub-view-compose-attachment')).toContainText('demo-attachment.pdf');
  });

  test('sends a file from the body position where it was attached', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await openMailbox(view);
    await view.getByRole('button', {name: 'New'}).click();
    const composer = view.locator('.hub-view-compose-form');
    await composer.locator('input').first().fill('someone@example.com');
    const body = composer.locator('.hub-view-compose-body textarea').first();
    await body.fill('Before\nAfter');
    await body.evaluate((field: HTMLTextAreaElement) => {
      field.focus();
      field.setSelectionRange(7, 7);
      field.dispatchEvent(new Event('select', {bubbles: true}));
    });
    await composer.getByRole('button', {name: 'Attach'}).click();

    const pieces = composer.locator('.hub-view-compose-body textarea');
    await expect(pieces).toHaveCount(2);
    await expect(pieces.nth(0)).toHaveValue('Before\n');
    await expect(composer.locator('.hub-view-compose-attachment')).toContainText('demo-attachment.pdf');
    await expect(pieces.nth(1)).toHaveValue('After');
    // Editing the segment before the card moves its MIME offset with the text;
    // the file remains between these two authored regions.
    await pieces.nth(0).fill('Updated before\n');

    await composer.getByRole('button', {name: 'Send', exact: true}).click();
    const sent = await page.evaluate(() => {
      const requests = (window as unknown as {
        polymuxDemoMailSends: () => Array<Record<string, unknown>>;
      }).polymuxDemoMailSends();
      return requests.findLast((request) => request.draft === false);
    });
    expect(sent?.attachments).toEqual(['/tmp/demo-attachment.pdf']);
    expect(sent?.inlineAttachments).toEqual([{
      path: '/tmp/demo-attachment.pdf',
      contentId: expect.stringMatching(/^mail-.+@polymux\.local$/),
    }]);
    expect(sent?.html).toMatch(/Updated before<br><div><a href="cid:mail-.+@polymux\.local">demo-attachment\.pdf<\/a><\/div>After/);
  });

  test('a message shows its images, and never a broken one', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await openMailbox(view);
    await view.locator('.hub-view-row', {hasText: 'Invoice ready'}).click();

    const body = view.locator('.hub-view-html');
    await expect(body).toBeVisible();
    await expect(body).toHaveCSS('padding-left', '0px');
    await expect(body).toHaveCSS('padding-right', '0px');
    await expect(body.locator(':scope > br')).toHaveCount(0);
    await expect(body.locator(':scope > div')).toHaveCount(1);
    await expect(body.locator(':scope > .hub-view-mail-first-content')).toHaveCSS('margin-top', '0px');
    const topGap = await body.evaluate((node) => {
      const first = node.firstElementChild;
      return first ? Math.round(first.getBoundingClientRect().top - node.getBoundingClientRect().top) : null;
    });
    expect(topGap).toBe(0);
    // Nothing stands between the reader and the sender's images: they load,
    // and there is no bar asking for permission to be a mail.
    await expect(view.getByRole('button', {name: /remote images/i})).toHaveCount(0);
    const images = body.locator('img');
    await expect(images).toHaveCount(1);
    // A `cid:` image addresses a part of the message itself, which nothing in
    // a browser can fetch — it goes, rather than sitting there broken.
    await expect(body.locator('img[src^="cid:"]')).toHaveCount(0);
    await expect(images.first()).toHaveAttribute('src', 'https://example.com/seal.png');
    // The sender learns the mail was opened; they need not learn where from.
    await expect(images.first()).toHaveAttribute('referrerpolicy', 'no-referrer');
  });

  test('replies to the sender with the message quoted', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await openMailbox(view);
    const messageRow = view.locator('.hub-view-row', {hasText: 'Q3 numbers'});
    await expect(messageRow.getByRole('img', {name: 'Important'})).toBeVisible();
    await expect(messageRow.getByRole('img', {name: 'Flagged'})).toBeVisible();
    await expect(messageRow.getByRole('img', {name: 'Attachment'})).toBeVisible();
    await messageRow.click();
    await (await mailActions(view)).getByRole('button', {name: 'Reply', exact: true}).click();

    await expect(view.getByRole('heading', {name: 'Reply'})).toBeVisible();
    const fields = view.locator('.hub-view-compose-form input');
    await expect(fields.first()).toHaveValue('priya@example.com');
    await expect(fields.last()).toHaveValue('Re: Q3 numbers');
    // The answer carries what it answers, the way every mail client does.
    await expect(view.locator('.hub-view-compose-form textarea')).toHaveValue(
      /> The quarterly numbers are attached\./,
    );
  });

  test('acts on several messages at once', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await openMailbox(view);
    const rows = view.locator('.hub-view-row');
    await rows.nth(0).click({modifiers: ['Meta']});
    await rows.nth(1).click({modifiers: ['Meta']});

    await expect(view.locator('.hub-view-selection')).toContainText('2 selected');
    // Marking them read is a flag change, so they stay in the folder.
    await view.locator('.hub-view-selection').getByRole('button', {name: 'Read', exact: true}).click();
    await expect(view.locator('.hub-view-row.unread')).toHaveCount(0);

    await rows.nth(0).click({modifiers: ['Meta']});
    await view.locator('.hub-view-selection').getByRole('button', {name: 'Archive'}).click();
    await expect(rows).toHaveCount(2);
  });

  test('shows the attachments and recipients of a message', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await openMailbox(view);
    await view.locator('.hub-view-row').first().click();

    const header = view.locator('.hub-view-mail-head');
    await expect(header.locator('.hub-view-mail-avatar')).toHaveCount(0);
    await expect(header.locator('.hub-view-mail-sender')).toHaveText('Priya Raman');
    const senderGap = await header.evaluate((node) => {
      const back = node.querySelector('.hub-view-back');
      const sender = node.querySelector('.hub-view-mail-sender');
      if (!back || !sender) return null;
      return Math.round(sender.getBoundingClientRect().left - back.getBoundingClientRect().right);
    });
    expect(senderGap).toBeLessThanOrEqual(10);
    await expect(header.getByRole('heading', {name: 'Q3 numbers'})).toBeVisible();
    await expect(workspaceDrawer(page)).toHaveCSS('width', '480px');
    await expect(header.locator('.hub-view-mail-location')).toBeHidden();
    await expect(header.locator('time')).toBeHidden();
    await expect(header.locator('time')).toHaveAttribute('datetime', /.+/);
    await expect(view.locator('.hub-view-recipients')).toContainText('demo@example.com');
    const actions = header.locator('.hub-view-reader-actions');
    await expect(actions.getByRole('button')).toHaveCount(9);
    await expect(actions.getByRole('button', {name: 'More actions'})).toHaveCount(0);
    const compactCapacity = await actions.evaluate((node) => {
      const button = node.querySelector<HTMLElement>(':scope > button');
      const style = getComputedStyle(node);
      return {
        available: node.getBoundingClientRect().width,
        neededForNine: (button?.getBoundingClientRect().width ?? 0) * 9 + Number.parseFloat(style.columnGap) * 8,
      };
    });
    expect(compactCapacity.available).toBeGreaterThanOrEqual(compactCapacity.neededForNine);
    const actionOffset = () => header.evaluate((node) => {
      const sender = node.querySelector('.hub-view-mail-sender');
      const firstAction = node.querySelector('.hub-view-reader-actions > button');
      if (!sender || !firstAction) return Number.POSITIVE_INFINITY;
      return Math.abs(sender.getBoundingClientRect().left - firstAction.getBoundingClientRect().left);
    });
    await expect.poll(actionOffset).toBeLessThanOrEqual(1);

    await page.getByRole('button', {name: 'Expand Workspace'}).click();
    await expect(header.locator('.hub-view-mail-location')).toBeVisible();
    await expect(header.locator('time')).toBeVisible();
    const headerMarks = header.locator('.hub-view-mail-marks');
    await expect(headerMarks.getByRole('img', {name: 'Important'})).toBeVisible();
    await expect(headerMarks.getByRole('img', {name: 'Flagged'})).toBeVisible();
    await expect(headerMarks.getByRole('img', {name: 'Attachment'})).toBeVisible();
    await expect.poll(actionOffset).toBeLessThanOrEqual(1);

    // Secondary metadata returns progressively. A medium reader keeps the
    // timestamp and attachment marker, then waits for more room before adding
    // the longer folder/account label.
    await page.setViewportSize({width: 600, height: 720});
    await expect(header.locator('.hub-view-mail-location')).toBeHidden();
    await expect(header.locator('time')).toBeVisible();
    await expect(headerMarks.getByRole('img', {name: 'Important'})).toBeVisible();
    await expect(headerMarks.getByRole('img', {name: 'Flagged'})).toBeVisible();
    await expect(headerMarks.getByRole('img', {name: 'Attachment'})).toBeVisible();
    await expect.poll(actionOffset).toBeLessThanOrEqual(1);

    // At the exact three-column threshold the list may rejoin the reader, but
    // the reader still reserves the complete toolbar and drops secondary
    // mailbox metadata before squeezing the subject.
    await page.setViewportSize({width: 740, height: 720});
    await expect(header.locator('.hub-view-mail-location')).toBeHidden();
    await expect(header.locator('time')).toBeHidden();
    await expect(actions.getByRole('button')).toHaveCount(9);
    await expect.poll(actionOffset).toBeLessThanOrEqual(1);
    expect(await actions.evaluate((node) => {
      const buttons = [...node.querySelectorAll<HTMLElement>(':scope > button, :scope > .hub-view-action-group > button')];
      const strip = node.getBoundingClientRect();
      return buttons.length === 9 && buttons.every((button) => {
        const box = button.getBoundingClientRect();
        return box.width > 0 && box.left >= strip.left - 1 && box.right <= strip.right + 1;
      });
    })).toBe(true);
    const attachment = view.locator('.hub-view-mail-inline-attachment', {hasText: 'q3-report.pdf'});
    const fallback = view.locator('.hub-view-mail-inline-attachment', {hasText: 'regional-breakdown.csv'});
    await expect(attachment).toContainText('q3-report.pdf');
    await expect(attachment.locator('.hub-view-mail-pdf')).toBeVisible();
    await expect(attachment.getByRole('button')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const attachmentLayout = await attachment.evaluate(node => {
      const head = node.querySelector('button')!.getBoundingClientRect();
      const preview = node.querySelector('iframe')!.getBoundingClientRect();
      return {belowLabel: preview.top >= head.bottom, fillsWidth: Math.abs(preview.width - node.clientWidth) <= 1};
    });
    expect(attachmentLayout).toEqual({belowLabel: true, fillsWidth: true});
    await expect(fallback).toBeVisible();
    const placement = await view.locator('.hub-view-html').evaluate((body) => {
      const paragraphs = body.querySelectorAll('p');
      const files = body.querySelectorAll('.hub-view-mail-inline-attachment');
      const file = files[0];
      const fallback = files[1];
      return {
        afterFirstParagraph: Boolean(paragraphs[0] && file && (paragraphs[0].compareDocumentPosition(file) & Node.DOCUMENT_POSITION_FOLLOWING)),
        beforeSecondParagraph: Boolean(paragraphs[1] && file && (file.compareDocumentPosition(paragraphs[1]) & Node.DOCUMENT_POSITION_FOLLOWING)),
        fallbackAfterBody: Boolean(paragraphs[1] && fallback && (paragraphs[1].compareDocumentPosition(fallback) & Node.DOCUMENT_POSITION_FOLLOWING)),
      };
    });
    expect(placement).toEqual({afterFirstParagraph: true, beforeSecondParagraph: true, fallbackAfterBody: true});
    await attachment.getByRole('button').click();
  });

  test('previews a photo with trapped focus and safely handles a late failed load on close', async ({page}) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', error => pageErrors.push(error));
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-source', {hasText: 'WhatsApp'}).click();
    await view.locator('.hub-view-row', {hasText: 'Jules Tan'}).click();
    const opener = view.getByRole('button', {name: 'Preview photo: Sticker'});
    await opener.click();
    const preview = view.getByRole('dialog', {name: 'Sticker'});
    await expect(preview).toBeVisible();
    await expect(preview.getByRole('button', {name: 'Open in Media'})).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(preview.getByRole('button', {name: 'Close media preview'}).last()).toBeFocused();
    const image = preview.getByRole('img', {name: 'Sticker'});
    await page.keyboard.press('Escape');
    await image.evaluate(node => node.dispatchEvent(new Event('error')));
    await expect(preview).toHaveCount(0);
    await expect(opener).toBeFocused();
    expect(pageErrors).toEqual([]);
  });

  test('opens preview media in the Media workspace and downloads it from the context menu', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-source', {hasText: 'WhatsApp'}).click();
    await view.locator('.hub-view-row', {hasText: 'Jules Tan'}).click();
    const opener = view.getByRole('button', {name: 'Preview photo: Sticker'});
    const menu = page.locator('.hub-view-message-menu');
    await opener.click({button: 'right'});
    await page.evaluate(() => {
      const fetchRequest = window.fetch;
      window.fetch = function (input, init) {
        (window as unknown as {__polymuxDownloadUrl?: string}).__polymuxDownloadUrl = String(input);
        return fetchRequest.call(window, input, init);
      };
    });
    await menu.getByRole('menuitem', {name: 'Download'}).click();
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as {__polymuxDownloadUrl?: string}).__polymuxDownloadUrl,
    )).toMatch(/^data:image\/gif;base64,/);
    await expect(menu).toHaveCount(0);
    await opener.click();
    await view.getByRole('dialog', {name: 'Sticker'}).getByRole('img', {name: 'Sticker'}).click({button: 'right'});
    await menu.getByRole('menuitem', {name: 'Open in Media'}).click();
    await expect(page.locator('.hub-view')).toHaveCount(0);
    await expect(page.getByText('Sticker', {exact: true})).toBeVisible();
  });

  test('plays, seeks, and expands a WeChat video without losing its position', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-source', {hasText: 'WeChat'}).click();
    await view.locator('.hub-view-row', {hasText: 'File Transfer'}).click();
    const name = 'AQO35LDKTG5E80mb8IC1UxBCatqRtz5e1UfSQbW_6TuswMo_IDXhnFdRLTK0IsjSS6YM4A.mp4';
    const inline = view.getByRole('group', {name});
    await expect.poll(() => inline.locator('video').evaluate(video => (video as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(1);
    await inline.getByRole('button', {name: 'Play video'}).click();
    await expect(inline.getByRole('button', {name: 'Pause video'})).toBeVisible();
    const seek = inline.getByRole('slider', {name: 'Video position'});
    await seek.evaluate((node) => {
      const input = node as HTMLInputElement;
      input.value = '0.08';
      input.dispatchEvent(new Event('input', {bubbles: true}));
    });
    await expect.poll(() => inline.locator('video').evaluate(video => (video as HTMLVideoElement).currentTime)).toBeGreaterThan(0.05);
    const before = await inline.locator('video').evaluate(video => (video as HTMLVideoElement).currentTime);
    const expand = inline.getByRole('button', {name: 'Preview video'});
    await expand.focus();
    await page.keyboard.press('Enter');
    const preview = view.getByRole('dialog', {name});
    await expect(preview).toBeVisible();
    await expect.poll(() => preview.locator('video').evaluate(video => (video as HTMLVideoElement).currentTime)).toBeGreaterThanOrEqual(before - 0.03);
    await page.keyboard.press('Escape');
    await expect(inline.getByRole('button', {name: 'Preview video'})).toBeFocused();
  });
});

test.describe('hub platform setup', () => {
  test('offers the official download when the WeChat desktop app is missing', async ({page}) => {
    await page.goto('/?wechat=missing');
    const modal = await openAppConnection(page, 'Hub');
    await modal.getByRole('tab', {name: 'WeChat', exact: true}).click();

    const download = modal.getByRole('button', {name: 'Download WeChat'});
    await expect(download).toBeVisible();
    await page.evaluate(() => {
      window.open = ((url?: string | URL) => {
        (window as unknown as {polymuxOpenedUrl?: string}).polymuxOpenedUrl = String(url ?? '');
        return null;
      }) as typeof window.open;
    });
    await download.click();
    await expect.poll(() => page.evaluate(
      () => (window as unknown as {polymuxOpenedUrl?: string}).polymuxOpenedUrl,
    )).toBe('https://mac.weixin.qq.com/en');
  });
});

test.describe('hub multi-account', () => {
  test('a platform lists every linked account and still offers to add more', async ({page}) => {
    await page.goto('/');
    const modal = await openAppConnection(page, 'Hub');

    // The platform picker switches the pane rather than naming only the first
    // account, and every linked account is listed in it.
    await modal.getByRole('tab', {name: 'Instagram', exact: true}).click();

    await expect(modal.getByRole('heading', {name: 'Linked accounts'})).toBeVisible();
    await expect(modal.getByRole('code').filter({hasText: '@carl.builds'})).toBeVisible();
    await expect(modal.getByRole('code').filter({hasText: '@polymux'})).toBeVisible();
    // Each account carries its own unlink, and more can be added alongside.
    await expect(modal.getByRole('button', {name: 'Unlink'})).toHaveCount(2);
    await expect(modal.getByRole('heading', {name: 'Add another account'})).toBeVisible();

    // Unlinking one leaves the other untouched. Scoped to the account row's
    // code element: the surviving name also appears in the rail and header.
    await modal.getByRole('button', {name: 'Unlink'}).first().click();
    await expect(modal.getByRole('button', {name: 'Unlink'})).toHaveCount(1);
    await expect(modal.getByRole('code').filter({hasText: '@polymux'})).toBeVisible();
    await expect(modal.getByRole('heading', {name: 'Linked account', exact: true})).toBeVisible();
  });
});

test.describe('drive provider summaries', () => {
  test('does not present local folders as connected accounts', async ({page}) => {
    await page.goto('/');
    const modal = await openAppConnection(page, 'Drive');

    const local = modal.getByRole('button', {name: /Local/});
    await expect(local).toContainText('Connected');
    await expect(local).not.toContainText(/accounts?/);
  });
});

test.describe('workspace persistence', () => {
  // The history toggle's label is being reworked in a parallel branch; match
  // any of its recent names rather than chasing the churn. The drawer's
  // open/closed state after picking a chat is also in flux, so the helper
  // toggles only when the wanted row is not already clickable.
  const openFromHistory = async (page: import('@playwright/test').Page, title: string) => {
    const row = page.getByRole('button', {name: `Open chat: ${title}`});
    if (!(await row.isVisible()))
      await page.getByRole('button', {name: /Toggle (past chats|chat history|archive|Chats)/}).click();
    await row.click();
  };

  test('each chat keeps its own workspace and restores it on return', async ({page}) => {
    await page.goto('/?coldStart=0');
    await expect(chatDrawer(page)).toBeVisible();
    await openFromHistory(page, 'Planning a product launch');

    // Open the Hub view in this chat's workspace.
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    await page.locator('.workspace-launcher-row', {hasText: 'Hub'}).click();
    await expect(page.locator('.hub-view')).toBeVisible();

    // A different chat starts from its own (empty) workspace, not this one's.
    // New Chat rather than a second chat row: which older groups the
    // drawer surfaces by default is being reworked in a parallel branch.
    await page.getByLabel('Chat controls', {exact: true}).getByRole('button', {name: 'New Chat', exact: true}).click();
    await expect(page.locator('.hub-view')).toHaveCount(0);

    // Returning restores the first chat's layout: tab back, drawer open.
    await openFromHistory(page, 'Planning a product launch');
    await expect(page.locator('.hub-view')).toBeVisible();
    await expect(page.locator('.tab-main', {hasText: 'Hub'})).toBeVisible();
  });
});

test.describe('interface language', () => {
  test('retranslates the whole app, and turns it around for Arabic', async ({page}) => {
    await page.goto('/');
    await expect(page.getByRole('heading', {name: 'What can I help with?'})).toBeVisible();

    await page.getByRole('button', {name: 'Settings'}).click();
    await page.getByRole('region', {name: 'Settings'}).getByRole('button', {name: 'Language'}).click();
    await page.getByRole('menuitemradio', {name: 'Español'}).click();

    // The page retranslates in place — including its own accessible name, so
    // the region has to be found again under the Spanish one.
    await expect(page.getByRole('region', {name: 'Ajustes'})).toBeVisible();
    await expect(page.getByText('El idioma de la interfaz de Polymux')).toBeVisible();
    await page.getByRole('button', {name: 'Cerrar Ajustes'}).click();

    // …and so does the app behind it, down to the composer's placeholder.
    await expect(page.getByRole('heading', {name: '¿En qué puedo ayudarle?'})).toBeVisible();
    await expect(page.getByText('ADJUNTAR')).toBeVisible();
    await expect(page.locator('[data-placeholder]').first())
      .toHaveAttribute('data-placeholder', 'Pregunte lo que quiera');
    // The document says what it is written in, so the browser hyphenates and
    // quotes accordingly.
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');

    // Arabic is the one right-to-left language, and it flips the whole layout.
    await page.getByRole('button', {name: 'Ajustes', exact: true}).first().click();
    await page.locator('.options-page').getByRole('button', {name: 'Idioma'}).click();
    await page.getByRole('menuitemradio', {name: 'العربية'}).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });
});

test.describe('browser extension prompt', () => {
  test('gives a ready update priority over the extension prompt', async ({page}) => {
    await page.goto('/?extension=missing&update=ready');
    await page.getByRole('button', {name: 'Settings'}).click();
    await page
      .getByRole('region', {name: 'Settings'})
      .getByRole('button', {name: 'Language'})
      .click();
    await page.getByRole('menuitemradio', {name: 'Español'}).click();
    await page.getByRole('button', {name: 'Cerrar Ajustes'}).click();

    await page.getByRole('button', {name: 'Mostrar u ocultar el espacio de trabajo'}).click();
    const chip = page.locator('.extension-chip');
    await expect(chip).toHaveCount(1);
    await expect(chip.getByRole('button', {name: 'Reiniciar para actualizar'})).toBeVisible();
    await expect(chip.locator('[data-icon="download"]')).toBeVisible();
    await expect(page.getByRole('button', {name: 'Instalar extensión'})).toBeHidden();
  });

  test('offers the extension in the title bar until it is dismissed', async ({page}) => {
    await page.goto('/?extension=missing');

    // It sits ahead of the panel icons rather than among them, with a compact
    // install glyph leading the label.
    const chip = page.locator('.extension-chip');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('Install extension');
    await expect(chip.locator('[data-icon="download"]')).toBeVisible();
    // The dismiss is divided off by a rule drawn at the border's own weight,
    // sitting the same distance from the words as from the ×.
    const rule = await chip.locator('.extension-chip-dismiss').evaluate((node) => {
      const style = getComputedStyle(node);
      const chipStyle = getComputedStyle(node.parentElement!);
      return {
        width: style.borderLeftWidth,
        colour: style.borderLeftColor,
        chipWidth: chipStyle.borderTopWidth,
        chipColour: chipStyle.borderTopColor,
      };
    });
    expect(rule.width).toBe(rule.chipWidth);
    expect(rule.colour).toBe(rule.chipColour);
    // The chip carries the only tooltip. Opting out by name rather than just
    // dropping the label: an icon-only button otherwise falls back to its
    // aria-label, which would put a second label on one control.
    await expect(chip.locator('.extension-chip-dismiss')).toHaveAttribute('data-tooltip', 'none');
    // Slimmer than the icon buttons beside it, and every horizontal gap reads
    // as one measure: edge-to-label, label-to-rule, rule-to-×, ×-to-edge. The
    // × is measured at its glyph, not its box — the close path draws 7..17 of a
    // 24 viewBox, so 7/24 of the svg each side is blank and equal padding would
    // push it visibly further from the rule than the label sits.
    const metrics = await chip.evaluate((node) => {
      const install = node.querySelector('.extension-chip-install')!;
      const dismiss = node.querySelector('.extension-chip-dismiss')!;
      const svg = node.querySelector('.extension-chip-dismiss svg')!;
      const range = document.createRange();
      range.selectNodeContents(install);
      const text = range.getBoundingClientRect();
      const box = node.getBoundingClientRect();
      const rule = dismiss.getBoundingClientRect();
      const glyph = svg.getBoundingClientRect();
      const inset = glyph.width * 7 / 24;
      const border = parseFloat(getComputedStyle(node).borderTopWidth);
      const ruleWidth = parseFloat(getComputedStyle(dismiss).borderLeftWidth);
      return {
        height: box.height,
        gaps: [
          text.left - (box.left + border),
          rule.left - text.right,
          (glyph.left + inset) - (rule.left + ruleWidth),
          (box.right - border) - (glyph.right - inset),
        ],
        glyphCentreY: (glyph.top + glyph.bottom) / 2,
        textCentreY: (text.top + text.bottom) / 2,
      };
    });
    expect(metrics.height).toBe(24);
    for (const gap of metrics.gaps) expect(Math.abs(gap - metrics.gaps[0])).toBeLessThan(0.5);
    // The × rides the label's centre line rather than the chip's box.
    expect(Math.abs(metrics.glyphCentreY - metrics.textCentreY)).toBeLessThan(0.5);

    // The chip is its own label, so it carries no tooltip either.
    await expect(chip.locator('.extension-chip-install')).not.toHaveAttribute('data-tooltip-label');

    const chipBox = (await chip.boundingBox())!;
    const workspaceBox = (await page.getByRole('button', {name: 'Toggle Workspace'}).boundingBox())!;
    expect(chipBox.x).toBeLessThan(workspaceBox.x);

    await page.getByRole('button', {name: 'Dismiss'}).click();
    await expect(chip).toBeHidden();
  });

  test('warms rather than jumps when the pointer lands on it', async ({page}) => {
    await page.goto('/?extension=missing');
    const chip = page.locator('.extension-chip');
    const label = chip.locator('.extension-chip-install');
    // Computed colour comes back as rgb() or color(srgb ...) depending on
    // whether a mix produced it, so both forms are read the same way.
    const channels = (value: string): number[] => {
      const parts = value.match(/[\d.]+/g)!.slice(0, 3).map(Number);
      return value.startsWith('color(') ? parts.map((n) => n * 255) : parts;
    };
    const read = async () => ({
      text: channels(await label.evaluate((n) => getComputedStyle(n).color)),
      ground: channels(await chip.evaluate((n) => getComputedStyle(n).backgroundColor)),
    });

    const rest = await read();
    await chip.hover();
    // Past the .15s colour transition: mid-flight Chrome reports the
    // interpolated colour as oklab(), whose first number is a lightness rather
    // than a channel, and reading it there compares two different scales.
    await page.waitForTimeout(300);
    const hovered = await read();

    // The ground carries the hover; the label only follows it. A label that
    // moved as far as the ground did would read as changing weight.
    expect(hovered.ground[0]).toBeLessThan(rest.ground[0]);
    const shift = rest.text[0] - hovered.text[0];
    expect(shift).toBeGreaterThan(0);
    expect(shift).toBeLessThan(25);
  });

  test('stays out of the title bar once the extension reports', async ({page}) => {
    await page.goto('/');
    await expect(page.locator('.extension-chip')).toBeHidden();
  });

  test('settings keeps the extension row after the chip is dismissed', async ({page}) => {
    await page.goto('/?extension=missing');
    await page.getByRole('button', {name: 'Dismiss'}).click();

    // The chip is a "not now"; the Settings row is how it stays reachable.
    await page.getByRole('button', {name: 'Settings'}).click();
    await page.getByRole('region', {name: 'Settings'}).getByRole('tab', {name: 'About'}).click();
    await expect(page.locator('.options-page').getByText('Browser extension')).toBeVisible();
    await expect(page.locator('.options-page').getByRole('button', {name: 'Install extension'})).toBeVisible();
  });

  test('settings reports an extension that is already installed', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Settings'}).click();
    await page.getByRole('region', {name: 'Settings'}).getByRole('tab', {name: 'About'}).click();

    const settings = page.locator('.options-page');
    await expect(settings.getByText('Browser extension')).toBeVisible();
    await expect(settings.getByText('Installed', {exact: true})).toBeVisible();
    await expect(settings.getByRole('button', {name: 'Install extension'})).toBeHidden();
  });
});

test.describe('browser settings', () => {
  async function openBrowserTab(page: import('@playwright/test').Page) {
    await page.goto('/');
    // Browser is always available, so it is listed among the connections and
    // configured in its own workspace tab.
    return openAppConnection(page, 'Browser');
  }

  test('opens on passwords, and the rail reaches every section', async ({page}) => {
    const modal = await openBrowserTab(page);
    await expect(
      modal.getByRole('heading', {name: 'Browser settings', exact: true}),
    ).toBeVisible();

    // Five sections, in the order the rail lists them.
    const rail = modal.locator('.browser-rail button');
    await expect(rail).toHaveText(['Passwords', 'Downloads', 'History', 'Site permissions', 'Cookies and data', 'Import']);
    // Icons in one strip are all one size: the shared rail size.
    const sizes = await rail.locator('svg').evaluateAll((nodes) =>
      [...new Set(nodes.map((node) => node.getAttribute('width')))]);
    expect(sizes).toEqual(['16']);
  });

  test('the section rail keeps the rhythm of every other rail in settings', async ({page}) => {
    // Settings has one content-rail idiom, used by MCP, Skills and Models.
    // The browser pane's section rail is one of those, not a special case, so
    // its spacing is measured against the real thing rather than pinned to
    // numbers that can drift apart from it.
    await page.goto('/');
    const connections = await openConnections(page);
    // The landing is the marketplace directory; measure the rail it links to.
    await connections.locator('.marketplace-section', {hasText: 'Recommended Skills'}).getByRole('button', {name: 'See all'}).click();
    const shared = await connections.locator('.options-rail-row').first().evaluate((node) => {
      const next = node.parentElement!.nextElementSibling?.querySelector('.options-rail-row') ?? null;
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      return {
        radius: style.borderRadius,
        innerGap: style.gap,
        gap: next ? +(next.getBoundingClientRect().top - box.bottom).toFixed(1) : null,
      };
    });

    await page.goto('/');
    const modal = await openAppConnection(page, 'Browser');
    const rail = modal.locator('.browser-rail button');
    const mine = await rail.first().evaluate((node) => {
      const rows = [...node.closest('.browser-rail')!.querySelectorAll('button')];
      const style = getComputedStyle(node);
      return {
        radius: style.borderRadius,
        innerGap: style.gap,
        gap: +(rows[1]!.getBoundingClientRect().top - rows[0]!.getBoundingClientRect().bottom).toFixed(1),
      };
    });

    expect(mine.radius).toBe(shared.radius);
    expect(mine.innerGap).toBe(shared.innerGap);
    if (shared.gap !== null) expect(mine.gap).toBe(shared.gap);
  });

  test('a saved password is listed without its secret until it is asked for', async ({page}) => {
    const modal = await openBrowserTab(page);
    const list = modal.locator('.browser-list li');
    await expect(list).toHaveCount(2);
    await expect(list.first()).toContainText('github.com');
    await expect(list.first()).toContainText('demo@example.com');
    // The password is not on screen, and not merely hidden in the markup.
    await expect(modal.getByText('correct-horse-battery')).toHaveCount(0);

    await list.first().getByRole('button', {name: 'Show password'}).click();
    await expect(modal.getByText('correct-horse-battery')).toBeVisible();
    // One at a time: revealing is a per-entry request, so the other stays shut.
    await expect(modal.getByText('demo-password-2')).toHaveCount(0);

    await list.first().getByRole('button', {name: 'Hide password'}).click();
    await expect(modal.getByText('correct-horse-battery')).toHaveCount(0);
  });

  test('deleting a password takes it out of the list', async ({page}) => {
    const modal = await openBrowserTab(page);
    const list = modal.locator('.browser-list li');
    await list.first().getByRole('button', {name: 'Delete password'}).click();
    await expect(list).toHaveCount(1);
    await expect(modal.getByText('github.com')).toHaveCount(0);
  });

  test('autofill is a switch that reports its own state', async ({page}) => {
    const modal = await openBrowserTab(page);
    const autofill = modal.getByRole('switch', {name: 'Save and fill passwords'});
    await expect(autofill).toHaveAttribute('aria-checked', 'true');
    await autofill.click();
    await expect(autofill).toHaveAttribute('aria-checked', 'false');
  });

  test('the download location is shown and can be changed', async ({page}) => {
    const modal = await openBrowserTab(page);
    await modal.getByRole('button', {name: 'Downloads', exact: true}).click();
    await expect(modal.getByText('/demo/Downloads')).toBeVisible();

    // Passing no path opens the picker in the main process; the demo stands in
    // for it and answers with the folder that was chosen.
    await modal.getByRole('button', {name: 'Change'}).click();
    await expect(modal.getByText('/demo/Documents/Polymux')).toBeVisible();

    const ask = modal.getByRole('switch', {name: 'Ask where to save each file'});
    await expect(ask).toHaveAttribute('aria-checked', 'false');
    await ask.click();
    await expect(ask).toHaveAttribute('aria-checked', 'true');
  });

  test('a download in flight offers what can be done to it', async ({page}) => {
    const modal = await openBrowserTab(page);
    await modal.getByRole('button', {name: 'Downloads', exact: true}).click();
    const rows = modal.locator('.browser-list li');

    // A finished download opens; a running one pauses or cancels. The controls
    // follow the state rather than being shown greyed out.
    const finished = rows.filter({hasText: 'report (1).pdf'});
    await expect(finished.getByRole('button', {name: 'Open'})).toBeVisible();
    await expect(finished.getByRole('button', {name: 'Pause'})).toHaveCount(0);

    const running = rows.filter({hasText: 'dataset.csv'});
    // Binary units, one decimal until three figures — the drive tab's rule.
    await expect(running).toContainText('4.0 MB');
    await expect(running).toContainText('11.3 MB');
    await running.getByRole('button', {name: 'Pause'}).click();
    await expect(running.getByRole('button', {name: 'Resume'})).toBeVisible();
  });

  test('history lists pages, searches them, and forgets one', async ({page}) => {
    const modal = await openBrowserTab(page);
    await modal.getByRole('button', {name: 'History', exact: true}).click();

    const rows = modal.locator('.browser-history-list li');
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toContainText('Anthropic · GitHub');
    // A page seen more than once says so, which is what makes the list rankable.
    await expect(rows.filter({hasText: 'Hacker News'})).toContainText('48 visits');

    await modal.getByPlaceholder('Search history').fill('notion');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Roadmap');

    await modal.getByPlaceholder('Search history').fill('');
    await expect(rows).toHaveCount(3);
    await rows.filter({hasText: 'Roadmap'}).getByRole('button', {name: 'Forget this page'}).click();
    await expect(rows).toHaveCount(2);
  });

  test('clearing all history confirms in place first', async ({page}) => {
    const modal = await openBrowserTab(page);
    await modal.getByRole('button', {name: 'History', exact: true}).click();
    await modal.getByRole('button', {name: 'Clear history'}).click();

    // The confirmation takes the row over inside the detail: no second dialog.
    await expect(modal.getByRole('dialog')).toHaveCount(0);
    await expect(modal.getByText('Clear all browsing history?')).toBeVisible();
    await modal.getByRole('button', {name: 'Cancel'}).click();
    await expect(modal.locator('.browser-history-list li')).toHaveCount(3);

    await modal.getByRole('button', {name: 'Clear history'}).click();
    await modal.getByRole('button', {name: 'Clear', exact: true}).click();
    await expect(modal.getByText('No pages visited yet')).toBeVisible();
  });

  test('a site permission can be changed from the table', async ({page}) => {
    const modal = await openBrowserTab(page);
    await modal.getByRole('button', {name: 'Site permissions'}).click();

    const rows = modal.locator('.browser-table tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('maps.example.com');
    await expect(rows.first()).toContainText('Location');

    const decision = rows.first().getByRole('combobox');
    await expect(decision).toHaveValue('allow');
    await decision.selectOption('deny');
    await expect(decision).toHaveValue('deny');
  });

  test('clearing one site confirms in place rather than opening a dialog', async ({page}) => {
    const modal = await openBrowserTab(page);
    await modal.getByRole('button', {name: 'Cookies and data'}).click();

    const site = modal.locator('.browser-list li').filter({hasText: 'github.com'});
    await expect(site).toContainText('14 cookies');
    await site.getByRole('button', {name: 'Clear'}).click();

    // The confirmation takes the row over: what is about to be cleared is
    // already on screen behind it, so no second dialog opens.
    await expect(modal.getByRole('dialog')).toHaveCount(0);
    await expect(site).toContainText('Clear github.com and its subdomains?');
    await site.getByRole('button', {name: 'Cancel'}).click();
    await expect(site).toContainText('14 cookies');

    await site.getByRole('button', {name: 'Clear'}).click();
    await site.getByRole('button', {name: 'Clear', exact: true}).last().click();
    await expect(modal.locator('.browser-list li').filter({hasText: 'github.com'})).toHaveCount(0);
  });

  test('discovered browsers say what can and cannot be read', async ({page}) => {
    const modal = await openBrowserTab(page);
    await modal.getByRole('button', {name: 'Import'}).click();
    await modal.getByRole('button', {name: 'Scan for browsers'}).click();

    const chrome = modal.locator('.browser-source').filter({hasText: 'Google Chrome'});
    await expect(chrome).toContainText('Person 1');
    await expect(chrome.getByRole('button', {name: 'Import'})).toBeVisible();

    // Safari can only give up cookies, and only with Full Disk Access — the
    // tab says so instead of failing blankly when the import returns nothing.
    const safari = modal.locator('.browser-source').filter({hasText: 'Safari'});
    await expect(safari).toContainText('Full Disk Access');
    await expect(safari).toContainText('Passwords can only be imported from a file you export.');
    await expect(safari.getByRole('button', {name: 'Import'})).toHaveCount(0);

    await chrome.getByRole('button', {name: 'Import'}).click();
    await expect(modal.getByText('Imported 128 cookies, 6 passwords and 2,140 pages.')).toBeVisible();
    await expect(modal.getByText('Some items were skipped')).toBeVisible();
  });
});

test.describe('notification settings', () => {
  async function openNotifications(page: import('@playwright/test').Page) {
    await page.goto('/');
    await page.getByRole('button', {name: 'Settings'}).click();
    const modal = page.getByRole('region', {name: 'Settings'});
    await modal.getByRole('tab', {name: 'Notifications'}).click();
    await modal.getByRole('heading', {name: 'Notifications', exact: true, level: 4}).scrollIntoViewIfNeeded();
    return modal;
  }

  /** The five events, in the order the group lists them. */
  const KIND_ROWS = [
    'Scheduled task finished',
    'Scheduled task failed',
    'Agent finished',
    'Agent needs you',
    'New message',
  ];

  test('offers one row per event, all on to begin with', async ({page}) => {
    const modal = await openNotifications(page);
    await expect(modal.getByRole('heading', {name: 'Notifications', exact: true, level: 4})).toBeVisible();
    await expect(modal.getByRole('switch', {name: 'Enable notifications'})).toHaveAttribute('aria-checked', 'true');
    await expect(modal.getByRole('button', {name: 'Send a test'})).toHaveCount(0);
    for (const name of KIND_ROWS)
      await expect(modal.getByRole('switch', {name, exact: true})).toHaveAttribute('aria-checked', 'true');
  });

  test('uses an event-specific icon for each notification', async ({page}) => {
    const modal = await openNotifications(page);
    const icons = [
      ['Scheduled task finished', 'calendar'],
      ['Scheduled task failed', 'calendar-error'],
      ['Agent finished', 'circle-check'],
      ['Agent needs you', 'circle-question'],
      ['New message', 'inbox'],
    ] as const;

    for (const [name, icon] of icons) {
      const row = modal.locator('.general-setting-row').filter({hasText: name});
      await expect(row.locator(`[data-icon="${icon}"]`)).toHaveCount(1);
    }
  });

  test('the master switch greys the rows below it and stops them answering', async ({page}) => {
    const modal = await openNotifications(page);
    const group = modal.locator('.computerHistory-group').filter({hasText: 'Scheduled task finished'});
    const first = modal.getByRole('switch', {name: 'Scheduled task finished', exact: true});
    await expect(group).not.toHaveClass(/disabled/);
    await expect(first).toBeEnabled();

    await modal.getByRole('switch', {name: 'Enable notifications'}).click();

    // Greyed, not hidden: the choice underneath stays readable.
    await expect(group).toHaveClass(/disabled/);
    await expect(group).toHaveCSS('opacity', '0.42');
    for (const name of KIND_ROWS)
      await expect(modal.getByRole('switch', {name, exact: true})).toBeDisabled();
    await expect(modal.getByRole('button', {name: 'Send a test'})).toHaveCount(0);
  });

  test('a kind switched off is remembered across the master switch', async ({page}) => {
    const modal = await openNotifications(page);
    const failed = modal.getByRole('switch', {name: 'Scheduled task failed', exact: true});
    const finished = modal.getByRole('switch', {name: 'Scheduled task finished', exact: true});
    await failed.click();
    await expect(failed).toHaveAttribute('aria-checked', 'false');
    // One switch moving leaves its neighbours alone.
    await expect(finished).toHaveAttribute('aria-checked', 'true');

    const master = modal.getByRole('switch', {name: 'Enable notifications'});
    await master.click();
    await master.click();

    // Silencing everything must not rewrite what the user chose underneath.
    await expect(failed).toHaveAttribute('aria-checked', 'false');
    await expect(finished).toHaveAttribute('aria-checked', 'true');
  });
});

test.describe('calendar workspace', () => {
  test('keeps compact month headings left-aligned within their day columns', async ({page}) => {
    await page.setViewportSize({width: 520, height: 720});
    await page.goto('/?workspaceView=calendar&coldStart=0');
    const calendar = page.getByRole('region', {name: 'Calendar'});
    const headings = calendar.locator('.month-weekdays span');
    const dayCells = calendar.locator('.month-day');
    await expect(headings).toHaveCount(7);
    await expect(dayCells).toHaveCount(42);
    await expect(headings.first()).toHaveCSS('text-align', 'left');
    await expect(headings.first()).toHaveCSS('padding-left', '4px');

    for (let column = 0; column < 7; column += 1) {
      const [heading, dayCell] = await Promise.all([
        headings.nth(column).boundingBox(),
        dayCells.nth(column).boundingBox(),
      ]);
      expect(Math.abs(heading!.x - dayCell!.x)).toBeLessThan(1);
      expect(Math.abs(heading!.width - dayCell!.width)).toBeLessThan(1);
    }

    const width = await calendar.locator('.month-grid').evaluate((grid) => ({
      visible: grid.clientWidth,
      content: grid.scrollWidth,
    }));
    expect(width.content).toBe(width.visible);
  });

  test('uses a calendar menu instead of a sidebar when compact', async ({page}) => {
    await page.setViewportSize({width: 780, height: 720});
    await page.goto('/?workspaceView=calendar&coldStart=0');
    const calendar = page.getByRole('region', {name: 'Calendar'});
    const toolbar = calendar.locator('.calendar-toolbar');
    const compactMenu = calendar.locator('.compact-calendar-menu').getByRole('button', {name: 'Calendars', exact: true});
    await expect(compactMenu).toBeVisible();
    await expect(calendar.getByRole('button', {name: 'Hide calendars'})).toBeHidden();
    await expect(calendar.locator('.calendar-sidebar')).toBeHidden();

    const toolbarHeight = (await toolbar.boundingBox())!.height;
    await compactMenu.click();
    const menu = calendar.getByRole('menu', {name: 'Calendars'});
    await expect(menu.getByRole('menuitemcheckbox', {name: 'iCloud · Personal'})).toBeVisible();
    await expect(menu.getByRole('menuitemcheckbox', {name: 'Google · University'})).toBeVisible();
    const [triggerBox, menuBox] = await Promise.all([compactMenu.boundingBox(), menu.boundingBox()]);
    expect(Math.abs(menuBox!.y - (triggerBox!.y + triggerBox!.height + 5))).toBeLessThan(1);

    await page.setViewportSize({width: 700, height: 720});
    await expect(toolbar).toHaveCSS('height', `${toolbarHeight}px`);
    await expect(compactMenu).toBeVisible();

    await page.setViewportSize({width: 1100, height: 720});
    await expect(compactMenu).toBeHidden();
    await expect(calendar.getByRole('button', {name: 'Hide calendars'})).toBeVisible();
    await expect(calendar.locator('.calendar-sidebar')).toBeVisible();
    await expect(toolbar).toHaveCSS('height', `${toolbarHeight}px`);
  });

  test('keeps suggested events in the sidebar as a switchable view', async ({page}) => {
    await page.setViewportSize({width: 1100, height: 720});
    await page.goto('/?workspaceView=calendar&coldStart=0');
    const calendar = page.getByRole('region', {name: 'Calendar'});
    const sidebar = calendar.locator('.calendar-sidebar');
    const suggestedView = sidebar.getByRole('button', {name: /Suggested events/});
    await expect(suggestedView).toBeVisible();
    await expect(calendar.locator('.suggestions-strip')).toHaveCount(0);
    await suggestedView.click();
    await expect(sidebar.getByRole('button', {name: 'Review Dinner Sunday'})).toBeVisible();

    await sidebar.getByRole('button', {name: 'Calendars', exact: true}).click();
    await expect(calendar.getByText('iCloud', {exact: true})).toBeVisible();
    await expect(sidebar.getByRole('button', {name: 'Review Dinner Sunday'})).toHaveCount(0);

    await suggestedView.click();
    await expect(sidebar.getByRole('button', {name: 'Review Dinner Sunday'})).toBeVisible();
  });

  test('switches views and creates, edits, and deletes an event', async ({page}) => {
    await page.goto('/?workspaceView=calendar&coldStart=0');
    const calendar = page.getByRole('region', {name: 'Calendar'});
    await expect(calendar).toBeVisible();
    await expect(calendar.locator('.month-grid')).toBeVisible();
    await expect(calendar.getByRole('button', {name: 'Calendar settings'}).locator('svg')).toHaveAttribute('width', '14');
    await expect(calendar.getByText('iCloud', {exact: true})).toBeVisible();
    await expect(calendar.getByText('Google', {exact: true})).toBeVisible();

    await calendar.getByRole('button', {name: 'Week', exact: true}).click();
    await expect(calendar.locator('.time-grid')).toBeVisible();
    await expect(calendar.getByText('CS4234 Lecture', {exact: true})).toBeVisible();

    await calendar.getByRole('button', {name: 'New event'}).click();
    const editor = page.getByRole('dialog', {name: 'New event'});
    await expect(editor.getByPlaceholder('Event title')).toHaveCSS('padding-left', '8px');
    const calendarDropdown = editor.getByRole('button', {name: 'Calendar'});
    await calendarDropdown.click();
    const calendarMenu = editor.getByRole('menu', {name: 'Calendar'});
    const [triggerBox, menuBox] = await Promise.all([calendarDropdown.boundingBox(), calendarMenu.boundingBox()]);
    expect(Math.abs(menuBox!.y - (triggerBox!.y + triggerBox!.height + 5))).toBeLessThan(1);
    expect(Math.abs(menuBox!.x - triggerBox!.x)).toBeLessThan(1);
    expect(Math.abs(menuBox!.width - triggerBox!.width)).toBeLessThan(1);
    await calendarMenu.getByRole('menuitemradio', {name: 'iCloud · Personal'}).click();
    await editor.getByPlaceholder('Event title').fill('Calendar verification');
    await editor.getByLabel('Repeat').selectOption('weekly');
    await editor.getByLabel('Location').fill('Polymux');
    await editor.getByRole('button', {name: 'Save'}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(calendar.getByRole('button', {name: /Calendar verification/})).toBeVisible();

    await calendar.getByRole('button', {name: /Calendar verification/}).click();
    const details = page.getByRole('dialog', {name: 'Event details'});
    await details.getByPlaceholder('Event title').fill('Calendar verified');
    await details.getByLabel('Location').fill('');
    await details.getByRole('button', {name: 'Save'}).click();
    await expect(calendar.getByRole('button', {name: /Calendar verified/})).toBeVisible();

    await calendar.getByRole('button', {name: /Calendar verified/}).click();
    const reopened = page.getByRole('dialog', {name: 'Event details'});
    await expect(reopened.getByLabel('Location')).toHaveValue('');
    await reopened.getByRole('button', {name: 'Delete'}).click();
    await expect(calendar.getByRole('button', {name: /Calendar verified/})).toHaveCount(0);

    await calendar.getByRole('button', {name: 'Day', exact: true}).click();
    await expect(calendar.locator('.time-view.single')).toBeVisible();
    await calendar.getByRole('button', {name: 'Year', exact: true}).click();
    await expect(calendar.locator('.year-view .year-month')).toHaveCount(12);
  });
});
