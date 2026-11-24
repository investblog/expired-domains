// SPEC 4.7: page marks in the site's table (Ф28–Ф33) on real fixtures, wired to the real store
// and the real panel the way the content script wires them.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStore, type StorageArea } from '@/background/store';
import { createMarks, MARK_ATTR, MARKS_STYLE_ID, type MarkSwitches, ROW_ATTR } from '@/content/marks';
import { mountPanel } from '@/content/panel';
import { makeBackup, parseBackup } from '@/shared/backup';
import { domainRows, parseListing } from '@/shared/parse';
import { defaultSettings, pageMarkSettings, settingsError } from '@/shared/presets';
import { recordKey } from '@/shared/records';
import { pageSource } from '@/shared/source';
import type { DomainRecord, Settings, State, Status } from '@/shared/types';

const FIXTURES = readdirSync(resolve('tests/fixtures')).map((f) => f.replace(/\.html$/, ''));
const load = (name: string): Document =>
  new DOMParser().parseFromString(readFileSync(resolve('tests/fixtures', `${name}.html`), 'utf8'), 'text/html');

// Closed roots are invisible to the page; the test keeps the references attachShadow returns.
const roots = new WeakMap<Element, ShadowRoot>();
const attachShadow = Element.prototype.attachShadow;
// jsdom has no Popover API. This stand-in fires the same beforetoggle/toggle events; what only a
// browser does (popovertarget, top layer, focus, light dismiss) is checked in a real Chromium.
const opened = new WeakSet<Element>();
const toggleEvent = (type: string, newState: 'open' | 'closed') => Object.assign(new Event(type), { newState });
type PopoverProto = { showPopover?: () => void; hidePopover?: () => void };
const proto = HTMLElement.prototype as unknown as PopoverProto;
beforeAll(() => {
  Element.prototype.attachShadow = function (this: Element, init: ShadowRootInit) {
    const root = attachShadow.call(this, init);
    roots.set(this, root);
    return root;
  };
  proto.showPopover = function (this: HTMLElement) {
    if (opened.has(this)) throw new DOMException('open', 'InvalidStateError');
    this.dispatchEvent(toggleEvent('beforetoggle', 'open'));
    opened.add(this);
    this.dispatchEvent(toggleEvent('toggle', 'open'));
  };
  proto.hidePopover = function (this: HTMLElement) {
    if (!opened.has(this)) throw new DOMException('hidden', 'InvalidStateError');
    opened.delete(this);
    this.dispatchEvent(toggleEvent('toggle', 'closed'));
  };
});
afterAll(() => {
  Element.prototype.attachShadow = attachShadow;
  delete proto.showPopover;
  delete proto.hidePopover;
});

function memoryArea(): StorageArea & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
  return {
    data,
    async get(keys) {
      const list = keys === null || keys === undefined ? [...data.keys()] : Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const k of list) if (data.has(k)) out[k] = copy(data.get(k));
      return out;
    },
    async set(items) {
      for (const [k, v] of Object.entries(items)) data.set(k, copy(v));
    },
    async remove(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k);
    },
  };
}

const t = (key: string, ...subs: string[]) => [key, ...subs].join('|');
const URL_P1 = 'https://member.expireddomains.net/domains/expiredcom202611/';
const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

interface Setup {
  /** Domains stored before the page is opened, with their user fields. */
  stored?: Record<string, { status?: Status; tags?: string[]; note?: string }>;
  switches?: MarkSwitches;
  failUpdate?: boolean;
}

