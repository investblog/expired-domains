// Theme (SPEC Ф16а): light / dark / system, stored in the extension page's localStorage.

export type ThemePreference = 'system' | 'light' | 'dark';
const KEY = 'expired_domains_theme';
const ORDER: ThemePreference[] = ['system', 'light', 'dark'];

export function getThemePreference(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    // storage may be unavailable
  }
  return 'system';
}

export function applyTheme(pref: ThemePreference): void {
  if (pref === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = pref;
}

export function cycleTheme(): ThemePreference {
  const next = ORDER[(ORDER.indexOf(getThemePreference()) + 1) % ORDER.length];
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // keep the choice for this page only
  }
  applyTheme(next);
  return next;
}
