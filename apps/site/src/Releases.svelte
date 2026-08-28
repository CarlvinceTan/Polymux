<script lang="ts">
  import {onMount} from 'svelte';
  import github from 'simple-icons/icons/github.svg?url';
  import logo from '../../desktop/src/renderer/public/polymux.svg';
  import {formatReleaseDate, formatReleaseMonth, getRelease, releasePath, releases} from './lib/releases';
  import {
    formatFileSize,
    PLATFORM_LABELS,
    SUPPORTED_PLATFORMS,
    type ReleaseDownloads,
    type SupportedPlatform,
  } from './lib/platform';
  import DownloadIcon from './lib/DownloadIcon.svelte';
  import MobileMenu from './lib/MobileMenu.svelte';
  import PlatformIcon from './lib/PlatformIcon.svelte';

  const parts = location.pathname.split('/').filter(Boolean);
  const requestedVersion = parts[0] === 'releases' && parts[1] ? decodeURIComponent(parts[1]) : null;
  const release = requestedVersion ? getRelease(requestedVersion) : releases[0];
  const githubReleaseUrl = release
    ? `https://github.com/CarlvinceTan/Polymux/releases/tag/v${encodeURIComponent(release.version)}`
    : 'https://github.com/CarlvinceTan/Polymux/releases/latest';
  const isLatest = release ? release.version === releases[0]?.version : false;
  const installLabels: Record<SupportedPlatform, string> = {
    macos: 'Apple silicon',
    windows: 'Intel / AMD',
    linux: 'x86_64 AppImage',
  };

  let downloads = $state<ReleaseDownloads | null>(null);

  function assetFor(item: SupportedPlatform) {
    return downloads?.platforms[item] ?? null;
  }

  function urlFor(item: SupportedPlatform): string {
    return assetFor(item)?.url ?? downloads?.releaseUrl ?? githubReleaseUrl;
  }

  function sizeFor(item: SupportedPlatform): string {
    const asset = assetFor(item);
    return asset ? formatFileSize(asset.size) : '';
  }

  onMount(async () => {
    if (!release) return;
    try {
      const response = await fetch(`/api/downloads?version=${encodeURIComponent(release.version)}`);
      if (response.ok) downloads = await response.json() as ReleaseDownloads;
    } catch {
      // GitHub Releases remains the fallback when release metadata is unavailable.
    }
  });
</script>

<svelte:head>
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
  {#if release}
    <title>Polymux {release.version} Release Notes</title>
    <meta name="description" content={release.summary} />
  {/if}
</svelte:head>

<header class="site-shell-header">
  <div class="site-shell-inner">
    <div class="site-shell-primary">
      <a class="site-shell-brand" href="/" aria-label="Polymux home"><img src={logo} alt="" /><span>Polymux</span></a>
      <nav class="site-shell-nav" aria-label="Main navigation">
        <a href="/">Home</a>
        <a href="/docs/">Docs</a>
        <a class="active" href="/releases/">Releases</a>
      </nav>
    </div>
    <div class="site-shell-actions">
      <a class="site-shell-github" href="https://github.com/CarlvinceTan/Polymux" aria-label="Polymux on GitHub">
        <img src={github} alt="" />
      </a>
      <a class="site-shell-download" href="/#download">Download</a>
    </div>
    <MobileMenu active="releases" />
  </div>
</header>

<main class="releases-page">
  <section class="releases-intro">
    <h1>Releases</h1>
    <p>See what’s new in each Polymux update.</p>
  </section>

  <div class="releases-layout">
    <aside class="versions-sidebar">
      <p>Versions</p>
      <nav aria-label="Release versions">
        {#each releases as item (item.version)}
          <a class:active={release?.version === item.version} href={releasePath(item.version)}>{item.version}</a>
        {/each}
      </nav>
    </aside>

    {#if release}
      <section class="release-column">
        <p class="release-month">{formatReleaseMonth(release.date)}</p>
        <article class="release-document">
          <header>
            <strong>{release.version}</strong>
            <time datetime={release.date}>{formatReleaseDate(release.date)}</time>
          </header>

          {#if release.downloadable}
            <section class="release-downloads" aria-label={`Download Polymux ${release.version}`}>
              <ul class="platform-download-grid">
                {#each SUPPORTED_PLATFORMS as item (item)}
                  <li class="platform-download-card">
                    <div class="platform-download-heading">
                      <PlatformIcon platform={item} size={19} />
                      <strong>{PLATFORM_LABELS[item]}</strong>
                    </div>
                    <a class="platform-download-option" href={urlFor(item)} aria-label={`Download Polymux ${release.version} for ${PLATFORM_LABELS[item]}`}>
                      <span>{installLabels[item]}</span>
                      <span class="platform-download-action">
                        <DownloadIcon />
                        {sizeFor(item) || 'Download'}
                      </span>
                    </a>
                  </li>
                {/each}
              </ul>

              <p class="download-note">
                <a href={downloads?.releaseUrl ?? githubReleaseUrl}>
                  {isLatest ? 'All assets and checksums on GitHub' : `All ${release.version} assets on GitHub`}
                </a>
              </p>
            </section>
          {/if}

          <div class="release-copy">
            <p class="release-summary">{release.summary}</p>
            <h2 class="release-title">{release.title}</h2>
            <div class="release-body">{@html release.html}</div>
          </div>
        </article>
      </section>
    {:else}
      <section class="release-not-found">
        <p>Release not found</p>
        <h2>That version isn’t here.</h2>
        <a href="/releases/">View the latest release</a>
      </section>
    {/if}
  </div>
</main>

<footer class="releases-footer">
  <a class="releases-brand" href="/"><img src={logo} alt="" /><span>Polymux</span></a>
  <span>Personal software, thoughtfully built.</span>
  <a href="/docs/">Docs</a>
  <a href="/privacy-policy/">Privacy</a>
</footer>
