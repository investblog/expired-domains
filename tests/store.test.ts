// SPEC stage 2: the mutation queue on WXT's fake storage — A5, A6, A12, A14, A15 (storage part), Ф12, Ф16.
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { badgeText, handleRequest } from '@/background/router';
import { createStore, type StorageArea } from '@/background/store';
import { makeBackup } from '@/shared/backup';
import { defaultSettings } from '@/shared/presets';
import { type Capture, emptyMeta, recordKey } from '@/shared/records';
import { type ChangeListener, watchMeta } from '@/shared/refresh';
import type { DomainRecord, Meta, Settings, State } from '@/shared/types';

const A = 'member.expireddomains.net/domains/expiredcom/';
const B = 'member.expireddomains.net/domains/watchlist/';
const local = () => fakeBrowser.storage.local as unknown as StorageArea;

/** Storage wrapper that counts calls and can fail selected writes. */
function instrumented(base: StorageArea = local()) {
  const calls = { get: [] as unknown[], set: [] as string[][], remove: [] as string[][] };
  let failSet: ((items: Record<string, unknown>, n: number) => boolean) | null = null;
  /** When set, a failing `set` first writes this many of its keys (a partial multi-key write). */
  let partialKeys = 0;
  let failRemove = false;
  const area: StorageArea = {
    get: (keys) => {
      calls.get.push(keys ?? null);
      return base.get(keys);
    },
    set: async (items) => {
      calls.set.push(Object.keys(items));
      if (failSet?.(items, calls.set.length)) {
        if (partialKeys) await base.set(Object.fromEntries(Object.entries(items).slice(0, partialKeys)));
        throw new Error('quota');
      }
      return base.set(items);
    },
    remove: async (keys) => {
      calls.remove.push(Array.isArray(keys) ? keys : [keys]);
      if (failRemove) throw new Error('remove failed');
      return base.remove(keys);
    },
  };
  return {
    area,
    calls,
    failSetWhen: (f: typeof failSet) => {
      failSet = f;
    },
    failRemove: (on: boolean) => {
      failRemove = on;
    },
    partial: (n: number) => {
      partialKeys = n;
    },
  };
}

const capture = (sourceId: string, domains: string[], stats: Record<string, string> = { bl: '1' }): Capture => ({
  sourceId,
  sourceLabel: sourceId === A ? 'Deleted .com Domains' : 'Watchlist Domains',
  columns: Object.keys(stats).map((key) => ({ key, label: key.toUpperCase(), title: `${key} title` })),
  rows: domains.map((domain) => ({ domain, stats: { ...stats } })),
});

async function dump() {
  const all = await local().get(null);
  const records: Record<string, DomainRecord> = {};
  for (const [k, v] of Object.entries(all)) if (k.startsWith('d:')) records[k.slice(2)] = v as DomainRecord;
  return { records, meta: all.meta as Meta, settings: all.settings as Settings, all };
}

let now = 1_000_000;
const clock = () => now;

beforeEach(() => {
  fakeBrowser.reset();
  now = 1_000_000;
});

