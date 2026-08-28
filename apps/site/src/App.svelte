<script lang="ts">
  import {onMount} from 'svelte';
  import chatScreenshot from '../../../docs/assets/polymux-chat.png';
  import driveScreenshot from '../../../docs/assets/polymux-drive-expanded.png';
  import hubScreenshot from '../../../docs/assets/polymux-hub-expanded.png';
  import browserScreenshot from '../../../docs/assets/polymux-browser-expanded.png';
  import {COMMS_EMAIL_PRESETS, COMMS_PLATFORMS} from '../../../packages/protocol/src/validation';
  import logo from '../../desktop/src/renderer/public/polymux.svg';
  import {bridgeLogo, mailLogo} from './lib/platformBrands';
  import claudeLogo from '@lobehub/icons-static-svg/icons/claude-color.svg?url';
  import codexLogo from '@lobehub/icons-static-svg/icons/codex-color.svg?url';
  import cursorLogo from '@lobehub/icons-static-svg/icons/cursor.svg?url';
  import geminiLogo from '@lobehub/icons-static-svg/icons/gemini-color.svg?url';
  import githubCopilotLogo from '@lobehub/icons-static-svg/icons/githubcopilot.svg?url';
  import openCodeLogo from '@lobehub/icons-static-svg/icons/opencode.svg?url';
  import github from 'simple-icons/icons/github.svg?url';
  import DriveProviderLogo from './lib/DriveProviderLogo.svelte';
  import DownloadIcon from './lib/DownloadIcon.svelte';
  import MobileMenu from './lib/MobileMenu.svelte';
  import {detectPlatform, PLATFORM_DETAILS, type Platform, type ReleaseDownloads} from './lib/platform';

  type ConnectedApp = {id: string; name: string; icon: string};
  type ConnectionGroup = {name: string; detail: string; apps: ConnectedApp[]};

  const releaseUrl = 'https://github.com/CarlvinceTan/Polymux/releases/latest';
  const platformCopy: Record<Platform, {action: string; detail: string}> = {
    macos: {action: 'Download', detail: PLATFORM_DETAILS.macos},
    windows: {action: 'Download for Windows', detail: PLATFORM_DETAILS.windows},
    linux: {action: 'Download for Linux', detail: PLATFORM_DETAILS.linux},
    other: {action: 'View desktop releases', detail: 'macOS · Windows · Linux'},
  };
  const views = [
    {name: 'Drive', description: 'Local and cloud files, together.', image: driveScreenshot},
    {name: 'Hub', description: 'Messages and email in one place.', image: hubScreenshot},
    {name: 'Browser', description: 'Research without leaving the task.', image: browserScreenshot},
  ];
  const messagingPlatforms: ConnectedApp[] = COMMS_PLATFORMS
    .filter(({value}) => value !== 'matrix')
    .map(({value, label}) => ({id: value, name: label, icon: bridgeLogo(value) ?? ''}));
  const emailNames: Record<string, string> = {
    gmail: 'Gmail',
    outlook: 'Outlook',
    icloud: 'iCloud Mail',
    lark: 'Lark',
    fastmail: 'Fastmail',
    custom: 'Any IMAP',
  };
  const emailProviders: ConnectedApp[] = COMMS_EMAIL_PRESETS.map(({value, label}) => ({
    id: value,
    name: emailNames[value] ?? label,
    icon: mailLogo(value) ?? '',
  }));
  const featuredMessagingIds = new Set([
    'whatsapp', 'telegram', 'signal', 'messenger',
    'instagram', 'discord', 'slack', 'imessage',
  ]);
  const featuredEmailIds = new Set(['gmail', 'outlook', 'icloud', 'fastmail']);
  const featuredStorage = [
    {id: 'local', name: 'Local'},
    {id: 'network', name: 'Network'},
    {id: 'google-drive', name: 'Google Drive'},
    {id: 'dropbox', name: 'Dropbox'},
    {id: 'onedrive', name: 'OneDrive'},
    {id: 's3', name: 'S3'},
  ] as const;
  const featuredAgents: ConnectedApp[] = [
    {id: 'codex-acp', name: 'Codex', icon: codexLogo},
    {id: 'claude-acp', name: 'Claude', icon: claudeLogo},
    {id: 'gemini', name: 'Gemini CLI', icon: geminiLogo},
    {id: 'opencode', name: 'OpenCode', icon: openCodeLogo},
    {id: 'cursor', name: 'Cursor', icon: cursorLogo},
    {id: 'github-copilot-cli', name: 'Copilot', icon: githubCopilotLogo},
  ];
  const connectionCountFloor = Math.floor((
    messagingPlatforms.length + emailProviders.length + featuredStorage.length + featuredAgents.length
  ) / 10) * 10;
  const communicationGroups: ConnectionGroup[] = [
    {
      name: 'Messaging',
      detail: `${messagingPlatforms.length} services`,
      apps: messagingPlatforms.filter(({id}) => featuredMessagingIds.has(id)),
    },
    {
      name: 'Email',
      detail: 'Any IMAP',
      apps: emailProviders.filter(({id}) => featuredEmailIds.has(id)),
    },
  ];

  let platform = $state<Platform>('macos');
  let release = $state<ReleaseDownloads | null>(null);
  let copy = $derived(platformCopy[platform]);
  let download = $derived(platform === 'other' ? null : release?.platforms[platform] ?? null);
  let downloadUrl = $derived(download?.url ?? release?.releaseUrl ?? releaseUrl);
  let versionLabel = $derived(release?.version ? `Version ${release.version}` : 'Latest release');

  onMount(async () => {
    platform = detectPlatform();
    try {
      const response = await fetch('/api/downloads');
      if (response.ok) release = await response.json() as ReleaseDownloads;
    } catch {
      // GitHub Releases remains the fallback when release metadata is unavailable.
    }
  });
