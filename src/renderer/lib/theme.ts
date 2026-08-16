import type {GeneralSettingsDto} from '@flareai/protocol';

export type ThemeMode = GeneralSettingsDto['theme'];

/** Mirrors the choice for `public/theme-boot.js`, which applies it in <head> so
 * the startup splash opens in the right theme rather than flashing into it. */
const STORAGE_KEY = 'flareai.theme';

function storedMode(): ThemeMode | undefined {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : undefined;
  } catch {
    return undefined;
  }
}

// Settings arrive over IPC after the first paint, so until they do the last
// known choice is the best answer; 'system' is the default a fresh profile gets.
let mode: ThemeMode = storedMode() ?? 'system';

export function applyTheme(next: ThemeMode): void {
  mode = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // A denied store only costs the pre-paint hint, not the applied theme.
  }
  const dark = next === 'dark'
    || next === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = dark ? 'dark' : 'light';
  // Only written when it actually changes. Assigning the same value back still
  // dirties the root and costs a style recalc and repaint of the whole
  // document — and on a cold start this runs twice, once on mount and again
  // when settings arrive over IPC, both of them landing part way through the
  // splash's slide. That is where the animation was being knocked off its
  // frames; theme-boot has already applied the same answer before first paint.
  const root = document.documentElement;
  if (root.dataset.theme !== theme) root.dataset.theme = theme;
  if (root.style.colorScheme !== theme) root.style.colorScheme = theme;
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
