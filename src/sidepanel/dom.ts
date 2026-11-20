// Tiny DOM helpers for the side panel. Data is always set as text, never as HTML.

import { type SvgShape, svgIcon } from '@/shared/svg';

type Child = Node | string | null | undefined | false;

export interface Props {
  class?: string;
  text?: string;
  title?: string;
  attrs?: Record<string, string>;
  on?: Partial<Record<keyof HTMLElementEventMap, (e: Event) => void>>;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.title) el.title = props.title;
  for (const [k, v] of Object.entries(props.attrs ?? {})) el.setAttribute(k, v);
  for (const [type, fn] of Object.entries(props.on ?? {})) if (fn) el.addEventListener(type, fn);
  for (const c of children) if (c) el.append(c);
  return el;
}

/** Children list for replaceChildren(), skipping empty slots. */
export const nodes = (...xs: Child[]): (Node | string)[] => xs.filter((x): x is Node | string => !!x);

export function button(text: string, onClick: () => void, cls = 'btn', title?: string): HTMLButtonElement {
  const b = h('button', { class: cls, text, title, attrs: { type: 'button' } });
  b.addEventListener('click', onClick);
  return b;
}

/** Static inline icons (Ф16а: inline SVG, no network). */
const ICONS = {
  sun: [
    [
      'path',
      {
        d: 'M12 4V2m0 20v-2m8-8h2M2 12h2m13.66-5.66 1.41-1.41M4.93 19.07l1.41-1.41m0-11.32L4.93 4.93m14.14 14.14-1.41-1.41',
      },
    ],
    ['circle', { cx: '12', cy: '12', r: '4' }],
  ],
  moon: [['path', { d: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z' }]],
  auto: [
    ['circle', { cx: '12', cy: '12', r: '9' }],
    ['path', { d: 'M12 3a9 9 0 0 1 0 18z', fill: 'currentColor' }],
  ],
  sliders: [['path', { d: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6' }]],
  note: [
    ['path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }],
    ['path', { d: 'M14 2v6h6M8 13h8M8 17h5' }],
  ],
  close: [['path', { d: 'M18 6 6 18M6 6l12 12' }]],
  search: [
    ['circle', { cx: '11', cy: '11', r: '7' }],
    ['path', { d: 'm21 21-4.3-4.3' }],
  ],
  database: [
    ['path', { d: 'M3 5a9 3 0 1 0 18 0a9 3 0 1 0-18 0' }],
    ['path', { d: 'M3 5v14a9 3 0 0 0 18 0V5M3 12a9 3 0 0 0 18 0' }],
  ],
} as const satisfies Record<string, readonly SvgShape[]>;

export type IconName = keyof typeof ICONS;

export const icon = (name: IconName): SVGSVGElement => svgIcon(document, ICONS[name]);

export function iconButton(name: IconName, label: string, onClick: () => void, cls = 'icon-btn'): HTMLButtonElement {
  const b = h('button', { class: cls, title: label, attrs: { type: 'button', 'aria-label': label } }, icon(name));
  b.addEventListener('click', onClick);
  return b;
}

/** 301.st logo (inline SVG, same mark as the other 301.st extensions). */
const LOGO_PATH =
  'M13.295 18.57c-.013 1.026-.074 2.047-.438 3.026-.681 1.828-2.003 2.903-3.893 3.284a8.3 8.3 0 0 1-1.56.146c-2.42.024-4.839.025-7.259.034H0v-5.454h.214c2.22.01 4.442.017 6.662.003a4 4 0 0 0 1.058-.16 1.66 1.66 0 0 0 1.22-1.546c.034-.746.052-1.494.031-2.24-.028-1.03-.769-1.766-1.8-1.803-.854-.03-1.71-.032-2.565-.035-1.536-.005-3.072 0-4.607-.008H0V9.5h.196c2.104 0 4.208.005 6.313-.007.307-.002.628-.053.917-.154.608-.212.98-.81.986-1.5q.003-.573 0-1.146c-.002-.878-.595-1.475-1.467-1.475H.034V.936h.172C3.289.947 6.37.943 9.454.95c.638.001 1.283.03 1.86.35.68.38 1.116.956 1.157 1.743.049.917.039 1.837.04 2.755.001.645-.004 1.29-.036 1.934-.045.886-.27 1.72-.849 2.42-.472.573-1.058.98-1.794 1.146-.01.002-.016.014-.041.036.089.018.167.031.243.05 1.595.404 2.635 1.372 2.984 3.001.128.598.203 1.213.24 1.824.047.785.048 1.574.037 2.361m8.421.051c-.002 1.014-.14 2.011-.596 2.933-.86 1.734-2.254 2.807-4.108 3.298-.848.224-1.712.225-2.59.2v-4.084c.265-.02.528-.026.788-.058 1.106-.136 1.82-.776 2.238-1.78.278-.667.396-1.375.41-2.089.04-1.84.053-3.68.064-5.52a60 60 0 0 0-.035-2.542c-.03-.8-.128-1.591-.436-2.343-.431-1.049-1.256-1.616-2.387-1.628-.429-.005-.857-.001-1.293-.001V.955c.018-.007.033-.018.048-.018.776.01 1.556-.023 2.327.043a5.94 5.94 0 0 1 3.612 1.601 5.94 5.94 0 0 1 1.857 3.404c.066.379.104.767.104 1.151q.01 5.869-.003 11.738zM26 .96v24.087q-.08.008-.152.01-1.155.003-2.312 0-.145 0-.286-.033a.38.38 0 0 1-.31-.325c-.017-.112-.016-.227-.016-.341q.002-11.388-.006-22.775c0-.44.185-.619.62-.621q.94-.004 1.883-.002z';

export const logo301 = (): SVGSVGElement =>
  svgIcon(document, [['path', { fill: '#4da3ff', d: LOGO_PATH }]], '0 0 26 26', 'logo');

/** Download text through a Blob and the page's own link (Ф17–Ф19; the one allowed `a.click()`, I2). */
export function downloadText(fileName: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = h('a', { attrs: { href: url, download: fileName } });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
