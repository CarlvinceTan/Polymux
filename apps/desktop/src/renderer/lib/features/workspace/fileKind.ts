import type {IdeEntryDto} from '@polymux/protocol';
import associations from './catppuccinAssociations.json';

const fileNames = associations.fileNames as Record<string, string>;
const fileExtensions = associations.fileExtensions as Record<string, string>;
const folderNames = associations.folderNames as Record<string, string>;

/** Catppuccin vscode-icons basename (no `.svg`), including `_file` / `_folder`. */
export function catppuccinIconId(
  name: string,
  kind: IdeEntryDto['kind'],
  open = false,
): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  const dotted = base.toLowerCase();
  if (kind === 'folder') {
    const folder = folderNames[dotted];
    if (folder) return open ? `${folder}_open` : folder;
    return open ? '_folder_open' : '_folder';
  }
  if (fileNames[dotted]) return fileNames[dotted];
  const parts = dotted.split('.');
  for (let i = 1; i < parts.length; i++) {
    const ext = parts.slice(i).join('.');
    if (fileExtensions[ext]) return fileExtensions[ext];
  }
  return '_file';
}
