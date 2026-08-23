<script lang="ts">
  import {onMount} from 'svelte';

  type SupportedPlatform = 'macos' | 'windows' | 'linux';
  type Platform = SupportedPlatform | 'other';
  type DownloadAsset = {name: string; url: string; size: number};
  type Release = {
    version: string | null;
    releaseUrl: string;
    platforms: Record<SupportedPlatform, DownloadAsset | null> & {linuxRpm: DownloadAsset | null};
  };

  const releaseUrl = 'https://github.com/CarlvinceTan/Polymux/releases/latest';
  const platformCopy: Record<Platform, {name: string; detail: string; format: string; action: string}> = {
    macos: {name: 'macOS', detail: 'Apple silicon', format: '.dmg', action: 'Download for macOS'},
    windows: {name: 'Windows', detail: 'Windows 10 or later · x64', format: 'Setup.exe', action: 'Download for Windows'},
    linux: {name: 'Linux', detail: 'Ubuntu / Debian · x64', format: '.deb', action: 'Download for Linux'},
    other: {name: 'desktop', detail: 'macOS · Windows · Linux', format: 'releases', action: 'View desktop releases'},
  };
  let platform: Platform = 'macos';
  let release: Release | null = null;

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
      // GitHub Releases remains the fallback before the first public release
      // and whenever the metadata endpoint is temporarily unavailable.
    }
  });

  $: copy = platformCopy[platform];
  $: download = platform === 'other' ? null : release?.platforms[platform] ?? null;
  $: downloadUrl = download?.url ?? release?.releaseUrl ?? releaseUrl;
  $: versionLabel = release?.version ? `Version ${release.version}` : 'Latest release';
  const sources = ['Messages', 'Email', 'Drive', 'Dropbox', 'Browser', 'Local files'];
  const features = [
    ['01', 'Every conversation', 'Work across messaging and email without rebuilding context in another tab.'],
    ['02', 'Every file', 'Search local folders and cloud drives together, then use what Polymux finds.'],
    ['03', 'Any model', 'Choose a hosted provider or run locally. Your workspace stays the same.'],
    ['04', 'A browser inside', 'Research and act on the web without leaving the thread.'],
    ['05', 'Useful from launch', 'Skills, memory, schedules, and sensible defaults arrive assembled.']
  ];
</script>

<svelte:head><title>Polymux — Your digital life, in one place</title><meta name="description" content="One focused workspace for your messages, files, browser, and AI models." /></svelte:head>

<header class="site-header">
  <a class="brand" href="#top" aria-label="Polymux home"><span class="mark" aria-hidden="true"><i></i><i></i><i></i></span>Polymux</a>
  <nav aria-label="Main navigation"><a href="#why">Why</a><a href="#product">Product</a><a href={releaseUrl}>Releases</a></nav>
  <a class="download-link" href="#download">Download ↘</a>
</header>

