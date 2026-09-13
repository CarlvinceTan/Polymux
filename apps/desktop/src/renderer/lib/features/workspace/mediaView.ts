import type {ClipboardContentDto} from '@polymux/protocol';

/** Extensions a page can actually play, as opposed to ones the drive merely
 * files under video: a `.mkv` is a video everywhere except in a `<video>`. */
const PLAYABLE = new Set(['mp4', 'webm', 'm4v', 'mov', 'ogv']);

const IMAGE_MIME: Record<string, string> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

const VIDEO_MIME: Record<string, string> = {
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  mp4: 'video/mp4',
  ogv: 'video/ogg',
  webm: 'video/webm',
};

export const MEDIA_ZOOM_MIN = 1;
export const MEDIA_ZOOM_MAX = 8;
export const MEDIA_ZOOM_STEP = 1.25;
export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

/** What a source is, read from its name rather than from the tab that opened
 * it — a preview url carries the file's name for exactly this. */
export function mediaKind(src: string): 'video' | 'image' {
  const name = src.split(/[?#]/, 1)[0] ?? '';
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return PLAYABLE.has(extension) ? 'video' : 'image';
}

export function mediaFileName(src: string, title = ''): string {
  const named = title.trim();
  if (named) return named;
  const pathName = src.split(/[?#]/, 1)[0] ?? '';
  const leaf = pathName.split('/').pop() ?? '';
  try {
    return decodeURIComponent(leaf) || 'media';
  } catch {
    return leaf || 'media';
  }
}

export function clampMediaZoom(zoom: number): number {
  const clamped = Math.min(MEDIA_ZOOM_MAX, Math.max(MEDIA_ZOOM_MIN, zoom));
  const rounded = Math.round(clamped * 1000) / 1000;
  return Math.abs(rounded - 1) < 0.001 ? 1 : rounded;
}

export function nextMediaZoom(zoom: number, direction: 1 | -1): number {
  return clampMediaZoom(direction > 0 ? zoom * MEDIA_ZOOM_STEP : zoom / MEDIA_ZOOM_STEP);
}

/** Trackpad pinch arrives as a ctrl-wheel in Chromium; a mouse wheel does not. */
export function mediaZoomFromWheel(zoom: number, deltaY: number, pinch: boolean): number {
  return clampMediaZoom(zoom * Math.exp(-deltaY * (pinch ? 0.01 : 0.0018)));
}

export function scrollAfterPan(
  start: {left: number; top: number; x: number; y: number},
  pointer: {x: number; y: number},
): {left: number; top: number} {
  return {
    left: start.left - (pointer.x - start.x),
    top: start.top - (pointer.y - start.y),
  };
}

/** Pixel size of a still after leaving the fitted frame. Null keeps CSS fit. */
export function zoomedMediaSize(
  fitted: {width: number; height: number},
  zoom: number,
): {width: number; height: number} | null {
  if (zoom <= MEDIA_ZOOM_MIN || fitted.width <= 0 || fitted.height <= 0) return null;
  return {
    width: Math.round(fitted.width * zoom * 1000) / 1000,
    height: Math.round(fitted.height * zoom * 1000) / 1000,
  };
}

export function formatPlaybackRate(rate: number): string {
  return `${Number(rate.toFixed(2)).toString()}×`;
}

export function mediaClipboardContent(
  src: string,
  name: string,
  kind: 'video' | 'image',
): ClipboardContentDto {
  return {
    kind: 'attachment',
    url: src,
    name,
    mimeType: mediaMimeType(name, kind),
    copyAs: kind === 'image' ? 'image' : 'file',
  };
}

function mediaMimeType(name: string, kind: 'video' | 'image'): string {
  const base = name.split(/[?#]/, 1)[0] ?? '';
  const dot = base.lastIndexOf('.');
  const extension = dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
  if (kind === 'video') return VIDEO_MIME[extension] ?? 'video/mp4';
  return IMAGE_MIME[extension] ?? 'image/png';
}
