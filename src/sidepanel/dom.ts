// Tiny DOM helpers for the side panel. Data is always set as text, never as HTML.

import { type IconId, icon } from '@/shared/sprite';

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

/** Icons come from the sprite (301-ui icon set, Ф16а). */
export { icon };

export function iconButton(name: IconId, label: string, onClick: () => void, cls = 'icon-btn'): HTMLButtonElement {
  const b = h('button', { class: cls, title: label, attrs: { type: 'button', 'aria-label': label } }, icon(name));
  b.addEventListener('click', onClick);
  return b;
}

/** Download text through a Blob and the page's own link (Ф17–Ф19; the one allowed `a.click()`, I2). */
export function downloadText(fileName: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = h('a', { attrs: { href: url, download: fileName } });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
