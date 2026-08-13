<script lang="ts">
  import {onMount, tick} from 'svelte';
  import type {ChronicleStatusDto, GeneralSettingsDto, McpServerDto, MemoryStatusDto, ModelDto, ModelMetadataDto, ProviderDto, SkillDto} from '@midas/protocol';
  import {midasApi} from '../../api/midas';
  import {applyTheme, type ThemeMode} from '../../theme';
  import {modelCompanyId, providerName} from '../../options/providerBrands';
  import Icon from '../shared/Icon.svelte';
  import Menu from '../shared/Menu.svelte';
  import ProviderLogo from './ProviderLogo.svelte';
  import appleRemindersLogo from '../../options/assets/apple-reminders.png?url';

  export let onClose: () => void;
  export let onGeneralChange: (settings: GeneralSettingsDto) => void = () => {};

  type Mode = 'general' | 'mcp' | 'skills' | 'model' | 'provider' | 'memory';
  type RailMenu = 'filter' | 'sort';
  type Currency = Exclude<GeneralSettingsDto['currency'], null>;

  const api = midasApi();
  let mode: Mode = 'general';
  let search = '';
  let mcpServers: McpServerDto[] = [];
  let skills: SkillDto[] = [];
  let models: ModelDto[] = [];
  let providers: ProviderDto[] = [];
  let chronicle: ChronicleStatusDto | null = null;
  let memory: MemoryStatusDto | null = null;
  let general: GeneralSettingsDto | null = null;
  let updatingChronicle = false;
  let updatingTheme = false;
  let updatingSpeechMode = false;
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
  let editingIntegration = false;
  let customMcpId = '';
  let customMcpName = '';
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
  let modelSort = 'recommended';
  let modelSearch = '';
  let revealedModelKey = '';
  let providerFilter = 'all';
  let providerSort = 'recommended';
  let openRailMenu: RailMenu | null = null;
  let railActions: HTMLElement;
  let currency: Currency = 'USD';
  let currencyRates: Partial<Record<Currency, number>> = {USD: 1};
  let modelMetadata: Record<string, ModelMetadataDto> = {};
  let error = '';

  const modelFilterOptions = [{value: 'all', label: 'All Companies'}, {value: 'configured', label: 'Configured'}, {value: 'unconfigured', label: 'Not Configured'}, {value: 'custom', label: 'Custom Provider'}];
  const providerFilterOptions = [{value: 'all', label: 'All providers'}, {value: 'configured', label: 'Configured'}, {value: 'unconfigured', label: 'Not configured'}];
  const modelSortOptions = [{value: 'recommended', label: 'Recommended'}, {value: 'name-asc', label: 'Company A–Z'}, {value: 'name-desc', label: 'Company Z–A'}, {value: 'models-desc', label: 'Most models'}, {value: 'models-asc', label: 'Fewest models'}];
  const providerSortOptions = [{value: 'recommended', label: 'Recommended'}, {value: 'name-asc', label: 'Provider A–Z'}, {value: 'name-desc', label: 'Provider Z–A'}, {value: 'models-desc', label: 'Most models'}, {value: 'models-asc', label: 'Fewest models'}];
  const recommendedModelCompanies = ['openai', 'anthropic', 'google', 'xai', 'meta', 'deepseek', 'mistral', 'qwen', 'moonshotai', 'minimax', 'cohere', 'perplexity', 'ai21'];
  const currencies: Currency[] = ['USD', 'AUD', 'EUR', 'GBP', 'SGD', 'JPY'];
  const currencySymbols: Record<Currency, string> = {USD: '$', AUD: 'A$', EUR: '€', GBP: '£', SGD: 'S$', JPY: '¥'};

  $: query = search.trim().toLocaleLowerCase();
  $: visibleMcp = mcpServers.filter((item) => matches(`${item.name} ${item.source} ${item.transport} ${item.status}`, query));
  $: visibleSkills = skills.filter((item) => matches(`${item.name} ${item.description} ${item.source}`, query));
  $: modelCompanies = groupModels(models, providers, query, modelFilter, modelSort);
  $: visibleProviders = selectProviders(providers, query, providerFilter, providerSort);
  $: railEmpty = mode === 'mcp' ? visibleMcp.length === 0 : mode === 'skills' ? visibleSkills.length === 0 : mode === 'model' ? modelCompanies.length === 0 : visibleProviders.length === 0;
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
  $: activeModel = models.find((item) => item.selected);
  $: activeModelCompany = activeModel ? modelCompanyId(activeModel) : '';
  $: activeModelLogo = activeModel && activeModelCompany === activeModel.provider ? providers.find((item) => item.id === activeModel.provider)?.logoDataUrl : undefined;
  $: credentialProvider = providers.find((item) => item.id === selectedCredentialProvider);
  $: visibleCompanyModels = modelCompany?.models.filter((item) => matches(`${item.name} ${item.provider} ${item.id}`, modelSearch.trim().toLocaleLowerCase())) ?? [];

  onMount(() => {
    void loadAll();
    void loadCurrencyRates();
    return api.mcp.subscribe((update) => {
      mcpServers = update.servers;
      if (update.error) error = `MCP configuration: ${update.error}`;
    });
  });

  function matches(value: string, filter: string): boolean {
    return !filter || value.toLocaleLowerCase().includes(filter);
  }

  /**
   * A skill that drives one real product shows that product's own mark, so it
   * is recognisable at a glance; everything else is a capability rather than a
   * brand and takes a house glyph. Anything unmapped keeps the generic book.
   */
  const SKILL_LOGOS: Record<string, string> = {
    'apple-reminders': appleRemindersLogo,
  };

  const SKILL_ICONS: Record<string, string> = {
    browser: 'globe',
    documents: 'document',
    pdf: 'pdf',
    presentations: 'presentation',
    spreadsheets: 'spreadsheet',
    mail: 'mail',
    himalaya: 'terminal',
    message: 'chat',
    'gui-control': 'panel',
    'skill-creator': 'edit',
    'skill-maintenance': 'wrench',
  };

  function skillLogo(item: SkillDto): string | undefined {
    return item.iconDataUrl ?? SKILL_LOGOS[item.name];
  }

  function containsSkillIcon(item: SkillDto): boolean {
    return item.name === 'browser' || item.name === 'chronicle';
  }

  /** Slugs are lowercase, so acronyms need restoring rather than title-casing —
   * "gui-control" is GUI Control, not Gui Control. */
  const SKILL_ACRONYMS = new Set(['pdf', 'gui', 'api', 'url', 'ai', 'mcp', 'cli', 'os']);

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

  function skillRowAuthor(source: SkillDto['source']): string {
    return source === 'official' ? 'Midas' : source;
  }

  function groupModels(items: ModelDto[], providerStates: ProviderDto[], searchFilter: string, stateFilter: string, sort: string): Array<{id: string; name: string; logoDataUrl?: string; models: ModelDto[]; selected: boolean; configured: boolean; custom: boolean}> {
    const configuredProviders = new Set(providerStates.filter((provider) => provider.configured).map((provider) => provider.id));
    const providerById = new Map(providerStates.map((provider) => [provider.id, provider]));
    const groups = new Map<string, ModelDto[]>();
    for (const model of items) {
      const id = model.custom ? model.provider : modelCompanyId(model);
      const company = model.custom ? providerById.get(model.provider)?.name ?? providerName(id) : providerName(id);
      if (searchFilter && !`${company} ${model.name} ${model.provider} ${model.id}`.toLocaleLowerCase().includes(searchFilter)) continue;
      groups.set(id, [...(groups.get(id) ?? []), model]);
    }
    const companies = [...groups].map(([id, companyModels]) => ({
      id,
      name: providerById.get(id)?.custom ? providerById.get(id)!.name : providerName(id),
      logoDataUrl: providerById.get(id)?.logoDataUrl,
      models: companyModels.sort((a, b) => a.name.localeCompare(b.name)),
      selected: companyModels.some((model) => model.selected),
      configured: configuredProviders.has(id) || companyModels.some((model) => configuredProviders.has(model.provider)),
      custom: companyModels.some((model) => model.custom),
    })).filter((company) => stateFilter === 'all'
      || stateFilter === 'configured' && company.configured
      || stateFilter === 'unconfigured' && !company.configured
      || stateFilter === 'custom' && company.custom);
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
    if (sort === 'recommended') {
      const recommended = (providers: ProviderDto[]) => providers.sort((a, b) => b.modelCount - a.modelCount || a.name.localeCompare(b.name));
      return [
        ...recommended(visible.filter((provider) => provider.configured)),
        ...recommended(visible.filter((provider) => !provider.configured)),
      ];
    }
    return visible.sort((a, b) => sort === 'name-desc' ? b.name.localeCompare(a.name)
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

  function selectMcp(id: string): void { selectedMcp = id; adding = null; }
  function selectSkill(name: string): void { selectedSkill = name; adding = null; }
  function selectModelCompany(id: string): void { selectedModelProvider = id; modelSearch = ''; }

  async function revealActiveModel(): Promise<void> {
    if (!activeModel) return;
    search = '';
    modelFilter = 'all';
    selectedModelProvider = activeModelCompany;
    modelSearch = '';
    revealedModelKey = `${activeModel.provider}/${activeModel.id}`;
    await tick();
    document.querySelector('.model-table tr.active')?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest',
    });
    window.setTimeout(() => revealedModelKey = '', 900);
  }

  async function loadAll(): Promise<void> {
    loading = true;
    try {
      [mcpServers, skills, models, providers, memory, chronicle, general] = await Promise.all([api.mcp.list(), api.skills.list(), api.models.list(), api.providers.list(), api.memory.status(), api.chronicle.status(), api.general.get()]);
      currency = general.currency ?? defaultCurrency(general.location);
      error = '';
      // Catalogue detail is decoration: it loads after the lists, and a
      // failure leaves the models on screen exactly as they were.
      void api.models.metadata().then((value) => modelMetadata = value).catch(() => {});
      if (general.locationEnabled && !general.location && window.midas) void refreshLocation();
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
    } finally {
      loading = false;
    }
  }

  async function setTimeEnabled(enabled: boolean): Promise<void> {
    updatingTime = true;
    try {
      general = await api.general.update({timeEnabled: enabled});
      error = '';
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
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
      error = reason instanceof Error ? reason.message : String(reason);
    } finally {
      updatingSpeechMode = false;
    }
  }

  async function setTheme(theme: ThemeMode): Promise<void> {
    updatingTheme = true;
    try {
      general = await api.general.update({theme});
      applyTheme(general.theme);
      error = '';
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
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
      error = reason instanceof Error ? reason.message : String(reason);
    } finally {
      updatingLocation = false;
    }
    if (enabled && general?.locationEnabled) void refreshLocation();
  }

  async function refreshLocation(openSettingsWhenDenied = false): Promise<void> {
    if (locating) return;
    if (!navigator.geolocation) {
      locationError = 'Location is not available on this device.';
      return;
    }
    locating = true;
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          maximumAge: 300_000,
          timeout: 12_000,
        }));
      general = await api.general.update({
        location: {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          updatedAt: new Date(position.timestamp).toISOString(),
        },
      });
      if (!general.currency) currency = defaultCurrency(general.location);
      locationError = '';
      error = '';
    } catch (reason) {
      const code = reason && typeof reason === 'object' && 'code' in reason ? Number(reason.code) : 0;
      locationError = code === 1
        ? 'Location permission was denied'
        : code === 3
          ? 'Location is currently unavailable'
          : 'Could not determine location';
      if (code === 1 && openSettingsWhenDenied)
        await api.permissions.openSettings('location');
    } finally {
      locating = false;
    }
  }

  function locationStatus(): string {
    if (!general?.locationEnabled) return 'Not shared with the agent';
    if (locating && !general.location) return 'Connecting…';
    if (locationError) return locationError;
    if (!general.location) return 'Waiting for location permission';
    return 'Shared with the agent';
  }

  async function setChronicleEnabled(enabled: boolean): Promise<void> {
    updatingChronicle = true;
    try {
      chronicle = await api.chronicle.setEnabled(enabled);
      error = '';
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
    } finally {
      updatingChronicle = false;
    }
  }

  async function setCurrency(next: string): Promise<void> {
    if (!currencies.includes(next as Currency)) return;
    currency = next as Currency;
    try {
      general = await api.general.update({currency});
      error = '';
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
    }
  }

  async function retryChronicle(): Promise<void> {
    updatingChronicle = true;
    try {
      const permission = await api.permissions.request('screen-recording');
      if (permission === 'denied' || permission === 'restricted') {
        await api.permissions.openSettings('screen-recording');
        return;
      }
      chronicle = await api.chronicle.setEnabled(true);
      error = '';
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
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

  function latestMemoryActivity(value: MemoryStatusDto | null): string | null {
    if (!value) return null;
    return [value.latestMemoryAt, value.latestRolloutAt]
      .filter((item): item is string => Boolean(item))
      .sort((a, b) => b.localeCompare(a))[0] ?? null;
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
    adding = kind;
    editingIntegration = false;
    if (kind === 'mcp') {
      customMcpId = ''; customMcpName = ''; customMcpTransport = 'stdio'; customMcpTarget = ''; customMcpArgs = ''; customMcpEnvironment = ''; customMcpCwd = '';
    } else {
      customSkillOriginalName = ''; customSkillName = ''; customSkillDescription = ''; customSkillInstructions = '';
    }
    if (kind === 'mcp') selectedMcp = '';
    else selectedSkill = '';
  }

  function editMcp(item: McpServerDto): void {
    adding = 'mcp'; editingIntegration = true; selectedMcp = item.id;
    customMcpId = item.id; customMcpName = item.name; customMcpTransport = item.transport;
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
    integrationSaving = true;
    try { mcpServers = await api.mcp.setEnabled(item.id, !item.enabled); error = ''; }
    catch (reason) { error = reason instanceof Error ? reason.message : String(reason); }
    finally { integrationSaving = false; }
  }

  async function setSkillEnabled(item: SkillDto): Promise<void> {
    integrationSaving = true;
    try { skills = await api.skills.setEnabled(item.name, !item.enabled); error = ''; }
    catch (reason) { error = reason instanceof Error ? reason.message : String(reason); }
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
      const common = {id: customMcpId.trim(), name: customMcpName.trim(), transport: customMcpTransport};
      mcpServers = await api.mcp.saveCustom(customMcpTransport === 'stdio'
        ? {...common, command: customMcpTarget.trim(), args: customMcpArgs.split(/\r?\n/).map((item) => item.trim()).filter(Boolean), env: keyValueLines(customMcpEnvironment), cwd: customMcpCwd.trim() || undefined}
        : {...common, url: customMcpTarget.trim(), headers: keyValueLines(customMcpEnvironment)});
      adding = null; selectedMcp = common.id; error = '';
    } catch (reason) { error = reason instanceof Error ? reason.message : String(reason); }
    finally { integrationSaving = false; }
  }

  async function saveCustomSkill(): Promise<void> {
    integrationSaving = true;
    try {
      skills = await api.skills.saveCustom({originalName: customSkillOriginalName || undefined, name: customSkillName.trim(), description: customSkillDescription.trim(), instructions: customSkillInstructions});
      adding = null; selectedSkill = customSkillName.trim(); error = '';
    } catch (reason) { error = reason instanceof Error ? reason.message : String(reason); }
    finally { integrationSaving = false; }
  }

  async function chooseModel(item: ModelDto): Promise<void> {
    try {
      await api.models.select(item.provider, item.id);
      models = await api.models.list();
      selectedModelProvider = modelCompanyId(item);
      error = '';
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
    }
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
      error = reason instanceof Error ? reason.message : String(reason);
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
      error = reason instanceof Error ? reason.message : String(reason);
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
      error = reason instanceof Error ? reason.message : String(reason);
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
    if (mode === 'model') {
      if (menu === 'filter') modelFilter = value;
      else modelSort = value;
    } else {
      if (menu === 'filter') providerFilter = value;
      else providerSort = value;
    }
    openRailMenu = null;
  }

  function dismissRailMenu(event: MouseEvent): void {
    if (openRailMenu && !railActions?.contains(event.target as Node)) openRailMenu = null;
  }

  function keydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    if (openRailMenu) {
      event.preventDefault();
      event.stopPropagation();
      openRailMenu = null;
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

<svelte:window onkeydown={keydown} onclick={dismissRailMenu}/>

<div class="options-modal-backdrop" role="presentation" onclick={closeFromBackdrop}>
  <div class="options-modal" role="dialog" aria-modal="true" aria-labelledby="options-title">
    <header class="options-header">
      <div>
        <h2 id="options-title">Options</h2>
        <p>Manage the connections and capabilities available to Midas.</p>
      </div>
      <button type="button" class="options-close" aria-label="Close Options" data-tooltip-label="Close" onclick={onClose}><Icon name="close" size={18}/></button>
    </header>

    <div class="options-mode" role="tablist" aria-label="General, MCP, skills, model, provider, or memory">
      <button type="button" role="tab" aria-selected={mode === 'general'} class:active={mode === 'general'} onclick={() => selectMode('general')}>General</button>
      <button type="button" role="tab" aria-selected={mode === 'mcp'} class:active={mode === 'mcp'} onclick={() => selectMode('mcp')}>MCP</button>
      <button type="button" role="tab" aria-selected={mode === 'skills'} class:active={mode === 'skills'} onclick={() => selectMode('skills')}>Skills</button>
      <button type="button" role="tab" aria-selected={mode === 'model'} class:active={mode === 'model'} onclick={() => selectMode('model')}>Model</button>
      <button type="button" role="tab" aria-selected={mode === 'provider'} class:active={mode === 'provider'} onclick={() => selectMode('provider')}>Provider</button>
      <button type="button" role="tab" aria-selected={mode === 'memory'} class:active={mode === 'memory'} onclick={() => selectMode('memory')}>Memory</button>
    </div>

    {#if error}<p class="options-error" role="alert">{error}</p>{/if}

    {#if mode === 'general'}
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
          <span class="option-mark large"><Icon name="waveform" size={18}/></span>
          <span class="general-setting-copy"><h4>Speech mode</h4><small>Enable real-time speech-to-speech conversations</small></span>
          <button type="button" class:enabled={general?.speechModeEnabled} class="chronicle-toggle" role="switch" aria-label="Enable speech mode" aria-checked={general?.speechModeEnabled ?? false} disabled={updatingSpeechMode || !general} onclick={() => void setSpeechModeEnabled(!(general?.speechModeEnabled ?? false))}><span></span></button>
        </section>
        <section class="general-setting-row">
          <span class="option-mark large"><Icon name="clock" size={18}/></span>
          <span class="general-setting-copy"><h4>Time</h4><small>{general?.timeEnabled ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'Not shared with the agent'}</small></span>
          <button type="button" class:enabled={general?.timeEnabled} class="chronicle-toggle" role="switch" aria-label="Enable time access" aria-checked={general?.timeEnabled ?? false} disabled={updatingTime || !general} onclick={() => void setTimeEnabled(!(general?.timeEnabled ?? false))}><span></span></button>
        </section>
        <section class="general-setting-row">
          <span class="option-mark large"><Icon name="globe" size={18}/></span>
          <span class="general-setting-copy"><h4>Location</h4><small>{locationStatus()}</small></span>
          {#if general?.locationEnabled && locationError && !locating}
            <button type="button" class="permission-retry" onclick={() => void refreshLocation(true)}>Try again</button>
          {/if}
          <button type="button" class:enabled={general?.locationEnabled} class="chronicle-toggle" role="switch" aria-label="Enable location access" aria-checked={general?.locationEnabled ?? false} disabled={updatingLocation || !general} onclick={() => void setLocationEnabled(!(general?.locationEnabled ?? false))}><span></span></button>
        </section>
      </div>
    {:else if mode === 'memory'}
      <div class="memory-options" role="tabpanel">
        <header class="options-detail-header">
          <span class="options-title-group"><h3>Memory</h3></span>
          <div class="memory-top-metrics" aria-label="Memory metrics">
            <div><span>Memories</span><strong>{memory?.memories ?? 0}</strong></div>
            <div><span>Rollouts</span><strong>{memory?.rolloutSummaries ?? 0}</strong></div>
            <div><span>Latest</span><strong>{formatMemoryTime(latestMemoryActivity(memory))}</strong></div>
          </div>
        </header>
        <p class="memory-intro">Midas keeps durable memories and searchable conversation history in reviewable local Markdown files. Chronicle adds optional recent on-screen context to the same retrieval flow.</p>
        <section class="options-detail-block"><h4>Local memory</h4><p>The compact memory summary is included automatically. Midas searches the full registry and rollout history only when earlier context could materially help. Durable memories are added or removed only when you explicitly ask.</p></section>
        {#if memory}<p class="options-path">{memory.directory}</p>{/if}
        <div class="memory-divider"></div>
        <section class="chronicle-section">
          <header>
            <span><h4>Chronicle</h4><small>{chronicle?.running ? 'Recording recent screen context' : 'Recent screen context is off'}</small></span>
            <button type="button" class:enabled={chronicle?.enabled} class="chronicle-toggle" role="switch" aria-label="Enable Chronicle" aria-checked={chronicle?.enabled ?? false} disabled={updatingChronicle || !chronicle} onclick={() => void setChronicleEnabled(!(chronicle?.enabled ?? false))}><span></span></button>
          </header>
          <p>Private, local screen history using visual deduplication, adaptive sampling, and rolling 24-hour retention. It automatically pauses while your Mac is locked, idle, or thermally constrained.</p>
          <div class="chronicle-inline-stats"><span>{chronicle?.storedFrames ?? 0} frames</span><span>{formatBytes(chronicle?.storedBytes ?? 0)}</span><span>Latest: {formatMemoryTime(chronicle?.lastCapturedAt)}</span></div>
        </section>
        {#if chronicle?.lastError}
          <section class="chronicle-error">
            <span><h4>Capture unavailable</h4><p>{chronicle.lastError}</p><small>You may need to allow Screen Recording for Midas in macOS System Settings.</small></span>
            <button type="button" disabled={updatingChronicle} onclick={() => void retryChronicle()}>{updatingChronicle ? 'Trying…' : 'Try again'}</button>
          </section>
        {/if}
      </div>
    {:else}
    <div class="options-body">
      <div class="options-rail">
        <label class="options-search">
          <Icon name="search" size={15}/>
          <input bind:value={search} type="search" placeholder={`Search ${mode === 'mcp' ? 'MCP server' : mode === 'model' ? 'company' : mode}`} aria-label={`Search ${mode === 'mcp' ? 'MCP server' : mode === 'model' ? 'company' : mode}`}/>
        </label>

        <ul class="options-rail-list" class:empty-state={railEmpty}>
          {#if mode === 'mcp'}
            {#each visibleMcp as item (item.id)}
              <li><button type="button" class:selected={adding !== 'mcp' && item.id === selectedMcp} class:integration-disabled={!item.enabled} class="options-rail-row" onclick={() => selectMcp(item.id)}>
                <span class="option-mark"><Icon name="connections" size={14}/></span>
                <span class="options-rail-copy"><strong>{item.name}</strong><small>{item.source} · {item.status}</small></span>
              </button></li>
            {:else}<li class="options-empty rail-empty">{loading ? 'Loading MCP servers…' : !query && mcpServers.length === 0 ? 'No MCP servers yet' : 'No MCP servers found'}</li>{/each}
          {:else if mode === 'skills'}
            {#each visibleSkills as item (item.name)}
              <li><button type="button" class:selected={adding !== 'skills' && item.name === selectedSkill} class:integration-disabled={!item.enabled} class="options-rail-row" onclick={() => selectSkill(item.name)}>
                <span class="option-mark">
                  {#if skillLogo(item)}
                    <img class:contained={containsSkillIcon(item)} class="skill-logo" src={skillLogo(item)} alt="" aria-hidden="true"/>
                  {:else}
                    <Icon name={(SKILL_ICONS[item.name] ?? 'book-open') as never} size={14}/>
                  {/if}
                </span>
                <span class="options-rail-copy"><strong>{skillDisplayName(item.name)}</strong>{#if item.source !== 'official'}<small>{skillRowAuthor(item.source)}</small>{/if}</span>
                {#if item.source === 'official'}<span class="official-rail-stamp" aria-label="Official"><Icon name="verified" size={14} strokeWidth={1.8}/></span>{/if}
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

        {#if mode === 'mcp' || mode === 'skills'}
          <button type="button" class="options-refresh" onclick={() => beginAdd(mode === 'mcp' ? 'mcp' : 'skills')}><Icon name="plus" size={15}/><span>{mode === 'mcp' ? 'Add MCP server' : 'Add Skills'}</span></button>
        {:else}
          <div class="options-rail-tools" bind:this={railActions}>
            <div class="rail-tool-wrap">
              <button type="button" class:active={mode === 'model' ? modelFilter !== 'all' : providerFilter !== 'all'} class="rail-tool" aria-label={`Filter ${mode === 'model' ? 'models' : 'providers'}`} aria-haspopup="menu" aria-expanded={openRailMenu === 'filter'} data-tooltip-label="Filter" onclick={() => toggleRailMenu('filter')}><Icon name="filter" size={15}/></button>
              {#if openRailMenu === 'filter'}
                <div class="polymux-dropdown-menu rail-tool-menu" role="menu" aria-label={`Filter ${mode === 'model' ? 'models' : 'providers'}`}>
                  {#each (mode === 'model' ? modelFilterOptions : providerFilterOptions) as option (option.value)}
                    <button type="button" class="polymux-dropdown-item" role="menuitemradio" aria-checked={option.value === (mode === 'model' ? modelFilter : providerFilter)} onclick={() => chooseRailOption('filter', option.value)}><span>{option.label}</span>{#if option.value === (mode === 'model' ? modelFilter : providerFilter)}<Icon name="check" size={13}/>{/if}</button>
                  {/each}
                </div>
              {/if}
            </div>
            <div class="rail-tool-wrap">
              <button type="button" class:active={mode === 'model' ? modelSort !== 'recommended' : providerSort !== 'recommended'} class="rail-tool" aria-label={`Sort ${mode === 'model' ? 'models' : 'providers'}`} aria-haspopup="menu" aria-expanded={openRailMenu === 'sort'} data-tooltip-label="Sort" onclick={() => toggleRailMenu('sort')}><Icon name="sort" size={15}/></button>
              {#if openRailMenu === 'sort'}
                <div class="polymux-dropdown-menu rail-tool-menu" role="menu" aria-label={`Sort ${mode === 'model' ? 'models' : 'providers'}`}>
                  {#each (mode === 'model' ? modelSortOptions : providerSortOptions) as option (option.value)}
                    <button type="button" class="polymux-dropdown-item" role="menuitemradio" aria-checked={option.value === (mode === 'model' ? modelSort : providerSort)} onclick={() => chooseRailOption('sort', option.value)}><span>{option.label}</span>{#if option.value === (mode === 'model' ? modelSort : providerSort)}<Icon name="check" size={13}/>{/if}</button>
                  {/each}
                </div>
              {/if}
            </div>
            {#if mode === 'provider'}
              <button type="button" class:active={addingCustomProvider} class="rail-tool" aria-label="Add custom provider" data-tooltip-label="Add custom provider" onclick={beginCustomProvider}><Icon name="plus" size={15}/></button>
            {/if}
            {#if mode === 'model' && activeModel}
              <button type="button" class="selected-model" aria-label={`Selected model: ${activeModel.name}`} data-tooltip-label="Current Model" onclick={() => void revealActiveModel()}>
                <ProviderLogo provider={activeModelCompany} logoDataUrl={activeModelLogo} size={14}/><span>{activeModel.name}</span>
              </button>
            {/if}
          </div>
        {/if}
      </div>

      <div class="options-detail" role="tabpanel">
        {#if mode === 'mcp' && adding === 'mcp'}
          <header class="options-detail-header"><span class="option-mark large"><Icon name={editingIntegration ? 'edit' : 'plus'} size={18}/></span><span class="options-title-group"><h3>{editingIntegration ? 'Edit MCP server' : 'Add MCP server'}</h3></span></header>
          <form class="custom-integration-form" onsubmit={(event) => { event.preventDefault(); void saveCustomMcp(); }}>
            <label>Server ID<input bind:value={customMcpId} disabled={editingIntegration} placeholder="my-server" required/></label>
            <label>Name<input bind:value={customMcpName} placeholder="My server" required/></label>
            <label>Transport<select bind:value={customMcpTransport}><option value="stdio">Local command</option><option value="streamable-http">Remote HTTP</option></select></label>
            <label>{customMcpTransport === 'stdio' ? 'Command' : 'URL'}<input bind:value={customMcpTarget} placeholder={customMcpTransport === 'stdio' ? 'node' : 'https://example.com/mcp'} required/></label>
            {#if customMcpTransport === 'stdio'}<label>Arguments<textarea bind:value={customMcpArgs} placeholder="One argument per line"></textarea></label><label>Working directory<input bind:value={customMcpCwd} placeholder="Optional"/></label>{/if}
            <label>{customMcpTransport === 'stdio' ? 'Environment' : 'Headers'}<textarea bind:value={customMcpEnvironment} placeholder="KEY=value, one per line"></textarea></label>
            <div class="custom-provider-actions"><button type="button" onclick={() => adding = null}>Cancel</button><button class="credential-primary" type="submit" disabled={integrationSaving}>{integrationSaving ? 'Saving…' : 'Save'}</button></div>
          </form>
        {:else if mode === 'skills' && adding === 'skills'}
          <header class="options-detail-header"><span class="option-mark large"><Icon name={editingIntegration ? 'edit' : 'plus'} size={18}/></span><span class="options-title-group"><h3>{editingIntegration ? 'Edit Skill' : 'Add Skill'}</h3></span></header>
          <form class="custom-integration-form" onsubmit={(event) => { event.preventDefault(); void saveCustomSkill(); }}>
            <label>Name<input bind:value={customSkillName} placeholder="my-skill" required/></label>
            <label>Description<input bind:value={customSkillDescription} placeholder="When Midas should use this skill" required/></label>
            <label>Instructions<textarea class="instructions" bind:value={customSkillInstructions} placeholder="Skill instructions" required></textarea></label>
            <div class="custom-provider-actions"><button type="button" onclick={() => adding = null}>Cancel</button><button class="credential-primary" type="submit" disabled={integrationSaving}>{integrationSaving ? 'Saving…' : 'Save'}</button></div>
          </form>
        {:else if mode === 'mcp' && mcp}
          <header class="options-detail-header">
            <span class="option-mark large"><Icon name="connections" size={18}/></span>
            <span class="options-title-group"><h3>{mcp.name}</h3><span class="options-badge">{mcp.source}</span><span class:good={mcp.status === 'connected'} class="options-badge">{mcp.enabled ? mcp.status : 'disabled'}</span></span>
            {#if mcp.editable}<button type="button" class="provider-edit" aria-label="Edit MCP server" onclick={() => editMcp(mcp)}><Icon name="edit" size={14}/></button>{/if}
            <button type="button" class:enabled={mcp.enabled} class="chronicle-toggle" role="switch" aria-label="Enable MCP server" aria-checked={mcp.enabled} disabled={integrationSaving} onclick={() => void setMcpEnabled(mcp)}><span></span></button>
          </header>
          <section class="options-detail-block"><h4>Connection</h4><p>{mcp.transport === 'stdio' ? 'Local standard input/output server' : 'Remote Streamable HTTP server'}</p></section>
          <div class="options-resources">
            <section><header><h4>Tools</h4><span>{mcp.toolNames.length}</span></header><ul>{#each mcp.toolNames as name}<li><Icon name="wrench" size={14}/>{name}</li>{:else}<li class="muted">No tools exposed</li>{/each}</ul></section>
            <section><header><h4>Resources</h4><span>{mcp.resourceUris.length}</span></header><ul>{#each mcp.resourceUris as uri}<li><Icon name="link" size={14}/>{uri}</li>{:else}<li class="muted">No resources exposed</li>{/each}</ul></section>
          </div>
          {#if mcp.error}<section class="options-detail-block"><h4>Last error</h4><p>{mcp.error}</p></section>{/if}
        {:else if mode === 'skills' && skill}
          <header class="options-detail-header">
            <span class="option-mark large">
              {#if skillLogo(skill)}
                <img class:contained={containsSkillIcon(skill)} class="skill-logo" src={skillLogo(skill)} alt="" aria-hidden="true"/>
              {:else}
                <Icon name={(SKILL_ICONS[skill.name] ?? 'book-open') as never} size={18}/>
              {/if}
            </span>
            <span class="options-title-group"><h3>{skillDisplayName(skill.name)}</h3>{#if skill.source === 'official'}<span class="options-badge official-badge"><Icon name="verified" size={11} strokeWidth={1.8}/><span>Official</span></span>{:else}<span class="options-badge">{skill.source}</span>{/if}</span>
            {#if skill.editable}<button type="button" class="provider-edit" aria-label="Edit skill" onclick={() => editSkill(skill)}><Icon name="edit" size={14}/></button>{/if}
            <button type="button" class:enabled={skill.enabled} class="chronicle-toggle" role="switch" aria-label="Enable skill" aria-checked={skill.enabled} disabled={integrationSaving} onclick={() => void setSkillEnabled(skill)}><span></span></button>
          </header>
          <section class="options-detail-block"><h4>Description</h4><p>{skill.description}</p></section>
          <section class="options-detail-block"><h4>Invocation</h4><p>{skill.disableModelInvocation ? 'Only available when explicitly requested.' : 'Midas can select this skill when it matches the task.'}</p></section>
          <section class="options-detail-block"><h4>Allowed tools</h4><div class="option-chips">{#each skill.allowedTools as tool}<span>{tool}</span>{:else}<span>Uses the active tool policy</span>{/each}</div></section>
          <p class="options-path">{skill.filePath}</p>
        {:else if mode === 'model' && modelCompany}
          <header class="options-detail-header provider-detail-header">
            <span class="provider-mark large"><ProviderLogo provider={modelCompany.id} logoDataUrl={modelCompany.logoDataUrl} size={22}/></span>
            <span class="options-title-group"><h3>{modelCompany.name}</h3><span class="model-count">{modelCompany.models.length} {modelCompany.models.length === 1 ? 'model' : 'models'}</span></span>
          </header>
          <div class="pricing-toolbar">
            <p class="pricing-note">Prices are per 1M tokens. Some rates may be unavailable or not applicable.</p>
            <div class="currency-menu"><Menu options={currencyOptions} bind:value={currency} label="Currency" onChange={(value) => void setCurrency(value)}/></div>
          </div>
          <label class="model-search">
            <Icon name="search" size={14}/>
            <input bind:value={modelSearch} type="search" placeholder="Search model" aria-label="Search model"/>
            {#if modelSearch}<button type="button" class="model-search-clear" aria-label="Clear model search" onclick={() => modelSearch = ''}><Icon name="close" size={13}/></button>{/if}
          </label>
          <div class="model-table-wrap">
            <table class="model-table">
              <thead><tr><th>Model</th><th>Input</th><th>Output</th><th>Cache hit</th><th>Cache write</th><th>Context</th></tr></thead>
              <tbody>
                {#each visibleCompanyModels as item (`${item.provider}/${item.id}`)}
                  <tr class:active={item.selected} class:revealed={revealedModelKey === `${item.provider}/${item.id}`}>
                    <td><button type="button" class="model-row-name" disabled={item.selected} title={modelTooltip(item)} aria-label={item.selected ? `${item.name} selected` : `Use ${item.name}`} onclick={() => chooseModel(item)}><strong>{item.name}</strong><small>{modelSubtitle(item)}</small></button></td>
                    <td>{formatPrice(item.cost.input, currency, currencyRates)}</td>
                    <td>{formatPrice(item.cost.output, currency, currencyRates)}</td>
                    <td>{formatPrice(item.cost.cacheRead, currency, currencyRates)}</td>
                    <td>{formatPrice(item.cost.cacheWrite, currency, currencyRates)}</td>
                    <td>{formatTokens(item.contextWindow)}</td>
                  </tr>
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
              <p>{credentialProvider.apiKeyLabel ?? `Configure credentials for ${credentialProvider.name}.`} Saved keys are encrypted by the operating system and are never displayed again.</p>
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
                  <span class="credential-key-state" class:active={key.active}></span>
                  <span><strong>{key.label}</strong><small>{key.active ? 'Active' : key.status === 'rate_limited' ? 'Rate limited' : key.status === 'invalid' ? 'Invalid' : 'Standby'}</small></span>
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
  .options-header{flex:none;display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding:30px 32px 18px}.options-header>div{min-width:0}.options-header h2{margin:0;color:var(--neutral-950);font-size:28px;font-weight:570;letter-spacing:-.025em}.options-header p{margin:7px 0 0;color:var(--neutral-600);font-size:12.5px;line-height:1.5}
  .options-close{width:32px;height:32px;display:grid;flex:none;place-items:center;border:0;border-radius:10px;padding:0;background:transparent;color:var(--neutral-500);cursor:pointer}.options-close:hover,.options-close:focus-visible{outline:none;background:var(--neutral-100);color:var(--neutral-950)}
  .options-mode{align-self:flex-start;display:flex;gap:4px;margin:0 var(--options-detail-edge) 14px var(--options-content-edge)}.options-mode button{border:0;border-radius:8px;padding:5px var(--options-tab-inline);background:transparent;color:var(--neutral-500);cursor:pointer;font-family:inherit;font-size:13px}.options-mode button:hover{color:var(--neutral-900)}.options-mode button.active{background:var(--neutral-100);color:var(--neutral-950);font-weight:540}
  .options-error{margin:0 18px 8px;padding:7px 10px;border-radius:8px;background:var(--neutral-100);color:var(--neutral-700);font-size:12px}
  .general-options{flex:1;min-height:0;overflow-y:auto;padding:2px var(--options-detail-edge) 20px calc(var(--options-content-edge) + var(--options-tab-inline))}.general-setting-row{display:flex;align-items:center;gap:11px;min-height:62px;border-bottom:1px solid var(--neutral-200)}.general-setting-copy{min-width:0;flex:1;display:flex;flex-direction:column;gap:3px}.general-setting-copy h4{margin:0;color:var(--neutral-900);font-size:12.5px;font-weight:570}.general-setting-copy small{overflow:hidden;color:var(--neutral-500);text-overflow:ellipsis;white-space:nowrap;font-size:10.5px}.permission-retry{height:28px;flex:none;border:1px solid var(--neutral-200);border-radius:8px;padding:0 10px;background:var(--app-surface);color:var(--neutral-700);cursor:pointer;font-family:inherit;font-size:10.5px;font-weight:550}.permission-retry:hover,.permission-retry:focus-visible{outline:0;background:var(--neutral-100);color:var(--neutral-950)}.theme-switch{display:flex;flex:none;gap:2px;padding:2px;border-radius:9px;background:var(--neutral-100)}.theme-switch button{height:26px;border:0;border-radius:7px;padding:0 9px;background:transparent;color:var(--neutral-500);cursor:pointer;font-family:inherit;font-size:10.5px}.theme-switch button:hover,.theme-switch button:focus-visible{outline:0;color:var(--neutral-900)}.theme-switch button.active{background:var(--app-surface);color:var(--neutral-950);box-shadow:0 1px 3px rgba(0,0,0,.09)}.theme-switch button:disabled{cursor:default;opacity:.5}
  .memory-options{flex:1;min-height:0;overflow-y:auto;padding:2px var(--options-detail-edge) 20px calc(var(--options-content-edge) + var(--options-tab-inline))}.memory-options>.options-detail-header{align-items:flex-start}.memory-top-metrics{display:flex;flex:none;align-items:flex-start;gap:12px;margin-left:auto;text-align:center}.memory-top-metrics>div{display:flex;min-width:42px;flex-direction:column;gap:1px}.memory-top-metrics>div:last-child{min-width:58px}.memory-top-metrics span{color:var(--neutral-400);font-size:9.5px}.memory-top-metrics strong{overflow:hidden;color:var(--neutral-800);text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:550}.memory-intro{max-width:620px;margin:12px 0 14px;color:var(--neutral-600);font-size:11.5px;line-height:1.5}.memory-options>.options-detail-block{margin:12px 0 6px}.memory-options>.options-path{margin:9px 0 0}.memory-divider{height:1px;margin:14px 0;background:var(--neutral-200)}.chronicle-section>header{display:flex;align-items:center;justify-content:space-between;gap:16px}.chronicle-section>header>span{display:flex;min-width:0;flex-direction:column;gap:2px}.chronicle-section h4{margin:0;color:var(--neutral-900);font-size:12.5px;font-weight:570}.chronicle-section small{color:var(--neutral-400);font-size:10.5px}.chronicle-section>p{max-width:610px;margin:6px 0;color:var(--neutral-600);font-size:11px;line-height:1.45}.chronicle-inline-stats{display:flex;flex-wrap:wrap;gap:12px;color:var(--neutral-400);font-size:10px}.chronicle-toggle{width:36px;height:20px;flex:none;border:0;border-radius:999px;padding:2px;background:var(--neutral-300);cursor:pointer;transition:background .15s ease}.chronicle-toggle span{width:16px;height:16px;display:block;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.2);transition:transform .15s ease,background .15s ease}.chronicle-toggle.enabled{background:var(--neutral-900)}.chronicle-toggle.enabled span{transform:translateX(16px)}:global(:root[data-theme="dark"]) .chronicle-toggle{background:#484848}:global(:root[data-theme="dark"]) .chronicle-toggle span{background:#d8d8d8}:global(:root[data-theme="dark"]) .chronicle-toggle.enabled{background:#e7e7e7}:global(:root[data-theme="dark"]) .chronicle-toggle.enabled span{background:#242424}.chronicle-toggle:disabled{cursor:default;opacity:.5}.chronicle-error{display:flex;align-items:center;gap:12px;margin-top:10px;padding:9px 11px;border-radius:9px;background:#fff5f5;color:#8f3e3e}.chronicle-error>span{min-width:0;flex:1}.chronicle-error h4,.chronicle-error p,.chronicle-error small{margin:0}.chronicle-error h4{font-size:11px}.chronicle-error p{margin-top:3px;font-size:11px}.chronicle-error small{display:block;margin-top:3px;opacity:.75;font-size:10px}.chronicle-error button{height:28px;flex:none;border:1px solid color-mix(in srgb,currentColor 20%,transparent);border-radius:8px;padding:0 10px;background:var(--app-surface);color:inherit;cursor:pointer;font-family:inherit;font-size:10.5px;font-weight:550}.chronicle-error button:hover,.chronicle-error button:focus-visible{outline:0;background:var(--neutral-100)}.chronicle-error button:disabled{cursor:default;opacity:.55}:global(:root[data-theme="dark"]) .chronicle-error{background:#321f1f;color:#eea7a7}:global(:root[data-theme="dark"]) .chronicle-error button{border-color:#704242;background:#442727;color:#f0b0b0}:global(:root[data-theme="dark"]) .chronicle-error button:hover,:global(:root[data-theme="dark"]) .chronicle-error button:focus-visible{background:#553030;color:#ffd0d0}
  .options-body{position:relative;flex:1;min-height:0;display:grid;grid-template-columns:220px minmax(0,1fr)}.options-body:after{content:'';position:absolute;top:6px;bottom:12px;left:220px;width:1px;background:var(--neutral-200)}
  .options-rail{min-height:0;display:flex;flex-direction:column;gap:6px;padding:0 var(--options-divider-gap) 12px var(--options-content-edge)}.options-search{display:flex;align-items:center;gap:7px;height:30px;padding:0 10px;border:1px solid var(--neutral-200);border-radius:9px;background:var(--input-surface);color:var(--neutral-500)}.options-search:focus-within{border-color:var(--neutral-400);background:var(--prompt-surface-active)}.options-search input{min-width:0;flex:1;border:0;background:transparent;color:var(--neutral-950);outline:none;font-size:12.5px}.options-search input::-webkit-search-cancel-button{filter:grayscale(1);opacity:.72;cursor:pointer}.options-search input::-webkit-search-cancel-button:hover{opacity:1}
  .options-rail-list{flex:1;min-height:0;overflow-y:auto;margin:0;padding:6px 0 14px;list-style:none;-webkit-mask-image:linear-gradient(to bottom,transparent,#000 6px,#000 calc(100% - 14px),transparent);mask-image:linear-gradient(to bottom,transparent,#000 6px,#000 calc(100% - 14px),transparent)}.options-rail-list.empty-state{display:flex;align-items:center;justify-content:center;-webkit-mask-image:none;mask-image:none}.options-rail-list li{display:flex}.options-rail-list .rail-empty{justify-content:center;padding:0 8px}.options-rail-row{width:100%;display:flex;align-items:center;gap:10px;margin:2px 0;padding:5px 9px;border:0;border-radius:10px;background:transparent;text-align:left;cursor:pointer}.options-rail-row:hover,.options-rail-row:focus-visible{outline:0;background:var(--neutral-100)}.options-rail-row.selected{background:var(--neutral-200)}
  .options-rail-row.integration-disabled{opacity:.52}.options-rail-row.integration-disabled.selected{opacity:.72}
  .official-rail-stamp{width:20px;height:26px;display:grid;flex:none;place-items:center;color:var(--neutral-500)}
  .option-mark{flex:none;width:26px;height:26px;display:grid;place-items:center;border-radius:8px;background:var(--neutral-200);color:var(--neutral-700)}
  /* A product's own icon already carries its shape and ground, so the house
     tile would read as a second, mismatched container behind it. */
  .option-mark:has(.skill-logo){background:transparent}
  .option-mark:has(.skill-logo.contained){background:var(--neutral-200)}
  .skill-logo{width:100%;height:100%;display:block;object-fit:contain}.skill-logo.contained{width:14px;height:14px}.option-mark.large{width:34px;height:34px;border-radius:10px}.option-mark.large .skill-logo.contained{width:18px;height:18px}.options-rail-copy{min-width:0;flex:1;display:flex;flex-direction:column;gap:1px}.options-rail-copy strong{overflow:hidden;color:var(--neutral-950);text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:530}.options-rail-copy small{overflow:hidden;color:var(--neutral-500);text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;text-transform:capitalize}.options-name{display:flex;align-items:center;gap:5px}.options-name strong{min-width:0;flex:1}.options-name i{padding:1px 5px;border-radius:5px;background:#fff;color:var(--neutral-600);font-size:9px;font-style:normal}
  .provider-mark{width:26px;height:26px;display:grid;flex:none;place-items:center;border:1px solid var(--neutral-200);border-radius:8px;background:#fff}.provider-mark.large{width:34px;height:34px;border-radius:10px}.provider-row.selected .provider-mark{border-color:rgba(0,0,0,.08)}.provider-row.has-check{position:relative}.provider-row.has-check .options-rail-copy{-webkit-mask-image:linear-gradient(to right,#000 0,#000 calc(100% - 34px),transparent calc(100% - 13px));mask-image:linear-gradient(to right,#000 0,#000 calc(100% - 34px),transparent calc(100% - 13px))}.configured-check{position:absolute;top:0;right:15px;bottom:0;width:18px;display:grid;place-items:center;color:var(--neutral-600)}
  .options-refresh{flex:none;display:flex;align-items:center;gap:10px;margin:2px 0 0;padding:7px 9px;border:0;border-radius:10px;background:transparent;color:var(--neutral-500);text-align:left;cursor:pointer;font-size:13px;text-transform:capitalize}.options-refresh:hover,.options-refresh:focus-visible{outline:0;background:var(--neutral-100);color:var(--neutral-900)}.options-refresh:disabled{opacity:.55}
  .options-rail-tools{position:relative;flex:none;display:flex;align-items:center;justify-content:flex-start;gap:2px;margin-top:2px}.rail-tool-wrap{position:relative}.rail-tool{width:30px;height:30px;display:grid;place-items:center;border:0;border-radius:8px;padding:0;background:transparent;color:var(--neutral-500);cursor:pointer}.rail-tool:hover,.rail-tool:focus-visible,.rail-tool.active,.rail-tool[aria-expanded="true"]{outline:0;background:var(--neutral-100);color:var(--neutral-900)}.rail-tool-menu{position:absolute;z-index:5;bottom:36px;left:0;width:154px}.rail-tool-menu .polymux-dropdown-item>span{min-width:0;flex:1}
  .options-detail{min-height:0;overflow-y:auto;padding:0 18px 20px var(--options-divider-gap)}.options-detail-header{display:flex;align-items:center;gap:11px}.options-title-group{min-width:0;flex:1;display:flex;align-items:center;gap:8px}.options-title-group h3{min-width:0;margin:0;overflow:hidden;color:var(--neutral-950);text-overflow:ellipsis;white-space:nowrap;font-size:15px;font-weight:570}.options-badge{flex:none;padding:2px 8px;border-radius:7px;background:var(--neutral-200);color:var(--neutral-600);font-size:10.5px;font-weight:540;text-transform:capitalize}.options-badge.good{background:#e8f5ec;color:#347049}.official-badge{display:inline-flex;align-items:center;gap:4px}.official-badge :global(svg){flex:none}
  .options-detail-block{margin:19px 0 10px}.options-detail-block h4,.options-resources h4{margin:0;color:var(--neutral-800);font-size:11.5px;font-weight:570;letter-spacing:.02em}.options-detail-block p{margin:5px 0 0;color:var(--neutral-600);font-size:12.5px;line-height:1.55;white-space:pre-wrap}.options-resources{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;margin-top:18px}.options-resources header{display:flex;align-items:center;justify-content:space-between;margin-bottom:5px}.options-resources header span{padding:1px 7px;border-radius:999px;background:var(--neutral-100);color:var(--neutral-600);font-size:10.5px}.options-resources ul{max-height:196px;overflow:auto;margin:0;padding:0;list-style:none}.options-resources li{display:flex;align-items:center;gap:7px;min-height:28px;overflow:hidden;color:var(--neutral-700);text-overflow:ellipsis;white-space:nowrap;font-size:12px}.options-resources li.muted{color:var(--neutral-400)}
  .option-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}.option-chips span{padding:4px 8px;border-radius:7px;background:var(--neutral-100);color:var(--neutral-700);font-size:11px}.options-path{margin:24px 0 0;overflow-wrap:anywhere;color:var(--neutral-400);font-size:10.5px}.options-empty{width:100%;padding:24px 8px;color:var(--neutral-400);text-align:center;font-size:12px}.options-empty.detail{display:grid;min-height:100%;place-items:center;margin:0}
  .provider-detail-header{padding-bottom:12px}.model-count{margin-left:auto;color:var(--neutral-500);font-size:11px;font-weight:450;white-space:nowrap}.pricing-toolbar{display:flex;align-items:flex-start;gap:12px;margin:-4px 0 10px}.pricing-note{min-width:0;flex:1;margin:0;color:var(--neutral-500);font-size:11px}/* Lifted against the note's first line: the trigger is much taller than the
     11px text, so flex-start alignment leaves it sitting visibly low. */
  .currency-menu{flex:none;margin-top:-5px}.currency-menu :global(.select-menu-trigger){height:26px;min-width:58px;border-radius:8px;padding:0 7px 0 9px;font-size:10.5px}.model-search{height:30px;display:flex;align-items:center;gap:7px;border-bottom:1px solid var(--neutral-200);color:var(--neutral-400)}.model-search:focus-within{border-color:var(--neutral-500);color:var(--neutral-600)}.model-search input{min-width:0;flex:1;border:0;padding:0;background:transparent;color:var(--neutral-950);outline:0;font-family:inherit;font-size:11.5px}.model-search input::-webkit-search-cancel-button{-webkit-appearance:none;appearance:none}.model-search input::placeholder{color:var(--neutral-400)}.model-search-clear{width:24px;height:24px;display:grid;flex:none;place-items:center;border:0;border-radius:7px;padding:0;background:transparent;color:#111;cursor:pointer}.model-search-clear:hover,.model-search-clear:focus-visible{outline:0;background:var(--neutral-100)}.model-table-wrap{overflow:auto}.model-table{width:100%;border-collapse:collapse;table-layout:fixed}.model-table th{height:31px;padding:0 10px;border-bottom:1px solid var(--neutral-200);background:transparent;color:var(--neutral-500);text-align:right;white-space:nowrap;font-size:10.5px;font-weight:540}.model-table th:first-child{width:34%;text-align:left}.model-table th:last-child{width:12%}.model-table td{height:46px;padding:0 10px;border-bottom:1px solid var(--neutral-100);color:var(--neutral-700);text-align:right;white-space:nowrap;font-size:11.5px;font-variant-numeric:tabular-nums}.model-table tbody tr:last-child td{border-bottom:0}.model-table tbody tr:hover td{background:var(--neutral-50)}.model-table tr.active td{background:var(--neutral-100)}.model-table td:first-child{text-align:left}.model-table .model-table-empty{text-align:center;color:var(--neutral-400);font-size:11px}.model-row-name{width:100%;display:flex;flex-direction:column;gap:1px;overflow:hidden;border:0;padding:0;background:transparent;color:inherit;text-align:left;cursor:pointer}.model-row-name:disabled{cursor:default}.model-row-name strong{overflow:hidden;color:var(--neutral-950);text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:540}.model-row-name small{overflow:hidden;color:var(--neutral-400);text-overflow:ellipsis;white-space:nowrap;font-size:9.5px;font-weight:400}.model-row-name:not(:disabled):hover strong,.model-row-name:not(:disabled):focus-visible strong{color:var(--flare-blue,#2384cb)}.model-row-name:focus-visible{outline:none}
  .provider-edit{width:28px;height:28px;display:grid;flex:none;place-items:center;border:0;border-radius:8px;padding:0;background:transparent;color:var(--neutral-500);cursor:pointer}.provider-edit:hover,.provider-edit:focus-visible{outline:0;background:var(--neutral-100);color:var(--neutral-900)}
  .credential-panel{max-width:500px;padding:5px 2px}.credential-copy h4{margin:0;color:var(--neutral-900);font-size:13px;font-weight:570}.credential-copy p{max-width:470px;margin:6px 0 0;color:var(--neutral-500);font-size:12px;line-height:1.55}.credential-form{margin-top:10px}.credential-input-row{display:flex;gap:7px}.credential-input-row input{height:32px;min-width:0;flex:1;border:1px solid var(--neutral-200);border-radius:8px;padding:0 10px;background:var(--input-surface);color:var(--neutral-950);outline:none;font-family:inherit;font-size:11.5px}.credential-input-row input:focus{border-color:var(--neutral-400);background:var(--prompt-surface-active)}.credential-primary{height:32px;border:0;border-radius:8px;padding:0 12px;background:var(--neutral-900);color:var(--on-primary);cursor:pointer;font-family:inherit;font-size:11.5px;font-weight:540}.credential-primary:hover{filter:brightness(.92)}.credential-primary:disabled{cursor:default;opacity:.4}.credential-unavailable{margin:22px 0 0;padding:10px;border-radius:9px;background:var(--neutral-100);color:var(--neutral-500);font-size:12px}
  .custom-provider-form{max-width:440px;padding:2px}.custom-provider-form>p{margin:0 0 16px;color:var(--neutral-500);font-size:11.5px;line-height:1.5}.custom-provider-form>label{display:flex;flex-direction:column;gap:5px;margin:0 0 11px;color:var(--neutral-700);font-size:11px;font-weight:540}.custom-provider-form label>small{color:var(--neutral-400);font-size:10px;font-weight:400}.custom-provider-form input,.custom-provider-form textarea{width:100%;border:1px solid var(--neutral-200);border-radius:8px;padding:0 10px;background:var(--input-surface);color:var(--neutral-950);outline:none;font-family:inherit;font-size:11.5px}.custom-provider-form input{height:32px}.custom-provider-form textarea{min-height:88px;padding-block:8px;resize:vertical;line-height:1.45}.custom-provider-form input:focus,.custom-provider-form textarea:focus{border-color:var(--neutral-400);background:var(--prompt-surface-active)}.custom-provider-actions{display:flex;justify-content:flex-end;gap:7px;margin-top:15px}.custom-provider-actions>button{height:32px;border:0;border-radius:8px;padding:0 12px;background:var(--neutral-100);color:var(--neutral-700);cursor:pointer;font-family:inherit;font-size:11.5px}.custom-provider-actions>button:hover{background:var(--neutral-200)}.custom-provider-actions>.credential-primary{background:var(--neutral-900);color:var(--on-primary)}.custom-provider-actions>.credential-primary:hover{filter:brightness(.92)}
  .custom-integration-form{max-width:440px;padding-top:16px}.custom-integration-form>label{display:flex;flex-direction:column;gap:5px;margin-bottom:10px;color:var(--neutral-700);font-size:11px;font-weight:540}.custom-integration-form input,.custom-integration-form select,.custom-integration-form textarea{width:100%;border:1px solid var(--neutral-200);border-radius:8px;background:var(--input-surface);color:var(--neutral-950);outline:none;font:inherit;font-size:11.5px}.custom-integration-form input,.custom-integration-form select{height:32px;padding:0 10px}.custom-integration-form textarea{min-height:58px;padding:8px 10px;resize:vertical;line-height:1.4}.custom-integration-form textarea.instructions{min-height:150px}.custom-integration-form input:focus,.custom-integration-form select:focus,.custom-integration-form textarea:focus{border-color:var(--neutral-400)}.custom-integration-form input:disabled{color:var(--neutral-400);background:var(--neutral-100)}
  .field-label{display:inline}.required-mark{color:#b44949}
  .custom-provider-logo{display:block;flex:none;cursor:pointer}.custom-provider-logo>input{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}.custom-provider-logo-preview{overflow:hidden;transition:background-color .14s ease}.custom-provider-logo:hover .custom-provider-logo-preview,.custom-provider-logo:focus-within .custom-provider-logo-preview{background:var(--neutral-300)}.custom-provider-logo-preview img{width:100%;height:100%;display:block;object-fit:cover}
  .credential-keys{margin-top:12px}.credential-key-row{min-height:42px;display:flex;align-items:center;gap:9px;padding:0 6px;border-bottom:1px solid var(--neutral-100)}.credential-key-state{width:7px;height:7px;flex:none;border-radius:50%;background:var(--neutral-300)}.credential-key-state.active{background:#4da46a}.credential-key-row>span:nth-child(2){min-width:0;flex:1;display:flex;flex-direction:column}.credential-key-row strong{color:var(--neutral-800);font-size:11.5px;font-weight:520}.credential-key-row small{color:var(--neutral-400);font-size:10px}.credential-key-row button{width:28px;height:28px;display:grid;place-items:center;border:0;border-radius:8px;background:transparent;color:var(--neutral-400);cursor:pointer}.credential-key-row button:hover{background:var(--neutral-100);color:#a44343}.credential-unavailable{margin:22px 0 0;padding:10px;border-radius:9px;background:var(--neutral-100);color:var(--neutral-500);font-size:12px}
  .selected-model{height:28px;min-width:0;display:flex;align-items:center;gap:6px;margin-left:auto;border:0;border-radius:8px;padding:0 6px;background:transparent;color:var(--neutral-600);cursor:pointer;font-family:inherit;font-size:10.5px}.selected-model:hover,.selected-model:focus-visible{outline:0;background:var(--neutral-100);color:var(--neutral-900)}.selected-model :global(.provider-logo){flex:none}.selected-model span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .model-table tr.revealed td{animation:model-reveal .9s ease-out}
  @keyframes model-reveal{0%,45%{background:var(--neutral-200)}100%{background:var(--neutral-100)}}@keyframes backdrop-in{from{opacity:0}}@keyframes modal-in{from{opacity:0;transform:translateY(10px) scale(.985)}}
  @media(max-width:700px){.options-modal{width:calc(100vw - 24px);height:calc(100vh - 24px)}.options-header{padding:24px 22px 16px}.options-body{grid-template-columns:210px minmax(0,1fr)}.options-body:after{left:210px}.options-resources{grid-template-columns:1fr}}
</style>
