import {expect, test, type Page} from '@playwright/test';

const editor = (page: Page) => page.getByRole('textbox', {name: 'Message Midas'});
const historyDrawer = (page: Page) => page.locator('aside.history-drawer');
const workspaceDrawer = (page: Page) => page.locator('aside.workspace-drawer');
const summaryCard = (page: Page) => page.locator('aside.summary-panel');

/** The composer's contenteditable does not take synthetic key events from
    `fill`, so a prompt is typed the way a person types it. */
async function send(page: Page, text: string) {
  await editor(page).click();
  await page.keyboard.type(text);
  await page.getByRole('button', {name: 'Send message'}).click();
}

test.describe('welcome view', () => {
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
    expect(logo).not.toContain('<rect');

    // Intentional Midas simplification: no recent chats, no suggestion cards.
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
    await expect(toolbar.getByText('OPTIONS')).toBeVisible();
    await expect(toolbar.getByText('PLUGINS')).toHaveCount(0);
    await expect(toolbar.getByText('TEAMS')).toHaveCount(0);
  });

  test('opens Options as a Teams-style modal with connections, models and memory controls', async ({page}) => {
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
    await page.getByRole('button', {name: 'OPTIONS'}).click();

    const modal = page.getByRole('dialog', {name: 'Options'});
    await expect(modal).toBeVisible();
    const modalBounds = await modal.boundingBox();
    expect(modalBounds).not.toBeNull();
    expect(modalBounds!.width).toBeLessThanOrEqual(782);
    expect(modalBounds!.x).toBeGreaterThanOrEqual(48);
    expect(modalBounds!.y).toBeGreaterThanOrEqual(48);
    await expect(modal).toHaveCSS('border-style', 'none');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(modal.getByRole('tab')).toHaveText(['General', 'MCP', 'Skills', 'Model', 'Provider', 'Memory']);
    const tabMetrics = await modal.getByRole('tab').first().evaluate((node) => {
      const style = getComputedStyle(node);
      return {fontSize: style.fontSize, padding: style.padding, radius: style.borderRadius};
    });
    expect(tabMetrics).toEqual({fontSize: '13px', padding: '5px 11px', radius: '8px'});
    const timeAccess = modal.getByRole('switch', {name: 'Enable time access'});
    const locationAccess = modal.getByRole('switch', {name: 'Enable location access'});
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
    await expect(modal.getByText('Local standard input/output server')).toBeVisible();
    await expect(modal.getByRole('button', {name: 'Add MCP server'})).toBeVisible();
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
    await expect(modal.getByRole('heading', {name: 'Add MCP server'})).toBeVisible();
    await modal.getByRole('button', {name: /Filesystem/}).click();

    await modal.getByRole('tab', {name: 'Skills'}).click();
    await expect(modal.getByRole('heading', {name: 'Documents'})).toBeVisible();
    await expect(modal.getByText('Create and edit document files.')).toBeVisible();
    const officialPdf = modal.getByRole('button', {name: /PDF Official/});
    await expect(officialPdf).toBeVisible();
    await expect(officialPdf.locator('[data-icon="verified"]')).toBeVisible();
    const officialSealGap = await officialPdf.evaluate((row) => {
      const name = row.querySelector('.skill-name-line strong')!.getBoundingClientRect();
      const seal = row.querySelector('.official-rail-stamp')!.getBoundingClientRect();
      return Math.round(seal.left - name.right);
    });
    expect(officialSealGap).toBe(4);
    await expect(modal.getByRole('button', {name: 'Add Skills'})).toBeVisible();
    await expect(modal.getByRole('button', {name: 'Refresh Skills'})).toHaveCount(0);
    const browserSkill = modal.getByRole('button', {name: /Browser Official/});
    const browserIcon = await browserSkill.locator('img').getAttribute('src');
    await browserSkill.click();
    await expect(modal.getByRole('heading', {name: 'Browser'})).toBeVisible();
    await expect(modal.locator('.options-detail-header .skill-logo')).toHaveAttribute('src', browserIcon!);
    const officialBadge = modal.locator('.options-detail-header .official-badge');
    await expect(officialBadge).toHaveText('Official');
    await expect(officialBadge.locator('[data-icon="verified"]')).toBeVisible();
    const customSkill = modal.getByRole('button', {name: /Personal Research Custom/});
    await expect(customSkill).toBeVisible();
    await customSkill.click();
    await expect(modal.locator('.options-detail-header .options-badge')).toHaveText('Custom');

    await modal.getByRole('tab', {name: 'Model'}).click();
    const selectedModel = modal.getByLabel(/Selected model:/);
    await expect(selectedModel).toContainText('GPT-5.6 Terra');
    await expect(selectedModel).toHaveAttribute('data-tooltip-label', 'Current Model');
    await expect(selectedModel.locator('.provider-logo img')).toBeVisible();
    const selectedModelRestingBackground = await selectedModel.evaluate((node) => getComputedStyle(node).backgroundColor);
    await selectedModel.hover();
    await expect(selectedModel).not.toHaveCSS('background-color', selectedModelRestingBackground);
    await expect(modal.getByRole('searchbox', {name: 'Search company'})).toHaveAttribute('placeholder', 'Search company');
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
    await expect(modelFilterMenu.getByRole('menuitemradio')).toHaveText(['All Companies', 'Configured', 'Not Configured', 'Custom Provider']);
    await modal.getByRole('menuitemradio', {name: 'Configured', exact: true}).click();
    await expect(modal.locator('.options-rail-list .options-rail-copy strong')).toHaveText(['OpenAI']);
    await expect(modal.getByRole('heading', {name: 'OpenAI'})).toBeVisible();
    await modal.getByRole('button', {name: 'Filter models'}).click();
    await modal.getByRole('menuitemradio', {name: 'Not Configured'}).click();
    await expect(modal.locator('.options-rail-list .options-rail-copy strong')).toHaveText(['Anthropic', 'Google']);
    await expect(modal.getByRole('heading', {name: 'Anthropic'})).toBeVisible();
    await modal.getByRole('button', {name: 'Filter models'}).click();
    await modal.getByRole('menuitemradio', {name: 'All Companies'}).click();
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
      const search = dialog.querySelector('.options-search')!.getBoundingClientRect();
      const detail = dialog.querySelector('.options-detail-header')!.getBoundingClientRect();
      return Math.round(detail.top - search.top);
    });
    expect(paneAlignment).toBe(0);
    const companyLogo = modal.locator('.provider-detail-header .provider-logo img');
    await expect(companyLogo).toBeVisible();
    await expect(companyLogo).toHaveAttribute('src', /Anthropic/i);
    const modelTableStyle = await modal.locator('.model-table-wrap').evaluate((wrapper) => {
      const count = document.querySelector('.model-count')!;
      const header = wrapper.querySelector('th')!;
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
    const modelSearch = modal.getByRole('searchbox', {name: 'Search model'});
    await expect(modelSearch).toHaveAttribute('placeholder', 'Search model');
    await modelSearch.fill('Haiku');
    await expect(modal.getByRole('button', {name: 'Use Claude Haiku 4.5'})).toBeVisible();
    await expect(modal.getByRole('button', {name: 'Use Claude Sonnet 4.5'})).toHaveCount(0);
    const clearModelSearch = modal.getByRole('button', {name: 'Clear model search'});
    await expect(clearModelSearch).toHaveCSS('color', 'rgb(17, 17, 17)');
    await clearModelSearch.click();
    await expect(modelSearch).toHaveValue('');
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
    const sonnetRow = modal.getByRole('button', {name: 'Use Claude Sonnet 4.5'}).locator('xpath=ancestor::tr');
    await expect(sonnetRow.locator('td').nth(1)).toHaveText('A$4.50');
    await currencyMenu.click();
    await modal.getByRole('menuitemradio', {name: 'USD'}).click();
    await expect(modal.locator('.model-table thead')).toContainText('InputOutputCache hitCache writeContext');
    const sonnet = modal.getByRole('button', {name: 'Use Claude Sonnet 4.5'});
    await expect(sonnet).toBeVisible();
    await expect(sonnet.locator('xpath=ancestor::tr')).toContainText('$3.00$15.00$0.300$3.75');
    await sonnet.click();
    await expect(modal.locator('.options-error')).toContainText('Anthropic is not configured');
    await expect(selectedModel).toContainText('GPT-5.6 Terra');
    await expect(modal.getByRole('button', {name: 'Use Claude Sonnet 4.5'})).toBeEnabled();
    await modal.getByRole('button', {name: /Google.*1 model/}).click();
    await expect(modal.getByRole('heading', {name: 'Google'})).toBeVisible();
    await page.evaluate(() => {
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function(options) {
        (window as typeof window & {lastModelScroll?: ScrollIntoViewOptions}).lastModelScroll = options as ScrollIntoViewOptions;
        Element.prototype.scrollIntoView = original;
      };
    });
    await selectedModel.click();
    await expect(modal.getByRole('heading', {name: 'OpenAI'})).toBeVisible();
    await expect(modal.locator('.model-table tr.revealed')).toContainText('GPT-5.6 Terra');
    await expect.poll(() => page.evaluate(() => (window as typeof window & {lastModelScroll?: ScrollIntoViewOptions}).lastModelScroll)).toEqual({behavior: 'smooth', block: 'center', inline: 'nearest'});

    await modal.getByRole('tab', {name: 'Provider'}).click();
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
    await expect(modal.locator('.options-rail-list .options-rail-copy strong')).toHaveText(['Anthropic', 'OpenRouter']);
    await expect(modal.getByRole('heading', {name: 'Anthropic'})).toBeVisible();
    await modal.getByRole('button', {name: 'Filter providers'}).click();
    await modal.getByRole('menuitemradio', {name: 'All providers'}).click();
    await modal.getByRole('button', {name: 'Sort providers'}).click();
    await expect(modal.getByRole('menuitemradio', {name: 'Recommended'})).toBeVisible();
    await expect(modal.getByRole('menuitemradio', {name: 'Popularity'})).toHaveCount(0);
    await expect(modal.getByRole('menuitemradio', {name: 'Most models'})).toBeVisible();
    await modal.getByRole('menuitemradio', {name: 'Provider A–Z'}).click();
    await expect(modal.locator('.options-rail-list .options-rail-copy strong')).toHaveText(['Anthropic', 'OpenAI', 'OpenRouter']);
    await modal.getByRole('button', {name: 'Sort providers'}).click();
    await modal.getByRole('menuitemradio', {name: 'Fewest models'}).click();
    await expect(modal.locator('.options-rail-list .options-rail-copy strong')).toHaveText(['OpenRouter', 'Anthropic', 'OpenAI']);
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
    await modal.getByLabel('Custom provider base URL').fill('http://localhost:11434/v1');
    await modal.getByLabel('Custom provider API key').fill('local-secret');
    await modal.getByLabel('Custom provider models').fill('local-chat | Local Chat\nlocal-reasoner | Local Reasoner');
    await modal.getByRole('button', {name: 'Add provider'}).click();
    await expect(modal.getByRole('button', {name: /Local Lab.*2 models/})).toBeVisible();
    await expect(modal.getByRole('heading', {name: 'Local Lab'})).toBeVisible();
    await expect(modal.locator('.provider-detail-header .provider-logo img')).toBeVisible();

    await modal.getByRole('button', {name: 'Edit Local Lab'}).click();
    await expect(modal.getByRole('heading', {name: 'Edit custom provider'})).toBeVisible();
    await expect(modal.getByLabel('Custom provider base URL')).toHaveValue('http://localhost:11434/v1');
    await modal.getByLabel('Custom provider name').fill('Local Studio');
    await modal.getByLabel('Custom provider models').fill('local-chat | Studio Chat');
    await modal.getByRole('button', {name: 'Save changes'}).click();
    await expect(modal.getByRole('button', {name: /Local Studio.*1 model/})).toBeVisible();
    await expect(modal.getByRole('heading', {name: 'Local Studio'})).toBeVisible();

    await modal.getByRole('tab', {name: 'Model'}).click();
    await modal.getByRole('button', {name: 'Filter models'}).click();
    await modal.getByRole('menuitemradio', {name: 'Custom Provider'}).click();
    await expect(modal.locator('.options-rail-list .options-rail-copy strong')).toHaveText(['Local Studio']);
    await expect(modal.getByRole('heading', {name: 'Local Studio'})).toBeVisible();
    await expect(modal.locator('.provider-detail-header .provider-logo img')).toBeVisible();
    await expect(modal.getByRole('button', {name: 'Studio Chat selected'})).toBeDisabled();

    await modal.getByRole('tab', {name: 'Memory'}).click();
    await expect(modal.locator('.memory-options .option-mark')).toHaveCount(0);
    await expect(modal.locator('.memory-options .options-detail-header .options-badge')).toHaveCount(0);
    const memoryMetrics = modal.locator('.memory-top-metrics');
    await expect(memoryMetrics.getByText('Memories', {exact: true})).toBeVisible();
    await expect(memoryMetrics.getByText('Rollouts', {exact: true})).toBeVisible();
    const memoryLayout = await modal.locator('.memory-options').evaluate((node) => {
      const page = node.getBoundingClientRect();
      const metrics = node.querySelector('.memory-top-metrics')!.getBoundingClientRect();
      return {
        metricsRightGap: Math.round(page.right - metrics.right),
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
      };
    });
    expect(memoryLayout.metricsRightGap).toBeLessThanOrEqual(32);
    expect(memoryLayout.scrollHeight).toBeLessThanOrEqual(memoryLayout.clientHeight);
    const sharedLeftEdge = await modal.evaluate((node) => {
      const firstTab = node.querySelector('.options-mode button')!;
      const tabBounds = firstTab.getBoundingClientRect();
      const tabPadding = Number.parseFloat(getComputedStyle(firstTab).paddingLeft);
      const memoryTitle = node.querySelector('.memory-options h3')!.getBoundingClientRect();
      return Math.round(memoryTitle.left - (tabBounds.left + tabPadding));
    });
    expect(sharedLeftEdge).toBe(0);
    await expect(modal.getByText('Durable memories are added or removed only when you explicitly ask.')).toBeVisible();
    const chronicleToggle = modal.getByRole('switch', {name: 'Enable Chronicle'});
    await expect(chronicleToggle).toHaveAttribute('aria-checked', 'true');
    await expect(modal.getByText('Recording recent screen context', {exact: true})).toBeVisible();
    await expect(modal.getByText('Visual deduplication', {exact: false})).toBeVisible();
    await chronicleToggle.click();
    await expect(chronicleToggle).toHaveAttribute('aria-checked', 'false');
    await expect(modal.getByText('Recent screen context is off', {exact: true})).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
  });

  test('toggles integrations and edits Midas-owned skills and MCP servers', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'OPTIONS'}).click();
    const modal = page.getByRole('dialog', {name: 'Options'});

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
    await modal.getByRole('button', {name: 'Edit skill'}).click();
    await expect(modal.getByRole('heading', {name: 'Edit Skill'})).toBeVisible();
    await modal.getByLabel('Description').fill('Create polished document files.');
    await modal.getByRole('button', {name: 'Save', exact: true}).click();
    await expect(modal.getByText('Create polished document files.')).toBeVisible();
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
    await page.getByRole('button', {name: 'OPTIONS'}).click();
    const modal = page.getByRole('dialog', {name: 'Options'});
    const speechMode = modal.getByRole('switch', {name: 'Enable speech mode'});
    await expect(speechMode).toHaveAttribute('aria-checked', 'true');
    await speechMode.click();
    await expect(speechMode).toHaveAttribute('aria-checked', 'false');
    await modal.getByRole('button', {name: 'Close Options'}).click();

    const send = page.getByRole('button', {name: 'Send message'});
    await expect(send).toBeVisible();
    await expect(page.getByRole('button', {name: 'Start speech mode'})).toHaveCount(0);
    await send.hover();
    await expect(page.locator('.shared-tooltip')).toHaveText('Send');
  });
});