async function setup(doc: Document, opts: Setup = {}) {
  const area = memoryArea();
  const store = createStore(area, () => 1_795_000_000_000);
  const parsed = parseListing(doc);
  const stored = opts.stored ?? {};
  const seed = parsed.rows.filter((r) => Object.hasOwn(stored, r.domain));
  if (seed.length) {
    await store.add({ sourceId: 'earlier/', sourceLabel: 'Earlier', columns: parsed.columns, rows: seed });
    for (const [domain, fields] of Object.entries(stored)) {
      await store.update([domain], {
        status: fields.status,
        note: fields.note,
        addTags: fields.tags,
      });
    }
  }
  const reads: string[][] = [];
  const read = async (domains: string[]) => {
    reads.push(domains);
    const got = await area.get(domains.map(recordKey));
    const out = new Map<string, DomainRecord>();
    for (const d of domains) if (got[recordKey(d)]) out.set(d, got[recordKey(d)] as DomainRecord);
    return out;
  };
  const updates: [string, Status][] = [];
  let failures = 0;
  const panel = mountPanel({
    doc,
    source: pageSource(URL_P1, doc.title),
    settings: { autoCapture: false, panelCollapsed: false },
    windowWidth: 1280,
    t,
    add: async (capture) => ({ ok: true, result: await store.add(capture) }),
    setSettings: async () => ({ ok: true, result: null }),
    contextInvalidated: () => false,
  });
  if (!panel) throw new Error('no panel');
  const initial = await read(domainRows(doc).map((r) => r.domain));
  const marks = createMarks(
    {
      doc,
      t,
      read,
      saveRow: (domain) => panel.saveRow(domain),
      setStatus: async (domain, status) => {
        updates.push([domain, status]);
        if (opts.failUpdate) return false;
        await store.update([domain], { status });
        return true;
      },
      failed: () => {
        failures++;
        panel.failed();
      },
    },
    { records: initial, switches: opts.switches ?? { pageMarks: true, dimRejected: true } },
  );
  const badgeOf = (domain: string) => {
    const row = domainRows(doc).find((r) => r.domain === domain);
    const host = row?.link.nextElementSibling;
    if (!host?.hasAttribute(MARK_ATTR)) return null;
    const root = roots.get(host) as ShadowRoot;
    const menu = root.querySelector('.menu') as HTMLElement;
    return {
      host,
      root,
      mark: root.querySelector('.mark') as HTMLButtonElement,
      isNew: !(root.querySelector('.new') as HTMLElement).hidden,
      menu,
      /** What the browser does on a click of the mark (popovertarget). */
      open: () => menu.showPopover(),
      isOpen: () => opened.has(menu),
      item: (s: Status) => menu.querySelector(`.item[data-s="${s}"]`) as HTMLButtonElement,
    };
  };
  const rowOf = (domain: string) => domainRows(doc).find((r) => r.domain === domain)?.tr as Element;
  return {
    area,
    store,
    panel,
    marks,
    reads,
    updates,
    failures: () => failures,
    badgeOf,
    rowOf,
    domains: parsed.rows.map((r) => r.domain),
  };
}

describe('page marks: the parser reads the same page (Ф33)', () => {
  for (const name of FIXTURES) {
    it(`${name}: parse is unchanged with marks, and the listing is restored when they are off`, async () => {
      const doc = load(name);
      const listingBefore = doc.querySelector('#listing')?.outerHTML;
      const before = parseListing(doc);
      const stored: Setup['stored'] = {};
      const statuses: (Status | undefined)[] = ['shortlist', 'rejected', 'bought', undefined];
      before.rows.slice(0, 8).forEach((r, i) => {
        stored[r.domain] = { status: statuses[i % 4], tags: i % 2 ? ['x'] : undefined };
      });
      const s = await setup(doc, { stored });
      expect(parseListing(doc)).toEqual(before);
      if (before.rows.length) {
        expect(doc.querySelectorAll(`[${MARK_ATTR}]`).length).toBe(domainRows(doc).length);
        expect(doc.getElementById(MARKS_STYLE_ID)).not.toBeNull();
      }
      s.marks.configure({ pageMarks: false, dimRejected: false });
      expect(doc.querySelector('#listing')?.outerHTML).toBe(listingBefore);
      expect(doc.getElementById(MARKS_STYLE_ID)).toBeNull();
      expect(doc.querySelectorAll(`[${MARK_ATTR}], [${ROW_ATTR}]`).length).toBe(0);
    });
  }
});

