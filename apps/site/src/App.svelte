<script lang="ts">
  import {onMount} from 'svelte';
  import chatScreenshot from '../../../docs/assets/polymux-chat.png';
  import driveScreenshot from '../../../docs/assets/polymux-drive-expanded.png';
  import hubScreenshot from '../../../docs/assets/polymux-hub-expanded.png';
  import browserScreenshot from '../../../docs/assets/polymux-browser-expanded.png';
  import {COMMS_EMAIL_PRESETS, COMMS_PLATFORMS} from '../../../packages/protocol/src/validation';
  import logo from '../../desktop/src/renderer/public/polymux.svg';
  import {bridgeLogo, mailLogo} from '../../desktop/src/renderer/lib/shared/options/platformBrands';
  import github from 'simple-icons/icons/github.svg?url';
  import DownloadIcon from './lib/DownloadIcon.svelte';
  import MobileMenu from './lib/MobileMenu.svelte';
  import ProductMenu from './lib/ProductMenu.svelte';

  type SupportedPlatform = 'macos' | 'windows' | 'linux';
  type Platform = SupportedPlatform | 'other';
  type DownloadAsset = {name: string; url: string; size: number};
  type Release = {version: string | null; releaseUrl: string; platforms: Record<SupportedPlatform, DownloadAsset | null>};
  type ConnectedApp = {id: string; name: string; icon: string};
  type ConnectionGroup = {name: string; detail: string; apps: ConnectedApp[]};

  const releaseUrl = 'https://github.com/CarlvinceTan/Polymux/releases/latest';
  const platformCopy: Record<Platform, {action: string; detail: string}> = {
    macos: {action: 'Download', detail: 'Apple silicon'},
    windows: {action: 'Download for Windows', detail: 'Windows 10 or later · x64'},
    linux: {action: 'Download for Linux', detail: 'AppImage · x64'},
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
  const platformCountFloor = Math.floor((messagingPlatforms.length + emailProviders.length) / 10) * 10;
  const connections: ConnectionGroup[] = [
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
  let release = $state<Release | null>(null);
  let copy = $derived(platformCopy[platform]);
  let download = $derived(platform === 'other' ? null : release?.platforms[platform] ?? null);
  let downloadUrl = $derived(download?.url ?? release?.releaseUrl ?? releaseUrl);
  let versionLabel = $derived(release?.version ? `Version ${release.version}` : 'Latest release');

  function detectPlatform(): Platform {
    const client = navigator as Navigator & {userAgentData?: {platform?: string}};
    const reported = `${client.userAgentData?.platform ?? ''} ${navigator.platform} ${navigator.userAgent}`.toLowerCase();
    if (/android|iphone|ipad|ipod/.test(reported)) return 'other';
    if (reported.includes('win')) return 'windows';
    if (reported.includes('linux') || reported.includes('x11')) return 'linux';
    return 'macos';
  }

  onMount(async () => {
    platform = detectPlatform();
    try {
      const response = await fetch('/api/downloads');
      if (response.ok) release = await response.json() as Release;
    } catch {
      // GitHub Releases remains the fallback when release metadata is unavailable.
    }
  });
</script>

<svelte:head>
  <link rel="icon" type="image/svg+xml" href={logo} />
</svelte:head>

<header class="site-header">
  <div class="header-inner">
    <div class="header-primary">
      <a class="brand" href="#top" aria-label="Polymux home"><img src={logo} alt="" /><span>Polymux</span></a>
      <nav aria-label="Main navigation">
        <a class="active" href="#top">Home</a>
        <ProductMenu />
        <a href="/docs/">Docs</a>
        <a href="/blog/">Blog</a>
        <a href="/releases/">Releases</a>
      </nav>
    </div>
    <div class="header-actions">
      <a class="github-link" href={releaseUrl} aria-label="Polymux on GitHub">
        <img src={github} alt="" />
      </a>
      <a class="download-link" href={downloadUrl}><DownloadIcon />{copy.action}</a>
    </div>
    <MobileMenu active="home" downloadHref={downloadUrl} />
  </div>
</header>

<main id="top">
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
      <h2 id="connections-title">{platformCountFloor}+ platforms.<br />All in one Hub.</h2>
    </div>
    <div class="connection-map">
      <div class="connection-core"><img src={logo} alt="" /><strong>Polymux Hub</strong></div>
      <div class="connection-groups">
        {#each connections as group (group.name)}
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
  <a href="/blog/">Blog</a>
  <a href="/releases/">Releases</a>
  <a href="/privacy-policy/">Privacy</a>
  <a href={releaseUrl}>GitHub</a>
</footer>
