// Theme toggle (SPEC Ф16а): the system theme until the user picks one; the first click always
// changes what the user sees and stores the choice for the next openings.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initTheme, toggleTheme, watchSystemTheme } from '@/sidepanel/theme';

const KEY = 'expired_domains_theme';
const systemDark = (dark: boolean) =>
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: dark && q.includes('dark'), media: q }));

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    vi.unstubAllGlobals();
    initTheme(); // each test is a freshly opened page
  });

  it('first opening follows the system and writes nothing', () => {
    systemDark(true);
    expect(initTheme()).toBe('dark');
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('the first click switches away from the system theme and stores the choice', () => {
    systemDark(false);
    initTheme();
    expect(toggleTheme()).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem(KEY)).toBe('dark');
    expect(toggleTheme()).toBe('light');
    expect(localStorage.getItem(KEY)).toBe('light');
  });

  it('a system theme change is reported only while no choice is stored', () => {
    let fire: (dark: boolean) => void = () => {};
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: false,
      media: q,
      addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => {
        fire = (dark) => cb({ matches: dark });
      },
    }));
    const seen: string[] = [];
    watchSystemTheme((t) => seen.push(t));
    fire(true);
    expect(seen).toEqual(['dark']);
    toggleTheme(); // the user picks a theme: the system no longer drives the icon
    fire(false);
    expect(seen).toEqual(['dark']);
  });

  it('later openings use the stored choice over the system; an old "system" value means none', () => {
    systemDark(true);
    localStorage.setItem(KEY, 'light');
    expect(initTheme()).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    localStorage.setItem(KEY, 'system');
    expect(initTheme()).toBe('dark');
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('without storage the choice still holds for this page: toggles alternate, the system is ignored', () => {
    let fire: (dark: boolean) => void = () => {};
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: false,
      media: q,
      addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => {
        fire = (dark) => cb({ matches: dark });
      },
    }));
    const broken = () => {
      throw new Error('storage unavailable');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(broken);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(broken);
    try {
      const seen: string[] = [];
      watchSystemTheme((t) => seen.push(t));
      expect(toggleTheme()).toBe('dark');
      expect(toggleTheme()).toBe('light');
      expect(document.documentElement.dataset.theme).toBe('light');
      fire(true);
      expect(seen).toEqual([]);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
