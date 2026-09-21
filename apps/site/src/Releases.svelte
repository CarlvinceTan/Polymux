<script lang="ts">
  import {onMount} from 'svelte';
  import github from 'simple-icons/icons/github.svg?url';
  import logo from '../../desktop/src/renderer/public/polymux.svg';
  import {
    filterReleaseChangelog,
    formatReleaseDate,
    formatReleaseMonth,
    getRelease,
    groupReleaseChangelog,
    releaseChangelog,
    releasePath,
    releasePlatforms,
    releases,
  } from './lib/releases';
  import {renderSafeMarkdownInline} from './lib/markdown.js';
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
  const installLabels: Record<SupportedPlatform, string> = {
    macos: 'Apple silicon',
    windows: 'Intel / AMD',
    linux: 'x86_64 AppImage',
  };

  type ReleaseItem = {html: string};
  type ReleaseGroup = {category: string; items: ReleaseItem[]};
  type ReleaseFeatureTab = {value: string; label: string; tabId: string; panelId: string; groups: ReleaseGroup[]};

  function panelKey(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'all';
  }

  /** Render every feature once, so the first paint already contains the tabs. */
  function buildFeatureTabs(): ReleaseFeatureTab[] {
    if (!release) return [];
    const sections = releaseChangelog(release);
    const versionKey = panelKey(release.version);

    return releasePlatforms(release).map((value) => {
      const key = `${versionKey}-${panelKey(value)}`;
      return {
        value,
        label: value,
        tabId: `release-platform-tab-${key}`,
        panelId: `release-platform-panel-${key}`,
        groups: groupReleaseChangelog(filterReleaseChangelog(sections, value)).map((group) => ({
          category: group.category === 'Features' ? 'New Features' : group.category,
          items: group.sections.flatMap((section) => section.items.map((item) => ({html: renderSafeMarkdownInline(item)}))),
        })).filter((group) => group.items.length),
      };
    });
  }

  const featureTabs = buildFeatureTabs();
  let selectedFeature = $state<string>(featureTabs[0]?.value ?? '');

  function selectFeatureWithKeyboard(event: KeyboardEvent) {
    const keys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const button = event.currentTarget as HTMLButtonElement | null;
    const tablist = button?.parentElement;
    if (!button || !tablist) return;
    const buttons = Array.from(tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const current = buttons.indexOf(button);
    if (current === -1) return;

    event.preventDefault();
    let next = current;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % buttons.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + buttons.length) % buttons.length;
    else if (event.key === 'End') next = buttons.length - 1;
    else next = 0;

    const target = buttons[next];
    const tab = featureTabs[next];
    if (!target || !tab) return;
    selectedFeature = tab.value;
    target.focus();
  }

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
      <a class="site-shell-download" href="/#download"><DownloadIcon />Download</a>
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
          <a class:active={release?.version === item.version} aria-current={release?.version === item.version ? 'page' : undefined} href={releasePath(item.version)}>{item.version}</a>
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

          <div class="release-copy">
            <p class="release-summary">{release.summary}</p>

            {#if featureTabs.length}
              <div class="release-platforms" role="tablist" aria-label="Filter release notes by feature">
                {#each featureTabs as tab (tab.value)}
                  <button
                    type="button"
                    role="tab"
                    id={tab.tabId}
                    aria-controls={tab.panelId}
                    aria-selected={selectedFeature === tab.value}
                    tabindex={selectedFeature === tab.value ? 0 : -1}
                    class:active={selectedFeature === tab.value}
                    onclick={() => (selectedFeature = tab.value)}
                    onkeydown={selectFeatureWithKeyboard}
                  >{tab.label}</button>
                {/each}
              </div>

              {#each featureTabs as tab (tab.value)}
                <div
                  class="release-body release-platform-panel"
                  id={tab.panelId}
                  role="tabpanel"
                  aria-labelledby={tab.tabId}
                  tabindex="0"
                  hidden={selectedFeature !== tab.value}
                >
                  {#each tab.groups as group (group.category)}
                    <h2>{group.category}</h2>
                    <ul>
                      {#each group.items as item (item.html)}
                        <li>{@html item.html}</li>
                      {/each}
                    </ul>
                  {/each}
                </div>
              {/each}
            {:else}
              <div class="release-body">{@html release.html}</div>
            {/if}
          </div>
        </article>
      </section>
      {#if release.downloadable}
        <aside class="installations-sidebar" aria-label={`Installations for Polymux ${release.version}`}>
          <p>Installations</p>
          <nav aria-label={`Download Polymux ${release.version}`}>
            {#each SUPPORTED_PLATFORMS as item (item)}
              <a href={urlFor(item)} aria-label={`Download Polymux ${release.version} for ${PLATFORM_LABELS[item]}`}>
                <PlatformIcon platform={item} size={16} />
                <span>
                  <strong>{PLATFORM_LABELS[item]}</strong>
                  <small>{installLabels[item]}{sizeFor(item) ? ` · ${sizeFor(item)}` : ''}</small>
                </span>
                <span class="installation-action">
                  <DownloadIcon />
                </span>
              </a>
            {/each}
          </nav>
        </aside>
      {/if}
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
