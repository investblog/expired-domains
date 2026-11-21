// Icon sprites (SPEC Ф16а): every icon name the code can ask for exists, the sprites carry no
// script or external address, and the shadow-root copy is self-contained.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inlineIcon, type MonoIcon } from '@/shared/icons';
import type { BrandIcon } from '@/shared/sprite';

const read = (name: string) => readFileSync(`src/assets/icons/${name}.svg`, 'utf8');
const ids = (src: string) => [...src.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]);

// Mirrors the MonoIcon / BrandIcon unions; `satisfies` keeps the lists in step with the types.
const MONO = [
  'magnify',
  'filter',
  'close',
  'sun',
  'moon',
  'help-circle',
  'cog',
  'upload',
  'list',
  'minus',
  'note',
  'side-panel',
  'check',
  'star',
  'web',
] as const satisfies readonly MonoIcon[];
const BRAND = ['301', 'chrome', 'edge', 'mozilla', 'github', 'telegram'] as const satisfies readonly BrandIcon[];

describe('icon sprites', () => {
  it('hold exactly the symbols the code names', () => {
    expect(ids(read('mono')).sort()).toEqual(MONO.map((n) => `i-mono-${n}`).sort());
    expect(ids(read('brand')).sort()).toEqual(BRAND.map((n) => `i-brand-${n}`).sort());
  });

  it('have no script, event handler, external reference or display:none', () => {
    for (const src of [read('mono'), read('brand')]) {
      expect(src).not.toMatch(/<script|\son\w+=|href=|display:\s*none/i);
      expect([...src.matchAll(/https?:\/\/[^\s"']+/g)].map((m) => m[0])).toEqual(['http://www.w3.org/2000/svg']);
    }
  });

  it('inlineIcon copies a mono symbol into a standalone svg', () => {
    const svg = inlineIcon(document, 'list', 'x');
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('class')).toBe('x');
    expect(svg.querySelector('g')?.getAttribute('fill')).toBe('currentColor');
    expect(svg.querySelector('use')).toBeNull();
  });
});
