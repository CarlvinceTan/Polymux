<script lang="ts">
  import {onMount} from 'svelte';
  import chatScreenshot from '../../../docs/assets/polymux-chat.png';
  import driveScreenshot from '../../../docs/assets/polymux-drive-expanded.png';
  import hubScreenshot from '../../../docs/assets/polymux-hub-expanded.png';
  import browserScreenshot from '../../../docs/assets/polymux-browser-expanded.png';
  import logo from '../../desktop/src/renderer/public/polymux.svg';
  import whatsapp from '../../desktop/src/renderer/assets/platforms/whatsapp.svg';
  import telegram from '../../desktop/src/renderer/assets/platforms/telegram.svg';
  import slack from '../../desktop/src/renderer/assets/platforms/slack.svg';
  import discord from '../../desktop/src/renderer/assets/platforms/discord.svg';
  import instagram from '../../desktop/src/renderer/assets/platforms/instagram.svg';
  import messenger from '../../desktop/src/renderer/assets/platforms/messenger.svg';
  import gmail from '../../desktop/src/renderer/assets/platforms/gmail.svg';
  import outlook from '../../desktop/src/renderer/assets/platforms/outlook.svg';
  import googleDrive from '../../../resources/skills/core/drive-use/assets/drive.svg';
  import dropbox from 'simple-icons/icons/dropbox.svg?url';
  import github from 'simple-icons/icons/github.svg?url';
  import openai from '@lobehub/icons-static-svg/icons/openai.svg?url';
  import anthropic from '@lobehub/icons-static-svg/icons/anthropic.svg?url';
  import openrouter from '@lobehub/icons-static-svg/icons/openrouter-color.svg?url';
  import ollama from '@lobehub/icons-static-svg/icons/ollama.svg?url';
  import oneDrive from './assets/onedrive.svg';
  import localFiles from './assets/local-files.svg';

  type SupportedPlatform = 'macos' | 'windows' | 'linux';
  type Platform = SupportedPlatform | 'other';
  type DownloadAsset = {name: string; url: string; size: number};
  type Release = {version: string | null; releaseUrl: string; platforms: Record<SupportedPlatform, DownloadAsset | null>};
  type ConnectedApp = {name: string; icon: string};

  const releaseUrl = 'https://github.com/CarlvinceTan/Polymux/releases/latest';
  const platformCopy: Record<Platform, {action: string; detail: string}> = {
    macos: {action: 'Download for macOS', detail: 'Apple silicon'},
    windows: {action: 'Download for Windows', detail: 'Windows 10 or later · x64'},
    linux: {action: 'Download for Linux', detail: 'AppImage · x64'},
    other: {action: 'View desktop releases', detail: 'macOS · Windows · Linux'},
  };
  const views = [
    {name: 'Drive', description: 'Local and cloud files, together.', image: driveScreenshot},
    {name: 'Hub', description: 'Messages and email in one place.', image: hubScreenshot},
    {name: 'Browser', description: 'Research without leaving the task.', image: browserScreenshot},
  ];
  const connections: {name: string; apps: ConnectedApp[]}[] = [
    {
      name: 'Messages & email',
      apps: [
        {name: 'WhatsApp', icon: whatsapp}, {name: 'Telegram', icon: telegram},
        {name: 'Slack', icon: slack}, {name: 'Discord', icon: discord},
        {name: 'Instagram', icon: instagram}, {name: 'Messenger', icon: messenger},
        {name: 'Gmail', icon: gmail}, {name: 'Outlook', icon: outlook},
      ],
    },
    {name: 'Files', apps: [{name: 'Google Drive', icon: googleDrive}, {name: 'Dropbox', icon: dropbox}, {name: 'OneDrive', icon: oneDrive}, {name: 'Local files', icon: localFiles}]},
    {name: 'AI models', apps: [{name: 'OpenAI', icon: openai}, {name: 'Anthropic', icon: anthropic}, {name: 'OpenRouter', icon: openrouter}, {name: 'Ollama', icon: ollama}]},
  ];
  const connectionCount = connections.reduce((total, group) => total + group.apps.length, 0);

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
        <a href="#workspace">Workspace</a>
      </nav>
    </div>
    <div class="header-actions">
      <a class="github-link" href={releaseUrl} aria-label="Polymux on GitHub">
        <img src={github} alt="" />
      </a>
      <a class="download-link" href={downloadUrl}>{copy.action}</a>
    </div>
  </div>
</header>

<main id="top">
  <section class="hero">
    <div class="hero-copy">
      <p class="eyebrow">Your personal assistant</p>
      <h1>Ready to help.<br />Right from the start.</h1>
      <p class="lede">Chats, email, files, browsing, and your choice of AI models are built in—so you can get things done with almost no setup.</p>
      <div class="actions">
        <a class="primary" href={downloadUrl}>{copy.action}</a>
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
      <h2 id="connections-title">{connectionCount} platforms.<br />Ready when you are.</h2>
      <p>Your assistant can work across the services you already use, without making you assemble the pieces first.</p>
    </div>
    <div class="connection-map">
      <div class="connection-core"><img src={logo} alt="" /><strong>Polymux</strong></div>
      <div class="connection-groups">
        {#each connections as group (group.name)}
          <article>
            <h3><span>{group.name}</span><strong>{group.apps.length}</strong></h3>
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
    <div class="download-action"><a class="primary" href={downloadUrl}>{copy.action}</a><span>{copy.detail} · {versionLabel}</span></div>
  </section>
</main>

<footer>
  <a class="brand" href="#top"><img src={logo} alt="" /><span>Polymux</span></a>
  <p>Your personal assistant for chats, files, and the web.</p>
  <a href="/privacy-policy/">Privacy</a>
  <a href={releaseUrl}>GitHub</a>
</footer>
