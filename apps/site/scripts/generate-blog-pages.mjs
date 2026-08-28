import {existsSync, mkdirSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {loadPublishedPosts, siteRoot} from './blog-content.mjs';

const blogRoot = resolve(siteRoot, 'blog');
const generatedMarker = '.generated-by-polymux';

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function safeJson(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

export function generateBlogPages() {
  mkdirSync(blogRoot, {recursive: true});

  for (const entry of readdirSync(blogRoot, {withFileTypes: true})) {
    if (!entry.isDirectory()) continue;
    const directory = resolve(blogRoot, entry.name);
    if (existsSync(resolve(directory, generatedMarker))) rmSync(directory, {recursive: true});
  }

  for (const post of loadPublishedPosts()) {
    const directory = resolve(blogRoot, post.slug);
    mkdirSync(directory, {recursive: true});
    writeFileSync(resolve(directory, generatedMarker), 'Generated from src/content/blog.\n');

    const canonical = `https://polymux.com/blog/${post.slug}/`;
    const structuredData = {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: post.title,
      description: post.excerpt,
      datePublished: post.date,
      dateModified: post.date,
      author: {'@type': 'Person', name: post.author},
      publisher: {'@id': 'https://polymux.com/#organization'},
      mainEntityOfPage: canonical,
    };

    writeFileSync(resolve(directory, 'index.html'), `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#f7f7f5" />
    <title>${escapeHtml(post.title)} — Polymux Blog</title>
    <meta name="description" content="${escapeHtml(post.excerpt)}" />
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1" />
    <link rel="canonical" href="${canonical}" />
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="Polymux" />
    <meta property="og:title" content="${escapeHtml(post.title)}" />
    <meta property="og:description" content="${escapeHtml(post.excerpt)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="article:published_time" content="${post.date}" />
    <meta name="twitter:card" content="summary" />
    <script type="application/ld+json">${safeJson(structuredData)}</script>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/blog-post.ts"></script>
  </body>
</html>
`);
  }
}

if (process.argv[1] === import.meta.filename) generateBlogPages();
