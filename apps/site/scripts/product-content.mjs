import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const siteRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const featuresPath = resolve(siteRoot, 'src/content/product/features.json');

export function loadProductFeatures() {
  const features = JSON.parse(readFileSync(featuresPath, 'utf8'));
  if (!Array.isArray(features)) throw new Error('Product features must be an array.');
  return features;
}
