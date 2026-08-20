<script module lang="ts">
  import type {
    BrowserExtensionDto as CachedExtensionDto,
    ChronicleStatusDto as CachedChronicleDto,
    GeneralSettingsDto as CachedGeneralDto,
    McpServerDto as CachedMcpDto,
    MemoryStatusDto as CachedMemoryDto,
    ModelDto as CachedModelDto,
    ProviderDto as CachedProviderDto,
    PluginDto as CachedPluginDto,
    SkillDto as CachedSkillDto,
  } from '@flareai/protocol';

  /**
   * The last answers Settings had, kept outside the component.
   *
   * The page is destroyed when it closes, so every open used to wait on eight
   * requests before showing a single row — servers, skills, models, providers
   * and four status reads. Reopening now paints what it knew and corrects it
   * behind the panel. Nothing here is persisted: it lasts as long as the
   * window, which is as long as the answers are worth trusting.
   */
  const settingsSnapshot: {
    loaded: boolean;
    mcpServers: CachedMcpDto[];
    skills: CachedSkillDto[];
    plugins: CachedPluginDto[];
    models: CachedModelDto[];
    providers: CachedProviderDto[];
    memory: CachedMemoryDto | null;
    chronicle: CachedChronicleDto | null;
    general: CachedGeneralDto | null;
    extensionStatus: CachedExtensionDto | null;
  } = {
    loaded: false,
    mcpServers: [],
    skills: [],
    plugins: [],
    models: [],
    providers: [],
    memory: null,
    chronicle: null,
    general: null,
    extensionStatus: null,
  };
</script>

