// Page marks in the site's table (SPEC 4.7, Ф28–Ф33): a badge after each domain link, a bar on
// shortlisted rows, dimmed rejected rows, "new" for domains not in the collection when the page
// was opened, and a status menu. Statuses come from storage (I6); nothing is fetched (I1), no site
// element is clicked, focused or scrolled (I2). What we add never changes what the parser reads
// (Ф33): badges are closed shadow hosts without links, rows get only our `data-eds` attribute.
// Everything inserted is removed when both switches are off.
//
// The menu is a native popover next to its badge (Ф30): the browser opens it from the badge
// (`popovertarget`), puts it in the top layer (a dimmed row does not dim it, a cell does not clip
// it), puts it next in the Tab order after the badge, and closes it on Escape or a press outside —
// so this code never calls focus() and listens to nothing on the site's document.

import { inlineIcon, type MonoIcon } from '@/shared/icons';
import { type DomainRow, domainRows } from '@/shared/parse';
import type { DomainRecord, Status } from '@/shared/types';
import { MARK_CSS, pageCss } from './marks-css';

export const MARK_ATTR = 'data-eds-mark';
export const ROW_ATTR = 'data-eds';
export const MARKS_STYLE_ID = 'expired-domains-marks-301st';

export interface MarkSwitches {
  pageMarks: boolean;
  dimRejected: boolean;
}

type Shown = 'none' | 'saved' | Exclude<Status, 'new'>;

export interface MarksDeps {
  doc: Document;
  t: (key: string, ...subs: string[]) => string;
  /** The stored records of these domains (`d:*`); absent ones are not in the collection. */
  read: (domains: string[]) => Promise<Map<string, DomainRecord>>;
  /** Ф30: put one row of this page into the collection, as "Save page" does for all of them. */
  saveRow: (domain: string) => Promise<boolean>;
  setStatus: (domain: string, status: Status) => Promise<boolean>;
  /** A failed menu action, for the on-page panel's status line. */
  failed: () => void;
}

export interface MarksHandle {
  /** Apply the switches (Ф32); both off removes everything we added. */
  configure: (switches: MarkSwitches) => void;
  /** Re-read this page's records and redraw the rows that changed (Ф32). */
  refresh: () => Promise<void>;
}

/** Host reset, inline `!important` like the panel host (Ф3): page styles can match our element. */
const MARK_HOST_STYLE: [string, string][] = [
  ['all', 'initial'],
  ['display', 'inline-block'],
  ['vertical-align', 'middle'],
  ['margin', '0 0 0 4px'],
  ['padding', '0'],
  ['border', '0'],
  ['line-height', '0'],
  ['visibility', 'visible'],
  ['pointer-events', 'auto'],
];

const ICON: Record<Exclude<Status, 'new'>, MonoIcon> = { shortlist: 'star', rejected: 'close', bought: 'check' };
const STATUS_LABEL: Record<Status, string> = {
  new: 'statusNew',
  shortlist: 'statusShortlist',
  rejected: 'statusRejected',
  bought: 'statusBought',
};
const MENU_ID = 'menu';
/** Rows written per animation frame (Ф33). Chromium 154, 200 rows, longest frame: all at once
 * 18–36 ms, 40 per frame 12–30, 20 per frame 12–18, 10 per frame 6–12 (the idle floor). */
export const CHUNK = 10;

interface Badge {
  host: HTMLElement;
  button: HTMLButtonElement;
  chip: HTMLElement;
  menu: HTMLElement;
  /** What is drawn now; a row is redrawn only when this changes. */
  key: string;
  domain: string;
}

/** Events stop at our hosts, so the site's own row and document handlers never see them. */
const STOPPED = ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'keydown', 'keyup', 'dblclick'];

