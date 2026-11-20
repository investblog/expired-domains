// Inline SVG icons built with createElementNS (no innerHTML: AMO lint flags it, even for constants).

export type SvgShape = readonly [tag: 'path' | 'circle', attrs: Readonly<Record<string, string>>];

const NS = 'http://www.w3.org/2000/svg';

export function svgIcon(
  doc: Document,
  shapes: readonly SvgShape[],
  viewBox = '0 0 24 24',
  cls = 'icon',
): SVGSVGElement {
  const svg = doc.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', cls);
  for (const [tag, attrs] of shapes) {
    const el = doc.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  }
  return svg;
}
