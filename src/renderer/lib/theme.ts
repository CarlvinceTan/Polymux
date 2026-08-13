import type {GeneralSettingsDto} from '@midas/protocol';

export type ThemeMode = GeneralSettingsDto['theme'];

let mode: ThemeMode = 'light';

export function applyTheme(next: ThemeMode): void {
  mode = next;
  const dark = next === 'dark'
    || next === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

export function startThemeSync(): () => void {
  const preference = window.matchMedia('(prefers-color-scheme: dark)');
  const update = () => {
    if (mode === 'system') applyTheme('system');
  };
  preference.addEventListener('change', update);
  applyTheme(mode);
  return () => preference.removeEventListener('change', update);
}