test.describe('design system', () => {
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
    const icons = await page.locator('.left-controls svg, .top-controls svg').evaluateAll((nodes) =>
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
  });

  test('every chrome control names itself through the shared tooltip', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Toggle chat history'}).hover();
    await expect(page.locator('.shared-tooltip')).toHaveText('History');
    await page.getByRole('button', {name: 'New Chat'}).hover();
    await expect(page.locator('.shared-tooltip')).toHaveText('New Chat');
    await page.getByRole('button', {name: 'Toggle Workspace'}).hover();
    await expect(page.locator('.shared-tooltip')).toHaveText('Workspace');
  });

  test('History and New Chat use the same icon-button hover treatment', async ({page}) => {
    await page.goto('/');
    const history = page.getByRole('button', {name: 'Toggle chat history'});
    const newChat = page.getByRole('button', {name: 'New Chat'});

    const appearance = async (button: typeof history) => button.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        width: style.width,
        height: style.height,
        radius: style.borderRadius,
        background: style.backgroundColor,
        color: style.color,
      };
    });

    expect(await appearance(history)).toEqual(await appearance(newChat));
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
    await history.hover();
    await page.waitForTimeout(180);
    const historyHover = await appearance(history);
    await newChat.hover();
    await page.waitForTimeout(180);
    expect(await appearance(newChat)).toEqual(historyHover);
  });

  test('right-side controls use the same aligned icon-button treatment', async ({page}) => {
    await page.goto('/');
    const history = page.getByRole('button', {name: 'Toggle chat history'});
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
    await expect(workspace).toHaveCSS('border-radius', await history.evaluate((node) => getComputedStyle(node).borderRadius));
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
    // All four icon buttons share the 26px line; the text title retains its
    // optical 25px line.
    expect(boxes.map((box) => box.centre)).toEqual([26, 26, 26, 26, 25]);
    const historyGlyph = await page.locator('[data-icon="history"]').boundingBox();
    const newChatGlyph = await page.locator('[data-icon="new-chat"]').boundingBox();
    expect(historyGlyph!.y + historyGlyph!.height / 2).toBe(26);
    expect(newChatGlyph!.y + newChatGlyph!.height / 2).toBe(26);
    const rightGlyphCentres = await page.locator('.top-controls button > svg').evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return rect.top + rect.height / 2;
      }));
    for (const centre of rightGlyphCentres) expect(centre).toBe(26);

    // The artwork shrinks inside unchanged 16px SVG boxes: History moves two
    // Retina pixels inward per edge, while New Chat is two pixels smaller
    // overall. Their centres stay fixed.
    const insetOutlines = await page.locator('[data-icon="history"] > circle').evaluateAll((nodes) => nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return {top: rect.top, bottom: rect.bottom};
    }));
    expect(insetOutlines[0]).toEqual({top: 20.5, bottom: 31.5});
    // On macOS the row starts clear of the traffic lights, which end at 72px.
    const inset = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--chrome-inset').trim());
    const leftControls = boxes.slice(0, 2);
    if (inset !== '0px') expect(leftControls[0].left).toBeGreaterThanOrEqual(72);
    // A small optical gap preserves equal visible spacing after matching both
    // outlines to the wider native traffic lights.
    expect(leftControls[1].left - (leftControls[0].left + leftControls[0].width)).toBeCloseTo(1.5);
  });

  test('shows one neutral traffic-light set while the macOS window is inactive', async ({page}) => {
    await page.goto('/');
    const isMacLayout = await page.evaluate(() => document.documentElement.dataset.platform === 'darwin');
    const inactiveSet = page.locator('.inactive-traffic-lights.visible');

    for (let cycle = 0; cycle < 3; cycle += 1) {
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      const dots = inactiveSet.locator('i');
      await expect(dots).toHaveCount(3);
      if (isMacLayout) await expect(dots.first()).toBeVisible();

      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(inactiveSet).toHaveCount(0);
    }
  });

});

