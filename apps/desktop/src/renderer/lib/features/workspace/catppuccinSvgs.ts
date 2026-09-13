import {parseCatppuccinSvg, type CatppuccinMark} from './catppuccinSvgMarkup';

const modules = import.meta.glob<string>(
  '../../../assets/catppuccin-icons/*.svg',
  {query: '?raw', import: 'default', eager: true},
);

const byId = new Map<string, CatppuccinMark>();
for (const [path, svg] of Object.entries(modules)) {
  byId.set(path.slice(path.lastIndexOf('/') + 1, -'.svg'.length), parseCatppuccinSvg(svg));
}

const fallback: CatppuccinMark = byId.get('_file') ?? {viewBox: '0 0 16 16', inner: ''};

/** Parsed Catppuccin mark for an icon id, falling back to `_file`. */
export function catppuccinMark(id: string): CatppuccinMark {
  return byId.get(id) ?? fallback;
}
