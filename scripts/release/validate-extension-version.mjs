import {readFileSync} from 'node:fs';

const manifestPath = 'apps/extension/manifest.json';

function parseVersion(value, label) {
  if (!/^\d+(?:\.\d+){0,3}$/.test(value)) {
    throw new Error(`${label} must contain one to four numeric components.`);
  }
  const parts = value.split('.').map(Number);
  if (parts.some((part) => part > 65535)) {
    throw new Error(`${label} components must be no greater than 65535.`);
  }
  return [...parts, 0, 0, 0, 0].slice(0, 4);
}

function compare(left, right) {
  for (let index = 0; index < 4; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const current = parseVersion(manifest.version, 'Extension version');
if (typeof manifest.description !== 'string' || manifest.description.length > 132) {
  throw new Error('Extension description must be present and no longer than 132 characters.');
}

const previousVersionIndex = process.argv.indexOf('--previous-version');
if (previousVersionIndex !== -1) {
  const previousVersion = process.argv[previousVersionIndex + 1];
  if (!previousVersion) throw new Error('--previous-version requires a value.');
  const previous = parseVersion(previousVersion, 'Previous extension version');
  if (compare(current, previous) <= 0) {
    throw new Error(`Extension changes require a version greater than ${previousVersion}; found ${manifest.version}.`);
  }
  console.log(`Extension version increased from ${previousVersion} to ${manifest.version}.`);
} else {
  console.log(`Extension version ${manifest.version} is valid.`);
}