describe('page marks: badges, rows and "new" (Ф28, Ф29, Ф31)', () => {
  it('shows the stored status, the tags/note dot and the tooltip; a row not stored has an empty ring', async () => {
    const doc = load('deleted-com-p1');
    const [a, b, c, d, e] = parseListing(doc).rows.map((r) => r.domain);
    const s = await setup(doc, {
      stored: {
        [a]: { status: 'shortlist' },
        [b]: { status: 'rejected' },
        [c]: { status: 'bought' },
        [d]: { tags: ['k'], note: 'n' },
      },
    });
    expect(s.badgeOf(a)?.mark.dataset.s).toBe('shortlist');
    expect(s.badgeOf(b)?.mark.dataset.s).toBe('rejected');
    expect(s.badgeOf(c)?.mark.dataset.s).toBe('bought');
    expect(s.badgeOf(d)?.mark.dataset.s).toBe('saved');
    expect(s.badgeOf(d)?.mark.hasAttribute('data-extra')).toBe(true);
    expect(s.badgeOf(d)?.mark.title).toBe(`${d} — markInCollection · markTags|k · markHasNote`);
    expect(s.badgeOf(a)?.mark.title).toBe(`${a} — markInCollection · statusShortlist`);
    expect(s.badgeOf(e)?.mark.dataset.s).toBe('none');
    expect(s.badgeOf(e)?.mark.title).toBe(`${e} — markNotSaved`);
    // Ф29: the row attribute carries only shortlist and rejected.
    expect(s.rowOf(a).getAttribute(ROW_ATTR)).toBe('shortlist');
    expect(s.rowOf(b).getAttribute(ROW_ATTR)).toBe('rejected');
    expect(s.rowOf(c).hasAttribute(ROW_ATTR)).toBe(false);
    // Ф31: stored ones are not new, the rest are.
    expect(s.badgeOf(a)?.isNew).toBe(false);
    expect(s.badgeOf(e)?.isNew).toBe(true);
  });

  it('"new" stays after the domain is saved (auto-capture), until the page is reloaded', async () => {
    const doc = load('deleted-com-p1');
    const s = await setup(doc);
    expect(s.badgeOf(s.domains[0])?.isNew).toBe(true);
    await s.panel.save();
    await s.marks.refresh();
    expect(s.badgeOf(s.domains[0])?.mark.dataset.s).toBe('saved');
    expect(s.badgeOf(s.domains[0])?.isNew).toBe(true);
  });

  it('the switches work apart: rejected rows dim without badges, badges without dimming', async () => {
    const doc = load('deleted-com-p1');
    const [a, b] = parseListing(doc).rows.map((r) => r.domain);
    const s = await setup(doc, {
      stored: { [a]: { status: 'shortlist' }, [b]: { status: 'rejected' } },
      switches: { pageMarks: false, dimRejected: true },
    });
    const style = () => doc.getElementById(MARKS_STYLE_ID)?.textContent ?? '';
    expect(s.badgeOf(a)).toBeNull();
    expect(s.rowOf(a).hasAttribute(ROW_ATTR)).toBe(false);
    expect(s.rowOf(b).getAttribute(ROW_ATTR)).toBe('rejected');
    expect(style()).toContain('opacity');
    expect(style()).not.toContain('shortlist');
    s.marks.configure({ pageMarks: true, dimRejected: false });
    expect(s.badgeOf(a)?.mark.dataset.s).toBe('shortlist');
    expect(s.rowOf(a).getAttribute(ROW_ATTR)).toBe('shortlist');
    expect(s.rowOf(b).hasAttribute(ROW_ATTR)).toBe(false);
    expect(style()).not.toContain('opacity');
    // Style sits in <head>, never inside #listing.
    expect(doc.getElementById(MARKS_STYLE_ID)?.parentElement).toBe(doc.head);
  });

  it('a redraw touches only rows whose state changed', async () => {
    const doc = load('deleted-com-p1');
    const s = await setup(doc);
    const changes = (domain: string) => {
      const list: MutationRecord[] = [];
      const observer = new MutationObserver((r) => list.push(...r));
      observer.observe(s.badgeOf(domain)?.root as ShadowRoot, { subtree: true, childList: true, attributes: true });
      observer.observe(s.rowOf(domain), { attributes: true });
      return () => [...list, ...observer.takeRecords()].length;
    };
    const first = changes(s.domains[0]);
    const second = changes(s.domains[1]);
    await s.store.add({
      sourceId: 'x/',
      sourceLabel: 'X',
      columns: [],
      rows: [{ domain: s.domains[0], stats: {} }],
    });
    await s.marks.refresh();
    expect(first()).toBeGreaterThan(0);
    expect(second()).toBe(0);
  });

  it('overlapping refreshes are coalesced into one more read, not one per change', async () => {
    const doc = load('deleted-com-p1');
    const s = await setup(doc);
    const before = s.reads.length;
    await Promise.all([s.marks.refresh(), s.marks.refresh(), s.marks.refresh()]);
    expect(s.reads.length - before).toBe(2);
  });

  it('a failed read (extension reloaded) keeps what is drawn', async () => {
    const doc = load('deleted-com-p1');
    const s = await setup(doc);
    const area = s.area as { get: unknown };
    area.get = async () => {
      throw new Error('Extension context invalidated.');
    };
    await expect(s.marks.refresh()).resolves.toBeUndefined();
    expect(s.badgeOf(s.domains[0])?.mark.dataset.s).toBe('none');
  });
});

