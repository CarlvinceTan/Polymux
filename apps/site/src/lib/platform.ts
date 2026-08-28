export type SupportedPlatform = 'macos' | 'windows' | 'linux';
export type Platform = SupportedPlatform | 'other';

export type DownloadAsset = {name: string; url: string; size: number};
export type ReleaseDownloads = {
  version: string | null;
  releaseUrl: string;
  platforms: Record<SupportedPlatform, DownloadAsset | null>;
};

export const PLATFORM_LABELS: Record<SupportedPlatform, string> = {
  macos: 'macOS',
  windows: 'Windows',
  linux: 'Linux',
};

export const PLATFORM_DETAILS: Record<SupportedPlatform, string> = {
  macos: 'Apple silicon',
  windows: 'Windows 10 or later · x64',
  linux: 'AppImage · x64',
};

export const SUPPORTED_PLATFORMS: SupportedPlatform[] = ['macos', 'windows', 'linux'];

export function detectPlatform(): Platform {
  const client = navigator as Navigator & {userAgentData?: {platform?: string}};
  const reported = `${client.userAgentData?.platform ?? ''} ${navigator.platform} ${navigator.userAgent}`.toLowerCase();
  if (/android|iphone|ipad|ipod/.test(reported)) return 'other';
  if (reported.includes('win')) return 'windows';
  if (reported.includes('linux') || reported.includes('x11')) return 'linux';
  return 'macos';
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const megabytes = bytes / 1_000_000;
  return megabytes >= 100 ? `${Math.round(megabytes)} MB` : `${megabytes.toFixed(1)} MB`;
}
