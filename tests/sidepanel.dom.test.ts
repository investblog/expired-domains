// Side panel smoke test (SPEC Ф13–Ф27) with a fake `browser` over the real store and an
// in-memory storage.local. Covers the UI part of A9 and A14 (select all beyond 500 rows).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleRequest } from '@/background/router';
import { createStore, type StorageArea } from '@/background/store';
import type { Capture } from '@/shared/records';
import type { Meta } from '@/shared/types';

type Listener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;

const fake = vi.hoisted(() => ({ browser: {} as Record<string, unknown> }));
vi.mock('wxt/browser', () => ({ browser: fake.browser }));

const A = 'member.expireddomains.net/domains/expiredcom/';

function setupBrowser() {
  const data = new Map<string, unknown>();
  const listeners = new Set<Listener>();
  const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
  const area: StorageArea = {
    async get(keys) {
      const list = keys === null || keys === undefined ? [...data.keys()] : Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const k of list) if (data.has(k)) out[k] = copy(data.get(k));
      return out;
    },
    async set(items) {
      const changes: Record<string, { newValue?: unknown }> = {};
      for (const [k, v] of Object.entries(items)) {
        data.set(k, copy(v));
        changes[k] = { newValue: copy(v) };
      }
      for (const l of listeners) l(changes, 'local');
    },
    async remove(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k);
    },
  };
  const store = createStore(area, () => Date.now());
  const sent: { type: string; [k: string]: unknown }[] = [];
  Object.assign(fake.browser, {
    runtime: {
      id: 'test-id',
      getURL: (p: string) => `chrome-extension://test-id${p}`,
      sendMessage: async (msg: { type: string }) => {
        sent.push(msg);
        return handleRequest(store, msg as never);
      },
    },
    i18n: {
      getMessage: (key: string, subs?: string[]) => [key, ...(subs ?? [])].join('|'),
      getUILanguage: () => 'en',
    },
    storage: {
      local: area,
      onChanged: {
        addListener: (l: Listener) => listeners.add(l),
        removeListener: (l: Listener) => listeners.delete(l),
      },
    },
  });
  (globalThis as Record<string, unknown>).browser = fake.browser;
  return { data, store, sent };
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};
const capture = (domains: string[], stats: Record<string, string> = { whois: 'available' }): Capture => ({
  sourceId: A,
  sourceLabel: 'Deleted .com Domains',
  columns: Object.keys(stats).map((key) => ({ key, label: key, title: '' })),
  rows: domains.map((domain) => ({ domain, stats })),
});
const byText = (root: ParentNode, sel: string, text: string) =>
  Array.from(root.querySelectorAll<HTMLElement>(sel)).find((e) => e.textContent === text) as HTMLElement;
const drawer = (id: string) => root.querySelector(`[data-drawer="${id}"]`) as HTMLElement;
const rows = () => Array.from(root.querySelectorAll('.row__domain')).map((e) => e.textContent);
const pressEscape = (el: HTMLElement) =>
  (el.querySelector('.drawer__panel') as HTMLElement).dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  );

let env: ReturnType<typeof setupBrowser>;
let root: HTMLElement;

async function open() {
  window.history.replaceState(null, '', '/sidepanel.html');
  root = document.createElement('div');
  document.body.replaceChildren(root);
  const { startApp } = await import('@/sidepanel/app');
  await startApp(root);
  await settle();
}

beforeEach(() => {
  env = setupBrowser();
});