describe('ensureReady (Ф11, A6)', () => {
  it('empty storage → empty meta with rev 0 and default settings; the first add grows rev', async () => {
    const store = createStore(local(), clock);
    await store.ensureReady();
    let s = await dump();
    expect(s.meta).toEqual(emptyMeta(0));
    expect(s.settings).toEqual(defaultSettings());
    await store.add(capture(A, ['a.com', 'b.com']));
    s = await dump();
    expect(s.meta).toMatchObject({ domainCount: 2, rev: 1, sources: { [A]: 'Deleted .com Domains' } });
    expect(s.meta.pending).toBeUndefined();
  });

  it('normal start reads only meta and settings (fast path)', async () => {
    await createStore(local(), clock).add(capture(A, ['a.com']));
    const io = instrumented();
    await createStore(io.area, clock).ensureReady();
    expect(io.calls.get.length).toBeGreaterThan(0);
    expect(
      io.calls.get.every((k) => Array.isArray(k) && k.every((x) => ['meta', 'settings', 'eds:v1'].includes(x))),
    ).toBe(true);
    expect(io.calls.set).toEqual([]);
  });

  it('removes the draft key eds:v1', async () => {
    await local().set({ 'eds:v1': { items: [] } });
    await createStore(local(), clock).ensureReady();
    expect((await dump()).all['eds:v1']).toBeUndefined();
  });

  it('pending meta → exact rebuild from d:* (extra labels dropped, order kept, fallbacks, count)', async () => {
    const rec = (lists: string[], stats: Record<string, string>): DomainRecord => ({
      firstSeen: 1,
      lastSeen: 2,
      lists,
      lastSource: lists[lists.length - 1],
      stats,
    });
    await local().set({
      [recordKey('a.com')]: rec([A], { bl: '1', zz: 'x' }),
      [recordKey('b.com')]: rec([A, B], { dp: '2' }),
      meta: {
        schema: 2,
        sources: { [A]: 'Deleted', 'gone/': 'Gone' },
        columns: { dp: { label: 'DP', title: 't' }, bl: { label: 'BL', title: '' }, old: { label: 'Old', title: '' } },
        columnOrder: ['old', 'dp', 'bl'],
        domainCount: 7,
        rev: 5,
        pending: true,
      },
      settings: defaultSettings(),
    });
    await createStore(local(), clock).ensureReady();
    expect((await dump()).meta).toEqual({
      schema: 2,
      sources: { [A]: 'Deleted', [B]: B },
      columns: { bl: { label: 'BL', title: '' }, dp: { label: 'DP', title: 't' }, zz: { label: 'zz', title: '' } },
      columnOrder: ['dp', 'bl', 'zz'],
      domainCount: 2,
      rev: 6,
    });
  });

  it('no meta but records → rebuild', async () => {
    await local().set({ [recordKey('a.com')]: { firstSeen: 1, lastSeen: 1, lists: [A], lastSource: A, stats: {} } });
    await createStore(local(), clock).ensureReady();
    const s = await dump();
    expect(s.meta).toMatchObject({ domainCount: 1, rev: 1, sources: { [A]: A } });
    expect(s.settings).toEqual(defaultSettings());
  });
});

