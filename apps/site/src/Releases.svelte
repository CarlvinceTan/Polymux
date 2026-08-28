<script lang="ts">
  import logo from '../../desktop/src/renderer/public/polymux.svg';
  import {formatReleaseDate, formatReleaseMonth, getRelease, releasePath, releases} from './lib/releases';
  import MobileMenu from './lib/MobileMenu.svelte';
  import ProductMenu from './lib/ProductMenu.svelte';

  const parts = location.pathname.split('/').filter(Boolean);
  const requestedVersion = parts[0] === 'releases' && parts[1] ? decodeURIComponent(parts[1]) : null;
  const release = requestedVersion ? getRelease(requestedVersion) : releases[0];
  const githubReleaseUrl = release
    ? `https://github.com/CarlvinceTan/Polymux/releases/tag/v${encodeURIComponent(release.version)}`
    : 'https://github.com/CarlvinceTan/Polymux/releases/latest';
</script>

<svelte:head>
  <link rel="icon" type="image/svg+xml" href={logo} />
  {#if release}
    <title>Polymux {release.version} Release Notes</title>
    <meta name="description" content={release.summary} />
  {/if}
</svelte:head>

<header class="releases-header">
  <div class="releases-header-inner">
    <a class="releases-brand" href="/" aria-label="Polymux home"><img src={logo} alt="" /><span>Polymux</span></a>
    <nav aria-label="Main navigation">
      <a href="/">Home</a>
      <ProductMenu />
      <a href="/docs/">Docs</a>
      <a href="/blog/">Blog</a>
      <a class="active" href="/releases/">Releases</a>
    </nav>
    <a class="releases-download" href="/#download">Download</a>
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

          <div class="release-downloads" aria-label={`Download Polymux ${release.version}`}>
            <a href={githubReleaseUrl}><strong>macOS</strong><span>Download</span></a>
            <a href={githubReleaseUrl}><strong>Windows</strong><span>Download</span></a>
            <a href={githubReleaseUrl}><strong>Linux</strong><span>Download</span></a>
          </div>

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