test.describe('conversation', () => {
  test('lays out user and assistant messages differently and reveals actions on hover', async ({page}) => {
    await page.goto('/');
    await send(page, 'Test the assembled chat');

    const user = page.locator('.message:not(.assistant)').first();
    const assistant = page.locator('.message.assistant').first();
    await expect(user).toContainText('Test the assembled chat');
    await expect(assistant).toContainText(/assembled Midas chat surface/, {timeout: 4000});

    // The user's turn is a right-aligned pill; the assistant's is full width.
    const bubble = await user.locator('.message-content').evaluate((node) => {
      const style = getComputedStyle(node);
      return {radius: style.borderRadius, background: style.backgroundColor};
    });
    expect(bubble.radius).toBe('20px');
    expect(bubble.background).toBe('rgb(232, 232, 232)');
    await expect(assistant.locator('.message-content')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

    // Actions are hidden until the turn is hovered.
    const actions = user.locator('.message-actions');
    await expect(actions).toHaveCSS('opacity', '0');
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
    await expect(assistant).toContainText('Options → Provider');
  });

  test('replaces raw authentication failures with an actionable provider message', async ({page}) => {
    await page.goto('/');
    await send(page, '__demo_auth_failure__');
    const assistant = page.locator('.message.assistant').first();
    await expect(assistant).toContainText('The selected provider rejected its saved API key.');
    await expect(assistant).toContainText('Options → Provider');
    await expect(assistant).not.toContainText('Missing Authentication header');
  });

  test('does not list the main agent response as a delegated task', async ({page}) => {
    await page.goto('/');
    await send(page, 'timing');
    await expect(summaryCard(page).getByText('Delegated work appears here.')).toBeVisible();
    await expect(summaryCard(page).getByText('Prepare the response')).toHaveCount(0);
  });

  test('reports how long the agent worked', async ({page}) => {
    await page.goto('/');
    await send(page, 'timing');
    await expect(page.locator('.agent-activity-heading')).toContainText(/Work(ing|ed) for \d+s/);
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

  test('shows a time beneath assistant messages too', async ({page}) => {
    await page.goto('/');
    await send(page, 'show timestamps');
    const assistant = page.locator('.message.assistant').first();
    const time = assistant.locator('.message-time');
    await expect(time).toHaveText(/^\d{1,2}:\d{2}\s[AP]M$/, {timeout: 4000});
    await expect(time).toHaveCSS('opacity', '0');
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
    await titleInput.fill('Renamed thread');
    await page.keyboard.press('Enter');
    await expect(page.locator('.conversation-title-bar button')).toHaveText('Renamed thread');
  });

  test('centres the title within the available titlebar when panels toggle', async ({page}) => {
    await page.goto('/');
    await send(page, 'centred title');
    const title = page.locator('.conversation-title-bar button');
    const centreOffset = async () => title.evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      const workspace = document.querySelector('.workspace-drawer.open')?.getBoundingClientRect();
      const history = document.querySelector('.history-drawer.open')?.getBoundingClientRect();
      const availableLeft = history?.right ?? 0;
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

  test('the Summary control returns only once the Workspace has finished closing', async ({page}) => {
    await page.goto('/');
    await send(page, 'latch');
    const summaryButton = page.getByRole('button', {name: 'Toggle Summary'});

    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    await expect(summaryButton).toHaveCount(0);

    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    // Still gone part-way through the 440ms slide, so it cannot flash over the
    // panel while the panel is still crossing that spot.
    await page.waitForTimeout(200);
    await expect(summaryButton).toHaveCount(0);
    await expect(summaryButton).toBeVisible({timeout: 2000});
  });

  test('opening a panel never reflows the conversation column away from centre', async ({page}) => {
    await page.goto('/');
    await send(page, 'stability');
    const column = page.locator('.conversation-column');
    const before = await column.boundingBox();

    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    await expect(workspaceDrawer(page)).toHaveClass(/open/);
    await page.waitForTimeout(190);
    const midway = await column.boundingBox();
    await page.waitForTimeout(410);
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
  });
});

test.describe('history drawer', () => {
  test('opens as a sheet, groups by recency, and closes again', async ({page}) => {
    await page.goto('/');
    const drawer = historyDrawer(page);
    await expect(drawer).not.toHaveClass(/open/);

    await page.getByRole('button', {name: 'Toggle chat history'}).click();
    await expect(drawer).toHaveClass(/open/);
    const historyButton = page.getByRole('button', {name: 'Toggle chat history'});
    await expect(historyButton).not.toHaveClass(/active/);
    await page.mouse.move(400, 200);
    await expect(historyButton).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(historyButton).toHaveCSS('color', 'rgb(160, 160, 160)');
    await expect(drawer.getByRole('heading', {name: 'History'})).toBeVisible();
    await expect(drawer.locator('.history-group-toggle')).not.toHaveCount(0);

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

    await page.getByRole('button', {name: 'Toggle chat history'}).click();
    await expect(drawer).not.toHaveClass(/open/);
  });

  test('collapses a group, and renames a chat from its row menu', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Toggle chat history'}).click();
    const drawer = historyDrawer(page);

    const group = drawer.locator('.history-group-toggle').first();
    await group.click();
    await expect(group).toHaveClass(/collapsed/);
    await group.click();
    await expect(group).not.toHaveClass(/collapsed/);

    const row = drawer.locator('.history-row').first();
    await row.hover();
    await row.getByRole('button', {name: /More actions/}).click();
    await page.getByRole('menuitem', {name: 'Rename'}).click();
    await page.locator('.history-edit input').fill('Renamed from the drawer');
    await page.keyboard.press('Enter');
    await expect(drawer.getByText('Renamed from the drawer')).toBeVisible();
  });

  test('deletes a chat from its row menu', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Toggle chat history'}).click();
    const drawer = historyDrawer(page);
    const before = await drawer.locator('.history-row').count();

    const row = drawer.locator('.history-row').first();
    await row.hover();
    await row.getByRole('button', {name: /More actions/}).click();
    await page.getByRole('menuitem', {name: 'Delete'}).click();
    await expect(drawer.locator('.history-row')).toHaveCount(before - 1);
  });

  test('resizes with the keyboard within its bounds', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Toggle chat history'}).click();
    const handle = page.getByRole('button', {name: 'Resize History'});
    await handle.focus();
    await page.keyboard.press('ArrowRight');
    await expect(historyDrawer(page)).not.toHaveCSS('width', '240px');
  });
});

test.describe('workspace drawer', () => {
  test('shows typed tabs, switches, expands and closes them', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    const drawer = workspaceDrawer(page);
    await expect(drawer).toHaveClass(/open/);
    await drawer.getByRole('button', {name: 'Create a document'}).click();

    const tab = drawer.locator('.tab').first();
    await expect(tab).toHaveClass(/active/);
    await expect(tab).toHaveCSS('width', '156px');
    await expect(drawer.locator('.draft-page')).toBeVisible();

    await page.getByRole('button', {name: 'Expand Workspace'}).click();
    await expect(drawer).toHaveClass(/expanded/);
    await expect(page.locator('main')).toHaveClass(/workspace-expanded/);
    await page.getByRole('button', {name: 'Minimise Workspace'}).click();
    await expect(drawer).not.toHaveClass(/expanded/);

    await tab.hover();
    await tab.getByRole('button', {name: /^Close /}).click();
    await expect(drawer.locator('.tab')).toHaveCount(0);
  });

  test('offers the launcher when nothing is open, and opens a typed view', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    const drawer = workspaceDrawer(page);

    await expect(drawer.locator('.workspace-launcher')).toBeVisible();
    await drawer.getByRole('button', {name: 'Create a presentation'}).click();
    await expect(drawer.locator('.draft-slide')).toBeVisible();
  });

  test('header actions ride the panel rather than appearing before it lands', async ({page}) => {
    await page.goto('/');
    const action = page.locator('.workspace-header-action').first();
    await expect(action).toHaveCSS('visibility', 'hidden');
    await page.getByRole('button', {name: 'Toggle Workspace'}).click();
    await expect(action).toHaveCSS('visibility', 'visible');
    if (await page.locator('.workspace-header-action').count() === 1) {
      await workspaceDrawer(page).getByRole('button', {name: 'Create a document'}).click();
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
    await expand.click();
    await expect(workspaceDrawer(page)).toHaveClass(/expanded/);
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
    await page.setViewportSize({width: 700, height: 720});
    await page.goto('/');
    await send(page, 'first timeline turn');
    await expect(page.locator('.message.assistant').first()).toContainText(/assembled Midas chat surface/, {timeout: 4000});
    await send(page, 'second timeline turn');
    const rail = page.locator('.timeline-rail');
    await expect(rail).toBeVisible();
    const positions = await page.evaluate(() => {
      const rail = document.querySelector('.timeline-rail')!.getBoundingClientRect();
      const message = document.querySelector('.message')!.getBoundingClientRect();
      return {railRight: Math.round(rail.right), messageLeft: Math.round(message.left)};
    });
    expect(positions.railRight).toBeLessThan(positions.messageLeft);
  });

  test('below the split-layout width both drawers become overlays', async ({page}) => {
    await page.setViewportSize({width: 900, height: 720});
    await page.goto('/');

    await page.getByRole('button', {name: 'Toggle chat history'}).click();
    await expect(historyDrawer(page)).toHaveCSS('position', 'fixed');
    await expect(page.getByRole('button', {name: 'Resize History'})).toBeHidden();

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