describe('queue (Ф10, A6)', () => {
  it('two overlapping adds merge correctly', async () => {
    const store = createStore(local(), clock);
    const [r1, r2] = await Promise.all([
      store.add(capture(A, ['a.com', 'b.com'])),
      store.add(capture(B, ['b.com', 'c.com'], { dp: '5' })),
    ]);
    expect(r1).toEqual({ added: 2, updated: 0, total: 2 });
    expect(r2).toEqual({ added: 1, updated: 1, total: 3 });
    const s = await dump();
    expect(s.records['b.com']).toMatchObject({ lists: [A, B], lastSource: B, stats: { dp: '5' } });
    expect(s.meta.columnOrder).toEqual(['bl', 'dp']);
  });

  it('add sent after clear is applied after it', async () => {
    const store = createStore(local(), clock);
    await store.add(capture(A, ['a.com', 'b.com']));
    const cleared = store.clear();
    const added = store.add(capture(A, ['c.com']));
    await Promise.all([cleared, added]);
    const s = await dump();
    expect(Object.keys(s.records)).toEqual(['c.com']);
    expect(s.meta.domainCount).toBe(1);
  });

  it('a rejected write reaches the sender as an error; a retry finishes without duplicates (A6, A14)', async () => {
    const io = instrumented();
    const store = createStore(io.area, clock);
    await store.add(capture(A, ['a.com']));
    io.failSetWhen((items) => Object.keys(items).some((k) => k.startsWith('d:')));
    const res = await handleRequest(store, { type: 'eds:add', capture: capture(A, ['a.com', 'b.com']) });
    expect(res).toEqual({ ok: false, error: 'quota' });
    expect((await dump()).meta.pending).toBe(true);
    io.failSetWhen(null);
    now += 1000;
    const retry = await handleRequest(store, { type: 'eds:add', capture: capture(A, ['a.com', 'b.com']) });
    expect(retry).toMatchObject({ ok: true, result: { added: 1, updated: 1, total: 2 } });
    const s = await dump();
    expect(s.meta.pending).toBeUndefined();
    expect(s.meta.domainCount).toBe(2);
    expect(s.records['a.com']).toMatchObject({ firstSeen: 1_000_000, lastSeen: 1_001_000 });
  });

  it('worker stopped after step 2 → restart rebuilds meta, data not lost', async () => {
    const io = instrumented();
    const store = createStore(io.area, clock);
    await store.add(capture(A, ['a.com']));
    io.failSetWhen((items) => 'meta' in items && !(items.meta as Meta).pending); // step 3 fails
    await expect(store.add(capture(B, ['b.com'], { dp: '1' }))).rejects.toThrow();
    await createStore(local(), clock).ensureReady();
    const s = await dump();
    expect(s.meta).toMatchObject({ domainCount: 2, sources: { [A]: 'Deleted .com Domains', [B]: B } });
    expect(s.meta.columns.dp).toEqual({ label: 'dp', title: '' });
    expect(s.meta.pending).toBeUndefined();
  });

  it('interrupted clear → meta matches the remainder after restart', async () => {
    const store = createStore(local(), clock);
    await store.add(capture(A, ['a.com', 'b.com', 'c.com']));
    const io = instrumented();
    io.failRemove(true);
    await expect(createStore(io.area, clock).clear()).rejects.toThrow();
    await local().remove([recordKey('a.com')]); // the part of the remove that happened
    await createStore(local(), clock).ensureReady();
    expect((await dump()).meta).toMatchObject({ domainCount: 2 });
  });

  it('clear keeps settings, replaces meta with an empty one and a higher rev (Ф15)', async () => {
    const store = createStore(local(), clock);
    await store.add(capture(A, ['a.com']));
    await store.setSettings({ autoCapture: true });
    const before = (await dump()).meta.rev;
    await store.clear();
    const s = await dump();
    expect(s.records).toEqual({});
    expect(s.meta).toEqual(emptyMeta(before + 1));
    expect(s.settings.autoCapture).toBe(true);
  });

  it('a new worker with an immediate add runs it after ensureReady', async () => {
    await local().set({ [recordKey('a.com')]: { firstSeen: 1, lastSeen: 1, lists: [A], lastSource: A, stats: {} } });
    const r = await createStore(local(), clock).add(capture(A, ['b.com']));
    expect(r.total).toBe(2);
    expect((await dump()).meta.domainCount).toBe(2);
  });

  it('invalid capture and invalid settings are refused without writes', async () => {
    const store = createStore(local(), clock);
    await store.ensureReady();
    const snapshot = JSON.stringify((await dump()).all);
    const bad = capture(A, ['a.com']);
    bad.rows[0].domain = 'A.COM';
    await expect(store.add(bad)).rejects.toThrow(/rows/);
    await expect(store.setSettings({ activePreset: 'nope' })).rejects.toThrow(/settings/);
    expect(JSON.stringify((await dump()).all)).toBe(snapshot);
  });
});

describe('re-capture and user fields (A5, A12)', () => {
  it('same page again: 0 new, lastSeen moves, firstSeen stays; another list adds a sourceId', async () => {
    const store = createStore(local(), clock);
    await store.add(capture(A, ['a.com', 'b.com']));
    now += 5000;
    expect(await store.add(capture(A, ['a.com', 'b.com']))).toEqual({ added: 0, updated: 2, total: 2 });
    expect((await dump()).records['a.com']).toMatchObject({ firstSeen: 1_000_000, lastSeen: 1_005_000, lists: [A] });
    await store.add(capture(B, ['a.com']));
    expect((await dump()).records['a.com'].lists).toEqual([A, B]);
  });

  it('user fields survive a capture from another list; stats are replaced whole', async () => {
    const store = createStore(local(), clock);
    await store.add(capture(A, ['a.com'], { bl: '1', whois: 'available' }));
    await store.update(['a.com'], { status: 'rejected', addTags: ['Client A'], note: 'x' });
    await store.add(capture(B, ['a.com'], { dp: '9' }));
    const r = (await dump()).records['a.com'];
    expect(r).toMatchObject({ status: 'rejected', tags: ['Client A'], note: 'x', stats: { dp: '9' } });
    expect(r.stats.bl).toBeUndefined();
  });
});

