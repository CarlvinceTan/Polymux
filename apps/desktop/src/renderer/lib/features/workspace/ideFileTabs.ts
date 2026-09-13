/** Project-relative path helpers for IDE file tabs and the tree. */

export function parentPath(relative: string): string {
  const index = relative.lastIndexOf('/');
  return index < 0 ? '' : relative.slice(0, index);
}

export function fileName(relative: string): string {
  const index = relative.lastIndexOf('/');
  return index < 0 ? relative : relative.slice(index + 1);
}

export function joinPath(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name;
}

export function validFileName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0
    && trimmed !== '.'
    && trimmed !== '..'
    && !trimmed.includes('/')
    && !trimmed.includes('\\');
}

export function nextUntitledName(taken: Iterable<string>, base = 'untitled'): string {
  const used = new Set([...taken].map((name) => name.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  let index = 1;
  while (used.has(`${base} ${index}`.toLowerCase())) index += 1;
  return `${base} ${index}`;
}

/** A null savedContent means this draft has never been written to disk. */
export function isFileDirty(tab: {binary: boolean; content: string; savedContent: string | null}): boolean {
  return !tab.binary && (tab.savedContent === null || tab.content !== tab.savedContent);
}

/** Destination path when moving `from` into `folder` (`''` is the project root). */
export function moveDestination(from: string, folder: string): string | null {
  const dest = joinPath(folder, fileName(from));
  return dest === from ? null : dest;
}
