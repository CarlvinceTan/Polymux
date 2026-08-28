<script lang="ts">
  import logo from '../../desktop/src/renderer/public/polymux.svg';
  import {formatBlogDate, getBlogPost} from './lib/blog';
  import MobileMenu from './lib/MobileMenu.svelte';
  import ProductMenu from './lib/ProductMenu.svelte';

  const pathParts = location.pathname.split('/').filter(Boolean);
  const slug = decodeURIComponent(pathParts[pathParts.length - 1] ?? '');
  const post = getBlogPost(slug);
</script>

<svelte:head>
  <link rel="icon" type="image/svg+xml" href={logo} />
  {#if post}
    <title>{post.title} — Polymux Blog</title>
    <meta name="description" content={post.excerpt} />
  {/if}
</svelte:head>

<header class="blog-header">
  <div class="blog-header-inner">
    <a class="blog-brand" href="/" aria-label="Polymux home"><img src={logo} alt="" /><span>Polymux</span></a>
    <nav aria-label="Main navigation">
      <a href="/">Home</a>
      <ProductMenu />
      <a href="/docs/">Docs</a>
      <a class="active" href="/blog/">Blog</a>
      <a href="/releases/">Releases</a>
    </nav>
    <a class="blog-download" href="/#download">Download</a>
    <MobileMenu active="blog" />
  </div>
</header>

{#if post}
  <main class="post-page">
    <a class="back-link" href="/blog/"><span aria-hidden="true">←</span> All posts</a>
    <article>
      <header class="post-title">
        <div class="post-meta"><time datetime={post.date}>{formatBlogDate(post.date)}</time><span>{post.readingMinutes} min read</span></div>
        <h1>{post.title}</h1>
        <p>{post.excerpt}</p>
        <span class="post-author">By {post.author}</span>
      </header>
      {#if post.coverImage}<img class="post-cover" src={post.coverImage} alt="" />{/if}
      <div class="post-body">{@html post.html}</div>
    </article>
  </main>
{:else}
  <main class="not-found">
    <p class="blog-eyebrow">404</p>
    <h1>That article isn’t here.</h1>
    <a href="/blog/">Back to the blog</a>
  </main>
{/if}

<footer class="blog-footer">
  <a class="blog-brand" href="/"><img src={logo} alt="" /><span>Polymux</span></a>
  <span>Personal software, thoughtfully built.</span>
  <a href="/releases/">Releases</a>
  <a href="/privacy-policy/">Privacy</a>
</footer>