export function createMarks(
  deps: MarksDeps,
  initial: { records: Map<string, DomainRecord>; switches: MarkSwitches },
): MarksHandle {
  const { doc, t } = deps;
  const view = doc.defaultView;
  let switches = { ...initial.switches };
  let records = initial.records;
  // Ф31: what was not in the collection when the page was opened stays "new" until reload.
  const fresh = new Set(
    domainRows(doc)
      .map((r) => r.domain)
      .filter((d) => !records.has(d)),
  );
  const badges = new Map<Element, Badge>();
  let style: HTMLStyleElement | null = null;
  let open: Badge | null = null;

  // Labels are read now, while the extension context is alive (Е3).
  const L = {
    inCollection: t('markInCollection'),
    notSaved: t('markNotSaved'),
    hasNote: t('markHasNote'),
    isNew: t('markNew'),
    newTitle: t('markNewTitle'),
    shortlist: t('markShortlist'),
    reject: t('markReject'),
    clear: t('markClear'),
    menu: t('markMenu'),
    status: Object.fromEntries(Object.entries(STATUS_LABEL).map(([s, key]) => [s, t(key)])) as Record<Status, string>,
    tags: (list: string) => t('markTags', list),
  };

  const shownOf = (r: DomainRecord | undefined): Shown => (r ? (r.status ?? 'saved') : 'none');

  function title(domain: string, r: DomainRecord | undefined): string {
    if (!r) return `${domain} — ${L.notSaved}`;
    const parts = [L.inCollection];
    if (r.status) parts.push(L.status[r.status]);
    if (r.tags?.length) parts.push(L.tags(r.tags.join(', ')));
    if (r.note) parts.push(L.hasNote);
    return `${domain} — ${parts.join(' · ')}`;
  }

  // ---------------------------------------------------------------- menu (Ф30)

  /** A fixed menu would drift from its badge when the page scrolls; it closes instead. */
  let scrollWatch = false;
  const hide = (menu: HTMLElement) => {
    try {
      menu.hidePopover();
    } catch {
      // already closed (older engines throw instead of returning)
    }
  };
  const closeOnScroll = () => {
    if (open) hide(open.menu);
  };

  function fillMenu(badge: Badge) {
    const current = records.get(badge.domain)?.status ?? 'new';
    const entries: [Status, string, MonoIcon | null][] = [
      ['shortlist', L.shortlist, 'star'],
      ['rejected', L.reject, 'close'],
      ['new', L.clear, null],
    ];
    const items = entries.map(([status, label, icon]) => {
      const item = doc.createElement('button');
      item.type = 'button';
      item.className = 'item';
      item.dataset.s = status;
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(status === current));
      item.disabled = status === current;
      const dot = doc.createElement('span');
      dot.className = 'dot';
      if (icon) dot.append(inlineIcon(doc, icon));
      const text = doc.createElement('span');
      text.textContent = label;
      item.append(dot, text);
      item.addEventListener('click', () => {
        hide(badge.menu);
        void choose(badge.domain, status);
      });
      return item;
    });
    // No autofocus: focus stays on the badge and Tab leads into the menu. Chromium (154) does not
    // return focus from a popover inside a shadow root, so focus moved in would be lost on close.
    badge.menu.setAttribute('aria-label', `${L.menu}: ${badge.domain}`);
    badge.menu.replaceChildren(...items);
  }

  /** Below the badge, kept inside the viewport. */
  function placeMenu(badge: Badge) {
    const at = badge.button.getBoundingClientRect();
    const box = badge.menu.getBoundingClientRect();
    const vw = view?.innerWidth ?? 0;
    const vh = view?.innerHeight ?? 0;
    const left = Math.max(4, Math.min(at.left, vw - box.width - 4));
    const top = at.bottom + 4 + box.height > vh ? Math.max(4, at.top - box.height - 4) : at.bottom + 4;
    badge.menu.style.left = `${left}px`;
    badge.menu.style.top = `${top}px`;
  }

  async function choose(domain: string, status: Status) {
    try {
      if (!records.has(domain)) {
        if (status === 'new') return;
        if (!(await deps.saveRow(domain))) return deps.failed();
      }
      if (!(await deps.setStatus(domain, status))) return deps.failed();
    } catch {
      return deps.failed();
    }
    await refresh();
  }

  // ---------------------------------------------------------------- badges (Ф28, Ф31)

  function createBadge(domain: string): Badge {
    const host = doc.createElement('span');
    host.setAttribute(MARK_ATTR, '');
    for (const [prop, value] of MARK_HOST_STYLE) host.style.setProperty(prop, value, 'important');
    for (const type of STOPPED) host.addEventListener(type, (e) => e.stopPropagation());
    const root = host.attachShadow({ mode: 'closed' });
    const css = doc.createElement('style');
    css.textContent = MARK_CSS;
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'mark';
    button.setAttribute('popovertarget', MENU_ID);
    button.setAttribute('aria-haspopup', 'menu');
    const chip = doc.createElement('span');
    chip.className = 'new';
    chip.textContent = L.isNew;
    chip.title = L.newTitle;
    const menu = doc.createElement('div');
    menu.id = MENU_ID;
    menu.className = 'menu';
    menu.setAttribute('popover', 'auto');
    menu.setAttribute('role', 'menu');
    const wrap = doc.createElement('span');
    wrap.className = 'wrap';
    wrap.append(button, chip, menu);
    root.append(css, wrap);
    const badge: Badge = { host, button, chip, menu, key: '', domain };
    menu.addEventListener('beforetoggle', (e) => {
      if ((e as ToggleEvent).newState === 'open') fillMenu(badge);
    });
    menu.addEventListener('toggle', (e) => {
      if ((e as ToggleEvent).newState !== 'open') {
        if (open === badge) open = null;
        return;
      }
      open = badge;
      placeMenu(badge);
      if (!scrollWatch && view) {
        view.addEventListener('scroll', closeOnScroll, { capture: true, passive: true });
        scrollWatch = true;
      }
    });
    return badge;
  }

  /** Redraw in place: the button keeps its identity, so focus returning from the menu finds it. */
  function drawBadge(badge: Badge, r: DomainRecord | undefined) {
    const shown = shownOf(r);
    const { button } = badge;
    button.dataset.s = shown;
    button.toggleAttribute('data-extra', !!r && !!(r.tags?.length || r.note));
    button.title = title(badge.domain, r);
    button.setAttribute('aria-label', button.title);
    button.replaceChildren(...(shown !== 'none' && shown !== 'saved' ? [inlineIcon(doc, ICON[shown])] : []));
    badge.chip.hidden = !fresh.has(badge.domain);
  }

  function placeBadge(row: DomainRow, r: DomainRecord | undefined) {
    let badge = badges.get(row.link);
    if (!badge) {
      badge = createBadge(row.domain);
      badges.set(row.link, badge);
    }
    if (badge.host.previousSibling !== row.link) row.link.after(badge.host);
    const key = [shownOf(r), r?.tags?.join('\n') ?? '', r?.note ? 1 : 0, fresh.has(row.domain) ? 1 : 0].join('|');
    if (key !== badge.key || badge.domain !== row.domain) {
      badge.domain = row.domain;
      badge.key = key;
      drawBadge(badge, r);
    }
  }

  function removeBadges() {
    for (const badge of badges.values()) badge.host.remove();
    badges.clear();
    open = null;
  }

  function writeRow(row: DomainRow) {
    const r = records.get(row.domain);
    if (switches.pageMarks) placeBadge(row, r);
    const status = r?.status;
    const want =
      (status === 'shortlist' && switches.pageMarks) || (status === 'rejected' && switches.dimRejected) ? status : null;
    if (want === null) {
      if (row.tr.hasAttribute(ROW_ATTR)) row.tr.removeAttribute(ROW_ATTR);
    } else if (row.tr.getAttribute(ROW_ATTR) !== want) {
      row.tr.setAttribute(ROW_ATTR, want);
    }
  }

  /**
   * One pass over the rows: write only what differs from what is drawn. Ф33: CHUNK rows per
   * animation frame, the first chunk at once. A later pass (new records or switches) supersedes
   * a running one, which stops at its next frame. A document without a window (DOMParser, tests)
   * is written in one go.
   */
  let pass = 0;
  async function apply(): Promise<void> {
    const id = ++pass;
    const rows = domainRows(doc);
    if (!switches.pageMarks) removeBadges();
    writeStyle();
    for (let i = 0; i < rows.length; i += CHUNK) {
      if (i > 0 && view) {
        await new Promise((done) => view.requestAnimationFrame(done));
        if (id !== pass) return;
      }
      for (const row of rows.slice(i, i + CHUNK)) writeRow(row);
    }
  }

  function writeStyle() {
    const css = pageCss(switches);
    if (!css) {
      style?.remove();
      style = null;
    } else {
      if (!style) {
        style = doc.createElement('style');
        style.id = MARKS_STYLE_ID;
      }
      if (style.textContent !== css) style.textContent = css;
      if (!style.isConnected) (doc.head ?? doc.documentElement).append(style);
    }
  }

  // ---------------------------------------------------------------- refresh (Ф32)

  let running: Promise<void> | null = null;
  let again = false;
  async function refresh(): Promise<void> {
    if (running) {
      // A change arrived while reading: read once more after this pass, no timer.
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        try {
          records = await deps.read(domainRows(doc).map((r) => r.domain));
        } catch {
          return; // extension reloaded under this page (Е3): keep what is drawn
        }
        await apply();
      } while (again);
    })().finally(() => {
      running = null;
    });
    return running;
  }

  void apply();
  return {
    configure(next) {
      switches = { ...next };
      void apply();
    },
    refresh,
  };
}
