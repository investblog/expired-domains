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
    tabs: undefined, // per test: see fakeTabs()
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
/** Live start steps as [state, title]. */
const startSteps = () =>
  Array.from(root.querySelectorAll('.start__step')).map((li) => [
    li.className.replace(/.*start__step--(\w+).*/, '$1'),
    li.querySelector('.start__title')?.textContent,
  ]);
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
    // No tabs API (store harness, video stub): step 1 is current, as when the site is not open.
    expect(startSteps()).toEqual([
      ['now', 'startOpenSite'],
      ['next', 'startOpenList'],
      ['next', 'startSave'],
    ]);
    const href = (text: string) => byText(empty, 'a', text).getAttribute('href');
    expect(href('linkRegister')).toBe('https://www.expireddomains.net/register/');
    expect(href('linkSiteOpen')).toBe('https://www.expireddomains.net/');
    expect(href('welcomeLink')).toBe('chrome-extension://test-id/welcome.html');
    expect(empty.textContent).toContain('startReloadHint');
    for (const a of empty.querySelectorAll('a')) expect(a.getAttribute('target')).toBe('_blank');
  });

  describe('live start steps from the active tab (Ф13в)', () => {
    /** A fake tabs API: the active tab answers like our content script, or not at all. */
    function fakeTabs(answer: (msg: { type: string }) => unknown) {
      const calls: { tabId: number; msg: { type: string } }[] = [];
      const activated: (() => void)[] = [];
      const runtimeListeners: ((msg: unknown) => unknown)[] = [];
      Object.assign(fake.browser, {
        tabs: {
          query: async () => [{ id: 7 }],
          sendMessage: async (tabId: number, msg: { type: string }) => {
            calls.push({ tabId, msg });
            const res = answer(msg);
            if (res instanceof Error) throw res;
            return res;
          },
          onActivated: { addListener: (fn: () => void) => activated.push(fn) },
          onUpdated: { addListener: () => undefined },
        },
      });
      (fake.browser.runtime as Record<string, unknown>).onMessage = {
        addListener: (fn: (msg: unknown) => unknown) => runtimeListeners.push(fn),
      };
      return { calls, activated, runtimeListeners };
    }
    const noScript = () => new Error('Could not establish connection. Receiving end does not exist.');

    it('no answer from the tab: open the site, with the reload hint', async () => {
      fakeTabs(noScript);
      await open();
      expect(startSteps()[0]).toEqual(['now', 'startOpenSite']);
      expect(root.querySelector('.start')?.textContent).toContain('startReloadHint');
    });

    it('on the site without a list: step 2 with the first list to open', async () => {
      fakeTabs(() => ({ listing: false }));
      await open();
      expect(startSteps()).toEqual([
        ['done', 'startSiteOpen'],
        ['now', 'startOpenList'],
        ['next', 'startSave'],
      ]);
      expect(byText(root, 'a', 'startFirstList').getAttribute('href')).toBe(
        'https://member.expireddomains.net/domains/expiredcom/',
      );
    });

    it('on a list: "Save this page" asks the tab to save; the list then replaces the steps', async () => {
      const tabs = fakeTabs((msg) => {
        if (msg.type === 'edsTab:state') return { listing: true, mode: 'ready', rows: 2 };
        // The content script saves through the background, as its own button does.
        return env.store.add(capture(['alpha.com', 'beta.com'])).then((result) => ({ ok: true, result }));
      });
      await open();
      expect(startSteps().map((s) => s[0])).toEqual(['done', 'done', 'now']);
      expect(root.querySelector('.start')?.textContent).toContain('panelOnPage|2');
      const save = byText(root, 'button', 'startSaveHere') as HTMLButtonElement;
      expect(save.disabled).toBe(false);
      save.click();
      await settle();
      expect(tabs.calls.at(-1)).toEqual({ tabId: 7, msg: { type: 'edsTab:save' } });
      expect(root.querySelector('.toast')?.textContent).toBe('panelSaved|2|0|2');
      expect(rows()).toEqual(['alpha.com', 'beta.com']);
    });

    it('a list page without rows: saving is off and the sign-in reason is shown', async () => {
      fakeTabs(() => ({ listing: true, mode: 'empty', rows: 0 }));
      await open();
      expect((byText(root, 'button', 'startSaveHere') as HTMLButtonElement).disabled).toBe(true);
      expect(root.querySelector('.start')?.textContent).toContain('startPageEmpty');
    });

    it('auto-capture in step 3 is the same setting as on the page', async () => {
      fakeTabs(() => ({ listing: true, mode: 'ready', rows: 2 }));
      await open();
      const box = root.querySelector('.start__auto input') as HTMLInputElement;
      box.checked = true;
      box.dispatchEvent(new Event('change'));
      await settle();
      expect(env.sent).toContainEqual({ type: 'eds:setSettings', settings: { autoCapture: true } });
    });

    it('switching tabs or a page announcing itself asks again', async () => {
      let page: unknown = noScript();
      const tabs = fakeTabs(() => page);
      await open();
      expect(startSteps()[0][0]).toBe('now');
      page = { listing: false };
      for (const fn of tabs.activated) fn();
      await settle();
      expect(startSteps()[1]).toEqual(['now', 'startOpenList']);
      page = { listing: true, mode: 'ready', rows: 5 };
      for (const fn of tabs.runtimeListeners) expect(fn({ type: 'edsTab:ready' })).toBeUndefined();
      await settle();
      expect(startSteps()[2][0]).toBe('now');
      // Writer requests are not answered here (the background answers them).
      for (const fn of tabs.runtimeListeners) expect(fn({ type: 'eds:ensureReady' })).toBeUndefined();
    });
  });

  it('the footer is a row of labelled icon links from the sprite (Ф16а)', async () => {
    await open();
    const links = Array.from(root.querySelectorAll<HTMLAnchorElement>('.footer a'));
    expect(links.map((a) => [a.getAttribute('aria-label'), a.querySelector('use')?.getAttribute('href')])).toEqual([
      ['welcomeLink', '#i-mono-help-circle'],
      ['footerRate', '#i-brand-chrome'],
      ['footerIssues', '#i-brand-github'],
      ['301.st', '#i-brand-301'],
      ['footerSupport', '#i-brand-telegram'],
    ]);
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'chrome-extension://test-id/welcome.html',
      'https://chromewebstore.google.com/detail/test-id/reviews',
      'https://github.com/investblog/expired-domains/issues',
      'https://301.st/?utm_source=expired-domains&utm_medium=extension&utm_campaign=footer',
      'https://t.me/traffic301',
    ]);
    for (const a of links) {
      expect(a.title).toBe(a.getAttribute('aria-label'));
      expect(a.getAttribute('target')).toBe('_blank');
    }
    // Every <use> in the panel points at a symbol of the one sprite in the document.
    expect(document.querySelectorAll('#eds-icon-sprite')).toHaveLength(1);
    for (const use of document.querySelectorAll('use')) {
      expect(document.getElementById(use.getAttribute('href')!.slice(1))?.localName).toBe('symbol');
    }
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
    const bought = root.querySelector('.badge--bought') as HTMLElement;
    expect(bought.getAttribute('aria-label')).toBe('statusBought');
    expect(bought.querySelector('use')?.getAttribute('href')).toBe('#i-mono-check');
    // The list kind and the zone's mark sit in the right column; status, tags and note on the
    // second line; the full list name is the row's tooltip (Ф8).
    const main = root.querySelector('.row__main') as HTMLElement;
    expect(main.title).toBe('Deleted .com Domains');
    expect(main.querySelector('.row__name')?.textContent).toBe('a');
    expect(main.querySelector('.row__zone')?.textContent).toBe('.com');
    expect(main.querySelector('.row__meta .badge--kind')?.textContent).toBe('kindDeleted');
    expect(main.querySelector('.row__meta .row__zone-mark')).not.toBeNull();
    expect(Array.from(main.querySelectorAll('.row__extra .tag'), (b) => b.textContent)).toEqual(['Client A', 'x']);
    expect(main.querySelector('.row__extra .badge--bought')).not.toBeNull();
    expect(main.querySelector('.row__extra .row__note')).not.toBeNull();
    expect(drawer('editor').hidden).toBe(true); // an editor drawer saves and closes
    expect(root.querySelector('.row--active')).toBeNull();
  });

  it('a row without status, tags or note has no second line; more than two tags fold into "+N"', async () => {
    await env.store.add(capture(['plain.com', 'tagged.com']));
    await env.store.update(['tagged.com'], { addTags: ['one', 'two', 'three', 'four'] });
    await open();
    const row = (d: string) => root.querySelector(`.row[data-domain="${d}"]`) as HTMLElement;
    expect(row('plain.com').querySelector('.row__extra')).toBeNull();
    const tags = Array.from(row('tagged.com').querySelectorAll<HTMLElement>('.row__extra .tag'));
    expect(tags.map((x) => x.textContent)).toEqual(['one', 'two', '+2']);
    expect(tags[2].title).toBe('one, two, three, four');
  });

  it('zone mark: a country flag for a country zone, a globe for a generic one (Ф8)', async () => {
    await env.store.add(capture(['28.gd', 'a.com', 'x.io']));
    await open();
    const zone = (d: string) => root.querySelector(`.row[data-domain="${d}"] .row__zone-mark`) as HTMLElement;
    expect(zone('28.gd').querySelector('img')?.getAttribute('src')).toBe('/flags/gd.svg');
    expect(zone('28.gd').title).toMatch(/^\.gd/);
    expect(zone('28.gd').title).not.toContain('zoneGeneric');
    expect(zone('28.gd').getAttribute('aria-label')).toBe(zone('28.gd').title);
    expect(zone('a.com').querySelector('img')).toBeNull();
    expect(zone('a.com').querySelector('use')?.getAttribute('href')).toBe('#i-mono-web');
    expect(zone('a.com').title).toBe('.com · zoneGeneric');
    expect(zone('x.io').querySelector('use')?.getAttribute('href')).toBe('#i-mono-web');
    expect(zone('x.io').title).toMatch(/zoneGeneric$/);
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
    expect(root.querySelector('.confirm:not([hidden])')?.textContent).toContain('clearQuestion|2');
    expect([...env.data.keys()].filter((k) => k.startsWith('d:'))).toHaveLength(2);
    byText(root, '.confirm button', 'clearConfirm|2').click();
    await settle();
    expect([...env.data.keys()].filter((k) => k.startsWith('d:'))).toHaveLength(0);
    expect((env.data.get('meta') as Meta).domainCount).toBe(0);
    expect(root.querySelector('.empty')).not.toBeNull();
  });

  it('bulk delete asks first, deletes the selected domains and clears the selection (Ф15а)', async () => {
    await env.store.add(capture(['a.com', 'b.com', 'c.com']));
    await open();
    for (const d of ['a.com', 'c.com'])
      (root.querySelector(`.row[data-domain="${d}"] input`) as HTMLInputElement).click();
    byText(root, 'button', 'bulkEdit').click();
    byText(drawer('bulk'), 'button', 'bulkDelete|2').click();
    const box = drawer('bulk').querySelector('.confirm:not([hidden])') as HTMLElement;
    expect(box.textContent).toContain('deleteQuestion|2');
    expect(box.textContent).toContain('deleteWarning');
    expect(rows()).toHaveLength(3); // nothing deleted before the second click
    byText(box, 'button', 'clearConfirm|2').click();
    await settle();
    expect(rows()).toEqual(['b.com']);
    expect(drawer('bulk').hidden).toBe(true);
    expect(root.querySelector('.results__head--bulk')).toBeNull();
  });

  it('the domain card deletes its domain and closes (Ф15а)', async () => {
    await env.store.add(capture(['a.com', 'b.com']));
    await open();
    (root.querySelector('.row[data-domain="a.com"] .row__main') as HTMLElement).click();
    byText(drawer('editor'), 'button', 'editorDelete').click();
    const box = drawer('editor').querySelector('.confirm:not([hidden])') as HTMLElement;
    expect(box.textContent).toContain('deleteOneQuestion|a.com');
    byText(box, 'button', 'clearConfirm|1').click();
    await settle();
    expect(rows()).toEqual(['b.com']);
    expect(drawer('editor').hidden).toBe(true);
  });

  it('the data drawer clears one list; a domain from another list stays (Ф15а)', async () => {
    await env.store.add(capture(['only.com', 'both.com']));
    await env.store.add({
      ...capture(['both.com', 'other.com']),
      sourceId: 'member.expireddomains.net/domains/watchlist/',
      sourceLabel: 'Watchlist Domains',
    });
    await open();
    (root.querySelector('.header button[aria-label="dataTitle"]') as HTMLButtonElement).click();
    const lists = Array.from(drawer('data').querySelectorAll('.data-list'), (x) => x.textContent);
    expect(lists).toEqual(['Deleted .com Domains2listClear', 'Watchlist Domains2listClear']);
    const row = Array.from(drawer('data').querySelectorAll<HTMLElement>('.data-list'))[0];
    byText(row, 'button', 'listClear').click();
    const box = drawer('data').querySelector('.confirm:not([hidden])') as HTMLElement;
    expect(box.textContent).toContain('listClearQuestion|Deleted .com Domains|1');
    expect(box.textContent).toContain('listClearKept|1');
    byText(box, 'button', 'listClearConfirm').click();
    await settle();
    expect(rows().sort()).toEqual(['both.com', 'other.com']);
    expect(Array.from(drawer('data').querySelectorAll('.data-list'), (x) => x.textContent)).toEqual([
      'Watchlist Domains2listClear',
    ]);
  });

  it('"Clear all" asks again when the collection grew while the question was open (Ф15)', async () => {
    await env.store.add(capture(['a.com']));
    await open();
    (root.querySelector('.header button[aria-label="dataTitle"]') as HTMLButtonElement).click();
    byText(drawer('data'), 'button', 'clearAll').click();
    const box = root.querySelector('.confirm:not([hidden])') as HTMLElement;
    expect(box.textContent).toContain('clearQuestion|1');
    await env.store.add(capture(['b.com'])); // auto-capture in another tab
    await settle();
    byText(box, 'button', 'clearConfirm|1').click();
    await settle();
    expect(rows().sort()).toEqual(['a.com', 'b.com']);
    expect(box.hidden).toBe(false);
    expect(box.textContent).toContain('clearQuestion|2');
  });

  it('a list that grew while the question was open is asked about again, not cleared (Ф15а)', async () => {
    await env.store.add(capture(['only.com']));
    await open();
    (root.querySelector('.header button[aria-label="dataTitle"]') as HTMLButtonElement).click();
    const clear = drawer('data').querySelector('.data-list button') as HTMLButtonElement;
    expect(clear.getAttribute('aria-label')).toBe('listClearLabel|Deleted .com Domains');
    clear.click();
    const box = drawer('data').querySelector('.confirm:not([hidden])') as HTMLElement;
    expect(box.textContent).toContain('listClearQuestion|Deleted .com Domains|1');
    await env.store.add(capture(['new1.com', 'new2.com'])); // auto-capture in another tab
    await settle();
    byText(box, 'button', 'listClearConfirm').click();
    await settle();
    expect(rows().sort()).toEqual(['new1.com', 'new2.com', 'only.com']);
    expect(box.hidden).toBe(false);
    expect(box.textContent).toContain('listClearQuestion|Deleted .com Domains|3');
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
