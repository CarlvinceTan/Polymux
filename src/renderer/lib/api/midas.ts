import type {
  ArtifactDto,
  ConversationDto,
  GoalDto,
  GeneralSettingsDto,
  JsonValue,
  McpServerDto,
  MemoryDto,
  MessageDto,
  MidasApi,
  ModelDto,
  ModelMetadataDto,
  ProviderDto,
  ReferenceDto,
  RunEventDto,
  SkillDto,
  StartRunRequest,
} from '@midas/protocol';

let browserApi: MidasApi | undefined;

export function midasApi(): MidasApi {
  if (typeof window !== 'undefined' && window.midas) return window.midas;
  if (import.meta.env.DEV || import.meta.env.VITE_MIDAS_BROWSER_DEMO === 'true')
    return browserApi ??= createBrowserDemoApi();
  throw new Error('The Midas desktop bridge is unavailable. Open this build through the desktop app.');
}

/** A development-only adapter keeps browser-based component tests useful. The
 * packaged desktop never selects it because preload supplies `window.midas`. */
function createBrowserDemoApi(): MidasApi {
  const now = Date.now();
  let conversations: ConversationDto[] = [
    conversation('welcome', 'Planning a product launch', now - 86_400_000),
    conversation('research', 'Research notes', now - 3 * 86_400_000),
  ];
  const messages = new Map<string, MessageDto[]>([
    ['welcome', [
      message('m1', 'welcome', 'user', 'Help me outline a simple launch plan.', now - 6000),
      message('m2', 'welcome', 'assistant', [{type: 'text', text: 'I can turn that into a concise plan with milestones, owners, and launch-day checks.'}], now - 2000),
    ]],
  ]);
  const goals = new Map<string, GoalDto>();
  const addedReferences = new Map<string, ReferenceDto[]>();
  const listeners = new Set<(event: RunEventDto) => void>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const runConversations = new Map<string, string>();
  let demoModels: ModelDto[] = [
    {provider: 'openai', id: '~openai/gpt-5.6-terra', name: 'GPT-5.6 Terra', contextWindow: 200_000, maxOutputTokens: 32_000, reasoning: true, input: ['text', 'image'], cost: {input: 2.5, output: 15, cacheRead: .25, cacheWrite: 3.125}, selected: true, custom: false},
    {provider: 'openai', id: '~openai/gpt-5.6-sol', name: 'GPT-5.6 Sol', contextWindow: 200_000, maxOutputTokens: 32_000, reasoning: true, input: ['text', 'image'], cost: {input: 5, output: 30, cacheRead: .5, cacheWrite: 6.25}, selected: false, custom: false},
    {provider: 'anthropic', id: '~anthropic/claude-sonnet-4-5', name: 'Claude Sonnet 4.5', contextWindow: 200_000, maxOutputTokens: 16_000, reasoning: true, input: ['text', 'image'], cost: {input: 3, output: 15, cacheRead: .3, cacheWrite: 3.75}, selected: false, custom: false},
    {provider: 'anthropic', id: '~anthropic/claude-haiku-4-5', name: 'Claude Haiku 4.5', contextWindow: 200_000, maxOutputTokens: 16_000, reasoning: true, input: ['text', 'image'], cost: {input: 1, output: 5, cacheRead: .1, cacheWrite: 1.25}, selected: false, custom: false},
    {provider: 'openrouter', id: 'google/gemini-3.1-pro-preview', name: 'Google: Gemini 3.1 Pro Preview', contextWindow: 1_000_000, maxOutputTokens: 65_536, reasoning: true, input: ['text', 'image'], cost: {input: 2, output: 12, cacheRead: .2, cacheWrite: null}, selected: false, custom: false},
  ];
  /** Stands in for the models.dev catalogue, keyed the same way the main
   * process keys it: `<provider>:<id>`. */
  const demoModelMetadata: Record<string, ModelMetadataDto> = {
    'openai:~openai/gpt-5.6-terra': {description: 'Flagship reasoning model for broad agentic work.', family: 'gpt-5.6', lab: 'openai', knowledgeCutoff: '2025-11-30', releaseDate: '2026-04-02', openWeights: false, toolCall: true, structuredOutput: true, temperature: true, attachment: true, contextLimit: 200_000, outputLimit: 32_000},
    'anthropic:~anthropic/claude-sonnet-4-5': {description: 'Balanced model for coding agents and careful analysis.', family: 'claude-sonnet', lab: 'anthropic', knowledgeCutoff: '2025-08-31', releaseDate: '2026-02-17', openWeights: false, toolCall: true, structuredOutput: true, temperature: true, attachment: true, contextLimit: 200_000, outputLimit: 16_000},
    'openrouter:google/gemini-3.1-pro-preview': {description: 'Long-context multimodal preview model.', family: 'gemini-3.1', lab: 'google', releaseDate: '2026-03-05', openWeights: false, toolCall: true, contextLimit: 1_000_000, outputLimit: 65_536},
  };
  const demoKeys = new Map<string, ProviderDto['apiKeys']>([['openai', [{id: 'openai-key-1', label: 'sk-p••••demo', active: true, status: 'ready'}]]]);
  const demoProviders: ProviderDto[] = [
    {id: 'openai', name: 'OpenAI', apiKeyLabel: 'OpenAI API key', supportsOAuth: false, storedCredential: true, configured: true, source: '1 saved API key', modelCount: 2, custom: false, apiKeys: []},
    {id: 'anthropic', name: 'Anthropic', apiKeyLabel: 'Anthropic API key', supportsOAuth: true, storedCredential: false, configured: false, source: null, modelCount: 2, custom: false, apiKeys: []},
    {id: 'openrouter', name: 'OpenRouter', apiKeyLabel: 'OpenRouter API key', supportsOAuth: false, storedCredential: false, configured: false, source: null, modelCount: 1, custom: false, apiKeys: []},
  ];
  const demoSkills: SkillDto[] = [
    {name: 'documents', description: 'Create and edit document files.', source: 'midas', filePath: '~/.midas/skills/documents/SKILL.md', disableModelInvocation: false, allowedTools: ['read', 'write'], enabled: true, editable: true, instructions: 'Create and edit document files.'},
    {name: 'personal-research', description: 'Personal research workflow.', source: 'codex', filePath: '~/.codex/skills/personal-research/SKILL.md', disableModelInvocation: false, allowedTools: ['read'], enabled: true, editable: false},
    {name: 'pdf', description: 'Read, create, and edit PDF files.', source: 'official', filePath: '/skills/official/pdf/SKILL.md', disableModelInvocation: false, allowedTools: ['read', 'write', 'bash'], enabled: true, editable: false},
    {name: 'browser', description: 'Research and interact with websites.', source: 'official', filePath: '/skills/official/browser/SKILL.md', iconDataUrl: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22%3E%3Ccircle cx=%2216%22 cy=%2216%22 r=%2211%22 fill=%22none%22 stroke=%22%23666%22 stroke-width=%222%22/%3E%3C/svg%3E', disableModelInvocation: false, allowedTools: ['read', 'bash'], enabled: true, editable: false},
  ];
  const demoMcpServers: McpServerDto[] = [
    {id: 'filesystem', name: 'Filesystem', source: 'midas', editable: true, enabled: true, transport: 'stdio', status: 'connected', toolNames: ['list_files'], resourceUris: [], promptNames: [], command: 'node', args: ['server.mjs']},
  ];
  let demoChronicleEnabled = true;
  let demoGeneral: GeneralSettingsDto = {
    theme: 'light',
    // Pinned rather than null: a null here falls through to the locale
    // default, which makes the demo — and every UI test — depend on the
    // machine's timezone (this machine resolves to SGD).
    currency: 'USD',
    speechModeEnabled: true,
    timeEnabled: true,
    locationEnabled: true,
    location: null,
  };

  const api: MidasApi = {
    general: {
      get: async () => structuredClone(demoGeneral),
      update: async (settings) => {
        demoGeneral = {
          ...demoGeneral,
          ...settings,
          location:
            settings.locationEnabled === false
              ? null
              : settings.location === undefined
                ? demoGeneral.location
                : settings.location,
        };
        return structuredClone(demoGeneral);
      },
    },
    permissions: {
      status: async () => 'granted',
      request: async () => 'granted',
      openSettings: async () => {},
    },
    conversations: {
      list: async () => [...conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      create: async (title = 'New chat') => {
        const created = conversation(crypto.randomUUID(), title, Date.now());
        conversations = [created, ...conversations];
        messages.set(created.id, []);
        return created;
      },
      rename: async (id, title) => {
        const current = conversations.find((item) => item.id === id);
        if (!current) return null;
        const updated = {...current, title, updatedAt: new Date().toISOString()};
        conversations = conversations.map((item) => item.id === id ? updated : item);
        return updated;
      },
      remove: async (id) => {
        const before = conversations.length;
        conversations = conversations.filter((item) => item.id !== id);
        messages.delete(id);
        goals.delete(id);
        addedReferences.delete(id);
        return conversations.length !== before;
      },
      messages: async (id) => structuredClone(messages.get(id) ?? []),
      updateMessage: async (id, patch) => {
        for (const [conversationId, items] of messages) {
          const index = items.findIndex((item) => item.id === id);
          if (index < 0) continue;
          const updated = {...items[index]!, ...patch};
          messages.set(conversationId, items.map((item) => item.id === id ? updated : item));
          return structuredClone(updated);
        }
        return null;
      },
    },
    runs: {
      start: async (request) => startDemoRun(request),
      cancel: async (runId) => finishDemoRun(runId, 'run.cancelled'),
      steer: async (runId, text, messageId) => {
        const conversationId = runConversations.get(runId);
        if (!conversationId) throw new Error(`Run is not active: ${runId}`);
        const items = messages.get(conversationId) ?? [];
        items.push(message(messageId ?? crypto.randomUUID(), conversationId, 'user', text, Date.now(), runId));
        messages.set(conversationId, items);
        emit(runId, conversationId, 'steer.accepted', {message: {role: 'user', content: text}});
      },
      events: async () => [],
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    },
    goals: {
      execute: async (request) => {
        if (request.action === 'clear') { goals.delete(request.conversationId); return null; }
        const current = goals.get(request.conversationId);
        if (request.action === 'view') return current ?? null;
        if (request.action === 'create') {
          const created = goal(request.conversationId, request.objective!);
          goals.set(request.conversationId, created);
          return created;
        }
        if (!current) throw new Error('No goal exists for this conversation');
        const updated = request.action === 'update'
          ? {...current, objective: request.objective!, updatedAt: new Date().toISOString()}
          : {...current, status: request.action === 'pause' ? 'paused' as const : 'active' as const, updatedAt: new Date().toISOString()};
        goals.set(request.conversationId, updated);
        return updated;
      },
      get: async (conversationId) => goals.get(conversationId) ?? null,
    },
    files: {paths: async (files) => files.map((file) => file.name)},
    resources: {
      artifacts: async (conversationId) => demoArtifacts(conversationId),
      references: async (conversationId) => [...demoReferences(conversationId), ...(addedReferences.get(conversationId) ?? [])],
      addFiles: async (conversationId, files) => {
        const created = files.map((file): ReferenceDto => ({
          id: crypto.randomUUID(),
          conversationId,
          runId: null,
          kind: 'file',
          title: file.name,
          uri: file.name,
          createdAt: new Date().toISOString(),
          metadata: {mimeType: file.type || null, size: file.size},
        }));
        addedReferences.set(conversationId, [...(addedReferences.get(conversationId) ?? []), ...created]);
        return created;
      },
    },
    memory: {
      status: async () => ({
        directory: '/demo/memories',
        registryPath: '/demo/memories/MEMORY.md',
        summaryPath: '/demo/memories/memory_summary.md',
        memories: 2,
        userMemories: 2,
        conversationMemories: 0,
        rolloutSummaries: 4,
        latestMemoryAt: new Date().toISOString(),
        latestRolloutAt: new Date().toISOString(),
      }),
      list: async () => [],
      remember: async (content, conversationId) => ({id: crypto.randomUUID(), scope: conversationId ? 'conversation' : 'user', scopeId: conversationId ?? null, kind: 'learning', content, confidence: 1, updatedAt: new Date().toISOString()}),
      forget: async () => true,
    },
    chronicle: {
      status: async () => ({
        enabled: demoChronicleEnabled,
        running: demoChronicleEnabled,
        directory: '/demo/chronicle',
        lastCapturedAt: null,
        lastError: null,
        storedFrames: 0,
        storedBytes: 0,
      }),
      setEnabled: async (enabled) => {
        demoChronicleEnabled = enabled;
        return {
          enabled,
          running: enabled,
          directory: '/demo/chronicle',
          lastCapturedAt: null,
          lastError: null,
          storedFrames: 0,
          storedBytes: 0,
        };
      },
      entries: async () => [],
    },
    mcp: {
      list: async () => demoMcpServers,
      reload: async () => demoMcpServers,
      setEnabled: async (id, enabled) => {
        const item = demoMcpServers.find((candidate) => candidate.id === id);
        if (item) { item.enabled = enabled; item.status = enabled ? 'connected' : 'disconnected'; }
        return demoMcpServers;
      },
      saveCustom: async (request) => {
        const item = demoMcpServers.find((candidate) => candidate.id === request.id);
        const next: McpServerDto = {...request, source: 'midas', editable: true, enabled: item?.enabled ?? true, status: item?.status ?? 'disconnected', toolNames: item?.toolNames ?? [], resourceUris: [], promptNames: []};
        if (item) Object.assign(item, next); else demoMcpServers.push(next);
        return demoMcpServers;
      },
      subscribe: () => () => {},
    },
    skills: {
      list: async () => demoSkills,
      reload: async () => demoSkills,
      setEnabled: async (name, enabled) => {
        const item = demoSkills.find((candidate) => candidate.name === name);
        if (item) item.enabled = enabled;
        return demoSkills;
      },
      saveCustom: async (request) => {
        const index = demoSkills.findIndex((candidate) => candidate.name === (request.originalName ?? request.name));
        const next: SkillDto = {name: request.name, description: request.description, instructions: request.instructions, source: 'midas', filePath: `~/.midas/skills/${request.name}/SKILL.md`, disableModelInvocation: false, allowedTools: [], enabled: index >= 0 ? demoSkills[index]!.enabled : true, editable: true};
        if (index >= 0) demoSkills.splice(index, 1, next); else demoSkills.push(next);
        return demoSkills;
      },
    },
    models: {
      list: async () => demoModels,
      select: async (provider, id) => {
        const selected = demoModels.find((model) => model.provider === provider && model.id === id);
        if (!selected) throw new Error(`Unknown model: ${provider}/${id}`);
        const providerState = demoProviders.find((item) => item.id === provider);
        if (providerState && !providerWithKeys(providerState).configured)
          throw new Error(`${providerState.name} is not configured. Add its API key in Options → Provider, or choose a configured model.`);
        demoModels = demoModels.map((model) => ({...model, selected: model === selected}));
        return demoModels.find((model) => model.selected)!;
      },
      // The browser demo has no main process to reach models.dev through, so
      // it exercises the "catalogue knows nothing" path the real app falls
      // back to when offline.
      metadata: async () => demoModelMetadata,
    },
    providers: {
      list: async () => demoProviders.map((provider) => providerWithKeys(provider)),
      saveApiKey: async (provider, apiKey) => {
        const item = demoProviders.find((candidate) => candidate.id === provider);
        if (!item) throw new Error(`Unknown provider: ${provider}`);
        if (!apiKey.trim()) throw new Error('API key is required');
        const keys = demoKeys.get(provider) ?? [];
        keys.push({id: crypto.randomUUID(), label: `${apiKey.slice(0, 4)}••••${apiKey.slice(-4)}`, active: keys.length === 0, status: 'ready'});
        demoKeys.set(provider, keys);
        return providerWithKeys(item);
      },
      removeApiKey: async (provider, keyId) => {
        const item = demoProviders.find((candidate) => candidate.id === provider);
        if (!item) throw new Error(`Unknown provider: ${provider}`);
        const keys = (demoKeys.get(provider) ?? []).filter((key) => key.id !== keyId);
        if (keys.length && !keys.some((key) => key.active)) keys[0]!.active = true;
        demoKeys.set(provider, keys);
        return providerWithKeys(item);
      },
      createCustom: async (request) => {
        const id = request.name.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || crypto.randomUUID();
        if (demoProviders.some((provider) => provider.id === id)) throw new Error(`Provider already exists: ${request.name}`);
        const provider: ProviderDto = {
          id, name: request.name.trim(), apiKeyLabel: `${request.name.trim()} API key`, supportsOAuth: false,
          logoDataUrl: request.logoDataUrl, baseUrl: request.baseUrl,
          storedCredential: Boolean(request.apiKey), configured: true,
          source: request.apiKey ? '1 saved API key' : 'Custom endpoint', modelCount: request.models.length, custom: true, apiKeys: [],
        };
        demoProviders.push(provider);
        demoModels = [...demoModels, ...request.models.map((model) => ({
          provider: id, id: model.id, name: model.name?.trim() || model.id,
          contextWindow: 0, maxOutputTokens: 0, reasoning: false, input: ['text' as const],
          cost: {input: null, output: null, cacheRead: null, cacheWrite: null}, selected: false, custom: true,
        }))];
        if (request.apiKey) demoKeys.set(id, [{id: crypto.randomUUID(), label: `${request.apiKey.slice(0, 4)}••••${request.apiKey.slice(-4)}`, active: true, status: 'ready'}]);
        return providerWithKeys(provider);
      },
      updateCustom: async (request) => {
        const provider = demoProviders.find((candidate) => candidate.id === request.id && candidate.custom);
        if (!provider) throw new Error(`Unknown custom provider: ${request.id}`);
        provider.name = request.name.trim();
        provider.baseUrl = request.baseUrl;
        provider.logoDataUrl = request.logoDataUrl;
        provider.modelCount = request.models.length;
        const selectedId = demoModels.find((model) => model.provider === request.id && model.selected)?.id;
        demoModels = [
          ...demoModels.filter((model) => model.provider !== request.id),
          ...request.models.map((model, index) => ({
            provider: request.id, id: model.id, name: model.name?.trim() || model.id,
            contextWindow: 0, maxOutputTokens: 0, reasoning: false, input: ['text' as const],
            cost: {input: null, output: null, cacheRead: null, cacheWrite: null},
            selected: selectedId ? model.id === selectedId : index === 0, custom: true,
          })),
        ];
        return providerWithKeys(provider);
      },
    },
  };

  function providerWithKeys(provider: ProviderDto): ProviderDto {
    const apiKeys = demoKeys.get(provider.id) ?? [];
    return {...provider, apiKeys: structuredClone(apiKeys), storedCredential: apiKeys.length > 0, configured: provider.custom || apiKeys.length > 0, source: apiKeys.length ? `${apiKeys.length} saved API ${apiKeys.length === 1 ? 'key' : 'keys'}` : provider.custom ? 'Custom endpoint' : null};
  }

  function startDemoRun(request: StartRunRequest): {runId: string} {
    const runId = crypto.randomUUID();
    const timestamp = Date.now();
    runConversations.set(runId, request.conversationId);
    const items = messages.get(request.conversationId) ?? [];
    items.push(message(request.messageId ?? crypto.randomUUID(), request.conversationId, 'user', request.text, timestamp, null, {asGoal: request.asGoal ?? false}));
    messages.set(request.conversationId, items);
    if (request.asGoal) goals.set(request.conversationId, goal(request.conversationId, request.text));
    emit(runId, request.conversationId, 'run.started', {});
    emit(runId, request.conversationId, 'run.state', {status: 'running'});
    emit(runId, request.conversationId, 'message.reasoning.delta', {delta: 'Thinking'});
    // Exercises the real failed-run UI without persisting a fake assistant
    // response; production Electron runs never use this browser demo adapter.
    if (request.text === '__demo_provider_failure__') {
      timers.set(runId, setTimeout(() => {
        timers.delete(runId);
        runConversations.delete(runId);
        emit(runId, request.conversationId, 'run.failed', {
          result: {error: {message: 'OpenCode Go is not configured. Add its API key in Options → Provider, or choose a configured model.'}},
        });
        queueMicrotask(() => emit(runId, request.conversationId, 'run.settled', {}));
      }, 50));
      return {runId};
    }
    if (request.text === '__demo_auth_failure__') {
      timers.set(runId, setTimeout(() => {
        timers.delete(runId);
        runConversations.delete(runId);
        emit(runId, request.conversationId, 'run.failed', {
          result: {error: {message: '401: {"message":"Missing Authentication header","code":401}'}},
        });
        queueMicrotask(() => emit(runId, request.conversationId, 'run.settled', {}));
      }, 50));
      return {runId};
    }
    timers.set(runId, setTimeout(() => {
      const text = 'This is the assembled Midas chat surface. Connect the send handler to your agent backend when it is ready.';
      emit(runId, request.conversationId, 'message.text.delta', {delta: text});
      emit(runId, request.conversationId, 'message.completed', {message: {role: 'assistant', content: [{type: 'text', text}]}});
      items.push(message(crypto.randomUUID(), request.conversationId, 'assistant', [{type: 'text', text}], Date.now(), runId));
      finishDemoRun(runId, 'run.completed');
    }, 900));
    return {runId};
  }

  function finishDemoRun(runId: string, type: 'run.completed' | 'run.cancelled'): void {
    const conversationId = runConversations.get(runId);
    if (!conversationId) return;
    const timer = timers.get(runId);
    if (timer) clearTimeout(timer);
    timers.delete(runId);
    runConversations.delete(runId);
    emit(runId, conversationId, type, {});
    queueMicrotask(() => emit(runId, conversationId, 'run.settled', {}));
  }

  function emit(runId: string, conversationId: string, type: string, body: Record<string, JsonValue>): void {
    const event: RunEventDto = {runId, conversationId, sequence: 0, timestamp: Date.now(), type, payload: {runId, conversationId, sequence: 0, timestamp: Date.now(), type, ...body}};
    for (const listener of listeners) listener(event);
  }

  return api;
}

function conversation(id: string, title: string, timestamp: number): ConversationDto {
  const date = new Date(timestamp).toISOString();
  return {id, title, createdAt: date, updatedAt: date, archivedAt: null};
}

function message(id: string, conversationId: string, role: MessageDto['role'], content: JsonValue, timestamp: number, runId: string | null = null, metadata: JsonValue = {}): MessageDto {
  return {id, conversationId, runId, role, content, createdAt: new Date(timestamp).toISOString(), sequence: 0, attachments: [], metadata};
}

function goal(conversationId: string, objective: string): GoalDto {
  const date = new Date().toISOString();
  return {id: crypto.randomUUID(), conversationId, objective, status: 'active', createdAt: date, updatedAt: date, completedAt: null};
}

function demoArtifacts(conversationId: string): ArtifactDto[] {
  return [{id: 'launch-brief', conversationId, runId: null, kind: 'document', name: 'Launch brief.docx', path: '/tmp/Launch brief.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), metadata: {}}];
}

function demoReferences(conversationId: string): ReferenceDto[] {
  return [{id: 'polymux-site', conversationId, runId: null, kind: 'web', title: 'polymux.com', uri: 'https://polymux.com', createdAt: new Date().toISOString(), metadata: {}}];
}