<main id="top">
  <section class="hero grid-paper">
    <div class="index"><span>POLYMUX / 001</span><span>DESKTOP INTELLIGENCE</span></div>
    <div class="hero-layout">
      <div><p class="eyebrow">One workspace · every conversation</p><h1>Your digital life,<br/><em>in one place.</em></h1><p class="lede">Polymux brings your messages, files, browser, and AI models into one calm workspace—already configured and ready to use.</p><div class="actions"><a class="primary" href={downloadUrl}>{copy.action} <span>↓</span></a><a href="#product">Explore the workspace ↘</a></div><p class="availability">{copy.detail} · {versionLabel}</p></div>
      <aside class="margin-note"><div><p class="eyebrow">The premise</p><p>Your assistant should meet your tools where they are.</p></div><div class="palette"><i></i><i></i><i></i><i></i></div><small>Private by default<br/>Local when you want it<br/>Useful before setup</small></aside>
    </div>

    <div class="product-stage" aria-label="Preview of the Polymux workspace">
      <span class="stage-caption">CONNECTED CONTEXT</span>
      <div class="app-window"><div class="window-bar"><i></i><i></i><i></i><b>Polymux / Today</b></div><div class="app-layout">
        <aside class="app-nav"><span class="app-logo"></span><small>SPACES</small><b>All activity</b><span>Messages</span><span>Files</span><span>Browser</span><span>Models</span><span class="bottom">Settings</span></aside>
        <div class="source-list"><small>CONNECTED SOURCES</small><div><b>WhatsApp</b><span>12 threads</span></div><div><b>Drive</b><span>8 documents</span></div><div><b>Local files</b><span>Private</span></div><div><b>Browser</b><span>3 tabs</span></div></div>
        <div class="conversation"><header><span>Launch planning</span><small>4 sources in context</small></header><div class="prompt">Summarise everything related to the launch.</div><div class="trace"><i></i>Reading the relevant threads and files</div><div class="response"><b>The release is nearly ready.</b><p>macOS packaging has passed. The remaining decision is the final launch date, mentioned in the project thread and release brief.</p><div><span>WhatsApp · Project</span><span>Drive · Launch brief.pdf</span></div></div><div class="composer"><span>Ask across everything</span><b>↑</b></div></div>
      </div></div>
      <div class="route left">MESSAGES</div><div class="route right">FILES</div>
    </div>
  </section>

  <section class="source-ribbon"><p>Bring the places you already use</p><div>{#each sources as source (source)}<span>{source}</span>{/each}</div></section>

  <section class="manifesto grid-paper" id="why"><span class="section-number">01 / THE PROBLEM</span><div class="manifesto-grid"><h2>Your context is scattered.<br/><em>Your assistant shouldn’t be.</em></h2><div><p>Most assistants begin with an empty box. The useful parts of your life remain divided between inboxes, drives, browser tabs, and separate AI tools.</p><p>Polymux connects the surfaces you already use. Ask once; it finds the right context, keeps the thread, and shows where the answer came from.</p></div></div></section>

  <section class="product" id="product">
    <header class="section-heading"><span class="section-number">02 / THE WORKSPACE</span><h2>One question.<br/><em>Everywhere it matters.</em></h2></header>
    <article><div class="story-copy"><span>COMMUNICATE / 01</span><h3>Every conversation becomes one clear thread.</h3><p>Read, search, and work across messaging and email without moving information between apps.</p></div><div class="story-art messages"><div class="message"><i>W</i><span><b>Project group</b><small>Decision recorded · now</small></span><time>02</time></div><div class="message"><i>@</i><span><b>Course allocation</b><small>Action needed · 8m</small></span><time>01</time></div><div class="reply"><small>PREPARED REPLY</small><p>I checked the brief and can send the final version this afternoon.</p><span>Review before sending ↗</span></div></div></article>
    <article class="reverse"><div class="story-copy"><span>FIND + USE / 02</span><h3>Your files become part of the answer.</h3><p>Local folders, Drive, Dropbox, and OneDrive stay where they are. Polymux makes them usable together.</p></div><div class="story-art files"><div class="file-head"><b>Project files</b><span>Drive / Polymux / Release</span></div><div class="file"><i>PDF</i><span><b>Launch brief.pdf</b><small>Edited 12 minutes ago</small></span></div><div class="file"><i>DOC</i><span><b>Release notes.docx</b><small>Edited yesterday</small></span></div><blockquote>“The public release stays macOS-only until target-device QA is complete.”<small>Launch brief.pdf · page 2</small></blockquote></div></article>
    <article><div class="story-copy"><span>CHOOSE / 03</span><h3>Use the right model. Keep your workspace.</h3><p>Connect providers you trust, switch by task, or run locally. Polymux handles the plumbing.</p></div><div class="story-art model-map"><div class="model-core"><span class="mark"><i></i><i></i><i></i></span><b>Polymux</b></div><span>OpenAI</span><span>Anthropic</span><span>OpenRouter</span><span>Ollama</span><span>llama.cpp</span></div></article>
  </section>

  <section class="capabilities grid-paper"><div class="cap-heading"><span class="section-number">03 / BUILT IN</span><h2>The tools are<br/><em>already here.</em></h2><p>A complete desktop environment, not an empty chat box with a settings manual.</p></div><div class="feature-list">{#each features as feature (feature[0])}<article><span>{feature[0]}</span><h3>{feature[1]}</h3><p>{feature[2]}</p><i>↗</i></article>{/each}</div></section>

  <section class="local"><div><span class="section-number red">04 / LOCAL WHEN YOU WANT IT</span><h2>Your computer<br/>can be the cloud.</h2><p>Keep files on your machine, run compatible models locally, and choose exactly which services Polymux can use.</p></div><div class="terminal"><header><i></i><i></i><i></i><span>Local runtime</span></header><pre><em>●</em> llama.cpp connected

model      qwen3.5-27b
context    14,820 / 32,768
route      this Mac

<b>Ready. No cloud key required.</b></pre></div></section>

  <section class="download grid-paper" id="download"><div><span class="section-number">05 / GET POLYMUX</span><h2>Less setup.<br/><em>Less switching.</em></h2></div><div class="download-card"><span class="mark big"><i></i><i></i><i></i></span><div><h3>Polymux for {copy.name}</h3><p>{copy.detail} · {versionLabel}</p></div><a class="primary red-bg" href={downloadUrl}>{platform === 'other' ? 'View releases' : `Download ${copy.format}`} <span>↓</span></a><small>{#if platform === 'linux'}RPM and other files are on <a href={release?.releaseUrl ?? releaseUrl}>GitHub Releases</a>.{:else if platform === 'other'}Open this page on your desktop for an automatic installer choice.{:else if !download}The first public installer will appear here after release.{:else}Installer selected automatically for this device.{/if}</small></div></section>
</main>

<footer><a class="brand" href="#top"><span class="mark"><i></i><i></i><i></i></span>Polymux</a><p>Your digital life, in one place.</p><div><a href={releaseUrl}>GitHub</a><a href="#product">Product</a><a href="#download">Download</a></div><small>© 2026 Polymux</small></footer>
