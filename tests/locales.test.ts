import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// SPEC Н3: en and ru message sets must have identical keys, and every key the code uses exists.
const load = (lang: string): Record<string, { message: string; placeholders?: Record<string, unknown> }> =>
  JSON.parse(readFileSync(new URL(`../src/public/_locales/${lang}/messages.json`, import.meta.url), 'utf8'));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [p] : [];
  });
}

/** Keys passed to t(), plus key literals kept in tables (status, preset and filter labels). */
function usedKeys(): Set<string> {
  const keys = new Set<string>();
  for (const file of sources(fileURLToPath(new URL('../src', import.meta.url)))) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\bt\(\s*'([A-Za-z_]+)'/g)) keys.add(m[1]);
    for (const m of text.matchAll(/'((?:status|preset|filter)[A-Z][A-Za-z]+)'/g)) keys.add(m[1]);
  }
  return keys;
}

describe('locales', () => {
  it('en and ru have the same keys', () => {
    expect(Object.keys(load('ru')).sort()).toEqual(Object.keys(load('en')).sort());
  });

  it('every message is non-empty and placeholders match between languages', () => {
    const en = load('en');
    const ru = load('ru');
    for (const lang of ['en', 'ru']) {
      for (const [key, value] of Object.entries(load(lang))) {
        expect(value.message.trim(), `${lang}.${key}`).not.toBe('');
      }
    }
    for (const key of Object.keys(en)) {
      expect(Object.keys(ru[key].placeholders ?? {}).sort(), key).toEqual(
        Object.keys(en[key].placeholders ?? {}).sort(),
      );
    }
  });

  it('every key used in the code exists', () => {
    const en = load('en');
    const notMessages = new Set(['filterPresets']); // settings field names that match the prefixes
    const missing = [...usedKeys()].filter((k) => !notMessages.has(k) && !Object.hasOwn(en, k));
    expect(missing).toEqual([]);
  });

  it('extDescription fits the Chrome manifest limit of 132 characters', () => {
    for (const lang of ['en', 'ru']) {
      expect([...load(lang).extDescription.message].length, lang).toBeLessThanOrEqual(132);
    }
  });

  it('extName (the store title) fits the AMO limit of 50 characters; appName is the short in-app title', () => {
    for (const lang of ['en', 'ru']) {
      expect([...load(lang).extName.message].length, lang).toBeLessThanOrEqual(50);
      expect(load(lang).appName.message, lang).toBe('Expired Domains');
    }
  });

  it('preset error keys exist for every error code', () => {
    const en = load('en');
    for (const code of ['name', 'name_taken', 'limit', 'not_found', 'builtin', 'filter']) {
      expect(Object.hasOwn(en, `presetError_${code}`), code).toBe(true);
    }
  });
});
