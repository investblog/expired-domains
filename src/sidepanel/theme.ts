// Theme (SPEC Ф16а): until the user picks one, the page follows the system theme and nothing is
// stored. A click switches away from the theme on screen (so the first click always shows a
// change, as in cloudflare-tools) and stores that choice in the extension page's localStorage.

export type Theme = 'light' | 'dark';
const KEY = 'expired_domains_theme';
/** This page's choice, also when storage is unavailable and nothing could be stored. */
let choice: Theme | null = null;

function stored(): Theme | null {
  if (choice) return choice;
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    // storage may be unavailable
  }
  return null;
}

function store(theme: Theme): void {
  choice = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // keep the choice for this page only
  }
}

function systemTheme(): Theme {
  try {
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

const apply = (theme: Theme): void => {
  document.documentElement.dataset.theme = theme;
};

/** Apply the user's stored choice; without one, follow the system (nothing is written). */
export function initTheme(): Theme {
  choice = null; // a new page: only storage holds an earlier choice
  const theme = stored();
  if (theme) {
    apply(theme);
    return theme;
  }
  delete document.documentElement.dataset.theme; // CSS follows prefers-color-scheme
  return systemTheme();
}

/** Calls back with the new theme when the system theme changes while no choice is stored. */
export function watchSystemTheme(onChange: (theme: Theme) => void): void {
  try {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (!stored()) onChange(e.matches ? 'dark' : 'light');
    });
  } catch {
    // no matchMedia: nothing to follow
  }
}

/** Switch away from the theme on screen and store it as the user's choice. */
export function toggleTheme(): Theme {
  const next: Theme = (stored() ?? systemTheme()) === 'dark' ? 'light' : 'dark';
  store(next);
  apply(next);
  return next;
}
