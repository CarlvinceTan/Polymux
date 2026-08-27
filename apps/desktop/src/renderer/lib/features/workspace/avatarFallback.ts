/**
 * Returns the first letter that can stand in for a person's picture. Numbers,
 * punctuation, and bridge identifiers alone do not make a recognisable
 * initial, so those names use the generic profile glyph instead.
 */
export function avatarInitial(name: string): string | null {
  const letter = name.trim().match(/\p{L}/u)?.[0];
  return letter ? letter.toLocaleUpperCase() : null;
}
