import {existsSync, mkdirSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {siteRoot} from './blog-content.mjs';
import {loadPublishedDocs} from './docs-content.mjs';

const docsRoot = resolve(siteRoot, 'docs');
const generatedMarker = '.generated-by-polymux';

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function generateDocsPages() {
  mkdirSync(docsRoot, {recursive: true});

  for (const entry of readdirSync(docsRoot, {withFileTypes: true})) {
    if (!entry.isDirectory()) continue;
    const directory = resolve(docsRoot, entry.name);
    if (existsSync(resolve(directory, generatedMarker))) rmSync(directory, {recursive: true});
  }

  for (const page of loadPublishedDocs()) {
    if (page.slug === 'introduction') continue;
    const directory = resolve(docsRoot, page.slug);
    mkdirSync(directory, {recursive: true});
    writeFileSync(resolve(directory, generatedMarker), 'Generated from src/content/docs.\n');
    const canonical = `https://polymux.com/docs/${page.slug}/`;

    writeFileSync(resolve(directory, 'index.html'), `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#ffffff" />
    <title>${escapeHtml(page.title)} — Polymux Docs</title>
    <meta name="description" content="${escapeHtml(page.description)}" />
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1" />
    <link rel="canonical" href="${canonical}" />
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="Polymux" />
    <meta property="og:title" content="${escapeHtml(page.title)} — Polymux Docs" />
    <meta property="og:description" content="${escapeHtml(page.description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta name="twitter:card" content="summary" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/docs.ts"></script>
  </body>
</html>
`);
  }
}

if (process.argv[1] === import.meta.filename) generateDocsPages();
