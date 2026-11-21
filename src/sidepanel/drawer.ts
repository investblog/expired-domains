// Slide-in drawer (301-ui pattern, as in redirect-inspector): overlay + right panel with a header,
// a scrolling body and a footer. The element is created once and kept, so whatever lives inside
// (the filter form) keeps its state while the drawer is closed. Escape and the overlay close it;
// Tab stays inside while it is open; focus returns to where it was.

import { h, icon } from './dom';

export interface Drawer {
  element: HTMLElement;
  body: HTMLElement;
  footer: HTMLElement;
  setTitle(text: string): void;
  open(): void;
  close(): void;
  isOpen(): boolean;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea';

export function createDrawer(id: string, closeLabel: string, onClose?: () => void): Drawer {
  const title = h('h2', { class: 'drawer__title', attrs: { id: `drawer-${id}-title` } });
  const closeBtn = h(
    'button',
    { class: 'drawer__close', attrs: { type: 'button', 'aria-label': closeLabel, title: closeLabel } },
    icon('mono-close'),
  );
  const body = h('div', { class: 'drawer__body' });
  const footer = h('footer', { class: 'drawer__footer' });
  const panel = h(
    'div',
    {
      class: 'drawer__panel',
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': `drawer-${id}-title`, tabindex: '-1' },
    },
    h('header', { class: 'drawer__header' }, title, closeBtn),
    body,
    footer,
  );
  const overlay = h('div', { class: 'drawer__overlay' });
  const element = h('aside', { class: 'drawer', attrs: { 'data-drawer': id } }, overlay, panel);
  element.hidden = true;

  let returnTo: HTMLElement | null = null;

  // On the document while open (not on the drawer): a click that re-renders the clicked button
  // drops focus to <body>, and Escape / the Tab trap must still work then.
  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => !x.closest('[hidden]'));
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (!panel.contains(active)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && (active === first || active === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function open() {
    if (!element.hidden) return;
    returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    footer.hidden = footer.childElementCount === 0;
    element.hidden = false;
    document.addEventListener('keydown', onKeydown);
    panel.focus();
  }

  function close() {
    if (element.hidden) return;
    element.hidden = true;
    document.removeEventListener('keydown', onKeydown);
    if (returnTo?.isConnected) returnTo.focus();
    returnTo = null;
    onClose?.();
  }

  overlay.addEventListener('click', close);
  closeBtn.addEventListener('click', close);

  return {
    element,
    body,
    footer,
    setTitle: (text) => {
      title.textContent = text;
    },
    open,
    close,
    isOpen: () => !element.hidden,
  };
}
