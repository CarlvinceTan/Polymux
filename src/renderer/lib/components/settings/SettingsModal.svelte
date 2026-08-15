<script lang="ts">
  import {onMount, tick} from 'svelte';
  import {readableError} from '../../errors';
  import type {AppUpdateDto, AppVersionDto, ChronicleStatusDto, GeneralSettingsDto, McpRegistryEntryDto, McpServerDto, MemoryStatusDto, ModelDto, ModelMetadataDto, ModelRole, ModelRolesDto, ProviderDto, SkillDto, SkillRegistryEntryDto} from '@midas/protocol';
  import {SUPPORTED_LANGUAGES} from '@midas/protocol';
  import {midasApi} from '../../api/midas';
  import {applyTheme, type ThemeMode} from '../../theme';
  import {modelCompanyId, providerName} from '../../options/providerBrands';
  import Icon from '../shared/Icon.svelte';
  import Menu from '../shared/Menu.svelte';
  import ProviderLogo from './ProviderLogo.svelte';
  import HubTab from './HubTab.svelte';
  import DriveTab from './DriveTab.svelte';

  export let onClose: () => void;
  export let onGeneralChange: (settings: GeneralSettingsDto) => void = () => {};

  type Mode = 'general' | 'hub' | 'drive' | 'mcp' | 'skills' | 'model' | 'provider' | 'memory';
  type RailMenu = 'filter' | 'sort' | 'setup';
  type ModelKind = 'text' | 'image' | 'video' | 'audio' | 'embedding';
  type Currency = Exclude<GeneralSettingsDto['currency'], null>;

  const api = midasApi();
  let mode: Mode = 'general';
  let settled = false;
  let search = '';
  let mcpServers: McpServerDto[] = [];
  let skills: SkillDto[] = [];
  let models: ModelDto[] = [];
  let providers: ProviderDto[] = [];
  let chronicle: ChronicleStatusDto | null = null;
  let memory: MemoryStatusDto | null = null;
  let general: GeneralSettingsDto | null = null;
  let updatingMemory = false;
  let updatingChronicle = false;
  let updatingTheme = false;
  let updatingSpeechMode = false;
  let updatingAutoStop = false;
  let updatingTime = false;
  let updatingLocation = false;
  let locating = false;
  let locationError = '';
  let selectedMcp = '';
  let selectedSkill = '';
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
  let loading = true;
  let adding: 'mcp' | 'skills' | null = null;
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
  let modelRoles: ModelRolesDto | null = null;
  let expandedModelKey = '';
  let assigningRole = '';
  let providerFilter = 'all';
  let providerSort = 'default';
  let openRailMenu: RailMenu | null = null;
  let skillAddMenuOpen = false;
  let browsingMcpRegistry = false;
  let mcpRegistryQuery = '';
  let mcpRegistryResults: McpRegistryEntryDto[] = [];
  let mcpRegistryFeatured: McpRegistryEntryDto[] = [];
  let mcpRegistryPreloaded = false;
  let mcpRegistrySearching = false;
  let mcpRegistryError = '';
  let mcpRegistryTimer: ReturnType<typeof setTimeout> | undefined;
  let mcpRegistryRequest = 0;
  let installingMcpRegistryId = '';
  let installingSkill = false;
  let skillRegistryQuery = '';
  let registryResults: SkillRegistryEntryDto[] = [];
  let registrySearching = false;
  let registryError = '';
  let registryTimer: ReturnType<typeof setTimeout> | undefined;
  let registryRequest = 0;
  let installingRegistryId = '';
  let skillFolderInput: HTMLInputElement;
  let railActions: HTMLElement;
  let railList: HTMLUListElement;
  let railAtTop = true;
  let railAtBottom = true;
  let currency: Currency = 'USD';
  let currencyRates: Partial<Record<Currency, number>> = {USD: 1};
  let appVersion: AppVersionDto | null = null;
  let update: AppUpdateDto | null = null;
  let checkingUpdate = false;
  let updatingLanguage = false;
  let modelMetadata: Record<string, ModelMetadataDto> = {};
  let error = '';

  const modelFilterOptions = [{value: 'default', label: 'Default'}, {value: 'all', label: 'All Companies'}, {value: 'custom', label: 'Custom Provider'}, {value: 'kind-text', label: 'Text models'}, {value: 'kind-image', label: 'Image models'}, {value: 'kind-video', label: 'Video models'}, {value: 'kind-audio', label: 'Speech models'}, {value: 'kind-embedding', label: 'Embedding models'}];
  /** Every role a model can be given, in the order the expanded row lists them.
   * `main` is what the agent answers with; `task` and `judge` fall back to it,
   * so only those two can be set back to following it. */
  /* `label` is what the UI shows; `job` is the long form the screen-reader
     labels and tooltips still spell out. */
  const MODEL_ROLES: Array<{value: ModelRole; label: string; job: string; hint: string; followsMain: boolean; kind: ModelKind}> = [
    {value: 'main', label: 'Main', job: 'main model', hint: 'Answers in chat', followsMain: false, kind: 'text'},
    {value: 'task', label: 'Task', job: 'task model', hint: 'Runs subagent tasks', followsMain: true, kind: 'text'},
    {value: 'judge', label: 'Judge', job: 'judge model', hint: 'Decides whether a goal is met', followsMain: true, kind: 'text'},
    {value: 'speech', label: 'Speech', job: 'speech model', hint: 'Speech mode replies', followsMain: false, kind: 'audio'},
    {value: 'image', label: 'Image generation', job: 'image generation model', hint: 'Generates images', followsMain: false, kind: 'image'},
    {value: 'video', label: 'Video generation', job: 'video generation model', hint: 'Generates video', followsMain: false, kind: 'video'},
  ];
  const providerFilterOptions = [{value: 'all', label: 'All providers'}, {value: 'configured', label: 'Configured'}, {value: 'unconfigured', label: 'Not configured'}];
  const mcpFilterOptions = [{value: 'all', label: 'All MCP servers'}, {value: 'enabled', label: 'Enabled'}, {value: 'disabled', label: 'Disabled'}, {value: 'connected', label: 'Connected'}, {value: 'official', label: 'Official'}, {value: 'custom', label: 'Custom'}];
  const skillFilterOptions = [{value: 'all', label: 'All'}, {value: 'enabled', label: 'Enabled'}, {value: 'disabled', label: 'Disabled'}, {value: 'official', label: 'Official'}, {value: 'custom', label: 'Custom'}];
  const modelSortOptions = [{value: 'recommended', label: 'Recommended'}, {value: 'name-asc', label: 'Company A–Z'}, {value: 'name-desc', label: 'Company Z–A'}, {value: 'models-desc', label: 'Most models'}, {value: 'models-asc', label: 'Fewest models'}];
  const providerSortOptions = [{value: 'default', label: 'Default'}, {value: 'recommended', label: 'Recommended'}, {value: 'name-asc', label: 'Provider A–Z'}, {value: 'name-desc', label: 'Provider Z–A'}, {value: 'models-desc', label: 'Most models'}, {value: 'models-asc', label: 'Fewest models'}];
  const mcpSortOptions = [{value: 'recommended', label: 'Recommended'}, {value: 'name-asc', label: 'Server A–Z'}, {value: 'name-desc', label: 'Server Z–A'}];
  const skillSortOptions = [{value: 'recommended', label: 'Recommended'}, {value: 'updated-desc', label: 'Last edited'}, {value: 'name-asc', label: 'Skill A–Z'}, {value: 'name-desc', label: 'Skill Z–A'}];
  const MODE_HEADERS: Record<Mode, {title: string; description: string}> = {
    general: {title: 'General', description: 'Manage Midas preferences and access.'},
    hub: {title: 'Hub', description: 'Connect messaging platforms and email accounts.'},
    drive: {title: 'Drive', description: 'Connect storage providers and choose where files go.'},
    mcp: {title: 'MCP', description: 'Manage Model Context Protocol servers.'},
    skills: {title: 'Skills', description: 'Manage the skills available to Midas.'},
    model: {title: 'Models', description: 'Click a model to assign it to a job.'},
    provider: {title: 'Providers', description: 'Manage model providers and API keys.'},
    memory: {title: 'Memory', description: 'Review and manage Midas memory.'},
  };
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
  $: modelCompanies = groupModels(models, providers, query, modelFilter, modelSort);
  $: visibleProviders = selectProviders(providers, query, providerFilter, providerSort);
  $: railEmpty = mode === 'mcp' ? visibleMcp.length === 0 : mode === 'skills' ? visibleSkills.length === 0 : mode === 'model' ? modelCompanies.length === 0 : visibleProviders.length === 0;
  $: languageOptions = SUPPORTED_LANGUAGES.map(({value, label}) => ({value, label}));
  const autoStopOptions = [
    {value: '3', label: '3 seconds'},
    {value: '6', label: '6 seconds'},
    {value: '10', label: '10 seconds'},
    {value: '20', label: '20 seconds'},
    {value: 'off', label: 'Never'},
  ];
  $: buildDetailText = appVersion
    ? `${appVersion.platform}${appVersion.electron ? ` · Electron ${appVersion.electron}` : ''}${appVersion.packaged ? '' : ' · development build'}`
    : 'Reading build details…';
  $: versionDetailText = update?.status === 'error' && update.message
    ? `${buildDetailText} · ${update.message}`
    : buildDetailText;
  $: updateSummaryText = checkingUpdate
    ? 'Checking for updates…'
    : !update
      ? '—'
      : update.status === 'downloading'
        ? 'Downloading update…'
        : update.status === 'error'
          ? 'Check failed'
          : update.latest && update.latest !== update.version
            ? `Update available · ${update.latest}`
            : 'Latest version';
  $: currencyOptions = currencies.filter((code) => currencyRates[code] !== undefined).map((code) => ({value: code, label: code}));
  $: if (!visibleMcp.some((item) => item.id === selectedMcp)) selectedMcp = visibleMcp[0]?.id ?? '';
  $: if (!visibleSkills.some((item) => item.name === selectedSkill)) selectedSkill = visibleSkills[0]?.name ?? '';
  $: if (!modelCompanies.some((item) => item.id === selectedModelProvider)) {
    const selectedModel = models.find((item) => item.selected);
    const activeCompany = selectedModel ? modelCompanyId(selectedModel) : '';
    selectedModelProvider = modelCompanies.find((item) => item.id === activeCompany)?.id ?? modelCompanies[0]?.id ?? '';
  }
  $: if (!visibleProviders.some((item) => item.id === selectedCredentialProvider)) selectedCredentialProvider = visibleProviders[0]?.id ?? '';
  $: mcp = mcpServers.find((item) => item.id === selectedMcp);
  $: skill = skills.find((item) => item.name === selectedSkill);
  $: modelCompany = modelCompanies.find((item) => item.id === selectedModelProvider);
  $: credentialProvider = providers.find((item) => item.id === selectedCredentialProvider);
  $: visibleCompanyModels = modelCompany?.models ?? [];
  $: activeRailSubject = mode === 'mcp' ? 'MCP servers' : mode === 'skills' ? 'skills' : mode === 'model' ? 'models' : 'providers';
  $: activeRailFilter = mode === 'mcp' ? mcpFilter : mode === 'skills' ? skillFilter : mode === 'model' ? modelFilter : providerFilter;
  $: activeRailSort = mode === 'mcp' ? mcpSort : mode === 'skills' ? skillSort : mode === 'model' ? modelSort : providerSort;
  $: activeRailDefaultSort = mode === 'provider' ? 'default' : 'recommended';
  $: activeRailDefaultFilter = mode === 'model' ? modelDefaultFilter : 'all';
  $: activeRailFilterOptions = mode === 'mcp' ? mcpFilterOptions : mode === 'skills' ? skillFilterOptions : mode === 'model' ? modelFilterOptions : providerFilterOptions;
  $: activeRailSortOptions = mode === 'mcp' ? mcpSortOptions : mode === 'skills' ? skillSortOptions : mode === 'model' ? modelSortOptions : providerSortOptions;
  $: modeHeader = MODE_HEADERS[mode];
  $: railContentKey = `${mode}:${query}:${visibleMcp.length}:${visibleSkills.length}:${modelCompanies.length}:${visibleProviders.length}`;
  $: if (railContentKey) void tick().then(measureRailEdges);
  $: locationStatusText = !general?.locationEnabled
    ? 'Not shared with the agent'
    : locating && !general.location
      ? 'Connecting…'
      : locationError
        ? locationError
        : !general.location
          ? 'Waiting for location permission'
          : 'Shared with the agent';

  onMount(() => {
    void loadAll();
    void loadCurrencyRates();
    // Warm the marketplace while the user is still browsing Settings so its
    // first reveal does not wait on the registry network request.
    void preloadMcpMarketplace();
    return api.mcp.subscribe((update) => {
      mcpServers = update.servers;
      if (update.error) error = `MCP configuration: ${update.error}`;
    });
  });

  function measureRailEdges(): void {
    if (!railList) return;
    railAtTop = railList.scrollTop <= 1;
    railAtBottom = railList.scrollHeight - railList.scrollTop - railList.clientHeight <= 1;
  }

  function matches(value: string, filter: string): boolean {
    return !filter || value.toLocaleLowerCase().includes(filter);
  }

  /** Slugs are lowercase, so acronyms need restoring rather than title-casing —
   * "gui-control" is GUI Control, not Gui Control. */
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
    return item.author ?? (item.source === 'official' ? 'Midas' : 'Custom');
  }

  function skillOrigin(item: SkillDto): string {
    if (item.source === 'official' || item.source === 'bundled') return 'Bundled with Midas';
    if (item.source === 'midas') return 'Midas · ~/.midas/skills';
    if (item.source === 'codex') return 'Codex · ~/.codex/skills';
    if (item.source === 'agents') return 'Agents · ~/.agents/skills';
    return 'Configured folder';
  }

  function skillUpdated(item: SkillDto): string | undefined {
    if (!item.updatedAt) return undefined;
    const time = Date.parse(item.updatedAt);
    if (Number.isNaN(time)) return undefined;
    return new Date(time).toLocaleDateString(undefined, {year: 'numeric', month: 'short', day: 'numeric'});
  }

  function mcpOrigin(item: McpServerDto): string {
    if (item.source === 'official') return 'Bundled with Midas';
    if (item.source === 'codex') return 'Codex';
    return 'Midas';
  }

  function mcpAuthor(item: McpServerDto): string {
    if (item.source === 'official') return 'Midas';
    if (item.source === 'codex') return 'Codex';
    return 'Custom';
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
    if (meta.lab) lines.push(`Lab: ${providerName(meta.lab)}`);
    if (meta.family) lines.push(`Family: ${meta.family}`);
    if (meta.releaseDate) lines.push(`Released: ${meta.releaseDate}`);
    if (meta.knowledgeCutoff) lines.push(`Knowledge cutoff: ${meta.knowledgeCutoff}`);
    if (meta.openWeights !== undefined) lines.push(meta.openWeights ? 'Open weights' : 'Closed weights');
    const skills = [
      meta.toolCall ? 'tools' : '',
      meta.structuredOutput ? 'structured output' : '',
      meta.attachment ? 'attachments' : '',
    ].filter(Boolean);
    if (skills.length) lines.push(`Supports: ${skills.join(', ')}`);
    return lines.join('\n');
  }

  function skillSourceLabel(source: SkillDto['source']): string {
    return source === 'codex' || source === 'midas' || source === 'agents' || source === 'configured'
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

  function groupModels(items: ModelDto[], providerStates: ProviderDto[], searchFilter: string, stateFilter: string, sort: string): Array<{id: string; name: string; logoDataUrl?: string; models: ModelDto[]; selected: boolean; configured: boolean; custom: boolean}> {
    const configuredProviders = new Set(providerStates.filter((provider) => provider.configured).map((provider) => provider.id));
    const providerById = new Map(providerStates.map((provider) => [provider.id, provider]));
    const groups = new Map<string, ModelDto[]>();
    for (const model of items) {
      const id = model.custom ? model.provider : modelCompanyId(model);
      const company = model.custom ? providerById.get(model.provider)?.name ?? providerName(id) : providerName(id);
      if (searchFilter && !`${company} ${model.name} ${model.provider} ${model.id}`.toLocaleLowerCase().includes(searchFilter)) continue;
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
    const visible = items.filter((item) => matches(`${item.name} ${item.id} ${item.source ?? ''}`, searchFilter))
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
    adding = null;
    addingCustomProvider = false;
    openRailMenu = null;
  }

  function selectMcp(id: string): void { browsingMcpRegistry = false; selectedMcp = id; adding = null; }
  function selectSkill(name: string): void { selectedSkill = name; adding = null; }
  function selectModelCompany(id: string): void { selectedModelProvider = id; }

  async function loadAll(): Promise<void> {
    loading = true;
    try {
      [mcpServers, skills, models, providers, memory, chronicle, general] = await Promise.all([api.mcp.list(), api.skills.list(), api.models.list(), api.providers.list(), api.memory.status(), api.chronicle.status(), api.general.get()]);
      currency = general.currency ?? defaultCurrency(general.location);
      error = '';
      // Catalogue detail is decoration: it loads after the lists, and a
      // failure leaves the models on screen exactly as they were.
      void api.models.metadata().then((value) => modelMetadata = value).catch(() => {});
      void api.models.roles().then((value) => modelRoles = value).catch(() => {});
      // Build identity and the update check are equally incidental: they
      // annotate the General tab and must never block the settings lists.
      void api.general.version().then((value) => appVersion = value).catch(() => {});
      void checkForUpdates();
      if (general.locationEnabled && !general.location && window.midas) void refreshLocation();
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
    const settled = new Promise((resolve) => setTimeout(resolve, 600));
    try {
      update = await api.general.checkForUpdates();
    } catch (reason) {
      update = null;
      error = readableError(reason);
    } finally {
      await settled;
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
      locationError = 'Could not determine location';
    } finally {
      locating = false;
    }
  }

  async function setChronicleEnabled(enabled: boolean): Promise<void> {
    updatingChronicle = true;
    try {
      chronicle = await api.chronicle.setEnabled(enabled);
      error = '';
    } catch (reason) {
      error = readableError(reason);
    } finally {
      updatingChronicle = false;
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
      error = '';
    } catch (reason) {
      error = readableError(reason);
    } finally {
      updatingChronicle = false;
    }
  }

  function formatBytes(value: number): string {
    if (value < 1024) return `${value} B`;
    if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
    if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
    return `${(value / 1024 ** 3).toFixed(1)} GB`;
  }

  function formatMemoryTime(value: string | null | undefined): string {
    return value ? new Date(value).toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'}) : 'None';
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

  function beginAdd(kind: 'mcp' | 'skills'): void {
    skillAddMenuOpen = false;
    adding = kind;
    editingIntegration = false;
    installingSkill = false;
    browsingMcpRegistry = false;
    if (kind === 'mcp') {
      customMcpId = ''; customMcpName = ''; customMcpDescription = ''; customMcpTransport = 'stdio'; customMcpTarget = ''; customMcpArgs = ''; customMcpEnvironment = ''; customMcpCwd = '';
    } else {
      customSkillOriginalName = ''; customSkillName = ''; customSkillDescription = ''; customSkillInstructions = '';
    }
    if (kind === 'mcp') selectedMcp = '';
    else selectedSkill = '';
  }

  function beginMcpMarketplace(): void {
    openRailMenu = null;
    adding = null;
    selectedMcp = '';
    browsingMcpRegistry = true;
    mcpRegistryQuery = '';
    mcpRegistryResults = mcpRegistryFeatured;
    mcpRegistryError = '';
    if (!mcpRegistryPreloaded && !mcpRegistrySearching) void preloadMcpMarketplace();
  }

  async function preloadMcpMarketplace(): Promise<void> {
    if (mcpRegistryPreloaded || mcpRegistrySearching) return;
    const request = ++mcpRegistryRequest;
    mcpRegistrySearching = true;
    try {
      const results = await api.mcp.searchRegistry('');
      if (request !== mcpRegistryRequest) return;
      mcpRegistryFeatured = results;
      mcpRegistryPreloaded = true;
      if (!mcpRegistryQuery.trim()) mcpRegistryResults = results;
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
        const results = await api.mcp.searchRegistry(mcpRegistryQuery.trim());
        if (request !== mcpRegistryRequest) return;
        mcpRegistryResults = results;
        if (!mcpRegistryQuery.trim()) {
          mcpRegistryFeatured = results;
          mcpRegistryPreloaded = true;
        }
        mcpRegistryError = '';
      } catch (reason) {
        if (request !== mcpRegistryRequest) return;
        mcpRegistryResults = [];
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
    mcpRegistrySearching = false;
    mcpRegistryError = '';
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

  function beginInstallSkill(): void {
    beginAdd('skills');
    installingSkill = true;
    skillRegistryQuery = '';
    registryResults = [];
    registryError = '';
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

  function searchRegistry(): void {
    clearTimeout(registryTimer);
    const query = skillRegistryQuery.trim();
    if (query.length < 2) {
      registryResults = [];
      registryError = '';
      return;
    }
    registryTimer = setTimeout(() => void (async () => {
      const request = ++registryRequest;
      registrySearching = true;
      try {
        const results = await api.skills.searchRegistry(query);
        if (request !== registryRequest) return;
        registryResults = results;
        registryError = '';
      } catch (reason) {
        if (request !== registryRequest) return;
        registryResults = [];
        registryError = readableError(reason);
      } finally {
        if (request === registryRequest) registrySearching = false;
      }
    })(), 250);
  }

  function clearSkillRegistrySearch(): void {
    clearTimeout(registryTimer);
    registryRequest += 1;
    skillRegistryQuery = '';
    registryResults = [];
    registrySearching = false;
    registryError = '';
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
      if (separator < 1) throw new Error(`Use KEY=value for “${line}”.`);
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

  /** A row opens rather than choosing: which job the model should take is the
   * question now, and the main model is only one of the answers. */
  function toggleModelRow(item: ModelDto): void {
    const key = `${item.provider}/${item.id}`;
    expandedModelKey = expandedModelKey === key ? '' : key;
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

  /** What the role points at today, in the words the row shows under its name. */
  function roleStatus(role: {value: ModelRole; followsMain: boolean}, roles: ModelRolesDto | null): string {
    const assignment = roleAssignment(role.value, roles);
    if (assignment) return assignment.name;
    // A role that falls back names the model it is actually using; whether
    // that is inherited shows in its Set to Main Model button instead.
    const main = role.followsMain ? roleAssignment('main', roles) : null;
    return main?.name ?? 'Not set';
  }

  /** The View Setup line for a role: its own model, or the main model it follows. */
  function roleSetupValue(role: {value: ModelRole; followsMain: boolean}, roles: ModelRolesDto | null): string {
    const assignment = roleAssignment(role.value, roles);
    if (assignment) return assignment.name;
    const main = role.followsMain ? roleAssignment('main', roles) : null;
    return main?.name ?? 'Not set';
  }

  async function assignModelRole(role: ModelRole, item: ModelDto): Promise<void> {
    assigningRole = `${role}:${item.provider}/${item.id}`;
    try {
      modelRoles = await api.models.assignRole(role, item.provider, item.id);
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

  async function resetModelRole(role: ModelRole): Promise<void> {
    assigningRole = `reset:${role}`;
    try {
      modelRoles = await api.models.clearRole(role);
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
  }

  function beginCustomProvider(): void {
    addingCustomProvider = true;
    editingCustomProviderId = '';
    customProviderName = '';
    customProviderUrl = '';
    customProviderKey = '';
    customProviderModels = '';
    customProviderLogoDataUrl = '';
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
    error = '';
  }

  async function chooseCustomProviderLogo(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'].includes(file.type) || file.size > 1_000_000) {
      error = 'Choose a PNG, JPEG, WebP, GIF, or SVG image under 1 MB.';
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
      error = 'Provider name, base URL, and at least one model are required.';
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

  function closeFromBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) onClose();
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
    if (openRailMenu && !railActions?.contains(event.target as Node)) openRailMenu = null;
    if (skillAddMenuOpen && !railActions?.contains(event.target as Node)) skillAddMenuOpen = false;
  }

  function keydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    if (openRailMenu) {
      event.preventDefault();
      event.stopPropagation();
      openRailMenu = null;
      return;
    }
    if (skillAddMenuOpen) {
      event.preventDefault();
      event.stopPropagation();
      skillAddMenuOpen = false;
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

<div class="options-modal-backdrop" role="presentation" onclick={closeFromBackdrop}>
  <div class="options-modal" class:settling={!settled} role="dialog" aria-modal="true" aria-label="Settings">
    <header class="options-header">
      <div>
        <h2>{modeHeader.title}</h2>
        <p>{modeHeader.description}</p>
      </div>
      <button type="button" class="options-close" aria-label="Close Settings" data-tooltip-label="Close" onclick={onClose}><Icon name="close" size={18}/></button>
    </header>

    <div class="options-mode" role="tablist" aria-label="General, hub, drive, MCP, skills, model, provider, or memory">
      <button type="button" role="tab" aria-selected={mode === 'general'} class:active={mode === 'general'} onclick={() => selectMode('general')}>General</button>
      <button type="button" role="tab" aria-selected={mode === 'hub'} class:active={mode === 'hub'} onclick={() => selectMode('hub')}>Hub</button>
      <button type="button" role="tab" aria-selected={mode === 'drive'} class:active={mode === 'drive'} onclick={() => selectMode('drive')}>Drive</button>
      <button type="button" role="tab" aria-selected={mode === 'mcp'} class:active={mode === 'mcp'} onclick={() => selectMode('mcp')}>MCP</button>
      <button type="button" role="tab" aria-selected={mode === 'skills'} class:active={mode === 'skills'} onclick={() => selectMode('skills')}>Skills</button>
      <button type="button" role="tab" aria-selected={mode === 'model'} class:active={mode === 'model'} onclick={() => selectMode('model')}>Models</button>
      <button type="button" role="tab" aria-selected={mode === 'provider'} class:active={mode === 'provider'} onclick={() => selectMode('provider')}>Provider</button>
      <button type="button" role="tab" aria-selected={mode === 'memory'} class:active={mode === 'memory'} onclick={() => selectMode('memory')}>Memory</button>
    </div>

    {#if error}<p class="options-error" role="alert">{error}</p>{/if}

    {#if mode === 'hub'}
      <HubTab {api} />
    {:else if mode === 'drive'}
      <DriveTab {api} />
    {:else if mode === 'general'}
      <div class="general-options" role="tabpanel">
        <section class="general-setting-row">
          <span class="option-mark large"><Icon name="sun" size={18}/></span>
          <span class="general-setting-copy"><h4>Theme</h4><small>Choose how Midas appears</small></span>
          <div class="theme-switch" role="radiogroup" aria-label="Theme">
            {#each ['light', 'dark', 'system'] as theme}
              <button type="button" role="radio" aria-checked={general?.theme === theme} class:active={general?.theme === theme} disabled={updatingTheme || !general} onclick={() => void setTheme(theme as ThemeMode)}>{theme[0].toLocaleUpperCase() + theme.slice(1)}</button>
            {/each}
          </div>
        </section>
        <section class="general-setting-row">
          <span class="option-mark large"><Icon name="book-open" size={18}/></span>
          <span class="general-setting-copy"><h4>Language</h4><small>The language Midas replies in</small></span>
          <div class="setting-menu language" class:busy={updatingLanguage || !general}>
            <Menu options={languageOptions} value={general?.language ?? 'system'} label="Language" wide onChange={(value) => void setLanguage(value)}/>
          </div>
        </section>
        <section class="general-setting-row">
          <span class="option-mark large"><Icon name="waveform" size={18}/></span>
          <span class="general-setting-copy"><h4>Speech mode</h4><small>Enable real-time speech-to-speech conversations</small></span>
          {#if general}<button type="button" class:enabled={general.speechModeEnabled} class="chronicle-toggle" role="switch" aria-label="Enable speech mode" aria-checked={general.speechModeEnabled} disabled={updatingSpeechMode} onclick={() => void setSpeechModeEnabled(!general!.speechModeEnabled)}><span></span></button>{:else}{@render pendingToggle()}{/if}
        </section>
        <section class="general-setting-row">
          <span class="option-mark large"><Icon name="mic-off" size={18}/></span>
          <span class="general-setting-copy"><h4>Stop dictation when silent</h4><small>How long the composer's voice button keeps listening once it stops hearing you</small></span>
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
        <section class="general-setting-row">
          <span class="option-mark large"><Icon name="clock" size={18}/></span>
          <span class="general-setting-copy"><h4>Time</h4><small>{general?.timeEnabled ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'Not shared with the agent'}</small></span>
          {#if general}<button type="button" class:enabled={general.timeEnabled} class="chronicle-toggle" role="switch" aria-label="Enable time access" aria-checked={general.timeEnabled} disabled={updatingTime} onclick={() => void setTimeEnabled(!general!.timeEnabled)}><span></span></button>{:else}{@render pendingToggle()}{/if}
        </section>
        <section class="general-setting-row">
          <span class="option-mark large"><Icon name="globe" size={18}/></span>
          <span class="general-setting-copy"><h4>Location</h4><small>{locationStatusText}</small></span>
          {#if general?.locationEnabled && !locating && (locationError || !general.location)}
            <button type="button" class="permission-retry" onclick={() => void refreshLocation(true)}>Try again</button>
          {/if}
          {#if general}<button type="button" class:enabled={general.locationEnabled} class="chronicle-toggle" role="switch" aria-label="Enable location access" aria-checked={general.locationEnabled} disabled={updatingLocation} onclick={() => void setLocationEnabled(!general!.locationEnabled)}><span></span></button>{:else}{@render pendingToggle()}{/if}
        </section>
        <section class="general-setting-row">
          <span class="option-mark large"><Icon name="verified" size={18}/></span>
          <span class="general-setting-copy"><h4>Version {appVersion?.version ?? '—'}</h4><small>{versionDetailText}</small></span>
          {#if update?.status === 'ready'}
            <button type="button" class="permission-retry" onclick={() => void installUpdate()}>Install now</button>
          {:else}
            <span class="setting-value">{updateSummaryText}</span>
            <button type="button" class="update-refresh" class:spinning={checkingUpdate || update?.status === 'downloading'} aria-label="Check for updates" data-tooltip-label="Check for updates" disabled={checkingUpdate || update?.status === 'downloading'} onclick={() => void checkForUpdates()}><Icon name="reload" size={13}/></button>
          {/if}
        </section>
      </div>
    {:else if mode === 'memory'}
      <div class="memory-options" role="tabpanel">
        <header class="options-detail-header">
          <span class="options-title-group"><h3>Memory</h3></span>
        </header>
        <section class="chronicle-section local-memory-section">
          <header>
            <span><h4>Local memory</h4></span>
            {#if memory}<button type="button" class:enabled={memory.enabled} class="chronicle-toggle" role="switch" aria-label="Enable Memory" aria-checked={memory.enabled} disabled={updatingMemory} onclick={() => void setMemoryEnabled(!memory!.enabled)}><span></span></button>{:else}{@render pendingToggle()}{/if}
          </header>
          <p>The compact memory summary is included automatically. Midas searches the full registry and earlier conversations only when prior context could materially help. Durable memories are added or removed only when you explicitly ask.</p>
          <div class="chronicle-inline-stats" aria-label="Memory storage"><span>{memory?.memories ?? 0} memories</span><span>{formatBytes(memory?.storedBytes ?? 0)}</span><span>Latest: {formatMemoryTime(memory?.latestMemoryAt)}</span><span>Consolidated: {formatMemoryTime(memory?.consolidatedAt)}</span>{#if (memory?.pendingMemories ?? 0) > 0}<span>{memory?.pendingMemories} pending</span>{/if}</div>
        </section>
        {#if memory?.consolidationError}
          <section class="chronicle-error">
            <span><h4>Memory consolidation failed</h4><p>{memory.consolidationError}</p><small>The existing summary is still in use.{#if memory.consolidationRetryAfter} Retrying automatically after {formatMemoryTime(memory.consolidationRetryAfter)}.{:else} Retrying on the next turn.{/if}</small></span>
          </section>
        {/if}
        <div class="memory-divider"></div>
        <div class="chronicle-group" class:disabled={!memory?.enabled}>
          <section class="chronicle-section">
            <header>
              <span><h4>Chronicle</h4>{#if !chronicle?.running}<small>Recent screen context is off</small>{/if}</span>
              {#if chronicle}<button type="button" class:enabled={chronicle.enabled} class="chronicle-toggle" role="switch" aria-label="Enable Chronicle" aria-checked={chronicle.enabled} disabled={!memory?.enabled || updatingChronicle} onclick={() => void setChronicleEnabled(!chronicle!.enabled)}><span></span></button>{:else}{@render pendingToggle()}{/if}
            </header>
            <p>Private, local history of what you were working on, with adaptive sampling and rolling 24-hour retention. It automatically pauses while your Mac is locked, idle, or thermally constrained.</p>
            <div class="chronicle-inline-stats"><span>{chronicle?.storedFrames ?? 0} captures</span><span>{formatBytes(chronicle?.storedBytes ?? 0)}</span><span>Latest: {formatMemoryTime(chronicle?.lastCapturedAt)}</span></div>
          </section>
          {#if chronicle?.lastError}
            <section class="chronicle-error">
              <span><h4>Capture unavailable</h4><p>{chronicle.lastError}</p><small>You may need to allow Accessibility for Midas in macOS System Settings.</small></span>
              <button type="button" disabled={!memory?.enabled || updatingChronicle} onclick={() => void retryChronicle()}>{updatingChronicle ? 'Trying…' : 'Try again'}</button>
            </section>
          {/if}
        </div>
        {#if memory}<p class="options-path">{memory.directory}</p>{/if}
      </div>
    {:else}
    <div class="options-body">
      <div class="options-rail">
        <div class="options-search">
          <Icon name="search" size={15}/>
          <input bind:value={search} type="search" placeholder={`Search ${mode === 'mcp' ? 'MCP server' : mode === 'model' ? 'model' : mode}`} aria-label={`Search ${mode === 'mcp' ? 'MCP server' : mode === 'model' ? 'model' : mode}`}/>
          {#if search}<button type="button" class="search-clear" aria-label="Clear" data-tooltip-label="Clear" onclick={() => search = ''}><Icon name="close" size={13} strokeWidth={1.7}/></button>{/if}
        </div>

        <ul class="options-rail-list" class:empty-state={railEmpty} class:at-top={railAtTop} class:at-bottom={railAtBottom} bind:this={railList} onscroll={measureRailEdges}>
          {#if mode === 'mcp'}
            {#each visibleMcp as item (item.id)}
              <li><button type="button" class:selected={adding !== 'mcp' && item.id === selectedMcp} class:integration-disabled={!item.enabled} class="options-rail-row" onclick={() => selectMcp(item.id)}>
                <span class="options-rail-copy"><span class="skill-name-line"><strong>{item.name}</strong>{#if item.source === 'official'}<span class="official-rail-stamp" aria-label="Official"><Icon name="verified" size={13} strokeWidth={1.8}/></span>{/if}</span><small>{mcpAuthor(item)} · {mcpStatus(item)}</small></span>
              </button></li>
            {:else}<li class="options-empty rail-empty">{loading ? 'Loading MCP servers…' : !query && mcpServers.length === 0 ? 'No MCP servers yet' : 'No MCP servers found'}</li>{/each}
          {:else if mode === 'skills'}
            {#each visibleSkills as item (item.name)}
              <li><button type="button" class:selected={adding !== 'skills' && item.name === selectedSkill} class:integration-disabled={!item.enabled} class="options-rail-row" onclick={() => selectSkill(item.name)}>
                <span class="options-rail-copy"><span class="skill-name-line"><strong>{skillTitle(item)}</strong>{#if item.source === 'official'}<span class="official-rail-stamp" aria-label="Official"><Icon name="verified" size={13} strokeWidth={1.8}/></span>{/if}</span><small>{skillAuthor(item)} · {item.enabled ? 'Active' : 'Inactive'}</small></span>
              </button></li>
            {:else}<li class="options-empty rail-empty">{loading ? 'Loading skills…' : !query && skills.length === 0 ? 'No skills yet' : 'No skills found'}</li>{/each}
          {:else if mode === 'model'}
            {#each modelCompanies as company (company.id)}
              <li><button type="button" class:selected={company.id === selectedModelProvider} class="options-rail-row provider-row" onclick={() => selectModelCompany(company.id)}>
                <span class="provider-mark"><ProviderLogo provider={company.id} logoDataUrl={company.logoDataUrl} size={18}/></span>
                <span class="options-rail-copy"><span class="options-name"><strong>{company.name}</strong></span><small>{company.models.length} {company.models.length === 1 ? 'model' : 'models'}</small></span>
              </button></li>
            {:else}<li class="options-empty rail-empty">{loading ? 'Loading model companies…' : 'No model companies found'}</li>{/each}
          {:else}
            {#each visibleProviders as item (item.id)}
              <li><button type="button" class:selected={!addingCustomProvider && item.id === selectedCredentialProvider} class:has-check={!item.custom && item.configured} class="options-rail-row provider-row" onclick={() => chooseCredentialProvider(item.id)}>
                <span class="provider-mark"><ProviderLogo provider={item.id} logoDataUrl={item.logoDataUrl} size={18}/></span>
                <span class="options-rail-copy"><span class="options-name"><strong>{item.name}</strong>{#if item.custom}<i>Custom</i>{/if}</span><small>{item.modelCount} {item.modelCount === 1 ? 'model' : 'models'}</small></span>
                {#if !item.custom && item.configured}<span class="configured-check" aria-label="Configured"><Icon name="check" size={13}/></span>{/if}
              </button></li>
            {:else}<li class="options-empty rail-empty">{loading ? 'Loading providers…' : 'No providers found'}</li>{/each}
          {/if}
        </ul>

        <div class="options-rail-tools" bind:this={railActions}>
            <div class="rail-tool-wrap">
              <button type="button" class:active={activeRailFilter !== activeRailDefaultFilter} class="rail-tool" aria-label={`Filter ${activeRailSubject}`} aria-haspopup="menu" aria-expanded={openRailMenu === 'filter'} data-tooltip-label="Filter" onclick={() => toggleRailMenu('filter')}><Icon name="filter" size={15}/></button>
              {#if openRailMenu === 'filter'}
                <div class="polymux-dropdown-menu rail-tool-menu" role="menu" aria-label={`Filter ${activeRailSubject}`}>
                  {#each activeRailFilterOptions as option (option.value)}
                    <button type="button" class="polymux-dropdown-item" role="menuitemradio" aria-checked={option.value === activeRailFilter} onclick={() => chooseRailOption('filter', option.value)}><span>{option.label}</span>{#if option.value === activeRailFilter}<Icon name="check" size={13}/>{/if}</button>
                  {/each}
                </div>
              {/if}
            </div>
            <div class="rail-tool-wrap">
              <button type="button" class:active={activeRailSort !== activeRailDefaultSort} class="rail-tool" aria-label={`Sort ${activeRailSubject}`} aria-haspopup="menu" aria-expanded={openRailMenu === 'sort'} data-tooltip-label="Sort" onclick={() => toggleRailMenu('sort')}><Icon name="sort" size={15}/></button>
              {#if openRailMenu === 'sort'}
                <div class="polymux-dropdown-menu rail-tool-menu" role="menu" aria-label={`Sort ${activeRailSubject}`}>
                  {#each activeRailSortOptions as option (option.value)}
                    <button type="button" class="polymux-dropdown-item" role="menuitemradio" aria-checked={option.value === activeRailSort} onclick={() => chooseRailOption('sort', option.value)}><span>{option.label}</span>{#if option.value === activeRailSort}<Icon name="check" size={13}/>{/if}</button>
                  {/each}
                </div>
              {/if}
            </div>
            {#if mode === 'model'}
              <div class="rail-tool-wrap">
                <button type="button" class:active={openRailMenu === 'setup'} class="rail-tool rail-tool-text" aria-haspopup="menu" aria-expanded={openRailMenu === 'setup'} onclick={() => toggleRailMenu('setup')}>View Setup</button>
                {#if openRailMenu === 'setup'}
                  <div class="polymux-dropdown-menu rail-tool-menu role-setup-menu" role="menu" aria-label="Model setup">
                    {#each MODEL_ROLES as role (role.value)}
                      <div class="role-setup-row" role="menuitem"><span>{role.label}</span><strong>{roleSetupValue(role, modelRoles)}</strong></div>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
            {#if mode === 'mcp'}
              <button type="button" class:active={browsingMcpRegistry} class="rail-tool" aria-label="Browse MCP Marketplace" data-tooltip-label="MCP Marketplace" onclick={beginMcpMarketplace}><Icon name="storefront" size={15}/></button>
              <button type="button" class:active={adding === 'mcp'} class="rail-tool" aria-label="Add MCP server" data-tooltip-label="Add MCP server" onclick={() => beginAdd('mcp')}><Icon name="plus" size={15}/></button>
            {:else if mode === 'skills'}
              <div class="rail-tool-wrap">
                <button type="button" class:active={adding === 'skills' || skillAddMenuOpen} class="rail-tool" aria-label="Add Skills" aria-haspopup="menu" aria-expanded={skillAddMenuOpen} data-tooltip-label="Add Skills" onclick={() => { openRailMenu = null; skillAddMenuOpen = !skillAddMenuOpen; }}><Icon name="plus" size={15}/></button>
                {#if skillAddMenuOpen}
                  <div class="polymux-dropdown-menu rail-tool-menu skill-add-menu" role="menu" aria-label="Add Skills">
                    <button type="button" class="polymux-dropdown-item" role="menuitem" onclick={() => beginAdd('skills')}><span>Create Custom</span></button>
                    <button type="button" class="polymux-dropdown-item" role="menuitem" onclick={beginInstallSkill}><span>Install from Vercel Skills</span></button>
                    <button type="button" class="polymux-dropdown-item" role="menuitem" onclick={() => skillFolderInput.click()}><span>Upload Skills</span></button>
                    <input bind:this={skillFolderInput} class="skill-folder-input" type="file" webkitdirectory multiple aria-label="Upload skill folder" onchange={(event) => void uploadSkillFolder(event)}/>
                  </div>
                {/if}
              </div>
            {/if}
            {#if mode === 'provider'}
              <button type="button" class:active={addingCustomProvider} class="rail-tool" aria-label="Add custom provider" data-tooltip-label="Add custom provider" onclick={beginCustomProvider}><Icon name="plus" size={15}/></button>
            {/if}
          </div>
      </div>

      <div class:directory-open={(mode === 'skills' && adding === 'skills' && installingSkill) || (mode === 'mcp' && browsingMcpRegistry)} class:mcp-detail={mode === 'mcp' && !!mcp && !adding && !browsingMcpRegistry} class:skill-detail={mode === 'skills' && !!skill && !adding} class="options-detail" role="tabpanel">
        {#if mode === 'mcp' && browsingMcpRegistry}
          <header class="options-detail-header"><span class="options-title-group"><h3>MCP Marketplace</h3></span></header>
          <section class="skill-registry">
            <div class="model-search">
              <Icon name="search" size={14}/>
              <input bind:value={mcpRegistryQuery} type="search" placeholder="Search MCP Marketplace" aria-label="Search MCP Marketplace" spellcheck="false" oninput={() => searchMcpMarketplace()}/>
              {#if mcpRegistryQuery}<button type="button" class="search-clear" aria-label="Clear" data-tooltip-label="Clear" onclick={clearMcpMarketplaceSearch}><Icon name="close" size={13} strokeWidth={1.7}/></button>{/if}
            </div>
            <ul class="skill-registry-results">
              {#each mcpRegistryResults as entry (entry.id)}
                <li>
                  <span class="skill-registry-copy"><strong>{entry.name}</strong><small>{entry.description}</small></span>
                  {#if mcpServers.some((item) => item.url === entry.url && item.editable)}
                    <button type="button" class="permission-retry" disabled={installingMcpRegistryId !== ''} onclick={() => void uninstallMcpRegistryEntry(entry)}>{installingMcpRegistryId === entry.id ? 'Uninstalling…' : 'Uninstall'}</button>
                  {:else if mcpServers.some((item) => item.url === entry.url)}
                    <span class="skill-registry-installed">Installed</span>
                  {:else if entry.requiredHeaders.length}
                    <button type="button" class="permission-retry" onclick={() => configureMcpRegistryEntry(entry)}>Configure</button>
                  {:else}
                    <button type="button" class="permission-retry" disabled={installingMcpRegistryId !== ''} onclick={() => void installMcpRegistryEntry(entry)}>{installingMcpRegistryId === entry.id ? 'Installing…' : 'Install'}</button>
                  {/if}
                </li>
              {:else}
                <li class="skill-registry-empty">{mcpRegistrySearching ? 'Searching…' : mcpRegistryError || 'No remote MCP servers matched that search.'}</li>
              {/each}
            </ul>
            <div class="custom-provider-actions"><button type="button" onclick={() => { browsingMcpRegistry = false; selectedMcp = visibleMcp[0]?.id ?? ''; }}>Done</button></div>
          </section>
        {:else if mode === 'mcp' && adding === 'mcp'}
          <header class="options-detail-header"><span class="option-mark large"><Icon name={editingIntegration ? 'edit' : 'plus'} size={18}/></span><span class="options-title-group"><h3>{editingIntegration ? 'Edit MCP server' : 'Add MCP server'}</h3></span></header>
          <form class="custom-integration-form" onsubmit={(event) => { event.preventDefault(); void saveCustomMcp(); }}>
            <label>Server ID<input bind:value={customMcpId} disabled={editingIntegration} placeholder="my-server" required/></label>
            <label>Name<input bind:value={customMcpName} placeholder="My server" required/></label>
            <label>Description<input bind:value={customMcpDescription} placeholder="What this MCP server provides"/></label>
            <label>Transport<select bind:value={customMcpTransport}><option value="stdio">Local command</option><option value="streamable-http">Remote HTTP</option></select></label>
            <label>{customMcpTransport === 'stdio' ? 'Command' : 'URL'}<input bind:value={customMcpTarget} placeholder={customMcpTransport === 'stdio' ? 'node' : 'https://example.com/mcp'} required/></label>
            {#if customMcpTransport === 'stdio'}<label>Arguments<textarea bind:value={customMcpArgs} placeholder="One argument per line"></textarea></label><label>Working directory<input bind:value={customMcpCwd} placeholder="Optional"/></label>{/if}
            <label>{customMcpTransport === 'stdio' ? 'Environment' : 'Headers'}<textarea bind:value={customMcpEnvironment} placeholder="KEY=value, one per line"></textarea></label>
            <div class="custom-provider-actions"><button type="button" onclick={() => adding = null}>Cancel</button><button class="credential-primary" type="submit" disabled={integrationSaving}>{integrationSaving ? 'Saving…' : 'Save'}</button></div>
          </form>
        {:else if mode === 'skills' && adding === 'skills' && installingSkill}
          <header class="options-detail-header"><span class="options-title-group"><h3>Vercel Skills</h3></span></header>
          <section class="skill-registry">
            <div class="model-search">
              <Icon name="search" size={14}/>
              <input bind:value={skillRegistryQuery} type="search" placeholder="Search Vercel Skills" aria-label="Search Vercel Skills" spellcheck="false" oninput={searchRegistry}/>
              {#if skillRegistryQuery}<button type="button" class="search-clear" aria-label="Clear" data-tooltip-label="Clear" onclick={clearSkillRegistrySearch}><Icon name="close" size={13} strokeWidth={1.7}/></button>{/if}
            </div>
            <ul class="skill-registry-results">
              {#each registryResults as entry (entry.id)}
                <li>
                  <span class="skill-registry-copy"><strong>{entry.name}</strong><small>{entry.source} · {formatInstalls(entry.installs)} installs</small></span>
                  {#if skills.some((item) => item.name === entry.name && item.editable)}
                    <button type="button" class="permission-retry" disabled={installingRegistryId !== ''} onclick={() => void uninstallRegistryEntry(entry)}>{installingRegistryId === entry.id ? 'Uninstalling…' : 'Uninstall'}</button>
                  {:else if skills.some((item) => item.name === entry.name)}
                    <span class="skill-registry-installed">Installed</span>
                  {:else}
                    <button type="button" class="permission-retry" disabled={installingRegistryId !== ''} onclick={() => void installRegistryEntry(entry)}>{installingRegistryId === entry.id ? 'Installing…' : 'Install'}</button>
                  {/if}
                </li>
              {:else}
                <li class="skill-registry-empty">{registrySearching ? 'Searching…' : registryError ? registryError : skillRegistryQuery.trim().length < 2 ? 'Type to search Vercel Skills.' : 'No skills matched that search.'}</li>
              {/each}
            </ul>
            <div class="custom-provider-actions"><button type="button" onclick={() => { adding = null; installingSkill = false; }}>Done</button></div>
          </section>
        {:else if mode === 'skills' && adding === 'skills'}
          <header class="options-detail-header"><span class="option-mark large"><Icon name={editingIntegration ? 'edit' : 'plus'} size={18}/></span><span class="options-title-group"><h3>{editingIntegration ? 'Edit Skill' : 'Add Skill'}</h3></span></header>
          <form class="custom-integration-form skill-form" onsubmit={(event) => { event.preventDefault(); void saveCustomSkill(); }}>
            <label>Name<input bind:value={customSkillName} placeholder="my-skill" required/></label>
            <label>Description<input bind:value={customSkillDescription} placeholder="When Midas should use this skill" required/></label>
            <label>Instructions<textarea class="instructions" bind:value={customSkillInstructions} placeholder="Skill instructions" required></textarea></label>
            <div class="custom-provider-actions"><button type="button" onclick={() => adding = null}>Cancel</button><button class="credential-primary" type="submit" disabled={integrationSaving}>{integrationSaving ? 'Saving…' : 'Save'}</button></div>
          </form>
        {:else if mode === 'mcp' && mcp}
          <header class="options-detail-header">
            <span class="options-title-group"><h3>{mcp.name}</h3></span>
            {#if mcp.editable}<button type="button" class="provider-edit" aria-label="Edit MCP server" onclick={() => editMcp(mcp)}><Icon name="edit" size={14}/></button><button type="button" class="provider-edit destructive" aria-label="Delete MCP server" disabled={integrationSaving} onclick={() => void removeMcp(mcp)}><Icon name="trash" size={14}/></button>{/if}
            <button type="button" class:enabled={mcp.enabled} class="chronicle-toggle" role="switch" aria-label="Enable MCP server" aria-checked={mcp.enabled} disabled={mcpUpdatingIds.has(mcp.id)} onclick={() => void setMcpEnabled(mcp)}><span></span></button>
          </header>
          <section class="options-detail-block"><h4>Description</h4><p>{mcp.description ?? 'No description provided.'}</p></section>
          <section class="options-detail-block">
            <h4>Details</h4>
            <dl class="skill-meta">
              <div><dt>Source</dt><dd>{mcpOrigin(mcp)}</dd></div>
              <div><dt>Transport</dt><dd>{mcp.transport === 'stdio' ? 'Stdio' : 'Streamable HTTP'}</dd></div>
              <div><dt>Status</dt><dd title={mcp.error ?? undefined}>{mcp.error ?? mcpStatus(mcp)}</dd></div>
              <div><dt>Availability</dt><dd>{mcp.enabled ? 'Enabled' : 'Disabled'}</dd></div>
            </dl>
          </section>
          <div class="options-resources">
            <section><header><h4>Tools</h4><span>{mcp.toolNames.length}</span></header><ul>{#each mcp.toolNames as name}<li><Icon name="wrench" size={14}/>{mcpToolName(name)}</li>{:else}<li class="muted">No tools exposed</li>{/each}</ul></section>
            <section><header><h4>Resources</h4><span>{mcp.resourceUris.length}</span></header><ul>{#each mcp.resourceUris as uri}<li><Icon name="link" size={14} strokeWidth={1}/>{mcpResourceName(uri)}</li>{:else}<li class="muted">No resources exposed</li>{/each}</ul></section>
          </div>
        {:else if mode === 'skills' && skill}
          <header class="options-detail-header">
            <span class="options-title-group"><h3>{skillTitle(skill)}</h3>{#if skill.source === 'official'}<span class="options-badge official-badge"><Icon name="verified" size={11} strokeWidth={1.8}/><span>Official</span></span>{/if}</span>
            <div class="skill-detail-actions">
              {#if skill.editable}<button type="button" class="provider-edit" aria-label="Edit skill" onclick={() => editSkill(skill)}><Icon name="edit" size={14}/></button><button type="button" class="provider-edit destructive" aria-label="Delete skill" disabled={integrationSaving} onclick={() => void removeSkill(skill)}><Icon name="trash" size={14}/></button>{/if}
              <button type="button" class:enabled={skill.enabled} class="chronicle-toggle" role="switch" aria-label="Enable skill" aria-checked={skill.enabled} disabled={integrationSaving} onclick={() => void setSkillEnabled(skill)}><span></span></button>
            </div>
          </header>
          <section class="options-detail-block"><h4>Description</h4><p class="skill-description">{skill.description}</p></section>
          <section class="options-detail-block">
            <h4>Details</h4>
            <dl class="skill-meta">
              <div><dt>Author</dt><dd>{skillAuthor(skill)}</dd></div>
              <div><dt>Category</dt><dd>{skill.category ?? 'General'}</dd></div>
              <div><dt>Last edited</dt><dd>{skillUpdated(skill) ?? 'Unknown'}</dd></div>
              <div><dt>Source</dt><dd>{skillOrigin(skill)}</dd></div>
            </dl>
          </section>
          {#if skill.disableModelInvocation}<section class="options-detail-block"><h4>Invocation</h4><p>Only available when explicitly requested.</p></section>{/if}
          <p class="options-path">{skill.filePath}</p>
        {:else if mode === 'model' && modelCompany}
          <header class="options-detail-header provider-detail-header model-detail-header">
            <span class="provider-mark large"><ProviderLogo provider={modelCompany.id} logoDataUrl={modelCompany.logoDataUrl} size={22}/></span>
            <span class="options-title-group"><h3>{modelCompany.name}</h3><span class="model-count">{modelCompany.models.length} {modelCompany.models.length === 1 ? 'model' : 'models'}</span></span>
          </header>
          <div class="pricing-toolbar">
            <p class="pricing-note">Prices are per 1M tokens. Some rates may be unavailable or not applicable.</p>
            <div class="currency-menu"><Menu options={currencyOptions} bind:value={currency} label="Currency" onChange={(value) => void setCurrency(value)}/></div>
          </div>
          <div class="model-table-wrap">
            <table class="model-table">
              <thead><tr><th>Model</th><th>Input</th><th>Output</th><th>Cache hit</th><th>Cache write</th><th>Context</th></tr></thead>
              <tbody>
                {#each visibleCompanyModels as item (`${item.provider}/${item.id}`)}
                  {@const key = `${item.provider}/${item.id}`}
                  <!-- The whole row toggles, not just its name: a click anywhere
                       along a price cell is aimed at the same row. Keyboard
                       access stays on the button the row wraps. -->
                  <tr class:active={item.selected} class:expanded={expandedModelKey === key} class="model-row" onclick={() => toggleModelRow(item)}>
                    <td><button type="button" class="model-row-name" data-tooltip-label={modelTooltip(item)} data-tooltip-delay="1500" data-tooltip-wide aria-expanded={expandedModelKey === key} aria-label={`Assign ${item.name}`} onclick={(event) => {event.stopPropagation(); toggleModelRow(item);}}><strong>{item.name}</strong><small>{modelSubtitle(item)}</small></button></td>
                    <td>{formatPrice(item.cost.input, currency, currencyRates)}</td>
                    <td>{formatPrice(item.cost.output, currency, currencyRates)}</td>
                    <td>{formatPrice(item.cost.cacheRead, currency, currencyRates)}</td>
                    <td>{formatPrice(item.cost.cacheWrite, currency, currencyRates)}</td>
                    <td>{formatTokens(item.contextWindow)}</td>
                  </tr>
                  {#if expandedModelKey === key}
                    <tr class="model-roles-row">
                      <td colspan="6">
                        <div class="model-roles">
                          {#each modelRoleOptions(item) as role (role.value)}
                            {@const held = roleHoldsModel(role.value, item, modelRoles)}
                            <div class="model-role" class:held>
                              <span class="model-role-copy"><strong>{role.label}</strong><small>{roleStatus(role, modelRoles)}</small></span>
                              <span class="model-role-actions">
                                {#if role.followsMain}
                                  <button type="button" class="model-role-reset" disabled={!roleAssignment(role.value, modelRoles) || assigningRole !== ''} onclick={() => void resetModelRole(role.value)}>Set to Main</button>
                                {/if}
                                <button type="button" class="model-role-change" disabled={held || assigningRole !== ''} aria-label={held ? `${item.name} is the ${role.job}` : `Set ${item.name} as the ${role.job}`} data-tooltip-label={role.hint} onclick={() => void assignModelRole(role.value, item)}>
                                  {held ? 'Current' : assigningRole === `${role.value}:${key}` ? 'Setting…' : 'Set'}
                                </button>
                              </span>
                            </div>
                          {:else}
                            <p class="model-roles-empty">This model can’t be assigned to a job.</p>
                          {/each}
                        </div>
                      </td>
                    </tr>
                  {/if}
                {:else}
                  <tr><td class="model-table-empty" colspan="6">No models found</td></tr>
                {/each}
              </tbody>
            </table>
          </div>
        {:else if mode === 'provider' && addingCustomProvider}
          <header class="options-detail-header provider-detail-header">
            <label class="custom-provider-logo" aria-label="Upload provider image">
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" aria-label="Custom provider image" onchange={(event) => void chooseCustomProviderLogo(event)}/>
              <span class="option-mark large custom-provider-logo-preview">
                {#if customProviderLogoDataUrl}<img src={customProviderLogoDataUrl} alt=""/>{:else}<Icon name="plus" size={18}/>{/if}
              </span>
            </label>
            <span class="options-title-group"><h3>{editingCustomProviderId ? 'Edit custom provider' : 'Add custom provider'}</h3><span class="options-badge">OpenAI compatible</span></span>
          </header>
          <form class="custom-provider-form" onsubmit={(event) => {event.preventDefault(); void createCustomProvider();}}>
            <p>Connect an OpenAI-compatible Chat Completions endpoint and define the models it exposes.</p>
            <label><span class="field-label">Provider name <span class="required-mark" aria-hidden="true">*</span></span><input bind:value={customProviderName} aria-label="Custom provider name" placeholder="Local AI" autocomplete="off" required/></label>
            <label><span class="field-label">Base URL <span class="required-mark" aria-hidden="true">*</span></span><input bind:value={customProviderUrl} aria-label="Custom provider base URL" placeholder="http://localhost:11434/v1" autocomplete="off" spellcheck="false" required/></label>
            {#if !editingCustomProviderId}<label>API key <small>Optional for local endpoints</small><input bind:value={customProviderKey} aria-label="Custom provider API key" type="password" placeholder="Paste API key" autocomplete="off" spellcheck="false"/></label>{/if}
            <label><span class="field-label">Models <span class="required-mark" aria-hidden="true">*</span></span><textarea bind:value={customProviderModels} aria-label="Custom provider models" rows="5" placeholder={'model-id | Display name\nanother-model'} required></textarea><small>One model per line. Add a display name after a vertical bar if needed.</small></label>
            <div class="custom-provider-actions">
              <button type="button" onclick={() => {addingCustomProvider = false; editingCustomProviderId = '';}}>Cancel</button>
              <button type="submit" class="credential-primary" disabled={savingCredential}>{savingCredential ? 'Saving…' : editingCustomProviderId ? 'Save changes' : 'Add provider'}</button>
            </div>
          </form>
        {:else if mode === 'provider' && credentialProvider}
          <header class="options-detail-header provider-detail-header">
            <span class="provider-mark large"><ProviderLogo provider={credentialProvider.id} logoDataUrl={credentialProvider.logoDataUrl} size={22}/></span>
            <span class="options-title-group"><h3>{credentialProvider.name}</h3><span class:good={credentialProvider.configured} class="options-badge">{credentialProvider.configured ? 'Configured' : credentialProvider.storedCredential ? 'Saved' : 'Not configured'}</span></span>
            {#if credentialProvider.custom}<button type="button" class="provider-edit" aria-label={`Edit ${credentialProvider.name}`} onclick={() => editCustomProvider(credentialProvider)}><Icon name="edit" size={14}/></button>{/if}
          </header>
          <section class="credential-panel">
            <div class="credential-copy">
              <h4>API key</h4>
              <p>{credentialProvider.apiKeyLabel ?? `Configure credentials for ${credentialProvider.name}.`} Saved keys are encrypted by the operating system and are never displayed again. Add more than one and Midas rotates through them automatically, retrying with the next key whenever one is rate limited or rejected.</p>
            </div>
            {#if credentialProvider.apiKeyLabel}
              <form class="credential-form" onsubmit={(event) => {event.preventDefault(); void saveCredential();}}>
                <div class="credential-input-row">
                  <input id="provider-api-key" bind:value={credentialKey} aria-label="API key" type="password" autocomplete="off" spellcheck="false" placeholder="Enter API key"/>
                  <button type="submit" class="credential-primary" disabled={savingCredential || !credentialKey.trim()}>{savingCredential ? 'Saving…' : 'Add key'}</button>
                </div>
              </form>
            {:else}
              <p class="credential-unavailable">This provider does not accept an API key through Midas.</p>
            {/if}
            <div class="credential-keys">
              {#each credentialProvider.apiKeys as key (key.id)}
                <div class="credential-key-row">
                  <span class="credential-key-state" class:active={key.status === 'ready'} class:invalid={key.status === 'invalid'} class:limited={key.status === 'rate_limited'}></span>
                  <span><strong>{key.label}</strong><small>{key.status === 'invalid' ? 'Invalid' : key.status === 'rate_limited' ? 'Rate limited' : 'Ready'}</small></span>
                  <button type="button" aria-label={`Remove ${key.label}`} data-tooltip-label="Remove" disabled={savingCredential} onclick={() => void removeCredential(key.id)}><Icon name="trash" size={14}/></button>
                </div>
              {/each}
            </div>
          </section>
        {:else}
          <p class="options-empty detail">Select an item to view its details.</p>
        {/if}
      </div>
    </div>
    {/if}
  </div>
</div>

<style>
  .options-modal-backdrop{position:fixed;z-index:1000;inset:0;display:grid;place-items:center;padding:48px;background:rgba(20,20,20,.28);backdrop-filter:blur(5px);animation:backdrop-in .16s ease-out}
  .options-modal{--options-content-edge:14px;--options-detail-edge:32px;--options-tab-inline:11px;--options-divider-gap:15px;width:min(780px,calc(100vw - 96px));height:min(620px,calc(100vh - 96px));display:flex;flex-direction:column;overflow:hidden;border:0;border-radius:20px;background:var(--app-bg);box-shadow:0 24px 80px rgba(0,0,0,.3);animation:modal-in .22s cubic-bezier(.22,1,.36,1)}
  .options-modal.settling :global(*){transition:none!important;animation:none!important}
  .options-header{flex:none;display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding:30px 32px 18px}.options-header>div{min-width:0}.options-header h2{margin:0;color:var(--neutral-950);font-size:28px;font-weight:570;letter-spacing:-.025em}.options-header p{margin:7px 0 0;color:var(--neutral-600);font-size:12.5px;line-height:1.5}
  .options-close{width:32px;height:32px;display:grid;flex:none;place-items:center;border:0;border-radius:10px;padding:0;background:transparent;color:var(--neutral-500);cursor:pointer}.options-close:hover,.options-close:focus-visible{outline:none;background:var(--neutral-100);color:var(--neutral-950)}
  .options-mode{align-self:flex-start;display:flex;gap:4px;margin:0 var(--options-detail-edge) 14px var(--options-content-edge)}.options-mode button{border:0;border-radius:8px;padding:5px var(--options-tab-inline);background:transparent;color:var(--neutral-500);cursor:pointer;font-family:inherit;font-size:13px}.options-mode button:hover{color:var(--neutral-900)}.options-mode button.active{background:var(--neutral-100);color:var(--neutral-950);font-weight:540}
  .options-error{margin:0 18px 8px;padding:7px 10px;border-radius:8px;background:var(--neutral-100);color:var(--neutral-700);font-size:12px}
  .general-options{flex:1;min-height:0;overflow-y:auto;padding:2px var(--options-detail-edge) 20px calc(var(--options-content-edge) + var(--options-tab-inline))}.general-setting-row{display:flex;align-items:center;gap:11px;min-height:62px;border-bottom:1px solid var(--neutral-200)}.general-setting-copy{min-width:0;flex:1;display:flex;flex-direction:column;gap:3px}.general-setting-copy h4{margin:0;color:var(--neutral-900);font-size:12.5px;font-weight:570}.general-setting-copy small{overflow:hidden;color:var(--neutral-500);text-overflow:ellipsis;white-space:nowrap;font-size:10.5px}.permission-retry{height:28px;flex:none;border:1px solid var(--neutral-200);border-radius:8px;padding:0 10px;background:var(--app-surface);color:var(--neutral-700);cursor:pointer;font-family:inherit;font-size:10.5px;font-weight:550}.permission-retry:hover,.permission-retry:focus-visible{outline:0;background:var(--neutral-100);color:var(--neutral-950)}.setting-menu{flex:none}.setting-menu.language{--select-menu-rows:5}.setting-menu.busy{pointer-events:none;opacity:.5}.setting-menu :global(.select-menu-trigger){height:28px;border-radius:8px;font-size:10.5px}.theme-switch{display:flex;flex:none;gap:2px;padding:2px;border-radius:9px;background:var(--neutral-100)}.theme-switch button{height:26px;border:0;border-radius:7px;padding:0 9px;background:transparent;color:var(--neutral-500);cursor:pointer;font-family:inherit;font-size:10.5px}.theme-switch button:hover,.theme-switch button:focus-visible{outline:0;color:var(--neutral-900)}.theme-switch button.active{background:var(--app-surface);color:var(--neutral-950);box-shadow:0 1px 3px rgba(0,0,0,.09)}.theme-switch button:disabled{cursor:default;opacity:.5}
  .permission-retry:disabled{cursor:default;opacity:.55}
  .setting-value{flex:none;display:flex;align-items:center;color:var(--neutral-500);font-size:10.5px;font-weight:550;line-height:1}
  .update-refresh{width:16px;height:16px;flex:none;display:flex;align-items:center;justify-content:center;margin-left:-7px;border:0;border-radius:5px;padding:0;background:transparent;color:var(--neutral-500);cursor:pointer;line-height:0;transform:translateY(1px)}
  .update-refresh:hover,.update-refresh:focus-visible{outline:0;color:var(--neutral-950)}
  .update-refresh:disabled{cursor:default;opacity:.55}
  .update-refresh.spinning :global(svg){animation:update-spin 1s linear infinite}
  @keyframes update-spin{to{transform:rotate(360deg)}}
  .memory-options{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;padding:2px var(--options-detail-edge) 20px calc(var(--options-content-edge) + var(--options-tab-inline))}.memory-options>.options-detail-header{flex:none;align-items:flex-start}.memory-options>.options-path{flex:none;margin-top:auto;padding-top:12px}.local-memory-section{margin-top:18px}.memory-divider{height:1px;flex:none;margin:14px 0;background:var(--neutral-200)}.chronicle-group{transition:opacity .15s ease}.chronicle-group.disabled{opacity:.42}.chronicle-section>header{display:flex;align-items:center;justify-content:space-between;gap:16px}.chronicle-section>header>span{display:flex;min-width:0;flex-direction:column;gap:2px}.chronicle-section h4{margin:0;color:var(--neutral-900);font-size:12.5px;font-weight:570}.chronicle-section small{color:var(--neutral-400);font-size:10.5px}.chronicle-section>p{max-width:610px;margin:6px 0;color:var(--neutral-600);font-size:11px;line-height:1.45}.chronicle-inline-stats{display:flex;flex-wrap:wrap;gap:12px;color:var(--neutral-400);font-size:10px}.chronicle-toggle{width:36px;height:20px;flex:none;border:0;border-radius:999px;padding:2px;background:var(--neutral-300);cursor:pointer;transition:background .15s ease}.chronicle-toggle span{width:16px;height:16px;display:block;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.2);transition:transform .15s ease,background .15s ease}.chronicle-toggle.pending{display:block;cursor:default;opacity:.5}.chronicle-toggle.enabled{background:var(--neutral-900)}.chronicle-toggle.enabled span{transform:translateX(16px)}:global(:root[data-theme="dark"]) .chronicle-toggle{background:#484848}:global(:root[data-theme="dark"]) .chronicle-toggle span{background:#d8d8d8}:global(:root[data-theme="dark"]) .chronicle-toggle.enabled{background:#e7e7e7}:global(:root[data-theme="dark"]) .chronicle-toggle.enabled span{background:#242424}.chronicle-toggle:disabled{cursor:default;opacity:.5}.chronicle-error{display:flex;align-items:center;gap:12px;margin-top:10px;padding:9px 11px;border-radius:9px;background:#fff5f5;color:#8f3e3e}.chronicle-error>span{min-width:0;flex:1}.chronicle-error h4,.chronicle-error p,.chronicle-error small{margin:0}.chronicle-error h4{font-size:11px}.chronicle-error p{margin-top:3px;font-size:11px}.chronicle-error small{display:block;margin-top:3px;opacity:.75;font-size:10px}.chronicle-error button{height:28px;flex:none;border:1px solid color-mix(in srgb,currentColor 20%,transparent);border-radius:8px;padding:0 10px;background:var(--app-surface);color:inherit;cursor:pointer;font-family:inherit;font-size:10.5px;font-weight:550}.chronicle-error button:hover,.chronicle-error button:focus-visible{outline:0;background:var(--neutral-100)}.chronicle-error button:disabled{cursor:default;opacity:.55}:global(:root[data-theme="dark"]) .chronicle-error{background:#321f1f;color:#eea7a7}:global(:root[data-theme="dark"]) .chronicle-error button{border-color:#704242;background:#442727;color:#f0b0b0}:global(:root[data-theme="dark"]) .chronicle-error button:hover,:global(:root[data-theme="dark"]) .chronicle-error button:focus-visible{background:#553030;color:#ffd0d0}
  .options-body{position:relative;flex:1;min-height:0;display:grid;grid-template-columns:220px minmax(0,1fr)}.options-body:after{content:'';position:absolute;top:6px;bottom:12px;left:220px;width:1px;background:var(--neutral-200)}
  .options-rail{min-height:0;display:flex;flex-direction:column;gap:6px;padding:0 var(--options-divider-gap) 12px var(--options-content-edge)}.options-search{display:flex;align-items:center;gap:7px;height:30px;padding:0 10px;border:1px solid var(--neutral-200);border-radius:9px;background:var(--input-surface);color:var(--neutral-500)}.options-search:focus-within{border-color:var(--neutral-400);background:var(--prompt-surface-active)}.options-search input{-webkit-appearance:none;appearance:none;min-width:0;flex:1;border:0;padding:0;background:transparent;color:var(--neutral-950);outline:none;font-size:12.5px}.options-search input::-webkit-search-cancel-button{-webkit-appearance:none;appearance:none}
  .options-rail-list{--rail-mask-top:transparent;--rail-mask-bottom:transparent;flex:1;min-height:0;overflow-y:auto;margin:0;padding:6px 0;list-style:none;-webkit-mask-image:linear-gradient(to bottom,var(--rail-mask-top),#000 6px,#000 calc(100% - 6px),var(--rail-mask-bottom));mask-image:linear-gradient(to bottom,var(--rail-mask-top),#000 6px,#000 calc(100% - 6px),var(--rail-mask-bottom))}.options-rail-list.at-top{--rail-mask-top:#000}.options-rail-list.at-bottom{--rail-mask-bottom:#000}.options-rail-list.empty-state{display:flex;align-items:center;justify-content:center;-webkit-mask-image:none;mask-image:none}.options-rail-list li{display:flex}.options-rail-list .rail-empty{justify-content:center;padding:0 8px}.options-rail-row{width:100%;display:flex;align-items:center;gap:10px;margin:2px 0;padding:5px 9px;border:0;border-radius:10px;background:transparent;text-align:left;cursor:pointer}.options-rail-row:hover,.options-rail-row:focus-visible{outline:0;background:var(--neutral-100)}.options-rail-row.selected{background:var(--neutral-200)}
  .options-rail-row.integration-disabled{opacity:.52}.options-rail-row.integration-disabled.selected{opacity:.72}
  .skill-name-line{min-width:0;display:flex;align-items:center;gap:4px}.skill-name-line strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.official-rail-stamp{width:14px;height:14px;display:grid;flex:none;place-items:center;color:var(--neutral-500);transform:translateY(1px)}
  .option-mark{flex:none;width:26px;height:26px;display:grid;place-items:center;border-radius:8px;background:var(--neutral-200);color:var(--neutral-700)}
  /* A product's own icon already carries its shape and ground, so the house
     tile would read as a second, mismatched container behind it. */
  .option-mark.large{width:34px;height:34px;border-radius:10px}
  .options-detail.directory-open{display:flex;flex-direction:column;overflow:hidden}.skill-registry{min-height:0;flex:1;display:flex;flex-direction:column;gap:12px;margin-top:14px}.skill-registry-results{flex:1;min-height:0;overflow-y:auto;margin:0;padding:0;list-style:none}.skill-registry-results li{display:flex;align-items:center;gap:12px;min-height:44px;border-bottom:1px solid var(--neutral-100)}.skill-registry-results li:last-child{border-bottom:0}.skill-registry-copy{min-width:0;flex:1;display:flex;flex-direction:column;gap:1px}.skill-registry-copy strong{overflow:hidden;color:var(--neutral-950);text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;font-weight:540}.skill-registry-copy small{overflow:hidden;color:var(--neutral-400);text-overflow:ellipsis;white-space:nowrap;font-size:10.5px}.skill-registry-installed{flex:none;color:var(--neutral-400);font-size:10.5px;font-weight:550}.skill-registry-results .skill-registry-empty{height:100%;display:grid;place-items:center;border:0;color:var(--neutral-400);text-align:center;font-size:11.5px}
  .skill-meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px 18px;margin:8px 0 0;max-width:460px}.skill-meta div{min-width:0;display:flex;flex-direction:column;gap:2px}.skill-meta dt{color:var(--neutral-400);font-size:10.5px;font-weight:550;letter-spacing:.02em}.skill-meta dd{margin:0;overflow:hidden;color:var(--neutral-700);text-overflow:ellipsis;white-space:nowrap;font-size:12px}.options-rail-copy{min-width:0;flex:1;display:flex;flex-direction:column;gap:1px}.options-rail-copy strong{overflow:hidden;color:var(--neutral-950);text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:530}.options-rail-copy small{overflow:hidden;color:var(--neutral-500);text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;text-transform:capitalize}.options-name{display:flex;align-items:center;gap:5px}.options-name strong{min-width:0;flex:1}.options-name i{padding:1px 5px;border-radius:5px;background:#fff;color:var(--neutral-600);font-size:9px;font-style:normal}
  .provider-mark{width:26px;height:26px;display:grid;flex:none;place-items:center;border:1px solid var(--neutral-200);border-radius:8px;background:#fff}.provider-mark.large{width:34px;height:34px;border-radius:10px}.provider-row.selected .provider-mark{border-color:rgba(0,0,0,.08)}.provider-row.has-check{position:relative}.provider-row.has-check .options-rail-copy{-webkit-mask-image:linear-gradient(to right,#000 0,#000 calc(100% - 34px),transparent calc(100% - 13px));mask-image:linear-gradient(to right,#000 0,#000 calc(100% - 34px),transparent calc(100% - 13px))}.configured-check{position:absolute;top:0;right:15px;bottom:0;width:18px;display:grid;place-items:center;color:var(--neutral-600)}
  .options-rail-tools{position:relative;flex:none;display:flex;align-items:center;justify-content:flex-start;gap:2px;margin-top:2px}.rail-tool-wrap{position:relative}.rail-tool{width:30px;height:30px;display:grid;place-items:center;border:0;border-radius:8px;padding:0;background:transparent;color:var(--neutral-500);cursor:pointer}.rail-tool:hover,.rail-tool:focus-visible,.rail-tool.active,.rail-tool[aria-expanded="true"]{outline:0;background:var(--neutral-100);color:var(--neutral-900)}.rail-tool-menu{position:absolute;z-index:5;bottom:36px;left:0;width:154px}.rail-tool-menu .polymux-dropdown-item>span{min-width:0;flex:1}.rail-tool-text{width:auto;padding:0 9px;font-family:inherit;font-size:11px;font-weight:540}.role-setup-menu{width:252px;padding:5px}.role-setup-row{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:5px 7px;color:var(--neutral-500);font-size:11px}.role-setup-row>span{flex:none;white-space:nowrap}.role-setup-row+.role-setup-row{border-top:1px solid var(--neutral-100)}.role-setup-row strong{min-width:0;overflow:hidden;color:var(--neutral-800);text-align:right;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:540}
  .options-detail{min-height:0;overflow-y:auto;padding:0 18px 20px var(--options-divider-gap)}.options-detail-header{display:flex;align-items:center;gap:11px}.options-detail-header>.chronicle-toggle{margin-right:8px}.options-title-group{min-width:0;flex:1;display:flex;align-items:center;gap:8px}.options-title-group h3{min-width:0;margin:0;overflow:hidden;color:var(--neutral-950);text-overflow:ellipsis;white-space:nowrap;font-size:15px;font-weight:570}.options-badge{flex:none;padding:2px 8px;border-radius:7px;background:var(--neutral-200);color:var(--neutral-600);font-size:10.5px;font-weight:540;text-transform:capitalize}.options-badge.good{background:#e8f5ec;color:#347049}.official-badge{display:inline-flex;align-items:center;gap:4px;padding:0;background:transparent;transform:translateY(1px)}.official-badge :global(svg){flex:none}
  .options-detail.mcp-detail{display:flex;flex-direction:column;overflow:hidden}.mcp-detail>.options-detail-header,.mcp-detail>.options-detail-block{flex:none}.mcp-detail>.options-resources{min-height:0;flex:1}.mcp-detail>.options-resources>section{min-height:0;display:flex;flex-direction:column}.mcp-detail>.options-resources ul{min-height:0;max-height:none;flex:1;overflow-y:auto}
  .options-detail.skill-detail{display:flex;flex-direction:column;overflow:hidden}.skill-detail>.options-path{flex:none;margin-top:auto;padding-top:12px}.skill-description{display:-webkit-box;overflow:hidden;line-clamp:4;-webkit-box-orient:vertical;-webkit-line-clamp:4}
  .skill-detail>.options-detail-header{position:relative;min-height:20px}.skill-detail>.options-detail-header>.options-title-group{min-height:20px;align-self:flex-start;padding-right:112px}.skill-detail-actions{position:absolute;top:-4px;right:0;height:28px;display:flex;align-items:center}.skill-detail-actions>.provider-edit+.provider-edit,.skill-detail-actions>.provider-edit+.chronicle-toggle{margin-left:-5px}.skill-detail-actions>.chronicle-toggle{margin-right:8px}
  .mcp-detail>.options-detail-header h3{font-size:16px;font-weight:570}
  .options-detail-block{margin:19px 0 10px}.options-detail-block h4,.options-resources h4{margin:0;color:var(--neutral-800);font-size:11.5px;font-weight:570;letter-spacing:.02em}.options-detail-block p{margin:5px 0 0;color:var(--neutral-600);font-size:12.5px;line-height:1.55;white-space:pre-wrap}.options-resources{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;margin-top:18px}.options-resources header{display:flex;align-items:center;justify-content:space-between;margin-bottom:5px}.options-resources header span{padding:1px 7px;border-radius:999px;background:var(--neutral-100);color:var(--neutral-600);font-size:10.5px}.options-resources ul{max-height:196px;overflow:auto;margin:0;padding:0;list-style:none}.options-resources li{display:flex;align-items:center;gap:7px;min-height:28px;overflow:hidden;color:var(--neutral-700);text-overflow:ellipsis;white-space:nowrap;font-size:12px}.options-resources li.muted{color:var(--neutral-400)}
  .options-path{margin:24px 0 0;overflow-wrap:anywhere;color:var(--neutral-400);font-size:10.5px}.options-empty{width:100%;padding:24px 8px;color:var(--neutral-400);text-align:center;font-size:12px}.options-empty.detail{display:grid;min-height:100%;place-items:center;margin:0}
  .provider-detail-header{padding-bottom:12px}.model-detail-header .model-count{transform:translateY(-2px)}.model-count{margin-left:auto;color:var(--neutral-500);font-size:11px;font-weight:450;white-space:nowrap}.pricing-toolbar{display:flex;align-items:flex-start;gap:12px;margin:-7px 0 10px}.pricing-note{min-width:0;flex:1;margin:0;padding-top:6px;color:var(--neutral-500);font-size:11px}/* Lifted against the note's first line: the trigger is much taller than the
     11px text, so flex-start alignment leaves it sitting visibly low. */
  .currency-menu{flex:none;margin-top:-5px}.currency-menu :global(.select-menu-trigger){height:26px;min-width:58px;border-radius:8px;padding:0 7px 0 9px;font-size:10.5px}.model-search{height:30px;display:flex;align-items:center;gap:7px;border-bottom:1px solid var(--neutral-200);color:var(--neutral-400)}.model-search:focus-within{border-color:var(--neutral-500);color:var(--neutral-600)}.model-search input{-webkit-appearance:none;appearance:none;min-width:0;flex:1;border:0;padding:0;background:transparent;color:var(--neutral-950);outline:0;font-family:inherit;font-size:11.5px}.model-search input::-webkit-search-cancel-button{-webkit-appearance:none;appearance:none}.model-search input::placeholder{color:var(--neutral-400)}.model-table-wrap{overflow:auto}.model-table{width:100%;border-collapse:collapse;table-layout:fixed}.model-table th{height:31px;padding:0 10px;border-bottom:1px solid var(--neutral-200);background:transparent;color:var(--neutral-500);text-align:right;white-space:nowrap;font-size:10.5px;font-weight:540}.model-table th:first-child{width:34%;text-align:left}.model-table th:last-child{width:12%}.model-table td{height:46px;padding:0 10px;border-bottom:1px solid var(--neutral-100);color:var(--neutral-700);text-align:right;white-space:nowrap;font-size:11.5px;font-variant-numeric:tabular-nums}.model-table tbody tr:last-child td{border-bottom:0}.model-table tbody tr:hover td{background:var(--neutral-50)}.model-table tr.active td{background:var(--neutral-100)}.model-table td:first-child{text-align:left}.model-table .model-table-empty{text-align:center;color:var(--neutral-400);font-size:11px}.model-row-name{width:100%;display:flex;flex-direction:column;gap:1px;overflow:hidden;border:0;padding:0;background:transparent;color:inherit;text-align:left;cursor:pointer}.model-row-name:disabled{cursor:default}.model-row-name strong{overflow:hidden;color:var(--neutral-950);text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:540}.model-row-name small{overflow:hidden;color:var(--neutral-400);text-overflow:ellipsis;white-space:nowrap;font-size:9.5px;font-weight:400}.model-row-name:not(:disabled):hover strong,.model-row-name:not(:disabled):focus-visible strong{color:var(--flare-blue,#2384cb)}.model-row-name:focus-visible{outline:none}
  .provider-edit{width:28px;height:28px;display:grid;flex:none;place-items:center;border:0;border-radius:8px;padding:0;background:transparent;color:var(--neutral-500);cursor:pointer}.provider-edit:hover,.provider-edit:focus-visible{outline:0;background:var(--neutral-100);color:var(--neutral-900)}
  .search-clear{appearance:none;width:13px;height:20px;display:grid;flex:none;place-items:center;border:0;padding:0;background:transparent;box-shadow:none;color:var(--neutral-400);cursor:pointer}.search-clear:hover,.search-clear:focus-visible{outline:0;background:transparent;box-shadow:none;color:var(--neutral-800)}
  .provider-edit.destructive:hover,.provider-edit.destructive:focus-visible{color:#a44343}.provider-edit:disabled{cursor:default;opacity:.45}
  .options-detail-header>.provider-edit+.provider-edit,.options-detail-header>.provider-edit+.chronicle-toggle{margin-left:-5px}
  .credential-panel{max-width:500px;padding:5px 2px}.credential-copy h4{margin:0;color:var(--neutral-900);font-size:13px;font-weight:570}.credential-copy p{max-width:470px;margin:6px 0 0;color:var(--neutral-500);font-size:12px;line-height:1.55}.credential-form{margin-top:10px}.credential-input-row{display:flex;gap:7px}.credential-input-row input{height:32px;min-width:0;flex:1;border:1px solid var(--neutral-200);border-radius:8px;padding:0 10px;background:var(--input-surface);color:var(--neutral-950);outline:none;font-family:inherit;font-size:11.5px}.credential-input-row input:focus{border-color:var(--neutral-400);background:var(--prompt-surface-active)}.credential-primary{height:32px;border:0;border-radius:8px;padding:0 12px;background:var(--neutral-900);color:var(--on-primary);cursor:pointer;font-family:inherit;font-size:11.5px;font-weight:540}.credential-primary:hover{filter:brightness(.92)}.credential-primary:disabled{cursor:default;opacity:.4}.credential-unavailable{margin:22px 0 0;padding:10px;border-radius:9px;background:var(--neutral-100);color:var(--neutral-500);font-size:12px}
  .custom-provider-form{max-width:440px;padding:2px}.custom-provider-form>p{margin:0 0 16px;color:var(--neutral-500);font-size:11.5px;line-height:1.5}.custom-provider-form>label{display:flex;flex-direction:column;gap:5px;margin:0 0 11px;color:var(--neutral-700);font-size:11px;font-weight:540}.custom-provider-form label>small{color:var(--neutral-400);font-size:10px;font-weight:400}.custom-provider-form input,.custom-provider-form textarea{width:100%;border:1px solid var(--neutral-200);border-radius:8px;padding:0 10px;background:var(--input-surface);color:var(--neutral-950);outline:none;font-family:inherit;font-size:11.5px}.custom-provider-form input{height:32px}.custom-provider-form textarea{min-height:88px;padding-block:8px;resize:vertical;line-height:1.45}.custom-provider-form input:focus,.custom-provider-form textarea:focus{border-color:var(--neutral-400);background:var(--prompt-surface-active)}.custom-provider-actions{display:flex;justify-content:flex-end;gap:7px;margin-top:15px}.custom-provider-actions>button{height:32px;border:0;border-radius:8px;padding:0 12px;background:var(--neutral-100);color:var(--neutral-700);cursor:pointer;font-family:inherit;font-size:11.5px}.custom-provider-actions>button:hover{background:var(--neutral-200)}.custom-provider-actions>.credential-primary{background:var(--neutral-900);color:var(--on-primary)}.custom-provider-actions>.credential-primary:hover{filter:brightness(.92)}
  .custom-integration-form{max-width:440px;padding-top:16px}.custom-integration-form>label{display:flex;flex-direction:column;gap:5px;margin-bottom:10px;color:var(--neutral-700);font-size:11px;font-weight:540}.custom-integration-form input,.custom-integration-form select,.custom-integration-form textarea{width:100%;border:1px solid var(--neutral-200);border-radius:8px;background:var(--input-surface);color:var(--neutral-950);outline:none;font:inherit;font-size:11.5px}.custom-integration-form input,.custom-integration-form select{height:32px;padding:0 10px}.custom-integration-form textarea{min-height:58px;padding:8px 10px;resize:vertical;line-height:1.4}.custom-integration-form textarea.instructions{min-height:150px}.custom-integration-form input:focus,.custom-integration-form select:focus,.custom-integration-form textarea:focus{border-color:var(--neutral-400)}.custom-integration-form input:disabled{color:var(--neutral-400);background:var(--neutral-100)}
  .custom-integration-form.skill-form{width:100%;max-width:none}
  .field-label{display:inline}.required-mark{color:#b44949}
  .custom-provider-logo{display:block;flex:none;cursor:pointer}.custom-provider-logo>input{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}.custom-provider-logo-preview{position:relative;overflow:hidden;transition:background-color .14s ease}.custom-provider-logo:hover .custom-provider-logo-preview,.custom-provider-logo:focus-within .custom-provider-logo-preview{background:var(--neutral-300)}.custom-provider-logo-preview img{width:100%;height:100%;display:block;object-fit:cover}
  .skill-add-menu{min-width:142px}.skill-folder-input{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
  .credential-keys{margin-top:12px}.credential-key-row{min-height:42px;display:flex;align-items:center;gap:9px;padding:0 6px;border-bottom:1px solid var(--neutral-100)}.credential-key-state{width:7px;height:7px;flex:none;border-radius:50%;background:var(--neutral-300)}.credential-key-state.active{background:#4da46a}.credential-key-state.invalid{background:#c65a5a}.credential-key-state.limited{background:#c8973c}.credential-key-row>span:nth-child(2){min-width:0;flex:1;display:flex;flex-direction:column}.credential-key-row strong{color:var(--neutral-800);font-size:11.5px;font-weight:520}.credential-key-row small{color:var(--neutral-400);font-size:10px}.credential-key-row button{width:28px;height:28px;display:grid;place-items:center;border:0;border-radius:8px;background:transparent;color:var(--neutral-400);cursor:pointer}.credential-key-row button:hover{background:var(--neutral-100);color:#a44343}.credential-unavailable{margin:22px 0 0;padding:10px;border-radius:9px;background:var(--neutral-100);color:var(--neutral-500);font-size:12px}
  .model-table tr.model-row{cursor:pointer}.model-table tr.expanded td{background:var(--neutral-100)}.model-table tr.model-roles-row td{height:auto;padding:0;background:var(--neutral-50);border-bottom:1px solid var(--neutral-100)}.model-table tr.model-roles-row:hover td{background:var(--neutral-50)}
  .model-roles{display:flex;flex-direction:column;padding:4px 10px 8px}.model-roles-empty{margin:0;padding:8px 0;color:var(--neutral-400);font-size:11px}.model-role{min-height:34px;display:flex;align-items:center;gap:12px;white-space:normal}.model-role+.model-role{border-top:1px solid var(--neutral-100)}.model-role-copy{min-width:0;flex:1;display:flex;align-items:baseline;gap:8px}.model-role-copy strong{flex:none;color:var(--neutral-800);font-size:11px;font-weight:540}.model-role-copy small{min-width:0;overflow:hidden;color:var(--neutral-400);text-overflow:ellipsis;white-space:nowrap;font-size:10px}.model-role.held .model-role-copy small{color:var(--flare-blue,#2384cb)}
  .model-role-actions{flex:none;display:flex;align-items:center;gap:4px}.model-role-reset,.model-role-change{height:24px;border:1px solid var(--neutral-200);border-radius:7px;padding:0 9px;background:var(--neutral-0,#fff);color:var(--neutral-700);cursor:pointer;font-family:inherit;font-size:10.5px}.model-role-reset{border-color:transparent;border-radius:0;padding:0 6px;background:transparent;color:var(--neutral-400)}.model-role-reset:hover:not(:disabled),.model-role-reset:focus-visible:not(:disabled){outline:0;background:transparent;color:var(--neutral-900)}.model-role-change:hover:not(:disabled){background:var(--neutral-100);color:var(--neutral-950)}.model-role-change:disabled,.model-role-reset:disabled{cursor:default;opacity:.55}.model-role.held .model-role-change{border-color:transparent;background:transparent;color:var(--flare-blue,#2384cb);opacity:1}
  @keyframes backdrop-in{from{opacity:0}}@keyframes modal-in{from{opacity:0;transform:translateY(10px) scale(.985)}}
  @media(max-width:700px){.options-modal{width:calc(100vw - 24px);height:calc(100vh - 24px)}.options-header{padding:24px 22px 16px}.options-body{grid-template-columns:210px minmax(0,1fr)}.options-body:after{left:210px}.options-resources{grid-template-columns:1fr}}
</style>