describe('side panel smoke', () => {
  it('empty storage shows the empty state and reconciles first (Ф11)', async () => {
    await open();
    expect(env.sent[0]).toEqual({ type: 'eds:ensureReady' });
    expect(root.querySelector('.empty')).not.toBeNull();
    expect(root.querySelector('.list')).toBeNull();
  });

  it('the empty state explains the site, the account and the steps, with links (Ф13)', async () => {
    await open();
    const empty = root.querySelector('.empty') as HTMLElement;
    expect(empty.querySelector('.empty__title')?.textContent).toBe('emptyTitle');
    expect(Array.from(empty.querySelectorAll('.empty__steps li')).map((li) => li.textContent)).toEqual([
      'emptyStepAccount',
      'emptyStepList',
      'emptyStepSave',
    ]);
    const href = (text: string) => byText(empty, 'a', text).getAttribute('href');
    expect(href('linkRegister')).toBe('https://www.expireddomains.net/register/');
    expect(href('linkSiteOpen')).toBe('https://www.expireddomains.net/');
    expect(href('welcomeLink')).toBe('chrome-extension://test-id/welcome.html');
    for (const a of empty.querySelectorAll('a')) expect(a.getAttribute('target')).toBe('_blank');
  });

  it('lists domains with the default view; rejected are hidden (Ф13, A12)', async () => {
    await env.store.add(capture(['a.com', 'b.com', 'c.com']));
    await env.store.update(['b.com'], { status: 'rejected' });
    await open();
    const rows = Array.from(root.querySelectorAll('.row__domain')).map((e) => e.textContent);
    expect(rows).toEqual(['a.com', 'c.com']);
    expect(root.querySelector('.results__count')?.textContent).toBe('popupShown|2|3');
    expect(root.querySelector('.exportbar__count')?.textContent).toBe('popupExportCount|2|3');
    expect((root.querySelector('select.preset') as HTMLSelectElement).value).toBe('all');
  });

  it('live refresh: a capture while open shows up without reopening (Ф16)', async () => {
    await env.store.add(capture(['a.com']));
    await open();
    await env.store.add(capture(['b.com']));
    await settle();
    expect(Array.from(root.querySelectorAll('.row__domain')).map((e) => e.textContent)).toEqual(['a.com', 'b.com']);
  });

  it('text filter and invalid regex (Ф13, Ф25)', async () => {
    await env.store.add(capture(['bet1.com', 'casino.net', 'shop.org']));
    await open();
    const input = root.querySelector('input.search__input') as HTMLInputElement;
    input.value = '/bet|casino/';
    input.dispatchEvent(new Event('input'));
    expect(Array.from(root.querySelectorAll('.row__domain')).map((e) => e.textContent)).toEqual([
      'bet1.com',
      'casino.net',
    ]);
    input.value = '/(a+)+/';
    input.dispatchEvent(new Event('input'));
    expect(input.classList.contains('invalid')).toBe(true);
    expect(root.querySelectorAll('.row__domain')).toHaveLength(3);
  });

  it('select all beyond 500 shown rows applies a bulk action to every domain (A14)', async () => {
    const domains = Array.from({ length: 620 }, (_, i) => `d${String(i).padStart(3, '0')}.com`);
    for (let i = 0; i < domains.length; i += 25) await env.store.add(capture(domains.slice(i, i + 25)));
    await open();
    expect(root.querySelectorAll('.row')).toHaveLength(500);
    expect(root.querySelector('.more')?.textContent).toBe('popupMoreRows|120');
    byText(root, 'button', 'popupSelectAll|620').click();
    expect(root.querySelector('.bulk__count')?.textContent).toBe('bulkSelected|620');
    expect(drawer('bulk').hidden).toBe(true);
    byText(root, '.results__head button', 'bulkEdit').click();
    expect(drawer('bulk').hidden).toBe(false);
    expect(drawer('bulk').querySelector('.drawer__title')?.textContent).toBe('bulkSelected|620');
    const status = root.querySelector('.bulk select') as HTMLSelectElement;
    status.value = 'shortlist';
    byText(root, '.bulk button', 'bulkSetStatus').click();
    await settle();
    const update = env.sent.find((m) => m.type === 'eds:update') as unknown as { domains: string[] };
    expect(update.domains).toHaveLength(620);
    const stored = [...env.data].filter(
      ([k, v]) => k.startsWith('d:') && (v as { status?: string }).status === 'shortlist',
    );
    expect(stored).toHaveLength(620);
  });

  it('row editor saves status, tags and note (Ф20–Ф23)', async () => {
    await env.store.add(capture(['a.com']));
    await open();
    (root.querySelector('.row__main') as HTMLElement).click();
    expect(drawer('editor').hidden).toBe(false);
    expect(drawer('editor').querySelector('.drawer__title')?.textContent).toBe('a.com');
    expect(root.querySelector('.row--active')?.getAttribute('data-domain')).toBe('a.com');
    const editor = root.querySelector('.editor') as HTMLElement;
    (editor.querySelector('select') as HTMLSelectElement).value = 'bought';
    (editor.querySelector('input') as HTMLInputElement).value = 'Client A, x';
    (editor.querySelector('textarea') as HTMLTextAreaElement).value = 'call "owner"';
    byText(drawer('editor'), 'button', 'editorSave').click();
    await settle();
    expect(env.data.get('d:a.com')).toMatchObject({ status: 'bought', tags: ['Client A', 'x'], note: 'call "owner"' });
    expect(root.querySelector('.badge--bought')).not.toBeNull();
    expect(drawer('editor').hidden).toBe(true); // an editor drawer saves and closes
    expect(root.querySelector('.row--active')).toBeNull();
  });

  it('row editor: Escape closes without saving and returns focus to the row', async () => {
    await env.store.add(capture(['a.com']));
    await open();
    const main = root.querySelector('.row__main') as HTMLElement;
    main.focus();
    main.click();
    (root.querySelector('.editor select') as HTMLSelectElement).value = 'rejected';
    pressEscape(drawer('editor'));
    await settle();
    expect(drawer('editor').hidden).toBe(true);
    expect(document.activeElement).toBe(main);
    expect(env.sent.some((m) => m.type === 'eds:update')).toBe(false);
  });

  it('filter drawer: conditions apply live, survive closing and show as a count (Ф25)', async () => {
    await env.store.add(capture(['a.com', 'b.net', 'c.net']));
    await open();
    const btn = root.querySelector('.filter-btn') as HTMLButtonElement;
    const badge = btn.querySelector('.filter-btn__badge') as HTMLElement;
    expect(badge.hidden).toBe(true);
    expect(drawer('filters').hidden).toBe(true);
    btn.focus();
    btn.click();
    expect(drawer('filters').hidden).toBe(false);
    const zones = drawer('filters').querySelector('input[placeholder="com, net, co.uk"]') as HTMLInputElement;
    zones.value = 'net';
    zones.dispatchEvent(new Event('input', { bubbles: true }));
    expect(rows()).toEqual(['b.net', 'c.net']);
    expect(byText(drawer('filters'), '.drawer__footer button', 'filterShow|2')).toBeTruthy();
    pressEscape(drawer('filters'));
    expect(drawer('filters').hidden).toBe(true);
    expect(document.activeElement).toBe(btn);
    expect(rows()).toEqual(['b.net', 'c.net']);
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe('1');
    expect(btn.getAttribute('aria-label')).toBe('filterTitleActive|1');
    btn.click();
    byText(drawer('filters'), '.drawer__footer button', 'filterReset').click();
    expect(rows()).toEqual(['a.com', 'b.net', 'c.net']);
    expect(badge.hidden).toBe(true);
    (drawer('filters').querySelector('.drawer__overlay') as HTMLElement).click();
    expect(drawer('filters').hidden).toBe(true);
  });

  it('drawer: Escape still closes after a click re-rendered the focused button (focus on body)', async () => {
    await env.store.add(capture(['a.com']));
    await env.store.update(['a.com'], { addTags: ['x'] });
    await open();
    (root.querySelector('.header button[aria-label="dataTitle"]') as HTMLButtonElement).click();
    const del = drawer('data').querySelector('.tag-chip__btn') as HTMLButtonElement;
    del.focus();
    del.click(); // re-renders the chips: the focused button is gone
    expect(drawer('data').contains(document.activeElement)).toBe(false);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(drawer('data').hidden).toBe(true);
  });

  it('status chips in the toolbar toggle the status condition (Ф25)', async () => {
    await env.store.add(capture(['a.com', 'b.com']));
    await env.store.update(['b.com'], { status: 'rejected' });
    await open();
    const chip = byText(root, '.toolbar .chip', 'statusRejected');
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    expect(rows()).toEqual(['a.com']);
    chip.click();
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(rows()).toEqual(['a.com', 'b.com']);
    // Statuses are visible in the toolbar, so they do not count on the filter button.
    expect((root.querySelector('.filter-btn__badge') as HTMLElement).hidden).toBe(true);
  });

  it('presets: switching applies and remembers; save-as creates an own preset (Ф26)', async () => {
    await env.store.add(capture(['a.com', 'lot.com']));
    await env.store.add({ ...capture(['lot.com'], { endtime: '5h 33m' }) });
    await open();
    const select = root.querySelector('select.preset') as HTMLSelectElement;
    select.value = 'working-auctions';
    select.dispatchEvent(new Event('change'));
    await settle();
    expect(Array.from(root.querySelectorAll('.row__domain')).map((e) => e.textContent)).toEqual(['lot.com']);
    expect((env.data.get('settings') as { activePreset: string }).activePreset).toBe('working-auctions');
    (root.querySelector('.filter-btn') as HTMLButtonElement).click();
    (root.querySelector('.preset-bar input') as HTMLInputElement).value = 'Mine';
    byText(root, '.preset-bar button', 'presetSaveAs').click();
    await settle();
    const settings = env.data.get('settings') as { activePreset: string; filterPresets: { name: string }[] };
    expect(settings.filterPresets.map((p) => p.name)).toEqual(['Mine']);
    expect(settings.activePreset).toBe('p1');
  });

  it('clear asks first, then empties storage and keeps meta (Ф15)', async () => {
    await env.store.add(capture(['a.com', 'b.com']));
    await open();
    (root.querySelector('.header button[aria-label="dataTitle"]') as HTMLButtonElement).click();
    expect(drawer('data').hidden).toBe(false);
    byText(drawer('data'), 'button', 'clearAll').click();
    expect(root.querySelector('.confirm')?.textContent).toContain('clearQuestion|2');
    expect([...env.data.keys()].filter((k) => k.startsWith('d:'))).toHaveLength(2);
    byText(root, '.confirm button', 'clearConfirm|2').click();
    await settle();
    expect([...env.data.keys()].filter((k) => k.startsWith('d:'))).toHaveLength(0);
    expect((env.data.get('meta') as Meta).domainCount).toBe(0);
    expect(root.querySelector('.empty')).not.toBeNull();
  });

  it('restore is in the data drawer, also from the empty state (Ф27)', async () => {
    await open();
    byText(root, '.empty button', 'emptyRestore').click();
    expect(drawer('data').hidden).toBe(false);
    expect(drawer('data').querySelector('input[type="file"]')).not.toBeNull();
    expect(drawer('data').querySelector('label[for="eds-restore-file"]')).not.toBeNull();
  });

  it('no popup mode: no "pin to the side" button (Ф13а)', async () => {
    (fake.browser as Record<string, unknown>).sidebarAction = { open: async () => undefined };
    await env.store.add(capture(['a.com']));
    await open();
    expect(root.querySelectorAll('.header__actions button')).toHaveLength(2); // data, theme
  });

  it('a failed reconciliation shows an error instead of the data (Ф11)', async () => {
    await env.store.add(capture(['a.com']));
    const runtime = fake.browser.runtime as { sendMessage: (m: { type: string }) => Promise<unknown> };
    const real = runtime.sendMessage;
    runtime.sendMessage = async (m) => (m.type === 'eds:ensureReady' ? { ok: false, error: 'quota' } : real(m));
    await open();
    expect(root.querySelector('.error')?.textContent).toBe('popupNotReady');
    expect(root.querySelector('.row')).toBeNull();
  });

  it('a change committed between subscribing and the first read is not lost (Ф16)', async () => {
    await env.store.add(capture(['a.com']));
    const local = (fake.browser.storage as { local: StorageArea }).local;
    const realGet = local.get.bind(local);
    let first = true;
    local.get = async (keys) => {
      const out = await realGet(keys);
      if (keys === null && first) {
        first = false;
        await env.store.add(capture(['late.com'])); // lands after the popup's first read
      }
      return out;
    };
    await open();
    await settle();
    expect(Array.from(root.querySelectorAll('.row__domain')).map((e) => e.textContent)).toEqual(['a.com', 'late.com']);
  });

  it('restore that changes the active preset filter reloads it into the form (Ф16, Ф27)', async () => {
    await env.store.add(capture(['a.com', 'b.net']));
    await env.store.setSettings({
      filterPresets: [{ id: 'p1', name: 'Mine', filter: { zones: ['com'] } }],
      activePreset: 'p1',
    });
    await open();
    expect(Array.from(root.querySelectorAll('.row__domain')).map((e) => e.textContent)).toEqual(['a.com']);
    await env.store.setSettings({ filterPresets: [{ id: 'p1', name: 'Mine', filter: { zones: ['net'] } }] });
    await settle();
    expect(Array.from(root.querySelectorAll('.row__domain')).map((e) => e.textContent)).toEqual(['b.net']);
  });

  it('a stored filter above the old UI caps is kept (freshHours 100001)', async () => {
    await env.store.add(capture(['a.com']));
    await env.store.setSettings({
      filterPresets: [{ id: 'p1', name: 'Long', filter: { freshHours: 100_001 } }],
      activePreset: 'p1',
    });
    await open();
    expect(root.querySelector('input.invalid')).toBeNull();
    expect(root.querySelectorAll('.row')).toHaveLength(1);
  });
});
