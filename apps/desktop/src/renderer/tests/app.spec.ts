import {readFileSync} from 'node:fs';
import {expect, test, type Locator, type Page} from '@playwright/test';

const editor = (page: Page) => page.getByRole('textbox', {name: 'Message Polymux'});
const chatDrawer = (page: Page) => page.locator('aside.chat-drawer');
const workspaceDrawer = (page: Page) => page.locator('aside.workspace-drawer');
const summaryCard = (page: Page) => page.locator('aside.summary-panel');
/** The launcher's Recent rows: the second group, since the first is the fixed
 * list of views to open. */
const recentRows = (drawer: Locator) =>
  drawer.locator('.workspace-launcher-rows').last().locator('.workspace-launcher-row');

async function openAgentSection(settings: Locator, section: 'Models' | 'Providers') {
  await settings.getByRole('tab', {name: 'Agent'}).click();
  await settings.getByRole('button', {name: new RegExp(`${section}.*Configure`)}).click();
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
    expect(pose).toEqual({
      state: 'settled',
      brandAnimation: 'none',
      slideAnimation: 'none',
      settledTravel: true,
    });
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

  test('opens Settings as a full page with connections, models and memory controls', async ({page}) => {
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

    const modal = page.getByRole('region', {name: 'Settings'});
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('heading', {name: 'General'})).toBeVisible();
    await expect(modal.getByText('Manage Polymux preferences and access.')).toBeVisible();
    // A full page now, not a sheet: it fills the window and starts at its corner.
    const modalBounds = await modal.boundingBox();
    const viewport = page.viewportSize();
    expect(modalBounds).not.toBeNull();
    expect(modalBounds!.x).toBe(0);
    expect(modalBounds!.y).toBe(0);
    expect(modalBounds!.width).toBe(viewport!.width);
    await expect(modal).toHaveCSS('border-style', 'none');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(modal.getByRole('tab')).toHaveText(['General', 'Agent', 'Hub', 'Drive', 'Browser', 'Plugins', 'MCP', 'Skills', 'Memory']);
    const tabMetrics = await modal.getByRole('tab').first().evaluate((node) => {
      const style = getComputedStyle(node);
      return {fontSize: style.fontSize, height: style.height, radius: style.borderRadius, icons: node.querySelectorAll('svg').length};
    });
    expect(tabMetrics).toEqual({fontSize: '13px', height: '32px', radius: '9px', icons: 1});
    const timeAccess = modal.getByRole('switch', {name: 'Enable time access'});
    const locationAccess = modal.getByRole('switch', {name: 'Enable location access'});
    // Reading semantic text and capturing pixels are separate macOS grants,
    // but General presents them as the one screen-reading capability they form.
    await expect(modal.getByRole('switch', {name: 'Screen reading'})).toHaveCount(1);
    await expect(modal.getByRole('switch', {name: 'Screen recording'})).toHaveCount(0);
    const theme = modal.getByRole('radiogroup', {name: 'Theme'});
    await expect(modal.getByText(Intl.DateTimeFormat().resolvedOptions().timeZone, {exact: true})).toBeVisible();
    await expect(modal.getByText(/refreshed|updated/i)).toHaveCount(0);
    await expect(modal.getByRole('button', {name: 'Refresh location'})).toHaveCount(0);
    await expect(theme.getByRole('radio', {name: 'Light'})).toHaveAttribute('aria-checked', 'true');
    await theme.getByRole('radio', {name: 'Dark'}).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('.brand-mark')).toHaveCSS('filter', 'invert(1)');
    await expect(page.locator('.polymux-prompt-shell').first()).toHaveCSS('background-color', 'rgb(43, 43, 43)');
    await expect(timeAccess).toHaveCSS('background-color', 'rgb(231, 231, 231)');
    await expect(timeAccess.locator('span')).toHaveCSS('background-color', 'rgb(36, 36, 36)');
    await theme.getByRole('radio', {name: 'Light'}).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.emulateMedia({colorScheme: 'dark'});
    await theme.getByRole('radio', {name: 'System'}).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.emulateMedia({colorScheme: 'light'});
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
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

    await modal.getByRole('tab', {name: 'MCP'}).click();
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
    await expect(officialMcp.locator('small')).toHaveText('Polymux · Connected');
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
    await modal.getByRole('button', {name: /^Files Custom/}).click();
    await expect(modal.getByRole('button', {name: 'Delete MCP server'})).toBeVisible();
    await modal.getByRole('button', {name: 'Delete MCP server'}).click();
    await expect(modal.getByRole('button', {name: /^Files Custom/})).toHaveCount(0);
    await expect(modal.getByRole('heading', {name: 'Filesystem'})).toBeVisible();
    await expect(modal.getByRole('button', {name: 'Filter MCP servers'})).toBeVisible();
    await expect(modal.getByRole('button', {name: 'Sort MCP servers'})).toBeVisible();
    await modal.getByRole('button', {name: 'Filter MCP servers'}).click();
    const mcpFilterMenu = modal.getByRole('menu', {name: 'Filter MCP servers'});
    await expect(mcpFilterMenu.getByRole('menuitemradio')).toHaveText(['All MCP servers', 'Enabled', 'Disabled', 'Connected', 'Official', 'Custom']);
    await mcpFilterMenu.getByRole('menuitemradio', {name: 'Connected'}).click();
    await expect(modal.getByRole('button', {name: /Filesystem/})).toBeVisible();
    await modal.getByRole('button', {name: 'Filter MCP servers'}).click();
    await modal.getByRole('menuitemradio', {name: 'All MCP servers'}).click();
    await modal.getByRole('button', {name: 'Sort MCP servers'}).click();
    await expect(modal.getByRole('menu', {name: 'Sort MCP servers'}).getByRole('menuitemradio')).toHaveText(['Recommended', 'Server A–Z', 'Server Z–A']);
    await modal.getByRole('menuitemradio', {name: 'Recommended'}).click();
    await expect(modal.getByRole('button', {name: 'Refresh MCP'})).toHaveCount(0);
    const mcpSearch = modal.getByRole('searchbox', {name: 'Search MCP server'});
    await expect(mcpSearch).toHaveAttribute('placeholder', 'Search MCP server');
    await mcpSearch.fill('does-not-exist');
    const emptyMcp = modal.getByText('No MCP servers found');
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

    await modal.getByRole('tab', {name: 'Skills'}).click();
    await expect(modal.getByRole('heading', {name: 'Documents'})).toBeVisible();
    await expect(modal.getByRole('heading', {name: 'Documents'})).toHaveCSS('font-size', '15px');
    await expect(modal.getByText('Create and edit document files.')).toBeVisible();
    const officialPdf = modal.getByRole('button', {name: /PDF Official/});
    await expect(officialPdf).toBeVisible();
    await expect(officialPdf.locator('[data-icon="verified"]')).toBeVisible();
    await expect(officialPdf.locator('small')).toHaveText('Polymux · Active');
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
    await expect(modal.getByRole('button', {name: 'Filter skills'})).toBeVisible();
    await expect(modal.getByRole('button', {name: 'Sort skills'})).toBeVisible();
    await modal.getByRole('button', {name: 'Filter skills'}).click();
    const skillFilterMenu = modal.getByRole('menu', {name: 'Filter skills'});
    await expect(skillFilterMenu.getByRole('menuitemradio')).toHaveText(['All', 'Enabled', 'Disabled', 'Official', 'Custom']);
    await skillFilterMenu.getByRole('menuitemradio', {name: 'Official'}).click();
    await expect(modal.getByRole('button', {name: /PDF Official/})).toBeVisible();
    await modal.getByRole('button', {name: 'Filter skills'}).click();
    await modal.getByRole('menuitemradio', {name: 'All', exact: true}).click();
    await modal.getByRole('button', {name: 'Sort skills'}).click();
    await expect(modal.getByRole('menu', {name: 'Sort skills'}).getByRole('menuitemradio')).toHaveText(['Recommended', 'Last edited', 'Skill A–Z', 'Skill Z–A']);
    await modal.getByRole('menuitemradio', {name: 'Recommended'}).click();
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

    await modal.getByRole('button', {name: 'Back to app'}).click();
    await expect(modal).toHaveCount(0);
  });

  test('creates a profile from the profile menu', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Settings'}).click();
    const settings = page.getByRole('region', {name: 'Settings'});
    await settings.locator('.profile-trigger').click();
    await settings.getByRole('button', {name: 'New profile'}).click();
    const name = settings.getByRole('textbox', {name: 'Profile name'});
    await expect(name).toBeFocused();
    await name.fill('Work');
    await settings.getByRole('button', {name: 'Create'}).click();
    await expect(settings.locator('.profile-trigger')).toHaveText('Work');
    await expect(settings.getByRole('menu', {name: 'Profiles'})).toHaveCount(0);
  });

  test('keeps the profile menu open on selection and renames a double-clicked row', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Settings'}).click();
    const settings = page.getByRole('region', {name: 'Settings'});
    await settings.locator('.profile-trigger').click();
    await settings.getByRole('button', {name: 'New profile'}).click();
    await settings.getByRole('textbox', {name: 'Profile name'}).fill('Work');
    await settings.getByRole('button', {name: 'Create'}).click();

    await settings.locator('.profile-trigger').click();
    const profiles = settings.getByRole('menu', {name: 'Profiles'});
    const defaultProfile = profiles.getByRole('menuitemradio', {name: 'Default Profile'});
    await defaultProfile.click();
    await expect(profiles).toBeVisible();
    await expect(defaultProfile).toHaveAttribute('aria-checked', 'true');

    const profileRow = profiles.locator('.profile-row').first();
    const displayBox = (await profileRow.boundingBox())!;
    const displayTextBox = (await defaultProfile.locator('span').first().boundingBox())!;
    await defaultProfile.dblclick();
    const rename = profiles.getByRole('textbox', {name: 'Rename Default Profile'});
    await expect(rename).toBeFocused();
    await expect(rename).toHaveValue('Default Profile');
    const renameBox = (await profileRow.boundingBox())!;
    const renameTextBox = (await rename.boundingBox())!;
    expect(renameBox.height).toBe(displayBox.height);
    expect(renameBox.y).toBe(displayBox.y);
    expect(renameTextBox.x).toBe(displayTextBox.x);
    expect(renameTextBox.y).toBe(displayTextBox.y);
    expect(renameTextBox.height).toBe(displayTextBox.height);
    await rename.fill('Personal');
    await rename.press('Enter');
    await expect(profiles.getByRole('menuitemradio', {name: 'Personal'})).toBeVisible();
    await expect(profiles).toBeVisible();
  });

  test('opens profile actions at any right-click point without clipping', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Settings'}).click();
    const settings = page.getByRole('region', {name: 'Settings'});
    const trigger = settings.locator('.profile-trigger');
    for (const profileName of ['Work', 'Personal']) {
      await trigger.click();
      await settings.getByRole('button', {name: 'New profile'}).click();
      await settings.getByRole('textbox', {name: 'Profile name'}).fill(profileName);
      await settings.getByRole('button', {name: 'Create'}).click();
    }

    await trigger.click();
    const profiles = settings.getByRole('menu', {name: 'Profiles'});
    const checkContextMenu = async (profileName: string, verticalEdge: 'top' | 'bottom', atActions = false) => {
      const row = profiles.locator('.profile-row', {hasText: profileName});
      const rowBox = (await row.boundingBox())!;
      const position = {x: atActions ? rowBox.width - 3 : 8, y: rowBox.height / 2};
      const point = {x: rowBox.x + position.x, y: rowBox.y + position.y};
      await row.click({button: 'right', position});

      const actions = settings.getByRole('menu', {name: `Actions for ${profileName}`});
      await expect(actions.getByRole('menuitem', {name: 'Rename'})).toBeVisible();
      await expect(actions.getByRole('menuitem', {name: 'Duplicate'})).toBeVisible();
      const box = (await actions.boundingBox())!;
      expect(Math.abs(box.x - point.x)).toBeLessThanOrEqual(1);
      expect(Math.abs((verticalEdge === 'top' ? box.y : box.y + box.height) - point.y)).toBeLessThanOrEqual(1);
      expect(box.x).toBeGreaterThanOrEqual(8);
      expect(box.y).toBeGreaterThanOrEqual(8);
      expect(box.x + box.width).toBeLessThanOrEqual(1272);
      expect(box.y + box.height).toBeLessThanOrEqual(712);
    };

    await checkContextMenu('Default Profile', 'top');
    await settings.getByRole('tab', {name: 'Agent'}).click();
    await trigger.click();
    await checkContextMenu('Personal', 'bottom', true);
  });

  test('offers the same rename and context actions from the profile row in the settings rail', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Settings'}).click();
    const settings = page.getByRole('region', {name: 'Settings'});
    const railProfile = settings.locator('.profile-trigger');
    const railBox = (await railProfile.boundingBox())!;
    const position = {x: 12, y: railBox.height / 2};
    const point = {x: railBox.x + position.x, y: railBox.y + position.y};
    await railProfile.click({button: 'right', position});

    const actions = settings.getByRole('menu', {name: 'Actions for Default Profile'});
    await expect(actions.getByRole('menuitem', {name: 'Rename'})).toBeVisible();
    await expect(actions.getByRole('menuitem', {name: 'Duplicate'})).toBeVisible();
    const actionsBox = (await actions.boundingBox())!;
    expect(Math.abs(actionsBox.x - point.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(actionsBox.y + actionsBox.height - point.y)).toBeLessThanOrEqual(1);

    await actions.getByRole('menuitem', {name: 'Rename'}).click();
    const firstRename = settings.getByRole('textbox', {name: 'Rename Default Profile'});
    await expect(firstRename).toBeFocused();
    await firstRename.press('Escape');
    await expect(firstRename).toHaveCount(0);
    await expect(railProfile).toHaveText('Default Profile');

    const displayBox = (await railProfile.boundingBox())!;
    const displayTextBox = (await railProfile.locator('span').first().boundingBox())!;
    await railProfile.dblclick();
    const rename = settings.getByRole('textbox', {name: 'Rename Default Profile'});
    await expect(rename).toBeFocused();
    const renameBox = (await settings.locator('form.profile-trigger.profile-rename').boundingBox())!;
    const renameTextBox = (await rename.boundingBox())!;
    expect(renameBox.height).toBe(displayBox.height);
    expect(renameBox.y).toBe(displayBox.y);
    expect(renameTextBox.x).toBe(displayTextBox.x);
    expect(renameTextBox.y).toBe(displayTextBox.y);
    expect(renameTextBox.height).toBe(displayTextBox.height);
    await rename.fill('Personal');
    await rename.press('Enter');
    await expect(railProfile).toHaveText('Personal');
  });

  test('presents Computer History as summarized activities with raw evidence on demand', async ({page}) => {
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

  test('switches the active profile between Polymux and a custom ACP agent', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Settings'}).click();
    const settings = page.getByRole('region', {name: 'Settings'});
    await expect(settings).not.toHaveClass(/settling/);
    await expect(settings).toHaveCSS('opacity', '1');
    await settings.getByRole('tab', {name: 'Agent'}).click();

    const runtime = settings.getByRole('radiogroup', {name: 'Agent runtime'});
    await expect(runtime.getByRole('radio', {name: /^Polymux Built in$/})).toHaveAttribute('aria-checked', 'true');
    await expect(runtime.getByRole('radio', {name: /Codex/})).toBeVisible();
    await expect(settings.getByText('Polymux Agent is active')).toHaveCount(0);
    await expect(settings.getByRole('button', {name: 'Use agent'})).toHaveCount(0);
    await expect(runtime).toHaveClass(/scroll-fade/);
    await expect(runtime).toHaveClass(/at-top/);
    await runtime.evaluate((grid) => {
      grid.style.flex = '0 0 166px';
      grid.style.height = '166px';
      grid.style.minHeight = '166px';
      grid.style.gridTemplateColumns = '1fr';
    });
    await expect.poll(() => runtime.evaluate((grid) => grid.scrollHeight - grid.clientHeight)).toBeGreaterThan(2);
    await expect(runtime).not.toHaveClass(/at-bottom/);
    await runtime.evaluate((grid) => { grid.scrollTop = (grid.scrollHeight - grid.clientHeight) / 2; });
    await expect(runtime).not.toHaveClass(/at-top/);
    await expect(runtime).not.toHaveClass(/at-bottom/);
    await runtime.evaluate((grid) => { grid.scrollTop = grid.scrollHeight; });
    await expect(runtime).not.toHaveClass(/at-top/);
    await expect(runtime).toHaveClass(/at-bottom/);
    await runtime.evaluate((grid) => { grid.scrollTop = 0; });
    await expect(runtime).toHaveClass(/at-top/);
    await expect(runtime).not.toHaveClass(/at-bottom/);
    await runtime.evaluate((grid) => {
      grid.style.removeProperty('flex');
      grid.style.removeProperty('height');
      grid.style.removeProperty('min-height');
      grid.style.removeProperty('grid-template-columns');
    });
    const runtimeGridHeight = await runtime.evaluate((grid) => grid.getBoundingClientRect().height);
    expect(runtimeGridHeight).toBeGreaterThan(294);
    const configurationBottomGap = await settings.locator('.profile-options').evaluate((panel) => {
      const configuration = panel.querySelector<HTMLElement>('.agent-configuration');
      if (!configuration) throw new Error('Agent configuration is missing');
      return panel.getBoundingClientRect().bottom
        - Number.parseFloat(getComputedStyle(panel).paddingBottom)
        - configuration.getBoundingClientRect().bottom;
    });
    expect(Math.abs(configurationBottomGap)).toBeLessThanOrEqual(1);
    await runtime.getByRole('radio', {name: /Custom/}).click();
    expect(await runtime.evaluate((grid) => grid.getBoundingClientRect().height)).toBeGreaterThanOrEqual(294);
    await settings.getByRole('textbox', {name: 'Name'}).fill('Codex');
    await settings.getByRole('textbox', {name: 'Command'}).fill('codex-acp');
    await settings.getByRole('textbox', {name: 'Arguments'}).fill('--profile\nwork');
    await settings.getByRole('button', {name: 'Use custom agent'}).click();

    await expect(runtime.getByRole('radio', {name: /Custom/})).toHaveAttribute('aria-checked', 'true');
    await expect(settings.getByRole('button', {name: 'Model'})).toBeVisible();
    await expect(settings.getByText('Providers', {exact: true})).toHaveCount(0);
  });

  test('uses the full model directory when an ACP agent advertises a large catalogue', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Settings'}).click();
    const settings = page.getByRole('region', {name: 'Settings'});
    await settings.getByRole('tab', {name: 'Agent'}).click();
    const pi = settings.getByRole('radio', {name: /pi ACP/});
    await pi.click();
    await expect(pi).not.toContainText('Click again to install');

    const model = settings.locator('button.agent-option-open');
    await expect(model).toContainText('Claude Sonnet 4');
    await expect(model).toHaveCSS('font-size', '10.5px');
    await expect(model).toHaveCSS('font-weight', '550');
    await model.click();
    await expect(settings.getByRole('heading', {name: 'Model'})).toBeVisible();
    await expect(settings.getByRole('button', {name: /OpenAI 3 models/})).toBeVisible();
    await expect(settings.getByRole('button', {name: /Anthropic 3 models/})).toBeVisible();
    await expect(settings.getByRole('button', {name: /Google 2 models/})).toBeVisible();
    await settings.getByRole('button', {name: /OpenAI 3 models/}).click();
    await settings.getByRole('button', {name: /GPT-5.2/}).click();
    await settings.getByRole('button', {name: 'Back to Agent'}).click();
    await expect(settings.locator('button.agent-option-open')).toContainText('GPT-5.2');
  });

  test('uses a bare, title-proportioned chevron on Agent configuration pages', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Settings'}).click();
    const settings = page.getByRole('region', {name: 'Settings'});

    for (const section of ['Models', 'Providers'] as const) {
      await openAgentSection(settings, section);
      const agentBack = settings.getByRole('button', {name: 'Back to Agent'});
      await expect(agentBack).toHaveText('');
      await expect(agentBack.locator('svg')).toHaveCount(1);
      const alignment = await settings.locator('.options-header').evaluate((header) => {
        const back = header.querySelector('.agent-back')!.getBoundingClientRect();
        const icon = header.querySelector<SVGElement>('.agent-back svg')!.getBoundingClientRect();
        const titleElement = header.querySelector<HTMLElement>('h2')!;
        const title = titleElement.getBoundingClientRect();
        return {
          horizontalGap: Math.round(title.left + Number.parseFloat(getComputedStyle(titleElement).paddingLeft) - back.right),
          centreOffset: Math.round((title.top + title.bottom - back.top - back.bottom) / 2),
          iconSize: Math.round(icon.width),
          titleFontSize: Math.round(Number.parseFloat(getComputedStyle(titleElement).fontSize)),
        };
      });
      expect(alignment).toEqual({horizontalGap: 8, centreOffset: 1, iconSize: 28, titleFontSize: 28});
    }
  });

  test('activates an already installed ACP agent on the first click', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Settings'}).click();
    const settings = page.getByRole('region', {name: 'Settings'});
    await settings.getByRole('tab', {name: 'Agent'}).click();

    const codex = settings.getByRole('radio', {name: /Codex/});
    await codex.click();
    await expect(codex).not.toContainText('Click again to install');
    await expect(settings.getByRole('button', {name: 'Model'})).toBeVisible();
    const agentLayout = await settings.locator('.profile-options').evaluate((panel) => {
      const grid = panel.querySelector<HTMLElement>('.runtime-grid');
      const configuration = panel.querySelector<HTMLElement>('.agent-configuration');
      if (!grid || !configuration) throw new Error('Agent layout is incomplete');
      return {
        gridHeight: grid.getBoundingClientRect().height,
        overlap: grid.getBoundingClientRect().bottom - configuration.getBoundingClientRect().top,
      };
    });
    expect(agentLayout.gridHeight).toBeGreaterThanOrEqual(294);
    expect(agentLayout.overlap).toBeLessThanOrEqual(0);
  });

  test('preconfigures registry binary agents instead of labelling them custom', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Settings'}).click();
    const settings = page.getByRole('region', {name: 'Settings'});
    await settings.getByRole('tab', {name: 'Agent'}).click();

    for (const [name, version] of [['Junie', 'v3032.2.0'], ['Poolside', 'v1.0.16']] as const) {
      const card = settings.getByRole('radio', {name: new RegExp(name)});
      await expect(card).toBeEnabled();
      await expect(card.locator('small')).toHaveText(version);
      await expect(card).not.toContainText('Custom command');
    }
  });

  test('uses authentication methods advertised by the selected ACP agent', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Settings'}).click();
    const settings = page.getByRole('region', {name: 'Settings'});
    await settings.getByRole('tab', {name: 'Agent'}).click();
    await settings.getByRole('radio', {name: /Codex/}).click();

    await settings.getByRole('button', {name: /Authentication/}).click();
    await expect(settings.getByRole('heading', {name: 'Authentication', level: 2})).toBeVisible();
    await expect(settings.getByRole('heading', {name: 'Connected', level: 4})).toBeVisible();

    await settings.getByRole('button', {name: 'Sign out'}).click();
    await expect(settings.getByRole('heading', {name: 'Sign in required', level: 4})).toBeVisible();
    await settings.getByRole('button', {name: 'Sign in', exact: true}).click();
    await expect(settings.getByRole('heading', {name: 'Connected', level: 4})).toBeVisible();

    await settings.getByRole('button', {name: 'Back to Agent'}).click();
    await expect(settings.getByRole('button', {name: 'Model'})).toBeVisible();
  });

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

    await modal.getByRole('button', {name: 'Back to app'}).click();
    await expect(modal).toHaveCount(0);
  });

  test('auto discovery lists other agents\' skills grouped by where they were found', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Settings'}).click();
    const modal = page.getByRole('region', {name: 'Settings'});
    await modal.getByRole('tab', {name: 'Skills'}).click();
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
    await page.getByRole('button', {name: 'Settings'}).click();
    const modal = page.getByRole('region', {name: 'Settings'});
    await modal.getByRole('tab', {name: 'Skills'}).click();
    await modal.getByRole('button', {name: 'Add Skills'}).click();
    await modal.getByRole('menuitem', {name: 'Auto Discovery'}).click();
    await expect(modal.locator('.discovery-group h4')).toHaveText(['Codex']);
    await expect(modal.locator('.discovery-group-header')).toHaveAttribute('aria-expanded', 'true');
    await expect(modal.locator('.discovery-groups li').filter({hasText: 'repo-map'})).toBeVisible();
  });

  test('toggles integrations and edits Polymux-owned skills and MCP servers', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Settings'}).click();
    const modal = page.getByRole('region', {name: 'Settings'});

    await modal.getByRole('tab', {name: 'MCP'}).click();
    const mcpToggle = modal.getByRole('switch', {name: 'Enable MCP server'});
    await expect(mcpToggle).toHaveAttribute('aria-checked', 'true');
    await mcpToggle.click();
    await expect(mcpToggle).toHaveAttribute('aria-checked', 'false');
    await modal.getByRole('button', {name: 'Edit MCP server'}).click();
    await expect(modal.getByRole('heading', {name: 'Edit MCP server'})).toBeVisible();
    await modal.getByLabel('Name', {exact: true}).fill('Local Files');
    await modal.getByRole('button', {name: 'Save', exact: true}).click();
    await expect(modal.getByRole('heading', {name: 'Local Files'})).toBeVisible();

    await modal.getByRole('tab', {name: 'Skills'}).click();
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

  test('manages profiles from each switcher row and labels the settings tab Agent', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Settings'}).click();
    const settings = page.getByRole('region', {name: 'Settings'});

    await expect(settings.getByRole('tab', {name: 'Agent'})).toBeVisible();
    await expect(settings.getByRole('tab', {name: 'Profile'})).toHaveCount(0);
    await settings.getByRole('button', {name: 'Default Profile', exact: true}).click();
    const profileOptions = settings.getByRole('button', {name: 'Options'});
    await expect(profileOptions).toBeVisible();
    await expect(profileOptions.locator('[data-icon="more"]')).toBeVisible();
    await profileOptions.click();

    const actions = settings.getByRole('menu', {name: 'Actions for Default Profile'});
    await expect(actions.getByRole('menuitem', {name: 'Rename'})).toBeVisible();
    await expect(actions.getByRole('menuitem', {name: 'Duplicate'})).toBeVisible();
    await expect(actions.getByRole('menuitem', {name: 'Default profile'})).toBeDisabled();
    await expect(actions.getByRole('menuitem', {name: 'Delete'})).toBeDisabled();
    await expect(actions.locator('svg')).toHaveCount(4);
    expect((await actions.boundingBox())!.width).toBeLessThan(180);
    expect(await actions.evaluate((menu) => {
      const box = menu.getBoundingClientRect();
      return !!document.elementFromPoint(box.left + 12, box.top + 12)?.closest('.profile-actions-menu');
    })).toBe(true);

    await page.setViewportSize({width: 360, height: 260});
    await expect(actions).toHaveCount(0);
    await settings.getByRole('button', {name: 'Options'}).click();
    const submenuBox = (await settings.getByRole('menu', {name: 'Actions for Default Profile'}).boundingBox())!;
    expect(submenuBox.x).toBeGreaterThanOrEqual(8);
    expect(submenuBox.y).toBeGreaterThanOrEqual(8);
    expect(submenuBox.x + submenuBox.width).toBeLessThanOrEqual(352);
    expect(submenuBox.y + submenuBox.height).toBeLessThanOrEqual(252);

    await page.setViewportSize({width: 1280, height: 720});
    await expect(settings.getByRole('menu', {name: 'Actions for Default Profile'})).toHaveCount(0);
    await settings.getByRole('tab', {name: 'Agent'}).click();
    await expect(settings.getByRole('heading', {name: 'Agent', exact: true})).toBeVisible();
    await expect(settings.getByRole('heading', {name: 'Profile actions'})).toHaveCount(0);
  });

  test('the primary button offers speech until there is something to send', async ({page}) => {
    await page.goto('/');
    const speech = page.getByRole('button', {name: 'Start speech mode'});
    await expect(speech).toBeVisible();
    await speech.hover();
    await expect(page.locator('.shared-tooltip')).toHaveText('Speech Mode');
    await editor(page).click();
    await page.keyboard.type('hello');
    await expect(page.getByRole('button', {name: 'Send message'})).toBeVisible();
  });

  test('speech mode can be disabled and replaced by the Send button', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Settings'}).click();
    const modal = page.getByRole('region', {name: 'Settings'});
    const speechMode = modal.getByRole('switch', {name: 'Enable speech mode'});
    await expect(speechMode).toHaveAttribute('aria-checked', 'true');
    await speechMode.click();
    await expect(speechMode).toHaveAttribute('aria-checked', 'false');
    await modal.getByRole('button', {name: 'Back to app'}).click();

    const send = page.getByRole('button', {name: 'Send message'});
    await expect(send).toBeVisible();
    await expect(page.getByRole('button', {name: 'Start speech mode'})).toHaveCount(0);
    await send.hover();
    await expect(page.locator('.shared-tooltip')).toHaveText('Send');
  });
});

