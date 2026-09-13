/** Defensive boundary for desktop display components reused by the public site. */
export function polymuxApi(): never {
  throw new Error('Desktop actions are unavailable in a shared conversation');
}
