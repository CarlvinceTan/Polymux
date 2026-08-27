import type {
  ArtifactDto,
  ChatDto,
  ChatMessageDto,
  ComputerHistoryStatusDto,
  CommsEmailAccountDto,
  CommsStatusDto,
  DiscoveredMcpGroupDto,
  DiscoveredSkillGroupDto,
  BrowserDownloadDto,
  BrowserHistoryEntryDto,
  BrowserSettingsDto,
  BrowserSiteDto,
  BrowserSourceDto,
  DriveEntryDto,
  DriveProviderId,
  DriveStatusDto,
  MailEnvelopeDto,
  MailFolderDto,
  WorkspaceRevealDto,
  WorkspaceSnapshotDto,
  ConversationDto,
  GoalDto,
  GeneralSettingsDto,
  JsonValue,
  McpServerDto,
  SavedLoginDto,
  SitePermissionDto,
  MessageDto,
  PolymuxApi,
  ModelDto,
  ModelMetadataDto,
  ModelRole,
  ModelRoleAssignmentDto,
  ModelRolesDto,
  ProviderDto,
  ReasoningEffort,
  ReferenceDto,
  RunEventDto,
  ScheduleDto,
  MarketplacePluginDto,
  PluginDto,
  PluginMarketplaceDto,
  SkillDto,
  StartRunRequest,
} from '@polymux/protocol';
import {LOCAL_RUNTIMES, parseDriveSourceId} from '@polymux/protocol';
import {EXTENSION_INSTALL_URL} from '../../../shared/extension';

let browserApi: PolymuxApi | undefined;

export function polymuxApi(): PolymuxApi {
  if (typeof window !== 'undefined' && window.polymux) return window.polymux;
  if (import.meta.env.DEV || import.meta.env.VITE_POLYMUX_BROWSER_DEMO === 'true')
    return browserApi ??= createBrowserDemoApi();
  throw new Error('The Polymux desktop bridge is unavailable. Open this build through the desktop app.');
}

/** A development-only adapter keeps browser-based component tests useful. The
 * packaged desktop never selects it because preload supplies `window.polymux`. */