describe('update (Ф23, A14)', () => {
  it('select-all beyond 500 rows changes every domain; removing a tag clears it everywhere', async () => {
    const store = createStore(local(), clock);
    const domains = Array.from({ length: 600 }, (_, i) => `d${i}.com`);
    for (let i = 0; i < domains.length; i += 25) await store.add(capture(A, domains.slice(i, i + 25)));
    expect(await store.update(domains, { addTags: ['batch'] })).toEqual({ changed: 600, overflow: 0 });
    expect(await store.update(domains, { addTags: ['batch'] })).toEqual({ changed: 0, overflow: 0 });
    expect(await store.update(domains, { removeTags: ['BATCH'] })).toEqual({ changed: 600, overflow: 0 });
    expect(Object.values((await dump()).records).every((r) => r.tags === undefined)).toBe(true);
  });

  it('new / empty values remove fields; tags cap at 20; unknown domains skipped; meta rev grows', async () => {
    const store = createStore(local(), clock);
    await store.add(capture(A, ['a.com']));
    const rev = (await dump()).meta.rev;
    const many = Array.from({ length: 22 }, (_, i) => `t${i}`);
    expect(await store.update(['a.com', 'zz.com'], { status: 'shortlist', note: 'n', addTags: many })).toEqual({
      changed: 1,
      overflow: 1,
    });
    let r = (await dump()).records['a.com'];
    expect(r.tags).toHaveLength(20);
    await store.update(['a.com'], { status: 'new', note: '', removeTags: many });
    r = (await dump()).records['a.com'];
    expect([r.status, r.note, r.tags]).toEqual([undefined, undefined, undefined]);
    expect((await dump()).meta.rev).toBe(rev + 2);
    expect((await dump()).records['zz.com']).toBeUndefined();
  });

  it('invalid patch is refused; a failed write errors and a retry completes', async () => {
    const io = instrumented();
    const store = createStore(io.area, clock);
    await store.add(capture(A, ['a.com', 'b.com']));
    await expect(store.update(['a.com'], { status: 'maybe' })).rejects.toThrow(/patch/);
    await expect(store.update(['a.com'], { note: 'x'.repeat(1001) })).rejects.toThrow(/patch/);
    io.failSetWhen(() => true);
    expect(
      await handleRequest(store, { type: 'eds:update', domains: ['a.com', 'b.com'], patch: { status: 'bought' } }),
    ).toEqual({ ok: false, error: 'quota' });
    io.failSetWhen(null);
    expect(await store.update(['a.com', 'b.com'], { status: 'bought' })).toEqual({ changed: 2, overflow: 0 });
  });
});

