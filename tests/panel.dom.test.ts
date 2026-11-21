// SPEC stage 3: the on-page panel on real fixtures (Ф1–Ф4, Е2, Е3, С1, С2), the panel side of A4,
// the A3 sentinel through storage, and the A15 round trip through the real parser.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createStore, type StorageArea } from '@/background/store';
import { HOST_STYLE, mountPanel, NARROW_WIDTH, PANEL_HOST_ID, type PanelDeps, SHIMMER_MS } from '@/content/panel';
import { makeBackup, parseBackup } from '@/shared/backup';
import { MAX_COLUMN_LABEL, MAX_COLUMN_TITLE, MAX_SOURCE_ID, MAX_SOURCE_LABEL } from '@/shared/limits';
import type { Response } from '@/shared/messages';
import { pageSource } from '@/shared/source';
import type { DomainRecord, Meta, Settings, State } from '@/shared/types';

const load = (name: string): Document =>
  new DOMParser().parseFromString(readFileSync(resolve('tests/fixtures', `${name}.html`), 'utf8'), 'text/html');

/** In-memory storage.local with JSON copies, like the real one. */
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

function setup(doc: Document, overrides: Partial<PanelDeps> = {}) {
  const area = memoryArea();
  const store = createStore(area, () => 1_795_000_000_000);
  const adds: unknown[] = [];
  const settingsCalls: Partial<Settings>[] = [];
  const deps: PanelDeps = {
    doc,
    source: pageSource(URL_P1, doc.title),
    settings: { autoCapture: false, panelCollapsed: false },
    windowWidth: 1280,
    t,
    add: async (capture) => {
      adds.push(capture);
      try {
        return { ok: true, result: await store.add(capture) };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    },
    setSettings: async (partial) => {
      settingsCalls.push(partial);
      return { ok: true, result: null };
    },
    contextInvalidated: () => false,
    ...overrides,
  };
  const handle = mountPanel(deps);
  const q = <T extends Element = HTMLElement>(sel: string) => handle?.root.querySelector(sel) as T;
  return { area, store, handle, q, adds, settingsCalls };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('panel on real pages (Ф1, Ф2, С1)', () => {
  it('shows count and pager; save stores the page and reports +K new', async () => {
    const doc = load('deleted-com-p1');
    const listingBefore = doc.querySelector('#listing')?.outerHTML;
    const { handle, q, area } = setup(doc);
    expect(handle).not.toBeNull();
    expect(doc.getElementById(PANEL_HOST_ID)).toBe(handle?.host);
    expect(q('.info').textContent).toBe('panelOnPage|25 · panelPage|1|58270');
    expect(q<HTMLButtonElement>('.save').disabled).toBe(false);
    expect(q('.warning').hidden).toBe(true);
    q<HTMLButtonElement>('.save').click();
    await flush();
    await flush();
    expect(q('.status').textContent).toBe('panelSaved|25|0|25');
    expect((area.data.get('meta') as Meta).domainCount).toBe(25);
    expect(doc.querySelector('#listing')?.outerHTML).toBe(listingBefore);
  });

  it('the closed shadow root is not reachable from the page', () => {
    const { handle } = setup(load('deleted-com-p1'));
    expect(handle?.host.shadowRoot).toBeNull();
  });

  it('host styles are inline !important, so page styles cannot hide or move it (Ф3, A8)', () => {
    // The live document, so jsdom computes the cascade (DOMParser documents have no window).
    document.documentElement.innerHTML = load('deleted-com-p1').documentElement.innerHTML;
    const sheet = document.createElement('style');
    sheet.textContent = `#${PANEL_HOST_ID} { display: none !important; position: static !important }`;
    document.head.append(sheet);
    const host = setup(document).handle?.host as HTMLElement;
    for (const [prop] of HOST_STYLE) {
      expect(host.style.getPropertyPriority(prop), prop).toBe('important');
      // jsdom does not echo the `all` shorthand back
      if (prop !== 'all') expect(host.style.getPropertyValue(prop), prop).not.toBe('');
    }
    const computed = window.getComputedStyle(host);
    expect(computed.display).toBe('block');
    expect(computed.position).toBe('fixed');
    host.remove();
  });

  it('no #listing → no panel at all', () => {
    const doc = load('deleted-com-p1');
    doc.querySelector('#listing')?.remove();
    expect(setup(doc).handle).toBeNull();
    expect(doc.getElementById(PANEL_HOST_ID)).toBeNull();
  });

  it('is not mounted twice', () => {
    const doc = load('deleted-com-p1');
    setup(doc);
    expect(setup(doc).handle).toBeNull();
  });
});

describe('panel by parse code (Е2, A4 panel side)', () => {
  const cases: [string, (d: Document) => void, string | null][] = [
    ['no table', (d) => d.querySelector('table.base1')?.remove(), 'panelLayoutUnknown'],
    [
      'no th.head_domain',
      (d) => d.querySelector('th.head_domain')?.classList.remove('head_domain'),
      'panelLayoutUnknown',
    ],
    [
      'no td.field_domain',
      (d) => {
        for (const td of d.querySelectorAll('td.field_domain')) td.classList.remove('field_domain');
      },
      'panelLayoutUnknown',
    ],
    [
      '30% garbage',
      (d) => {
        for (const a of Array.from(d.querySelectorAll('td.field_domain a.namelinks')).slice(0, 8)) {
          a.setAttribute('title', 'not a domain');
        }
      },
      'panelLayoutUnknown',
    ],
    [
      'empty tbody',
      (d) => {
        const b = d.querySelector('table.base1 tbody');
        if (b) b.innerHTML = '';
      },
      'panelEmpty',
    ],
  ];

  for (const [name, edit, warning] of cases) {
    it(`${name} → "${warning}", saving disabled, auto-capture skips`, async () => {
      const doc = load('deleted-com-p1');
      edit(doc);
      const { q, adds, handle } = setup(doc, { settings: { autoCapture: true, panelCollapsed: false } });
      await handle?.autoDone;
      expect(q('.warning').hidden).toBe(false);
      expect(q('.warning').textContent).toBe(warning);
      expect(q<HTMLButtonElement>('.save').disabled).toBe(true);
      expect(adds).toEqual([]);
    });
  }

  it('real empty search result → "list is empty"', () => {
    const { q } = setup(load('search-empty'));
    expect(q('.warning').textContent).toBe('panelEmpty');
    expect(q('.info').textContent).toBe('panelOnPage|0');
  });
});

describe('auto-capture, collapse, errors (С2, Ф3, Е3)', () => {
  it('auto-capture saves the page on load', async () => {
    const { handle, area } = setup(load('pendingdelete'), { settings: { autoCapture: true, panelCollapsed: false } });
    await handle?.autoDone;
    expect((area.data.get('meta') as Meta).domainCount).toBe(25);
  });

  it('the collapsed launcher shows the auto-capture mode and follows the stored switch (Ф3а)', async () => {
    const on = setup(load('deleted-com-p1'), { settings: { autoCapture: true, panelCollapsed: true } });
    expect(on.q('.collapsed').classList.contains('collapsed--auto')).toBe(true);
    expect(on.q('.collapsed').getAttribute('aria-label')).toBe('extName — panelAutoOn — panelExpand');
    const off = setup(load('deleted-com-p1'), { settings: { autoCapture: false, panelCollapsed: true } });
    expect(off.q('.collapsed').classList.contains('collapsed--auto')).toBe(false);
    expect(off.q('.collapsed').getAttribute('aria-label')).toBe('extName — panelExpand');
    const box = off.q<HTMLInputElement>('input[type="checkbox"]');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await flush();
    expect(off.q('.collapsed').classList.contains('collapsed--auto')).toBe(true);
    // Not stored → the launcher does not claim the mode.
    const failing = setup(load('deleted-com-p1'), { setSettings: async () => ({ ok: false, error: 'quota' }) });
    const box2 = failing.q<HTMLInputElement>('input[type="checkbox"]');
    box2.checked = true;
    box2.dispatchEvent(new Event('change'));
    await flush();
    expect(failing.q('.collapsed').classList.contains('collapsed--auto')).toBe(false);
  });

  it('in auto-capture mode the launcher or "Save page" shimmers only when new domains were added (Ф3а)', async () => {
    const shimmering = (x: { q: (s: string) => HTMLElement }, sel: string) => x.q(sel).classList.contains('shimmer');
    const collapsed = setup(load('pendingdelete'), { settings: { autoCapture: true, panelCollapsed: true } });
    await collapsed.handle?.autoDone;
    expect(shimmering(collapsed, '.collapsed')).toBe(true);
    await new Promise((r) => setTimeout(r, SHIMMER_MS + 50));
    expect(shimmering(collapsed, '.collapsed')).toBe(false);
    // The same page again: 0 new, only updated → no sweep.
    collapsed.q<HTMLButtonElement>('.save').click();
    await flush();
    await flush();
    expect(collapsed.q('.status').textContent).toMatch(/^panelSaved\|0\|/);
    expect(shimmering(collapsed, '.collapsed')).toBe(false);

    // Expanded panel: the sweep runs on "Save page".
    const expanded = setup(load('pendingdelete'), { settings: { autoCapture: true, panelCollapsed: false } });
    await expanded.handle?.autoDone;
    expect(expanded.q('.panel').hidden).toBe(false);
    expect(shimmering(expanded, '.save')).toBe(true);

    // Auto-capture off: a manual save that adds domains gives no sweep.
    const manual = setup(load('pendingdelete'));
    manual.q<HTMLButtonElement>('.save').click();
    await flush();
    await flush();
    expect(manual.q('.status').textContent).toMatch(/^panelSaved\|25\|/);
    expect(shimmering(manual, '.save')).toBe(false);
  });

  it('starts collapsed when narrow or remembered; toggling is remembered', () => {
    const narrow = setup(load('deleted-com-p1'), { windowWidth: NARROW_WIDTH - 1 });
    expect(narrow.q('.panel').hidden).toBe(true);
    expect(narrow.q('.collapsed').hidden).toBe(false);
    const wide = setup(load('deleted-com-p1'));
    expect(wide.q('.panel').hidden).toBe(false);
    wide.q<HTMLButtonElement>('.icon-btn').click();
    expect(wide.q('.panel').hidden).toBe(true);
    wide.q<HTMLButtonElement>('.collapsed').click();
    expect(wide.q('.panel').hidden).toBe(false);
    expect(wide.settingsCalls).toEqual([{ panelCollapsed: true }, { panelCollapsed: false }]);
  });

  it('the auto-capture switch is stored through the background', () => {
    const { q, settingsCalls } = setup(load('deleted-com-p1'));
    const box = q<HTMLInputElement>('input[type="checkbox"]');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(settingsCalls).toEqual([{ autoCapture: true }]);
  });

  it('a setting that was not stored is reported and the switch goes back', async () => {
    const { q } = setup(load('deleted-com-p1'), {
      setSettings: async () => ({ ok: false, error: 'quota' }),
    });
    const box = q<HTMLInputElement>('input[type="checkbox"]');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await flush();
    expect(box.checked).toBe(false);
    expect(q('.status').textContent).toBe('panelNotSaved');
  });

  it('a failed save says "not saved"; a reloaded extension says "reload the page"', async () => {
    const failing = setup(load('deleted-com-p1'), {
      add: async (): Promise<Response<never>> => ({ ok: false, error: 'closed' }),
    });
    failing.q<HTMLButtonElement>('.save').click();
    await flush();
    expect(failing.q('.status').textContent).toBe('panelNotSaved');
    expect(failing.q<HTMLButtonElement>('.save').disabled).toBe(false);

    const stale = setup(load('deleted-com-p1'), { contextInvalidated: () => true });
    stale.q<HTMLButtonElement>('.save').click();
    await flush();
    expect(stale.q('.status').textContent).toBe('panelReload');
    expect(stale.adds).toEqual([]);
  });

  it('after the extension is reloaded, i18n throws and every control still answers without an uncaught error', async () => {
    let gone = false;
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    try {
      const orphan = setup(load('deleted-com-p1'), {
        contextInvalidated: () => gone,
        t: (key, ...subs) => {
          if (gone) throw new Error('Extension context invalidated.');
          return t(key, ...subs);
        },
        setSettings: async (): Promise<Response<never>> => ({ ok: false, error: 'Extension context invalidated.' }),
      });
      gone = true;
      orphan.q<HTMLButtonElement>('.save').click();
      await flush();
      expect(orphan.q('.status').textContent).toBe('panelReload');
      const box = orphan.q<HTMLInputElement>('input[type="checkbox"]');
      box.checked = true;
      box.dispatchEvent(new Event('change'));
      orphan.q<HTMLButtonElement>('.icon-btn').click();
      await flush();
      await new Promise((r) => setTimeout(r, 0));
      expect(box.checked).toBe(false);
      expect(orphan.q('.status').textContent).toBe('panelReload');
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

describe('end to end through storage', () => {
  it('A3: a sentinel outside #listing never reaches storage', async () => {
    const doc = load('deleted-com-p1');
    const decoy = doc.createElement('div');
    decoy.innerHTML =
      '<span class="account">SENTINEL_ACCOUNT</span><table class="base1"><thead><tr><th class="head_domain">D</th>' +
      '<th class="head_bl">SENTINEL_ACCOUNT</th></tr></thead><tbody><tr><td class="field_domain">' +
      '<a title="sentinel-account.com">x</a></td><td class="field_bl">SENTINEL_ACCOUNT</td></tr></tbody></table>';
    doc.body.prepend(decoy);
    const { q, area } = setup(doc);
    q<HTMLButtonElement>('.save').click();
    await flush();
    await flush();
    const dumped = JSON.stringify([...area.data.entries()]);
    expect(dumped).toContain('clean-hoodsexpress.com');
    expect(dumped).not.toMatch(/SENTINEL_ACCOUNT|sentinel-account/);
  });

  it('A15: over-long header, title and q go through parser → storage → backup → replace intact', async () => {
    const doc = load('deleted-com-p1');
    const th = doc.querySelector('th.head_bl') as Element;
    th.querySelector('a')?.setAttribute('title', '😀'.repeat(1500));
    th.querySelector('a')?.append('L'.repeat(400));
    doc.title = `${'T'.repeat(600)} » ExpiredDomains.net`;
    const longUrl = `https://member.expireddomains.net/domain-name-search/?q=${'k'.repeat(2000)}`;
    const { q, area, store } = setup(doc, { source: pageSource(longUrl, doc.title) });
    q<HTMLButtonElement>('.save').click();
    await flush();
    await flush();
    const meta = area.data.get('meta') as Meta;
    const [sourceId] = Object.keys(meta.sources);
    expect(sourceId.length).toBeLessThanOrEqual(MAX_SOURCE_ID);
    expect(Array.from(meta.sources[sourceId]).length).toBe(MAX_SOURCE_LABEL);
    expect(Array.from(meta.columns.bl.title).length).toBe(MAX_COLUMN_TITLE);
    expect(Array.from(meta.columns.bl.label).length).toBe(MAX_COLUMN_LABEL);

    const snapshot = (): State => {
      const records: Record<string, DomainRecord> = {};
      for (const [k, v] of area.data) if (k.startsWith('d:')) records[k.slice(2)] = v as DomainRecord;
      const m = area.data.get('meta') as Meta;
      return {
        records,
        sources: m.sources,
        columns: m.columns,
        columnOrder: m.columnOrder,
        settings: area.data.get('settings') as Settings,
      };
    };
    const before = snapshot();
    const text = makeBackup(before, new Date(Date.UTC(2026, 10, 20)));
    expect(parseBackup(text).ok).toBe(true);
    await store.clear();
    await store.restore(text, 'replace');
    expect(snapshot()).toEqual(before);
  });
});
