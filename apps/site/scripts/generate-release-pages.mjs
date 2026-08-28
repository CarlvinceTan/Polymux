import {existsSync, mkdirSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {siteRoot} from './blog-content.mjs';
import {loadPublishedReleases} from './releases-content.mjs';

const releasesRoot = resolve(siteRoot, 'releases');
const generatedMarker = '.generated-by-polymux';

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function generateReleasePages() {
  mkdirSync(releasesRoot, {recursive: true});

  for (const entry of readdirSync(releasesRoot, {withFileTypes: true})) {
    if (!entry.isDirectory()) continue;
    const directory = resolve(releasesRoot, entry.name);
    if (existsSync(resolve(directory, generatedMarker))) rmSync(directory, {recursive: true});
  }

  for (const release of loadPublishedReleases()) {
    const directory = resolve(releasesRoot, release.version);
    mkdirSync(directory, {recursive: true});
    writeFileSync(resolve(directory, generatedMarker), 'Generated from src/content/releases.\n');
    const canonical = `https://polymux.com/releases/${release.version}/`;

    writeFileSync(resolve(directory, 'index.html'), `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#f7f7f5" />
    <title>Polymux ${escapeHtml(release.version)} Release Notes</title>
    <meta name="description" content="${escapeHtml(release.summary)}" />
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1" />
    <link rel="canonical" href="${canonical}" />
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="Polymux" />
    <meta property="og:title" content="Polymux ${escapeHtml(release.version)} Release Notes" />
    <meta property="og:description" content="${escapeHtml(release.summary)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="article:published_time" content="${release.date}" />
    <meta name="twitter:card" content="summary" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/releases.ts"></script>
  </body>
</html>
`);
  }
}

if (process.argv[1] === import.meta.filename) generateReleasePages();