describe('delete and clear one list (Ф15а)', () => {
  it('delete removes the chosen records with their user fields; meta drops labels nobody uses', async () => {
    const store = createStore(local(), clock);
    await store.add(capture(A, ['a.com', 'b.com'], { bl: '1' }));
    await store.add(capture(B, ['w.com'], { dp: '2' }));
    await store.update(['a.com'], { status: 'shortlist', addTags: ['x'] });
    const rev = (await dump()).meta.rev;
    expect(await store.delete(['a.com', 'w.com', 'missing.com'])).toEqual({ deleted: 2, kept: 0 });
    const s = await dump();
    expect(Object.keys(s.records)).toEqual(['b.com']);
    expect(s.meta).toMatchObject({ domainCount: 1, sources: { [A]: 'Deleted .com Domains' }, rev: rev + 1 });
    expect(s.meta.sources[B]).toBeUndefined();
    expect(Object.keys(s.meta.columns)).toEqual(['bl']);
    expect(s.meta.pending).toBeUndefined();
    await expect(store.delete('a.com' as unknown as string[])).rejects.toThrow(/domains/);
  });

  it('clearing a list deletes domains seen only there and keeps the others without it', async () => {
    const store = createStore(local(), clock);
    await store.add(capture(A, ['only-a.com', 'both.com', 'both2.com']));
    await store.add(capture(B, ['both.com', 'only-b.com']));
    now += 1;
    await store.add(capture(A, ['both2.com'])); // last captured from A, also in B below
    await store.add(capture(B, ['both2.com']));
    await store.add(capture(A, ['both2.com']));
    await store.update(['both.com'], { note: 'keep me' });
    expect(await store.clearList(A)).toEqual({ deleted: 1, kept: 2 });
    const s = await dump();
    expect(Object.keys(s.records).sort()).toEqual(['both.com', 'both2.com', 'only-b.com']);
    expect(s.records['both.com']).toMatchObject({ lists: [B], lastSource: B, note: 'keep me' });
    // The snapshot came from A: it stays, and the remaining list becomes its source (lastSource ∈ lists).
    expect(s.records['both2.com']).toMatchObject({ lists: [B], lastSource: B, stats: { bl: '1' } });
    expect(s.meta.sources[A]).toBeUndefined();
    expect(s.meta.domainCount).toBe(3);
    expect(await store.clearList('nope')).toEqual({ deleted: 0, kept: 0 });
  });

  it('an interrupted delete leaves pending; the restart rebuilds meta from what is left', async () => {
    const store = createStore(local(), clock);
    await store.add(capture(A, ['a.com', 'b.com', 'c.com']));
    const io = instrumented();
    io.failRemove(true);
    expect(await handleRequest(createStore(io.area, clock), { type: 'eds:delete', domains: ['a.com'] })).toEqual({
      ok: false,
      error: 'remove failed',
    });
    expect((await dump()).meta.pending).toBe(true);
    await createStore(local(), clock).ensureReady();
    expect((await dump()).meta).toMatchObject({ domainCount: 3 });
    expect((await dump()).meta.pending).toBeUndefined();
    expect(await createStore(local(), clock).delete(['a.com'])).toEqual({ deleted: 1, kept: 0 });
    expect((await dump()).meta.domainCount).toBe(2);
  });
});

