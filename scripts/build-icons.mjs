/**
 * Builds the desktop app icons from assets/appicon.svg.
 *
 * Every size is rendered straight from the vector at its exact pixel
 * dimensions. The source carries the app icon's white background.
 *
 * Usage: npm run icons
 */
import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, rmSync, writeFileSync, statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import os from 'node:os';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = path.join(projectRoot, 'assets/appicon.svg');
const work = path.join(os.tmpdir(), `flareai-icons-${process.pid}`);

/** macOS ships every size an .icns needs; .ico wants the Windows shell set. */
const ICNS_SIZES = [16, 32, 64, 128, 256, 512, 1024];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const ICNS_ENTRIES = [
  ['icon_16x16.png', 16], ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32], ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128], ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256], ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512], ['icon_512x512@2x.png', 1024],
];

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  'google-chrome',
  'chromium',
];

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      if (candidate.startsWith('/')) {
        statSync(candidate);
        return candidate;
      }
      execFileSync('command', ['-v', candidate], {shell: true, stdio: 'ignore'});
      return candidate;
    } catch {
      // Try the next one.
    }
  }
  throw new Error('No Chromium-based browser found to rasterise the icon.');
}

function render(chrome, size, out) {
  // The wrapper pins the drawing to the viewport exactly, so the screenshot is
  // the icon rather than the icon plus a default body margin.
  const page = path.join(work, `page-${size}.html`);
  writeFileSync(page, `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent}
img{display:block;width:${size}px;height:${size}px}</style>
<img src="${path.relative(work, source)}">`);
  execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--default-background-color=00000000',
    `--window-size=${size},${size}`,
    `--screenshot=${out}`,
    `file://${page}`,
  ], {stdio: 'ignore'});
}

/** ICO is a directory of embedded PNGs; 0 in the size byte encodes 256. */
function buildIco(files, out) {
  const images = files.map(({size, file}) => ({size, buf: readFileSync(file)}));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const entries = Buffer.alloc(16 * images.length);
  let offset = 6 + 16 * images.length;
  images.forEach((image, index) => {
    const at = index * 16;
    const dimension = image.size >= 256 ? 0 : image.size;
    entries.writeUInt8(dimension, at);
    entries.writeUInt8(dimension, at + 1);
    entries.writeUInt8(0, at + 2);
    entries.writeUInt8(0, at + 3);
    entries.writeUInt16LE(1, at + 4);
    entries.writeUInt16LE(32, at + 6);
    entries.writeUInt32LE(image.buf.length, at + 8);
    entries.writeUInt32LE(offset, at + 12);
    offset += image.buf.length;
  });

  writeFileSync(out, Buffer.concat([header, entries, ...images.map((image) => image.buf)]));
}

const chrome = findChrome();
rmSync(work, {recursive: true, force: true});
mkdirSync(work, {recursive: true});

const sizes = [...new Set([...ICNS_SIZES, ...ICO_SIZES])].sort((a, b) => a - b);
const rendered = new Map();
for (const size of sizes) {
  const file = path.join(work, `${size}.png`);
  render(chrome, size, file);
  rendered.set(size, file);
  process.stdout.write(`rendered ${size}px\n`);
}

const iconset = path.join(work, 'appicon.iconset');
mkdirSync(iconset, {recursive: true});
for (const [name, size] of ICNS_ENTRIES) {
  writeFileSync(path.join(iconset, name), readFileSync(rendered.get(size)));
}
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(projectRoot, 'assets/appicon.icns')]);

buildIco(ICO_SIZES.map((size) => ({size, file: rendered.get(size)})), path.join(projectRoot, 'assets/appicon.ico'));
writeFileSync(path.join(projectRoot, 'assets/appicon.png'), readFileSync(rendered.get(1024)));

rmSync(work, {recursive: true, force: true});
console.log('built assets/appicon.icns, assets/appicon.ico, assets/appicon.png');
