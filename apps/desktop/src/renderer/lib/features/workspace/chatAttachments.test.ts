import assert from 'node:assert/strict';
import test from 'node:test';
import type {ChatAttachmentDto} from '@polymux/protocol';
import {attachmentRenderKind} from './chatAttachments';

const attachment = (value: Partial<ChatAttachmentDto>): ChatAttachmentDto => ({
  kind: 'file',
  url: 'polymux-media://local/example',
  name: 'attachment',
  mimeType: null,
  size: null,
  ...value,
});

test('plays a file-labelled reel when its filename names a supported container', () => {
  assert.equal(attachmentRenderKind(attachment({name: 'AQO35LDKTG5E80.mp4'})), 'video');
  assert.equal(attachmentRenderKind(attachment({name: 'clip.MOV?download=1'})), 'video');
});

test('plays a file-labelled reel when its MIME type identifies a supported container', () => {
  assert.equal(
    attachmentRenderKind(attachment({name: 'shared-file', mimeType: 'video/mp4; codecs=avc1'})),
    'video',
  );
});

test('keeps unsupported containers and ordinary documents as files', () => {
  assert.equal(attachmentRenderKind(attachment({name: 'archive.mkv', mimeType: 'video/x-matroska'})), 'file');
  assert.equal(attachmentRenderKind(attachment({name: 'project-notes.pdf'})), 'file');
});

test('preserves an attachment kind already supplied by the bridge', () => {
  assert.equal(attachmentRenderKind(attachment({kind: 'audio', name: 'recording.mp4'})), 'audio');
  assert.equal(attachmentRenderKind(attachment({kind: 'image', name: 'photo.mp4'})), 'image');
});
