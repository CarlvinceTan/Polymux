import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampMediaZoom,
  formatPlaybackRate,
  mediaClipboardContent,
  mediaFileName,
  mediaKind,
  mediaZoomFromWheel,
  nextMediaZoom,
  scrollAfterPan,
  zoomedMediaSize,
} from './mediaView.js';

test('tells a playable clip from a still by the source name', () => {
  assert.equal(mediaKind('polymux-preview://token/clip.mp4'), 'video');
  assert.equal(mediaKind('polymux-preview://token/photo.PNG'), 'image');
  assert.equal(mediaKind('https://example.test/reel.mkv'), 'image');
});

test('names a file from the title, then from the url leaf', () => {
  assert.equal(mediaFileName('polymux-preview://token/shot%20a.png', 'Cover'), 'Cover');
  assert.equal(mediaFileName('polymux-preview://token/shot%20a.png'), 'shot a.png');
});

test('zooms from fitted size and will not pass the ends', () => {
  assert.equal(nextMediaZoom(1, 1), 1.25);
  assert.equal(nextMediaZoom(1.25, -1), 1);
  assert.equal(nextMediaZoom(1, -1), 1);
  assert.equal(nextMediaZoom(8, 1), 8);
});

test('sizes a still from the fitted frame rather than CSS zoom', () => {
  assert.equal(zoomedMediaSize({width: 200, height: 100}, 1), null);
  assert.deepEqual(zoomedMediaSize({width: 200, height: 100}, 1.25), {width: 250, height: 125});
  assert.equal(zoomedMediaSize({width: 0, height: 100}, 1.25), null);
});

test('a pinch or a wheel notch moves zoom without passing the ends', () => {
  assert.equal(clampMediaZoom(0.2), 1);
  assert.equal(clampMediaZoom(12), 8);
  const pinched = mediaZoomFromWheel(1, -20, true);
  assert.ok(pinched > 1 && pinched < 2, String(pinched));
  const rolled = mediaZoomFromWheel(1, -100, false);
  assert.ok(rolled > 1 && rolled < pinched, String(rolled));
  assert.equal(mediaZoomFromWheel(1, 800, false), 1);
});

test('dragging a zoomed still moves the view by the pointer delta', () => {
  assert.deepEqual(
    scrollAfterPan({left: 40, top: 10, x: 100, y: 80}, {x: 70, y: 95}),
    {left: 70, top: -5},
  );
});

test('copies image pixels and video files from the preview url', () => {
  assert.deepEqual(mediaClipboardContent('polymux-preview://token/photo.jpg', 'photo.jpg', 'image'), {
    kind: 'attachment',
    url: 'polymux-preview://token/photo.jpg',
    name: 'photo.jpg',
    mimeType: 'image/jpeg',
    copyAs: 'image',
  });
  assert.deepEqual(mediaClipboardContent('polymux-preview://token/clip.webm', 'clip.webm', 'video'), {
    kind: 'attachment',
    url: 'polymux-preview://token/clip.webm',
    name: 'clip.webm',
    mimeType: 'video/webm',
    copyAs: 'file',
  });
});

test('formats a playback rate without trailing zeros', () => {
  assert.equal(formatPlaybackRate(1), '1×');
  assert.equal(formatPlaybackRate(1.25), '1.25×');
  assert.equal(formatPlaybackRate(0.5), '0.5×');
});
