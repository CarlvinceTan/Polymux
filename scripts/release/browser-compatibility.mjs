export function parseStoreVersion(value, label = "Extension version") {
  if (!/^\d+(?:\.\d+){0,3}$/.test(value))
    throw new Error(`${label} must contain one to four numeric components.`);
  const parts = value.split(".").map(Number);
  if (parts.some((part) => part > 65_535))
    throw new Error(`${label} components must be no greater than 65535.`);
  return [...parts, 0, 0, 0, 0].slice(0, 4);
}

export function compareStoreVersions(left, right) {
  const a = parseStoreVersion(left, "Left extension version");
  const b = parseStoreVersion(right, "Right extension version");
  for (let index = 0; index < 4; index += 1)
    if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}

export function publishedExtension(status) {
  const channels = status?.publishedItemRevisionStatus?.distributionChannels;
  if (!Array.isArray(channels)) return null;
  const releases = channels
    .filter((channel) => typeof channel?.crxVersion === "string")
    .sort((left, right) =>
      compareStoreVersions(right.crxVersion, left.crxVersion));
  if (releases.length === 0) return null;
  return {
    version: releases[0].crxVersion,
    deployPercentage: Number.isFinite(releases[0].deployPercentage)
      ? releases[0].deployPercentage
      : null,
  };
}

export function requirePublishedCompatibility(status, minimumVersion) {
  parseStoreVersion(minimumVersion, "Minimum published extension version");
  const published = publishedExtension(status);
  if (!published)
    throw new Error("The Chrome Web Store has no published extension revision.");
  if (compareStoreVersions(published.version, minimumVersion) < 0)
    throw new Error(
      `Desktop requires extension ${minimumVersion} or newer, but the Store publishes ${published.version}.`,
    );
  if (published.deployPercentage === null)
    throw new Error(
      `Extension ${published.version} is missing its deployment percentage.`,
    );
  if (published.deployPercentage < 100)
    throw new Error(
      `Extension ${published.version} is deployed to only ${published.deployPercentage}% of users.`,
    );
  return published;
}