<script lang="ts">
  import {onDestroy, onMount, tick, type ComponentProps} from 'svelte';
  import {readableError} from '../../shared/errors';
  import {scrollFade} from '../../shared/scrollFade';
  import type {AppUpdateDto, AppVersionDto, BrowserExtensionDto, ChronicleStatusDto, DiscoveredMcpDto, DiscoveredMcpGroupDto, DiscoveredSkillDto, DiscoveredSkillGroupDto, GeneralSettingsDto, MarketplacePluginDto, McpRegistryEntryDto, McpServerDto, MemoryStatusDto, ModelDto, ModelMetadataDto, ModelRole, ModelRolesDto, NotificationKind, PluginDto, PluginMarketplaceDto, ProviderDto, ReasoningEffort, SkillDto, SkillRegistryEntryDto, SystemPermissionKind, SystemPermissionStatus, AppPermissionKind} from '@flareai/protocol';
  import {SUPPORTED_LANGUAGES} from '@flareai/protocol';
  import {flareaiApi} from '../../api/flareai';
  import {applyTheme, type ThemeMode} from '../../shared/theme';
  import {activeLocale, applyLanguage, plural, t, translate, type MessageKey} from '../../../i18n';
  import {modelCompanyId, providerName} from '../../shared/options/providerBrands';
  import Icon from '../../shared/components/Icon.svelte';
  import Menu from '../../shared/components/Menu.svelte';
  import ProviderLogo from '../../shared/components/ProviderLogo.svelte';
  import HubTab from './HubTab.svelte';
  import DriveTab from './DriveTab.svelte';
  import BrowserTab from './BrowserTab.svelte';

  export let onClose: () => void;
  export let onGeneralChange: (settings: GeneralSettingsDto) => void = () => {};

  type IconName = ComponentProps<Icon>['name'];
  /** Which of Chronicle's two source panels a control belongs to. */
  type ChronicleList = 'apps' | 'sites';
  type Mode = 'general' | 'hub' | 'drive' | 'browser' | 'plugins' | 'mcp' | 'skills' | 'model' | 'provider' | 'memory';
  /** The tab to open on. Empty means the page opens where it always has;
   * the composer's Plugins button is what names one, so pressing it lands on
   * Plugins rather than on General with a tab still to find. */
  export let initialMode: Mode | '' = '';
  type RailMenu = 'filter' | 'sort';
  type ModelKind = 'text' | 'image' | 'video' | 'audio' | 'embedding';
  type Currency = Exclude<GeneralSettingsDto['currency'], null>;

  const api = flareaiApi();
  /** How much of a marketplace arrives at once, and how much more each time
   * the list is scrolled to its end. */
  const CATALOG_PAGE = 30;
  const SKILL_REGISTRY_PAGE = 15;
  /** How close to the end counts as the end — a list asks for the next page
   * while the last rows are still coming into view, so the rows are there by
   * the time the scroll reaches them. */
  const LOAD_MORE_MARGIN = 160;

  /** Scroll handler shared by every marketplace list: near the bottom, and not
   * already fetching, ask for the next page. */
  function onMarketplaceScroll(event: Event, loadMore: () => void): void {
    const list = event.currentTarget as HTMLElement;
    if (list.scrollTop + list.clientHeight >= list.scrollHeight - LOAD_MORE_MARGIN) loadMore();
  }

  let mode: Mode = initialMode || 'general';
  let settled = false;
  let search = '';
  /** The rail's filter over the tab list, kept apart from `search`, which is
   * the per-tab list filter inside the content column. */
  let navSearch = '';
  // Whatever the last visit learned, on screen before the first request.
  let mcpServers: McpServerDto[] = settingsSnapshot.mcpServers;
  let skills: SkillDto[] = settingsSnapshot.skills;
  let plugins: PluginDto[] = settingsSnapshot.plugins;
  let models: ModelDto[] = settingsSnapshot.models;
  let providers: ProviderDto[] = settingsSnapshot.providers;
  let chronicle: ChronicleStatusDto | null = settingsSnapshot.chronicle;
  let memory: MemoryStatusDto | null = settingsSnapshot.memory;
  let general: GeneralSettingsDto | null = settingsSnapshot.general;
  let extensionStatus: BrowserExtensionDto | null = settingsSnapshot.extensionStatus;

  function openExtensionInstall(): void {
    void api.extension.openInstall().catch(() => {});
  }
  let updatingMemory = false;
  let updatingChronicle = false;
  /* Per-panel view state: what is being typed, whether the add field and the
     filter field are open, and whether the rows are shown alphabetically. None
     of it is stored — the saved lists keep the order things were added in. */
  /* Only the websites panel types its entries; an app comes from the picker. */
  let pickingApp = false;
  let chronicleDraft = '';
  let chronicleAdding = false;
  let chronicleFiltering = {apps: false, sites: false};
  let chronicleQuery = {apps: '', sites: ''};
  let forgetting = '';
  let updatingTheme = false;
  let updatingSpeechMode = false;
  let updatingAdvancedMode = false;
  let updatingAutoStop = false;
  let updatingTime = false;
  let updatingLocation = false;
  let permissionStatuses: Partial<Record<SystemPermissionKind, SystemPermissionStatus>> = {};
  let updatingPermission: SystemPermissionKind | '' = '';
  let askingPermission: SystemPermissionKind | '' = '';
  let askingAllPermissions = false;
  let updatingAppPermissions = false;
  /** The kind whose switch is in flight, or 'all' for the master one. */
  let updatingNotifications: NotificationKind | 'all' | '' = '';
  /** Set when a test notification found the OS will not show one, so the row
   * can say why nothing appeared instead of looking broken. */
  let notificationsUnsupported = false;
  let locating = false;
  let locationError = '';
  let selectedMcp = '';
  let selectedSkill = '';
  let selectedPlugin = '';
  let selectedModelProvider = '';
  let selectedCredentialProvider = '';
  let credentialKey = '';
  let savingCredential = false;
  let addingCustomProvider = false;
  let editingCustomProviderId = '';
  let customProviderName = '';
  let customProviderUrl = '';
  let customProviderKey = '';
  let customProviderModels = '';
  let customProviderLogoDataUrl = '';
  let discoveringModels = false;
  /** The address the selected local runtime will be set up on — its default
   * port until the user says otherwise. */
  let runtimeUrl = '';
  /** The model list is a result, not a question — it opens for editing only
   * when asked for, or when there is nothing to show. */
  let modelsExpanded = false;
  /** Only a first open has nothing to show; later ones refresh in place. */
  let loading = !settingsSnapshot.loaded;
  /**
   * Kept in step with the panel rather than written once on load: a key added
   * or a server toggled changes these lists after the fetch, and the next open
   * should show what the last one ended with.
   */
  $: Object.assign(settingsSnapshot, {
    mcpServers,
    skills,
    plugins,
    models,
    providers,
    memory,
    chronicle,
    general,
    extensionStatus,
  });
  let adding: 'mcp' | 'skills' | 'plugins' | null = null;
  let integrationSaving = false;
  let mcpUpdatingIds = new Set<string>();
  let editingIntegration = false;
  let customMcpId = '';
  let customMcpName = '';
  let customMcpDescription = '';
  let customMcpTransport: 'stdio' | 'streamable-http' = 'stdio';
  let customMcpTarget = '';
  let customMcpArgs = '';
  let customMcpEnvironment = '';
  let customMcpCwd = '';
  let customSkillOriginalName = '';
  let customSkillName = '';
  let customSkillDescription = '';
  let customSkillInstructions = '';
  let modelFilter = 'all';
  /** Stays false until the user picks a model filter themselves, so the rail can keep
   * following whether any provider is configured. */
  let modelFilterChosen = false;
  let modelSort = 'recommended';
  let mcpFilter = 'all';
  let mcpSort = 'recommended';
  let skillFilter = 'all';
  let skillSort = 'recommended';
  let pluginFilter = 'all';
  let pluginSort = 'recommended';
  let modelRoles: ModelRolesDto | null = null;
  /** The role the model directory is open for. Empty is the tab's own view: the
   * roles and what each one runs. Picking a model closes the directory again,
   * so this is the only thing that says which of the two is on screen. */
  let browsingRole: ModelRole | '' = '';
  let assigningRole = '';
  let providerFilter = 'all';
  let providerSort = 'default';
  let openRailMenu: RailMenu | null = null;
  let skillAddMenuOpen = false;
  let mcpAddMenuOpen = false;
  let pluginAddMenuOpen = false;
  let browsingMcpRegistry = false;
  /** The plugin marketplace, which the storefront tool opens over the detail
   * column the way the MCP registry does. */
  let browsingPluginMarketplace = false;
  let pluginMarketplaces: PluginMarketplaceDto[] = [];
  let pluginCatalog: MarketplacePluginDto[] = [];
  let pluginCatalogQuery = '';
  let pluginCatalogSearching = false;
  /** The catalog arrives whole, so paging it is a matter of how much of it is
   * on screen — one page more each time the list is scrolled to its end. */
  let pluginCatalogVisible = CATALOG_PAGE;
  let pluginCatalogError = '';
  let pluginCatalogTimer: ReturnType<typeof setTimeout> | undefined;
  let installingPluginId = '';
  let pluginMarketplaceSource = '';
  let addingPluginMarketplace = false;
  let pluginFolderInput: HTMLInputElement;
  let discoveringMcp = false;
  let discoveredMcpGroups: DiscoveredMcpGroupDto[] = [];
  let mcpDiscoverySearching = false;
  let mcpDiscoveryError = '';
  let adoptingMcpId = '';
  let collapsedMcpGroups = new Set<string>();
  let mcpRegistryQuery = '';
  let mcpRegistryResults: McpRegistryEntryDto[] = [];
  let mcpRegistryFeatured: McpRegistryEntryDto[] = [];
  /** Registry cursors: what the next page of each list continues from, empty
   * once the registry has nothing further. */
  let mcpRegistryCursor = '';
  let mcpRegistryFeaturedCursor = '';
  let mcpRegistryLoadingMore = false;
  let mcpRegistryPreloaded = false;
  let mcpRegistrySearching = false;
  let mcpRegistryError = '';
  let mcpRegistryTimer: ReturnType<typeof setTimeout> | undefined;
  let mcpRegistryRequest = 0;
  let installingMcpRegistryId = '';
  let installingSkill = false;
  let discoveringSkills = false;
  let discoveredGroups: DiscoveredSkillGroupDto[] = [];
  let discoverySearching = false;
  let discoveryError = '';
  let adoptingPath = '';
  let skillRegistryQuery = '';
  let registryResults: SkillRegistryEntryDto[] = [];
  /** skills.sh pages by list length rather than by offset, so the next page is
   * the same search asked for more rows. */
  let registryLimit = SKILL_REGISTRY_PAGE;
  let registryExhausted = false;
  let registryLoadingMore = false;
  let registrySearching = false;
  let registryError = '';
  let registryTimer: ReturnType<typeof setTimeout> | undefined;
  let registryRequest = 0;
  let installingRegistryId = '';
  let skillFolderInput: HTMLInputElement;
  let collapsedGroups = new Set<string>();
  let currency: Currency = 'USD';
  let currencyRates: Partial<Record<Currency, number>> = {USD: 1};
  let appVersion: AppVersionDto | null = null;
  let update: AppUpdateDto | null = null;
  let checkingUpdate = false;
  let updatingLanguage = false;
  let modelMetadata: Record<string, ModelMetadataDto> = {};
  let error = '';

  $: modelFilterOptions = [{value: 'default', label: $t('reasoning.default')}, {value: 'all', label: $t('settings.allCompanies')}, {value: 'custom', label: $t('settings.customProvider')}, {value: 'kind-text', label: $t('settings.textModels')}, {value: 'kind-image', label: $t('settings.imageModels')}, {value: 'kind-video', label: $t('settings.videoModels')}, {value: 'kind-audio', label: $t('settings.speechModels')}, {value: 'kind-embedding', label: $t('settings.embeddingModels')}];
  /** Every role a model can be given, in the order the expanded row lists them.
   * `main` is what the agent answers with; `task` and `judge` fall back to it,
   * so only those two can be set back to following it. */
  /* `label` is what the UI shows; `job` is the long form the screen-reader
     labels and tooltips still spell out. */
  $: MODEL_ROLES = [
    {value: 'main' as ModelRole, label: $t('settings.roleMain'), job: $t('settings.roleMainJob'), hint: $t('settings.roleMainHint'), followsMain: false, kind: 'text' as ModelKind},
    {value: 'task' as ModelRole, label: $t('settings.roleTask'), job: $t('settings.roleTaskJob'), hint: $t('settings.roleTaskHint'), followsMain: true, kind: 'text' as ModelKind},
    {value: 'judge' as ModelRole, label: $t('settings.roleJudge'), job: $t('settings.roleJudgeJob'), hint: $t('settings.roleJudgeHint'), followsMain: true, kind: 'text' as ModelKind},
    {value: 'compaction' as ModelRole, label: $t('settings.roleCompaction'), job: $t('settings.roleCompactionJob'), hint: $t('settings.roleCompactionHint'), followsMain: true, kind: 'text' as ModelKind},
    {value: 'speech' as ModelRole, label: $t('settings.roleSpeech'), job: $t('settings.roleSpeechJob'), hint: $t('settings.roleSpeechHint'), followsMain: false, kind: 'audio' as ModelKind},
    {value: 'image' as ModelRole, label: $t('settings.roleImage'), job: $t('settings.roleImageJob'), hint: $t('settings.roleImageHint'), followsMain: false, kind: 'image' as ModelKind},
    {value: 'video' as ModelRole, label: $t('settings.roleVideo'), job: $t('settings.roleVideoJob'), hint: $t('settings.roleVideoHint'), followsMain: false, kind: 'video' as ModelKind},
  ];
  $: providerFilterOptions = [{value: 'all', label: $t('settings.allProviders')}, {value: 'configured', label: $t('settings.configured')}, {value: 'unconfigured', label: $t('settings.notConfigured')}];
  $: mcpFilterOptions = [{value: 'all', label: $t('settings.allMcp')}, {value: 'enabled', label: $t('settings.enabled')}, {value: 'disabled', label: $t('settings.disabled')}, {value: 'connected', label: $t('drive.stateConnected')}, {value: 'official', label: $t('settings.official')}, {value: 'custom', label: $t('settings.custom')}];
  $: skillFilterOptions = [{value: 'all', label: $t('hub.railAll')}, {value: 'enabled', label: $t('settings.enabled')}, {value: 'disabled', label: $t('settings.disabled')}, {value: 'official', label: $t('settings.official')}, {value: 'custom', label: $t('settings.custom')}];
  $: modelSortOptions = [{value: 'recommended', label: $t('hub.sortRecommended')}, {value: 'name-asc', label: $t('settings.sortCompanyAsc')}, {value: 'name-desc', label: $t('settings.sortCompanyDesc')}, {value: 'models-desc', label: $t('settings.sortMostModels')}, {value: 'models-asc', label: $t('settings.sortFewestModels')}];
  $: providerSortOptions = [{value: 'default', label: $t('reasoning.default')}, {value: 'recommended', label: $t('hub.sortRecommended')}, {value: 'name-asc', label: $t('settings.sortProviderAsc')}, {value: 'name-desc', label: $t('settings.sortProviderDesc')}, {value: 'models-desc', label: $t('settings.sortMostModels')}, {value: 'models-asc', label: $t('settings.sortFewestModels')}];
  $: mcpSortOptions = [{value: 'recommended', label: $t('hub.sortRecommended')}, {value: 'name-asc', label: $t('settings.sortServerAsc')}, {value: 'name-desc', label: $t('settings.sortServerDesc')}];
  $: pluginFilterOptions = [{value: 'all', label: $t('hub.railAll')}, {value: 'enabled', label: $t('settings.enabled')}, {value: 'disabled', label: $t('settings.disabled')}, {value: 'conflicts', label: $t('settings.pluginFilterConflicts')}];
  $: pluginSortOptions = [{value: 'recommended', label: $t('hub.sortRecommended')}, {value: 'name-asc', label: $t('settings.sortPluginAsc')}, {value: 'name-desc', label: $t('settings.sortPluginDesc')}];
  $: skillSortOptions = [{value: 'recommended', label: $t('hub.sortRecommended')}, {value: 'updated-desc', label: $t('settings.lastEdited')}, {value: 'name-asc', label: $t('settings.sortSkillAsc')}, {value: 'name-desc', label: $t('settings.sortSkillDesc')}];
  $: MODE_HEADERS = {
    general: {title: $t('settings.tabGeneral'), description: $t('settings.generalBlurb')},
    hub: {title: $t('workspace.hub'), description: $t('settings.hubBlurb')},
    drive: {title: $t('workspace.drive'), description: $t('settings.driveBlurb')},
    browser: {title: $t('settings.tabBrowser'), description: $t('settings.browserBlurb')},
    plugins: {title: $t('settings.tabPlugins'), description: $t('settings.pluginsBlurb')},
    mcp: {title: $t('settings.tabMcp'), description: $t('settings.mcpBlurb')},
    skills: {title: $t('settings.tabSkills'), description: $t('settings.skillsBlurb')},
    // The tab is two views, and each is asking for something different: the
    // roles are a setting, the directory is a choice.
    model: {title: $t('settings.tabModels'), description: browsingRole ? $t('settings.modelsBlurb') : $t('settings.rolesBlurb')},
    provider: {title: $t('settings.tabProviders'), description: $t('settings.providersBlurb')},
    memory: {title: $t('settings.tabMemory'), description: $t('settings.memoryBlurb')},
  } as Record<Mode, {title: string; description: string}>;
  const recommendedModelCompanies = ['openai', 'anthropic', 'google', 'xai', 'meta', 'deepseek', 'mistral', 'qwen', 'moonshotai', 'minimax', 'cohere', 'perplexity', 'ai21'];
  const currencies: Currency[] = ['USD', 'AUD', 'EUR', 'GBP', 'SGD', 'JPY'];
  const currencySymbols: Record<Currency, string> = {USD: '$', AUD: 'A$', EUR: '€', GBP: '£', SGD: 'S$', JPY: '¥'};

  $: anyProviderConfigured = providers.some((provider) => provider.configured);
  /** Default the model rail to configured companies once a provider exists, and drop back
   * to every company when the last one goes away (a filter showing nothing is useless). */
  $: if (!modelFilterChosen) modelFilter = anyProviderConfigured ? 'default' : 'all';
  $: if (modelFilter === 'default' && !anyProviderConfigured) {
    modelFilter = 'all';
    modelFilterChosen = false;
  }
  $: modelDefaultFilter = anyProviderConfigured ? 'default' : 'all';

  $: query = search.trim().toLocaleLowerCase();
  $: visibleMcp = selectMcpServers(mcpServers, query, mcpFilter, mcpSort);
  $: visibleSkills = selectSkills(skills, query, skillFilter, skillSort);
  $: visiblePlugins = selectPlugins(plugins, query, pluginFilter, pluginSort);
  /** The role the directory is open for. Opening it sets the rail's filter to
   * that role's kind, so what the list holds back is on screen. */
  $: browsingRoleOption = MODEL_ROLES.find((role) => role.value === browsingRole) ?? null;
  $: modelCompanies = groupModels(models, providers, query, modelFilter, modelSort);
  $: visibleProviders = selectProviders(providers, query, providerFilter, providerSort);
  $: railEmpty = mode === 'mcp' ? visibleMcp.length === 0 : mode === 'skills' ? visibleSkills.length === 0 : mode === 'plugins' ? visiblePlugins.length === 0 : mode === 'model' ? modelCompanies.length === 0 : visibleProviders.length === 0;
  $: languageOptions = SUPPORTED_LANGUAGES.map(({value, label}) => ({value, label}));
  $: autoStopOptions = [
    ...[3, 6, 10, 20].map((seconds) => ({value: String(seconds), label: plural('settings.seconds', seconds)})),
    {value: 'off', label: $t('settings.never')},
  ];
  $: buildDetailText = appVersion
    ? `${appVersion.platform}${appVersion.electron ? ` · Electron ${appVersion.electron}` : ''}${appVersion.packaged ? '' : ' · development build'}`
    : $t('settings.readingBuild');
  $: versionDetailText = update?.status === 'error' && update.message
    ? `${buildDetailText} · ${update.message}`
    : buildDetailText;
  $: updateSummaryText = checkingUpdate
    ? $t('settings.checkingUpdates')
    : !update
      ? '—'
      : update.status === 'downloading'
        ? $t('settings.downloadingUpdate')
        : update.status === 'error'
          ? $t('settings.checkFailed')
          : update.latest && update.latest !== update.version
            ? $t('settings.updateAvailable', {version: update.latest})
            : $t('settings.latestVersion');
  $: currencyOptions = currencies.filter((code) => currencyRates[code] !== undefined).map((code) => ({value: code, label: code}));
  $: if (!visibleMcp.some((item) => item.id === selectedMcp)) selectedMcp = visibleMcp[0]?.id ?? '';
  $: if (!visibleSkills.some((item) => item.name === selectedSkill)) selectedSkill = visibleSkills[0]?.name ?? '';
  $: if (!visiblePlugins.some((item) => item.id === selectedPlugin)) selectedPlugin = visiblePlugins[0]?.id ?? '';
  $: if (!modelCompanies.some((item) => item.id === selectedModelProvider)) {
    const selectedModel = models.find((item) => item.selected);
    const activeCompany = selectedModel ? modelCompanyId(selectedModel) : '';
    selectedModelProvider = modelCompanies.find((item) => item.id === activeCompany)?.id ?? modelCompanies[0]?.id ?? '';
  }
  $: if (!visibleProviders.some((item) => item.id === selectedCredentialProvider)) selectedCredentialProvider = visibleProviders[0]?.id ?? '';
  $: mcp = mcpServers.find((item) => item.id === selectedMcp);
  $: skill = skills.find((item) => item.name === selectedSkill);
  $: plugin = plugins.find((item) => item.id === selectedPlugin);
  $: modelCompany = modelCompanies.find((item) => item.id === selectedModelProvider);
  $: credentialProvider = providers.find((item) => item.id === selectedCredentialProvider);
  // Follows the selection, including the automatic one made when the rail is
  // first filled. Typing in the field does not disturb it.
  $: runtimeUrl = credentialProvider?.baseUrl ?? '';
  $: visibleCompanyModels = modelCompany?.models ?? [];
  $: activeRailSubject = mode === 'mcp' ? $t('settings.railMcp') : mode === 'skills' ? $t('settings.railSkills') : mode === 'plugins' ? $t('settings.railPlugins') : mode === 'model' ? $t('settings.railModels') : $t('settings.railProviders');
  /** What the search field says it searches. Singular where the rail's filter
   * and sort menus name the same thing in the plural — "Search MCP server"
   * reads as one server's worth of rows, which is what typing there narrows
   * to. */
  $: searchRailSubject = mode === 'mcp' ? $t('settings.searchRailMcp') : mode === 'skills' ? $t('settings.railSkills') : mode === 'plugins' ? $t('settings.searchRailPlugin') : mode === 'model' ? $t('settings.searchRailModel') : $t('settings.searchRailProvider');
  $: activeRailFilter = mode === 'mcp' ? mcpFilter : mode === 'skills' ? skillFilter : mode === 'plugins' ? pluginFilter : mode === 'model' ? modelFilter : providerFilter;
  $: activeRailSort = mode === 'mcp' ? mcpSort : mode === 'skills' ? skillSort : mode === 'plugins' ? pluginSort : mode === 'model' ? modelSort : providerSort;
  $: activeRailDefaultSort = mode === 'provider' ? 'default' : 'recommended';
  $: activeRailDefaultFilter = mode === 'model' ? modelDefaultFilter : 'all';
  $: activeRailFilterOptions = mode === 'mcp' ? mcpFilterOptions : mode === 'skills' ? skillFilterOptions : mode === 'plugins' ? pluginFilterOptions : mode === 'model' ? modelFilterOptions : providerFilterOptions;
  $: activeRailSortOptions = mode === 'mcp' ? mcpSortOptions : mode === 'skills' ? skillSortOptions : mode === 'plugins' ? pluginSortOptions : mode === 'model' ? modelSortOptions : providerSortOptions;
  $: modeHeader = MODE_HEADERS[mode];
  /** Basic mode until the setting says otherwise, including while it loads —
   * a tab that appears and then vanishes is worse than one that arrives. */
  $: advanced = general?.advancedMode ?? false;
  /* Basic mode drops the Model, Memory, MCP and Skills tabs; a page left parked
     on one that no longer exists would read as Settings having gone blank.
     Plugins is the surface that stays: what MCP and Skills configure piecemeal,
     a plugin brings as one thing, and that is the whole of the simple view. */
  $: if (!advanced && (mode === 'model' || mode === 'memory' || mode === 'mcp' || mode === 'skills'))
    mode = 'plugins';
  /* One icon per tab, all from the shared set at one size, so the rail reads as
     a single strip rather than eight separately chosen marks. */
  $: navTabs = [
    {id: 'general' as Mode, icon: 'settings' as IconName, label: $t('settings.tabGeneral')},
    {id: 'hub' as Mode, icon: 'chat' as IconName, label: $t('workspace.hub')},
    {id: 'drive' as Mode, icon: 'drive' as IconName, label: $t('workspace.drive')},
    {id: 'browser' as Mode, icon: 'globe' as IconName, label: $t('settings.tabBrowser')},
    {id: 'plugins' as Mode, icon: 'puzzle' as IconName, label: $t('settings.tabPlugins')},
    /* The pieces a plugin is made of. Basic mode installs plugins whole and
       never sees them; advanced mode manages them one by one as well. */
    ...(advanced ? [{id: 'mcp' as Mode, icon: 'mcp' as IconName, label: 'MCP'}] : []),
    ...(advanced ? [{id: 'skills' as Mode, icon: 'sparkles' as IconName, label: $t('settings.tabSkills')}] : []),
    ...(advanced ? [{id: 'model' as Mode, icon: 'bot' as IconName, label: $t('settings.tabModels')}] : []),
    {id: 'provider' as Mode, icon: 'bolt' as IconName, label: $t('settings.tabProvider')},
    ...(advanced ? [{id: 'memory' as Mode, icon: 'brain' as IconName, label: $t('settings.tabMemory')}] : []),
  ];
  /* The rail's own search narrows the tab list. It never hides the tab you are
     on: a filter that emptied the page out from under you would read as the
     setting having been removed. */
  $: navQuery = navSearch.trim().toLowerCase();
  $: visibleNavTabs = navQuery
    ? navTabs.filter((tab) => tab.id === mode || tab.label.toLowerCase().includes(navQuery))
    : navTabs;
  /* Named against the counts rather than the filtered rails: a search that
     hides every row is the user narrowing a list they have, not an empty tab. */
  $: openMarketplaceWhenEmpty(mode, !loading, {mcp: mcpServers.length, skills: skills.length, plugins: plugins.length});
  $: railContentKey = `${mode}:${query}:${visibleMcp.length}:${visibleSkills.length}:${visiblePlugins.length}:${modelCompanies.length}:${visibleProviders.length}`;
  $: locationStatusText = !general?.locationEnabled
    ? $t('settings.notShared')
    : locating && !general.location
      ? $t('hub.connecting')
      : locationError
        ? locationError
        : !general.location
          ? $t('settings.waitingLocation')
          : $t('settings.shared');

  onDestroy(() => {
    // A registry search debounce that outlives the page would fire a network
    // request whose result lands in unmounted state.
    clearTimeout(mcpRegistryTimer);
    clearTimeout(registryTimer);
  });

  onMount(() => {
    void loadAll();
    void loadCurrencyRates();
    // Warm the marketplace while the user is still browsing Settings so its
    // first reveal does not wait on the registry network request.
    void preloadMcpMarketplace();
    const stopMcp = api.mcp.subscribe((update) => {
      mcpServers = update.servers;
      if (update.error) error = `MCP configuration: ${update.error}`;
    });
    // A skill the agent just wrote from a recording appears here on its own;
    // the list is replaced rather than reloaded, so a selection survives it.
    const stopSkills = api.skills.subscribe((value) => skills = value);
    return () => { stopMcp(); stopSkills(); };
  });

  /** Collapsing is per agent and reassigns the set, since Svelte tracks the
   * binding rather than the mutation. */
  function toggleGroup(id: string): void {
    const next = new Set(collapsedGroups);
    if (!next.delete(id)) next.add(id);
    collapsedGroups = next;
  }

  function toggleMcpGroup(id: string): void {
    const next = new Set(collapsedMcpGroups);
    if (!next.delete(id)) next.add(id);
    collapsedMcpGroups = next;
  }

  /**
   * Every word typed has to appear somewhere in the row, in any order and
   * anywhere inside a word: "v4 go" finds `deepseek-v4` on Vertex and
   * `opencode-go`, which one substring over the whole line never could. The
   * separators a model id is built from — slashes, dots, dashes — count as
   * spaces, so "gpt 4o mini" matches `gpt-4o-mini` as readily as the slug does.
   */
  function matches(value: string, filter: string): boolean {
    if (!filter) return true;
    const spaced = value.toLocaleLowerCase().replace(/[/\\._:-]+/g, ' ');
    // The same line with the separators gone rather than spaced, so "gpt4o"
    // still finds `gpt-4o`.
    const joined = spaced.replace(/\s+/g, '');
    return searchTerms(filter).every((term) => spaced.includes(term)
      || joined.includes(term)
      // Only once the word itself has failed, and only for a word long enough
      // that one wrong letter is plainly a slip: "clade" is Claude, while a
      // three-letter "got" is not GPT and must not drag one in.
      || term.length >= 4 && (nearlyIncludes(spaced, term) || nearlyIncludes(joined, term)));
  }

  /** True where `term` appears with at most one letter wrong, missing or extra:
   * a typo, not a different word. */
  function nearlyIncludes(haystack: string, term: string): boolean {
    for (let start = 0; start + term.length - 1 <= haystack.length; start += 1)
      if (oneEditFrom(haystack, start, term)) return true;
    return false;
  }

  /**
   * Walks the term against the line from one position, spending a single edit
   * on the first letter that does not line up: swapped for another, typed
   * twice, or left out. Greedy rather than a full edit-distance table, which is
   * what keeps it cheap enough to run over every row on every keystroke.
   */
  function oneEditFrom(haystack: string, start: number, term: string): boolean {
    let index = start;
    let spent = false;
    for (let cursor = 0; cursor < term.length; cursor += 1) {
      if (haystack[index] === term[cursor]) {
        index += 1;
        continue;
      }
      if (spent) return false;
      spent = true;
      // A wrong letter, an extra one, or a missing one — in that order, so the
      // commonest slip is the first thing tried.
      if (index < haystack.length && haystack[index + 1] === term[cursor + 1]) index += 1;
      else if (haystack[index] === term[cursor + 1]) {index += 1; cursor += 1;}
      else if (haystack[index + 1] === term[cursor]) index += 2;
      else return false;
    }
    return true;
  }

  function searchTerms(filter: string): string[] {
    return filter.toLocaleLowerCase().replace(/[/\\._:-]+/g, ' ').split(/\s+/).filter(Boolean);
  }

  /** Slugs are lowercase, so acronyms need restoring rather than title-casing —
   * "pdf" is PDF, not Pdf. */
  const SKILL_ACRONYMS = new Set(['pdf', 'gui', 'api', 'url', 'ai', 'mcp', 'cli', 'os']);

  function skillTitle(item: SkillDto): string {
    return item.displayName ?? skillDisplayName(item.name);
  }

  function skillDisplayName(name: string): string {
    return name
      .split('-')
      .map((part) => {
        if (!part) return part;
        if (SKILL_ACRONYMS.has(part)) return part.toLocaleUpperCase();
        return part[0].toLocaleUpperCase() + part.slice(1);
      })
      .join(' ');
  }

  function skillAuthor(item: SkillDto): string {
    return item.author ?? (item.source === 'official' ? 'FlareAI' : translate('settings.custom'));
  }

  function skillOrigin(item: SkillDto): string {
    if (item.source === 'official' || item.source === 'bundled') return translate('settings.bundled');
    if (item.source === 'flareai') return 'FlareAI · ~/.flareai/skills';
    if (item.source === 'codex') return 'Codex · ~/.codex/skills';
    if (item.source === 'agents') return 'Agents · ~/.agents/skills';
    return translate('settings.configuredFolder');
  }

  function skillUpdated(item: SkillDto): string | undefined {
    if (!item.updatedAt) return undefined;
    const time = Date.parse(item.updatedAt);
    if (Number.isNaN(time)) return undefined;
    return new Date(time).toLocaleDateString(activeLocale(), {year: 'numeric', month: 'short', day: 'numeric'});
  }

  function mcpOrigin(item: McpServerDto): string {
    if (item.source === 'official') return translate('settings.bundled');
    if (item.source === 'codex') return 'Codex';
    return 'FlareAI';
  }

  function mcpAuthor(item: McpServerDto): string {
    if (item.source === 'official') return 'FlareAI';
    if (item.source === 'codex') return 'Codex';
    return translate('settings.custom');
  }

  function mcpStatus(item: McpServerDto): string {
    return item.status[0].toLocaleUpperCase() + item.status.slice(1);
  }

  function mcpToolName(name: string): string {
    const separator = name.indexOf('.');
    return separator < 0 ? name : name.slice(separator + 1);
  }

  function mcpResourceName(name: string): string {
    const withoutScheme = name.replace(/^[a-z][a-z0-9+.-]*:\/\/+?/i, '').replace(/^\/+/, '');
    return mcpToolName(withoutScheme);
  }

  function metadataFor(model: ModelDto): ModelMetadataDto | undefined {
    return modelMetadata[`${model.provider}:${model.id}`];
  }

  /** The identifier stays: it is what tells two rows apart. Sibling models
   * share a description that truncates to the same string in this width, so
   * the prose belongs in the tooltip where it has room. */
  function modelSubtitle(model: ModelDto): string {
    return `${model.provider}/${model.id}`;
  }

  function modelTooltip(model: ModelDto): string {
    const meta = metadataFor(model);
    const lines = [`${model.provider}/${model.id}`];
    if (!meta) return lines[0];
    if (meta.description) lines.push('', meta.description, '');
    if (meta.lab) lines.push(translate('settings.metaLab', {lab: providerName(meta.lab)}));
    if (meta.family) lines.push(translate('settings.metaFamily', {family: meta.family}));
    if (meta.releaseDate) lines.push(translate('settings.metaReleased', {date: meta.releaseDate}));
    if (meta.knowledgeCutoff) lines.push(translate('settings.metaCutoff', {date: meta.knowledgeCutoff}));
    if (meta.openWeights !== undefined) lines.push(translate(meta.openWeights ? 'settings.openWeights' : 'settings.closedWeights'));
    const skills = [
      meta.toolCall ? translate('settings.capabilityTools') : '',
      meta.structuredOutput ? translate('settings.capabilityStructured') : '',
      meta.attachment ? translate('settings.capabilityAttachments') : '',
    ].filter(Boolean);
    // Joined with a separator the catalog owns rather than `Intl.ListFormat`:
    // this is a bare list of capabilities, and `ListFormat` insists on turning
    // one into a sentence — French gains an "et", Chinese loses its commas.
    if (skills.length)
      lines.push(translate('settings.supports', {
        capabilities: skills.join(translate('settings.capabilitySeparator')),
      }));
    return lines.join('\n');
  }

  function skillSourceLabel(source: SkillDto['source']): string {
    return source === 'codex' || source === 'flareai' || source === 'agents' || source === 'configured'
      ? 'Custom'
      : source;
  }

  function selectMcpServers(items: McpServerDto[], searchFilter: string, stateFilter: string, sort: string): McpServerDto[] {
    return items
      .filter((item) => matches(`${item.name} ${item.source} ${item.transport} ${item.status}`, searchFilter))
      .filter((item) => stateFilter === 'all'
        || stateFilter === 'enabled' && item.enabled
        || stateFilter === 'disabled' && !item.enabled
        || stateFilter === 'connected' && item.status === 'connected'
        || stateFilter === 'official' && item.source === 'official'
        || stateFilter === 'custom' && item.editable)
      .sort((a, b) => sort === 'recommended'
        ? 0
        : sort === 'name-desc' ? b.name.localeCompare(a.name)
        : a.name.localeCompare(b.name));
  }

  function selectSkills(items: SkillDto[], searchFilter: string, stateFilter: string, sort: string): SkillDto[] {
    return items
      .filter((item) => matches(`${item.name} ${skillTitle(item)} ${item.description} ${item.source} ${item.category ?? ''}`, searchFilter))
      .filter((item) => stateFilter === 'all'
        || stateFilter === 'enabled' && item.enabled
        || stateFilter === 'disabled' && !item.enabled
        || stateFilter === 'official' && item.source === 'official'
        || stateFilter === 'custom' && item.source !== 'official')
      .sort((a, b) => sort === 'recommended'
        ? 0
        : sort === 'updated-desc'
          ? (Date.parse(b.updatedAt ?? '') || 0) - (Date.parse(a.updatedAt ?? '') || 0) || skillTitle(a).localeCompare(skillTitle(b))
        : sort === 'name-desc' ? skillTitle(b).localeCompare(skillTitle(a))
        : skillTitle(a).localeCompare(skillTitle(b)));
  }

  /**
   * A plugin is matched on everything it is made of, not just its own name: a
   * plugin is installed for what it brings, so searching for the skill you
   * want should find the plugin that carries it.
   */
  function selectPlugins(items: PluginDto[], searchFilter: string, stateFilter: string, sort: string): PluginDto[] {
    return items
      .filter((item) => matches(
        `${item.name} ${item.description} ${item.marketplaceName} ${item.author ?? ''} ${item.contributions.skills.join(' ')} ${item.contributions.mcpServers.join(' ')}`,
        searchFilter,
      ))
      .filter((item) => stateFilter === 'all'
        || stateFilter === 'enabled' && item.enabled
        || stateFilter === 'disabled' && !item.enabled
        || stateFilter === 'conflicts' && (item.conflicts.length > 0 || !!item.error))
      .sort((a, b) => sort === 'recommended'
        ? 0
        : sort === 'name-desc' ? b.name.localeCompare(a.name)
        : a.name.localeCompare(b.name));
  }

  function groupModels(items: ModelDto[], providerStates: ProviderDto[], searchFilter: string, stateFilter: string, sort: string): Array<{id: string; name: string; logoDataUrl?: string; models: ModelDto[]; selected: boolean; configured: boolean; custom: boolean}> {
    const configuredProviders = new Set(providerStates.filter((provider) => provider.configured).map((provider) => provider.id));
    const providerById = new Map(providerStates.map((provider) => [provider.id, provider]));
    const groups = new Map<string, ModelDto[]>();
    for (const model of items) {
      const id = model.custom ? model.provider : modelCompanyId(model);
      const company = model.custom ? providerById.get(model.provider)?.name ?? providerName(id) : providerName(id);
      if (!matches(`${company} ${model.name} ${model.provider} ${model.id}`, searchFilter)) continue;
      const configured = configuredProviders.has(model.provider);
      if (stateFilter === 'default' && !configured) continue;
      if (stateFilter === 'custom' && !model.custom) continue;
      if (stateFilter.startsWith('kind-') && modelKind(model) !== stateFilter.slice(5)) continue;
      groups.set(id, [...(groups.get(id) ?? []), model]);
    }
    const companies = [...groups].map(([id, companyModels]) => ({
      id,
      name: providerById.get(id)?.custom ? providerById.get(id)!.name : providerName(id),
      logoDataUrl: providerById.get(id)?.logoDataUrl,
      models: companyModels.sort((a, b) => a.name.localeCompare(b.name)),
      selected: companyModels.some((model) => model.selected),
      configured: companyModels.some((model) => configuredProviders.has(model.provider)),
      custom: companyModels.some((model) => model.custom),
    }));
    return companies.sort((a, b) => sort === 'recommended'
      ? recommendedCompanyRank(a.id) - recommendedCompanyRank(b.id) || Number(b.selected) - Number(a.selected) || Number(b.configured) - Number(a.configured) || b.models.length - a.models.length || a.name.localeCompare(b.name)
      : sort === 'name-desc' ? b.name.localeCompare(a.name)
      : sort === 'models-desc' ? b.models.length - a.models.length || a.name.localeCompare(b.name)
      : sort === 'models-asc' ? a.models.length - b.models.length || a.name.localeCompare(b.name)
      : a.name.localeCompare(b.name));
  }

  function recommendedCompanyRank(id: string): number {
    const rank = recommendedModelCompanies.indexOf(id);
    return rank < 0 ? recommendedModelCompanies.length : rank;
  }

  function selectProviders(items: ProviderDto[], searchFilter: string, stateFilter: string, sort: string): ProviderDto[] {
    const visible = items
      // A hosted provider with nothing to offer is noise in the rail. Local
      // runtimes stay: they list no models until they are set up, which is the
      // point of showing them.
      .filter((item) => item.localRuntime || item.modelCount > 0)
      .filter((item) => matches(`${item.name} ${item.id} ${item.source ?? ''}`, searchFilter))
      .filter((item) => stateFilter === 'all'
        || stateFilter === 'configured' && item.configured
        || stateFilter === 'unconfigured' && !item.configured);
    if (sort === 'default') {
      const recommended = (providers: ProviderDto[]) => providers.sort((a, b) => b.modelCount - a.modelCount || a.name.localeCompare(b.name));
      return [
        ...recommended(visible.filter((provider) => provider.configured)),
        ...recommended(visible.filter((provider) => !provider.configured)),
      ];
    }
    return visible.sort((a, b) => sort === 'recommended' ? b.modelCount - a.modelCount || a.name.localeCompare(b.name)
        : sort === 'name-desc' ? b.name.localeCompare(a.name)
        : sort === 'models-desc' ? b.modelCount - a.modelCount || a.name.localeCompare(b.name)
        : sort === 'models-asc' ? a.modelCount - b.modelCount || a.name.localeCompare(b.name)
        : a.name.localeCompare(b.name));
  }

  function selectMode(next: Mode): void {
    mode = next;
    search = '';
    browsingRole = '';
    adding = null;
    addingCustomProvider = false;
    openRailMenu = null;
  }

  function selectMcp(id: string): void { browsingMcpRegistry = false; discoveringMcp = false; selectedMcp = id; adding = null; }
  function selectSkill(name: string): void { selectedSkill = name; adding = null; discoveringSkills = false; }
  function selectPlugin(id: string): void { selectedPlugin = id; adding = null; browsingPluginMarketplace = false; }
  function selectModelCompany(id: string): void { selectedModelProvider = id; }

  async function loadAll(): Promise<void> {
    loading = !settingsSnapshot.loaded;
    try {
      [mcpServers, skills, plugins, models, providers, memory, chronicle, general, extensionStatus] = await Promise.all([api.mcp.list(), api.skills.list(), api.plugins.list(), api.models.list(), api.providers.list(), api.memory.status(), api.chronicle.status(), api.general.get(), api.extension.status()]);
      void loadSourceIcons(chronicle);
      currency = general.currency ?? defaultCurrency(general.location);
      settingsSnapshot.loaded = true;
      error = '';
      // Catalogue detail is decoration: it loads after the lists, and a
      // failure leaves the models on screen exactly as they were.
      void api.models.metadata().then((value) => modelMetadata = value).catch(() => {});
      void api.models.roles().then((value) => modelRoles = value).catch(() => {});
      // Build identity and the update check are equally incidental: they
      // annotate the General tab and must never block the settings lists.
      void api.general.version().then((value) => appVersion = value).catch(() => {});
      void checkForUpdates();
      if (general.locationEnabled && !general.location && window.flareai) void refreshLocation();
      // Grants change outside the app, in System Settings, so the statuses are
      // read rather than remembered.
      void refreshPermissionStatuses();
    } catch (reason) {
      error = readableError(reason);
    } finally {
      loading = false;
      // Controls settle into their loaded state without animating: transitions
      // stay suppressed until the first painted frame carries the real values.
      await tick();
      requestAnimationFrame(() => settled = true);
    }
  }

  async function setTimeEnabled(enabled: boolean): Promise<void> {
    updatingTime = true;
    try {
      general = await api.general.update({timeEnabled: enabled});
      error = '';
    } catch (reason) {
      error = readableError(reason);
    } finally {
      updatingTime = false;
    }
  }

  async function setAdvancedMode(enabled: boolean): Promise<void> {
    updatingAdvancedMode = true;
    try {
      general = await api.general.update({advancedMode: enabled});
      onGeneralChange(general);
      if (!enabled)
        void Promise.all([api.memory.status(), api.chronicle.status()])
          .then(([nextMemory, nextChronicle]) => { memory = nextMemory; chronicle = nextChronicle; void loadSourceIcons(chronicle); })
          .catch(() => {});
      error = '';
    } catch (reason) {
      error = readableError(reason);
    } finally {
      updatingAdvancedMode = false;
    }
  }

  async function setSpeechModeEnabled(enabled: boolean): Promise<void> {
    updatingSpeechMode = true;
    try {
      general = await api.general.update({speechModeEnabled: enabled});
      onGeneralChange(general);
      error = '';
    } catch (reason) {
      error = readableError(reason);
    } finally {
      updatingSpeechMode = false;
    }
  }

  async function setDictationAutoStop(choice: string): Promise<void> {
    updatingAutoStop = true;
    try {
      general = await api.general.update({dictationAutoStopSeconds: choice === 'off' ? null : Number(choice)});
      onGeneralChange(general);
      error = '';
    } catch (reason) {
      error = readableError(reason);
    } finally {
      updatingAutoStop = false;
    }
  }

  async function setLanguage(language: string): Promise<void> {
    updatingLanguage = true;
    try {
      general = await api.general.update({language});
      // Applied from the answer rather than the request: the backend is what
      // decides the stored value, and the interface should redraw in the
      // language that was actually saved.
      applyLanguage(general.language);
      error = '';
    } catch (reason) {
      error = readableError(reason);
    } finally {
      updatingLanguage = false;
    }
  }

  async function checkForUpdates(): Promise<void> {
    checkingUpdate = true;
    // A cached answer can come back instantly; hold the label long enough
    // that the click reads as having done something.
    const minimumDelay = new Promise((resolve) => setTimeout(resolve, 600));
    try {
      update = await api.general.checkForUpdates();
    } catch (reason) {
      update = null;
      error = readableError(reason);
    } finally {
      await minimumDelay;
      checkingUpdate = false;
    }
  }

  async function installUpdate(): Promise<void> {
    try {
      update = await api.general.installUpdate();
    } catch (reason) {
      error = readableError(reason);
    }
  }

  async function setTheme(theme: ThemeMode): Promise<void> {
    updatingTheme = true;
    try {
      general = await api.general.update({theme});
      applyTheme(general.theme);
      error = '';
    } catch (reason) {
      error = readableError(reason);
    } finally {
      updatingTheme = false;
    }
  }

  async function setLocationEnabled(enabled: boolean): Promise<void> {
    updatingLocation = true;
    try {
      general = await api.general.update({locationEnabled: enabled, location: enabled ? undefined : null});
      locationError = '';
      error = '';
    } catch (reason) {
      error = readableError(reason);
    } finally {
      updatingLocation = false;
    }
    if (enabled && general?.locationEnabled) void refreshLocation();
  }

  /** The platform service gets a short first try; Electron's Chromium rarely
   * has a working provider (it wants a Google API key or a CoreLocation
   * grant), so a network-based city-level lookup is the reliable path. */
  function platformPosition(): Promise<GeolocationPosition> {
    return new Promise<GeolocationPosition>((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('unavailable'));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false,
        maximumAge: 300_000,
        timeout: 6_000,
      });
    });
  }

  async function refreshLocation(openSettingsWhenDenied = false): Promise<void> {
    if (locating) return;
    locating = true;
    try {
      let location: NonNullable<GeneralSettingsDto['location']>;
      let denied = false;
      try {
        const position = await platformPosition();
        location = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          updatedAt: new Date(position.timestamp).toISOString(),
        };
      } catch (reason) {
        denied = !!reason && typeof reason === 'object' && 'code' in reason && Number(reason.code) === 1;
        location = await api.general.locate();
      }
      general = await api.general.update({location});
      if (!general.currency) currency = defaultCurrency(general.location);
      locationError = '';
      error = '';
      if (denied && openSettingsWhenDenied) await api.permissions.openSettings('location');
    } catch {
      locationError = translate('settings.locationFailed');
    } finally {
      locating = false;
    }
  }

  async function setChronicleEnabled(enabled: boolean): Promise<void> {
    updatingChronicle = true;
    try {
      chronicle = await api.chronicle.setEnabled(enabled);
      void loadSourceIcons(chronicle);
      error = '';
    } catch (reason) {
      error = readableError(reason);
    } finally {
      updatingChronicle = false;
    }
  }

  async function updateChronicle(patch: Parameters<typeof api.chronicle.update>[0]): Promise<void> {
    updatingChronicle = true;
    try {
      chronicle = await api.chronicle.update(patch);
      void loadSourceIcons(chronicle);
      error = '';
    } catch (reason) {
      error = readableError(reason);
    } finally {
      updatingChronicle = false;
    }
  }

  /* What one panel shows, searched down. Taken as arguments rather than read
     from the outer scope, so the statements below re-run when the lists or the
     search text change — a call whose inputs are invisible to the template
     would leave a removed row on screen. */
  function chronicleSources(sources: string[], query: string): string[] {
    const needle = query.trim().toLowerCase();
    return needle ? sources.filter((item) => item.toLowerCase().includes(needle)) : sources;
  }

  /* An application's own icon and a site's favicon, fetched once each and kept
     by the name the row shows. Both arrive as `data:` urls — the renderer's CSP
     blocks a remote icon url outright. Asked for when a status arrives rather
     than from a reactive statement, so the fetch is tied to the data changing
     and not to which parts of it the markup happens to read. */
  let sourceIcons: Record<string, string | null> = {};
  const iconsAsked = new Set<string>();

  async function loadSourceIcons(status: ChronicleStatusDto | null): Promise<void> {
    if (!status) return;
    const wanted: Array<[ChronicleList, string]> = [
      ...status.excludeApps.map((name) => ['apps', name] as [ChronicleList, string]),
      ...status.excludeSites.map((host) => ['sites', host] as [ChronicleList, string]),
    ];
    for (const [list, source] of wanted) {
      if (iconsAsked.has(source)) continue;
      iconsAsked.add(source);
      try {
        const icon =
          list === 'apps'
            ? await api.chronicle.appIcon(source)
            : await api.browser.favicon(`https://${source}`);
        if (icon) sourceIcons = {...sourceIcons, [source]: icon};
      } catch (reason) {
        // A missing icon is not worth an error banner — the row keeps its
        // glyph — but a broken channel should not be silent either.
        console.warn(`Could not load the icon for ${source}`, reason);
      }
    }
  }

  $: shownApps = chronicleSources(chronicle?.excludeApps ?? [], chronicleQuery.apps);
  $: shownSites = chronicleSources(chronicle?.excludeSites ?? [], chronicleQuery.sites);
  $: appRows = shownApps.map((name) => ({name, icon: sourceIcons[name] ?? null}));
  $: siteRows = shownSites.map((host) => ({name: host, icon: sourceIcons[host] ?? null}));

  /* A pasted address is stored as its host, since that is what Chronicle
     matches on: "https://www.bank.example/transfer" saved verbatim would sit
     in the list looking right and never match anything. */
  function hostOf(value: string): string {
    try {
      const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
      return url.hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      return value;
    }
  }

  async function excludeSource(list: ChronicleList, value: string): Promise<void> {
    const trimmed = value.trim();
    const source = list === 'sites' ? hostOf(trimmed) : trimmed;
    if (!source || !chronicle) return;
    const key = list === 'apps' ? 'excludeApps' : 'excludeSites';
    const existing = chronicle[key];
    if (existing.some((item) => item.toLowerCase() === source.toLowerCase())) return;
    await updateChronicle({[key]: [...existing, source]});
  }

  async function addChronicleSource(list: ChronicleList): Promise<void> {
    const value = chronicleDraft;
    chronicleDraft = '';
    await excludeSource(list, value);
  }

  /* Removed by value rather than by index, so a sorted or filtered view drops
     the row the user actually clicked. */
  async function removeChronicleSource(list: ChronicleList, value: string): Promise<void> {
    if (!chronicle) return;
    const key = list === 'apps' ? 'excludeApps' : 'excludeSites';
    await updateChronicle({[key]: chronicle[key].filter((item) => item !== value)});
  }

  /* A website is typed straight into the list; an app is picked in the
     system's own picker, opened at the applications folder — its name has to
     match what the system calls it, and guessing the spelling is the one way
     to add a row that silently never matches. */
  async function pickAppSource(): Promise<void> {
    pickingApp = true;
    try {
      const chosen = await api.chronicle.pickApp();
      if (chosen) await excludeSource('apps', chosen);
      error = '';
    } catch (reason) {
      error = readableError(reason);
    } finally {
      pickingApp = false;
    }
  }

  function focusInput(node: HTMLInputElement): void {
    node.focus();
  }

  /* `hours` of null clears everything Chronicle still holds. The window ends
     now rather than at the newest capture, so an event written between the
     click and the call is inside it too. */
  async function forgetChronicle(hours: number | null): Promise<void> {
    forgetting = hours === null ? 'all' : String(hours);
    try {
      const until = new Date();
      const since = hours === null ? new Date(0) : new Date(until.getTime() - hours * 3_600_000);
      chronicle = await api.chronicle.forget(since.toISOString(), until.toISOString());
      error = '';
    } catch (reason) {
      error = readableError(reason);
    } finally {
      forgetting = '';
    }
  }

  async function setMemoryEnabled(enabled: boolean): Promise<void> {
    updatingMemory = true;
    try {
      memory = await api.memory.setEnabled(enabled);
      error = '';
    } catch (reason) {
      error = readableError(reason);
    } finally {
      updatingMemory = false;
    }
  }

  async function setCurrency(next: string): Promise<void> {
    if (!currencies.includes(next as Currency)) return;
    currency = next as Currency;
    try {
      general = await api.general.update({currency});
      error = '';
    } catch (reason) {
      error = readableError(reason);
    }
  }

  /**
   * The four macOS grants, in the order they matter: what the app asks for
   * first, then what it only needs for one surface.
   */
  const PERMISSION_ROWS: Array<{kind: SystemPermissionKind; icon: ComponentProps<typeof Icon>['name']; title: MessageKey; reason: MessageKey}> = [
    {kind: 'microphone', icon: 'mic', title: 'permission.microphone', reason: 'permission.microphoneReason'},
    {kind: 'accessibility', icon: 'eye', title: 'permission.screenReading', reason: 'permission.screenReadingReason'},
    {kind: 'screen-recording', icon: 'screen-record', title: 'permission.screenRecording', reason: 'permission.screenRecordingReason'},
    {kind: 'full-disk-access', icon: 'folder', title: 'permission.fullDisk', reason: 'permission.fullDiskReason'},
  ];

  /**
   * The grants a skill asks for, rather than ones FlareAI has of its own. A
   * row appears because something installed declared it in its SKILL.md, which
   * is why the list is filtered by what the skills actually say instead of
   * showing five switches for apps the user may never have asked FlareAI to
   * touch.
   */
  const APP_PERMISSION_ROWS: Array<{kind: AppPermissionKind; icon: ComponentProps<typeof Icon>['name']; title: MessageKey; reason: MessageKey}> = [
    {kind: 'reminders', icon: 'task', title: 'permission.reminders', reason: 'permission.remindersReason'},
    {kind: 'calendars', icon: 'calendar', title: 'permission.calendars', reason: 'permission.calendarsReason'},
    {kind: 'contacts', icon: 'users', title: 'permission.contacts', reason: 'permission.contactsReason'},
    {kind: 'photos', icon: 'image', title: 'permission.photos', reason: 'permission.photosReason'},
    {kind: 'automation', icon: 'workflow', title: 'permission.automation', reason: 'permission.automationReason'},
  ];

  function appPermissionRows(list: SkillDto[]): typeof APP_PERMISSION_ROWS {
    const declared = new Set(list.flatMap((skill) => skill.permissions));
    return APP_PERMISSION_ROWS.filter((row) => declared.has(row.kind));
  }

  async function refreshPermissionStatuses(): Promise<void> {
    const entries = await Promise.all(
      [...PERMISSION_ROWS, ...APP_PERMISSION_ROWS].map(async (row) => [row.kind, await api.permissions.status(row.kind).catch(() => null)] as const),
    );
    permissionStatuses = Object.fromEntries(entries.filter(([, status]) => status)) as typeof permissionStatuses;
  }

  /**
   * Ask macOS, and fall back to opening the pane it lives in: Accessibility and
   * Full Disk Access have no dialog of their own, and a grant already denied
   * never prompts twice.
   */
  async function requestPermission(kind: SystemPermissionKind): Promise<void> {
    askingPermission = kind;
    try {
      const status = await api.permissions.request(kind);
      permissionStatuses = {...permissionStatuses, [kind]: status};
      if (status !== 'granted') await api.permissions.openSettings(kind);
      error = '';
    } catch (reason) {
      error = readableError(reason);
    } finally {
      askingPermission = '';
      void refreshPermissionStatuses();
    }
  }

  /**
   * The master switch over every grant a skill can ask for. Off is a refusal
   * to use them, not a revocation — macOS keeps whatever it granted — so this
   * is the one switch that can be moved back and forth without ever sending
   * the user through System Settings again.
   */
  async function setAppPermissionsEnabled(next: boolean): Promise<void> {
    updatingAppPermissions = true;
    try {
      general = await api.general.update({appPermissionsEnabled: next});
      error = '';
      // Turning it on is the moment to catch up on anything that was never
      // decided while it was off, so nothing is left for a run to trip over.
      if (next) await api.permissions.requestAll();
      await refreshPermissionStatuses();
    } catch (reason) {
      error = readableError(reason);
    } finally {
      updatingAppPermissions = false;
    }
  }

  /**
   * Asks for everything still undecided in one pass. macOS shows each dialog
   * once, so this reaches only the grants that have never been answered;
   * anything still withheld afterwards ends at the System Settings pane that
   * owns it, which is the only place a refusal can be undone.
   */
  async function requestAllPermissions(): Promise<void> {
    askingAllPermissions = true;
    try {
      const withheld = await api.permissions.requestAll();
      error = '';
      // macOS raises each dialog once, so a grant it has already refused has
      // no prompt left to show — and a button that answers a press with
      // nothing at all reads as broken. System Settings is where that answer
      // can still be changed, so the sweep ends there rather than in silence.
      if (withheld.length) await api.permissions.openSettings(withheld[0]!);
    } catch (reason) {
      error = readableError(reason);
    } finally {
      askingAllPermissions = false;
      await refreshPermissionStatuses();
    }
  }

  /** The switch is the app's own use of the capability. The grant stays where
   * it is, so switching back on costs no second trip to System Settings. */
  async function setPermissionEnabled(kind: SystemPermissionKind, next: boolean): Promise<void> {
    updatingPermission = kind;
    try {
      general = await api.general.update({permissions: {[kind]: next}});
      error = '';
    } catch (reason) {
      error = readableError(reason);
    } finally {
      updatingPermission = '';
    }
  }

  /**
   * One row per event worth interrupting for. The master switch above them is
   * a separate setting, so switching it off greys these without forgetting
   * which of them the user had chosen.
   */
  const NOTIFICATION_ROWS: Array<{kind: NotificationKind; icon: ComponentProps<typeof Icon>['name']; title: MessageKey; hint: MessageKey}> = [
    {kind: 'schedule-completed', icon: 'calendar', title: 'settings.notifyScheduleCompleted', hint: 'settings.notifyScheduleCompletedHint'},
    {kind: 'schedule-failed', icon: 'info', title: 'settings.notifyScheduleFailed', hint: 'settings.notifyScheduleFailedHint'},
    {kind: 'agent-completed', icon: 'bot', title: 'settings.notifyAgentCompleted', hint: 'settings.notifyAgentCompletedHint'},
    {kind: 'agent-attention', icon: 'shield', title: 'settings.notifyAgentAttention', hint: 'settings.notifyAgentAttentionHint'},
    {kind: 'message-received', icon: 'chat', title: 'settings.notifyMessageReceived', hint: 'settings.notifyMessageReceivedHint'},
  ];

  async function setNotificationsEnabled(next: boolean): Promise<void> {
    updatingNotifications = 'all';
    try {
      general = await api.general.update({notificationsEnabled: next});
      error = '';
    } catch (reason) {
      error = readableError(reason);
    } finally {
      updatingNotifications = '';
    }
  }

  async function setNotificationKind(kind: NotificationKind, next: boolean): Promise<void> {
    updatingNotifications = kind;
    try {
      general = await api.general.update({notifications: {[kind]: next}});
      error = '';
    } catch (reason) {
      error = readableError(reason);
    } finally {
      updatingNotifications = '';
    }
  }

  /** Proves the OS half of this works, which no switch here can promise on
   * its own — the grant lives in System Settings, not in the app. */
  async function sendTestNotification(): Promise<void> {
    try {
      notificationsUnsupported = (await api.general.testNotification()) === 'unsupported';
      error = '';
    } catch (reason) {
      error = readableError(reason);
    }
  }

  function permissionStatusText(kind: SystemPermissionKind, reason: MessageKey): string {
    if (general && !general.permissions[kind]) return $t('permission.switchedOff');
    // The row's own switch reads as on while the master one is off, so say
    // which of the two is actually holding the capability back.
    if (general && !general.appPermissionsEnabled && APP_PERMISSION_ROWS.some((row) => row.kind === kind))
      return $t('permission.switchedOff');
    if (permissionStatuses[kind] === 'granted') return $t('permission.allowed');
    return $t(reason);
  }

  async function retryChronicle(): Promise<void> {
    updatingChronicle = true;
    const permissionKind = 'accessibility';
    try {
      const permission = await api.permissions.request(permissionKind);
      if (permission === 'denied' || permission === 'restricted') {
        await api.permissions.openSettings(permissionKind);
        return;
      }
      chronicle = await api.chronicle.setEnabled(true);
      void loadSourceIcons(chronicle);
      error = '';
    } catch (reason) {
      error = readableError(reason);
    } finally {
      updatingChronicle = false;
    }
  }

  function formatBytes(value: number): string {
    if (value < 1024) return translate('drive.unitBytes', {size: value.toLocaleString(activeLocale())});
    if (value < 1024 ** 2) return translate('drive.unitKilobytes', {size: decimal(value / 1024)});
    if (value < 1024 ** 3) return translate('drive.unitMegabytes', {size: decimal(value / 1024 ** 2)});
    return translate('drive.unitGigabytes', {size: decimal(value / 1024 ** 3)});
  }

  function decimal(value: number): string {
    return value.toLocaleString(activeLocale(), {minimumFractionDigits: 1, maximumFractionDigits: 1});
  }

  function formatMemoryTime(value: string | null | undefined): string {
    return value
      ? new Date(value).toLocaleString(activeLocale(), {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'})
      : translate('reasoning.none');
  }

  function defaultCurrency(location: GeneralSettingsDto['location']): Currency {
    if (location) {
      const {latitude, longitude} = location;
      if (latitude >= 1.1 && latitude <= 1.5 && longitude >= 103.5 && longitude <= 104.2) return 'SGD';
      if (latitude >= -44.5 && latitude <= -9 && longitude >= 112 && longitude <= 154.5) return 'AUD';
      if (latitude >= 24 && latitude <= 46.5 && longitude >= 122 && longitude <= 146.5) return 'JPY';
      if (latitude >= 49 && latitude <= 61 && longitude >= -9 && longitude <= 2.5) return 'GBP';
    }

    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timeZone === 'Asia/Singapore') return 'SGD';
    if (timeZone.startsWith('Australia/')) return 'AUD';
    if (timeZone === 'Asia/Tokyo') return 'JPY';
    if (timeZone === 'Europe/London') return 'GBP';
    if (euroTimeZones.has(timeZone)) return 'EUR';

    for (const locale of navigator.languages.length ? navigator.languages : [navigator.language]) {
      const region = new Intl.Locale(locale).region;
      if (region && regionCurrencies[region]) return regionCurrencies[region];
    }
    return 'USD';
  }

  const euroTimeZones = new Set([
    'Europe/Amsterdam', 'Europe/Athens', 'Europe/Berlin', 'Europe/Bratislava',
    'Europe/Brussels', 'Europe/Dublin', 'Europe/Helsinki', 'Europe/Lisbon',
    'Europe/Ljubljana', 'Europe/Luxembourg', 'Europe/Madrid', 'Europe/Malta',
    'Europe/Paris', 'Europe/Riga', 'Europe/Rome', 'Europe/Tallinn', 'Europe/Vienna',
    'Europe/Vilnius', 'Europe/Zagreb',
  ]);
  const regionCurrencies: Partial<Record<string, Currency>> = {
    US: 'USD', AU: 'AUD', GB: 'GBP', SG: 'SGD', JP: 'JPY',
    AT: 'EUR', BE: 'EUR', HR: 'EUR', CY: 'EUR', EE: 'EUR', FI: 'EUR',
    FR: 'EUR', DE: 'EUR', GR: 'EUR', IE: 'EUR', IT: 'EUR', LV: 'EUR',
    LT: 'EUR', LU: 'EUR', MT: 'EUR', NL: 'EUR', PT: 'EUR', SK: 'EUR',
    SI: 'EUR', ES: 'EUR',
  };

  async function loadCurrencyRates(): Promise<void> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 4000);
    try {
      const response = await fetch('https://api.frankfurter.dev/v2/rates?base=USD&quotes=AUD,EUR,GBP,SGD,JPY', {signal: controller.signal});
      if (!response.ok) return;
      const rows = await response.json() as Array<{quote?: string; rate?: number}>;
      const next: Partial<Record<Currency, number>> = {USD: 1};
      for (const row of rows) {
        if (currencies.includes(row.quote as Currency) && typeof row.rate === 'number') next[row.quote as Currency] = row.rate;
      }
      currencyRates = next;
    } catch {
      // USD remains available when exchange rates cannot be refreshed.
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function beginAdd(kind: 'mcp' | 'skills' | 'plugins'): void {
    skillAddMenuOpen = false;
    mcpAddMenuOpen = false;
    pluginAddMenuOpen = false;
    adding = kind;
    editingIntegration = false;
    installingSkill = false;
    discoveringSkills = false;
    discoveringMcp = false;
    browsingMcpRegistry = false;
    browsingPluginMarketplace = false;
    if (kind === 'mcp') {
      customMcpId = ''; customMcpName = ''; customMcpDescription = ''; customMcpTransport = 'stdio'; customMcpTarget = ''; customMcpArgs = ''; customMcpEnvironment = ''; customMcpCwd = '';
      selectedMcp = '';
    } else if (kind === 'skills') {
      customSkillOriginalName = ''; customSkillName = ''; customSkillDescription = ''; customSkillInstructions = '';
      selectedSkill = '';
    } else {
      pluginMarketplaceSource = '';
      selectedPlugin = '';
      // The form lists what is already added, which has to be read before it
      // can be shown.
      void api.plugins.marketplaces().then((value) => pluginMarketplaces = value).catch(() => {});
    }
  }

  /**
   * The plugin marketplace, opened from the rail's storefront tool. Catalogs
   * are fetched from GitHub, so the list already on screen stays there while
   * the next one arrives rather than blanking between searches.
   */
  function beginPluginMarketplace(): void {
    openRailMenu = null;
    pluginAddMenuOpen = false;
    adding = null;
    browsingPluginMarketplace = true;
    void refreshPluginCatalog();
  }

  async function refreshPluginCatalog(): Promise<void> {
    pluginCatalogSearching = true;
    try {
      pluginCatalog = await api.plugins.browse(pluginCatalogQuery);
      pluginCatalogVisible = CATALOG_PAGE;
      // Read back afterwards: a marketplace only knows its own name and how
      // many plugins it lists once its catalog has been fetched.
      pluginMarketplaces = await api.plugins.marketplaces();
      pluginCatalogError = '';
    } catch (reason) {
      pluginCatalog = [];
      pluginCatalogError = readableError(reason);
    } finally {
      pluginCatalogSearching = false;
    }
  }

  /** Debounced, because each keystroke would otherwise be a request. */
  function searchPluginMarketplace(): void {
    clearTimeout(pluginCatalogTimer);
    pluginCatalogTimer = setTimeout(() => void refreshPluginCatalog(), 250);
  }

  function clearPluginMarketplaceSearch(): void {
    pluginCatalogQuery = '';
    void refreshPluginCatalog();
  }

  async function installPlugin(entry: MarketplacePluginDto): Promise<void> {
    installingPluginId = entry.id;
    try {
      plugins = await api.plugins.install(entry.id);
      pluginCatalog = pluginCatalog.map((item) => item.id === entry.id ? {...item, installed: true} : item);
      error = '';
    } catch (reason) {
      error = readableError(reason);
    } finally {
      installingPluginId = '';
    }
  }

  async function removePlugin(target: PluginDto): Promise<void> {
    integrationSaving = true;
    try {
      plugins = await api.plugins.remove(target.id);
      pluginCatalog = pluginCatalog.map((item) => item.id === target.id ? {...item, installed: false} : item);
      error = '';
    } catch (reason) {
      error = readableError(reason);
    } finally {
      integrationSaving = false;
    }
  }

  async function setPluginEnabled(target: PluginDto): Promise<void> {
    integrationSaving = true;
    try {
      plugins = await api.plugins.setEnabled(target.id, !target.enabled);
      error = '';
    } catch (reason) {
      error = readableError(reason);
    } finally {
      integrationSaving = false;
    }
  }

  async function addPluginMarketplace(): Promise<void> {
    const source = pluginMarketplaceSource.trim();
    if (!source) return;
    addingPluginMarketplace = true;
    try {
      pluginMarketplaces = await api.plugins.addMarketplace(source);
      pluginMarketplaceSource = '';
      error = '';
      // Straight into the marketplace it was added for: the point of adding
      // one is the plugins it lists.
      adding = null;
      browsingPluginMarketplace = true;
      await refreshPluginCatalog();
    } catch (reason) {
      error = readableError(reason);
    } finally {
      addingPluginMarketplace = false;
    }
  }

  async function removePluginMarketplace(entry: PluginMarketplaceDto): Promise<void> {
    addingPluginMarketplace = true;
    try {
      pluginMarketplaces = await api.plugins.removeMarketplace(entry.id);
      error = '';
      await refreshPluginCatalog();
    } catch (reason) {
      error = readableError(reason);
    } finally {
      addingPluginMarketplace = false;
    }
  }

  async function uploadPluginFolder(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    if (!files.length) return;
    pluginAddMenuOpen = false;
    integrationSaving = true;
    try {
      plugins = await api.plugins.upload(files);
      adding = null;
      browsingPluginMarketplace = false;
      error = '';
    } catch (reason) {
      error = readableError(reason);
    } finally {
      integrationSaving = false;
    }
  }

  /**
   * Modes whose empty state has already been answered. Closing the marketplace
   * has to stay closed: without this the next keystroke would reopen it, and
   * an empty tab you cannot look at is worse than one with nothing in it.
   */
  const marketplaceDefaulted = new Set<Mode>();

  /**
   * A tab of add-ons with none added has nothing to show, so the first visit
   * opens the place they come from rather than an empty rail. Only the first:
   * this marks the mode as answered whether or not it opened anything, so
   * removing your last one later leaves you where you were.
   */
  function openMarketplaceWhenEmpty(current: Mode, ready: boolean, counts: {mcp: number; skills: number; plugins: number}): void {
    if (!ready || marketplaceDefaulted.has(current)) return;
    const installed = current === 'mcp' ? counts.mcp
      : current === 'skills' ? counts.skills
      : current === 'plugins' ? counts.plugins
      : null;
    // Every other tab is its own thing and has no marketplace behind it.
    if (installed === null) return;
    marketplaceDefaulted.add(current);
    if (installed > 0) return;
    if (current === 'mcp') beginMcpMarketplace();
    else if (current === 'skills') beginInstallSkill();
    else beginPluginMarketplace();
  }

  function beginMcpMarketplace(): void {
    openRailMenu = null;
    mcpAddMenuOpen = false;
    discoveringMcp = false;
    adding = null;
    selectedMcp = '';
    browsingMcpRegistry = true;
    mcpRegistryQuery = '';
    mcpRegistryResults = mcpRegistryFeatured;
    mcpRegistryCursor = mcpRegistryFeaturedCursor;
    mcpRegistryError = '';
    if (!mcpRegistryPreloaded && !mcpRegistrySearching) void preloadMcpMarketplace();
  }

  async function preloadMcpMarketplace(): Promise<void> {
    if (mcpRegistryPreloaded || mcpRegistrySearching) return;
    const request = ++mcpRegistryRequest;
    mcpRegistrySearching = true;
    try {
      const page = await api.mcp.searchRegistry('');
      if (request !== mcpRegistryRequest) return;
      mcpRegistryFeatured = page.entries;
      mcpRegistryFeaturedCursor = page.nextCursor;
      mcpRegistryPreloaded = true;
      if (!mcpRegistryQuery.trim()) {
        mcpRegistryResults = page.entries;
        mcpRegistryCursor = page.nextCursor;
      }
      mcpRegistryError = '';
    } catch (reason) {
      if (request !== mcpRegistryRequest) return;
      mcpRegistryError = readableError(reason);
    } finally {
      if (request === mcpRegistryRequest) mcpRegistrySearching = false;
    }
  }

  function searchMcpMarketplace(immediate = false): void {
    clearTimeout(mcpRegistryTimer);
    const run = () => void (async () => {
      const request = ++mcpRegistryRequest;
      mcpRegistrySearching = true;
      try {
        const page = await api.mcp.searchRegistry(mcpRegistryQuery.trim());
        if (request !== mcpRegistryRequest) return;
        mcpRegistryResults = page.entries;
        mcpRegistryCursor = page.nextCursor;
        if (!mcpRegistryQuery.trim()) {
          mcpRegistryFeatured = page.entries;
          mcpRegistryFeaturedCursor = page.nextCursor;
          mcpRegistryPreloaded = true;
        }
        mcpRegistryError = '';
      } catch (reason) {
        if (request !== mcpRegistryRequest) return;
        mcpRegistryResults = [];
        mcpRegistryCursor = '';
        mcpRegistryError = readableError(reason);
      } finally {
        if (request === mcpRegistryRequest) mcpRegistrySearching = false;
      }
    })();
    if (immediate) run(); else mcpRegistryTimer = setTimeout(run, 250);
  }

  function clearMcpMarketplaceSearch(): void {
    clearTimeout(mcpRegistryTimer);
    mcpRegistryRequest += 1;
    mcpRegistryQuery = '';
    mcpRegistryResults = mcpRegistryFeatured;
    mcpRegistryCursor = mcpRegistryFeaturedCursor;
    mcpRegistrySearching = false;
    mcpRegistryError = '';
  }

  /** The next page, appended. A page is filtered down to its remote-capable
   * servers after it arrives, so a short one is normal and the cursor rather
   * than the row count is what says whether to keep going. */
  function loadMoreMcpMarketplace(): void {
    if (!mcpRegistryCursor || mcpRegistryLoadingMore || mcpRegistrySearching) return;
    const request = mcpRegistryRequest;
    const cursor = mcpRegistryCursor;
    mcpRegistryLoadingMore = true;
    void (async () => {
      try {
        const page = await api.mcp.searchRegistry(mcpRegistryQuery.trim(), cursor);
        if (request !== mcpRegistryRequest) return;
        const known = new Set(mcpRegistryResults.map((item) => item.id));
        mcpRegistryResults = [...mcpRegistryResults, ...page.entries.filter((item) => !known.has(item.id))];
        mcpRegistryCursor = page.nextCursor;
        if (!mcpRegistryQuery.trim()) {
          mcpRegistryFeatured = mcpRegistryResults;
          mcpRegistryFeaturedCursor = page.nextCursor;
        }
      } catch (reason) {
        if (request === mcpRegistryRequest) mcpRegistryError = readableError(reason);
      } finally {
        mcpRegistryLoadingMore = false;
      }
    })();
  }

  function mcpRegistryLocalId(entry: McpRegistryEntryDto): string {
    return entry.id.split('/').at(-1)!.toLocaleLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'marketplace-mcp';
  }

  async function installMcpRegistryEntry(entry: McpRegistryEntryDto): Promise<void> {
    installingMcpRegistryId = entry.id;
    try {
      mcpServers = await api.mcp.saveCustom({id: mcpRegistryLocalId(entry), name: entry.name, description: entry.description, transport: 'streamable-http', url: entry.url, headers: {}});
      error = '';
    } catch (reason) { error = readableError(reason); }
    finally { installingMcpRegistryId = ''; }
  }

  async function uninstallMcpRegistryEntry(entry: McpRegistryEntryDto): Promise<void> {
    const installed = mcpServers.find((item) => item.url === entry.url && item.editable);
    if (!installed) return;
    installingMcpRegistryId = entry.id;
    try { mcpServers = await api.mcp.removeCustom(installed.id); error = ''; }
    catch (reason) { error = readableError(reason); }
    finally { installingMcpRegistryId = ''; }
  }

  function configureMcpRegistryEntry(entry: McpRegistryEntryDto): void {
    browsingMcpRegistry = false;
    adding = 'mcp';
    editingIntegration = false;
    customMcpId = mcpRegistryLocalId(entry);
    customMcpName = entry.name;
    customMcpDescription = entry.description;
    customMcpTransport = 'streamable-http';
    customMcpTarget = entry.url;
    customMcpEnvironment = entry.requiredHeaders.map((header) => `${header}=`).join('\n');
  }

  /**
   * Reads the other agents' skill directories on this machine. Re-run on every
   * visit rather than cached: skills arrive from another agent's installer at
   * any time, and a stale list is worse than a moment's wait.
   */
  function beginDiscoverSkills(): void {
    skillAddMenuOpen = false;
    adding = null;
    installingSkill = false;
    selectedSkill = '';
    discoveringSkills = true;
    discoveryError = '';
    collapsedGroups = new Set();
    void (async () => {
      discoverySearching = true;
      try {
        discoveredGroups = await api.skills.discover();
        // Folded up, so a machine with several agents opens as a readable list
        // of who has skills rather than a wall of rows. One agent has nothing
        // to survey, so its skills are the answer and stay on show.
        collapsedGroups = discoveredGroups.length > 1
          ? new Set(discoveredGroups.map((group) => group.id))
          : new Set();
      } catch (reason) {
        discoveredGroups = [];
        discoveryError = readableError(reason);
      } finally { discoverySearching = false; }
    })();
  }

  /** Adopting keeps the scan open: a visit is usually about several skills. */
  async function adoptDiscoveredSkill(entry: DiscoveredSkillDto): Promise<void> {
    adoptingPath = entry.path;
    try {
      skills = await api.skills.adopt(entry.path);
      discoveredGroups = await api.skills.discover();
      error = '';
    } catch (reason) { error = readableError(reason); }
    finally { adoptingPath = ''; }
  }

  /**
   * Reads the MCP configuration of every other agent on this machine. Re-run
   * on every visit rather than cached: another agent's servers change under
   * us at any time, and a stale list is worse than a moment's wait.
   */
  function beginDiscoverMcp(): void {
    mcpAddMenuOpen = false;
    adding = null;
    browsingMcpRegistry = false;
    selectedMcp = '';
    discoveringMcp = true;
    mcpDiscoveryError = '';
    collapsedMcpGroups = new Set();
    void (async () => {
      mcpDiscoverySearching = true;
      try {
        discoveredMcpGroups = await api.mcp.discover();
        // Folded up, so a machine with several agents opens as a readable list
        // of who has servers rather than a wall of rows. One agent has nothing
        // to survey, so its servers are the answer and stay on show.
        collapsedMcpGroups = discoveredMcpGroups.length > 1
          ? new Set(discoveredMcpGroups.map((group) => group.id))
          : new Set();
      } catch (reason) {
        discoveredMcpGroups = [];
        mcpDiscoveryError = readableError(reason);
      } finally { mcpDiscoverySearching = false; }
    })();
  }

  /** Adopting keeps the scan open: a visit is usually about several servers. */
  async function adoptDiscoveredMcp(group: DiscoveredMcpGroupDto, entry: DiscoveredMcpDto): Promise<void> {
    adoptingMcpId = `${group.id}:${entry.id}`;
    try {
      mcpServers = await api.mcp.adopt(group.id, entry.id);
      discoveredMcpGroups = await api.mcp.discover();
      error = '';
    } catch (reason) { error = readableError(reason); }
    finally { adoptingMcpId = ''; }
  }

  function beginInstallSkill(): void {
    beginAdd('skills');
    installingSkill = true;
    skillRegistryQuery = '';
    registryError = '';
    // An empty box is not an empty marketplace: the directory's featured
    // skills are there to browse until the first keystroke replaces them.
    searchRegistry(true);
  }

  /** Installing from a directory row keeps the browser open, so several
   * skills can be managed in one visit. */
  async function installRegistryEntry(entry: SkillRegistryEntryDto): Promise<void> {
    installingRegistryId = entry.id;
    try {
      skills = await api.skills.install(entry.id);
      selectedSkill = skills.find((item) => item.name === entry.name)?.name ?? selectedSkill;
      error = '';
    } catch (reason) { error = readableError(reason); }
    finally { installingRegistryId = ''; }
  }

  async function uninstallRegistryEntry(entry: SkillRegistryEntryDto): Promise<void> {
    const installed = skills.find((item) => item.name === entry.name && item.editable);
    if (!installed) return;
    installingRegistryId = entry.id;
    try { skills = await api.skills.removeCustom(installed.name); error = ''; }
    catch (reason) { error = readableError(reason); }
    finally { installingRegistryId = ''; }
  }

  function searchRegistry(immediate = false): void {
    clearTimeout(registryTimer);
    const query = skillRegistryQuery.trim();
    registryLimit = SKILL_REGISTRY_PAGE;
    registryExhausted = false;
    // One character is neither a search the directory accepts nor the empty
    // box that shows its featured skills, so it waits for the second.
    if (query.length === 1) {
      registryResults = [];
      registryError = '';
      return;
    }
    const run = () => void (async () => {
      const request = ++registryRequest;
      registrySearching = true;
      try {
        const results = await api.skills.searchRegistry(query, registryLimit);
        if (request !== registryRequest) return;
        registryResults = results;
        registryExhausted = results.length < registryLimit;
        registryError = '';
      } catch (reason) {
        if (request !== registryRequest) return;
        registryResults = [];
        registryError = readableError(reason);
      } finally {
        if (request === registryRequest) registrySearching = false;
      }
    })();
    if (immediate) run(); else registryTimer = setTimeout(run, 250);
  }

  /** skills.sh answers with a list rather than a page, so the next page is the
   * same search asked for a longer one — replacing what is held rather than
   * appending to it, which is also how the list knows it has reached the end:
   * fewer rows back than asked for means there are no more. */
  function loadMoreSkillRegistry(): void {
    if (registryExhausted || registryLoadingMore || registrySearching || registryError) return;
    if (skillRegistryQuery.trim().length === 1) return;
    const request = registryRequest;
    const limit = registryLimit + SKILL_REGISTRY_PAGE;
    registryLoadingMore = true;
    void (async () => {
      try {
        const results = await api.skills.searchRegistry(skillRegistryQuery.trim(), limit);
        if (request !== registryRequest) return;
        registryExhausted = results.length < limit;
        registryLimit = limit;
        registryResults = results;
      } catch (reason) {
        if (request === registryRequest) registryError = readableError(reason);
      } finally {
        registryLoadingMore = false;
      }
    })();
  }

  function clearSkillRegistrySearch(): void {
    clearTimeout(registryTimer);
    skillRegistryQuery = '';
    registryError = '';
    searchRegistry(true);
  }

  function formatInstalls(installs: number): string {
    if (installs >= 1_000_000) return `${(installs / 1_000_000).toFixed(1)}M`;
    if (installs >= 1_000) return `${(installs / 1_000).toFixed(1)}k`;
    return String(installs);
  }

  async function uploadSkillFolder(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    skillAddMenuOpen = false;
    if (!files.length) return;
    integrationSaving = true;
    try {
      skills = await api.skills.upload(files);
      const rootSkill = files.find((file) => file.webkitRelativePath.split('/').length === 2 && file.name === 'SKILL.md');
      if (rootSkill) {
        const contents = await rootSkill.text();
        selectedSkill = contents.match(/^name:\s*([^\r\n]+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '') ?? selectedSkill;
      }
      adding = null;
      error = '';
    } catch (reason) {
      error = readableError(reason);
    } finally {
      integrationSaving = false;
      input.value = '';
    }
  }

  function editMcp(item: McpServerDto): void {
    adding = 'mcp'; editingIntegration = true; selectedMcp = item.id;
    customMcpId = item.id; customMcpName = item.name; customMcpDescription = item.description ?? ''; customMcpTransport = item.transport;
    customMcpTarget = item.transport === 'stdio' ? item.command ?? '' : item.url ?? '';
    customMcpArgs = (item.args ?? []).join('\n');
    customMcpEnvironment = Object.entries(item.transport === 'stdio' ? item.env ?? {} : item.headers ?? {}).map(([key, value]) => `${key}=${value}`).join('\n');
    customMcpCwd = item.cwd ?? '';
  }

  function editSkill(item: SkillDto): void {
    adding = 'skills'; editingIntegration = true; selectedSkill = item.name;
    customSkillOriginalName = item.name; customSkillName = item.name;
    customSkillDescription = item.description; customSkillInstructions = item.instructions ?? '';
  }

  async function setMcpEnabled(item: McpServerDto): Promise<void> {
    if (mcpUpdatingIds.has(item.id)) return;
    const enabled = !item.enabled;
    mcpUpdatingIds = new Set([...mcpUpdatingIds, item.id]);
    mcpServers = mcpServers.map((candidate) => candidate.id === item.id
      ? {...candidate, enabled, status: enabled ? 'connecting' : 'disconnected'}
      : candidate);
    try {
      mcpServers = await api.mcp.setEnabled(item.id, enabled);
      error = '';
    } catch (reason) {
      mcpServers = mcpServers.map((candidate) => candidate.id === item.id
        ? {...candidate, enabled: item.enabled, status: item.status, error: item.error}
        : candidate);
      error = readableError(reason);
    } finally {
      const next = new Set(mcpUpdatingIds);
      next.delete(item.id);
      mcpUpdatingIds = next;
    }
  }

  async function removeMcp(item: McpServerDto): Promise<void> {
    if (!item.editable || integrationSaving) return;
    integrationSaving = true;
    try {
      mcpServers = await api.mcp.removeCustom(item.id);
      error = '';
    } catch (reason) { error = readableError(reason); }
    finally { integrationSaving = false; }
  }

  async function setSkillEnabled(item: SkillDto): Promise<void> {
    integrationSaving = true;
    try { skills = await api.skills.setEnabled(item.name, !item.enabled); error = ''; }
    catch (reason) { error = readableError(reason); }
    finally { integrationSaving = false; }
  }

  async function removeSkill(item: SkillDto): Promise<void> {
    if (!item.editable || integrationSaving) return;
    integrationSaving = true;
    try {
      skills = await api.skills.removeCustom(item.name);
      selectedSkill = visibleSkills[0]?.name ?? '';
      error = '';
    } catch (reason) { error = readableError(reason); }
    finally { integrationSaving = false; }
  }

  function keyValueLines(value: string): Record<string, string> | undefined {
    const entries = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const separator = line.indexOf('=');
      if (separator < 1) throw new Error(translate('settings.useKeyValue', {line}));
      return [line.slice(0, separator).trim(), line.slice(separator + 1)] as const;
    });
    return entries.length ? Object.fromEntries(entries) : undefined;
  }

  async function saveCustomMcp(): Promise<void> {
    integrationSaving = true;
    try {
      const common = {id: customMcpId.trim(), name: customMcpName.trim(), description: customMcpDescription.trim() || undefined, transport: customMcpTransport};
      mcpServers = await api.mcp.saveCustom(customMcpTransport === 'stdio'
        ? {...common, command: customMcpTarget.trim(), args: customMcpArgs.split(/\r?\n/).map((item) => item.trim()).filter(Boolean), env: keyValueLines(customMcpEnvironment), cwd: customMcpCwd.trim() || undefined}
        : {...common, url: customMcpTarget.trim(), headers: keyValueLines(customMcpEnvironment)});
      adding = null; selectedMcp = common.id; error = '';
    } catch (reason) { error = readableError(reason); }
    finally { integrationSaving = false; }
  }

  async function saveCustomSkill(): Promise<void> {
    integrationSaving = true;
    try {
      skills = await api.skills.saveCustom({originalName: customSkillOriginalName || undefined, name: customSkillName.trim(), description: customSkillDescription.trim(), instructions: customSkillInstructions});
      adding = null; selectedSkill = customSkillName.trim(); error = '';
    } catch (reason) { error = readableError(reason); }
    finally { integrationSaving = false; }
  }

  /** The directory is opened for one job, so a row has nothing left to ask:
   * the click that picks a model is the click that fills the role. */
  function browseForRole(role: ModelRole): void {
    browsingRole = role;
    search = '';
    openRailMenu = null;
    // The directory opens on the only kind of model this job can take, and the
    // rail's own filter says so rather than narrowing behind its back.
    const kind = MODEL_ROLES.find((option) => option.value === role)?.kind;
    if (kind) {
      modelFilter = `kind-${kind}`;
      modelFilterChosen = true;
    }
  }

  function closeModelDirectory(): void {
    browsingRole = '';
    search = '';
    openRailMenu = null;
    // The next job asks its own question, so the filter goes back to following
    // whether anything is configured.
    modelFilter = modelDefaultFilter;
    modelFilterChosen = false;
  }

  /** Models whose provider fixes the effort: asking for a level would only
   * promise something the request cannot carry. Mirrors the composer. */
  const fixedEffortModels = [/-reasoner\b/, /^grok-4(?!.*mini)/, /-pro\b/];

  /** The levels a model can be assigned at, or none when it does not reason or
   * reasons at a level the caller cannot set. */
  function modelEfforts(model: ModelDto): ReasoningEffort[] {
    if (!model.reasoning) return [];
    if (fixedEffortModels.some((pattern) => pattern.test(model.id))) return [];
    return ['off', 'low', 'medium', 'high'];
  }

  function effortLabel(effort: ReasoningEffort): string {
    return effort === 'off'
      ? $t('reasoning.off')
      : effort === 'low'
        ? $t('reasoning.low')
        : effort === 'medium'
          ? $t('reasoning.medium')
          : effort === 'high'
            ? $t('reasoning.high')
            : effort;
  }

  /** Not reasoning, then the levels the model can be held at. The stored "off"
   * is the model not reasoning, which is what None names. */
  function roleEffortOptions(efforts: ReasoningEffort[]): Array<{value: string; label: string}> {
    return [
      {value: 'off', label: $t('reasoning.none')},
      ...efforts.filter((effort) => effort !== 'off').map((effort) => ({value: effort, label: effortLabel(effort)})),
    ];
  }

  /** `roles` is passed in rather than read off the module state so the markup
   * declares its dependency on it and re-renders when an assignment lands. */
  function roleAssignment(role: ModelRole, roles: ModelRolesDto | null) {
    return roles?.[role] ?? null;
  }

  function roleHoldsModel(role: ModelRole, item: ModelDto, roles: ModelRolesDto | null): boolean {
    const assignment = roleAssignment(role, roles);
    return !!assignment && assignment.provider === item.provider && assignment.id === item.id;
  }

  /** What the role runs today, whether it was set or is following main. The
   * roles view reads the model and the level off this. */
  function roleEffective(role: {value: ModelRole; followsMain: boolean}, roles: ModelRolesDto | null) {
    return roleAssignment(role.value, roles) ?? (role.followsMain ? roleAssignment('main', roles) : null);
  }

  /** The catalogue entry behind an assignment, which is what says whether the
   * level can be chosen at all. */
  function roleModel(role: {value: ModelRole; followsMain: boolean}, roles: ModelRolesDto | null, items: ModelDto[]): ModelDto | undefined {
    const assignment = roleEffective(role, roles);
    return assignment ? items.find((item) => item.provider === assignment.provider && item.id === assignment.id) : undefined;
  }

  /** The level a model is worth starting at in a given job: the lightest
   * thinking level is enough for the model the user talks to, and one step up
   * for the jobs that run unattended, where a weak judgement costs a whole
   * extra run. A model that does not reason has no level to start at. */
  function recommendedEffort(role: {followsMain: boolean}, model: ModelDto): ReasoningEffort | undefined {
    const efforts = modelEfforts(model).filter((effort) => effort !== 'off');
    if (!efforts.length) return undefined;
    return role.followsMain ? efforts[1] ?? efforts[0] : efforts[0];
  }

  /** Picking in the directory is the whole gesture: it fills the role it was
   * opened for at the level that model is worth running there, and hands the
   * tab back. Changing that level afterwards is one menu away. */
  async function chooseModelForRole(item: ModelDto): Promise<void> {
    const role = browsingRoleOption;
    if (!role) return;
    await assignModelRole(role.value, item, recommendedEffort(role, item));
    if (!error) closeModelDirectory();
  }

  /** Changing the level keeps the model: a role that follows main is pinned to
   * the model it was already running, which is what the row was showing. */
  async function setRoleEffort(role: {value: ModelRole; followsMain: boolean}, effort: string): Promise<void> {
    const assignment = roleEffective(role, modelRoles);
    if (!assignment) return;
    await assignModelRole(role.value, {provider: assignment.provider, id: assignment.id, name: assignment.name}, effort ? (effort as ReasoningEffort) : undefined);
  }

  async function assignModelRole(role: ModelRole, item: {provider: string; id: string; name: string}, effort?: ReasoningEffort): Promise<void> {
    assigningRole = `${role}:${item.provider}/${item.id}`;
    try {
      modelRoles = await api.models.assignRole(role, item.provider, item.id, effort);
      if (role === 'main') {
        models = await api.models.list();
        selectedModelProvider = modelCompanyId(item);
      }
      error = '';
    } catch (reason) {
      error = readableError(reason);
    } finally {
      assigningRole = '';
    }
  }

  /** The catalogue does not publish output modalities, so the model's own name
   * is the only signal for what kind of model it is. */
  /** The jobs a model can take: a text model can't generate video, an embedding model
   * can't take any of them. */
  function modelRoleOptions(model: ModelDto): typeof MODEL_ROLES {
    const kind = modelKind(model);
    return MODEL_ROLES.filter((role) => role.kind === kind);
  }

  function modelKind(model: ModelDto): ModelKind {
    const key = `${model.id} ${model.name}`.toLocaleLowerCase();
    if (/veo|sora|video|kling|runway|seedance|hailuo|wan-/.test(key)) return 'video';
    if (/imagen|dall-?e|image|flux|diffusion|sdxl|midjourney|seedream|nano-banana/.test(key)) return 'image';
    if (/whisper|tts|audio|speech|voice|realtime|transcribe/.test(key)) return 'audio';
    if (/embed|rerank/.test(key)) return 'embedding';
    return 'text';
  }

  function chooseCredentialProvider(id: string): void {
    addingCustomProvider = false;
    editingCustomProviderId = '';
    selectedCredentialProvider = id;
    credentialKey = '';
    runtimeUrl = providers.find((item) => item.id === id)?.baseUrl ?? '';
    error = '';
  }

  /** Replaces the list rather than adding to it: the server is the authority
   * on what it can serve, and a model it no longer loads should not linger. */
  async function detectCustomProviderModels(): Promise<void> {
    if (!customProviderUrl.trim()) {
      error = translate('settings.customProviderRequired');
      return;
    }
    discoveringModels = true;
    try {
      const detected = await api.providers.discoverModels({
        baseUrl: customProviderUrl.trim(),
        apiKey: customProviderKey.trim() || undefined,
      });
      customProviderModels = detected.map((model) => model.id).join('\n');
      error = detected.length ? '' : translate('settings.noModelsDetected');
    } catch (reason) {
      error = readableError(reason);
    } finally {
      discoveringModels = false;
    }
  }

  /** A known local runtime needs nothing but its address, so setting one up is
   * one button: FlareAI asks the server what it serves and files it under the
   * runtime's own name. */
  async function setupLocalRuntime(provider: ProviderDto): Promise<void> {
    savingCredential = true;
    error = '';
    try {
      const updated = await api.providers.setupLocalRuntime({
        id: provider.id,
        baseUrl: runtimeUrl.trim() || undefined,
      });
      [providers, models] = await Promise.all([api.providers.list(), api.models.list()]);
      selectedCredentialProvider = updated.id;
    } catch (reason) {
      error = readableError(reason);
    } finally {
      savingCredential = false;
    }
  }

  function customProviderModelIdList(text: string): string[] {
    return text.split(/\r?\n/).map((line) => line.split('|', 1)[0]!.trim()).filter(Boolean);
  }

  /** The address is the only thing a local server needs, so leaving that field
   * is the moment to go and ask it what it has — but only when the user has
   * not already put a list in by hand. */
  function detectOnUrlSettled(): void {
    if (!customProviderUrl.trim() || customProviderModels.trim() || discoveringModels) return;
    void detectCustomProviderModels();
  }

  function beginCustomProvider(): void {
    addingCustomProvider = true;
    editingCustomProviderId = '';
    customProviderName = '';
    customProviderUrl = '';
    customProviderKey = '';
    customProviderModels = '';
    customProviderLogoDataUrl = '';
    modelsExpanded = false;
    openRailMenu = null;
    error = '';
  }

  function editCustomProvider(provider: ProviderDto): void {
    addingCustomProvider = true;
    editingCustomProviderId = provider.id;
    customProviderName = provider.name;
    customProviderUrl = provider.baseUrl ?? '';
    customProviderKey = '';
    customProviderLogoDataUrl = provider.logoDataUrl ?? '';
    customProviderModels = models.filter((model) => model.provider === provider.id).map((model) => `${model.id}${model.name !== model.id ? ` | ${model.name}` : ''}`).join('\n');
    modelsExpanded = false;
    error = '';
  }

  async function chooseCustomProviderLogo(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'].includes(file.type) || file.size > 1_000_000) {
      error = translate('settings.imageTooLarge');
      input.value = '';
      return;
    }
    customProviderLogoDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error('Could not read provider image'));
      reader.readAsDataURL(file);
    });
    error = '';
  }

  async function createCustomProvider(): Promise<void> {
    const parsedModels = customProviderModels.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const [id, name] = line.split('|', 2).map((value) => value.trim());
      return {id, name: name || undefined};
    });
    if (!customProviderName.trim() || !customProviderUrl.trim() || parsedModels.length === 0) {
      error = translate('settings.customProviderRequired');
      return;
    }
    savingCredential = true;
    try {
      const payload = {name: customProviderName.trim(), baseUrl: customProviderUrl.trim(), logoDataUrl: customProviderLogoDataUrl || undefined, models: parsedModels};
      const created = editingCustomProviderId
        ? await api.providers.updateCustom({id: editingCustomProviderId, ...payload})
        : await api.providers.createCustom({...payload, apiKey: customProviderKey.trim() || undefined});
      [providers, models] = await Promise.all([api.providers.list(), api.models.list()]);
      selectedCredentialProvider = created.id;
      customProviderName = '';
      customProviderUrl = '';
      customProviderKey = '';
      customProviderModels = '';
      customProviderLogoDataUrl = '';
      addingCustomProvider = false;
      editingCustomProviderId = '';
      error = '';
    } catch (reason) {
      error = readableError(reason);
    } finally {
      savingCredential = false;
    }
  }

  async function saveCredential(): Promise<void> {
    if (!credentialProvider || !credentialKey.trim()) return;
    savingCredential = true;
    try {
      const updated = await api.providers.saveApiKey(credentialProvider.id, credentialKey);
      providers = providers.map((item) => item.id === updated.id ? updated : item);
      models = await api.models.list();
      credentialKey = '';
      error = '';
    } catch (reason) {
      error = readableError(reason);
    } finally {
      savingCredential = false;
    }
  }

  async function removeCredential(keyId: string): Promise<void> {
    if (!credentialProvider) return;
    savingCredential = true;
    try {
      const updated = await api.providers.removeApiKey(credentialProvider.id, keyId);
      providers = providers.map((item) => item.id === updated.id ? updated : item);
      credentialKey = '';
      error = '';
    } catch (reason) {
      error = readableError(reason);
    } finally {
      savingCredential = false;
    }
  }

  function toggleRailMenu(menu: RailMenu): void {
    openRailMenu = openRailMenu === menu ? null : menu;
  }

  function chooseRailOption(menu: RailMenu, value: string): void {
    if (mode === 'mcp') {
      if (menu === 'filter') mcpFilter = value;
      else mcpSort = value;
    } else if (mode === 'skills') {
      if (menu === 'filter') skillFilter = value;
      else skillSort = value;
    } else if (mode === 'plugins') {
      if (menu === 'filter') pluginFilter = value;
      else pluginSort = value;
    } else if (mode === 'model') {
      if (menu === 'filter') {
        modelFilter = value;
        modelFilterChosen = true;
      }
      else modelSort = value;
    } else {
      if (menu === 'filter') providerFilter = value;
      else providerSort = value;
    }
    openRailMenu = null;
  }

  /** Runs on pointerdown, not click: a rail menu should be gone the moment the
   * press lands outside it, not once the button is released. */
  function dismissRailMenu(event: Event): void {
    if (pressKeepsRailMenu(event.target)) return;
    openRailMenu = null;
    skillAddMenuOpen = false;
    mcpAddMenuOpen = false;
    pluginAddMenuOpen = false;
  }

  /**
   * Only the open menu and the button that opened it hold a press. Testing the
   * whole tools row instead would make its blank stretch — which runs the full
   * width of the rail — a dead zone where a press reads as outside the menu but
   * dismisses nothing.
   */
  function pressKeepsRailMenu(target: EventTarget | null): boolean {
    const wrap = target instanceof Element ? target.closest('.rail-tool-wrap') : null;
    return !!wrap?.querySelector('.rail-tool-menu');
  }

  function keydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    if (openRailMenu) {
      event.preventDefault();
      event.stopPropagation();
      openRailMenu = null;
      return;
    }
    if (skillAddMenuOpen || mcpAddMenuOpen) {
      event.preventDefault();
      event.stopPropagation();
      skillAddMenuOpen = false;
      mcpAddMenuOpen = false;
      return;
    }
    onClose();
  }

  function formatTokens(value: number): string {
    return new Intl.NumberFormat(undefined, {notation: 'compact', maximumFractionDigits: 0}).format(value);
  }

  function formatPrice(value: number | null, selectedCurrency: Currency, rates: Partial<Record<Currency, number>>): string {
    if (value === null) return '—';
    const converted = value * (rates[selectedCurrency] ?? 1);
    // Three decimals serve fractional cents; zero is exactly free and reads
    // best as a plain 0.00 rather than 0.000.
    const digits = converted > 0 && converted < 1 ? 3 : 2;
    return `${currencySymbols[selectedCurrency]}${new Intl.NumberFormat('en-US', {minimumFractionDigits: digits, maximumFractionDigits: digits}).format(converted)}`;
  }