describe('page marks: status menu (Ф30)', () => {
  it('the mark opens its own popover menu; focus stays on the mark (no autofocus)', async () => {
    const doc = load('deleted-com-p1');
    const s = await setup(doc);
    const b = s.badgeOf(s.domains[0]);
    expect(b?.mark.getAttribute('popovertarget')).toBe(b?.menu.id);
    expect(b?.menu.getAttribute('popover')).toBe('auto');
    b?.open();
    expect(b?.menu.getAttribute('aria-label')).toBe(`markMenu: ${s.domains[0]}`);
    expect(b?.menu.querySelector('[autofocus]')).toBeNull();
    expect(b?.item('new').disabled).toBe(true); // not in the collection: nothing to clear
  });

  it('a stored domain gets its status; the menu closes and the badge follows', async () => {
    const doc = load('deleted-com-p1');
    const [a] = parseListing(doc).rows.map((r) => r.domain);
    const s = await setup(doc, { stored: { [a]: {} } });
    const b = s.badgeOf(a);
    b?.open();
    const items = Array.from(b?.menu.querySelectorAll<HTMLButtonElement>('.item') ?? []);
    expect(items.map((x) => x.dataset.s)).toEqual(['shortlist', 'rejected', 'new']);
    expect(items[2].disabled).toBe(true); // already without status
    items[0].click();
    await flush();
    expect(s.updates).toEqual([[a, 'shortlist']]);
    expect(b?.isOpen()).toBe(false);
    // Redrawn in place: the same button, so the focus the browser returns to it is not lost.
    expect(s.badgeOf(a)?.mark).toBe(b?.mark);
    expect(s.badgeOf(a)?.mark.dataset.s).toBe('shortlist');
    expect(s.rowOf(a).getAttribute(ROW_ATTR)).toBe('shortlist');
    // Reopened: the current status is checked and disabled, "clear" is available.
    b?.open();
    expect(b?.item('shortlist').getAttribute('aria-checked')).toBe('true');
    expect(b?.item('shortlist').disabled).toBe(true);
    expect(b?.item('new').disabled).toBe(false);
  });

  it('a row not in the collection is saved alone, with the page columns, then gets the status', async () => {
    const doc = load('deleted-com-p1');
    const parsed = parseListing(doc);
    const target = parsed.rows[3];
    const s = await setup(doc);
    const b = s.badgeOf(target.domain);
    b?.open();
    b?.item('rejected').click();
    await flush();
    const rec = s.area.data.get(recordKey(target.domain)) as DomainRecord;
    expect(rec.status).toBe('rejected');
    expect(rec.stats).toEqual(target.stats);
    expect(rec.lists).toEqual([pageSource(URL_P1, doc.title).sourceId]);
    expect([...s.area.data.keys()].filter((k) => k.startsWith('d:'))).toEqual([recordKey(target.domain)]);
    expect(s.badgeOf(target.domain)?.mark.dataset.s).toBe('rejected');
    expect(s.badgeOf(target.domain)?.isNew).toBe(true);
  });

  it('a failed status change is reported in the panel status line', async () => {
    const doc = load('deleted-com-p1');
    const s = await setup(doc, { failUpdate: true });
    const b = s.badgeOf(s.domains[0]);
    b?.open();
    b?.item('shortlist').click();
    await flush();
    expect(s.failures()).toBe(1);
    expect(s.panel.root.querySelector('.status')?.textContent).toBe('panelNotSaved');
  });

  it('a page scroll closes the open menu', async () => {
    document.documentElement.innerHTML = load('deleted-com-p1').documentElement.innerHTML;
    const s = await setup(document);
    const b = s.badgeOf(s.domains[0]);
    b?.open();
    expect(b?.isOpen()).toBe(true);
    window.dispatchEvent(new Event('scroll'));
    expect(b?.isOpen()).toBe(false);
  });

  it('clicks and keys on our badge do not reach the site row handlers', async () => {
    const doc = load('deleted-com-p1');
    const s = await setup(doc);
    let seen = 0;
    for (const type of ['click', 'mousedown', 'keydown']) s.rowOf(s.domains[0]).addEventListener(type, () => seen++);
    const mark = s.badgeOf(s.domains[0])?.mark as HTMLButtonElement;
    mark.click();
    mark.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    mark.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }));
    expect(seen).toBe(0);
  });
});

