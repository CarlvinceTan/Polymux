const REPOSITORY = 'CarlvinceTan/Polymux';

function asset(release, pattern) {
  const match = release.assets?.find((item) => pattern.test(item.name));
  return match ? {name: match.name, url: match.browser_download_url, size: match.size} : null;
}

export default async function handler(_request, response) {
  const result = await fetch(`https://api.github.com/repos/${REPOSITORY}/releases?per_page=10`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Polymux-Website',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!result.ok) {
    response.setHeader('Cache-Control', 'no-store');
    return response.status(503).json({error: 'No public Polymux release is available yet.'});
  }

  const releases = await result.json();
  const release = releases.find((item) => !item.draft);
  if (!release) {
    response.setHeader('Cache-Control', 'no-store');
    return response.status(503).json({error: 'No public Polymux release is available yet.'});
  }
  const releaseUrl = release.html_url ?? `https://github.com/${REPOSITORY}/releases/latest`;
  response.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
  return response.status(200).json({
    version: release.tag_name?.replace(/^v/, '') ?? null,
    publishedAt: release.published_at ?? null,
    releaseUrl,
    platforms: {
      macos: asset(release, /\.dmg$/i),
      windows: asset(release, /Setup\.exe$/i),
      linux: asset(release, /\.AppImage$/i),
    },
  });
}