function createBrowserDemoApi(): PolymuxApi {
  // The dev branch always represents an already-configured profile.
  const onboardingPreview = false;
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
  let demoProfiles = [{id: 'default', name: 'Default Profile', isDefault: true}];
  let demoActiveProfile = 'default';
  let demoRoleOverrides: Partial<Record<ModelRole, {provider: string; id: string; reasoning?: ReasoningEffort}>> = {};
  const demoRoles = (): ModelRolesDto => {
    const assignment = (ref?: {provider: string; id: string; reasoning?: ReasoningEffort}): ModelRoleAssignmentDto | null => {
      const model = ref && demoModels.find((item) => item.provider === ref.provider && item.id === ref.id);
      if (!model) return null;
      const reasoning = model.reasoning ? ref?.reasoning : undefined;
      return {provider: model.provider, id: model.id, name: model.name, ...(reasoning ? {reasoning} : {})};
    };
    const main = demoModels.find((item) => item.selected);
    // Main's level lives in the general settings, the same place the composer
    // reads it from, so the two can never disagree.
    return {
      main: assignment(main && {provider: main.provider, id: main.id, reasoning: demoGeneral.reasoningLevel}),
      subagent: assignment(demoRoleOverrides.subagent),
      judge: assignment(demoRoleOverrides.judge),
      compaction: assignment(demoRoleOverrides.compaction),
      speech: assignment(demoRoleOverrides.speech),
      image: assignment(demoRoleOverrides.image),
      video: assignment(demoRoleOverrides.video),
    };
  };
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
  const demoKeys = new Map<string, ProviderDto['apiKeys']>(
    onboardingPreview
      ? []
      : [['openai', [{id: 'openai-key-1', label: 'sk-p••••demo', active: true, status: 'ready'}]]],
  );
  const demoProviders: ProviderDto[] = [
    {id: 'openai', name: 'OpenAI', apiKeyLabel: 'OpenAI API key', supportsOAuth: false, storedCredential: true, configured: true, source: '1 saved API key', modelCount: 2, custom: false, apiKeys: []},
    {id: 'anthropic', name: 'Anthropic', apiKeyLabel: 'Anthropic API key', supportsOAuth: true, storedCredential: false, configured: false, source: null, modelCount: 2, custom: false, apiKeys: []},
    {id: 'openrouter', name: 'OpenRouter', apiKeyLabel: 'OpenRouter API key', supportsOAuth: false, storedCredential: false, configured: false, source: null, modelCount: 1, custom: false, apiKeys: []},
    ...LOCAL_RUNTIMES.map((runtime) => ({
      id: runtime.id, name: runtime.name, baseUrl: runtime.baseUrl, apiKeyLabel: null,
      supportsOAuth: false, storedCredential: false, configured: false, source: null,
      modelCount: 0, custom: true, localRuntime: true, apiKeys: [],
    })),
  ];
  const demoSkills: SkillDto[] = [
    {name: 'documents', description: 'Create and edit document files.', source: 'polymux', filePath: '~/.polymux/skills/documents/SKILL.md', disableModelInvocation: false, allowedTools: ['read', 'write'], permissions: [], enabled: true, editable: true, instructions: 'Create and edit document files.', updatedAt: '2026-07-02T09:30:00.000Z'},
    {name: 'personal-research', description: 'Personal research workflow.', source: 'polymux', filePath: '~/.polymux/skills/personal-research/SKILL.md', disableModelInvocation: false, allowedTools: ['read'], permissions: [], enabled: true, editable: true, instructions: 'Personal research workflow.', updatedAt: '2026-05-18T14:00:00.000Z'},
    {name: 'pdf', description: 'Read, create, and edit PDF files.', source: 'official', filePath: '/skills/official/pdf/SKILL.md', disableModelInvocation: false, allowedTools: ['read', 'write', 'bash'], permissions: [], enabled: true, editable: false, displayName: 'PDF', author: 'Polymux', category: 'Documents', updatedAt: '2026-08-01T08:00:00.000Z'},
    // No core integration here: browser/GUI control and the Hub's email and
    // messaging skills are first-class surfaces and never list as add-ons.
    {name: 'spreadsheets', description: 'Create, analyze, and edit spreadsheets.', source: 'official', filePath: '/skills/official/spreadsheets/SKILL.md', disableModelInvocation: false, allowedTools: ['read', 'write', 'bash'], permissions: [], enabled: true, editable: false, displayName: 'Spreadsheets', author: 'Polymux', category: 'Documents', updatedAt: '2026-08-01T08:00:00.000Z'},
  ];
  const demoPlugins: PluginDto[] = [
    {
      id: 'claude-code/code-review',
      name: 'code-review',
      description: 'Automated code review for pull requests using several specialised agents.',
      version: '1.0.0',
      author: 'Anthropic',
      marketplace: 'claude-code',
      marketplaceName: 'claude-code-plugins',
      directory: '~/.polymux/plugins/claude-code/code-review',
      enabled: true,
      contributions: {skills: ['review-diff'], mcpServers: [], commands: 1, agents: 3, hooks: 0},
      conflicts: [],
    },
    {
      id: 'claude-code/pdf-tools',
      name: 'pdf-tools',
      description: 'Read and rewrite PDFs from a chat.',
      version: '0.4.2',
      author: 'Anthropic',
      marketplace: 'claude-code',
      marketplaceName: 'claude-code-plugins',
      directory: '~/.polymux/plugins/claude-code/pdf-tools',
      enabled: false,
      contributions: {skills: ['pdf'], mcpServers: ['pdf-server'], commands: 0, agents: 0, hooks: 2},
      // A name the demo's own skills already carry, so the warning has
      // something true to point at.
      conflicts: [{kind: 'skill', name: 'pdf', existingSource: 'official'}],
    },
  ];
  const demoMarketplaces: PluginMarketplaceDto[] = [
    {id: 'claude-code', name: 'claude-code-plugins', source: 'anthropics/claude-code', pluginCount: 3, builtin: true},
  ];
  const demoCatalog: MarketplacePluginDto[] = [
    {id: 'claude-code/code-review', name: 'code-review', description: 'Automated code review for pull requests.', version: '1.0.0', author: 'Anthropic', installed: true},
    {id: 'claude-code/pdf-tools', name: 'pdf-tools', description: 'Read and rewrite PDFs from a chat.', version: '0.4.2', author: 'Anthropic', installed: true},
    {id: 'claude-code/commit-commands', name: 'commit-commands', description: 'Commit workflows, written as commands.', version: '1.1.0', author: 'Anthropic', installed: false},
  ];
  const demoDiscoveredSkills: DiscoveredSkillGroupDto[] = [
    {id: 'claude', label: 'Claude', directory: '~/.claude/skills', skills: [
      {name: 'commit-writer', description: 'Write commit messages from a diff.', path: '~/.claude/skills/commit-writer', state: 'available'},
      {name: 'pdf', description: 'Read, create, and edit PDF files.', path: '~/.claude/skills/pdf', state: 'loaded'},
    ]},
    {id: 'codex', label: 'Codex', directory: '~/.codex/skills', skills: [
      {name: 'repo-map', description: 'Summarize an unfamiliar repository.', path: '~/.codex/skills/repo-map', state: 'available'},
    ]},
    {id: 'agents', label: 'Shared skills', directory: '~/.agents/skills', skills: [
      {name: 'find-skills', description: 'Search the skills directory.', path: '~/.agents/skills/find-skills', state: 'loaded'},
    ]},
  ];
  const demoDiscoveredMcp: DiscoveredMcpGroupDto[] = [
    {id: 'claude:claude_desktop_config.json', label: 'Claude', path: '~/Library/Application Support/Claude/claude_desktop_config.json', servers: [
      {id: 'memory', name: 'Memory', description: 'Remember facts across chats.', transport: 'stdio', target: 'npx', source: 'claude', path: '~/Library/Application Support/Claude/claude_desktop_config.json', state: 'available'},
    ]},
    {id: 'codex:config.toml', label: 'Codex', path: '~/.codex/config.toml', servers: [
      {id: 'filesystem', name: 'Filesystem', description: 'Access local files and directories.', transport: 'stdio', target: 'node', source: 'codex', path: '~/.codex/config.toml', state: 'loaded'},
      {id: 'linear', name: 'Linear', transport: 'streamable-http', target: 'https://mcp.linear.app/sse', source: 'codex', path: '~/.codex/config.toml', state: 'available'},
    ]},
  ];
  const demoMcpServers: McpServerDto[] = [
    {id: 'filesystem', name: 'Filesystem', description: 'Access local files and directories.', source: 'polymux', editable: true, enabled: true, transport: 'stdio', status: 'connected', toolNames: ['list_files'], resourceUris: ['filesystem://documents'], promptNames: [], command: 'node', args: ['server.mjs']},
    {id: 'github', name: 'GitHub', description: 'Read repositories, issues, and pull requests.', source: 'official', editable: false, enabled: true, transport: 'stdio', status: 'connected', toolNames: ['list_issues', 'get_pull_request'], resourceUris: [], promptNames: [], command: 'node', args: ['github.mjs']},
  ];
  const demoCommsStatus: CommsStatusDto = {
    hub: {
      baseUrl: 'http://127.0.0.1:18080',
      homeserverUrl: 'http://127.0.0.1:8008',
      canAutoConnect: onboardingPreview,
      directory: '~/Library/Application Support/matrix-hub',
      status: onboardingPreview ? 'reachable' : 'signed-in',
      userId: onboardingPreview ? null : '@demo:localhost',
      homeserverName: 'localhost',
      error: null,
    },
    bridges: [
      {platform: 'whatsapp', name: 'WhatsApp', api: 'bridgev2', state: onboardingPreview ? 'logged-out' : 'connected', accounts: onboardingPreview ? [] : [{id: 'wa1', name: '+61 400 000 000', state: 'connected', error: null}], flows: onboardingPreview ? [{id: 'qr', name: 'QR Code', description: 'Scan a QR code to pair the bridge to your WhatsApp account'}, {id: 'phone', name: 'Pairing code', description: 'Enter your phone number and type the code WhatsApp shows into your phone'}] : [], setup: null, managementRoomHint: null, error: null},
      {platform: 'telegram', name: 'Telegram', api: 'bridgev2', state: 'logged-out', accounts: [], flows: [{id: 'phone', name: 'Phone Number', description: 'Login using your Telegram phone number'}, {id: 'qr', name: 'QR Code', description: 'Login by scanning a QR code from your phone'}], setup: {fields: [{id: 'api_id', name: 'API ID', description: 'The numeric ID of your Telegram application.', helpUrl: 'https://my.telegram.org/apps', secret: false}, {id: 'api_hash', name: 'API hash', description: 'The hash shown next to it.', helpUrl: 'https://my.telegram.org/apps', secret: true}], configured: false}, managementRoomHint: null, error: null},
      {platform: 'signal', name: 'Signal', api: 'bridgev2', state: 'logged-out', accounts: [], flows: [{id: 'qr', name: 'QR Code', description: 'Link this Mac as a Signal device by scanning a QR code'}], setup: null, managementRoomHint: null, error: null},
      {platform: 'slack', name: 'Slack', api: 'bridgev2', state: 'logged-out', accounts: [], flows: [{id: 'token', name: 'Token', description: 'Sign in with a Slack token pair'}], setup: null, managementRoomHint: null, error: null},
      {platform: 'googlechat', name: 'Google Chat', api: 'bridgev2', state: 'logged-out', accounts: [], flows: [{id: 'cookies', name: 'Google login', description: 'Sign in to your Google account'}], setup: null, managementRoomHint: null, error: null},
      {platform: 'gmessages', name: 'Google Messages', api: 'bridgev2', state: 'logged-out', accounts: [], flows: [{id: 'qr', name: 'QR Code', description: 'Pair with Messages for web by scanning a QR code'}], setup: null, managementRoomHint: null, error: null},
      {platform: 'twitter', name: 'X', api: 'bridgev2', state: 'logged-out', accounts: [], flows: [{id: 'cookies', name: 'x.com', description: 'Login using cookies from x.com'}], setup: null, managementRoomHint: null, error: null},
      {platform: 'bluesky', name: 'Bluesky', api: 'bridgev2', state: 'logged-out', accounts: [], flows: [{id: 'password', name: 'App password', description: 'Sign in with a Bluesky app password'}], setup: null, managementRoomHint: null, error: null},
      {platform: 'gvoice', name: 'Google Voice', api: 'bridgev2', state: 'unreachable', accounts: [], flows: [], setup: null, managementRoomHint: null, error: 'mautrix-gvoice is not installed on this Mac.'},
      {platform: 'zulip', name: 'Zulip', api: 'bridgev2', state: 'logged-out', accounts: [], flows: [{id: 'apitoken', name: 'API token', description: 'Login with your Zulip email and API token'}], setup: null, managementRoomHint: null, error: null},
      {platform: 'messenger', name: 'Messenger', api: 'bridgev2', state: 'logged-out', accounts: [], flows: [{id: 'messenger', name: 'messenger.com', description: 'Login using cookies from messenger.com'}], setup: null, managementRoomHint: null, error: null},
      {platform: 'instagram', name: 'Instagram', api: 'bridgev2', state: 'connected', accounts: [{id: 'ig1', name: '@carl.builds', state: 'connected', error: null}, {id: 'ig2', name: '@polymux', state: 'connected', error: null}], flows: [{id: 'instagram', name: 'instagram.com', description: 'Login using cookies from instagram.com'}], setup: null, managementRoomHint: null, error: null},
      {platform: 'discord', name: 'Discord', api: 'bridgev2', state: 'logged-out', accounts: [], flows: [{id: 'qr', name: 'QR Code', description: 'Scan a QR code with the Discord app'}, {id: 'token', name: 'Token', description: 'Paste a Discord account token to link it'}], setup: null, managementRoomHint: null, error: null},
      {platform: 'linkedin', name: 'LinkedIn', api: 'bridgev2', state: 'logged-out', accounts: [], flows: [{id: 'cookies', name: 'Cookies', description: 'Log in with your LinkedIn account using your cookies'}], setup: null, managementRoomHint: null, error: null},
      {platform: 'imessage', name: 'iMessage', api: 'bridgev2', state: 'logged-out', accounts: [], flows: [{id: 'local', name: 'This Mac', description: 'Read the Messages database on this Mac'}], setup: null, managementRoomHint: null, error: null},
      // No bridge to log in to: a relay against the WeChat app on this Mac,
      // reporting whichever account that app is already signed in as — and
      // only once it is delivering into Polymux's own hub.
      {platform: 'wechat', name: 'WeChat', api: 'none', state: 'unavailable', accounts: [], flows: [], setup: null, managementRoomHint: null, error: 'The WeChat relay on this Mac is running, but it is not connected to Polymux’s own hub, so nothing it carries reaches here.'},
    ],
    email: {
      // The demo shows the buttons: it stands in for a build with clients
      // registered, which is what the Hub tab looks like once they are.
      signInProviders: ['google', 'microsoft'],
      accounts: onboardingPreview
        ? []
        : [
            {id: 'personal', displayName: 'Demo User', email: 'demo@example.com', isDefault: true, incoming: {kind: 'imap', host: 'imap.gmail.com', port: 993, encryption: 'tls', login: 'demo@example.com', auth: 'command'}, outgoing: {kind: 'smtp', host: 'smtp.gmail.com', port: 587, encryption: 'start-tls', login: 'demo@example.com', auth: 'command'}, secretStored: true, status: 'ok', error: null},
            {id: 'work', displayName: 'Demo At Work', email: 'demo@work.example', isDefault: false, incoming: {kind: 'imap', host: 'outlook.office365.com', port: 993, encryption: 'tls', login: 'demo@work.example', auth: 'oauth2'}, outgoing: {kind: 'smtp', host: 'smtp.office365.com', port: 587, encryption: 'start-tls', login: 'demo@work.example', auth: 'oauth2'}, secretStored: false, status: 'unknown', error: null},
            {id: 'team', displayName: null, email: 'team@example.co', isDefault: false, incoming: {kind: 'imap', host: 'imap.larksuite.com', port: 993, encryption: 'tls', login: 'team@example.co', auth: 'command'}, outgoing: {kind: 'smtp', host: 'smtp.larksuite.com', port: 465, encryption: 'tls', login: 'team@example.co', auth: 'command'}, secretStored: true, status: 'error', error: 'authentication failed'},
          ],
    },
  };
  /** Logins the user backed out of; their pending waits must go nowhere. */
  let demoLoginCancelled = 0;
  /** A finished login has to show up in the ring, or the demo ends on a lie. */
  const demoMarkLinked = (platform: string): void => {
    demoCommsStatus.bridges = demoCommsStatus.bridges.map((bridge) =>
      bridge.platform === platform
        ? {
            ...bridge,
            state: 'connected',
            accounts: [
              ...bridge.accounts,
              {id: `demo-${platform}`, name: 'Demo account', state: 'connected', error: null},
            ],
          }
        : bridge,
    );
  };
  // Newest first with unread counts, the way the hub now returns them.
  const demoRevealListeners = new Set<(request: WorkspaceRevealDto) => void>();
  (window as unknown as {polymuxDemoReveal?: (request: WorkspaceRevealDto) => void}).polymuxDemoReveal =
    (request) => demoRevealListeners.forEach((listener) => listener(request));
  let demoChats: ChatDto[] = [
    {id: '!wa-jules:local', name: 'Jules Tan', platform: 'whatsapp', unread: 2, lastActivity: new Date(now - 3_500_000).toISOString(), preview: 'Yes — 2pm works.', group: false, avatarUrl: null},
    {id: '!tg-devs:local', name: 'Dev Chat', platform: 'telegram', unread: 0, lastActivity: new Date(now - 7_200_000).toISOString(), preview: 'Shipped the build, logs look clean.', group: true, avatarUrl: null},
    {id: '!wa-family:local', name: 'Family', platform: 'whatsapp', unread: 0, lastActivity: new Date(now - 86_400_000).toISOString(), preview: 'Dinner Sunday?', group: true, avatarUrl: null},
  ];
  let demoChatMessages: ChatMessageDto[] = [
    {id: 'c1', chatId: '!wa-jules:local', sender: 'Jules Tan', body: 'Are we still on for Thursday?', sentAt: new Date(now - 3_600_000).toISOString(), mine: false},
    {id: 'c2', chatId: '!wa-jules:local', sender: 'You', body: 'Yes — 2pm works.', sentAt: new Date(now - 3_500_000).toISOString(), mine: true},
    {id: 'c3', chatId: '!wa-family:local', sender: 'Mum', body: 'Dinner Sunday?', sentAt: new Date(now - 86_400_000).toISOString(), mine: false},
    {id: 'c4', chatId: '!tg-devs:local', sender: 'Priya', body: 'Shipped the build, logs look clean.', sentAt: new Date(now - 7_200_000).toISOString(), mine: false},
    // A second message from the same person, close behind: a group names the
    // first of someone's run and lets the rest follow it.
    {id: 'c6', chatId: '!wa-family:local', sender: 'Mum', body: 'Roast if you can make it.', sentAt: new Date(now - 86_340_000).toISOString(), mine: false},
    {id: 'c7', chatId: '!wa-family:local', sender: 'Dad', body: 'I can bring dessert.', sentAt: new Date(now - 86_280_000).toISOString(), mine: false},
    // A sticker, which is carried as an image but drawn at a sticker's size.
    // A real 1x1 GIF, terminator and all. The bytes have to decode: the thread
    // now swaps an image the homeserver would not serve for a named chip, and
    // a truncated fixture is indistinguishable from one, so a placeholder that
    // merely looked like a GIF made the sticker vanish from the demo.
    {id: 'c5', chatId: '!wa-jules:local', sender: 'Jules Tan', body: '', sentAt: new Date(now - 3_400_000).toISOString(), mine: false, attachments: [{kind: 'image', url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', name: 'Sticker', mimeType: 'image/gif', size: 42, width: 240, height: 240, sticker: true}]},
  ];
  const demoMailFolders: MailFolderDto[] = [
    {name: 'INBOX', label: 'Inbox', role: 'inbox'},
    {name: '[Gmail]/Drafts', label: 'Drafts', role: 'drafts'},
    {name: '[Gmail]/Sent Mail', label: 'Sent Mail', role: 'sent'},
    {name: '[Gmail]/All Mail', label: 'All Mail', role: 'archive'},
    {name: '[Gmail]/Spam', label: 'Spam', role: 'junk'},
    {name: '[Gmail]/Trash', label: 'Trash', role: 'trash'},
  ];
  let demoEnvelopes: Array<{folder: string; body: string; html?: string; envelope: MailEnvelopeDto}> = [
    {folder: 'INBOX', body: 'The quarterly numbers are attached. Let me know if you want the breakdown by region before Thursday.', envelope: {id: '1', subject: 'Q3 numbers', from: {name: 'Priya Raman', address: 'priya@example.com'}, to: {name: null, address: 'demo@example.com'}, date: new Date(now - 5_400_000).toISOString(), seen: false, flagged: false, answered: false, draft: false, hasAttachment: true}},
    {folder: 'INBOX', body: 'Reminder that the office will be closed on Monday.', envelope: {id: '2', subject: 'Closed Monday', from: {name: 'Office', address: 'office@example.com'}, to: {name: null, address: 'demo@example.com'}, date: new Date(now - 90_000_000).toISOString(), seen: true, flagged: true, answered: false, draft: false, hasAttachment: false}},
    {folder: 'INBOX', body: 'Your invoice for August is ready to view.', html: '<div style="font-family:system-ui"><img src="cid:logo@example" alt="Billing"><img src="https://example.com/seal.png" alt="Paid"><h2 style="margin:0 0 8px">Invoice #1042</h2><p>Your invoice for August is <b>ready to view</b>.</p><table cellpadding="6" style="border-collapse:collapse"><tr><th align="left" style="border-bottom:1px solid #ddd">Item</th><th align="right" style="border-bottom:1px solid #ddd">Amount</th></tr><tr><td>Subscription</td><td align="right">$42.00</td></tr></table><p><a href="https://example.com/invoice/1042">View invoice</a></p></div>', envelope: {id: '3', subject: 'Invoice ready', from: {name: 'Billing', address: 'billing@example.com'}, to: {name: null, address: 'demo@example.com'}, date: new Date(now - 172_800_000).toISOString(), seen: true, flagged: false, answered: true, draft: false, hasAttachment: false}},
    {folder: '[Gmail]/Spam', body: 'You have definitely won a prize.', envelope: {id: '4', subject: 'YOU WON', from: {name: null, address: 'noreply@spam.example'}, to: null, date: new Date(now - 200_000_000).toISOString(), seen: false, flagged: false, answered: false, draft: false, hasAttachment: false}},
  ];
  const demoWorkspaceSnapshots = new Map<string, WorkspaceSnapshotDto>();
  let demoDictationPass = 0;
  let demoComputerHistoryEnabled = true;
  let demoComputerHistorySettings: Pick<
    ComputerHistoryStatusDto,
    'excludeApps' | 'excludeSites' | 'recordPrivateBrowsing' | 'interactionEvents'
  > = {
    excludeApps: [],
    excludeSites: [],
    recordPrivateBrowsing: true,
    interactionEvents: true,
  };
  const demoComputerHistoryStatus = (): ComputerHistoryStatusDto => ({
    ...demoComputerHistorySettings,
    enabled: demoComputerHistoryEnabled,
    running: demoComputerHistoryEnabled,
    directory: '/demo/computer-history',
    lastCapturedAt: null,
    lastError: null,
    storedFrames: 0,
    storedBytes: 0,
    storedEvents: 0,
    distilledThrough: null,
  });
  let demoMemoryEnabled = true;
  let demoGeneral: GeneralSettingsDto = {
    theme: 'light',
    language: 'system',
    // Pinned rather than null: a null here falls through to the locale
    // default, which makes the demo — and every UI test — depend on the
    // machine's timezone (this machine resolves to SGD).
    currency: 'USD',
    speechModeEnabled: true,
    // On, unlike the app's default: the Playwright suite drives the whole
    // settings surface, and basic mode hides half of it.
    advancedMode: true,
    dictationAutoStopSeconds: 6,
    timeEnabled: true,
    locationEnabled: true,
    hubIncognitoMode: false,
    reasoningLevel: 'medium',
    // The demo is a returning user; the Playwright suite drives the main UI,
    // not first-run setup. Flip to false to preview setup in the browser.
    onboardingCompleted: !onboardingPreview,
    permissions: {microphone: true, 'screen-recording': true, accessibility: true, 'full-disk-access': true, reminders: true, calendars: true, contacts: true, photos: true, automation: true},
    appPermissionsEnabled: true,
    notificationsEnabled: true,
    notifications: {'schedule-completed': true, 'schedule-failed': true, 'agent-completed': true, 'agent-attention': true, 'message-received': true},
    pinnedViews: [],
    location: null,
  };

  const demoUpdate = {
    status: 'unsupported' as const,
    version: '0.1.0',
    latest: null,
    checkedAt: '2026-08-14T00:00:00.000Z',
    message: 'Updates are managed by the desktop app.',
  };

  // The demo has no way to observe a real extension, so it reports installed
  // rather than fabricating a missing one — a false "not installed" would put
  // the install chip into the title bar of every screenshot and layout test.
  // `?extension=missing` opts into the prompting state for the tests that
  // exercise the chip itself.
  const demoExtensionMissing =
    typeof location !== 'undefined' &&
    new URLSearchParams(location.search).get('extension') === 'missing';
  let demoExtensionDismissed = false;
  const demoExtensionStatus = () => ({
    installed: !demoExtensionMissing,
    lastReportedAt: demoExtensionMissing ? null : new Date().toISOString(),
    promptToInstall: demoExtensionMissing && !demoExtensionDismissed,
  });

  const api: PolymuxApi = {
    profiles: {
      list: async () => ({activeId: demoActiveProfile, profiles: structuredClone(demoProfiles)}),
      create: async (name) => { demoProfiles.push({id: crypto.randomUUID(), name: name.trim() || 'New profile', isDefault: false}); return {activeId: demoActiveProfile, profiles: structuredClone(demoProfiles)}; },
      select: async (id) => { demoActiveProfile = id; return {activeId: id, profiles: structuredClone(demoProfiles)}; },
      rename: async (id, name) => { demoProfiles = demoProfiles.map(profile => profile.id === id ? {...profile, name} : profile); return {activeId: demoActiveProfile, profiles: structuredClone(demoProfiles)}; },
      setDefault: async (id) => { demoProfiles = demoProfiles.map(profile => ({...profile, isDefault: profile.id === id})); return {activeId: demoActiveProfile, profiles: structuredClone(demoProfiles)}; },
      duplicate: async (id) => { const source = demoProfiles.find(profile => profile.id === id)!; demoProfiles.push({id: crypto.randomUUID(), name: `${source.name} copy`, isDefault: false}); return {activeId: demoActiveProfile, profiles: structuredClone(demoProfiles)}; },
      remove: async (id) => { demoProfiles = demoProfiles.filter(profile => profile.id !== id); if (demoActiveProfile === id) demoActiveProfile = 'default'; return {activeId: demoActiveProfile, profiles: structuredClone(demoProfiles)}; },
      subscribe: () => () => {},
    },
    extension: {
      status: async () => demoExtensionStatus(),
      dismiss: async () => {
        demoExtensionDismissed = true;
        return demoExtensionStatus();
      },
      openInstall: async () => { window.open(EXTENSION_INSTALL_URL, '_blank'); },
    },
    general: {
      get: async () => structuredClone(demoGeneral),
      update: async (settings) => {
        demoGeneral = {
          ...demoGeneral,
          ...settings,
          // A partial patch, matching the real backend: a row sends only the
          // switch it moved.
          permissions: {...demoGeneral.permissions, ...settings.permissions},
          notifications: {...demoGeneral.notifications, ...settings.notifications},
          location:
            settings.locationEnabled === false
              ? null
              : settings.location === undefined
                ? demoGeneral.location
                : settings.location,
        };
        return structuredClone(demoGeneral);
      },
      locate: async () => ({latitude: -33.8688, longitude: 151.2093, accuracy: 25_000, updatedAt: '2026-08-14T00:00:00.000Z'}),
      version: async () => ({version: '0.1.0', electron: '', platform: 'browser', packaged: false}),
      checkForUpdates: async () => demoUpdate,
      installUpdate: async () => demoUpdate,
      // The browser demo has no OS notification centre behind it, so it says
      // so rather than claiming a notification the user will never see.
      testNotification: async () => 'unsupported' as const,
    },
    // A browser tab has no traffic lights to move out of, so the state never
    // changes and the subscription has nothing to tear down.
    window: {openWorkspaceView: async () => {}, subscribeFullscreen: () => () => {}},
    permissions: {
      ensureFirstRun: async () => ({firstRun: false, microphone: 'granted', screenRecording: 'granted'}),
      // The onboarding preview starts from a genuine first run, so the states
      // setup actually has to handle are the ones on screen.
      status: async () => (onboardingPreview ? 'not-determined' : 'granted'),
      requestAll: async () => [],
      request: async () => {
        await new Promise((resolve) => setTimeout(resolve, 600));
        return 'granted';
      },
      openSettings: async () => {},
    },
    dictation: {
      // Nothing to fetch: the demo has no model behind it.
      prepare: async () => {},
      // whisper.cpp lives in the desktop app, so the demo stands in for it —
      // revealing the canned sentence a few words at a time, the way real
      // passes over a growing recording do. Without this the composer's voice
      // button is the one control a browser test cannot exercise.
      transcribe: async () => {
        const words = 'this is dictated text from the browser demo'.split(' ');
        demoDictationPass = Math.min(demoDictationPass + 1, words.length);
        return words.slice(0, demoDictationPass).join(' ');
      },
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
          const current = items[index]!;
          const attachments = patch.attachments?.map((attachmentPath) => ({
            id: crypto.randomUUID(), messageId: id, name: attachmentPath.split(/[\\/]/).pop() ?? attachmentPath,
            path: attachmentPath, mimeType: null, size: null, sha256: null, createdAt: new Date().toISOString(),
          })) ?? [];
          const updated = {
            ...current,
            ...(patch.content === undefined ? {} : {content: patch.content}),
            ...(patch.metadata === undefined ? {} : {metadata: patch.metadata}),
            attachments: [...current.attachments, ...attachments],
          };
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
    manager: {
      snapshot: async () => ({enabled: false, jobs: []}),
      enqueue: async () => { throw new Error('Manager scheduler is unavailable in the demo'); },
      cancel: async () => { throw new Error('Manager scheduler is unavailable in the demo'); },
      reprioritize: async () => { throw new Error('Manager scheduler is unavailable in the demo'); },
      reorder: async () => { throw new Error('Manager scheduler is unavailable in the demo'); },
      subscribe: () => () => {},
    },
    workspace: {
      snapshot: async (conversationId) => demoWorkspaceSnapshots.get(conversationId) ?? null,
      saveSnapshot: async (conversationId, snapshot) => {
        demoWorkspaceSnapshots.set(conversationId, structuredClone(snapshot));
      },
      // The demo has no host to grant a file with, and a browser tab could not
      // read one anyway: whatever it is handed is already loadable, or nothing.
      preview: async (path) => path,
      // Nothing drives the agent in the demo, so nothing ever asks to be shown.
      // The demo has no agent to ask for a surface, so the reveal channel is
      // driven from the page instead: `window.polymuxDemoReveal(request)` fans
      // out to whoever subscribed, which is how the workspace's reveal and
      // draft-prefill behaviour is reachable in the browser build.
      subscribeReveal: (listener) => {
        demoRevealListeners.add(listener);
        return () => demoRevealListeners.delete(listener);
      },
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
    /**
     * The demo keeps schedules in memory and never fires one: the clock and
     * the agent both live in the main process. It seeds a row per state so the
     * view — greyed-out finished rows, the unread dot, the detail panel — can
     * be worked on in a browser.
     */
    schedules: (() => {
      const hour = 3_600_000;
      let items: ScheduleDto[] = demoSchedules(now, hour);
      const listeners = new Set<(items: ScheduleDto[]) => void>();
      const publish = () => { for (const listener of listeners) listener(items); };
      const patch = (id: string, change: (item: ScheduleDto) => ScheduleDto) => {
        items = items.map((item) => item.id === id ? change(item) : item);
        publish();
        const found = items.find((item) => item.id === id);
        if (!found) throw new Error(`Schedule not found: ${id}`);
        return found;
      };
      return {
        list: async () => items,
        create: async (input) => {
          const created: ScheduleDto = {
            id: crypto.randomUUID(),
            title: input.title,
            prompt: input.prompt,
            frequency: input.frequency,
            status: 'active',
            createdAt: Date.now(),
            nextRunAt: Date.now() + hour,
            history: [],
            unread: false,
          };
          items = [...items, created];
          publish();
          return created;
        },
        update: async (id, change) => patch(id, (item) => ({
          ...item,
          ...change,
          status: change.status ?? item.status,
        })),
        remove: async (id) => { items = items.filter((item) => item.id !== id); publish(); },
        runNow: async (id) => patch(id, (item) => ({...item, status: 'running', lastRunAt: Date.now()})),
        markRead: async (id) => patch(id, (item) => ({...item, unread: false})),
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      };
    })(),
    tasks: (() => {
      let cards: import('@polymux/protocol').TaskCardDto[] = [
        {id: crypto.randomUUID(), chatId: 'demo', title: 'Research competitor features', status: 'todo', reviewed: false, order: 0, createdAt: Date.now(), updatedAt: Date.now()},
        {id: crypto.randomUUID(), chatId: 'demo', title: 'Draft marketing copy', status: 'in_progress', owner: 'agent-1', reviewed: false, order: 0, createdAt: Date.now(), updatedAt: Date.now()},
        {id: crypto.randomUUID(), chatId: 'demo', title: 'Update landing page', status: 'done', reviewed: false, order: 0, createdAt: Date.now(), updatedAt: Date.now()},
        {id: crypto.randomUUID(), chatId: 'demo', title: 'Fix login bug', status: 'done', reviewed: true, order: 1, createdAt: Date.now(), updatedAt: Date.now()},
      ];
      const listeners = new Set<(items: typeof cards) => void>();
      const publish = () => { for (const l of listeners) l(cards); };
      return {
        list: async (chatId: string) => cards.filter((card) => card.chatId === chatId),
        create: async (input: import('@polymux/protocol').TaskCardInput) => {
          const card: import('@polymux/protocol').TaskCardDto = {
            id: crypto.randomUUID(), chatId: input.chatId, title: input.title, detail: input.detail,
            status: 'todo', reviewed: false, order: cards.length,
            createdAt: Date.now(), updatedAt: Date.now(),
          };
          cards = [...cards, card]; publish(); return card;
        },
        update: async (id: string, patch: import('@polymux/protocol').TaskCardPatch) => {
          cards = cards.map((c) => c.id === id ? {...c, ...patch, updatedAt: Date.now()} : c);
          publish();
          const found = cards.find((c) => c.id === id);
          if (!found) throw new Error(`Card not found: ${id}`);
          return found;
        },
        remove: async (id: string) => { cards = cards.filter((c) => c.id !== id); publish(); },
        markRead: async (id: string) => {
          cards = cards.map((c) => c.id === id ? {...c, reviewed: true, updatedAt: Date.now()} : c);
          publish();
          const found = cards.find((c) => c.id === id);
          if (!found) throw new Error(`Card not found: ${id}`);
          return found;
        },
        subscribe(listener: (items: typeof cards) => void) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      };
    })(),
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
        enabled: demoMemoryEnabled,
        directory: '/demo/memories',
        storedBytes: 18_240,
        registryPath: '/demo/memories/MEMORY.md',
        summaryPath: '/demo/memories/memory_summary.md',
        memories: 2,
        userMemories: 2,
        conversationMemories: 0,
        latestMemoryAt: new Date().toISOString(),
        consolidatedAt: new Date().toISOString(),
        consolidationError: null,
        consolidationRetryAfter: null,
        pendingMemories: 0,
      }),
      setEnabled: async (enabled) => {
        demoMemoryEnabled = enabled;
        return {...await api.memory.status(), enabled};
      },
      entries: async () => [
        {id: 'memory-demo-1', scope: 'user', kind: 'preference', content: 'Prefers concise, cohesive explanations with room to ask deeper questions.', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()},
        {id: 'memory-demo-2', scope: 'user', kind: 'project', content: 'Polymux is a context-aware desktop assistant with manager-style delegation.', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()},
      ],
    },
    computerHistory: {
      status: async () => demoComputerHistoryStatus(),
      setEnabled: async (enabled) => {
        demoComputerHistoryEnabled = enabled;
        return demoComputerHistoryStatus();
      },
      update: async (patch) => {
        demoComputerHistorySettings = {...demoComputerHistorySettings, ...patch};
        return demoComputerHistoryStatus();
      },
      forget: async () => demoComputerHistoryStatus(),
      removeEntry: async () => demoComputerHistoryStatus(),
      revealEntry: async () => {},
      entries: async () => [],
      pickApp: async () => null,
      appIcon: async () => null,
    },
    comms: {
      status: async () => demoCommsStatus,
      // The demo's data is already in memory, so there is nothing on disk for
      // a snapshot to be: it hands back an empty one and the demo hub fetches
      // as it always did.
      snapshot: async () => ({status: null, chats: [], mailboxes: [], mail: [], messages: []}),
      refresh: async () => demoCommsStatus,
      // Nothing to start in a browser tab; the demo's bridges are always up.
      wake: async () => demoCommsStatus,
      setHubUrl: async (baseUrl) => {
        demoCommsStatus.hub.baseUrl = baseUrl;
        return demoCommsStatus;
      },
      connect: async () => {
        demoCommsStatus.hub = {...demoCommsStatus.hub, status: 'signed-in', userId: '@polymux-demo:localhost', canAutoConnect: false};
        return demoCommsStatus;
      },
      signIn: async (userId) => {
        demoCommsStatus.hub = {...demoCommsStatus.hub, status: 'signed-in', userId, error: null};
        return demoCommsStatus;
      },
      signOut: async () => {
        demoCommsStatus.hub = {...demoCommsStatus.hub, status: 'reachable', userId: null, canAutoConnect: true};
        return demoCommsStatus;
      },
      // Each flow id opens with the step shape its real bridge uses, so the
      // preview walks the same screens the packaged app does.
      loginStart: async (platform, flowId) => {
        // A real bridge takes a beat to produce its first step; without that
        // beat here the preview never shows the waiting state that stands in
        // for it.
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (flowId === 'qr')
          return {type: 'display_and_wait', loginId: 'demo', stepId: 'qr', instructions: 'Scan this from your phone.', display: 'qr', data: `https://example.com/pair/${platform}`, imageUrl: null};
        if (flowId === 'phone')
          return {type: 'user_input', loginId: 'demo', stepId: `phone:${platform}`, instructions: null, fields: [{id: 'phone', type: 'phone_number', name: 'Phone number', description: 'With country code, e.g. +61 400 000 000.', pattern: '^\\+?[0-9 ]{6,}$'}]};
        if (flowId === 'token')
          return {type: 'user_input', loginId: 'demo', stepId: 'token', instructions: null, fields: [{id: 'token', type: 'token', name: 'Token', description: null, pattern: null}]};
        if (flowId === 'password')
          return {type: 'user_input', loginId: 'demo', stepId: 'password', instructions: null, fields: [{id: 'username', type: 'username', name: 'Handle', description: 'e.g. you.bsky.social', pattern: null}, {id: 'password', type: 'password', name: 'App password', description: null, pattern: null}]};
        if (flowId === 'local')
          return {type: 'display_and_wait', loginId: 'demo', stepId: 'local', instructions: 'Reading Messages on this Mac…', display: 'nothing', data: null, imageUrl: null};
        // Everything else in the fleet signs in on the network's own site.
        return {type: 'cookies', loginId: 'demo', stepId: 'cookies', instructions: null, url: 'https://example.com/login', waitForUrl: null, userAgent: null, fields: []};
      },
      loginSubmit: async (platform, _loginId, stepId) => {
        // WhatsApp answers a phone number with a code to type on the phone;
        // Telegram answers it by sending a login code to the app.
        if (stepId === 'phone:whatsapp')
          return {type: 'display_and_wait', loginId: 'demo', stepId: 'pairing', instructions: 'Type this code into WhatsApp on your phone.', display: 'code', data: 'GRWM-K2FH', imageUrl: null};
        if (stepId.startsWith('phone:'))
          return {type: 'user_input', loginId: 'demo', stepId: 'code', instructions: 'Telegram sent a login code to your other devices.', fields: [{id: 'code', type: '2fa_code', name: 'Login code', description: null, pattern: '^[0-9]{5,6}$'}]};
        demoMarkLinked(platform);
        return {type: 'complete', loginId: 'demo', accountId: 'demo', accountName: 'Demo account'};
      },
      // The real endpoint blocks until the remote side scans, and the QR stays
      // on screen for as long as it does; resolving instantly would make the
      // demo flash past the step it is meant to show.
      loginWait: async (platform, _loginId, stepId) => {
        const before = demoLoginCancelled;
        await new Promise((resolve) => setTimeout(resolve, stepId === 'local' ? 3000 : 20_000));
        if (demoLoginCancelled !== before) throw new Error('The login was cancelled.');
        demoMarkLinked(platform);
        return {type: 'complete', loginId: 'demo', accountId: 'demo', accountName: 'Demo account'};
      },
      loginCookies: async (platform) => {
        demoMarkLinked(platform);
        return {type: 'complete', loginId: 'demo', accountId: 'demo', accountName: 'Demo account'};
      },
      loginCancel: async () => {
        demoLoginCancelled += 1;
        return demoCommsStatus;
      },
      bridgeLogout: async (platform, accountId) => {
        demoCommsStatus.bridges = demoCommsStatus.bridges.map((bridge) => {
          if (bridge.platform !== platform) return bridge;
          const accounts = bridge.accounts.filter((account) => account.id !== accountId);
          return {...bridge, accounts, state: accounts.length > 0 ? 'connected' : 'logged-out'};
        });
        return demoCommsStatus;
      },
      bridgeSetup: async (platform, values) => {
        demoCommsStatus.bridges = demoCommsStatus.bridges.map((bridge) =>
          bridge.platform === platform && bridge.setup
            ? {
                ...bridge,
                setup: {
                  ...bridge.setup,
                  configured: bridge.setup.fields.every((field) => Boolean(values[field.id])),
                },
              }
            : bridge,
        );
        return demoCommsStatus;
      },
      chats: async () => demoChats,
      chatMarkRead: async (chatId) => {
        if (demoGeneral.hubIncognitoMode) return false;
        demoChats = demoChats.map((chat) => (chat.id === chatId ? {...chat, unread: 0} : chat));
        return true;
      },
      chatMessages: async (chatId) => ({
        // Newest first, the way the real hub answers — the thread is drawn in
        // that order, and a demo that hands them back the other way round
        // exercises a view nobody ever sees.
        messages: demoChatMessages
          .filter((item) => item.chatId === chatId)
          .sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt)),
        // The demo holds one page; there is never an older one to walk to.
        nextBefore: null,
      }),
      chatSend: async (chatId, text, replyTo) => {
        const sent: ChatMessageDto = {id: crypto.randomUUID(), chatId, sender: 'You', body: text, sentAt: new Date().toISOString(), mine: true, replyTo: replyTo ?? null, reactions: []};
        demoChatMessages = [sent, ...demoChatMessages];
        return sent;
      },
      // The demo has no homeserver to upload to and no microphone to open, so
      // the file and voice paths are accepted and go nowhere.
      chatSendFiles: async () => {},
      chatPickFiles: async () => [],
      chatSendAudio: async () => {},
      chatReact: async (_chatId, messageId, key) => {
        demoChatMessages = demoChatMessages.map((item) =>
          item.id === messageId
            ? {...item, reactions: [...(item.reactions ?? []), {key, count: 1, mineEventId: `demo-${key}`}]}
            : item,
        );
        return `demo-${key}`;
      },
      chatUnreact: async (_chatId, reactionId) => {
        demoChatMessages = demoChatMessages.map((item) => ({
          ...item,
          reactions: (item.reactions ?? []).filter((entry) => entry.mineEventId !== reactionId),
        }));
      },
      mailFolders: async () => demoMailFolders,
      mailEnvelopes: async (request) => {
        const folder = request.folder ?? 'INBOX';
        const needle = request.query?.trim().toLowerCase() ?? '';
        return demoEnvelopes
          .filter((item) => item.folder === folder)
          .filter((item) => !needle || item.envelope.subject.toLowerCase().includes(needle) || item.envelope.from.address.toLowerCase().includes(needle))
          // The demo's bodies stand in for the peek the real listing does.
          .map((item) => ({...item.envelope, preview: item.body.slice(0, 200)}));
      },
      mailMessage: async (id) => {
        const found = demoEnvelopes.find((item) => item.envelope.id === id);
        if (!found) throw new Error(`No message ${id}`);
        return {id, subject: found.envelope.subject, from: found.envelope.from, to: found.envelope.to ? [found.envelope.to] : [], cc: [], bcc: [], date: found.envelope.date, body: found.body, html: found.html ?? null, attachments: found.envelope.hasAttachment ? [{name: 'q3-report.pdf', mime: 'application/pdf'}] : [], messageId: `<demo-${id}@example.com>`, references: []};
      },
      mailSend: async () => {},
      mailDelete: async (ids) => {
        demoEnvelopes = demoEnvelopes.filter((item) => !ids.includes(item.envelope.id));
      },
      mailDownload: async () => ['/tmp/q3-report.pdf'],
      mailOpenFile: async () => {},
      mailPickFiles: async () => ['/tmp/demo-attachment.pdf'],
      mailMove: async (ids, target) => {
        demoEnvelopes = demoEnvelopes.map((item) => (ids.includes(item.envelope.id) ? {...item, folder: target} : item));
      },
      mailFlag: async (ids, flag, on) => {
        demoEnvelopes = demoEnvelopes.map((item) =>
          ids.includes(item.envelope.id) ? {...item, envelope: {...item.envelope, [flag === 'seen' ? 'seen' : 'flagged']: on}} : item,
        );
      },
      // Real enough to exercise the UI: several mailboxes can share a
      // provider, and each is edited or removed on its own.
      emailSave: async (request) => {
        const account: CommsEmailAccountDto = {
          id: request.id,
          displayName: request.displayName ?? null,
          email: request.email,
          isDefault: request.isDefault ?? demoCommsStatus.email.accounts.length === 0,
          incoming: {kind: 'imap', host: request.imapHost, port: request.imapPort, encryption: request.imapEncryption, login: request.email, auth: 'password'},
          outgoing: {kind: 'smtp', host: request.smtpHost, port: request.smtpPort, encryption: request.smtpEncryption, login: request.email, auth: 'password'},
          secretStored: true,
          status: 'ok',
          error: null,
        };
        const existing = request.originalId ?? request.id;
        const accounts = demoCommsStatus.email.accounts.some((item) => item.id === existing)
          ? demoCommsStatus.email.accounts.map((item) => (item.id === existing ? account : item))
          : [...demoCommsStatus.email.accounts, account];
        demoCommsStatus.email = {...demoCommsStatus.email, accounts};
        return demoCommsStatus;
      },
      emailRemove: async (id) => {
        demoCommsStatus.email = {
          ...demoCommsStatus.email,
          accounts: demoCommsStatus.email.accounts.filter((item) => item.id !== id),
        };
        return demoCommsStatus;
      },
      // Nothing to sign in to in a browser: the demo answers with the status
      // it already has, so the button is visible without pretending to work.
      emailSignIn: async () => demoCommsStatus,
      emailTest: async (id) => {
        const account = demoCommsStatus.email.accounts.find((item) => item.id === id);
        if (!account) throw new Error(`No email account named ${id}`);
        return {...account, status: 'ok', error: null};
      },
      subscribe: () => () => {},
      // The demo has no homeserver delivering anything, so nothing ever fires.
      subscribeActivity: () => () => {},
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
        const next: McpServerDto = {...request, source: 'polymux', editable: true, enabled: item?.enabled ?? true, status: item?.status ?? 'disconnected', toolNames: item?.toolNames ?? [], resourceUris: [], promptNames: []};
        if (item) Object.assign(item, next); else demoMcpServers.push(next);
        return demoMcpServers;
      },
      removeCustom: async (id) => {
        const index = demoMcpServers.findIndex((candidate) => candidate.id === id && candidate.editable);
        if (index < 0) throw new Error(`MCP server is not removable: ${id}`);
        demoMcpServers.splice(index, 1);
        return demoMcpServers;
      },
      discover: async () => demoDiscoveredMcp.map((group) => ({
        ...group,
        servers: group.servers.map((entry) => ({
          ...entry,
          state: demoMcpServers.some((item) => item.id === entry.id) ? 'loaded' as const : 'available' as const,
        })),
      })),
      adopt: async (groupId, serverId) => {
        const entry = demoDiscoveredMcp.find((group) => group.id === groupId)?.servers.find((item) => item.id === serverId);
        if (!entry) throw new Error(`That MCP server is no longer in ${groupId}`);
        demoMcpServers.push({id: entry.id, name: entry.name, description: entry.description, source: 'polymux', editable: true, enabled: true, transport: entry.transport, status: 'connected', toolNames: [], resourceUris: [], promptNames: [], ...(entry.transport === 'stdio' ? {command: entry.target} : {url: entry.target})});
        return demoMcpServers;
      },
      // One page, and no second one: the demo directory is two rows long, so
      // its cursor is always empty and the list never asks for more.
      searchRegistry: async (query) => ({
        entries: [
          {id: 'io.github/example/files', name: 'Files', description: 'Browse and manage files.', url: 'https://example.com/files/mcp', requiredHeaders: []},
          {id: 'io.github/example/issues', name: 'Issues', description: `Search ${query || 'project'} issues.`, url: 'https://example.com/issues/mcp', repository: 'https://github.com/example/issues', requiredHeaders: ['Authorization']},
        ],
        nextCursor: '',
      }),
      subscribe: () => () => {},
    },
    drive: {
      status: async () => demoDriveStatus,
      refresh: async () => demoDriveStatus,
      // The demo has no OAuth to run, so connecting just flips the provider on
      // — enough to exercise every state the settings tab renders.
      connect: async (provider) => demoDriveConnect(provider, true),
      disconnect: async (provider) => demoDriveConnect(provider, false),
      setSaveOrder: async (order) => {
        demoDriveStatus.saveOrder = order;
        return demoDriveStatus;
      },
      revealEntry: async () => {},
      openEntry: async () => {},
      addShare: async (sharePath, label) => {
        const target = sharePath || '/Volumes/Studio';
        const id = target;
        demoDriveStatus.sources = [
          ...demoDriveStatus.sources.filter((source) => source.id !== `network#${id}`),
          {
            id: `network#${id}`,
            provider: 'network',
            accountId: id,
            name: 'Network',
            accountLabel: label || target.split('/').pop() || target,
            state: 'connected',
            usage: {used: 2_100_000_000_000, total: 8_000_000_000_000, appUsed: 84_000_000},
            root: target,
            error: null,
          },
        ];
        return demoDriveStatus;
      },
      removeShare: async (id) => {
        demoDriveStatus.sources = demoDriveStatus.sources.filter(
          (source) => source.id !== `network#${id}` && source.id !== id,
        );
        return demoDriveStatus;
      },
      setLocalRoot: async (path) => {
        const local = demoDriveStatus.providers.find((entry) => entry.id === 'local');
        if (local) local.root = path ?? '/demo/Polymux';
        return demoDriveStatus;
      },
      saveS3: async (config) => {
        const s3 = demoDriveStatus.providers.find((entry) => entry.id === 's3');
        if (s3) {
          s3.state = 'connected';
          s3.root = config.prefix ? `${config.bucket}/${config.prefix}` : config.bucket;
          s3.accounts = [{id: config.bucket, name: config.bucket, email: null}];
        }
        return demoDriveStatus;
      },
      list: async (source, path) => demoDriveFolder(source, path ?? ''),
      createFolder: async (source, parentPath, name) => {
        const folder = demoDriveFolder(source, parentPath);
        // The same collision the real adapters raise, so the drive's error
        // path is reachable in the demo rather than only in the packaged app.
        if (folder.some((entry) => entry.name === name))
          throw new Error(`A folder named ${name} already exists here.`);
        const entry: DriveEntryDto = {
          id: `${parentPath}/${name}`, name, kind: 'folder', size: null,
          modifiedAt: new Date().toISOString(), provider: parseDriveSourceId(source).provider,
          path: `${parentPath}/${name}`, mimeType: null,
        };
        folder.push(entry);
        return entry;
      },
      // A browser tab has no file picker to open, so the demo stands in with a
      // file of its own rather than doing nothing and looking broken.
      upload: async (source, parentPath) => {
        const entry: DriveEntryDto = {
          id: `${parentPath}/upload-${demoDriveUploads += 1}.png`,
          name: `Uploaded ${demoDriveUploads}.png`, kind: 'file', size: 128_400,
          modifiedAt: new Date().toISOString(), provider: parseDriveSourceId(source).provider,
          path: `${parentPath}/upload-${demoDriveUploads}.png`, mimeType: 'image/png',
        };
        demoDriveFolder(source, parentPath).push(entry);
        return [entry];
      },
      download: async (_source, path) => `/demo/downloads/${path}`,
      remove: async (source, paths) => {
        for (const [key, entries] of demoDriveFolders) {
          if (!key.startsWith(`${source}:`)) continue;
          demoDriveFolders.set(key, entries.filter((entry) => !paths.includes(entry.path)));
        }
      },
      rename: async (source, path, name) => {
        const entry = demoDriveFind(source, path);
        if (entry) entry.name = name;
        return entry ?? {
          id: path, name, kind: 'file', size: null,
          modifiedAt: new Date().toISOString(),
          provider: parseDriveSourceId(source).provider, path, mimeType: null,
        };
      },
      move: async (source, paths, destinationFolder) => paths.map((path) => {
        const entry = demoDriveFind(source, path);
        const moved: DriveEntryDto = {
          ...(entry ?? {
            id: path, name: path.slice(path.lastIndexOf('/') + 1), kind: 'file' as const,
            size: null, modifiedAt: new Date().toISOString(),
            provider: parseDriveSourceId(source).provider, path, mimeType: null,
          }),
          path: `${destinationFolder}/${path.slice(path.lastIndexOf('/') + 1)}`,
        };
        for (const [key, entries] of demoDriveFolders)
          if (key.startsWith(`${source}:`))
            demoDriveFolders.set(key, entries.filter((item) => item.path !== path));
        const destinationKey = `${source}:${destinationFolder}`;
        demoDriveFolders.set(destinationKey, [...(demoDriveFolders.get(destinationKey) ?? []), moved]);
        return moved;
      }),
      copy: async (source, paths) => paths.map((path) => {
        const entry = demoDriveFind(source, path);
        const parent = path.slice(0, path.lastIndexOf('/'));
        const copied: DriveEntryDto = {
          ...(entry ?? {
            id: path, name: 'Item', kind: 'file' as const, size: null,
            modifiedAt: new Date().toISOString(),
            provider: parseDriveSourceId(source).provider, path, mimeType: null,
          }),
          id: `${path}-copy`,
          name: `${entry?.name ?? 'Item'} copy`,
          path: `${path}-copy`,
        };
        demoDriveFolder(source, parent).push(copied);
        return copied;
      }),
      subscribe: () => () => {},
    },
    skills: {
      list: async () => demoSkills,
      reload: async () => demoSkills,
      subscribe: () => () => {},
      install: async (spec) => {
        const name = spec.trim().replace(/\/+$/, '').split('/').pop() ?? 'installed-skill';
        if (demoSkills.some((item) => item.name === name)) throw new Error(`A skill named ${name} already exists`);
        demoSkills.push({name, description: `Installed from ${spec.trim()}.`, source: 'polymux', filePath: `~/.polymux/skills/${name}/SKILL.md`, disableModelInvocation: false, allowedTools: [], permissions: [], enabled: true, editable: true, instructions: `Installed from ${spec.trim()}.`, updatedAt: '2026-08-14T03:00:00.000Z'});
        return demoSkills;
      },
      searchRegistry: async (query, limit = 15) => {
        const directory = [
          {id: 'vercel-labs/agent-skills/vercel-react-best-practices', name: 'vercel-react-best-practices', source: 'vercel-labs/agent-skills', installs: 630_723},
          {id: 'vercel-labs/skills/find-skills', name: 'find-skills', source: 'vercel-labs/skills', installs: 120_345},
          {id: 'vercel-labs/agent-skills/web-design-guidelines', name: 'web-design-guidelines', source: 'vercel-labs/agent-skills', installs: 84_210},
        ];
        const text = query.trim().toLowerCase();
        if (text.length === 1) return [];
        return directory
          .filter((entry) => !text || entry.name.includes(text) || entry.source.includes(text))
          .slice(0, limit);
      },
      // `?one-agent` narrows the scan to a single agent, which is how the one
      // interesting variation of the discovery pane — nothing to survey, so it
      // opens expanded — is reachable from a test.
      discover: async () => (location.search.includes('one-agent')
        ? demoDiscoveredSkills.filter((group) => group.id === 'codex')
        : demoDiscoveredSkills
      ).map((group) => ({
        ...group,
        skills: group.skills.map((entry) => ({
          ...entry,
          state: entry.state === 'loaded' || demoSkills.some((item) => item.name === entry.name)
            ? 'loaded' as const
            : 'available' as const,
        })),
      })),
      adopt: async (path) => {
        const entry = demoDiscoveredSkills.flatMap((group) => group.skills).find((item) => item.path === path);
        if (!entry) throw new Error('That skill is not in a directory Polymux scans');
        if (demoSkills.some((item) => item.name === entry.name)) throw new Error(`A skill named ${entry.name} already exists`);
        demoSkills.push({name: entry.name, description: entry.description, source: 'polymux', filePath: `~/.polymux/skills/${entry.name}/SKILL.md`, disableModelInvocation: false, allowedTools: [], permissions: [], enabled: true, editable: true, instructions: entry.description, updatedAt: '2026-08-16T09:00:00.000Z'});
        return demoSkills;
      },
      setEnabled: async (name, enabled) => {
        const item = demoSkills.find((candidate) => candidate.name === name);
        if (item) item.enabled = enabled;
        return demoSkills;
      },
      saveCustom: async (request) => {
        const index = demoSkills.findIndex((candidate) => candidate.name === (request.originalName ?? request.name));
        const next: SkillDto = {name: request.name, description: request.description, instructions: request.instructions, source: 'polymux', filePath: `~/.polymux/skills/${request.name}/SKILL.md`, disableModelInvocation: false, allowedTools: [], permissions: [], enabled: index >= 0 ? demoSkills[index]!.enabled : true, editable: true};
        if (index >= 0) demoSkills.splice(index, 1, next); else demoSkills.push(next);
        return demoSkills;
      },
      removeCustom: async (name) => {
        const index = demoSkills.findIndex((candidate) => candidate.name === name && candidate.editable);
        if (index < 0) throw new Error(`Skill is not removable: ${name}`);
        demoSkills.splice(index, 1);
        return demoSkills;
      },
      upload: async () => demoSkills,
    },
    models: {
      list: async () => demoModels,
      select: async (provider, id) => {
        const selected = demoModels.find((model) => model.provider === provider && model.id === id);
        if (!selected) throw new Error(`Unknown model: ${provider}/${id}`);
        const providerState = demoProviders.find((item) => item.id === provider);
        if (providerState && !providerWithKeys(providerState).configured)
          throw new Error(`${providerState.name} is not configured. Add its API key in Settings → Provider, or choose a configured model.`);
        demoModels = demoModels.map((model) => ({...model, selected: model === selected}));
        return demoModels.find((model) => model.selected)!;
      },
      // The browser demo has no main process to reach models.dev through, so
      // it exercises the "catalogue knows nothing" path the real app falls
      // back to when offline.
      metadata: async () => demoModelMetadata,
      roles: async () => demoRoles(),
      assignRole: async (role, provider, id, reasoning) => {
        const model = demoModels.find((item) => item.provider === provider && item.id === id);
        if (!model) throw new Error(`Unknown model: ${provider}/${id}`);
        const providerState = demoProviders.find((item) => item.id === provider);
        if (providerState && !providerWithKeys(providerState).configured)
          throw new Error(`${providerState.name} is not configured. Add its API key in Settings → Provider, or choose a configured model.`);
        if (role === 'main') {
          demoModels = demoModels.map((item) => ({...item, selected: item === model}));
          if (reasoning) demoGeneral = {...demoGeneral, reasoningLevel: reasoning};
          return demoRoles();
        }
        demoRoleOverrides = {...demoRoleOverrides, [role]: {provider, id, reasoning}};
        if (role === 'speech') demoGeneral = {...demoGeneral, speechModeEnabled: true};
        return demoRoles();
      },
      clearRole: async (role) => {
        if (role === 'main') throw new Error('The main model cannot be cleared');
        const {[role]: _removed, ...rest} = demoRoleOverrides;
        demoRoleOverrides = rest;
        if (role === 'speech') demoGeneral = {...demoGeneral, speechModeEnabled: false};
        return demoRoles();
      },
    },
    // The demo runs in a plain browser tab with no main process, so the
    // embedded browser is unavailable and BrowserView falls back to its
    // iframe rendering.
    browser: {
      embedded: false,
      open: async () => ({url: '', title: ''}),
      navigate: async () => {},
      history: async () => {},
      reload: async () => {},
      setBounds: async () => {},
      setVisible: async () => {},
      close: async () => {},
      openExternal: async (url) => { window.open(url, '_blank'); },
      // A browser tab has no host to ask which application owns a link, so the
      // menu falls back to naming one generically.
      defaultApp: async () => null,
      openPath: async () => {},
      find: async () => {},
      stopFind: async () => {},
      print: async () => {},
      screenshot: async () => null,
      // In a plain browser tab the page's own CSP is what it is, so a link's
      // icon falls back to the globe rather than being fetched for it.
      favicon: async () => null,
      downloads: async () => [...demoBrowserDownloads],
      openDownload: async () => {},
      openDownloadsFolder: async () => {},
      // Outside Electron there is no session, jar or keychain, so the demo
      // keeps its own state and mutates it — enough to exercise every state
      // the Browser tab renders.
      pauseDownload: async (id) => demoBrowserDownloadState(id, 'paused'),
      resumeDownload: async (id) => demoBrowserDownloadState(id, 'progressing'),
      cancelDownload: async (id) => demoBrowserDownloadState(id, 'cancelled'),
      removeDownload: async (id) => {
        const at = demoBrowserDownloads.findIndex((entry) => entry.id === id);
        if (at >= 0) demoBrowserDownloads.splice(at, 1);
        return [...demoBrowserDownloads];
      },
      clearDownloads: async () => {
        demoBrowserDownloads.length = 0;
        return [];
      },
      settings: async () => ({...demoBrowserSettings}),
      updateSettings: async (patch) => {
        if (patch.askWhereToSave !== undefined) demoBrowserSettings.askWhereToSave = patch.askWhereToSave;
        if (patch.autofillEnabled !== undefined) demoBrowserSettings.autofillEnabled = patch.autofillEnabled;
        // null asks the main process for a picker, which the demo stands in for.
        if (patch.downloadDirectory === null) demoBrowserSettings.downloadDirectory = '/demo/Documents/Polymux';
        else if (patch.downloadDirectory !== undefined) demoBrowserSettings.downloadDirectory = patch.downloadDirectory;
        return {...demoBrowserSettings};
      },
      permissions: async () => [...demoBrowserPermissions],
      setPermission: async (site, permission, decision) => {
        const existing = demoBrowserPermissions.find((row) => row.origin === site && row.permission === permission);
        if (existing) existing.decision = decision;
        else demoBrowserPermissions.push({origin: site, permission, decision, updatedAt: new Date().toISOString()});
        return [...demoBrowserPermissions];
      },
      clearPermissions: async (site) => {
        demoBrowserPermissions = site
          ? demoBrowserPermissions.filter((row) => row.origin !== site)
          : [];
        return [...demoBrowserPermissions];
      },
      respondToPermission: async () => {},
      sites: async () => [...demoBrowserSites],
      clearSiteData: async (site) => {
        demoBrowserSites = demoBrowserSites.filter((row) => row.origin !== site);
        demoBrowserPermissions = demoBrowserPermissions.filter((row) => row.origin !== site);
        return [...demoBrowserSites];
      },
      clearBrowsingData: async (options) => {
        if (options.cookies) demoBrowserSites = [];
        if (options.downloads) demoBrowserDownloads.length = 0;
        if (options.permissions) demoBrowserPermissions = [];
        if (options.logins) {
          demoBrowserLogins.length = 0;
          demoBrowserPasswords.clear();
        }
      },
      logins: async () => [...demoBrowserLogins],
      saveLogin: async (site, username, password) => {
        const existing = demoBrowserLogins.find((row) => row.origin === site && row.username === username);
        const id = existing?.id ?? crypto.randomUUID();
        if (!existing)
          demoBrowserLogins.push({id, origin: site, username, source: 'manual', updatedAt: new Date().toISOString(), lastUsedAt: null});
        demoBrowserPasswords.set(id, password);
        return [...demoBrowserLogins];
      },
      revealLogin: async (id) => demoBrowserPasswords.get(id) ?? null,
      deleteLogin: async (id) => {
        const at = demoBrowserLogins.findIndex((row) => row.id === id);
        if (at >= 0) demoBrowserLogins.splice(at, 1);
        demoBrowserPasswords.delete(id);
        return [...demoBrowserLogins];
      },
      browsingHistory: async (options) => {
        const query = options?.query?.trim().toLowerCase();
        const rows = query
          ? demoBrowserHistory.filter(
              (row) =>
                row.url.toLowerCase().includes(query) || row.title.toLowerCase().includes(query),
            )
          : [...demoBrowserHistory];
        return rows
          .sort((a, b) => b.visitedAt.localeCompare(a.visitedAt))
          .slice(0, options?.limit ?? 200);
      },
      forgetHistoryEntry: async (url) => {
        const at = demoBrowserHistory.findIndex((row) => row.url === url);
        if (at >= 0) demoBrowserHistory.splice(at, 1);
        return [...demoBrowserHistory];
      },
      clearHistory: async (options) => {
        const keep = options?.source === 'import'
          ? demoBrowserHistory.filter((row) => row.source !== 'import')
          : [];
        demoBrowserHistory.length = 0;
        demoBrowserHistory.push(...keep);
        return [...demoBrowserHistory];
      },
      importSources: async () => demoBrowserSources,
      importFrom: async (request) => ({
        cookiesImported: request.cookies ? 128 : 0,
        cookiesSkipped: request.cookies ? 4 : 0,
        passwordsImported: request.passwords ? 6 : 0,
        passwordsSkipped: 0,
        historyImported: request.history ? 2_140 : 0,
        historySkipped: request.history ? 12 : 0,
        problems: request.cookies ? ['the cookie has already expired (4 items)'] : [],
      }),
      importFile: async () => ({
        cookiesImported: 0,
        cookiesSkipped: 0,
        passwordsImported: 3,
        passwordsSkipped: 1,
        historyImported: 0,
        historySkipped: 0,
        problems: ['the login has no password'],
      }),
      subscribe: () => () => {},
    },
    /**
     * The demo world outside Electron. One installed plugin and a small
     * catalogue rather than an empty list, so the tab can be seen — and
     * tested — with something in it.
     */
    plugins: {
      list: async () => demoPlugins,
      setEnabled: async (id, enabled) => {
        const item = demoPlugins.find((candidate) => candidate.id === id);
        if (item) item.enabled = enabled;
        return demoPlugins;
      },
      install: async (id) => {
        const entry = demoCatalog.find((candidate) => candidate.id === id);
        if (!entry) throw new Error(`Unknown plugin: ${id}`);
        entry.installed = true;
        demoPlugins.push({
          id: entry.id,
          name: entry.name,
          description: entry.description,
          version: entry.version,
          author: entry.author,
          marketplace: 'claude-code',
          marketplaceName: 'claude-code-plugins',
          directory: `~/.polymux/plugins/claude-code/${entry.name}`,
          enabled: true,
          contributions: {skills: [], mcpServers: [], commands: 1, agents: 0, hooks: 0},
          conflicts: [],
        });
        return demoPlugins;
      },
      remove: async (id) => {
        const index = demoPlugins.findIndex((candidate) => candidate.id === id);
        if (index >= 0) demoPlugins.splice(index, 1);
        const entry = demoCatalog.find((candidate) => candidate.id === id);
        if (entry) entry.installed = false;
        return demoPlugins;
      },
      marketplaces: async () => demoMarketplaces,
      addMarketplace: async (source) => {
        const repo = source.trim().split('/').pop() ?? source;
        if (!demoMarketplaces.some((entry) => entry.id === repo))
          demoMarketplaces.push({id: repo, name: repo, source: source.trim(), pluginCount: 0, builtin: false});
        return demoMarketplaces;
      },
      removeMarketplace: async (id) => {
        const index = demoMarketplaces.findIndex((entry) => entry.id === id && !entry.builtin);
        if (index >= 0) demoMarketplaces.splice(index, 1);
        return demoMarketplaces;
      },
      browse: async (query) => {
        const text = (query ?? '').trim().toLowerCase();
        return demoCatalog.filter((entry) =>
          !text || `${entry.name} ${entry.description}`.toLowerCase().includes(text));
      },
      upload: async () => demoPlugins,
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
      connectOAuth: async (provider) => {
        const item = demoProviders.find((candidate) => candidate.id === provider);
        if (!item) throw new Error(`Unknown provider: ${provider}`);
        item.configured = true;
        item.storedCredential = true;
        item.source = 'OAuth';
        return providerWithKeys(item);
      },
      cancelOAuth: async () => {},
      disconnectOAuth: async (provider) => {
        const item = demoProviders.find((candidate) => candidate.id === provider);
        if (!item) throw new Error(`Unknown provider: ${provider}`);
        item.configured = false;
        item.storedCredential = false;
        item.source = null;
        return providerWithKeys(item);
      },
      subscribeOAuth: () => () => {},
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
      discoverModels: async () => [
        {id: 'llama3.1:8b'},
        {id: 'qwen2.5-coder:14b'},
      ],
      setupLocalRuntime: async (request) => {
        const provider = demoProviders.find((candidate) => candidate.id === request.id);
        if (!provider) throw new Error(`Unknown local runtime: ${request.id}`);
        const detected = [{id: 'llama3.1:8b'}, {id: 'qwen2.5-coder:14b'}];
        provider.baseUrl = request.baseUrl ?? provider.baseUrl;
        provider.localRuntime = false;
        provider.configured = true;
        provider.source = 'Local endpoint';
        provider.modelCount = detected.length;
        demoModels = [
          ...demoModels.filter((model) => model.provider !== provider.id),
          ...detected.map((model, index) => ({
            provider: provider.id, id: model.id, name: model.id,
            contextWindow: 0, maxOutputTokens: 0, reasoning: false, input: ['text' as const],
            cost: {input: null, output: null, cacheRead: null, cacheWrite: null},
            selected: index === 0, custom: true,
          })),
        ];
        return providerWithKeys(provider);
      },
    },
  };

  function providerWithKeys(provider: ProviderDto): ProviderDto {
    const apiKeys = demoKeys.get(provider.id) ?? [];
    // A local runtime that has not been connected yet is offered, not configured.
    const custom = provider.custom && !provider.localRuntime;
    return {...provider, apiKeys: structuredClone(apiKeys), storedCredential: apiKeys.length > 0, configured: custom || apiKeys.length > 0, source: apiKeys.length ? `${apiKeys.length} saved API ${apiKeys.length === 1 ? 'key' : 'keys'}` : custom ? 'Custom endpoint' : null};
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
          result: {error: {message: 'OpenCode Go is not configured. Add its API key in Settings → Provider, or choose a configured model.'}},
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
    // `__demo_run_<ms>__` holds the run open for that long, which is how the
    // browser demo exercises anything that only exists mid-run (steering, the
    // queue behind a running agent).
    const held = /^__demo_run_(\d+)__$/.exec(request.text);
    const duration = held ? Number(held[1]) : 900;
    const isActivityDemo = request.text === '__demo_activity__';
    // A delegated task, its subagent's run, and the link between them, which is
    // what lets a task row open the run it started.
    if (request.text === '__demo_task__') {
      const childRunId = 'demo-subagent-run';
      const call = {
        id: 'demo-task-1',
        name: 'subagent',
        arguments: {description: 'Compare the two providers', prompt: 'Compare the two providers and report which is cheaper.'},
      };
      emit(runId, request.conversationId, 'tool.started', {toolCall: call});
      emit(runId, request.conversationId, 'tool.progress', {toolCallId: call.id, message: '', data: {childRunId}});
      // Dispatch returns at once — the delegated run is only just starting, and
      // the parent is free to keep working while it does.
      emit(runId, request.conversationId, 'tool.completed', {toolCall: call, result: {content: JSON.stringify({subagent: 'subagent_1', status: 'running'}), metadata: {subagent: 'subagent_1', status: 'running'}}});
      emit(childRunId, request.conversationId, 'run.started', {}, runId);
      emit(childRunId, request.conversationId, 'message.reasoning.delta', {delta: 'Weighing the two price sheets'}, runId);
      emit(childRunId, request.conversationId, 'tool.started', {toolCall: {id: 'demo-subagent-read', name: 'read', arguments: {path: '/pricing.md'}}}, runId);
      timers.set(runId, setTimeout(() => {
        const answer = 'The second provider is cheaper at this volume.';
        emit(childRunId, request.conversationId, 'tool.completed', {toolCall: {id: 'demo-subagent-read', name: 'read', arguments: {path: '/pricing.md'}}, result: {content: 'Read 40 lines.'}}, runId);
        emit(childRunId, request.conversationId, 'message.text.delta', {delta: answer}, runId);
        emit(childRunId, request.conversationId, 'run.completed', {result: {lastAgentMessage: answer}}, runId);
        const text = 'The subagent reports the second provider is cheaper.';
        emit(runId, request.conversationId, 'message.text.delta', {delta: text});
        items.push(message(crypto.randomUUID(), request.conversationId, 'assistant', [{type: 'text', text}], Date.now(), runId, {phase: 'final'}));
        finishDemoRun(runId, 'run.completed', {hadWorkActivity: true, lastAgentMessage: text, durationMs: 300});
      }, 300));
      return {runId};
    }
    if (isActivityDemo) {
      const args = {path: '/skills/computer-use/SKILL.md'};
      const commentary = 'I’ll read the skill files first to see what applies here.';
      emit(runId, request.conversationId, 'message.completed', {message: {role: 'assistant', content: [{type: 'text', text: commentary}]}, phase: 'commentary'});
      emit(runId, request.conversationId, 'tool.started', {toolCall: {id: 'demo-skill-read-1', name: 'read', arguments: args}});
      emit(runId, request.conversationId, 'tool.started', {toolCall: {id: 'demo-skill-read-2', name: 'read', arguments: args}});
      emit(runId, request.conversationId, 'tool.started', {toolCall: {id: 'demo-skill-read-3', name: 'read', arguments: args}});
      emit(runId, request.conversationId, 'tool.progress', {toolCallId: 'demo-skill-read-3', message: 'Scanning the skill manifest'});
      emit(runId, request.conversationId, 'tool.progress', {toolCallId: 'demo-skill-read-3', message: 'Reading workflow steps'});
    }
    timers.set(runId, setTimeout(() => {
      const text = 'This is the assembled Polymux chat surface. Connect the send handler to your agent backend when it is ready.';
      if (isActivityDemo) {
        const args = {path: '/skills/computer-use/SKILL.md'};
        emit(runId, request.conversationId, 'tool.completed', {toolCall: {id: 'demo-skill-read-3', name: 'read', arguments: args}, result: {content: 'Read the unified computer-use workflow.'}});
        items.push(message(crypto.randomUUID(), request.conversationId, 'assistant', [], Date.now() - 2, runId, {phase: 'commentary'}));
        items.push(message(crypto.randomUUID(), request.conversationId, 'assistant', [], Date.now() - 1, runId, {phase: 'commentary'}));
      }
      emit(runId, request.conversationId, 'message.text.delta', {delta: text});
      emit(runId, request.conversationId, 'message.completed', {message: {role: 'assistant', content: [{type: 'text', text}]}, phase: 'final'});
      items.push(message(crypto.randomUUID(), request.conversationId, 'assistant', [{type: 'text', text}], Date.now(), runId, {phase: 'final'}));
      finishDemoRun(runId, 'run.completed', {hadWorkActivity: isActivityDemo, lastAgentMessage: text, durationMs: duration});
    }, duration));
    return {runId};
  }

  function finishDemoRun(runId: string, type: 'run.completed' | 'run.cancelled', result: Record<string, JsonValue> = {}): void {
    const conversationId = runConversations.get(runId);
    if (!conversationId) return;
    const timer = timers.get(runId);
    if (timer) clearTimeout(timer);
    timers.delete(runId);
    runConversations.delete(runId);
    emit(runId, conversationId, type, {result});
    queueMicrotask(() => emit(runId, conversationId, 'run.settled', {}));
  }

  let emitSequence = 0;
  function emit(
    runId: string,
    conversationId: string,
    type: string,
    body: Record<string, JsonValue>,
    parentRunId: string | null = null,
  ): void {
    // A real run's events carry increasing sequences, and the renderer keys
    // per-event UI (like tool sub-steps) off them, so the demo must too.
    const sequence = ++emitSequence;
    const event: RunEventDto = {runId, conversationId, parentRunId, sequence, timestamp: Date.now(), type, payload: {runId, conversationId, sequence, timestamp: Date.now(), type, ...body}};
    for (const listener of listeners) listener(event);
  }

  return api;
}