describe('page-mark settings (Ф32, section 6)', () => {
  it('settings without the 0.2 keys are valid and read as on', () => {
    const old = { autoCapture: false, panelCollapsed: false, filterPresets: [], activePreset: 'all' };
    expect(settingsError(old)).toBeNull();
    expect(pageMarkSettings(old)).toEqual({ pageMarks: true, dimRejected: true });
    expect(settingsError({ ...old, pageMarks: 'yes' })).toBe('settings.pageMarks');
    expect(settingsError({ ...old, dimRejected: false })).toBeNull();
    expect(defaultSettings()).toMatchObject({ pageMarks: true, dimRejected: true });
  });

  it('a 0.1 install (4-key settings) can still store a setting and switch marks off', async () => {
    const area = memoryArea();
    area.data.set('settings', { autoCapture: false, panelCollapsed: false, filterPresets: [], activePreset: 'all' });
    const store = createStore(area, () => 1);
    await expect(store.setSettings({ autoCapture: true })).resolves.toMatchObject({ autoCapture: true });
    await expect(store.setSettings({ pageMarks: false })).resolves.toMatchObject({ pageMarks: false });
  });

  it('a 0.1 backup (settings without the 0.2 keys) restores', async () => {
    const settings = { autoCapture: false, panelCollapsed: false, filterPresets: [], activePreset: 'all' } as Settings;
    const state: State = { records: {}, sources: {}, columns: {}, columnOrder: [], settings };
    const parsed = parseBackup(makeBackup(state, new Date(1_795_000_000_000)));
    expect(parsed.ok).toBe(true);
    const store = createStore(memoryArea(), () => 1);
    await expect(store.restore(makeBackup(state, new Date(1_795_000_000_000)), 'replace')).resolves.toBeDefined();
  });

  it('the on-page panel stores its switches', async () => {
    const doc = load('deleted-com-p1');
    const calls: Partial<Settings>[] = [];
    const panel = mountPanel({
      doc,
      source: pageSource(URL_P1, doc.title),
      settings: { autoCapture: false, panelCollapsed: false, dimRejected: false },
      windowWidth: 1280,
      t,
      add: async () => ({ ok: false, error: 'x' }),
      setSettings: async (p) => {
        calls.push(p);
        return { ok: true, result: null };
      },
      contextInvalidated: () => false,
    });
    const boxes = Array.from(panel?.root.querySelectorAll<HTMLInputElement>('.auto input') ?? []);
    expect(boxes.map((b) => b.checked)).toEqual([false, true, false]);
    boxes[1].click();
    await flush();
    expect(calls).toEqual([{ pageMarks: false }]);
    panel?.setMarkSwitches({ pageMarks: true, dimRejected: true });
    expect(boxes.map((b) => b.checked)).toEqual([false, true, true]);
  });
});