</script>

<svelte:head>
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
</svelte:head>

<header id="top" class="site-shell-header">
  <div class="site-shell-inner">
    <div class="site-shell-primary">
      <a class="site-shell-brand" href="#top" aria-label="Polymux home"><img src={logo} alt="" /><span>Polymux</span></a>
      <nav class="site-shell-nav" aria-label="Main navigation">
        <a class="active" href="#top">Home</a>
        <a href="/docs/">Docs</a>
        <a href="/releases/">Releases</a>
      </nav>
    </div>
    <div class="site-shell-actions">
      <a class="site-shell-github" href={releaseUrl} aria-label="Polymux on GitHub">
        <img src={github} alt="" />
      </a>
      <a class="site-shell-download" href={downloadUrl}><DownloadIcon />{copy.action}</a>
    </div>
    <MobileMenu active="home" downloadHref={downloadUrl} />
  </div>
</header>

<main>
  <section class="hero">
    <div class="hero-copy">
      <p class="eyebrow">Your personal assistant</p>
      <h1>Ready to help.<br />Right from the start.</h1>
      <p class="lede">Chats, email, files, browsing, and your choice of AI models are built in—so you can get things done with almost no setup.</p>
      <div class="actions">
        <a class="primary download-cta" href={downloadUrl}><DownloadIcon />{copy.action}</a>
        <a class="secondary" href="#workspace">See how it works <span>↓</span></a>
      </div>
      <p class="availability">{copy.detail} · {versionLabel}</p>
    </div>
    <figure class="window-shot">
      <img src={chatScreenshot} alt="Polymux desktop app showing chats, files, and tasks in one workspace" />
    </figure>
  </section>

  <section class="connections" aria-labelledby="connections-title">
    <div class="connections-heading">
      <p class="eyebrow">Built in, not bolted on</p>
      <h2 id="connections-title">{connectionCountFloor}+ connections.<br />One Polymux.</h2>
    </div>
    <div class="connection-map">
      <div class="connection-tier connection-tier-top">
        <article>
          <h3><span>Storage</span><strong>{featuredStorage.length} sources</strong></h3>
          <div class="app-grid">
            {#each featuredStorage as provider (provider.id)}
              <div class="app-node">
                <DriveProviderLogo provider={provider.id} size={25} />
                <small>{provider.name}</small>
              </div>
            {/each}
          </div>
        </article>
        <article>
          <h3><span>Agents</span><strong>ACP</strong></h3>
          <div class="app-grid">
            {#each featuredAgents as agent (agent.id)}
              <div class="app-node">
                <img src={agent.icon} alt="" />
                <small>{agent.name}</small>
              </div>
            {/each}
          </div>
        </article>
      </div>
      <div class="connection-core"><img src={logo} alt="" /><strong>Polymux</strong></div>
      <div class="connection-tier connection-tier-bottom">
        {#each communicationGroups as group (group.name)}
          <article>
            <h3><span>{group.name}</span><strong>{group.detail}</strong></h3>
            <div class="app-grid">
              {#each group.apps as app (app.name)}
                <div class="app-node">
                  <img src={app.icon} alt="" />
                  <small>{app.name}</small>
                </div>
              {/each}
            </div>
          </article>
        {/each}
      </div>
    </div>
  </section>

  <section class="intro" id="workspace">
    <p class="eyebrow">One assistant, all your work</p>
    <h2>Just ask. Polymux finds the right conversation, file, or page.</h2>
  </section>

  <section class="views" aria-label="Polymux workspace views">
    {#each views as view (view.name)}
      <article>
        <div class="view-copy"><h3>{view.name}</h3><p>{view.description}</p></div>
        <img src={view.image} alt={`Polymux ${view.name} view`} loading="lazy" />
      </article>
    {/each}
  </section>

  <section class="simple">
    <p class="eyebrow">Set up your way</p>
    <h2>Choose your model.<br />Everything else is ready.</h2>
    <p>Use a hosted provider or run locally. Polymux keeps the rest of your workspace together.</p>
  </section>

  <section class="download" id="download">
    <div><p class="eyebrow">Get Polymux</p><h2>Your personal assistant.<br />Ready in minutes.</h2></div>
    <div class="download-action"><a class="primary download-cta" href={downloadUrl}><DownloadIcon />{copy.action}</a><span>{copy.detail} · {versionLabel}</span></div>
  </section>
</main>

<footer>
  <a class="brand" href="#top"><img src={logo} alt="" /><span>Polymux</span></a>
  <p>Your personal assistant for chats, files, and the web.</p>
  <a href="/product/">Product</a>
  <a href="/docs/">Docs</a>
  <a href="/releases/">Releases</a>
  <a href="/privacy-policy/">Privacy</a>
  <a href={releaseUrl}>GitHub</a>
</footer>
