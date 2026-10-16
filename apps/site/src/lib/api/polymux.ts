import type {PolymuxApi} from '@polymux/protocol';

/** Public transcripts must never access a local or demo bridge. */
export function polymuxApi(): PolymuxApi {
  throw new Error('Desktop actions are unavailable in a shared conversation');
}
