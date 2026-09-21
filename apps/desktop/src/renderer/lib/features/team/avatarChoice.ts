import type {TeamAvatarDto} from '@polymux/protocol';
import {adaptiveMonochromeAvatar, normalizeBloubAvatar} from './bloub/colors';
import {BLOUB_SHAPES} from './bloub/model';

export function randomTeamAvatar(random: () => number = Math.random): TeamAvatarDto {
  const shape = BLOUB_SHAPES[Math.floor(random() * BLOUB_SHAPES.length)]!.id;
  return normalizeBloubAvatar(adaptiveMonochromeAvatar({shape}));
}