test.describe('top bar settings', () => {
  test('expands as one section and applies checkbox changes immediately', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Settings'}).click();
    const settings = page.getByRole('region', {name: 'Settings'});
    await settings.getByRole('tab', {name: 'General'}).click();

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
    await drive.click();
    await expect(drive).toHaveAttribute('aria-checked', 'false');
    await expect(settings.locator('[data-pinned-view="drive"]')).toHaveCount(0);
  });

  test('clears the grabbed colour after an icon is reordered and released', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Settings'}).click();
    const settings = page.getByRole('region', {name: 'Settings'});
    await settings.getByRole('tab', {name: 'General'}).click();
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
    const gear = page.locator('.top-controls button[aria-label="Settings"] svg');
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
    await page.getByRole('button', {name: 'New Chat'}).hover();
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

    await expect(taskRow).toContainText('None');

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

    // A job filled by a model that cannot reason still reads from a menu, so
    // the rows line up — None is simply its only answer.
    const speechRow = modal.locator('.role-options .general-setting-row').nth(4);
    const speechLevel = speechRow.getByRole('button', {name: /Reasoning for/});
    await expect(speechLevel).toContainText('None');
    await speechLevel.click();
    await expect(modal.getByRole('menu', {name: /Reasoning for/}).getByRole('menuitemradio')).toHaveText(['None']);
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

    // Bounded height with its own scroller, so a long catalogue cannot grow the
    // menu over the composer it hangs off.
    expect(await list.evaluate((node) => getComputedStyle(node).overflowY)).toBe('auto');
    // A whole number of 28px rows, so the resting view ends on a row edge and
    // not on the blank half of a clipped sixth.
    expect((await list.boundingBox())!.height % 28).toBe(0);

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
    expect(box.y).toBeGreaterThanOrEqual(8);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport - 7);

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
    const newChat = page.getByRole('button', {name: 'New Chat'});

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
    const search = page.getByRole('button', {name: 'Search Chats'});
    await expect(search).toHaveCount(0);

    await send(page, 'Original chat message');
    await expect(page.locator('.message.assistant')).toBeVisible({timeout: 4000});
    await page.getByRole('button', {name: 'New Chat'}).click();
    await page.getByRole('button', {name: 'Toggle Chats'}).click();
    await expect(search).toBeVisible();
    await expect(search).toHaveClass(/title-bar-icon-button/);

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

  test('keeps chat actions visible over an expanded workspace and minimises only after acting', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    await page.getByRole('button', {name: 'Expand Workspace'}).click();

    const workspace = page.locator('main');
    const toggleChats = page.getByRole('button', {name: 'Toggle Chats'});
    const newChat = page.getByRole('button', {name: 'New Chat'});
    const search = page.getByRole('button', {name: 'Search Chats'});
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
    expect(boxes).toHaveLength(6);
    // Every icon button shares the 26px line; the text title retains its
    // optical 25px line.
    expect(boxes.map((box) => box.centre)).toEqual([26, 26, 26, 26, 26, 25]);
    const chatDrawerGlyph = await page.locator('[data-icon="panel-left"]').boundingBox();
    const newChatGlyph = await page.locator('[data-icon="new-chat"]').boundingBox();
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
    await expect(assistant.getByRole('button', {name: 'Good response'})).toBeVisible();

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

  test('persists message edits and feedback after starting and reopening a chat', async ({page}) => {
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

    await assistant.hover();
    const goodResponse = assistant.getByRole('button', {name: 'Good response'});
    await goodResponse.click();
    await expect(goodResponse).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', {name: 'New Chat'}).click();
    await expect(page.getByRole('heading', {name: 'What can I help with?'})).toBeVisible();
    await page.getByRole('button', {name: 'Toggle Chats'}).click();
    await chatDrawer(page).getByRole('button', {name: /Open chat: Original chat message/}).click();

    const restoredUser = page.locator('.message:not(.assistant)').first();
    const restoredAssistant = page.locator('.message.assistant').first();
    await expect(restoredUser).toContainText('Updated chat message');
    await restoredAssistant.hover();
    await expect(restoredAssistant.getByRole('button', {name: 'Good response'})).toHaveAttribute('aria-pressed', 'true');
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
    // And it is actually running. Polled rather than sampled twice: under a
    // loaded machine two reads a fixed moment apart can land on the same frame.
    const offset = () => row.locator('svg.task-glyph.running path').first()
      .evaluate((node) => parseFloat(getComputedStyle(node).strokeDashoffset));
    const first = await offset();
    await expect.poll(offset, {timeout: 4000}).not.toBe(first);
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
    await expect(view.locator('.agent-activity-list')).toContainText('Reading Files');

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
    await expect(page.locator('.message.assistant')).toContainText('assembled Polymux chat surface', {timeout: 4000});
    // Settled and collapsed, the trail hides entirely behind the heading.
    await expect(page.locator('.agent-activity-list')).toHaveCount(0);
    await page.locator('.agent-activity-heading').click();
    await expect(page.locator('.agent-activity-list')).toContainText('Using Computer');
    // The run's mid-run narration nests inside the activity group as a
    // commentary row; the repeated reads still collapse to one tool row.
    await expect(page.locator('.agent-activity-list li.commentary')).toContainText('I’ll read the skill files first');
    // Every finished row uses the brief settled cross-fade, never the live
    // shimmer that belongs to the step the agent is actually on.
    expect(await page.locator('.agent-activity-list li').evaluateAll(
      (nodes) => nodes.map((node) => getComputedStyle(node).animationName))).toEqual([
        'activity-settled-in',
        'activity-settled-in',
      ]);
    await expect(page.locator('.agent-activity-list .activity-copy')).toHaveCount(2);
    await expect(page.locator('.agent-activity')).toHaveCount(1);
    await expect(page.locator('.message.assistant')).toHaveCount(1);

    // A row with captured output opens its own detail, ChatGPT-style: the
    // tool's reported sub-steps as an indented trail, then its result excerpt.
    // Commentary is prose, so its row stays one line until it is opened too.
    const commentary = page.locator('.agent-activity-list li.commentary .activity-detail-toggle');
    await expect(commentary).toHaveAttribute('aria-expanded', 'false');
    await expect(commentary.locator('.activity-prose')).toHaveCount(0);
    await commentary.click();
    await expect(commentary.locator('.activity-prose')).toContainText('I’ll read the skill files first');

    const detailToggle = page.locator('.agent-activity-list li:not(.commentary) .activity-detail-toggle');
    await expect(detailToggle).toHaveCount(1);
    await expect(detailToggle.locator('small')).toHaveCount(0);
    await detailToggle.click();
    const steps = detailToggle.locator('.activity-steps li');
    await expect(steps).toHaveCount(2);
    await expect(steps.first()).toHaveText('Scanning the skill manifest');
    await expect(steps.last()).toHaveText('Reading workflow steps');
    await expect(detailToggle.locator('small')).toContainText('Read the unified computer-use workflow.');
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

    await page.getByRole('button', {name: 'New Chat'}).click();
    await expect(page.getByRole('heading', {name: 'What can I help with?'})).toBeVisible();
    await page.getByRole('button', {name: 'Toggle Chats'}).click();
    await chatDrawer(page).getByRole('button', {name: /Open chat: .*/}).first().click();

    const heading = page.locator('.agent-activity-heading');
    await expect(heading).toContainText(/Work(ing|ed) for \d+s/);
    await heading.click();
    await expect(page.locator('.agent-activity-list')).toContainText('Using Computer');
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
      const text = getComputedStyle(node.querySelector('.activity-copy > span:first-child')!);
      return {name: style.animationName, timing: style.animationTimingFunction, clip: text.webkitBackgroundClip ?? text.backgroundClip, glyphAnimation: getComputedStyle(node.querySelector('svg')!).animationName};
    });
    expect(label).toEqual({name: 'activity-glint-pass', timing: 'linear', clip: 'text', glyphAnimation: 'none'});

    await page.getByRole('button', {name: 'Stop agent'}).click();
    await expect(liveRow).toHaveCount(0);
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

  test('stopping the agent drops whatever was queued behind it', async ({page}) => {
    await page.goto('/');
    await send(page, '__demo_run_10000__');
    await editor(page).click();
    await page.keyboard.type('queued prompt');
    await page.getByRole('button', {name: 'Send message'}).click();
    await expect(page.getByRole('region', {name: 'Queued messages'})).toContainText('queued prompt');

    await page.getByRole('button', {name: 'Stop agent'}).click();
    await expect(page.getByRole('region', {name: 'Queued messages'})).toHaveCount(0);
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

  test('centres the title within the available titlebar when panels toggle', async ({page}) => {
    await page.goto('/');
    await send(page, 'centred title');
    const title = page.locator('.conversation-title-bar button');
    const centreOffset = async () => title.evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      const workspace = document.querySelector('.workspace-drawer.open')?.getBoundingClientRect();
      const chatDrawerToggle = document.querySelector('.chat-drawer.open')?.getBoundingClientRect();
      const availableLeft = chatDrawerToggle?.right ?? 0;
      const availableRight = workspace?.left ?? window.innerWidth;
      return Math.abs(Math.round(bounds.left + bounds.width / 2 - (availableLeft + availableRight) / 2));
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

    const address = page.getByLabel('Address').last();
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
    // measure or waiting until the end of the Workspace slide.
    expect(midway!.width).toBeLessThan(before!.width);
    expect(midway!.width).toBeGreaterThan(docked!.width);
    expect(docked!.width).toBeLessThanOrEqual(before!.width);

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

test.describe('chat drawer', () => {
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

      for (const step of ['open', 'close']) {
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

  test('opens as a sheet, groups by recency, and closes again', async ({page}) => {
    await page.goto('/');
    const drawer = chatDrawer(page);
    await expect(drawer).not.toHaveClass(/open/);

    await page.getByRole('button', {name: 'Toggle Chats'}).click();
    await expect(drawer).toHaveClass(/open/);
    const chatDrawerButton = page.getByRole('button', {name: 'Toggle Chats'});
    await expect(chatDrawerButton).not.toHaveClass(/active/);
    await page.mouse.move(400, 200);
    await expect(chatDrawerButton).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(chatDrawerButton).toHaveCSS('color', 'rgb(160, 160, 160)');
    await expect(drawer.getByRole('heading', {name: 'Chats'})).toBeVisible();
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
  });

  test('leaves the side panels alone when the chat changes', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Toggle Chats'}).click();
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
    await page.getByRole('button', {name: 'Toggle Chats'}).click();
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
    await page.getByRole('button', {name: 'Toggle Chats'}).click();
    const drawer = chatDrawer(page);

    const group = drawer.locator('.chat-drawer-group-toggle').first();
    await group.click();
    await expect(group).toHaveClass(/collapsed/);
    await group.click();
    await expect(group).not.toHaveClass(/collapsed/);

    const row = drawer.locator('.chat-drawer-row').first();
    await row.hover();
    await row.getByRole('button', {name: /More actions/}).click();
    await page.getByRole('menuitem', {name: 'Rename'}).click();
    await page.locator('.chat-drawer-edit input').fill('Renamed from the drawer');
    await page.keyboard.press('Enter');
    await expect(drawer.getByText('Renamed from the drawer')).toBeVisible();
  });

  test('creates a one-level folder and moves an indented chat into it', async ({page}) => {
    await page.goto('/?coldStart=0');
    await page.getByRole('button', {name: 'Toggle Chats'}).click();
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
    await drawer.getByRole('textbox', {name: 'Folder name'}).fill('Polymux');
    await page.keyboard.press('Enter');

    const chat = drawer.getByRole('button', {name: 'Open chat: Planning a product launch'});
    const row = chat.locator('..');
    await row.hover();
    await row.getByRole('button', {name: 'More actions: Planning a product launch'}).click();
    await page.getByRole('menuitem', {name: 'Polymux', exact: true}).click();

    const folder = drawer.getByRole('button', {name: 'Collapse folder: Polymux'});
    const nested = drawer.locator('.chat-drawer-folder-chats .chat-drawer-row');
    await expect(folder).toBeVisible();
    await expect(folder.locator('[data-icon="folder-open"]')).toBeVisible();
    await expect(nested).toHaveCount(1);
    const indentation = await nested.locator('.chat-drawer-open-chat').evaluate((node) =>
      Number.parseFloat(getComputedStyle(node).paddingLeft));
    expect(indentation).toBeGreaterThan(10);

    await folder.click();
    const collapsedFolder = drawer.getByRole('button', {name: 'Expand folder: Polymux'});
    await expect(collapsedFolder.locator('[data-icon="folder"]')).toBeVisible();
    await expect(nested).toHaveCount(0);

    // Folder identity, membership, and collapse state survive a renderer reload.
    await page.reload();
    await page.getByRole('button', {name: 'Toggle Chats'}).click();
    await expect(chatDrawer(page).getByRole('button', {name: 'Expand folder: Polymux'})).toBeVisible();
    await expect(chatDrawer(page).getByRole('button', {name: 'New folder'})).toHaveCount(1);
  });

  test('opens folder and chat menus from the right-clicked row position', async ({page}) => {
    await page.goto('/?coldStart=0');
    await page.getByRole('button', {name: 'Toggle Chats'}).click();
    const drawer = chatDrawer(page);

    await drawer.getByRole('button', {name: 'New folder'}).click();
    await drawer.getByRole('textbox', {name: 'Folder name'}).fill('Context Folder');
    await page.keyboard.press('Enter');

    const folderRow = drawer.getByRole('button', {name: 'Collapse folder: Context Folder'}).locator('..');
    const folderRowBox = await folderRow.boundingBox();
    expect(folderRowBox).not.toBeNull();
    const folderClickX = folderRowBox!.width - 60;
    await folderRow.click({button: 'right', position: {x: folderClickX, y: 17}});

    let menu = drawer.getByRole('menu');
    await expect(menu.getByRole('menuitem')).toHaveText(['Rename', 'Delete folder']);
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
    await expect(menu.getByRole('menuitem')).toHaveText(['Rename', 'Context Folder', 'Delete']);
    menuBox = await menu.boundingBox();
    expect(menuBox).not.toBeNull();
    expect(Math.abs(menuBox!.x - (chatRowBox!.x + chatClickX))).toBeLessThan(2);
    expect(Math.abs(menuBox!.y - (chatRowBox!.y + 17))).toBeLessThan(2);
  });

  test('shows a running ring in the row action slot and swaps it for more actions on hover', async ({page}) => {
    await page.goto('/?coldStart=0');
    await send(page, '__demo_run_2400__');
    await page.getByRole('button', {name: 'Toggle Chats'}).click();
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

  test('deletes a chat from its row menu', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Toggle Chats'}).click();
    const drawer = chatDrawer(page);
    const before = await drawer.locator('.chat-drawer-row').count();

    const row = drawer.locator('.chat-drawer-row').first();
    await row.hover();
    await row.getByRole('button', {name: /More actions/}).click();
    await page.getByRole('menuitem', {name: 'Delete'}).click();
    await expect(drawer.locator('.chat-drawer-row')).toHaveCount(before - 1);
  });

  test('resizes with the keyboard within its bounds', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Toggle Chats'}).click();
    const handle = page.getByRole('button', {name: 'Resize Chats'});
    await handle.focus();
    await page.keyboard.press('ArrowRight');
    await expect(chatDrawer(page)).not.toHaveCSS('width', '240px');
  });

  test('keeps its divider and adjacent content on the pointer while dragging', async ({page}) => {
    await page.setViewportSize({width: 1300, height: 800});
    await page.goto('/');
    await send(page, 'in step');
    await page.getByRole('button', {name: 'Toggle Chats'}).click();
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

  test('drawers yield to the conversation floor instead of squeezing the composer', async ({page}) => {
    // This is the renderer's split-layout threshold: both drawer floors, the
    // conversation floor and its 1px handover boundary.
    await page.setViewportSize({width: 1096, height: 640});
    await page.goto('/');
    await page.getByRole('button', {name: 'Toggle Chats'}).click();
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    // Workspace opened last, so the chat drawer gives way to the single spare
    // pixel above its floor while the workspace holds its readable minimum.
    const drawer = chatDrawer(page);
    await expect(drawer).toHaveCSS('width', '184px');
    await expect.poll(async () => {
      const [searchBox, folderBox] = await Promise.all([
        page.getByRole('button', {name: 'Search Chats'}).boundingBox(),
        drawer.getByRole('button', {name: 'New folder'}).boundingBox(),
      ]);
      if (!searchBox || !folderBox) return Number.POSITIVE_INFINITY;
      return Math.abs(
        (searchBox.x + searchBox.width / 2) -
        (folderBox.x + folderBox.width / 2)
      );
    }).toBeLessThanOrEqual(1.5);
    // One row of these buttons is under 20px tall; a wrap doubles it.
    const toolbarOnOneLine = () => page.locator('.polymux-prompt-toolbar').evaluate((bar) =>
      bar.getBoundingClientRect().height < 24);
    expect(await toolbarOnOneLine()).toBe(true);
    // The workspace is already at its floor, so the chat drawer cannot grow by
    // taking space from the conversation.
    const handle = page.getByRole('button', {name: 'Resize Chats'});
    await handle.focus();
    for (let step = 0; step < 4; step += 1) await page.keyboard.press('ArrowRight');
    await expect(chatDrawer(page)).toHaveCSS('width', '184px');
    await expect(workspaceDrawer(page)).toHaveCSS('width', '480px');
    expect(await toolbarOnOneLine()).toBe(true);
  });
});

test.describe('workspace drawer', () => {
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
    await expect(content).toHaveCSS('border-top-width', '0px');
    await expect(drawer.locator('.browser-bar')).toHaveCSS('border-bottom-width', '1px');

    await drawer.getByLabel('New tab', {exact: true}).click();
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

    await address.press('ArrowDown');
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
    await expect(page.getByRole('button', {name: 'Settings'})).toHaveCount(0);
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
    expect((await drawer.boundingBox())!.x).toBe(0);
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
    // sits one standard gap to the left of Settings.
    const gapToSettings = async () => {
      const settings = (await page.getByRole('button', {name: 'Settings'}).boundingBox())!;
      const action = (await page.locator('.expand-workspace-action').boundingBox())!;
      return settings.x - (action.x + action.width);
    };
    const settingsToWorkspace = await page.evaluate(() => {
      const settings = document.querySelector('button[aria-label="Settings"]')!.getBoundingClientRect();
      const workspace = document.querySelector('button[aria-label="Toggle Workspace"]')!.getBoundingClientRect();
      return workspace.left - settings.right;
    });
    expect(await gapToSettings()).toBeCloseTo(settingsToWorkspace);

    await expand.click();
    await expect(workspaceDrawer(page)).toHaveClass(/expanded/);
    await page.waitForTimeout(500);
    expect(await gapToSettings()).toBeCloseTo(settingsToWorkspace);
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

    await page.getByRole('button', {name: 'Toggle Chats'}).click();
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
    const row = page.locator('.general-setting-row', {hasText: 'Stop dictation when silent'});
    await row.getByRole('button').first().click();
    await row.getByRole('menuitemradio', {name: label}).click();
    await expect(row.getByRole('button').first()).toContainText(label);
    await page.getByRole('button', {name: 'Back to app'}).click();
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
    await page.getByRole('button', {name: 'Settings'}).click();
    const modal = page.locator('.options-page');
    await modal.getByRole('tab', {name: 'Hub'}).click();

    // One entry, summarising the set — not a row per account.
    const mail = modal.getByRole('button', {name: /^Mail/});
    await expect(mail).toHaveCount(1);
    await expect(mail).toContainText('3 mailboxes');
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

    // Adding opens the form without leaving the Mail section.
    await modal.getByRole('button', {name: 'Add mailbox'}).click();
    await expect(modal.getByRole('heading', {name: 'Add a mailbox'})).toBeVisible();
    await expect(modal.getByText('Send from this mailbox by default', {exact: true})).toHaveCount(0);
  });

  test('signatures are managed per mailbox with a saved default', async ({page}) => {
    await page.setViewportSize({width: 760, height: 640});
    await page.goto('/');
    await page.getByRole('button', {name: 'Settings'}).click();
    const modal = page.locator('.options-page');
    await modal.getByRole('tab', {name: 'Hub'}).click();
    await modal.getByRole('button', {name: /^Mail/}).click();
    await modal.getByRole('button', {name: 'Manage signatures'}).click();

    const accountMenu = modal.getByRole('button', {name: 'Mail accounts'});
    await expect(accountMenu).toBeVisible();
    const compactWidth = (await accountMenu.boundingBox())?.width ?? Infinity;
    expect(Math.abs(compactWidth - 160)).toBeLessThanOrEqual(0.5);
    const initialChevron = await accountMenu.evaluate((button) => {
      const trigger = button.getBoundingClientRect();
      const chevron = button.querySelector('[data-icon="chevron"]')?.getBoundingClientRect();
      const icon = button.querySelector('.select-menu-icon')?.getBoundingClientRect();
      const label = button.querySelector(':scope > span:not(.select-menu-icon)');
      if (!chevron) throw new Error('Account menu lost its chevron');
      if (!icon || !label) throw new Error('Account menu lost its icon or label');
      const range = document.createRange();
      range.selectNodeContents(label);
      return {
        x: chevron.left,
        labelGap: range.getBoundingClientRect().left - icon.right,
        topInset: chevron.top - trigger.top,
        rightInset: trigger.right - chevron.right,
      };
    });
    expect(Math.abs(initialChevron.labelGap - 6)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(initialChevron.topInset - initialChevron.rightInset)).toBeLessThanOrEqual(1);
    await expect(modal.getByRole('region', {name: 'Signature choices'})).toContainText('Personal');
    await expect(modal.getByRole('region', {name: 'Signature choices'})).toContainText('Work');

    await accountMenu.click();
    const accountList = modal.getByRole('menu', {name: 'Mail accounts'});
    const menuBounds = await accountList.evaluate((list) => {
      const detail = list.closest('.comms-detail');
      const trigger = detail?.querySelector<HTMLButtonElement>('.comms-signature-toolbar .select-menu-trigger');
      if (!detail) throw new Error('Signature menu lost its detail pane');
      if (!trigger) throw new Error('Signature menu lost its trigger');
      const menu = list.getBoundingClientRect();
      const pane = detail.getBoundingClientRect();
      return {
        menuLeft: menu.left,
        menuRight: menu.right,
        menuWidth: menu.width,
        triggerLeft: trigger.getBoundingClientRect().left,
        triggerWidth: trigger.getBoundingClientRect().width,
        paneLeft: pane.left,
        paneRight: pane.right,
      };
    });
    expect(Math.abs(menuBounds.menuLeft - menuBounds.triggerLeft)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(menuBounds.menuWidth - menuBounds.triggerWidth)).toBeLessThanOrEqual(0.5);
    expect(menuBounds.menuLeft).toBeGreaterThanOrEqual(menuBounds.paneLeft - 1);
    expect(menuBounds.menuRight).toBeLessThanOrEqual(menuBounds.paneRight + 1);
    const overflowStyles = await accountList.evaluate((list) => {
      const triggerLabel = list.parentElement?.querySelector<HTMLElement>('.select-menu-trigger > span:not(.select-menu-icon)');
      const optionLabel = list.querySelector<HTMLElement>('.polymux-dropdown-item > span:not(.select-menu-icon):not(.select-menu-check-slot)');
      if (!triggerLabel || !optionLabel) throw new Error('Account menu lost an ellipsis label');
      const trigger = getComputedStyle(triggerLabel);
      const option = getComputedStyle(optionLabel);
      return {
        trigger: [trigger.overflow, trigger.textOverflow, trigger.whiteSpace],
        option: [option.overflow, option.textOverflow, option.whiteSpace],
      };
    });
    expect(overflowStyles.trigger).toEqual(['hidden', 'ellipsis', 'nowrap']);
    expect(overflowStyles.option).toEqual(['hidden', 'ellipsis', 'nowrap']);
    const initialMenuWidth = (await accountList.boundingBox())?.width ?? 0;
    const initialTriggerWidth = (await accountMenu.boundingBox())?.width ?? 0;
    await modal.getByRole('menuitemradio', {name: 'demo@work.example'}).click();
    await expect(accountList).toBeVisible();
    await expect(modal.getByRole('menuitemradio', {name: 'demo@work.example'})).toHaveAttribute('aria-checked', 'true');
    expect(Math.abs(((await accountList.boundingBox())?.width ?? 0) - initialMenuWidth)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(((await accountMenu.boundingBox())?.width ?? 0) - initialTriggerWidth)).toBeLessThanOrEqual(0.5);
    const selectedTrigger = await accountMenu.evaluate((button) => {
      const chevron = button.querySelector('[data-icon="chevron"]')?.getBoundingClientRect();
      const icon = button.querySelector('.select-menu-icon')?.getBoundingClientRect();
      const label = button.querySelector(':scope > span:not(.select-menu-icon)');
      if (!chevron) throw new Error('Account menu lost its chevron');
      if (!icon || !label) throw new Error('Account menu lost its icon or label');
      const range = document.createRange();
      range.selectNodeContents(label);
      return {chevronX: chevron.left, labelGap: range.getBoundingClientRect().left - icon.right};
    });
    expect(Math.abs(selectedTrigger.chevronX - initialChevron.x)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(selectedTrigger.labelGap - initialChevron.labelGap)).toBeLessThanOrEqual(0.5);
    await modal.getByRole('menuitemradio', {name: 'All Signatures'}).click();
    await expect(accountList).toBeVisible();
    expect(Math.abs(((await accountList.boundingBox())?.width ?? 0) - initialMenuWidth)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(((await accountMenu.boundingBox())?.width ?? 0) - initialTriggerWidth)).toBeLessThanOrEqual(0.5);
    await modal.getByRole('menuitemradio', {name: 'demo@work.example'}).click();
    await expect(accountList).toBeVisible();
    await modal.getByRole('heading', {name: 'Signatures', exact: true}).click();
    await expect(accountList).toHaveCount(0);
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
    await choices.getByRole('button', {name: /Work/}).click();
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
    await modal.locator('.comms-mailboxes li', {hasText: 'demo@work.example'}).getByRole('button', {name: 'Signatures'}).click();
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
    // The workspace launcher opens the tab the same way Drive does.
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    await page.locator('.workspace-launcher-row', {hasText: 'Hub'}).click();
    await expect(page.locator('.hub-view')).toBeVisible();
  };

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

    const hint = view.locator('.hub-view-composer-hint');
    await expect(hint).toHaveText('Message File Transfer');
    const layout = await hint.evaluate((node) => {
      node.textContent = 'Message a conversation name that is intentionally much wider than the composer';
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      return {
        overflow: style.overflow,
        textOverflow: style.textOverflow,
        whiteSpace: style.whiteSpace,
        height: box.height,
        lineHeight: Number.parseFloat(style.lineHeight),
        clipped: node.scrollWidth > node.clientWidth,
      };
    });
    expect(layout).toMatchObject({
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      clipped: true,
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
    // The demo intentionally keeps its WeChat bridge unavailable, so the
    // platform source is absent; All Platforms still proves the shared row
    // and thread implementation with the WeChat-shaped fixture.
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
    await expect(view.locator('.hub-view-bubble-file', {hasText: 'Voice message'})).toBeVisible();
    const reel = view.getByLabel('AQO35LDKTG5E80mb8IC1UxBCatqRtz5e1UfSQbW_6TuswMo_IDXhnFdRLTK0IsjSS6YM4A.mp4');
    await expect(reel).toBeVisible();
    await expect(reel).toHaveAttribute('controls', '');
    await expect(reel).toHaveAttribute('playsinline', '');
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
    await expect(view.getByRole('button', {name: 'Record a voice message'})).toBeVisible();
    await richReply.click({button: 'right'});
    await expect(view.locator('.hub-view-emoji-row')).toHaveCount(0);
    // Replies remain available: the adapter carries their context in text.
    await expect(view.getByRole('menuitem', {name: 'Reply'})).toBeVisible();
    const actionMenu = view.locator('.hub-view-message-menu');
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
        left: overlayBox.left,
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
    await page.getByRole('button', {name: 'Settings'}).click();
    const settings = page.getByRole('region', {name: 'Settings'});
    const incognito = settings.getByRole('switch', {name: 'Enable Hub incognito mode'});
    await expect(incognito).toHaveAttribute('aria-checked', 'false');
    await incognito.click();
    await expect(incognito).toHaveAttribute('aria-checked', 'true');
    await settings.getByRole('button', {name: 'Back to app'}).click();

    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    await page.locator('.workspace-launcher-row', {hasText: 'Hub'}).click();
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
      node.style.flex = '0 0 90px';
      node.scrollTo({top: 0, behavior: 'instant'});
    });
    const targetIsVisible = () => target.evaluate((node) => {
      const targetBox = node.getBoundingClientRect();
      const threadBox = node.parentElement!.getBoundingClientRect();
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
    await expect(composer.locator('.hub-view-file')).toContainText('agenda.pdf');
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
    await expect(view.locator('.hub-view-row', {hasText: 'Jules Tan'})).toBeVisible();
    await expect(view.locator('.hub-view-row', {hasText: 'Q3 numbers'}).first()).toBeVisible();
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
    const filter = header.getByRole('button', {name: 'Filter and Sort'});

    await expect(filter).toBeVisible();
    await expect(filter).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const placement = await header.evaluate((node) => {
      const filterBox = node.querySelector<HTMLElement>('.hub-view-chat-filter-button')!.getBoundingClientRect();
      const newChatBox = node.querySelector<HTMLElement>('.hub-view-new-chat-icon')!.getBoundingClientRect();
      return {filterRight: filterBox.right, newChatLeft: newChatBox.left};
    });
    expect(placement.filterRight).toBeLessThanOrEqual(placement.newChatLeft);

    await filter.click();
    const menu = view.getByRole('menu', {name: 'Filter and Sort'});
    await expect(menu).toBeVisible();
    await expect(filter).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const menuPlacement = await menu.evaluate((node) => {
      const menuBox = node.getBoundingClientRect();
      const filterBox = document.querySelector<HTMLElement>('.hub-view-chat-filter-button')!.getBoundingClientRect();
      return {top: menuBox.top, filterBottom: filterBox.bottom};
    });
    expect(menuPlacement.top).toBeGreaterThan(menuPlacement.filterBottom);

    await menu.getByRole('menuitemradio', {name: 'Unread'}).click();
    await expect(filter).toHaveClass(/on/);
    await expect(filter).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(view.locator('.hub-view-row', {hasText: 'Family'})).toBeVisible();
    await expect(view.locator('.hub-view-row', {hasText: 'Jules Tan'})).toHaveCount(0);
    await expect(view.locator('.hub-view-row', {hasText: 'Q3 numbers'}).first()).toBeVisible();

    await filter.click();
    await menu.getByRole('menuitemradio', {name: 'All messages'}).click();
    const rowLabels = view.locator('.hub-view-rows > li .hub-view-row strong');
    const latestFirst = await rowLabels.allInnerTexts();
    await filter.click();
    await menu.getByRole('menuitemradio', {name: 'Earliest message first'}).click();
    const earliestFirst = await rowLabels.allInnerTexts();
    expect(earliestFirst[0]).not.toBe(latestFirst[0]);

    await view.locator('.hub-view-source', {hasText: 'Contacts'}).click();
    await expect(view.getByRole('button', {name: 'Filter and Sort'})).toHaveCount(0);
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
    await expect(contactRows.locator('strong')).toHaveText([
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
    await view.getByRole('button', {name: 'All messages'}).click();
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
    await view.locator('.hub-view-composer button[aria-label="Send"]').click();
    await expect(view.locator('.hub-view-bubble')).toHaveCount(4);
    // The sent message is attributed to the user, not the remote side.
    await expect(view.locator('.hub-view-bubble.mine').first()).toContainText('See you then.');
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
    // Empty: the plus stays outside the field, whose one primary button records
    // rather than sending nothing.
    let labels = await composer.locator(':scope > button').evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute('aria-label')),
    );
    expect(labels).toEqual(['Record a voice message']);
    await expect(composer.locator('button[aria-label="Record a voice message"]')).toBeVisible();
    await expect(composer.locator('button[aria-label="Send"]')).toHaveCount(0);
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
    await expect(composer.locator('button[aria-label="Send"]')).toBeVisible();
    await expect(composer.locator('button[aria-label="Record a voice message"]')).toHaveCount(0);
    labels = await composer.locator(':scope > button').evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute('aria-label')),
    );
    expect(labels).toEqual(['Send']);
    const sendGap = await composer.evaluate((node) => {
      const fieldBox = node.querySelector('textarea')!.getBoundingClientRect();
      const sendBox = node.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.getBoundingClientRect();
      return sendBox.left - fieldBox.right;
    });
    expect(sendGap).toBe(6);

    // Occasional tools stay available from the plus either way.
    await expect(add).toBeVisible();
    await composer.locator('textarea').fill('');
    await expect(composer.locator('button[aria-label="Record a voice message"]')).toBeVisible();
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
    await expect(menu.getByRole('menuitem')).toHaveText(['Attach files', 'Add emoji']);
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

  test('the message composer grows to three lines, then scrolls without a scrollbar', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await view.locator('.hub-view-source', {hasText: 'WhatsApp'}).click();
    await view.locator('.hub-view-row', {hasText: 'Jules Tan'}).click();

    const composer = view.locator('.hub-view-composer');
    const field = composer.locator('textarea');
    const heights: number[] = [];
    for (const value of ['one', 'one\ntwo', 'one\ntwo\nthree', 'one\ntwo\nthree\nfour']) {
      await field.fill(value);
      heights.push(await field.evaluate((node) => node.getBoundingClientRect().height));
    }
    expect(heights[1]).toBeGreaterThan(heights[0]);
    expect(heights[2]).toBeGreaterThan(heights[1]);
    expect(heights[3]).toBe(heights[2]);

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
    await expect(first.locator('.hub-view-reaction', {hasText: '🔥'})).toBeVisible();

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
    await view.locator('.hub-view-composer button[aria-label="Send"]').click();
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
    await view.locator('.hub-view-list-head input[type="search"]').fill('Jules');
    await expect(rows).toHaveCount(1);
    await view.locator('.hub-view-list-head input[type="search"]').fill('');
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
    await expect(view.locator('.hub-view-file')).toContainText('demo-attachment.pdf');
  });

  test('a message shows its images, and never a broken one', async ({page}) => {
    await openView(page);
    const view = page.locator('.hub-view');
    await openMailbox(view);
    await view.locator('.hub-view-row', {hasText: 'Invoice ready'}).click();

    const body = view.locator('.hub-view-html');
    await expect(body).toBeVisible();
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
    await view.locator('.hub-view-row').first().click();
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

    await expect(view.locator('.hub-view-recipients')).toContainText('demo@example.com');
    const attachments = view.locator('.hub-view-mail-files');
    await expect(attachments).toContainText('q3-report.pdf');
    await attachments.getByRole('button').click();
  });
});

test.describe('hub platform setup', () => {
  test('offers the official download when the WeChat desktop app is missing', async ({page}) => {
    await page.goto('/?wechat=missing');
    await page.getByRole('button', {name: 'Settings'}).click();
    const modal = page.locator('.options-page');
    await modal.getByRole('tab', {name: 'Hub'}).click();
    await modal.getByRole('button', {name: /^WeChat/}).click();

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
    await page.getByRole('button', {name: 'Settings'}).click();
    const modal = page.locator('.options-page');
    await modal.getByRole('tab', {name: 'Hub'}).click();

    // The rail summarises plurality instead of naming only the first account.
    const rail = modal.getByRole('button', {name: /Instagram/});
    await expect(rail).toContainText('2 accounts');
    await rail.click();

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
    await page.getByRole('button', {name: 'Settings'}).click();
    const modal = page.locator('.options-page');
    await modal.getByRole('tab', {name: 'Drive'}).click();

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
    await page.goto('/');
    await openFromHistory(page, 'Planning a product launch');

    // Open the Hub view in this chat's workspace.
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    await page.locator('.workspace-launcher-row', {hasText: 'Hub'}).click();
    await expect(page.locator('.hub-view')).toBeVisible();

    // A different chat starts from its own (empty) workspace, not this one's.
    // New Chat rather than a second chat row: which older groups the
    // drawer surfaces by default is being reworked in a parallel branch.
    await page.getByRole('button', {name: 'New Chat', exact: true}).click();
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
    await page.getByRole('button', {name: 'Volver a la app'}).click();

    // …and so does the app behind it, down to the composer's placeholder.
    await expect(page.getByRole('heading', {name: '¿En qué puedo ayudarle?'})).toBeVisible();
    await expect(page.getByText('ADJUNTAR')).toBeVisible();
    await expect(page.locator('[data-placeholder]').first())
      .toHaveAttribute('data-placeholder', 'Pregunte lo que quiera');
    // The document says what it is written in, so the browser hyphenates and
    // quotes accordingly.
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');

    // Arabic is the one right-to-left language, and it flips the whole layout.
    await page.getByRole('button', {name: 'Ajustes'}).click();
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
    await page.getByRole('button', {name: 'Volver a la app'}).click();

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
    const settingsBox = (await page.getByRole('button', {name: 'Settings'}).boundingBox())!;
    expect(chipBox.x).toBeLessThan(settingsBox.x);

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
    await expect(page.locator('.options-page').getByText('Browser extension')).toBeVisible();
    await expect(page.locator('.options-page').getByRole('button', {name: 'Install extension'})).toBeVisible();
  });

  test('settings reports an extension that is already installed', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Settings'}).click();

    const settings = page.locator('.options-page');
    await expect(settings.getByText('Browser extension')).toBeVisible();
    await expect(settings.getByText('Installed', {exact: true})).toBeVisible();
    await expect(settings.getByRole('button', {name: 'Install extension'})).toBeHidden();
  });
});

test.describe('browser settings', () => {
  async function openBrowserTab(page: import('@playwright/test').Page) {
    await page.goto('/');
    await page.getByRole('button', {name: 'Settings'}).click();
    const modal = page.getByRole('region', {name: 'Settings'});
    await modal.getByRole('tab', {name: 'Browser'}).click();
    return modal;
  }

  test('opens on passwords, and the rail reaches every section', async ({page}) => {
    const modal = await openBrowserTab(page);
    await expect(modal.getByRole('heading', {name: 'Browser'})).toBeVisible();
    await expect(
      modal.getByText('Passwords, downloads, site permissions and browsing data.'),
    ).toBeVisible();

    // Five sections, in the order the rail lists them.
    const rail = modal.locator('.browser-rail button');
    await expect(rail).toHaveText(['Passwords', 'Downloads', 'History', 'Site permissions', 'Cookies and data', 'Import']);
    // Icons in one strip are all one size, and the same size the settings nav
    // beside it uses — the section rail is a rail, not a smaller cousin.
    const sizes = await rail.locator('svg').evaluateAll((nodes) =>
      [...new Set(nodes.map((node) => node.getAttribute('width')))]);
    expect(sizes).toEqual(['16']);
    const navSizes = await modal.locator('.options-nav-item svg').evaluateAll((nodes) =>
      [...new Set(nodes.map((node) => node.getAttribute('width')))]);
    expect(navSizes).toEqual(sizes);
  });

  test('the section rail keeps the rhythm of every other rail in settings', async ({page}) => {
    // Settings has one content-rail idiom, used by MCP, Skills and Models.
    // The browser tab's section rail is one of those, not a special case, so
    // its spacing is measured against the real thing rather than pinned to
    // numbers that can drift apart from it.
    await page.goto('/');
    await page.getByRole('button', {name: 'Settings'}).click();
    const modal = page.getByRole('region', {name: 'Settings'});

    await modal.getByRole('tab', {name: 'MCP'}).click();
    const shared = await modal.locator('.options-rail-row').first().evaluate((node) => {
      const next = node.parentElement!.nextElementSibling?.querySelector('.options-rail-row') ?? null;
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      return {
        radius: style.borderRadius,
        innerGap: style.gap,
        gap: next ? +(next.getBoundingClientRect().top - box.bottom).toFixed(1) : null,
      };
    });

    await modal.getByRole('tab', {name: 'Browser'}).click();
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

    await expect(page.getByRole('dialog')).toHaveCount(0);
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
    // already on screen behind it, so no dialog opens.
    await expect(page.getByRole('dialog')).toHaveCount(0);
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
    await modal.getByRole('tab', {name: 'General'}).click();
    await modal.getByRole('heading', {name: 'Notifications', exact: true, level: 3}).scrollIntoViewIfNeeded();
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
    const compactMenu = calendar.getByRole('button', {name: 'Calendars', exact: true});
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

  test('switches views and creates, edits, and deletes an event', async ({page}) => {
    await page.goto('/?workspaceView=calendar&coldStart=0');
    const calendar = page.getByRole('region', {name: 'Calendar'});
    await expect(calendar).toBeVisible();
    await expect(calendar.locator('.month-grid')).toBeVisible();
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