describe('restore (Ф27, A15 storage part)', () => {
  const CLOCK = new Date(Date.UTC(2026, 10, 20));
  async function snapshotState(): Promise<State> {
    const s = await dump();
    return {
      records: s.records,
      sources: s.meta.sources,
      columns: s.meta.columns,
      columnOrder: s.meta.columnOrder,
      settings: s.settings,
    };
  }

  it('backup → clear → replace gives the same state', async () => {
    const store = createStore(local(), clock);
    await store.add(capture(A, ['a.com', 'b.com'], { bl: '1', whois: 'available' }));
    await store.add(capture(B, ['b.com'], { dp: '2' }));
    await store.update(['a.com'], { status: 'shortlist', addTags: ['x'], note: 'n' });
    const before = await snapshotState();
    const text = makeBackup(before, CLOCK);
    await store.clear();
    expect(await store.restore(text, 'replace')).toEqual({ total: 2, tagsOverflow: 0, presetsSkipped: 0 });
    expect(await snapshotState()).toEqual(before);
    expect((await dump()).meta.pending).toBeUndefined();
    expect(makeBackup(await snapshotState(), CLOCK)).toBe(text);
  });

  it('replace removes local domains that are not in the backup', async () => {
    const store = createStore(local(), clock);
    await store.add(capture(A, ['a.com']));
    const text = makeBackup(await snapshotState(), CLOCK);
    await store.add(capture(A, ['b.com']));
    await store.restore(text, 'replace');
    expect(Object.keys((await dump()).records)).toEqual(['a.com']);
    expect((await dump()).meta.domainCount).toBe(1);
  });

  it('merge interrupted after step 2 → restart → labels and order from the backup survive; repeat gives the same result', async () => {
    const store = createStore(local(), clock);
    await store.add(capture(A, ['a.com'], { bl: '1', dp: '1' }));
    const text = makeBackup(await snapshotState(), CLOCK);
    await store.clear();
    const io = instrumented();
    io.failSetWhen((items) => 'meta' in items && !(items.meta as Meta).pending); // step 3 fails
    await expect(createStore(io.area, clock).restore(text, 'merge')).rejects.toThrow();
    await createStore(local(), clock).ensureReady();
    let meta = (await dump()).meta;
    expect(meta.columns).toEqual({ bl: { label: 'BL', title: 'bl title' }, dp: { label: 'DP', title: 'dp title' } });
    expect(meta.columnOrder).toEqual(['bl', 'dp']);
    expect(meta.sources).toEqual({ [A]: 'Deleted .com Domains' });
    const once = await snapshotState();
    await createStore(local(), clock).restore(text, 'merge');
    meta = (await dump()).meta;
    expect(await snapshotState()).toEqual(once);
    expect(meta.pending).toBeUndefined();
  });

  it('replace failing between remove and set leaves pending; a retry reaches the same result', async () => {
    const store = createStore(local(), clock);
    await store.add(capture(A, ['a.com', 'b.com']));
    const backupOfA = makeBackup(
      { ...(await snapshotState()), records: { 'a.com': (await dump()).records['a.com'] } },
      CLOCK,
    );
    await store.add(capture(B, ['c.com'], { dp: '1' }));
    const io = instrumented();
    io.failSetWhen((items) => Object.keys(items).some((k) => k.startsWith('d:')));
    await expect(createStore(io.area, clock).restore(backupOfA, 'replace')).rejects.toThrow();
    expect((await dump()).meta.pending).toBe(true);
    await createStore(local(), clock).restore(backupOfA, 'replace');
    const s = await dump();
    expect(Object.keys(s.records)).toEqual(['a.com']);
    expect(s.meta.pending).toBeUndefined();
    expect(s.meta.domainCount).toBe(1);
  });

  it('an invalid file writes nothing', async () => {
    const store = createStore(local(), clock);
    await store.add(capture(A, ['a.com']));
    const snapshot = JSON.stringify((await dump()).all);
    const res = await handleRequest(store, { type: 'eds:restore', text: '{"format":"other"}', mode: 'replace' });
    expect(res.ok).toBe(false);
    expect(JSON.stringify((await dump()).all)).toBe(snapshot);
  });

  it('an unknown mode is refused before any write (never falls through to replace)', async () => {
    const store = createStore(local(), clock);
    await store.add(capture(A, ['a.com', 'b.com']));
    const text = makeBackup(
      { ...(await snapshotState()), records: { 'a.com': (await dump()).records['a.com'] } },
      CLOCK,
    );
    const snapshot = JSON.stringify((await dump()).all);
    for (const mode of ['merg', undefined, 1]) {
      const res = await handleRequest(store, { type: 'eds:restore', text, mode } as never);
      expect(res).toEqual({ ok: false, error: 'invalid restore mode' });
    }
    expect(JSON.stringify((await dump()).all)).toBe(snapshot);
  });

  it('a partial step-2 set (settings and one record written, then a failure) → pending; a retry reaches the same result', async () => {
    const store = createStore(local(), clock);
    await store.add(capture(A, ['a.com', 'b.com', 'c.com']));
    await store.update(['b.com'], { note: 'local' });
    const s = await snapshotState();
    const text = makeBackup({ ...s, records: { 'a.com': s.records['a.com'], 'c.com': s.records['c.com'] } }, CLOCK);
    const io = instrumented();
    io.partial(2);
    io.failSetWhen((items) => Object.keys(items).some((k) => k.startsWith('d:')));
    await expect(createStore(io.area, clock).restore(text, 'replace')).rejects.toThrow();
    const mid = await dump();
    expect(mid.meta.pending).toBe(true);
    expect(Object.keys(mid.records).sort()).toEqual(['a.com', 'c.com']);
    await createStore(local(), clock).restore(text, 'replace');
    const end = await dump();
    expect(end.meta.pending).toBeUndefined();
    expect(end.meta.domainCount).toBe(2);
    expect(Object.keys(end.records).sort()).toEqual(['a.com', 'c.com']);
  });
});

