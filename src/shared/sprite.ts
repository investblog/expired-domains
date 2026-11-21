// Icon sprite for the extension's own pages (side panel, welcome): the mono and brand sprites are
// put into the document once, and every icon is an <svg><use href="#i-…"> (SPEC Ф16а).

import brandSprite from '@/assets/icons/brand.svg?raw';
import { copySvg, MONO_SPRITE, type MonoIcon, parseSprite } from './icons';

export type BrandIcon = '301' | 'chrome' | 'edge' | 'mozilla' | 'github' | 'telegram';
export type IconId = `mono-${MonoIcon}` | `brand-${BrandIcon}`;

const NS = 'http://www.w3.org/2000/svg';
const SPRITE_ID = 'eds-icon-sprite';

function ensureSprite(doc: Document): void {
  if (doc.getElementById(SPRITE_ID)) return;
  const sprite = copySvg(doc, parseSprite(MONO_SPRITE));
  for (const symbol of Array.from(parseSprite(brandSprite).children)) sprite.append(copySvg(doc, symbol));
  sprite.setAttribute('id', SPRITE_ID);
  doc.body.prepend(sprite);
}

export function icon(id: IconId, cls = 'icon'): SVGSVGElement {
  ensureSprite(document);
  const svg = document.createElementNS(NS, 'svg') as SVGSVGElement;
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(NS, 'use');
  use.setAttribute('href', `#i-${id}`);
  svg.append(use);
  return svg;
}

/** Store glyph for the build target ("Rate" links). */
const BROWSER: string = (import.meta as any).env?.BROWSER ?? 'chrome';
export const STORE_ICON: IconId =
  BROWSER === 'firefox' ? 'brand-mozilla' : BROWSER === 'edge' ? 'brand-edge' : 'brand-chrome';