/** One row per state the schedule view draws differently. */
function demoSchedules(now: number, hour: number): ScheduleDto[] {
  return [
    {
      id: 'demo-brief',
      title: 'Morning brief',
      prompt: 'Summarise my inbox and calendar for the day.',
      frequency: {kind: 'weekly', days: [1, 2, 3, 4, 5], time: '08:00'},
      status: 'active',
      createdAt: now - 30 * 24 * hour,
      nextRunAt: now + 14 * hour,
      lastRunAt: now - 10 * hour,
      unread: true,
      history: [{
        id: 'demo-brief-run',
        startedAt: now - 10 * hour,
        finishedAt: now - 10 * hour + 42_000,
        outcome: 'succeeded',
        conversationId: 'welcome',
        summary: 'Read 24 new messages, flagged 3 needing a reply today, and listed the four meetings on the calendar with their prep notes.',
      }],
    },
    {
      id: 'demo-inbox',
      title: 'Triage inbox',
      prompt: 'Triage new mail and flag anything that needs a reply.',
      frequency: {kind: 'hourly', interval: 2},
      status: 'running',
      createdAt: now - 20 * 24 * hour,
      nextRunAt: now + 2 * hour,
      lastRunAt: now - hour,
      unread: false,
      history: [{id: 'demo-inbox-run', startedAt: now - 60_000, outcome: 'running'}],
    },
    {
      id: 'demo-report',
      title: 'Weekly spend report',
      prompt: 'Total this week’s spend and compare it to last week.',
      frequency: {kind: 'weekly', days: [5], time: '17:00'},
      status: 'paused',
      createdAt: now - 60 * 24 * hour,
      lastRunAt: now - 96 * hour,
      unread: false,
      history: [],
    },
    {
      id: 'demo-backup',
      title: 'Archive finished work',
      prompt: 'Move finished documents into the archive folder.',
      frequency: {kind: 'weekly', days: [0], time: '02:00'},
      status: 'failed',
      createdAt: now - 90 * 24 * hour,
      nextRunAt: now + 70 * hour,
      lastRunAt: now - 98 * hour,
      unread: true,
      history: [{
        id: 'demo-backup-run',
        startedAt: now - 98 * hour,
        finishedAt: now - 98 * hour + 9_000,
        outcome: 'failed',
        error: 'The archive folder is not connected in Drive.',
      }],
    },
    {
      id: 'demo-invite',
      title: 'Send the launch invite',
      prompt: 'Email the launch invitation to the press list.',
      frequency: {kind: 'once', at: now - 26 * hour},
      status: 'done',
      createdAt: now - 5 * 24 * hour,
      lastRunAt: now - 26 * hour,
      unread: false,
      history: [{
        id: 'demo-invite-run',
        startedAt: now - 26 * hour,
        finishedAt: now - 26 * hour + 18_000,
        outcome: 'succeeded',
        conversationId: 'research',
        summary: 'Sent the invitation to all 38 addresses on the press list and saved the delivery report to Drive.',
      }],
    },
  ];
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

/**
 * One provider of each shape, so the settings tab can be worked on in a browser
 * without credentials: connected, connectable, needing a form, and one this
 * build has no client id for.
 */
const demoDriveStatus: DriveStatusDto = {
  saveOrder: ['google-drive', 'dropbox', 'onedrive', 's3', 'local'],
  providers: [
    {id: 'local', name: 'Local', kind: 'local', state: 'connected', accounts: [{id: 'local', name: 'Polymux', email: null}], usage: {used: 412_000_000_000, total: 994_000_000_000, appUsed: 52_000_000_000}, root: '/demo/Polymux', error: null},
    // A share that is not mounted right now, which is the state worth seeing:
    // it stays listed so it can be reconnected or forgotten.
    {id: 'network', name: 'Network', kind: 'network', state: 'logged-out', accounts: [], usage: null, root: null, error: null},
    {id: 'google-drive', name: 'Google Drive', kind: 'oauth', state: 'connected', accounts: [{id: 'demo@example.com', name: 'Demo User', email: 'demo@example.com'}], usage: {used: 6_200_000_000, total: 15_000_000_000, appUsed: 1_200_000_000}, root: 'Polymux', error: null},
    {id: 'dropbox', name: 'Dropbox', kind: 'oauth', state: 'logged-out', accounts: [], usage: null, root: null, error: null},
    {id: 'onedrive', name: 'OneDrive', kind: 'oauth', state: 'unconfigured', accounts: [], usage: null, root: null, error: 'This build has no OneDrive client credentials.'},
    {id: 's3', name: 'S3 storage', kind: 's3', state: 'logged-out', accounts: [], usage: null, root: null, error: null},
  ],
  // Two local places plus one signed-in account, which is enough for the
  // switcher to show a provider icon next to an account name.
  sources: [
    // The virtual drive the manager now puts at the head of the list: every
    // connected place at once, which is what the workspace opens into.
    {id: 'all#all', provider: 'all', accountId: 'all', name: 'All storage', accountLabel: null, state: 'connected', usage: {used: 418_200_000_000, total: 1_009_000_000_000, appUsed: 53_200_000_000}, root: '', error: null},
    {id: 'local#outputs', provider: 'local', accountId: 'outputs', name: 'Local', accountLabel: null, state: 'connected', usage: {used: 412_000_000_000, total: 994_000_000_000, appUsed: 52_000_000_000}, root: '/demo/Documents/Polymux', error: null},
    {id: 'local#home', provider: 'local', accountId: 'home', name: 'Local', accountLabel: null, state: 'connected', usage: {used: 412_000_000_000, total: 994_000_000_000, appUsed: null}, root: '/demo/home', error: null},
    {id: 'google-drive#default', provider: 'google-drive', accountId: 'default', name: 'Google Drive', accountLabel: 'demo@example.com', state: 'connected', usage: {used: 6_200_000_000, total: 15_000_000_000, appUsed: 1_200_000_000}, root: 'Polymux', error: null},
  ],
};

function demoDriveConnect(provider: DriveProviderId, connected: boolean): DriveStatusDto {
  demoDriveStatus.providers = demoDriveStatus.providers.map((entry) =>
    entry.id === provider
      ? {
          ...entry,
          state: connected ? 'connected' : 'logged-out',
          accounts: connected ? [{id: 'demo@example.com', name: 'Demo User', email: 'demo@example.com'}] : [],
          usage: connected ? {used: 1_200_000_000, total: 10_000_000_000, appUsed: 18_000_000} : null,
        }
      : entry);
  return demoDriveStatus;
}

/**
 * The demo drive's contents, keyed `<provider>:<path>` and mutated in place.
 *
 * Stateful on purpose: a stub that always answered with the same two rows made
 * creating, uploading and deleting look like they did nothing, which is exactly
 * the failure the real drive must not have.
 */
const demoDriveFolders = new Map<string, DriveEntryDto[]>();
let demoDriveUploads = 0;

function demoDriveFolder(source: string, path: string): DriveEntryDto[] {
  const key = `${source}:${path}`;
  const known = demoDriveFolders.get(key);
  if (known) return known;
  const seeded = path ? [] : demoDriveSeed(source);
  demoDriveFolders.set(key, seeded);
  return seeded;
}

/** Finds an entry wherever it currently sits. */
function demoDriveFind(source: string, path: string): DriveEntryDto | undefined {
  for (const [key, entries] of demoDriveFolders) {
    if (!key.startsWith(`${source}:`)) continue;
    const found = entries.find((entry) => entry.path === path);
    if (found) return found;
  }
  return undefined;
}

function demoDriveSeed(source: string): DriveEntryDto[] {
  const now = new Date().toISOString();
  const {provider} = parseDriveSourceId(source);
  // The virtual drive is every place at once, so its root mixes providers —
  // which is the only way to see the badge doing its job: an unmarked file is
  // on this Mac, a marked one says where it actually lives.
  if (provider === 'all')
    return [
      {id: 'all#all/Reports', name: 'Reports', kind: 'folder', size: null, modifiedAt: now, provider: 'google-drive', path: 'all#all/Reports', mimeType: null},
      {id: 'all#all/Launch brief.docx', name: 'Launch brief.docx', kind: 'file', size: 48_310, modifiedAt: now, provider: 'google-drive', path: 'all#all/Launch brief.docx', mimeType: null},
      {id: 'all#all/Budget.xlsx', name: 'Budget.xlsx', kind: 'file', size: 21_004, modifiedAt: now, provider: 'dropbox', path: 'all#all/Budget.xlsx', mimeType: null},
      {id: 'all#all/Notes.md', name: 'Notes.md', kind: 'file', size: 1_820, modifiedAt: now, provider: 'local', path: 'all#all/Notes.md', mimeType: null},
    ];
  return [
    // Slash-separated so the parent of an entry can be read off its path, the
    // way every real provider's addressing allows.
    {id: '/Reports', name: 'Reports', kind: 'folder', size: null, modifiedAt: now, provider, path: '/Reports', mimeType: null},
    {id: '/Launch brief.docx', name: 'Launch brief.docx', kind: 'file', size: 48_310, modifiedAt: now, provider, path: '/Launch brief.docx', mimeType: null},
  ];
}

function demoArtifacts(conversationId: string): ArtifactDto[] {
  return [{id: 'launch-brief', conversationId, runId: null, kind: 'document', name: 'Launch brief.docx', path: '/tmp/Launch brief.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), metadata: {}}];
}

function demoBrowserDownloadState(
  id: string,
  state: BrowserDownloadDto['state'],
): BrowserDownloadDto[] {
  const entry = demoBrowserDownloads.find((row) => row.id === id);
  if (entry) entry.state = state;
  return [...demoBrowserDownloads];
}

function demoReferences(conversationId: string): ReferenceDto[] {
  return [{id: 'polymux-site', conversationId, runId: null, kind: 'web', title: 'polymux.com', uri: 'https://polymux.com', createdAt: new Date().toISOString(), metadata: {}}];
}

/**
 * The demo browser's own state, mutated in place.
 *
 * Stateful for the same reason the demo drive is: a stub that always answered
 * with the same rows made saving, revealing and clearing look like they did
 * nothing, which is exactly the failure the real tab must not have. The
 * passwords are obvious fakes — this file ships in the renderer bundle.
 */
const demoBrowserSettings: BrowserSettingsDto = {
  downloadDirectory: '/demo/Downloads',
  askWhereToSave: false,
  autofillEnabled: true,
};

const demoBrowserLogins: SavedLoginDto[] = [
  {id: 'login-github', origin: 'https://github.com', username: 'demo@example.com', source: 'manual', updatedAt: '2026-08-17T09:00:00.000Z', lastUsedAt: '2026-08-17T10:00:00.000Z'},
  {id: 'login-notion', origin: 'https://www.notion.so', username: 'demo@example.com', source: 'import', updatedAt: '2026-08-16T09:00:00.000Z', lastUsedAt: null},
];

const demoBrowserPasswords = new Map<string, string>([
  ['login-github', 'correct-horse-battery'],
  ['login-notion', 'demo-password-2'],
]);

const demoBrowserDownloads: BrowserDownloadDto[] = [
  {id: 'download-1', title: 'report (1).pdf', path: '/demo/Downloads/report (1).pdf', kind: 'pdf', completedAt: '14:20', url: 'https://files.example/report.pdf', state: 'completed', receivedBytes: 248_000, totalBytes: 248_000},
  {id: 'download-2', title: 'dataset.csv', path: '/demo/Downloads/dataset.csv', kind: 'spreadsheet', completedAt: '14:18', url: 'https://files.example/dataset.csv', state: 'progressing', receivedBytes: 4_200_000, totalBytes: 11_800_000},
];

let demoBrowserPermissions: SitePermissionDto[] = [
  {origin: 'https://maps.example.com', permission: 'geolocation', decision: 'allow', updatedAt: '2026-08-17T09:00:00.000Z'},
  {origin: 'https://news.example.com', permission: 'notifications', decision: 'deny', updatedAt: '2026-08-17T09:00:00.000Z'},
];

let demoBrowserSites: BrowserSiteDto[] = [
  {origin: 'https://github.com', cookies: 14, permissions: 0, logins: 1},
  {origin: 'https://maps.example.com', cookies: 3, permissions: 1, logins: 0},
];

const demoBrowserHistory: BrowserHistoryEntryDto[] = [
  {url: 'https://github.com/anthropics', title: 'Anthropic · GitHub', visitedAt: '2026-08-18T09:10:00.000Z', visitCount: 12, source: 'local'},
  {url: 'https://www.notion.so/Roadmap', title: 'Roadmap', visitedAt: '2026-08-18T08:40:00.000Z', visitCount: 3, source: 'local'},
  {url: 'https://news.ycombinator.com/', title: 'Hacker News', visitedAt: '2026-08-17T21:02:00.000Z', visitCount: 48, source: 'import'},
];

const demoBrowserSources: BrowserSourceDto[] = [
  {
    id: 'chromium:chrome',
    name: 'Google Chrome',
    family: 'chromium',
    profiles: [{id: 'Default', name: 'Person 1', path: '/demo/Chrome/Default', readable: true, reason: null}],
    fileImportOnly: false,
  },
  {
    id: 'safari',
    name: 'Safari',
    family: 'safari',
    // The real Safari source reports exactly this when the app has no Full
    // Disk Access, so the demo shows the state the user is most likely to hit.
    profiles: [{id: 'safari', name: 'Safari', path: '/demo/Safari', readable: false, reason: 'Polymux needs Full Disk Access to read Safari’s cookies.'}],
    fileImportOnly: true,
  },
];
