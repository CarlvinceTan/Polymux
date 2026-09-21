import assert from 'node:assert/strict';
import test from 'node:test';
import {randomTeamAvatar} from './avatarChoice';
import {BLOUB_ADAPTIVE_MONOCHROME} from './bloub/colors';
import {BLOUB_SHAPES} from './bloub/model';

test('a new bot receives a randomized simple avatar', () => {
  const avatar = randomTeamAvatar(() => 0.9);
  assert.ok(BLOUB_SHAPES.some((shape) => shape.id === avatar.shape));
  assert.match(avatar.color, /^#[0-9a-f]{6}$/i);
  assert.deepEqual(avatar.colorPair, BLOUB_ADAPTIVE_MONOCHROME);
});
