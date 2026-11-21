// Mono icons from src/assets/icons/mono.svg (301-ui icon set, SPEC Ф16а). The sprite is parsed
// with DOMParser and rebuilt with createElementNS — never inserted as HTML (AMO lint, I5).
// The on-page panel uses inlineIcon(): a <use> inside its closed shadow root cannot reach a sprite
// in the site's document. Extension pages use the sprite and <use> (src/shared/sprite.ts).

import monoSprite from '@/assets/icons/mono.svg?raw';

const NS = 'http://www.w3.org/2000/svg';

export type MonoIcon =
  | 'magnify'
  | 'filter'
  | 'close'
  | 'sun'
  | 'moon'
  | 'help-circle'
  | 'cog'
  | 'upload'
  | 'list'
  | 'minus'
  | 'note'
  | 'side-panel'
  | 'check'
  | 'star'
  | 'web';

export const MONO_SPRITE = monoSprite;

export const parseSprite = (source: string): Element =>
  new DOMParser().parseFromString(source, 'image/svg+xml').documentElement;

/** Deep copy of an SVG element, created in `doc` (attributes and child elements only). */
export function copySvg(doc: Document, node: Element): Element {
  const el = doc.createElementNS(NS, node.localName);
  for (const a of Array.from(node.attributes)) el.setAttribute(a.name, a.value);
  for (const child of Array.from(node.children)) el.append(copySvg(doc, child));
  return el;
}

let mono: Element | undefined;

/** A self-contained <svg> holding a copy of one mono symbol. */
export function inlineIcon(doc: Document, name: MonoIcon, cls = ''): SVGSVGElement {
  mono ??= parseSprite(MONO_SPRITE);
  const symbol = Array.from(mono.children).find((s) => s.getAttribute('id') === `i-mono-${name}`);
  const svg = doc.createElementNS(NS, 'svg') as SVGSVGElement;
  svg.setAttribute('viewBox', symbol?.getAttribute('viewBox') ?? '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  if (cls) svg.setAttribute('class', cls);
  for (const child of Array.from(symbol?.children ?? [])) svg.append(copySvg(doc, child));
  return svg;
}
