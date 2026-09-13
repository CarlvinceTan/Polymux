import type {Extension} from '@codemirror/state';
import {LanguageDescription} from '@codemirror/language';
import {languages} from '@codemirror/language-data';
import {
  fileBaseName, isBinaryFileName, isEnvFileName, languageLabel, languageMetadataForName,
} from '../../../../main/ide/language';

/** Resolve both the editor grammar and its lazy loader from the upstream registry. */
export function languageDescriptionFor(language: string, fileName = ''): LanguageDescription | undefined {
  if (language === 'Binary' || (fileName && isBinaryFileName(fileName))) return undefined;
  const metadata = fileName ? languageMetadataForName(fileName) : undefined;
  const base = fileBaseName(fileName);
  const filenameMatch = LanguageDescription.matchFilename(languages, base)
    ?? LanguageDescription.matchFilename(languages, base.toLowerCase());
  const name = isEnvFileName(base) || language === 'Shell Script' ? 'Shell' : metadata?.name ?? language;
  const nameMatch = LanguageDescription.matchLanguageName(languages, name, false);
  // JSX/TSX share display names with JS/TS, but keep their own parsers.
  if (filenameMatch && languageLabel(filenameMatch.name) === languageLabel(name)) return filenameMatch;
  if (nameMatch) return nameMatch;
  for (const alias of metadata?.aliases ?? []) {
    const match = LanguageDescription.matchLanguageName(languages, alias, false);
    if (match) return match;
  }
  if (metadata?.group) {
    const group = LanguageDescription.matchLanguageName(languages, metadata.group, false);
    if (group) return group;
  }
  // Linguist carries grammar-family metadata for formats such as SVG and Svelte.
  const mode = metadata?.codemirrorMode;
  const modeName = mode === 'htmlmixed' ? 'HTML' : mode === 'gfm' ? 'Markdown'
    : metadata?.codemirrorMimeType === 'application/json' ? 'JSON'
    : mode === 'xml' ? 'XML' : undefined;
  return modeName ? LanguageDescription.matchLanguageName(languages, modeName, false) ?? undefined : undefined;
}

export async function languageExtension(language: string, fileName = ''): Promise<Extension> {
  return await languageDescriptionFor(language, fileName)?.load() ?? [];
}