</script>

<svelte:window onkeydown={keydown} onpointerdown={dismissRailMenu}/>

<!-- Stands in until a toggle's value has loaded. The real control then mounts
     already showing that value, so its slide only ever means a user click. -->
{#snippet pendingToggle()}<span class="chronicle-toggle pending" aria-hidden="true"><span></span></span>{/snippet}

<!-- One column per kind of source: apps on the left, websites on the right,
     each with its own field so nothing has to be guessed from the text. -->
{#snippet sourceColumn(list: ChronicleList, title: string, rows: Array<{name: string; icon: string | null}>)}
  <div class="chronicle-source-column">
    <header>
      <h5>{title}</h5>
      <span class="chronicle-source-tools">
        <button type="button" class:active={list === 'apps' ? pickingApp : chronicleAdding} aria-label={$t('settings.chronicleAddSource')} data-tooltip-label={$t('settings.chronicleAddSource')} disabled={!memory?.enabled || updatingChronicle || pickingApp} onclick={() => { if (list === 'apps') void pickAppSource(); else chronicleAdding = !chronicleAdding; }}><Icon name="plus" size={14}/></button>
        <button type="button" class:active={chronicleFiltering[list]} aria-label={$t('settings.chronicleSearch')} data-tooltip-label={$t('settings.chronicleSearch')} onclick={() => { chronicleFiltering[list] = !chronicleFiltering[list]; if (!chronicleFiltering[list]) chronicleQuery[list] = ''; }}><Icon name="search" size={14}/></button>
      </span>
    </header>
    <div class="chronicle-source-box">
      {#if chronicleFiltering[list]}
        <div class="chronicle-source-field">
          <Icon name="search" size={13}/>
          <input use:focusInput value={chronicleQuery[list]} placeholder={$t('settings.chronicleSearch')} aria-label={$t('settings.chronicleSearch')} oninput={(event) => (chronicleQuery[list] = event.currentTarget.value)} onkeydown={(event) => { if (event.key === 'Escape') { chronicleQuery[list] = ''; chronicleFiltering[list] = false; } }}/>
        </div>
      {/if}
      <!-- The websites panel adds its row in place: a URL is pasted, so the
           row it lands in is the whole of the interaction. -->
      {#if list === 'sites' && chronicleAdding}
        <form class="chronicle-source-field" onsubmit={(event) => { event.preventDefault(); void addChronicleSource('sites'); chronicleAdding = false; }}>
          <Icon name="globe" size={13}/>
          <input use:focusInput value={chronicleDraft} placeholder={$t('settings.chronicleSitePlaceholder')} aria-label={$t('settings.chronicleAddSource')} disabled={!memory?.enabled || updatingChronicle} oninput={(event) => (chronicleDraft = event.currentTarget.value)} onblur={() => { void addChronicleSource('sites'); chronicleAdding = false; }} onkeydown={(event) => { if (event.key === 'Escape') { chronicleDraft = ''; chronicleAdding = false; } }}/>
        </form>
      {/if}
      <ul class="chronicle-source-list" use:scrollFade={rows.length}>
        {#each rows as row (row.name)}
          {@const source = row.name}
          <li>
            <!-- The mark replaces the glyph in the same slot rather than
                 nesting inside it, so a row with no icon still reads as a row. -->
            {#if row.icon}
              <img class="chronicle-source-icon" src={row.icon} alt="" draggable="false"/>
            {:else}
              <Icon name={list === 'apps' ? 'apps' : 'globe'} size={15}/>
            {/if}
            <span>{source}</span>
            <button type="button" aria-label={$t('settings.chronicleRemoveSource', {name: source})} disabled={updatingChronicle} onclick={() => void removeChronicleSource(list, source)}><Icon name="close" size={12}/></button>
          </li>
        {/each}
      </ul>
    </div>
  </div>
{/snippet}

<!-- A page, not a sheet: it takes the whole window, so the title bar's own drag
     strip is gone and this one stands in for it. -->
<div class="options-page" class:settling={!settled} role="region" aria-label={$t('settings.title')}>
  <div class="options-page-drag" aria-hidden="true"></div>
  <nav class="options-nav" aria-label={$t('settings.tabsLabel')}>
    <!-- Padded past the traffic lights rather than dropped below them, and on
         the same --chrome-inset the chat controls use: full screen takes the
         lights away and both strips move to the window edge together. -->
    <button type="button" class="options-back" onclick={onClose}>
      <Icon name="back" size={16} strokeWidth={1.8}/><span>{$t('settings.backToApp')}</span>
    </button>

    <div class="options-search options-nav-search">
      <Icon name="search" size={15}/>
      <input bind:value={navSearch} type="search" placeholder={$t('settings.searchSettings')} aria-label={$t('settings.searchSettings')}/>
      {#if navSearch}<button type="button" class="search-clear" aria-label={$t('settings.clear')} data-tooltip-label={$t('settings.clear')} onclick={() => navSearch = ''}><Icon name="close" size={13} strokeWidth={1.7}/></button>{/if}
    </div>

    <div class="options-nav-list" role="tablist" use:scrollFade={visibleNavTabs.length} aria-label={$t('settings.tabsLabel')}>
      {#each visibleNavTabs as tab (tab.id)}
        <button type="button" role="tab" class="options-nav-item" aria-selected={mode === tab.id} class:active={mode === tab.id} onclick={() => selectMode(tab.id)}>
          <Icon name={tab.icon} size={16} strokeWidth={1.7}/><span>{tab.label}</span>
        </button>
      {/each}
    </div>

  </nav>

  <div class="options-page-content">
    <header class="options-header">
      <h2>{modeHeader.title}</h2>
      <p>{modeHeader.description}</p>
    </header>

    {#if error}<p class="options-error" role="alert">{error}</p>{/if}

    {#if mode === 'hub'}
      <HubTab {api} />
    {:else if mode === 'drive'}
      <DriveTab {api} />
    {:else if mode === 'browser'}
      <BrowserTab {api} />
    {:else if mode === 'general'}
      <div class="general-options" role="tabpanel" use:scrollFade>
        <section class="general-group">
          <h3>{$t('settings.groupAppearance')}</h3>
          <section class="general-setting-row">
            <span class="option-mark large"><Icon name="sun-moon" size={18}/></span>
            <span class="general-setting-copy"><h4>{$t('settings.theme')}</h4><small>{$t('settings.themeHint')}</small></span>
            <div class="theme-switch" role="radiogroup" aria-label={$t('settings.theme')}>
              {#each [['light', 'settings.themeLight'], ['dark', 'settings.themeDark'], ['system', 'settings.themeSystem']] as const as [theme, label]}
                <button type="button" role="radio" aria-checked={general?.theme === theme} class:active={general?.theme === theme} disabled={updatingTheme || !general} onclick={() => void setTheme(theme as ThemeMode)}>{$t(label)}</button>
              {/each}
            </div>
          </section>
          <section class="general-setting-row">
            <span class="option-mark large"><Icon name="book-open" size={18}/></span>
            <span class="general-setting-copy"><h4>{$t('settings.language')}</h4><small>{$t('settings.languageHint')}</small></span>
            <div class="setting-menu language" class:busy={updatingLanguage || !general}>
              <Menu options={languageOptions} value={general?.language ?? 'system'} label={$t('settings.language')} wide onChange={(value) => void setLanguage(value)}/>
            </div>
          </section>
          <section class="general-setting-row">
            <span class="option-mark large"><Icon name="wrench" size={18}/></span>
            <span class="general-setting-copy"><h4>{$t('settings.advancedMode')}</h4><small>{$t('settings.advancedModeHint')}</small></span>
            {#if general}<button type="button" class:enabled={general.advancedMode} class="chronicle-toggle" role="switch" aria-label={$t('settings.enableAdvancedMode')} aria-checked={general.advancedMode} disabled={updatingAdvancedMode} onclick={() => void setAdvancedMode(!general!.advancedMode)}><span></span></button>{:else}{@render pendingToggle()}{/if}
          </section>
        </section>
        <section class="general-group">
          <h3>{$t('settings.groupVoice')}</h3>
          <section class="general-setting-row">
            <span class="option-mark large"><Icon name="waveform" size={18}/></span>
            <span class="general-setting-copy"><h4>{$t('settings.speechMode')}</h4><small>{$t('settings.speechModeHint')}</small></span>
            {#if general}<button type="button" class:enabled={general.speechModeEnabled} class="chronicle-toggle" role="switch" aria-label={$t('settings.enableSpeechMode')} aria-checked={general.speechModeEnabled} disabled={updatingSpeechMode} onclick={() => void setSpeechModeEnabled(!general!.speechModeEnabled)}><span></span></button>{:else}{@render pendingToggle()}{/if}
          </section>
          <section class="general-setting-row">
            <span class="option-mark large"><Icon name="mic-off" size={18}/></span>
            <span class="general-setting-copy"><h4>{$t('settings.autoStop')}</h4><small>{$t('settings.autoStopHint')}</small></span>
            <div class="setting-menu language" class:busy={updatingAutoStop || !general}>
              <Menu
                options={autoStopOptions}
                value={general?.dictationAutoStopSeconds === null ? 'off' : String(general?.dictationAutoStopSeconds ?? 6)}
                label="Stop dictation when silent"
                wide
                onChange={(value) => void setDictationAutoStop(value)}
              />
            </div>
          </section>
        </section>
        <section class="general-group">
          <h3>{$t('settings.groupPermissions')}</h3>
          <section class="general-setting-row">
            <span class="option-mark large"><Icon name="clock" size={18}/></span>
            <span class="general-setting-copy"><h4>{$t('settings.time')}</h4><small>{general?.timeEnabled ? Intl.DateTimeFormat().resolvedOptions().timeZone : $t('settings.notShared')}</small></span>
            {#if general}<button type="button" class:enabled={general.timeEnabled} class="chronicle-toggle" role="switch" aria-label={$t('settings.enableTime')} aria-checked={general.timeEnabled} disabled={updatingTime} onclick={() => void setTimeEnabled(!general!.timeEnabled)}><span></span></button>{:else}{@render pendingToggle()}{/if}
          </section>
          <section class="general-setting-row">
            <span class="option-mark large"><Icon name="globe" size={18}/></span>
            <span class="general-setting-copy"><h4>{$t('settings.location')}</h4><small>{locationStatusText}</small></span>
            {#if general?.locationEnabled && !locating && (locationError || !general.location)}
              <button type="button" class="permission-retry" onclick={() => void refreshLocation(true)}>{$t('common.tryAgain')}</button>
            {/if}
            {#if general}<button type="button" class:enabled={general.locationEnabled} class="chronicle-toggle" role="switch" aria-label={$t('settings.enableLocation')} aria-checked={general.locationEnabled} disabled={updatingLocation} onclick={() => void setLocationEnabled(!general!.locationEnabled)}><span></span></button>{:else}{@render pendingToggle()}{/if}
          </section>
          {#each PERMISSION_ROWS as row (row.kind)}
            <section class="general-setting-row">
              <span class="option-mark large"><Icon name={row.icon} size={18}/></span>
              <span class="general-setting-copy"><h4>{$t(row.title)}</h4><small>{permissionStatusText(row.kind, row.reason)}</small></span>
              {#if general?.permissions[row.kind] && permissionStatuses[row.kind] !== 'granted'}
                <button type="button" class="permission-retry" disabled={askingPermission === row.kind} onclick={() => void requestPermission(row.kind)}>{$t('permission.allow')}</button>
              {/if}
              {#if general}<button type="button" class:enabled={general.permissions[row.kind]} class="chronicle-toggle" role="switch" aria-label={$t(row.title)} aria-checked={general.permissions[row.kind]} disabled={updatingPermission === row.kind} onclick={() => void setPermissionEnabled(row.kind, !general!.permissions[row.kind])}><span></span></button>{:else}{@render pendingToggle()}{/if}
            </section>
          {/each}
          <section class="general-setting-row">
            <span class="option-mark large"><Icon name="apps" size={18}/></span>
            <span class="general-setting-copy"><h4>{$t('settings.appPermissions')}</h4><small>{$t('settings.appPermissionsHint')}</small></span>
            <button type="button" class="permission-retry" disabled={askingAllPermissions} onclick={() => void requestAllPermissions()}>{$t('permission.askAgain')}</button>
            {#if general}<button type="button" class:enabled={general.appPermissionsEnabled} class="chronicle-toggle" role="switch" aria-label={$t('settings.enableAppPermissions')} aria-checked={general.appPermissionsEnabled} disabled={updatingAppPermissions} onclick={() => void setAppPermissionsEnabled(!general!.appPermissionsEnabled)}><span></span></button>{:else}{@render pendingToggle()}{/if}
          </section>
          <!-- Same arrangement as the notification rows: the master switch
               above owns these, and with it off they grey out rather than
               disappearing, so the choice they will come back to stays
               visible. A row is here only because an installed skill asked
               for it. -->
          <div class="chronicle-group" class:disabled={general ? !general.appPermissionsEnabled : false}>
            {#each appPermissionRows(skills) as row (row.kind)}
              <section class="general-setting-row">
                <span class="option-mark large"><Icon name={row.icon} size={18}/></span>
                <span class="general-setting-copy"><h4>{$t(row.title)}</h4><small>{permissionStatusText(row.kind, row.reason)}</small></span>
                {#if general?.appPermissionsEnabled && general.permissions[row.kind] && permissionStatuses[row.kind] !== 'granted'}
                  <button type="button" class="permission-retry" disabled={askingPermission === row.kind} onclick={() => void requestPermission(row.kind)}>{$t('permission.allow')}</button>
                {/if}
                {#if general}<button type="button" class:enabled={general.permissions[row.kind]} class="chronicle-toggle" role="switch" aria-label={$t(row.title)} aria-checked={general.permissions[row.kind]} disabled={updatingPermission === row.kind} onclick={() => void setPermissionEnabled(row.kind, !general!.permissions[row.kind])}><span></span></button>{:else}{@render pendingToggle()}{/if}
              </section>
            {/each}
          </div>
        </section>
        <section class="general-group">
          <h3>{$t('settings.groupNotifications')}</h3>
          <section class="general-setting-row">
            <span class="option-mark large"><Icon name="bell" size={18}/></span>
            <span class="general-setting-copy"><h4>{$t('settings.notifications')}</h4><small>{notificationsUnsupported ? $t('settings.notificationsUnsupported') : $t('settings.notificationsHint')}</small></span>
            {#if general?.notificationsEnabled}
              <button type="button" class="permission-retry" onclick={() => void sendTestNotification()}>{$t('settings.notificationTest')}</button>
            {/if}
            {#if general}<button type="button" class:enabled={general.notificationsEnabled} class="chronicle-toggle" role="switch" aria-label={$t('settings.enableNotifications')} aria-checked={general.notificationsEnabled} disabled={updatingNotifications === 'all'} onclick={() => void setNotificationsEnabled(!general!.notificationsEnabled)}><span></span></button>{:else}{@render pendingToggle()}{/if}
          </section>
          <!-- The master switch above owns these: with it off they are greyed
               and inert, but keep showing the choice they will come back to. -->
          <div class="chronicle-group" class:disabled={general ? !general.notificationsEnabled : false}>
            {#each NOTIFICATION_ROWS as row (row.kind)}
              <section class="general-setting-row">
                <span class="option-mark large"><Icon name={row.icon} size={18}/></span>
                <span class="general-setting-copy"><h4>{$t(row.title)}</h4><small>{$t(row.hint)}</small></span>
                {#if general}<button type="button" class:enabled={general.notifications[row.kind]} class="chronicle-toggle" role="switch" aria-label={$t(row.title)} aria-checked={general.notifications[row.kind]} disabled={!general.notificationsEnabled || updatingNotifications === row.kind} onclick={() => void setNotificationKind(row.kind, !general!.notifications[row.kind])}><span></span></button>{:else}{@render pendingToggle()}{/if}
              </section>
            {/each}
          </div>
        </section>
        <section class="general-group">
          <h3>{$t('settings.groupAbout')}</h3>
          <!-- Always present, unlike the title-bar chip: once that is dismissed
               this row is the only way back to the install page. It states the
               installed case rather than disappearing, so the setting does not
               look missing to someone who came looking for it. -->
          <section class="general-setting-row">
            <span class="option-mark large"><Icon name="puzzle" size={18}/></span>
            <span class="general-setting-copy"><h4>{$t('extension.title')}</h4><small>{$t('extension.hint')}</small></span>
            {#if extensionStatus?.installed}
              <span class="extension-installed">{$t('extension.installed')}</span>
            {:else}
              <button type="button" class="permission-retry" onclick={() => void openExtensionInstall()}>{$t('extension.install')}</button>
            {/if}
          </section>
          <section class="general-setting-row">
            <span class="option-mark large"><Icon name="verified" size={18}/></span>
            <span class="general-setting-copy"><h4>Version {appVersion?.version ?? '—'}</h4><small>{versionDetailText}</small></span>
            {#if update?.status === 'ready'}
              <button type="button" class="permission-retry" onclick={() => void installUpdate()}>{$t('settings.installNow')}</button>
            {:else}
              <span class="setting-value">{updateSummaryText}</span>
              <button type="button" class="update-refresh" class:spinning={checkingUpdate || update?.status === 'downloading'} aria-label={$t('settings.checkForUpdates')} data-tooltip-label={$t('settings.checkForUpdates')} disabled={checkingUpdate || update?.status === 'downloading'} onclick={() => void checkForUpdates()}><Icon name="reload" size={13}/></button>
            {/if}
          </section>
        </section>
      </div>
    {:else if mode === 'memory'}
      <div class="memory-options" role="tabpanel" use:scrollFade>
        <header class="options-detail-header">
          <span class="options-title-group"><h3>{$t('settings.tabMemory')}</h3></span>
        </header>
        <section class="chronicle-section local-memory-section">
          <header>
            <span><h4>{$t('settings.localMemory')}</h4></span>
            {#if memory}<button type="button" class:enabled={memory.enabled} class="chronicle-toggle" role="switch" aria-label={$t('settings.enableMemory')} aria-checked={memory.enabled} disabled={updatingMemory} onclick={() => void setMemoryEnabled(!memory!.enabled)}><span></span></button>{:else}{@render pendingToggle()}{/if}
          </header>
          <p>{$t('settings.memoryBody')}</p>
          <div class="chronicle-inline-stats" aria-label={$t('settings.memoryStorage')}><span>{plural('settings.memoriesCount', memory?.memories ?? 0)}</span><span>{formatBytes(memory?.storedBytes ?? 0)}</span><span>{$t('settings.memoryLatest', {time: formatMemoryTime(memory?.latestMemoryAt)})}</span><span>{$t('settings.memoryConsolidated', {time: formatMemoryTime(memory?.consolidatedAt)})}</span>{#if (memory?.pendingMemories ?? 0) > 0}<span>{$t('settings.memoryPending', {count: memory?.pendingMemories ?? 0})}</span>{/if}</div>
        </section>
        {#if memory?.consolidationError}
          <section class="chronicle-error">
            <span><h4>{$t('settings.consolidationFailed')}</h4><p>{memory.consolidationError}</p><small>{$t('settings.consolidationFallback')}{#if memory.consolidationRetryAfter}{$t('settings.consolidationRetryAt', {time: formatMemoryTime(memory.consolidationRetryAfter)})}{:else}{$t('settings.consolidationRetryNext')}{/if}</small></span>
          </section>
        {/if}
        <div class="memory-divider"></div>
        <div class="chronicle-group" class:disabled={!memory?.enabled}>
          <section class="chronicle-section">
            <header>
              <span><h4>{$t('settings.chronicle')}</h4>{#if !chronicle?.running}<small>{$t('settings.chronicleOff')}</small>{/if}</span>
              {#if chronicle}<button type="button" class:enabled={chronicle.enabled} class="chronicle-toggle" role="switch" aria-label={$t('settings.enableChronicle')} aria-checked={chronicle.enabled} disabled={!memory?.enabled || updatingChronicle} onclick={() => void setChronicleEnabled(!chronicle!.enabled)}><span></span></button>{:else}{@render pendingToggle()}{/if}
            </header>
            <p>{$t('settings.chronicleBody')}</p>
            <div class="chronicle-inline-stats"><span>{$t('settings.chronicleCaptures', {count: chronicle?.storedFrames ?? 0})}</span><span>{$t('settings.chronicleEvents', {count: chronicle?.storedEvents ?? 0})}</span><span>{formatBytes(chronicle?.storedBytes ?? 0)}</span><span>{$t('settings.chronicleLatest', {time: formatMemoryTime(chronicle?.lastCapturedAt)})}</span><span>{$t('settings.chronicleDistilled', {time: formatMemoryTime(chronicle?.distilledThrough)})}</span></div>
          </section>
          {#if chronicle?.lastError}
            <section class="chronicle-error">
              <span><h4>{$t('settings.captureUnavailable')}</h4><p>{chronicle.lastError}</p><small>{$t('settings.captureHint')}</small></span>
              <button type="button" disabled={!memory?.enabled || updatingChronicle} onclick={() => void retryChronicle()}>{updatingChronicle ? $t('settings.trying') : $t('common.tryAgain')}</button>
            </section>
          {/if}
          <section class="chronicle-section chronicle-sources">
            <header>
              <span><h4>{$t('settings.chroniclePermissions')}</h4></span>
            </header>
            <p>{$t('settings.chroniclePermissionsBody')}</p>
            <div class="chronicle-source-columns">
              {@render sourceColumn('apps', $t('settings.chronicleApps'), appRows)}
              {@render sourceColumn('sites', $t('settings.chronicleSites'), siteRows)}
            </div>
          </section>
          <section class="chronicle-section">
            <header>
              <span><h4>{$t('settings.chroniclePrivateBrowsing')}</h4></span>
              {#if chronicle}<button type="button" class:enabled={chronicle.recordPrivateBrowsing} class="chronicle-toggle" role="switch" aria-label={$t('settings.chroniclePrivateBrowsing')} aria-checked={chronicle.recordPrivateBrowsing} disabled={!memory?.enabled || updatingChronicle} onclick={() => void updateChronicle({recordPrivateBrowsing: !chronicle!.recordPrivateBrowsing})}><span></span></button>{:else}{@render pendingToggle()}{/if}
            </header>
            <p>{$t('settings.chroniclePrivateBrowsingBody')}</p>
          </section>
          <section class="chronicle-section">
            <header>
              <span><h4>{$t('settings.chronicleInteractions')}</h4></span>
              {#if chronicle}<button type="button" class:enabled={chronicle.interactionEvents} class="chronicle-toggle" role="switch" aria-label={$t('settings.chronicleInteractions')} aria-checked={chronicle.interactionEvents} disabled={!memory?.enabled || updatingChronicle} onclick={() => void updateChronicle({interactionEvents: !chronicle!.interactionEvents})}><span></span></button>{:else}{@render pendingToggle()}{/if}
            </header>
            <p>{$t('settings.chronicleInteractionsBody')}</p>
          </section>
          <section class="chronicle-section">
            <header><span><h4>{$t('settings.chronicleForget')}</h4></span></header>
            <p>{$t('settings.chronicleForgetBody')}</p>
            <div class="chronicle-forget">
              <button type="button" disabled={!memory?.enabled || Boolean(forgetting)} onclick={() => void forgetChronicle(1)}>{forgetting === '1' ? $t('settings.trying') : $t('settings.chronicleForgetHour')}</button>
              <button type="button" disabled={!memory?.enabled || Boolean(forgetting)} onclick={() => void forgetChronicle(24)}>{forgetting === '24' ? $t('settings.trying') : $t('settings.chronicleForgetDay')}</button>
              <button type="button" disabled={!memory?.enabled || Boolean(forgetting)} onclick={() => void forgetChronicle(null)}>{forgetting === 'all' ? $t('settings.trying') : $t('settings.chronicleForgetAll')}</button>
            </div>
          </section>
        </div>
        {#if memory}<p class="options-path">{memory.directory}</p>{/if}
      </div>
    {:else if mode === 'model' && !browsingRole}
      <!-- The tab answers what each job runs before it offers a catalogue: the
           roles are the setting, and the directory is only how one of them is
           filled. -->
      <div class="general-options role-options" role="tabpanel" use:scrollFade>
        <section class="general-group">
          <!-- The three columns are named once, at the top, rather than each
               row repeating what its controls are. -->
          <div class="role-columns">
            <span>{$t('settings.columnRole')}</span>
            <span class="role-controls"><span>{$t('composer.reasoning')}</span><span>{$t('settings.columnModel')}</span></span>
          </div>
          {#each MODEL_ROLES as role (role.value)}
            {@const assignment = roleEffective(role, modelRoles)}
            {@const efforts = modelEfforts(roleModel(role, modelRoles, models) ?? ({} as ModelDto))}
            {@const settable = !!assignment && efforts.length > 1}
            <section class="general-setting-row">
              <span class="general-setting-copy"><h4>{role.label}</h4><small>{role.hint}</small></span>
              <span class="role-controls">
                <!-- The level always reads from the same control, so the rows
                     line up: a model that cannot think harder simply has None
                     as its only answer. -->
                <div class="setting-menu role-effort-menu" class:busy={assigningRole !== ''}>
                  <Menu options={settable ? roleEffortOptions(efforts) : [{value: 'off', label: $t('reasoning.none')}]} value={settable ? assignment?.reasoning ?? 'off' : 'off'} label={$t('composer.reasoningFor', {model: assignment?.name ?? role.label})} onChange={(value) => { if (settable) void setRoleEffort(role, value); }}/>
                </div>
                <button type="button" class="role-model" aria-label={$t('settings.roleSet', {model: assignment?.name ?? role.label, job: role.job})} disabled={assigningRole !== ''} onclick={() => browseForRole(role.value)}>
                  <!-- The provider's own mark, as the composer's model picker
                       carries it: the company is read before the name is. -->
                  {#if assignment}<span class="role-model-mark"><ProviderLogo provider={assignment.provider} size={14}/></span>{/if}
                  <span>{assignment?.name ?? $t('settings.setModel')}</span>
                </button>
              </span>
            </section>
          {/each}
        </section>
      </div>
    {:else}
    <div class="options-body">
      <div class="options-rail">
        <div class="options-search">
          <Icon name="search" size={15}/>
          <input bind:value={search} type="search" placeholder={$t('settings.searchIn', {subject: searchRailSubject})} aria-label={$t('settings.searchIn', {subject: searchRailSubject})}/>
          {#if search}<button type="button" class="search-clear" aria-label={$t('settings.clear')} data-tooltip-label={$t('settings.clear')} onclick={() => search = ''}><Icon name="close" size={13} strokeWidth={1.7}/></button>{/if}
        </div>

        <ul class="options-rail-list" class:empty-state={railEmpty} use:scrollFade={railContentKey}>
          {#if mode === 'mcp'}
            {#each visibleMcp as item (item.id)}
              <li><button type="button" class:selected={adding !== 'mcp' && item.id === selectedMcp} class:integration-disabled={!item.enabled} class="options-rail-row" onclick={() => selectMcp(item.id)}>
                <span class="options-rail-copy"><span class="skill-name-line"><strong>{item.name}</strong>{#if item.source === 'official'}<span class="official-rail-stamp" aria-label={$t('settings.official')}><Icon name="verified" size={13} strokeWidth={1.8}/></span>{/if}</span><small>{mcpAuthor(item)} · <span class="state-text" data-state={item.status}>{mcpStatus(item)}</span></small></span>
              </button></li>
            {:else}<li class="options-empty rail-empty">{loading ? $t('settings.loadingMcp') : !query && mcpServers.length === 0 ? $t('settings.noMcpYet') : $t('settings.noMcpFound')}</li>{/each}
          {:else if mode === 'skills'}
            {#each visibleSkills as item (item.name)}
              <li><button type="button" class:selected={adding !== 'skills' && item.name === selectedSkill} class:integration-disabled={!item.enabled} class="options-rail-row" onclick={() => selectSkill(item.name)}>
                <span class="options-rail-copy"><span class="skill-name-line"><strong>{skillTitle(item)}</strong>{#if item.source === 'official'}<span class="official-rail-stamp" aria-label={$t('settings.official')}><Icon name="verified" size={13} strokeWidth={1.8}/></span>{/if}</span><small>{skillAuthor(item)} · <span class="state-text" data-state={item.enabled ? 'active' : 'inactive'}>{item.enabled ? $t('settings.active') : $t('settings.inactive')}</span></small></span>
              </button></li>
            {:else}<li class="options-empty rail-empty">{loading ? $t('settings.loadingSkills') : !query && skills.length === 0 ? $t('settings.noSkillsYet') : $t('settings.noSkillsFound')}</li>{/each}
          {:else if mode === 'plugins'}
            {#each visiblePlugins as item (item.id)}
              <li><button type="button" class:selected={adding !== 'plugins' && !browsingPluginMarketplace && item.id === selectedPlugin} class:integration-disabled={!item.enabled} class="options-rail-row" onclick={() => selectPlugin(item.id)}>
                <span class="options-rail-copy"><span class="skill-name-line"><strong>{item.name}</strong>{#if item.conflicts.length || item.error}<span class="plugin-rail-stamp" aria-label={$t('settings.pluginConflicts')}><Icon name="info" size={13} strokeWidth={1.8}/></span>{/if}</span><small>{item.marketplaceName} · <span class="state-text" data-state={item.enabled ? 'active' : 'inactive'}>{item.enabled ? $t('settings.active') : $t('settings.inactive')}</span></small></span>
              </button></li>
            {:else}<li class="options-empty rail-empty">{loading ? $t('settings.loadingPlugins') : !query && plugins.length === 0 ? $t('settings.noPluginsYet') : $t('settings.noPluginsFound')}</li>{/each}
          {:else if mode === 'model'}
            {#each modelCompanies as company (company.id)}
              <li><button type="button" class:selected={company.id === selectedModelProvider} class="options-rail-row provider-row" onclick={() => selectModelCompany(company.id)}>
                <span class="provider-mark"><ProviderLogo provider={company.id} logoDataUrl={company.logoDataUrl} size={18}/></span>
                <span class="options-rail-copy"><span class="options-name"><strong>{company.name}</strong></span><small>{company.models.length} {company.models.length === 1 ? 'model' : 'models'}</small></span>
              </button></li>
            {:else}<li class="options-empty rail-empty">{loading ? $t('settings.loadingCompanies') : $t('settings.noCompaniesFound')}</li>{/each}
          {:else}
            {#each visibleProviders as item (item.id)}
              <li><button type="button" class:selected={!addingCustomProvider && item.id === selectedCredentialProvider} class:has-check={!item.custom && item.configured} class="options-rail-row provider-row" onclick={() => chooseCredentialProvider(item.id)}>
                <span class="provider-mark"><ProviderLogo provider={item.id} logoDataUrl={item.logoDataUrl} size={18}/></span>
                <span class="options-rail-copy"><span class="options-name"><strong>{item.name}</strong>{#if item.custom && !item.localRuntime}<i>{$t('settings.custom')}</i>{/if}</span><small>{plural('settings.modelCount', item.modelCount)}</small></span>
                {#if !item.custom && item.configured}<span class="configured-check" aria-label={$t('settings.configured')}><Icon name="check" size={13}/></span>{/if}
              </button></li>
            {:else}<li class="options-empty rail-empty">{loading ? $t('settings.loadingProviders') : $t('settings.noProvidersFound')}</li>{/each}
          {/if}
        </ul>

        <div class="options-rail-tools">
            <div class="rail-tool-wrap">
              <button type="button" class:active={activeRailFilter !== activeRailDefaultFilter} class="rail-tool" aria-label={$t('settings.filterSubject', {subject: activeRailSubject})} aria-haspopup="menu" aria-expanded={openRailMenu === 'filter'} data-tooltip-label={$t('drive.filter')} onclick={() => toggleRailMenu('filter')}><Icon name="filter" size={15}/></button>
              {#if openRailMenu === 'filter'}
                <div class="flareai-dropdown-menu rail-tool-menu" role="menu" aria-label={$t('settings.filterSubject', {subject: activeRailSubject})}>
                  {#each activeRailFilterOptions as option (option.value)}
                    <button type="button" class="flareai-dropdown-item" role="menuitemradio" aria-checked={option.value === activeRailFilter} onclick={() => chooseRailOption('filter', option.value)}><span>{option.label}</span>{#if option.value === activeRailFilter}<Icon name="check" size={13}/>{/if}</button>
                  {/each}
                </div>
              {/if}
            </div>
            <div class="rail-tool-wrap">
              <button type="button" class:active={activeRailSort !== activeRailDefaultSort} class="rail-tool" aria-label={$t('settings.sortSubject', {subject: activeRailSubject})} aria-haspopup="menu" aria-expanded={openRailMenu === 'sort'} data-tooltip-label={$t('hub.sort')} onclick={() => toggleRailMenu('sort')}><Icon name="sort" size={15}/></button>
              {#if openRailMenu === 'sort'}
                <div class="flareai-dropdown-menu rail-tool-menu" role="menu" aria-label={$t('settings.sortSubject', {subject: activeRailSubject})}>
                  {#each activeRailSortOptions as option (option.value)}
                    <button type="button" class="flareai-dropdown-item" role="menuitemradio" aria-checked={option.value === activeRailSort} onclick={() => chooseRailOption('sort', option.value)}><span>{option.label}</span>{#if option.value === activeRailSort}<Icon name="check" size={13}/>{/if}</button>
                  {/each}
                </div>
              {/if}
            </div>
            <!-- The directory was opened from a role, so the way back belongs
                 with the rail's own controls rather than in the pane it fills. -->
            {#if mode === 'model' && browsingRoleOption}
              <button type="button" class="rail-tool rail-tool-text" onclick={closeModelDirectory}>{$t('settings.backToRoles')}</button>
            {/if}
            {#if mode === 'mcp'}
              <button type="button" class:active={browsingMcpRegistry} class="rail-tool" aria-label={$t('settings.browseMcpMarketplace')} data-tooltip-label={$t('settings.mcpMarketplace')} onclick={beginMcpMarketplace}><Icon name="storefront" size={15}/></button>
              <div class="rail-tool-wrap">
                <button type="button" class:active={adding === 'mcp' || mcpAddMenuOpen} class="rail-tool" aria-label={$t('settings.addMcpServer')} aria-haspopup="menu" aria-expanded={mcpAddMenuOpen} data-tooltip-label={$t('settings.addMcpServer')} onclick={() => { openRailMenu = null; mcpAddMenuOpen = !mcpAddMenuOpen; }}><Icon name="plus" size={15}/></button>
                {#if mcpAddMenuOpen}
                  <div class="flareai-dropdown-menu rail-tool-menu skill-add-menu" role="menu" aria-label={$t('settings.addMcpServer')}>
                    <button type="button" class="flareai-dropdown-item" role="menuitem" onclick={() => beginAdd('mcp')}><span>{$t('settings.createCustom')}</span></button>
                    <button type="button" class="flareai-dropdown-item" role="menuitem" onclick={beginDiscoverMcp}><span>{$t('settings.autoDiscovery')}</span></button>
                  </div>
                {/if}
              </div>
            {:else if mode === 'skills'}
              <button type="button" class:active={installingSkill} class="rail-tool" aria-label={$t('settings.installFromVercel')} data-tooltip-label={$t('settings.vercelSkills')} onclick={beginInstallSkill}><Icon name="storefront" size={15}/></button>
              <div class="rail-tool-wrap">
                <button type="button" class:active={adding === 'skills' || skillAddMenuOpen} class="rail-tool" aria-label={$t('settings.addSkills')} aria-haspopup="menu" aria-expanded={skillAddMenuOpen} data-tooltip-label={$t('settings.addSkills')} onclick={() => { openRailMenu = null; skillAddMenuOpen = !skillAddMenuOpen; }}><Icon name="plus" size={15}/></button>
                {#if skillAddMenuOpen}
                  <div class="flareai-dropdown-menu rail-tool-menu skill-add-menu" role="menu" aria-label={$t('settings.addSkills')}>
                    <button type="button" class="flareai-dropdown-item" role="menuitem" onclick={() => beginAdd('skills')}><span>{$t('settings.createCustom')}</span></button>
                    <button type="button" class="flareai-dropdown-item" role="menuitem" onclick={beginDiscoverSkills}><span>{$t('settings.autoDiscovery')}</span></button>
                    <button type="button" class="flareai-dropdown-item" role="menuitem" onclick={() => skillFolderInput.click()}><span>{$t('settings.uploadSkills')}</span></button>
                    <input bind:this={skillFolderInput} class="skill-folder-input" type="file" webkitdirectory multiple aria-label={$t('settings.uploadSkillFolder')} onchange={(event) => void uploadSkillFolder(event)}/>
                  </div>
                {/if}
              </div>
            {:else if mode === 'plugins'}
              <button type="button" class:active={browsingPluginMarketplace} class="rail-tool" aria-label={$t('settings.browsePluginMarketplace')} data-tooltip-label={$t('settings.pluginMarketplace')} onclick={beginPluginMarketplace}><Icon name="storefront" size={15}/></button>
              <div class="rail-tool-wrap">
                <button type="button" class:active={adding === 'plugins' || pluginAddMenuOpen} class="rail-tool" aria-label={$t('settings.addPlugins')} aria-haspopup="menu" aria-expanded={pluginAddMenuOpen} data-tooltip-label={$t('settings.addPlugins')} onclick={() => { openRailMenu = null; pluginAddMenuOpen = !pluginAddMenuOpen; }}><Icon name="plus" size={15}/></button>
                {#if pluginAddMenuOpen}
                  <div class="flareai-dropdown-menu rail-tool-menu skill-add-menu" role="menu" aria-label={$t('settings.addPlugins')}>
                    <button type="button" class="flareai-dropdown-item" role="menuitem" onclick={() => beginAdd('plugins')}><span>{$t('settings.addMarketplace')}</span></button>
                    <button type="button" class="flareai-dropdown-item" role="menuitem" onclick={() => pluginFolderInput.click()}><span>{$t('settings.uploadPlugin')}</span></button>
                    <input bind:this={pluginFolderInput} class="skill-folder-input" type="file" webkitdirectory multiple aria-label={$t('settings.uploadPluginFolder')} onchange={(event) => void uploadPluginFolder(event)}/>
                  </div>
                {/if}
              </div>
            {/if}
            {#if mode === 'provider'}
              <button type="button" class:active={addingCustomProvider} class="rail-tool" aria-label={$t('settings.addCustomProvider')} data-tooltip-label={$t('settings.addCustomProvider')} onclick={beginCustomProvider}><Icon name="plus" size={15}/></button>
            {/if}
          </div>
      </div>

      <div class:directory-open={(mode === 'skills' && (discoveringSkills || (adding === 'skills' && installingSkill))) || (mode === 'mcp' && (browsingMcpRegistry || discoveringMcp)) || (mode === 'plugins' && browsingPluginMarketplace)} class:plugin-detail={mode === 'plugins' && !!plugin && !adding && !browsingPluginMarketplace} class:mcp-detail={mode === 'mcp' && !!mcp && !adding && !browsingMcpRegistry && !discoveringMcp} class:skill-detail={mode === 'skills' && !!skill && !adding} class:model-detail={mode === 'model' && !!modelCompany} class="options-detail" role="tabpanel" use:scrollFade={mode}>
        {#if mode === 'plugins' && browsingPluginMarketplace}
          <header class="options-detail-header"><span class="options-title-group"><h3>{$t('settings.pluginMarketplace')}</h3></span></header>
          <section class="skill-registry">
            <div class="model-search">
              <Icon name="search" size={14}/>
              <input bind:value={pluginCatalogQuery} type="search" placeholder={$t('settings.searchPluginMarketplace')} aria-label={$t('settings.searchPluginMarketplace')} spellcheck="false" oninput={searchPluginMarketplace}/>
              {#if pluginCatalogQuery}<button type="button" class="search-clear" aria-label={$t('settings.clear')} data-tooltip-label={$t('settings.clear')} onclick={clearPluginMarketplaceSearch}><Icon name="close" size={13} strokeWidth={1.7}/></button>{/if}
            </div>
            <ul class="skill-registry-results" use:scrollFade={pluginCatalog} onscroll={(event) => onMarketplaceScroll(event, () => pluginCatalogVisible = Math.min(pluginCatalog.length, pluginCatalogVisible + CATALOG_PAGE))}>
              {#each pluginCatalog.slice(0, pluginCatalogVisible) as entry (entry.id)}
                <li>
                  <span class="skill-registry-copy"><strong>{entry.name}</strong><small>{entry.description || $t('settings.noDescription')}</small></span>
                  {#if entry.installed}
                    <span class="skill-registry-installed">{$t('settings.installed')}</span>
                  {:else}
                    <button type="button" class="permission-retry" disabled={installingPluginId !== ''} onclick={() => void installPlugin(entry)}>{installingPluginId === entry.id ? $t('settings.installing') : $t('settings.install')}</button>
                  {/if}
                </li>
              {:else}
                <li class="skill-registry-empty">{pluginCatalogSearching ? $t('settings.searching') : pluginCatalogError || (pluginCatalogQuery.trim() ? $t('settings.noPluginsMatched') : $t('settings.noPluginsListed'))}</li>
              {/each}
              {#if pluginCatalogVisible < pluginCatalog.length}<li class="skill-registry-more">{$t('settings.searching')}</li>{/if}
            </ul>
            <div class="custom-provider-actions"><button type="button" onclick={() => { browsingPluginMarketplace = false; selectedPlugin = visiblePlugins[0]?.id ?? ''; }}>{$t('settings.done')}</button></div>
          </section>
        {:else if mode === 'plugins' && adding === 'plugins'}
          <header class="options-detail-header"><span class="option-mark large"><Icon name="plus" size={18}/></span><span class="options-title-group"><h3>{$t('settings.addMarketplace')}</h3></span></header>
          <section class="skill-registry">
            <p class="discovery-lede">{$t('settings.marketplaceLede')} <code>.claude-plugin/marketplace.json</code>{$t('settings.marketplaceLedeTail')}</p>
            <form class="custom-integration-form" onsubmit={(event) => { event.preventDefault(); void addPluginMarketplace(); }}>
              <label>{$t('settings.marketplaceRepository')}<input bind:value={pluginMarketplaceSource} placeholder="anthropics/claude-code" spellcheck="false" required/></label>
              <div class="custom-provider-actions"><button type="button" onclick={() => adding = null}>{$t('common.cancel')}</button><button class="credential-primary" type="submit" disabled={addingPluginMarketplace || !pluginMarketplaceSource.trim()}>{addingPluginMarketplace ? $t('settings.adding') : $t('settings.add')}</button></div>
            </form>
            <ul class="skill-registry-results" use:scrollFade={pluginMarketplaces}>
              {#each pluginMarketplaces as entry (entry.id)}
                <li>
                  <span class="skill-registry-copy"><strong>{entry.name}</strong><small>{entry.source}</small></span>
                  {#if entry.builtin}
                    <span class="skill-registry-installed">{$t('settings.builtIn')}</span>
                  {:else}
                    <button type="button" class="permission-retry" disabled={addingPluginMarketplace} onclick={() => void removePluginMarketplace(entry)}>{$t('settings.removeMarketplace')}</button>
                  {/if}
                </li>
              {:else}<li class="skill-registry-empty">{$t('settings.noMarketplaces')}</li>{/each}
            </ul>
          </section>
        {:else if mode === 'plugins' && plugin}
          <header class="options-detail-header">
            <span class="options-title-group"><h3>{plugin.name}</h3>{#if plugin.version}<span class="options-badge"><span>{plugin.version}</span></span>{/if}</span>
            <div class="skill-detail-actions">
              <button type="button" class="provider-edit destructive" aria-label={$t('settings.removePlugin')} disabled={integrationSaving} onclick={() => void removePlugin(plugin)}><Icon name="trash" size={14}/></button>
              <button type="button" class:enabled={plugin.enabled} class="chronicle-toggle" role="switch" aria-label={$t('settings.enablePlugin')} aria-checked={plugin.enabled} disabled={integrationSaving} onclick={() => void setPluginEnabled(plugin)}><span></span></button>
            </div>
          </header>
          <section class="options-detail-block"><h4>{$t('settings.description')}</h4><p class="skill-description">{plugin.description || $t('settings.noDescription')}</p></section>
          {#if plugin.error}<p class="plugin-warning">{plugin.error}</p>{/if}
          <section class="options-detail-block">
            <h4>{$t('settings.details')}</h4>
            <dl class="skill-meta">
              <div><dt>{$t('settings.author')}</dt><dd>{plugin.author ?? $t('settings.unknownAuthor')}</dd></div>
              <div><dt>{$t('settings.marketplace')}</dt><dd>{plugin.marketplaceName}</dd></div>
              <div><dt>{$t('settings.version')}</dt><dd>{plugin.version ?? '—'}</dd></div>
              <div><dt>{$t('settings.availability')}</dt><dd>{plugin.enabled ? $t('settings.enabled') : $t('settings.disabled')}</dd></div>
            </dl>
          </section>
          {#if plugin.conflicts.length}
            <section class="options-detail-block">
              <h4>{$t('settings.pluginConflicts')}</h4>
              <ul class="plugin-conflicts">
                {#each plugin.conflicts as conflict (`${conflict.kind}:${conflict.name}`)}
                  <li><Icon name="info" size={13} strokeWidth={1.8}/><span>{conflict.kind === 'skill' ? $t('settings.pluginConflictSkill', {name: conflict.name}) : $t('settings.pluginConflictMcp', {name: conflict.name})}</span></li>
                {/each}
              </ul>
              <p class="plugin-conflict-note">{$t('settings.pluginConflictsHint')}</p>
            </section>
          {/if}
          <div class="options-resources">
            <section><header><h4>{$t('settings.tabSkills')}</h4><span>{plugin.contributions.skills.length}</span></header><ul use:scrollFade={plugin.contributions.skills}>{#each plugin.contributions.skills as name}<li><Icon name="sparkles" size={14}/>{name}</li>{:else}<li class="muted">{$t('settings.pluginNoSkills')}</li>{/each}</ul></section>
            <section><header><h4>MCP</h4><span>{plugin.contributions.mcpServers.length}</span></header><ul use:scrollFade={plugin.contributions.mcpServers}>{#each plugin.contributions.mcpServers as name}<li><Icon name="mcp" size={14}/>{name}</li>{:else}<li class="muted">{$t('settings.pluginNoMcp')}</li>{/each}</ul></section>
          </div>
          {#if plugin.contributions.commands || plugin.contributions.agents || plugin.contributions.hooks}
            <!-- Counted rather than listed: FlareAI has no surface for these
                 yet, and a list would imply they run. -->
            <p class="plugin-unsupported">{$t('settings.pluginUnsupported', {parts: [
              plugin.contributions.commands ? plural('settings.pluginCommands', plugin.contributions.commands) : '',
              plugin.contributions.agents ? plural('settings.pluginAgents', plugin.contributions.agents) : '',
              plugin.contributions.hooks ? plural('settings.pluginHooks', plugin.contributions.hooks) : '',
            ].filter(Boolean).join(' · ')})}</p>
          {/if}
          <p class="options-path">{plugin.directory}</p>
        {:else if mode === 'mcp' && browsingMcpRegistry}
          <header class="options-detail-header"><span class="options-title-group"><h3>MCP Marketplace</h3></span></header>
          <section class="skill-registry">
            <div class="model-search">
              <Icon name="search" size={14}/>
              <input bind:value={mcpRegistryQuery} type="search" placeholder={$t('settings.searchMcpMarketplace')} aria-label={$t('settings.searchMcpMarketplace')} spellcheck="false" oninput={() => searchMcpMarketplace()}/>
              {#if mcpRegistryQuery}<button type="button" class="search-clear" aria-label={$t('settings.clear')} data-tooltip-label={$t('settings.clear')} onclick={clearMcpMarketplaceSearch}><Icon name="close" size={13} strokeWidth={1.7}/></button>{/if}
            </div>
            <ul class="skill-registry-results" use:scrollFade onscroll={(event) => onMarketplaceScroll(event, loadMoreMcpMarketplace)}>
              {#each mcpRegistryResults as entry (entry.id)}
                <li>
                  <span class="skill-registry-copy"><strong>{entry.name}</strong><small>{entry.description}</small></span>
                  {#if mcpServers.some((item) => item.url === entry.url && item.editable)}
                    <button type="button" class="permission-retry" disabled={installingMcpRegistryId !== ''} onclick={() => void uninstallMcpRegistryEntry(entry)}>{installingMcpRegistryId === entry.id ? $t('settings.uninstalling') : $t('settings.uninstall')}</button>
                  {:else if mcpServers.some((item) => item.url === entry.url)}
                    <span class="skill-registry-installed">{$t('settings.installed')}</span>
                  {:else if entry.requiredHeaders.length}
                    <button type="button" class="permission-retry" onclick={() => configureMcpRegistryEntry(entry)}>{$t('settings.configure')}</button>
                  {:else}
                    <button type="button" class="permission-retry" disabled={installingMcpRegistryId !== ''} onclick={() => void installMcpRegistryEntry(entry)}>{installingMcpRegistryId === entry.id ? $t('settings.installing') : $t('settings.install')}</button>
                  {/if}
                </li>
              {:else}
                <li class="skill-registry-empty">{mcpRegistrySearching ? $t('settings.searching') : mcpRegistryError || $t('settings.noRemoteMcp')}</li>
              {/each}
              {#if mcpRegistryResults.length && mcpRegistryCursor}<li class="skill-registry-more">{$t('settings.searching')}</li>{/if}
            </ul>
            <div class="custom-provider-actions"><button type="button" onclick={() => { browsingMcpRegistry = false; selectedMcp = visibleMcp[0]?.id ?? ''; }}>{$t('settings.done')}</button></div>
          </section>
        {:else if mode === 'mcp' && adding === 'mcp'}
          <header class="options-detail-header"><span class="option-mark large"><Icon name={editingIntegration ? 'edit' : 'plus'} size={18}/></span><span class="options-title-group"><h3>{editingIntegration ? $t('settings.editMcpServer') : $t('settings.addMcpServer')}</h3></span></header>
          <form class="custom-integration-form" onsubmit={(event) => { event.preventDefault(); void saveCustomMcp(); }}>
            <label>{$t('settings.serverId')}<input bind:value={customMcpId} disabled={editingIntegration} placeholder="my-server" required/></label>
            <label>{$t('settings.name')}<input bind:value={customMcpName} placeholder={$t('settings.serverNamePlaceholder')} required/></label>
            <label>{$t('settings.description')}<input bind:value={customMcpDescription} placeholder={$t('settings.mcpDescriptionPlaceholder')}/></label>
            <label>{$t('settings.transport')}<select bind:value={customMcpTransport}><option value="stdio">{$t('settings.localCommand')}</option><option value="streamable-http">{$t('settings.remoteHttp')}</option></select></label>
            <label>{customMcpTransport === 'stdio' ? $t('settings.command') : $t('settings.url')}<input bind:value={customMcpTarget} placeholder={customMcpTransport === 'stdio' ? 'node' : 'https://example.com/mcp'} required/></label>
            {#if customMcpTransport === 'stdio'}<label>{$t('settings.arguments')}<textarea bind:value={customMcpArgs} placeholder={$t('settings.argumentsPlaceholder')}></textarea></label><label>{$t('settings.workingDirectory')}<input bind:value={customMcpCwd} placeholder={$t('settings.optional')}/></label>{/if}
            <label>{customMcpTransport === 'stdio' ? $t('settings.environment') : $t('settings.headers')}<textarea bind:value={customMcpEnvironment} placeholder={$t('settings.keyValuePlaceholder')}></textarea></label>
            <div class="custom-provider-actions"><button type="button" onclick={() => adding = null}>{$t('common.cancel')}</button><button class="credential-primary" type="submit" disabled={integrationSaving}>{integrationSaving ? $t('hub.saving') : $t('common.save')}</button></div>
          </form>
        {:else if mode === 'mcp' && discoveringMcp}
          <header class="options-detail-header"><span class="options-title-group"><h3>{$t('settings.autoDiscovery')}</h3></span></header>
          <section class="skill-registry">
            <p class="discovery-lede">{$t('settings.mcpDiscoveryLede')} <code>~/.flareai/mcp.json</code>{$t('settings.discoveryLedeTail')}</p>
            <div class="discovery-groups" use:scrollFade={collapsedMcpGroups}>
              {#each discoveredMcpGroups as group (group.id)}
                <section class="discovery-group">
                  <button type="button" class="discovery-group-header" aria-expanded={!collapsedMcpGroups.has(group.id)} onclick={() => toggleMcpGroup(group.id)}>
                    <span class="discovery-group-heading"><h4>{group.label}</h4><code>{group.path}</code></span>
                    <span class="discovery-count">{group.servers.length} {group.servers.length === 1 ? $t('settings.serverOne') : $t('settings.serverMany')}</span>
                    <span class:collapsed={collapsedMcpGroups.has(group.id)} class="discovery-chevron"><Icon name="chevron" size={17} strokeWidth={1.5}/></span>
                  </button>
                  <ul class:collapsed={collapsedMcpGroups.has(group.id)} class="skill-registry-results discovery-list">
                    {#each group.servers as entry (entry.id)}
                      <li>
                        <span class="skill-registry-copy"><strong>{entry.name}</strong><small>{entry.target}</small></span>
                        {#if entry.state === 'loaded'}
                          <span class="skill-registry-installed">{$t('settings.inUse')}</span>
                        {:else}
                          <button type="button" class="permission-retry" disabled={adoptingMcpId !== ''} onclick={() => void adoptDiscoveredMcp(group, entry)}>{adoptingMcpId === `${group.id}:${entry.id}` ? $t('settings.adding') : $t('settings.add')}</button>
                        {/if}
                      </li>
                    {/each}
                  </ul>
                </section>
              {:else}
                <p class="discovery-empty">{mcpDiscoverySearching ? $t('settings.scanning') : mcpDiscoveryError ? mcpDiscoveryError : $t('settings.noDiscoveredMcp')}</p>
              {/each}
            </div>
            <div class="custom-provider-actions"><button type="button" onclick={() => { discoveringMcp = false; selectedMcp = visibleMcp[0]?.id ?? ''; }}>{$t('settings.done')}</button></div>
          </section>
        {:else if mode === 'skills' && discoveringSkills}
          <header class="options-detail-header"><span class="options-title-group"><h3>{$t('settings.autoDiscovery')}</h3></span></header>
          <section class="skill-registry">
            <p class="discovery-lede">{$t('settings.discoveryLede')} <code>~/.flareai/skills</code>{$t('settings.discoveryLedeTail')}</p>
            <div class="discovery-groups" use:scrollFade={collapsedGroups}>
              {#each discoveredGroups as group (group.id)}
                <section class="discovery-group">
                  <button type="button" class="discovery-group-header" aria-expanded={!collapsedGroups.has(group.id)} onclick={() => toggleGroup(group.id)}>
                    <span class="discovery-group-heading"><h4>{group.label}</h4><code>{group.directory}</code></span>
                    <span class="discovery-count">{group.skills.length} {group.skills.length === 1 ? 'skill' : 'skills'}</span>
                    <span class:collapsed={collapsedGroups.has(group.id)} class="discovery-chevron"><!--
                      Stroke width scales with the icon's box, so a 17px mark
                      at the 1.7 default would draw heavier than the 15px rail
                      tools. 1.5 lands it on the same painted thickness.
                    --><Icon name="chevron" size={17} strokeWidth={1.5}/></span>
                  </button>
                  <ul class:collapsed={collapsedGroups.has(group.id)} class="skill-registry-results discovery-list">
                    {#each group.skills as entry (entry.path)}
                      <li>
                        <span class="skill-registry-copy"><strong>{entry.name}</strong><small>{entry.path}</small></span>
                        {#if entry.state === 'loaded'}
                          <span class="skill-registry-installed">{$t('settings.inUse')}</span>
                        {:else}
                          <button type="button" class="permission-retry" disabled={adoptingPath !== ''} onclick={() => void adoptDiscoveredSkill(entry)}>{adoptingPath === entry.path ? $t('settings.adding') : $t('settings.add')}</button>
                        {/if}
                      </li>
                    {/each}
                  </ul>
                </section>
              {:else}
                <p class="discovery-empty">{discoverySearching ? $t('settings.scanning') : discoveryError ? discoveryError : $t('settings.noDiscoveredSkills')}</p>
              {/each}
            </div>
            <div class="custom-provider-actions"><button type="button" onclick={() => { discoveringSkills = false; selectedSkill = visibleSkills[0]?.name ?? ''; }}>{$t('settings.done')}</button></div>
          </section>
        {:else if mode === 'skills' && adding === 'skills' && installingSkill}
          <header class="options-detail-header"><span class="options-title-group"><h3>{$t('settings.vercelSkills')}</h3></span></header>
          <section class="skill-registry">
            <div class="model-search">
              <Icon name="search" size={14}/>
              <input bind:value={skillRegistryQuery} type="search" placeholder={$t('settings.searchVercelSkills')} aria-label={$t('settings.searchVercelSkills')} spellcheck="false" oninput={() => searchRegistry()}/>
              {#if skillRegistryQuery}<button type="button" class="search-clear" aria-label={$t('settings.clear')} data-tooltip-label={$t('settings.clear')} onclick={clearSkillRegistrySearch}><Icon name="close" size={13} strokeWidth={1.7}/></button>{/if}
            </div>
            <ul class="skill-registry-results" use:scrollFade onscroll={(event) => onMarketplaceScroll(event, loadMoreSkillRegistry)}>
              {#each registryResults as entry (entry.id)}
                <li>
                  <span class="skill-registry-copy"><strong>{entry.name}</strong><small>{entry.source} · {formatInstalls(entry.installs)} installs</small></span>
                  {#if skills.some((item) => item.name === entry.name && item.editable)}
                    <button type="button" class="permission-retry" disabled={installingRegistryId !== ''} onclick={() => void uninstallRegistryEntry(entry)}>{installingRegistryId === entry.id ? $t('settings.uninstalling') : $t('settings.uninstall')}</button>
                  {:else if skills.some((item) => item.name === entry.name)}
                    <span class="skill-registry-installed">{$t('settings.installed')}</span>
                  {:else}
                    <button type="button" class="permission-retry" disabled={installingRegistryId !== ''} onclick={() => void installRegistryEntry(entry)}>{installingRegistryId === entry.id ? $t('settings.installing') : $t('settings.install')}</button>
                  {/if}
                </li>
              {:else}
                <li class="skill-registry-empty">{registrySearching ? $t('settings.searching') : registryError ? registryError : skillRegistryQuery.trim().length === 1 ? $t('settings.typeToSearchVercel') : $t('settings.noSkillsMatched')}</li>
              {/each}
              {#if registryResults.length && !registryExhausted}<li class="skill-registry-more">{$t('settings.searching')}</li>{/if}
            </ul>
            <div class="custom-provider-actions"><button type="button" onclick={() => { adding = null; installingSkill = false; }}>{$t('settings.done')}</button></div>
          </section>
        {:else if mode === 'skills' && adding === 'skills'}
          <header class="options-detail-header"><span class="option-mark large"><Icon name={editingIntegration ? 'edit' : 'plus'} size={18}/></span><span class="options-title-group"><h3>{editingIntegration ? $t('settings.editSkill') : $t('settings.addSkill')}</h3></span></header>
          <form class="custom-integration-form skill-form" onsubmit={(event) => { event.preventDefault(); void saveCustomSkill(); }}>
            <label>{$t('settings.name')}<input bind:value={customSkillName} placeholder={$t('settings.skillNamePlaceholder')} required/></label>
            <label>{$t('settings.description')}<input bind:value={customSkillDescription} placeholder={$t('settings.skillDescriptionPlaceholder')} required/></label>
            <label>{$t('settings.instructions')}<textarea class="instructions" bind:value={customSkillInstructions} placeholder={$t('settings.instructionsPlaceholder')} required></textarea></label>
            <div class="custom-provider-actions"><button type="button" onclick={() => adding = null}>{$t('common.cancel')}</button><button class="credential-primary" type="submit" disabled={integrationSaving}>{integrationSaving ? $t('hub.saving') : $t('common.save')}</button></div>
          </form>
        {:else if mode === 'mcp' && mcp}
          <header class="options-detail-header">
            <span class="options-title-group"><h3>{mcp.name}</h3></span>
            {#if mcp.editable}<button type="button" class="provider-edit" aria-label={$t('settings.editMcpServer')} onclick={() => editMcp(mcp)}><Icon name="edit" size={14}/></button><button type="button" class="provider-edit destructive" aria-label={$t('settings.deleteMcpServer')} disabled={integrationSaving} onclick={() => void removeMcp(mcp)}><Icon name="trash" size={14}/></button>{/if}
            <button type="button" class:enabled={mcp.enabled} class="chronicle-toggle" role="switch" aria-label={$t('settings.enableMcpServer')} aria-checked={mcp.enabled} disabled={mcpUpdatingIds.has(mcp.id)} onclick={() => void setMcpEnabled(mcp)}><span></span></button>
          </header>
          <section class="options-detail-block"><h4>{$t('settings.description')}</h4><p>{mcp.description ?? $t('settings.noDescription')}</p></section>
          <section class="options-detail-block">
            <h4>{$t('settings.details')}</h4>
            <dl class="skill-meta">
              <div><dt>{$t('settings.source')}</dt><dd>{mcpOrigin(mcp)}</dd></div>
              <div><dt>{$t('settings.transport')}</dt><dd>{mcp.transport === 'stdio' ? 'Stdio' : 'Streamable HTTP'}</dd></div>
              <div><dt>{$t('settings.status')}</dt><dd class="state-text" data-state={mcp.error ? 'error' : mcp.status} title={mcp.error ?? undefined}>{mcp.error ?? mcpStatus(mcp)}</dd></div>
              <div><dt>{$t('settings.availability')}</dt><dd>{mcp.enabled ? $t('settings.enabled') : $t('settings.disabled')}</dd></div>
            </dl>
          </section>
          <div class="options-resources">
            <section><header><h4>{$t('settings.tools')}</h4><span>{mcp.toolNames.length}</span></header><ul use:scrollFade={mcp.toolNames}>{#each mcp.toolNames as name}<li><Icon name="wrench" size={14}/>{mcpToolName(name)}</li>{:else}<li class="muted">{$t('settings.noTools')}</li>{/each}</ul></section>
            <section><header><h4>{$t('settings.resources')}</h4><span>{mcp.resourceUris.length}</span></header><ul use:scrollFade={mcp.resourceUris}>{#each mcp.resourceUris as uri}<li><Icon name="link" size={14} strokeWidth={1}/>{mcpResourceName(uri)}</li>{:else}<li class="muted">{$t('settings.noResources')}</li>{/each}</ul></section>
          </div>
        {:else if mode === 'skills' && skill}
          <header class="options-detail-header">
            <span class="options-title-group"><h3>{skillTitle(skill)}</h3>{#if skill.source === 'official'}<span class="options-badge official-badge"><Icon name="verified" size={11} strokeWidth={1.8}/><span>{$t('settings.official')}</span></span>{/if}</span>
            <div class="skill-detail-actions">
              {#if skill.editable}<button type="button" class="provider-edit" aria-label={$t('settings.editSkill')} onclick={() => editSkill(skill)}><Icon name="edit" size={14}/></button><button type="button" class="provider-edit destructive" aria-label={$t('settings.deleteSkill')} disabled={integrationSaving} onclick={() => void removeSkill(skill)}><Icon name="trash" size={14}/></button>{/if}
              <button type="button" class:enabled={skill.enabled} class="chronicle-toggle" role="switch" aria-label={$t('settings.enableSkill')} aria-checked={skill.enabled} disabled={integrationSaving} onclick={() => void setSkillEnabled(skill)}><span></span></button>
            </div>
          </header>
          <section class="options-detail-block"><h4>{$t('settings.description')}</h4><p class="skill-description">{skill.description}</p></section>
          <section class="options-detail-block">
            <h4>{$t('settings.details')}</h4>
            <dl class="skill-meta">
              <div><dt>{$t('settings.author')}</dt><dd>{skillAuthor(skill)}</dd></div>
              <div><dt>{$t('settings.category')}</dt><dd>{skill.category ?? $t('settings.categoryGeneral')}</dd></div>
              <div><dt>{$t('settings.lastEdited')}</dt><dd>{skillUpdated(skill) ?? $t('hub.unknown')}</dd></div>
              <div><dt>{$t('settings.source')}</dt><dd>{skillOrigin(skill)}</dd></div>
            </dl>
          </section>
          {#if skill.disableModelInvocation}<section class="options-detail-block"><h4>{$t('settings.invocation')}</h4><p>{$t('settings.invocationExplicit')}</p></section>{/if}
          <p class="options-path">{skill.filePath}</p>
        {:else if mode === 'model' && modelCompany}
          <header class="options-detail-header provider-detail-header model-detail-header">
            <span class="provider-mark large"><ProviderLogo provider={modelCompany.id} logoDataUrl={modelCompany.logoDataUrl} size={22}/></span>
            <span class="options-title-group"><h3>{modelCompany.name}</h3><span class="model-count">{modelCompany.models.length} {modelCompany.models.length === 1 ? 'model' : 'models'}</span></span>
          </header>
          <div class="pricing-toolbar">
            <p class="pricing-note">{$t('settings.pricingNote')}</p>
            <div class="currency-menu"><Menu options={currencyOptions} bind:value={currency} label="Currency" onChange={(value) => void setCurrency(value)}/></div>
          </div>
          <!-- The column headings stay put while the rows move under them, so
               they are their own table above the scroller. Both tables are
               fixed-layout with the same column widths, which is what keeps the
               headings over the figures they name. -->
          <div class="model-table-head">
            <table class="model-columns">
              <thead><tr><th>{$t('settings.columnModel')}</th><th>{$t('settings.columnInput')}</th><th>{$t('settings.columnOutput')}</th><th>{$t('settings.columnCacheHit')}</th><th>{$t('settings.columnCacheWrite')}</th><th>{$t('settings.columnContext')}</th></tr></thead>
            </table>
          </div>
          <div class="model-table-wrap" use:scrollFade={visibleCompanyModels}>
            <table class="model-table">
              <tbody>
                {#each visibleCompanyModels as item (`${item.provider}/${item.id}`)}
                  <!-- One click is the whole gesture, anywhere along the row:
                       the model lands in the job the directory was opened for
                       and the tab comes back. Keyboard access stays on the
                       button the row wraps. -->
                  <tr class:active={browsingRoleOption ? roleHoldsModel(browsingRoleOption.value, item, modelRoles) : item.selected} class="model-row" onclick={() => void chooseModelForRole(item)}>
                    <td><button type="button" class="model-row-name" data-tooltip-label={modelTooltip(item)} data-tooltip-delay="1500" data-tooltip-wide disabled={assigningRole !== ''} aria-label={$t('settings.roleSet', {model: item.name, job: browsingRoleOption?.job ?? ''})} onclick={(event) => {event.stopPropagation(); void chooseModelForRole(item);}}><strong>{item.name}</strong><small>{modelSubtitle(item)}</small></button></td>
                    <td>{formatPrice(item.cost.input, currency, currencyRates)}</td>
                    <td>{formatPrice(item.cost.output, currency, currencyRates)}</td>
                    <td>{formatPrice(item.cost.cacheRead, currency, currencyRates)}</td>
                    <td>{formatPrice(item.cost.cacheWrite, currency, currencyRates)}</td>
                    <td>{formatTokens(item.contextWindow)}</td>
                  </tr>
                {:else}
                  <tr><td class="model-table-empty" colspan="6">{$t('settings.noModelsFound')}</td></tr>
                {/each}
              </tbody>
            </table>
          </div>
        {:else if mode === 'provider' && addingCustomProvider}
          <header class="options-detail-header provider-detail-header">
            <label class="custom-provider-logo" aria-label={$t('settings.uploadProviderImage')}>
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" aria-label={$t('settings.customProviderImage')} onchange={(event) => void chooseCustomProviderLogo(event)}/>
              <span class="option-mark large custom-provider-logo-preview">
                {#if customProviderLogoDataUrl}<img src={customProviderLogoDataUrl} alt=""/>{:else}<Icon name="plus" size={18}/>{/if}
              </span>
            </label>
            <span class="options-title-group"><h3>{editingCustomProviderId ? $t('settings.editCustomProvider') : $t('settings.addCustomProvider')}</h3><span class="options-badge">{$t('settings.openAiCompatible')}</span></span>
          </header>
          <form class="custom-provider-form" onsubmit={(event) => {event.preventDefault(); void createCustomProvider();}}>
            <p>{$t('settings.customProviderBlurb')}</p>
            <label><span class="field-label">{$t('settings.providerName')} <span class="required-mark" aria-hidden="true">*</span></span><input bind:value={customProviderName} aria-label={$t('settings.customProviderName')} placeholder={$t('settings.providerNamePlaceholder')} autocomplete="off" required/></label>
            <label><span class="field-label">{$t('settings.baseUrl')} <span class="required-mark" aria-hidden="true">*</span></span><input bind:value={customProviderUrl} aria-label={$t('settings.customProviderBaseUrl')} placeholder="http://localhost:11434/v1" autocomplete="off" spellcheck="false" required onblur={detectOnUrlSettled}/></label>
            {#if !editingCustomProviderId}<label>{$t('settings.apiKey')} <small>{$t('settings.apiKeyOptional')}</small><input bind:value={customProviderKey} aria-label={$t('settings.customProviderApiKey')} type="password" placeholder={$t('settings.pasteApiKey')} autocomplete="off" spellcheck="false"/></label>{/if}
            <div class="models-field-header">
              <span class="field-label">{$t('settings.models')} <span class="required-mark" aria-hidden="true">*</span></span>
              <button type="button" class="detect-models" disabled={discoveringModels || !customProviderUrl.trim()} onclick={() => void detectCustomProviderModels()}>{discoveringModels ? $t('settings.detectingModels') : $t('settings.detectModels')}</button>
            </div>
            {#if customProviderModelIdList(customProviderModels).length > 0 && !modelsExpanded}
              <!-- Detection answered the question, so the list reads as a
                   result. Editing it by hand stays one click away. -->
              {@const modelIds = customProviderModelIdList(customProviderModels)}
              <div class="models-summary">
                <span>{plural('settings.modelsFound', modelIds.length)}</span>
                <button type="button" onclick={() => (modelsExpanded = true)}>{$t('settings.editModels')}</button>
              </div>
              <p class="models-summary-list">{modelIds.slice(0, 6).join(', ')}{modelIds.length > 6 ? '…' : ''}</p>
            {:else}
              <label><textarea bind:value={customProviderModels} aria-label={$t('settings.customProviderModels')} rows="5" placeholder={'model-id | Display name\nanother-model'} required></textarea><small>{$t('settings.modelsHint')}</small></label>
            {/if}
            <div class="custom-provider-actions">
              <button type="button" onclick={() => {addingCustomProvider = false; editingCustomProviderId = '';}}>{$t('common.cancel')}</button>
              <button type="submit" class="credential-primary" disabled={savingCredential}>{savingCredential ? $t('hub.saving') : editingCustomProviderId ? $t('settings.saveChanges') : $t('settings.addProvider')}</button>
            </div>
          </form>
        {:else if mode === 'provider' && credentialProvider}
          <header class="options-detail-header provider-detail-header">
            <span class="provider-mark large"><ProviderLogo provider={credentialProvider.id} logoDataUrl={credentialProvider.logoDataUrl} size={22}/></span>
            <span class="options-title-group"><h3>{credentialProvider.name}</h3><span class:good={credentialProvider.configured} class="options-badge">{credentialProvider.configured ? $t('settings.configured') : credentialProvider.storedCredential ? $t('settings.saved') : $t('settings.notConfigured')}</span></span>
            {#if credentialProvider.custom && !credentialProvider.localRuntime}<button type="button" class="provider-edit" aria-label={$t('settings.editProvider', {provider: credentialProvider.name})} onclick={() => editCustomProvider(credentialProvider)}><Icon name="edit" size={14}/></button>{/if}
          </header>
          {#if credentialProvider.localRuntime}
            <!-- A server on this machine: the address is the whole question, and
                 the models are read off it rather than typed. -->
            <section class="credential-panel">
              <div class="credential-copy">
                <h4>{$t('settings.localRuntime')}</h4>
                <p>{$t('settings.localRuntimeBlurb', {provider: credentialProvider.name})}</p>
              </div>
              <form class="credential-form" onsubmit={(event) => {event.preventDefault(); void setupLocalRuntime(credentialProvider!);}}>
                <div class="credential-input-row">
                  <input bind:value={runtimeUrl} aria-label={$t('settings.baseUrl')} autocomplete="off" spellcheck="false" placeholder={credentialProvider.baseUrl}/>
                  <button type="submit" class="credential-primary" disabled={savingCredential}>{savingCredential ? $t('settings.detectingModels') : $t('settings.connectRuntime')}</button>
                </div>
              </form>
            </section>
          {:else}
          <section class="credential-panel">
            <div class="credential-copy">
              <h4>API key</h4>
              <p>{credentialProvider.apiKeyLabel ?? $t('settings.configureCredentials', {provider: credentialProvider.name})} {$t('settings.credentialsBlurb')}</p>
            </div>
            {#if credentialProvider.apiKeyLabel}
              <form class="credential-form" onsubmit={(event) => {event.preventDefault(); void saveCredential();}}>
                <div class="credential-input-row">
                  <input id="provider-api-key" bind:value={credentialKey} aria-label={$t('settings.apiKey')} type="password" autocomplete="off" spellcheck="false" placeholder={$t('settings.enterApiKey')}/>
                  <button type="submit" class="credential-primary" disabled={savingCredential || !credentialKey.trim()}>{savingCredential ? $t('hub.saving') : $t('settings.addKey')}</button>
                </div>
              </form>
            {:else}
              <p class="credential-unavailable">{$t('settings.noApiKeySupport')}</p>
            {/if}
            <div class="credential-keys">
              {#each credentialProvider.apiKeys as key (key.id)}
                <div class="credential-key-row">
                  <span class="credential-key-state" class:active={key.status === 'ready'} class:invalid={key.status === 'invalid'} class:limited={key.status === 'rate_limited'}></span>
                  <span><strong>{key.label}</strong><small class="state-text" data-state={key.status}>{key.status === 'invalid' ? $t('settings.keyInvalid') : key.status === 'rate_limited' ? $t('settings.keyRateLimited') : $t('settings.keyReady')}</small></span>
                  <button type="button" aria-label={$t('settings.removeKey', {label: key.label})} data-tooltip-label={$t('hub.remove')} disabled={savingCredential} onclick={() => void removeCredential(key.id)}><Icon name="trash" size={14}/></button>
                </div>
              {/each}
            </div>
          </section>
          {/if}
        {:else}
          <p class="options-empty detail">{$t('settings.selectItem')}</p>
        {/if}
      </div>
    </div>
    {/if}
  </div>

</div>

<style>
  /* A page rather than a sheet: it fills the window, so it carries its own drag
     strip and the same --chrome-inset the chat controls use. */
  .options-page{--options-content-edge:14px;--options-detail-edge:32px;--options-tab-inline:11px;--options-divider-gap:15px;position:fixed;z-index:1000;inset:0;display:grid;grid-template-columns:232px minmax(0,1fr);overflow:hidden;background:var(--app-bg);animation:options-page-in .16s ease-out}
  .options-page.settling :global(*){transition:none!important;animation:none!important}
  /* The window has no title bar of its own while this is up, so the top strip
     stays draggable. It sits under the controls, which opt back out. */
  .options-page-drag{position:absolute;z-index:0;top:0;right:0;left:0;height:var(--app-topbar-height);-webkit-app-region:drag}
  .options-nav{position:relative;z-index:1;min-height:0;display:flex;flex-direction:column;gap:10px;padding:0 12px 14px;border-right:1px solid var(--neutral-200);-webkit-app-region:no-drag}
  /* Clears the traffic lights instead of dropping below them; full screen zeroes
     --chrome-inset and the label slides to the window edge, exactly as the new
     chat and search controls do. */
  .options-back{align-self:flex-start;height:28px;display:flex;align-items:center;gap:8px;margin:calc(var(--titlebar-control-top,14px)) 0 6px;margin-left:calc(var(--chrome-inset) + 8px);border:0;border-radius:9px;padding:0 8px 0 6px;background:transparent;color:var(--neutral-600);cursor:pointer;font-family:inherit;font-size:13px;font-weight:520;transition:color .15s,background .15s}
  .options-back:hover,.options-back:focus-visible{outline:0;background:var(--neutral-100);color:var(--neutral-950)}
  .options-back span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .options-nav-search{flex:none;margin:0 2px}
  .options-nav-list{min-height:0;flex:1;display:flex;flex-direction:column;gap:1px;overflow-y:auto;padding:2px}
  .options-nav-item{width:100%;height:32px;display:flex;align-items:center;gap:8px;border:0;border-radius:9px;padding:0 9px;background:transparent;color:var(--neutral-600);cursor:pointer;text-align:left;font-family:inherit;font-size:13px;transition:color .15s,background .15s}
  .options-nav-item :global(svg){flex:none}
  .options-nav-item span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .options-nav-item:hover,.options-nav-item:focus-visible{outline:0;background:var(--neutral-100);color:var(--neutral-950)}
  .options-nav-item.active{background:var(--neutral-200);color:var(--neutral-950);font-weight:540}
  .options-page-content{position:relative;z-index:1;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden;-webkit-app-region:no-drag}
  /* A plain cross-fade: the page arrives over the app in place, and a fade that
     also scaled would read as a second, contradictory movement. */
  @keyframes options-page-in{from{opacity:0}}
  .options-header{flex:none;min-width:0;padding:calc(var(--app-topbar-height) - 4px) var(--options-detail-edge) 18px calc(var(--options-content-edge) + var(--options-tab-inline))}.options-header h2{margin:0;color:var(--neutral-950);font-size:28px;font-weight:570;letter-spacing:-.025em}
  /* Explicit line boxes, not glyph-driven ones: scripts with taller ascenders
     (CJK, Thai, Devanagari) would otherwise grow the header and shift the tab
     row down as you switch tabs. Both lines are short by design, so clipping
     the overflow costs nothing and keeps the height constant. */
  .options-header h2{height:35px;line-height:35px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.options-header p{margin:7px 0 0;height:19px;overflow:hidden;color:var(--neutral-600);text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;line-height:19px}
  .options-error{margin:0 18px 8px;padding:7px 10px;border-radius:8px;background:var(--neutral-100);color:var(--neutral-700);font-size:12px}
  .general-options{flex:1;min-height:0;overflow-y:auto;padding:2px var(--options-detail-edge) 20px calc(var(--options-content-edge) + var(--options-tab-inline))}.general-setting-row{display:flex;align-items:center;gap:11px;min-height:62px;border-bottom:1px solid var(--neutral-200)}.general-setting-copy{min-width:0;flex:1;display:flex;flex-direction:column;gap:3px}.general-setting-copy h4{margin:0;color:var(--neutral-900);font-size:12.5px;font-weight:570}.general-setting-copy small{overflow:hidden;color:var(--neutral-500);text-overflow:ellipsis;white-space:nowrap;font-size:10.5px}.permission-retry{height:28px;flex:none;border:1px solid var(--neutral-200);border-radius:8px;padding:0 10px;background:var(--app-surface);color:var(--neutral-700);cursor:pointer;font-family:inherit;font-size:10.5px;font-weight:550}.permission-retry:hover,.permission-retry:focus-visible{outline:0;background:var(--neutral-100);color:var(--neutral-950)}.setting-menu{flex:none}.setting-menu.language{--select-menu-rows:5}.setting-menu.busy{pointer-events:none;opacity:.5}.setting-menu :global(.select-menu-trigger){height:28px;border-radius:8px;font-size:10.5px}.theme-switch{display:flex;flex:none;gap:2px;padding:2px;border-radius:9px;background:var(--neutral-100)}.theme-switch button{height:26px;border:0;border-radius:7px;padding:0 9px;background:transparent;color:var(--neutral-500);cursor:pointer;font-family:inherit;font-size:10.5px}.theme-switch button:hover,.theme-switch button:focus-visible{outline:0;color:var(--neutral-900)}.theme-switch button.active{background:var(--app-surface);color:var(--neutral-950);box-shadow:0 1px 3px rgba(0,0,0,.09)}.theme-switch button:disabled{cursor:default;opacity:.5}
  /* Grouped like the rest of the page: a small heading, then its rows. The
     last row in a group drops its rule so the group ends on space, not on a
     line that would read as the start of the next one. */
  .general-group{display:block;margin:0 0 26px}
  .general-group:last-child{margin-bottom:0}
  .general-group>h3{margin:0 0 2px;color:var(--neutral-500);font-size:11.5px;font-weight:560;letter-spacing:.01em}
  .general-group>.general-setting-row:last-child{border-bottom:0}
  /* The notification kinds sit in a group of their own so the master switch
     can grey them, which puts the section's last row one level down. */
  .general-group>.chronicle-group:last-child>.general-setting-row:last-child{border-bottom:0}
  .permission-retry:disabled{cursor:default;opacity:.55}
  /* The row keeps the app mark rather than a generic puzzle piece, so the
     extension reads as part of FlareAI in both places it is offered. */
  /* The mark is flat black artwork with a baked-in fill, so on a dark row it
     is invisible; inverting it is what turns it white without a second asset. */
  .extension-installed{flex:none;color:var(--neutral-500);font-size:10.5px;font-weight:550}
  .setting-value{flex:none;display:flex;align-items:center;color:var(--neutral-500);font-size:10.5px;font-weight:550;line-height:1}
  .update-refresh{width:16px;height:16px;flex:none;display:flex;align-items:center;justify-content:center;margin-left:-7px;border:0;border-radius:5px;padding:0;background:transparent;color:var(--neutral-500);cursor:pointer;line-height:0;transform:translateY(1px)}
  .update-refresh:hover,.update-refresh:focus-visible{outline:0;color:var(--neutral-950)}
  .update-refresh:disabled{cursor:default;opacity:.55}
  .update-refresh.spinning :global(svg){animation:update-spin 1s linear infinite}
  @keyframes update-spin{to{transform:rotate(360deg)}}
  .memory-options{flex:1;min-height:0;display:flex;flex-direction:column;overflow-y:auto;padding:2px var(--options-detail-edge) 20px calc(var(--options-content-edge) + var(--options-tab-inline))}.memory-options>*{flex:none}.memory-options>.options-detail-header{flex:none;align-items:flex-start}.memory-options>.options-path{flex:none;margin-top:auto;padding-top:12px}.local-memory-section{margin-top:18px}.memory-divider{height:1px;flex:none;margin:14px 0;background:var(--neutral-200)}.chronicle-group{transition:opacity .15s ease}.chronicle-group>.chronicle-section+.chronicle-section{margin-top:16px}.chronicle-source-columns{display:grid;grid-template-columns:1fr 1fr;gap:14px;max-width:610px;margin-top:10px}.chronicle-source-column{min-width:0;display:flex;flex-direction:column;gap:6px}.chronicle-source-column>header{display:flex;align-items:center;justify-content:space-between;gap:10px}.chronicle-source-column h5{min-width:0;margin:0;overflow:hidden;color:var(--neutral-900);text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;font-weight:570}.chronicle-source-tools{display:flex;align-items:center;gap:4px}.chronicle-source-tools button{display:flex;align-items:center;justify-content:center;width:20px;height:20px;flex:none;border:0;padding:0;background:none;color:var(--neutral-400);cursor:pointer;transition:color .12s ease}.chronicle-source-tools button:hover,.chronicle-source-tools button:focus-visible{outline:0;color:var(--neutral-900)}.chronicle-source-tools button.active{color:var(--neutral-900)}.chronicle-source-tools button:disabled{cursor:default;opacity:.5}.chronicle-source-box{min-width:0;display:flex;flex-direction:column;height:150px;overflow:hidden;border:1px solid var(--neutral-200);border-radius:10px;padding:5px}.chronicle-source-list{min-height:0;flex:1;display:flex;flex-direction:column;overflow-y:auto;margin:0;padding:0;list-style:none}.chronicle-source-list li{display:flex;align-items:center;gap:8px;height:28px;border-radius:7px;padding:0 4px 0 8px;color:var(--neutral-700);font-size:11px}.chronicle-source-list li>span{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.chronicle-source-list li>:global(svg){flex:none;color:var(--neutral-400)}.chronicle-source-icon{width:15px;height:15px;flex:none;border-radius:3px;object-fit:contain}.chronicle-source-list li:hover{background:var(--neutral-100)}.chronicle-source-list li>button{display:flex;align-items:center;justify-content:center;width:20px;height:20px;flex:none;border:0;padding:0;background:none;color:var(--neutral-400);cursor:pointer;opacity:0;transition:color .12s ease,opacity .12s ease}.chronicle-source-list li:hover>button,.chronicle-source-list li>button:focus-visible{opacity:1}.chronicle-source-list li>button:hover{color:var(--neutral-900)}.chronicle-source-field{display:flex;align-items:center;gap:7px;height:28px;flex:none;border-radius:7px;padding:0 8px;color:var(--neutral-400)}.chronicle-source-field:focus-within{color:var(--neutral-900)}.chronicle-source-field input{height:100%;min-width:0;flex:1;border:0;padding:0;background:none;color:var(--neutral-900);font-family:inherit;font-size:11px}.chronicle-source-field input::placeholder{color:var(--neutral-400)}.chronicle-source-field input:focus-visible{outline:0}.chronicle-source-field input:disabled{cursor:default;opacity:.5}.chronicle-forget{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.chronicle-forget button{height:28px;flex:none;border:1px solid var(--neutral-200);border-radius:8px;padding:0 11px;background:var(--app-surface);color:var(--neutral-900);cursor:pointer;font-family:inherit;font-size:10.5px;font-weight:550}.chronicle-forget button:hover,.chronicle-forget button:focus-visible{outline:0;background:var(--neutral-100)}.chronicle-forget button:disabled{cursor:default;opacity:.5}.chronicle-group.disabled{opacity:.42}.chronicle-section>header{display:flex;align-items:center;justify-content:space-between;gap:16px}.chronicle-section>header>span{display:flex;min-width:0;flex-direction:column;gap:2px}.chronicle-section h4{margin:0;color:var(--neutral-900);font-size:12.5px;font-weight:570}.chronicle-section small{color:var(--neutral-400);font-size:10.5px}.chronicle-section>p{max-width:610px;margin:6px 0;color:var(--neutral-600);font-size:11px;line-height:1.45}.chronicle-inline-stats{display:flex;flex-wrap:wrap;gap:12px;color:var(--neutral-400);font-size:10px}.chronicle-toggle{width:36px;height:20px;flex:none;border:0;border-radius:999px;padding:2px;background:var(--neutral-300);cursor:pointer;transition:background .15s ease}.chronicle-toggle span{width:16px;height:16px;display:block;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.2);transition:transform .15s ease,background .15s ease}.chronicle-toggle.pending{display:block;cursor:default;opacity:.5}.chronicle-toggle.enabled{background:var(--neutral-900)}.chronicle-toggle.enabled span{transform:translateX(16px)}:global(:root[data-theme="dark"]) .chronicle-toggle{background:#484848}:global(:root[data-theme="dark"]) .chronicle-toggle span{background:#d8d8d8}:global(:root[data-theme="dark"]) .chronicle-toggle.enabled{background:#e7e7e7}:global(:root[data-theme="dark"]) .chronicle-toggle.enabled span{background:#242424}.chronicle-toggle:disabled{cursor:default;opacity:.5}.chronicle-error{display:flex;align-items:center;gap:12px;margin-top:10px;padding:9px 11px;border-radius:9px;background:#fff5f5;color:#8f3e3e}.chronicle-error>span{min-width:0;flex:1}.chronicle-error h4,.chronicle-error p,.chronicle-error small{margin:0}.chronicle-error h4{font-size:11px}.chronicle-error p{margin-top:3px;font-size:11px}.chronicle-error small{display:block;margin-top:3px;opacity:.75;font-size:10px}.chronicle-error button{height:28px;flex:none;border:1px solid color-mix(in srgb,currentColor 20%,transparent);border-radius:8px;padding:0 10px;background:var(--app-surface);color:inherit;cursor:pointer;font-family:inherit;font-size:10.5px;font-weight:550}.chronicle-error button:hover,.chronicle-error button:focus-visible{outline:0;background:var(--neutral-100)}.chronicle-error button:disabled{cursor:default;opacity:.55}:global(:root[data-theme="dark"]) .chronicle-error{background:#321f1f;color:#eea7a7}:global(:root[data-theme="dark"]) .chronicle-error button{border-color:#704242;background:#442727;color:#f0b0b0}:global(:root[data-theme="dark"]) .chronicle-error button:hover,:global(:root[data-theme="dark"]) .chronicle-error button:focus-visible{background:#553030;color:#ffd0d0}
  .options-body{position:relative;flex:1;min-height:0;display:grid;grid-template-columns:220px minmax(0,1fr)}.options-body:after{content:'';position:absolute;top:6px;bottom:12px;left:220px;width:1px;background:var(--neutral-200)}
  .options-rail{min-height:0;display:flex;flex-direction:column;gap:6px;padding:0 var(--options-divider-gap) 12px var(--options-content-edge)}.options-search{display:flex;align-items:center;gap:7px;height:30px;padding:0 10px;border:1px solid var(--neutral-200);border-radius:9px;background:var(--input-surface);color:var(--neutral-500)}.options-search:focus-within{border-color:var(--neutral-400);background:var(--prompt-surface-active)}.options-search input{-webkit-appearance:none;appearance:none;min-width:0;flex:1;border:0;padding:0;background:transparent;color:var(--neutral-950);outline:none;font-size:12.5px}.options-search input::-webkit-search-cancel-button{-webkit-appearance:none;appearance:none}
  .options-rail-list{flex:1;min-height:0;overflow-y:auto;margin:0;padding:6px 0;list-style:none}.options-rail-list.empty-state{display:flex;align-items:center;justify-content:center;-webkit-mask-image:none;mask-image:none}.options-rail-list li{display:flex}.options-rail-list .rail-empty{justify-content:center;padding:0 8px}.options-rail-row{width:100%;display:flex;align-items:center;gap:10px;margin:2px 0;padding:5px 9px;border:0;border-radius:10px;background:transparent;text-align:left;cursor:pointer}.options-rail-row:hover,.options-rail-row:focus-visible{outline:0;background:var(--neutral-100)}.options-rail-row.selected{background:var(--neutral-200)}
  .options-rail-row.integration-disabled{opacity:.52}.options-rail-row.integration-disabled.selected{opacity:.72}
  .skill-name-line{min-width:0;display:flex;align-items:center;gap:4px}.skill-name-line strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.official-rail-stamp{width:14px;height:14px;display:grid;flex:none;place-items:center;color:var(--neutral-500);transform:translateY(1px)}
  .option-mark{flex:none;width:26px;height:26px;display:grid;place-items:center;border-radius:8px;background:var(--neutral-200);color:var(--neutral-700)}
  /* A product's own icon already carries its shape and ground, so the house
     tile would read as a second, mismatched container behind it. */
  .option-mark.large{width:34px;height:34px;border-radius:10px}
  .options-detail.directory-open{display:flex;flex-direction:column;overflow:hidden}.skill-registry{min-height:0;flex:1;display:flex;flex-direction:column;gap:12px;margin-top:14px}.skill-registry-results{flex:1;min-height:0;overflow-y:auto;margin:0;padding:0;list-style:none}.skill-registry-results li{display:flex;align-items:center;gap:12px;min-height:44px;border-bottom:1px solid var(--neutral-100)}.skill-registry-results li:last-child{border-bottom:0}.skill-registry-copy{min-width:0;flex:1;display:flex;flex-direction:column;gap:1px}.skill-registry-copy strong{overflow:hidden;color:var(--neutral-950);text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;font-weight:540}.skill-registry-copy small{overflow:hidden;color:var(--neutral-400);text-overflow:ellipsis;white-space:nowrap;font-size:10.5px}.skill-registry-installed{flex:none;color:var(--neutral-400);font-size:10.5px;font-weight:550}.discovery-lede{margin:0;color:var(--neutral-400);font-size:11.5px;line-height:1.5}.discovery-lede code{color:var(--neutral-500);font-size:11px}.discovery-groups{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:18px;padding:6px 0}.discovery-group-header{width:100%;display:flex;align-items:center;gap:8px;padding:0 0 6px;border:0;border-bottom:1px solid var(--neutral-200);background:transparent;text-align:left;cursor:pointer}.discovery-group-heading{min-width:0;flex:1;display:flex;align-items:baseline;gap:8px}.discovery-group-header:focus-visible{outline:0}.discovery-group h4{margin:0;color:var(--neutral-950);font-size:14px;font-weight:620;letter-spacing:-.01em}.discovery-group-header code{overflow:hidden;color:var(--neutral-400);text-overflow:ellipsis;white-space:nowrap;font-size:10.5px}.discovery-count{flex:none;color:var(--neutral-400);font-size:10.5px;font-weight:550}.discovery-chevron{display:flex;flex:none;align-items:center;color:var(--neutral-500)}.discovery-group-header h4,.discovery-group-header code,.discovery-count,.discovery-chevron{transition:color .15s ease}.discovery-chevron{transition:transform .15s ease,color .15s ease}.discovery-group-header:hover code,.discovery-group-header:focus-visible code,.discovery-group-header:hover .discovery-count,.discovery-group-header:focus-visible .discovery-count,.discovery-group-header:hover .discovery-chevron,.discovery-group-header:focus-visible .discovery-chevron{color:var(--neutral-900)}.discovery-chevron.collapsed{transform:rotate(-90deg)}.discovery-list.collapsed{display:none}.discovery-list{flex:none;overflow:visible}.discovery-empty{margin:auto;color:var(--neutral-400);text-align:center;font-size:11.5px}.skill-registry-results .skill-registry-empty{height:100%;display:grid;place-items:center;border:0;color:var(--neutral-400);text-align:center;font-size:11.5px}
  /* The foot of a marketplace list: what the next page looks like while it
     is on its way, centred like the empty state and carrying no divider. */
  .skill-registry-results .skill-registry-more{display:grid;place-items:center;min-height:40px;border:0;color:var(--neutral-400);font-size:11px}
  .skill-meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px 18px;margin:8px 0 0;max-width:460px}.skill-meta div{min-width:0;display:flex;flex-direction:column;gap:2px}.skill-meta dt{color:var(--neutral-400);font-size:10.5px;font-weight:550;letter-spacing:.02em}.skill-meta dd{margin:0;overflow:hidden;color:var(--neutral-700);text-overflow:ellipsis;white-space:nowrap;font-size:12px}.options-rail-copy{min-width:0;flex:1;display:flex;flex-direction:column;gap:1px}.options-rail-copy strong{overflow:hidden;color:var(--neutral-950);text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:530}.options-rail-copy small{overflow:hidden;color:var(--neutral-500);text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;text-transform:capitalize}.options-name{display:flex;align-items:center;gap:5px}.options-name strong{min-width:0;flex:1}.options-name i{padding:1px 5px;border-radius:5px;background:#fff;color:var(--neutral-600);font-size:9px;font-style:normal}
  .provider-mark{width:26px;height:26px;display:grid;flex:none;place-items:center;border:1px solid var(--neutral-200);border-radius:8px;background:#fff}.provider-mark.large{width:34px;height:34px;border-radius:10px}.provider-row.selected .provider-mark{border-color:rgba(0,0,0,.08)}.provider-row.has-check{position:relative}.provider-row.has-check .options-rail-copy{-webkit-mask-image:linear-gradient(to right,#000 0,#000 calc(100% - 34px),transparent calc(100% - 13px));mask-image:linear-gradient(to right,#000 0,#000 calc(100% - 34px),transparent calc(100% - 13px))}.configured-check{position:absolute;top:0;right:15px;bottom:0;width:18px;display:grid;place-items:center;color:var(--neutral-600)}
  .options-rail-tools{position:relative;flex:none;display:flex;align-items:center;justify-content:flex-start;gap:2px;margin-top:2px}.rail-tool-wrap{position:relative}.rail-tool{width:30px;height:30px;display:grid;place-items:center;border:0;border-radius:8px;padding:0;background:transparent;color:var(--neutral-500);cursor:pointer}.rail-tool:hover,.rail-tool:focus-visible,.rail-tool.active,.rail-tool[aria-expanded="true"]{outline:0;background:var(--neutral-100);color:var(--neutral-900)}.rail-tool-menu{position:absolute;z-index:5;bottom:36px;left:0;width:154px}.rail-tool-menu .flareai-dropdown-item>span{min-width:0;flex:1}.rail-tool-text{width:auto;padding:0 9px;font-family:inherit;font-size:11px;font-weight:540}
  .options-detail{min-height:0;overflow-y:auto;padding:0 18px 20px var(--options-divider-gap)}.options-detail-header{display:flex;align-items:center;gap:11px}.options-detail-header>.chronicle-toggle{margin-right:8px}.options-title-group{min-width:0;flex:1;display:flex;align-items:center;gap:8px}.options-title-group h3{min-width:0;margin:0;overflow:hidden;color:var(--neutral-950);text-overflow:ellipsis;white-space:nowrap;font-size:15px;font-weight:570}.options-badge{flex:none;padding:2px 8px;border-radius:7px;background:var(--neutral-200);color:var(--neutral-600);font-size:10.5px;font-weight:540;text-transform:capitalize}.options-badge.good{background:#e8f5ec;color:#347049}.official-badge{display:inline-flex;align-items:center;gap:4px;padding:0;background:transparent;transform:translateY(1px)}.official-badge :global(svg){flex:none}
  .options-detail.mcp-detail{display:flex;flex-direction:column;overflow:hidden}.mcp-detail>.options-detail-header,.mcp-detail>.options-detail-block{flex:none}.mcp-detail>.options-resources{min-height:0;flex:1}.mcp-detail>.options-resources>section{min-height:0;display:flex;flex-direction:column}.mcp-detail>.options-resources ul{min-height:0;max-height:none;flex:1;overflow-y:auto}
  /* The conflict mark sits on the name's line, like the official stamp, and
     is the one warm colour in the rail so it reads as a caution without a box
     around it. */
  .plugin-rail-stamp{width:14px;height:14px;display:grid;flex:none;place-items:center;color:#b0743a;transform:translateY(1px)}
  :global(:root[data-theme="dark"]) .plugin-rail-stamp{color:#d9a05e}
  .plugin-conflicts{display:flex;flex-direction:column;gap:5px;margin:0;padding:0;list-style:none}
  .plugin-conflicts li{display:flex;align-items:flex-start;gap:7px;color:#a04545;font-size:11px;line-height:1.45}
  .plugin-conflicts :global(svg){flex:none;margin-top:1px}
  .plugin-conflict-note,.plugin-unsupported{max-width:520px;margin:8px 0 0;color:var(--neutral-500);font-size:10.5px;line-height:1.5}
  .plugin-warning{max-width:520px;margin:0 0 14px;color:#a04545;font-size:11px;line-height:1.45}
  :global(:root[data-theme="dark"]) .plugin-conflicts li,:global(:root[data-theme="dark"]) .plugin-warning{color:#e79c9c}
  .options-detail.plugin-detail{display:flex;flex-direction:column;overflow:hidden}.plugin-detail>.options-path{flex:none;margin-top:auto;padding-top:12px}
  .options-detail.skill-detail{display:flex;flex-direction:column;overflow:hidden}.skill-detail>.options-path{flex:none;margin-top:auto;padding-top:12px}.skill-description{display:-webkit-box;overflow:hidden;line-clamp:4;-webkit-box-orient:vertical;-webkit-line-clamp:4}
  .skill-detail>.options-detail-header{position:relative;min-height:20px}.skill-detail>.options-detail-header>.options-title-group{min-height:20px;align-self:flex-start;padding-right:112px}.skill-detail-actions{position:absolute;top:-4px;right:0;height:28px;display:flex;align-items:center;gap:11px}.skill-detail-actions>.provider-edit+.provider-edit,.skill-detail-actions>.provider-edit+.chronicle-toggle{margin-left:-5px}.skill-detail-actions>.chronicle-toggle{margin-right:8px}
  .mcp-detail>.options-detail-header h3{font-size:16px;font-weight:570}
  .options-detail-block{margin:19px 0 10px}.options-detail-block h4,.options-resources h4{margin:0;color:var(--neutral-800);font-size:11.5px;font-weight:570;letter-spacing:.02em}.options-detail-block p{margin:5px 0 0;color:var(--neutral-600);font-size:12.5px;line-height:1.55;white-space:pre-wrap}.options-resources{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;margin-top:18px}.options-resources header{display:flex;align-items:center;justify-content:space-between;margin-bottom:5px}.options-resources header span{padding:1px 7px;border-radius:999px;background:var(--neutral-100);color:var(--neutral-600);font-size:10.5px}.options-resources ul{max-height:196px;overflow:auto;margin:0;padding:0;list-style:none}.options-resources li{display:flex;align-items:center;gap:7px;min-height:28px;overflow:hidden;color:var(--neutral-700);text-overflow:ellipsis;white-space:nowrap;font-size:12px}.options-resources li.muted{color:var(--neutral-400)}
  .options-path{margin:24px 0 0;overflow-wrap:anywhere;color:var(--neutral-400);font-size:10.5px}.options-empty{width:100%;padding:24px 8px;color:var(--neutral-400);text-align:center;font-size:12px}.options-empty.detail{display:grid;min-height:100%;place-items:center;margin:0}
  .provider-detail-header{padding-bottom:12px}.model-detail-header .model-count{transform:translateY(-2px)}.model-count{margin-left:auto;color:var(--neutral-500);font-size:11px;font-weight:450;white-space:nowrap}.pricing-toolbar{display:flex;align-items:flex-start;gap:12px;margin:-7px 0 10px}.pricing-note{min-width:0;flex:1;margin:0;padding-top:6px;color:var(--neutral-500);font-size:11px}/* Lifted against the note's first line: the trigger is much taller than the
     11px text, so flex-start alignment leaves it sitting visibly low. */
  .currency-menu{flex:none;margin-top:-5px}.currency-menu :global(.select-menu-trigger){height:26px;min-width:58px;border-radius:8px;padding:0 7px 0 9px;font-size:10.5px}.model-search{height:30px;display:flex;align-items:center;gap:7px;border-bottom:1px solid var(--neutral-200);color:var(--neutral-400)}.model-search:focus-within{border-color:var(--neutral-500);color:var(--neutral-600)}.model-search input{-webkit-appearance:none;appearance:none;min-width:0;flex:1;border:0;padding:0;background:transparent;color:var(--neutral-950);outline:0;font-family:inherit;font-size:11.5px}.model-search input::-webkit-search-cancel-button{-webkit-appearance:none;appearance:none}.model-search input::placeholder{color:var(--neutral-400)}/* Only the rows scroll: the provider header, the note and the column headings
     are pinned above them. */
  .options-detail.model-detail{display:flex;flex-direction:column;overflow:hidden}.model-detail>.options-detail-header,.model-detail>.pricing-toolbar,.model-detail>.model-table-head{flex:none}.model-detail>.model-table-wrap{min-height:0;flex:1}.model-table-head{overflow:hidden}.model-table-wrap{overflow:auto}.model-table,.model-columns{width:100%;border-collapse:collapse;table-layout:fixed}.model-columns th{height:31px;padding:0 10px;border-bottom:1px solid var(--neutral-200);background:transparent;color:var(--neutral-500);text-align:right;white-space:nowrap;font-size:10.5px;font-weight:540}/* The headings and the rows are two tables, so the widths are declared on
     both — fixed layout reads them off whichever cells come first. */
  .model-columns th:first-child,.model-table td:first-child{width:34%}.model-columns th:first-child{text-align:left}.model-columns th:last-child,.model-table td:last-child{width:12%}.model-table td{height:46px;padding:0 10px;border-bottom:1px solid var(--neutral-100);color:var(--neutral-700);text-align:right;white-space:nowrap;font-size:11.5px;font-variant-numeric:tabular-nums}.model-table tbody tr:last-child td{border-bottom:0}.model-table tbody tr:hover td{background:var(--neutral-50)}.model-table tr.active td{background:var(--neutral-100)}.model-table td:first-child{text-align:left}.model-table .model-table-empty{text-align:center;color:var(--neutral-400);font-size:11px}.model-row-name{width:100%;display:flex;flex-direction:column;gap:1px;overflow:hidden;border:0;padding:0;background:transparent;color:inherit;text-align:left;cursor:pointer}.model-row-name:disabled{cursor:default}.model-row-name strong{overflow:hidden;color:var(--neutral-950);text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:540}.model-row-name small{overflow:hidden;color:var(--neutral-500);text-overflow:ellipsis;white-space:nowrap;font-size:9.5px;font-weight:400}.model-row-name:not(:disabled):hover strong,.model-row-name:not(:disabled):focus-visible strong{color:var(--flare-blue,#2384cb)}.model-row-name:focus-visible{outline:none}
  .provider-edit{width:28px;height:28px;display:grid;flex:none;place-items:center;border:0;border-radius:8px;padding:0;background:transparent;color:var(--neutral-500);cursor:pointer}.provider-edit:hover,.provider-edit:focus-visible{outline:0;background:var(--neutral-100);color:var(--neutral-900)}
  .search-clear{appearance:none;width:13px;height:20px;display:grid;flex:none;place-items:center;border:0;padding:0;background:transparent;box-shadow:none;color:var(--neutral-400);cursor:pointer}.search-clear:hover,.search-clear:focus-visible{outline:0;background:transparent;box-shadow:none;color:var(--neutral-800)}
  .provider-edit.destructive:hover,.provider-edit.destructive:focus-visible{color:#a44343}.provider-edit:disabled{cursor:default;opacity:.45}
  .options-detail-header>.provider-edit+.provider-edit,.options-detail-header>.provider-edit+.chronicle-toggle{margin-left:-5px}
  .credential-panel{max-width:500px;padding:5px 2px}.credential-copy h4{margin:0;color:var(--neutral-900);font-size:13px;font-weight:570}.credential-copy p{max-width:470px;margin:6px 0 0;color:var(--neutral-500);font-size:12px;line-height:1.55}.credential-form{margin-top:10px}.credential-input-row{display:flex;gap:7px}.credential-input-row input{height:32px;min-width:0;flex:1;border:1px solid var(--neutral-200);border-radius:8px;padding:0 10px;background:var(--input-surface);color:var(--neutral-950);outline:none;font-family:inherit;font-size:11.5px}.credential-input-row input:focus{border-color:var(--neutral-400);background:var(--prompt-surface-active)}.credential-primary{height:32px;border:0;border-radius:8px;padding:0 12px;background:var(--neutral-900);color:var(--on-primary);cursor:pointer;font-family:inherit;font-size:11.5px;font-weight:540}.credential-primary:hover{filter:brightness(.92)}.credential-primary:disabled{cursor:default;opacity:.4}.credential-unavailable{margin:22px 0 0;padding:10px;border-radius:9px;background:var(--neutral-100);color:var(--neutral-500);font-size:12px}
  .custom-provider-form{max-width:440px;padding:2px}.custom-provider-form>p{margin:0 0 16px;color:var(--neutral-500);font-size:11.5px;line-height:1.5}.custom-provider-form>label{display:flex;flex-direction:column;gap:5px;margin:0 0 11px;color:var(--neutral-700);font-size:11px;font-weight:540}.custom-provider-form label>small{color:var(--neutral-400);font-size:10px;font-weight:400}.custom-provider-form input,.custom-provider-form textarea{width:100%;border:1px solid var(--neutral-200);border-radius:8px;padding:0 10px;background:var(--input-surface);color:var(--neutral-950);outline:none;font-family:inherit;font-size:11.5px}.custom-provider-form input{height:32px}.custom-provider-form textarea{min-height:88px;padding-block:8px;resize:vertical;line-height:1.45}.custom-provider-form input:focus,.custom-provider-form textarea:focus{border-color:var(--neutral-400);background:var(--prompt-surface-active)}.custom-provider-actions{display:flex;justify-content:flex-end;gap:7px;margin-top:15px}.custom-provider-actions>button{height:32px;border:0;border-radius:8px;padding:0 12px;background:var(--neutral-100);color:var(--neutral-700);cursor:pointer;font-family:inherit;font-size:11.5px}.custom-provider-actions>button:hover{background:var(--neutral-200)}.custom-provider-actions>.credential-primary{background:var(--neutral-900);color:var(--on-primary)}.custom-provider-actions>.credential-primary:hover{filter:brightness(.92)}
  .custom-integration-form{max-width:440px;padding-top:16px}.custom-integration-form>label{display:flex;flex-direction:column;gap:5px;margin-bottom:10px;color:var(--neutral-700);font-size:11px;font-weight:540}.custom-integration-form input,.custom-integration-form select,.custom-integration-form textarea{width:100%;border:1px solid var(--neutral-200);border-radius:8px;background:var(--input-surface);color:var(--neutral-950);outline:none;font:inherit;font-size:11.5px}.custom-integration-form input,.custom-integration-form select{height:32px;padding:0 10px}.custom-integration-form textarea{min-height:58px;padding:8px 10px;resize:vertical;line-height:1.4}.custom-integration-form textarea.instructions{min-height:150px}.custom-integration-form input:focus,.custom-integration-form select:focus,.custom-integration-form textarea:focus{border-color:var(--neutral-400)}.custom-integration-form input:disabled{color:var(--neutral-400);background:var(--neutral-100)}
  .custom-integration-form.skill-form{width:100%;max-width:none}
  .field-label{display:inline}.required-mark{color:#b44949}
  .models-summary{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 4px;color:var(--neutral-700);font-size:11px;font-weight:540}.models-summary>button{border:0;border-radius:6px;padding:2px 6px;background:transparent;color:var(--neutral-500);cursor:pointer;font-family:inherit;font-size:10.5px;font-weight:540;text-decoration:underline}.models-summary>button:hover,.models-summary>button:focus-visible{outline:0;color:var(--neutral-950)}
  .models-summary-list{margin:0 0 11px;overflow:hidden;color:var(--neutral-400);font-size:10.5px;line-height:1.5;overflow-wrap:anywhere}
  .models-field-header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 5px;color:var(--neutral-700);font-size:11px;font-weight:540}
  .detect-models{height:22px;border:1px solid var(--neutral-200);border-radius:7px;padding:0 8px;background:var(--app-surface);color:var(--neutral-700);cursor:pointer;font-family:inherit;font-size:10px;font-weight:540}.detect-models:hover,.detect-models:focus-visible{outline:0;background:var(--neutral-100);color:var(--neutral-950)}.detect-models:disabled{cursor:default;opacity:.5}
  .custom-provider-logo{display:block;flex:none;cursor:pointer}.custom-provider-logo>input{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}.custom-provider-logo-preview{position:relative;overflow:hidden;transition:background-color .14s ease}.custom-provider-logo:hover .custom-provider-logo-preview,.custom-provider-logo:focus-within .custom-provider-logo-preview{background:var(--neutral-300)}.custom-provider-logo-preview img{width:100%;height:100%;display:block;object-fit:cover}
  .skill-add-menu{min-width:142px}.skill-folder-input{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
  .credential-keys{margin-top:12px}.credential-key-row{min-height:42px;display:flex;align-items:center;gap:9px;padding:0 6px;border-bottom:1px solid var(--neutral-100)}.credential-key-state{width:7px;height:7px;flex:none;border-radius:50%;background:var(--neutral-300)}.credential-key-state.active{background:#4da46a}.credential-key-state.invalid{background:#c65a5a}.credential-key-state.limited{background:#c8973c}.credential-key-row>span:nth-child(2){min-width:0;flex:1;display:flex;flex-direction:column}.credential-key-row strong{color:var(--neutral-800);font-size:11.5px;font-weight:520}.credential-key-row small{color:var(--neutral-400);font-size:10px}.credential-key-row button{width:28px;height:28px;display:grid;place-items:center;border:0;border-radius:8px;background:transparent;color:var(--neutral-400);cursor:pointer}.credential-key-row button:hover{background:var(--neutral-100);color:#a44343}.credential-unavailable{margin:22px 0 0;padding:10px;border-radius:9px;background:var(--neutral-100);color:var(--neutral-500);font-size:12px}
  .model-table tr.model-row{cursor:pointer}
  /* The roles view: each job on one row, with what it runs and how hard it
     thinks sitting on the text's own centre line. */
  .role-controls{flex:none;display:flex;align-items:center;gap:8px}.role-effort-menu :global(.select-menu-trigger){width:104px}.role-model{height:28px;width:216px;display:flex;align-items:center;justify-content:flex-start;gap:8px;overflow:hidden;border:1px solid var(--neutral-200);border-radius:8px;padding:0 11px;text-align:left;white-space:nowrap;text-overflow:ellipsis;background:var(--app-surface);color:var(--neutral-800);cursor:pointer;font-family:inherit;font-size:10.5px;font-weight:550}.role-model:hover:not(:disabled),.role-model:focus-visible{outline:0;background:var(--neutral-100);color:var(--neutral-950)}.role-model:disabled{cursor:default;opacity:.55}/* The composer's model picker tile (`.model-menu-mark`), same size: lobehub's
     monochrome marks draw with their own black, so a bare logo is black on
     near-black in the dark theme. The light tile is what makes it read. */
  .role-model-mark{width:20px;height:20px;display:grid;flex:none;place-items:center;border:1px solid var(--neutral-200);border-radius:6px;background:#fff}.role-model>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.role-columns{height:30px;display:flex;align-items:center;gap:11px;border-bottom:1px solid var(--neutral-200);color:var(--neutral-500);font-size:10.5px;font-weight:540}.role-columns>span:first-child{min-width:0;flex:1}.role-columns .role-controls>span{padding-left:11px;text-align:left}.role-columns .role-controls>span:first-child{width:104px}.role-columns .role-controls>span:last-child{width:216px}
  @media(max-width:900px){.options-page{grid-template-columns:198px minmax(0,1fr)}.options-header{padding-bottom:14px}.options-body{grid-template-columns:210px minmax(0,1fr)}.options-body:after{left:210px}.options-resources{grid-template-columns:1fr}}
</style>