describe('live refresh of an open list (Ф16, A6)', () => {
  const subscribe = (listener: ChangeListener) => {
    const l = listener as Parameters<typeof fakeBrowser.storage.onChanged.addListener>[0];
    fakeBrowser.storage.onChanged.addListener(l);
    return () => fakeBrowser.storage.onChanged.removeListener(l);
  };
  const settle = () => new Promise((r) => setTimeout(r, 20));

  it('one capture into 10 000 domains → exactly one re-read, never in a pending state', async () => {
    const store = createStore(local(), clock);
    const domains = Array.from({ length: 10_000 }, (_, i) => `x${i}.com`);
    const seed: Record<string, unknown> = {};
    for (const d of domains) seed[recordKey(d)] = { firstSeen: 1, lastSeen: 1, lists: [A], lastSource: A, stats: {} };
    await local().set(seed);
    await store.ensureReady();
    const rev = (await dump()).meta.rev;
    let reads = 0;
    let sawPending = false;
    const stop = watchMeta(
      subscribe,
      async () => {
        reads++;
        const all = await local().get(null);
        if ((all.meta as Meta).pending) sawPending = true;
      },
      rev,
    );
    await store.add(
      capture(
        A,
        Array.from({ length: 25 }, (_, i) => `new${i}.com`),
      ),
    );
    await settle();
    stop();
    expect(reads).toBe(1);
    expect(sawPending).toBe(false);
  });

  it('an update from one UI copy refreshes both open copies; clear leaves an empty list and meta', async () => {
    const store = createStore(local(), clock);
    await store.add(capture(A, ['a.com']));
    const rev = (await dump()).meta.rev;
    const counts = [0, 0];
    const stops = counts.map((_, i) =>
      watchMeta(
        subscribe,
        async () => {
          counts[i]++;
        },
        rev,
      ),
    );
    await store.update(['a.com'], { status: 'shortlist' });
    await settle();
    expect(counts).toEqual([1, 1]);
    await store.clear();
    await settle();
    expect(counts).toEqual([2, 2]);
    const s = await dump();
    expect(s.records).toEqual({});
    expect(s.meta.rev).toBe(rev + 2);
    for (const stop of stops) stop();
  });

  it('changes during a re-read cause exactly one more re-read', async () => {
    let listener: ChangeListener = () => undefined;
    let release: () => void = () => undefined;
    let reads = 0;
    watchMeta(
      (l) => {
        listener = l;
        return () => undefined;
      },
      () => {
        reads++;
        return new Promise<void>((r) => {
          release = r;
        });
      },
      0,
    );
    const change = (rev: number, pending?: true) =>
      listener({ meta: { newValue: { ...emptyMeta(rev), pending } } }, 'local');
    change(1, true);
    expect(reads).toBe(0);
    change(1);
    change(2);
    change(3);
    expect(reads).toBe(1);
    release();
    await settle();
    expect(reads).toBe(2);
    release();
    await settle();
    expect(reads).toBe(2);
  });

  it('a failed re-read is retried without a new change', async () => {
    let listener: ChangeListener = () => undefined;
    const scheduled: (() => void)[] = [];
    let attempts = 0;
    watchMeta(
      (l) => {
        listener = l;
        return () => undefined;
      },
      async () => {
        attempts++;
        if (attempts === 1) throw new Error('get failed');
      },
      4,
      (fn) => scheduled.push(fn),
    );
    listener({ meta: { newValue: emptyMeta(5) } }, 'local');
    await settle();
    expect(attempts).toBe(1);
    expect(scheduled).toHaveLength(1);
    scheduled[0]();
    await settle();
    expect(attempts).toBe(2);
    listener({ meta: { newValue: emptyMeta(5) } }, 'local');
    await settle();
    expect(attempts).toBe(2);
  });
});

describe('badge (Ф12)', () => {
  it.each([
    [0, ''],
    [7, '7'],
    [999, '999'],
    [1000, '1k'],
    [1234, '1.2k'],
    [9999, '9.9k'],
    [10_000, '10k'],
  ])('%d → %j', (n, text) => {
    expect(badgeText(n)).toBe(text);
  });
});
