export type CatppuccinMark = {viewBox: string; inner: string};

const EMPTY: CatppuccinMark = {viewBox: '0 0 16 16', inner: ''};
const UNSAFE = /<(script|foreignObject|image|use|iframe)\b/i;

/** Pull viewBox + inner markup from a vendored Catppuccin SVG so it can be
 * painted as a real inline `<svg>`, the same path as Icon.svelte. */
export function parseCatppuccinSvg(raw: string): CatppuccinMark {
  const trimmed = raw.trim();
  const match = trimmed.match(/^<svg\b([^>]*)>([\s\S]*)<\/svg>\s*$/i);
  if (!match) return EMPTY;
  const viewBox = match[1].match(/\bviewBox="([^"]+)"/i)?.[1] ?? EMPTY.viewBox;
  let inner = match[2]
    .replace(/\s+enable-background="[^"]*"/gi, '')
    .replace(/\s+filter="[^"]*"/gi, '')
    .trim();
  if (UNSAFE.test(inner)) return EMPTY;
  return {viewBox, inner};
}
