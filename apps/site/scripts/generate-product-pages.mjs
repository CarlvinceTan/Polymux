import {existsSync, mkdirSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {loadProductFeatures, siteRoot} from './product-content.mjs';

const productRoot = resolve(siteRoot, 'product');
const generatedMarker = '.generated-by-polymux';

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function generateProductPages() {
  mkdirSync(productRoot, {recursive: true});

  for (const entry of readdirSync(productRoot, {withFileTypes: true})) {
    if (!entry.isDirectory()) continue;
    const directory = resolve(productRoot, entry.name);
    if (existsSync(resolve(directory, generatedMarker))) rmSync(directory, {recursive: true});
  }

  for (const feature of loadProductFeatures()) {
    const directory = resolve(productRoot, feature.slug);
    mkdirSync(directory, {recursive: true});
    writeFileSync(resolve(directory, generatedMarker), 'Generated from src/content/product/features.json.\n');
    const canonical = `https://polymux.com/product/${feature.slug}/`;

    writeFileSync(resolve(directory, 'index.html'), `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#f7f7f5" />
    <title>${escapeHtml(feature.name)} — Polymux</title>
    <meta name="description" content="${escapeHtml(feature.description)}" />
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1" />
    <link rel="canonical" href="${canonical}" />
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Polymux" />
    <meta property="og:title" content="${escapeHtml(feature.name)} — Polymux" />
    <meta property="og:description" content="${escapeHtml(feature.description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta name="twitter:card" content="summary" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/product.ts"></script>
  </body>
</html>
`);
  }
}

if (process.argv[1] === import.meta.filename) generateProductPages();
