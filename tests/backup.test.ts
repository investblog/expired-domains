// SPEC Ф27 and the storage-free part of A15: canonical JSON, validation, merge table.
import { describe, expect, it } from 'vitest';
import { backupState, canonicalJson, makeBackup, mergeState, parseBackup } from '@/shared/backup';
import { MAX_COLUMN_LABEL, MAX_COLUMN_TITLE, truncateCodePoints } from '@/shared/limits';
import { defaultSettings } from '@/shared/presets';
import { pageSource } from '@/shared/source';
import type { DomainRecord, State } from '@/shared/types';

const SRC = 'member.expireddomains.net/domains/expiredcom/';
const WL = 'member.expireddomains.net/domains/watchlist/';
const CLOCK = new Date(Date.UTC(2026, 10, 20, 10, 0, 0));

const rec = (extra: Partial<DomainRecord> = {}): DomainRecord => ({
  firstSeen: 1000,
  lastSeen: 2000,
  lists: [SRC],
  lastSource: SRC,
  stats: { bl: '383' },
  ...extra,
});

const baseState = (): State => ({
  records: {
    'b.com': rec({ status: 'shortlist', tags: ['Client A'], note: 'check "archive", later\nline 2' }),
    'a.com': rec({ stats: { bl: '1', whois: 'available' } }),
  },
  sources: { [SRC]: 'Deleted .com Domains' },
  columns: { whois: { label: 'Status', title: '' }, bl: { label: 'BL', title: 'Majestic' } },
  columnOrder: ['bl', 'whois'],
  settings: {
    ...defaultSettings(),
    filterPresets: [{ id: 'p1', name: 'Fresh', filter: { zones: ['com'], freshHours: 48 } }],
    activePreset: 'p1',
  },
});

const parsed = (text: string) => {
  const r = parseBackup(text);
  if (!r.ok) throw new Error(`${r.error.code} ${r.error.path}`);
  return backupState(r.backup);
};

describe('canonical JSON (Ф27)', () => {
  it('sorted keys, 2 spaces, LF, trailing newline, no BOM; byte-identical for the same clock', () => {
    const a = makeBackup(baseState(), CLOCK);
    const b = makeBackup(baseState(), CLOCK);
    expect(a).toBe(b);
    expect(a.startsWith('{\n  "columnOrder"')).toBe(true);
    expect(a.endsWith('}\n')).toBe(true);
    expect(a).not.toMatch(/\r|^﻿/);
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 2 } })).toBe(
      '{\n  "a": {\n    "c": 2,\n    "d": [\n      3,\n      {\n        "y": 2,\n        "z": 1\n      }\n    ]\n  },\n  "b": 1\n}\n',
    );
  });

  it('insertion order does not change the bytes', () => {
    const s = baseState();
    const reordered: State = { ...s, records: { 'a.com': s.records['a.com'], 'b.com': s.records['b.com'] } };
    expect(makeBackup(reordered, CLOCK)).toBe(makeBackup(s, CLOCK));
  });

  it('round trip: backup → parse gives the same state; re-export is byte-identical', () => {
    const text = makeBackup(baseState(), CLOCK);
    const state = parsed(text);
    expect(state).toEqual(baseState());
    expect(makeBackup(state, CLOCK)).toBe(text);
  });

  it('round trip at the limits: 2000-char q, long titles and labels (A15)', () => {
    const q1 = `${'a'.repeat(1990)}x1x1x1x1x1`;
    const q2 = `${'a'.repeat(1990)}y2y2y2y2y2`;
    const s1 = pageSource(`https://member.expireddomains.net/domain-name-search/?q=${q1}`, `${'T'.repeat(500)} » X`);
    const s2 = pageSource(`https://member.expireddomains.net/domain-name-search/?q=${q2}`, 'Search » X');
    expect(s1.sourceId).not.toBe(s2.sourceId);
    const state: State = {
      records: {
        'a.com': rec({ lists: [s1.sourceId, s2.sourceId], lastSource: s2.sourceId, stats: { x: 'v'.repeat(1000) } }),
      },
      sources: { [s1.sourceId]: s1.sourceLabel, [s2.sourceId]: s2.sourceLabel },
      columns: {
        x: {
          label: truncateCodePoints('L'.repeat(300), MAX_COLUMN_LABEL),
          title: truncateCodePoints('😀'.repeat(1200), MAX_COLUMN_TITLE),
        },
      },
      columnOrder: ['x'],
      settings: defaultSettings(),
    };
    expect(parsed(makeBackup(state, CLOCK))).toEqual(state);
  });

  it('validated dictionaries have no prototype', () => {
    const r = parseBackup(makeBackup(baseState(), CLOCK));
    expect(r.ok && Object.getPrototypeOf(r.backup.records)).toBeNull();
    expect(r.ok && Object.getPrototypeOf(r.backup.records['a.com'].stats)).toBeNull();
  });
});

describe('validation rejects the whole file (Ф27)', () => {
  const good = () => JSON.parse(makeBackup(baseState(), CLOCK));
  const error = (mutate: (b: Record<string, any>) => void) => {
    const b = good();
    mutate(b);
    const r = parseBackup(JSON.stringify(b));
    return r.ok ? null : r.error;
  };

  it.each([
    ['foreign format', (b: any) => (b.format = 'other'), 'format'],
    ['version 2', (b: any) => (b.version = 2), 'version'],
    ['extra top-level key', (b: any) => (b.extra = 1), 'shape'],
    ['missing key', (b: any) => delete b.settings, 'shape'],
    ['exportedAt without ms', (b: any) => (b.exportedAt = '2026-11-20T10:00:00Z'), 'exported_at'],
    ['exportedAt date only', (b: any) => (b.exportedAt = '2026-11-20'), 'exported_at'],
    ['exportedAt impossible', (b: any) => (b.exportedAt = '2026-02-30T10:00:00.000Z'), 'exported_at'],
    ['record key not normalized', (b: any) => (b.records['Example.COM'] = b.records['a.com']), 'record'],
    ['lastSource outside lists', (b: any) => (b.records['a.com'].lastSource = WL), 'record'],
    ['list without a source label', (b: any) => (b.records['a.com'].lists = [SRC, WL]), 'record'],
    ['duplicate in lists', (b: any) => (b.records['a.com'].lists = [SRC, SRC]), 'record'],
    ['stats key outside columns', (b: any) => (b.records['a.com'].stats.zz = '1'), 'record'],
    ['stats value not a string', (b: any) => (b.records['a.com'].stats.bl = 1), 'record'],
    ['firstSeen > lastSeen', (b: any) => (b.records['a.com'].firstSeen = 3000), 'record'],
    ['status new is never stored', (b: any) => (b.records['a.com'].status = 'new'), 'record'],
    ['empty tags', (b: any) => (b.records['a.com'].tags = []), 'record'],
    ['duplicate tags', (b: any) => (b.records['a.com'].tags = ['A', 'a']), 'record'],
    ['tag with a comma', (b: any) => (b.records['a.com'].tags = ['ACME, Inc']), 'record'],
    ['tag with a semicolon', (b: any) => (b.records['a.com'].tags = ['a;b']), 'record'],
    ['21 tags', (b: any) => (b.records['a.com'].tags = Array.from({ length: 21 }, (_, i) => `t${i}`)), 'record'],
    ['empty note', (b: any) => (b.records['a.com'].note = ''), 'record'],
    ['unknown record field', (b: any) => (b.records['a.com'].extra = 1), 'record'],
    ['column missing from columnOrder', (b: any) => (b.columns.dp = { label: 'DP', title: '' }), 'column_order'],
    ['columnOrder duplicate', (b: any) => (b.columnOrder = ['bl', 'bl']), 'column_order'],
    ['column with an extra field', (b: any) => (b.columns.bl.extra = ''), 'columns'],
    [
      'column key outside the grammar',
      (b: any) => {
        b.columns['B L'] = { label: '', title: '' };
        b.columnOrder.push('B L');
      },
      'columns',
    ],
    ['source label too long', (b: any) => (b.sources[SRC] = 'x'.repeat(201)), 'sources'],
    ['unknown filter field', (b: any) => (b.settings.filterPresets[0].filter.foo = 1), 'settings'],
    ['empty array in a filter', (b: any) => (b.settings.filterPresets[0].filter.zones = []), 'settings'],
    ['activePreset unknown', (b: any) => (b.settings.activePreset = 'p9'), 'settings'],
  ])('%s', (_name, mutate, code) => {
    expect(error(mutate)?.code).toBe(code);
  });

  it('__proto__ keys in any dictionary', () => {
    const text = makeBackup(baseState(), CLOCK);
    const inRecords = text.replace('"records": {', '"records": {\n    "__proto__": {},');
    const inStats = text.replace('"stats": {', '"stats": {\n        "__proto__": "x",');
    const inSources = text.replace('"sources": {', '"sources": {\n    "constructor": "x",');
    for (const t of [inRecords, inStats, inSources]) {
      const r = parseBackup(t);
      expect(r.ok ? null : r.error.code).toBe('forbidden_key');
    }
  });

  it('broken JSON and BOM', () => {
    expect(parseBackup('{').ok).toBe(false);
    expect(parseBackup(`﻿${makeBackup(baseState(), CLOCK)}`).ok).toBe(false);
    expect(parseBackup('[]')).toEqual({ ok: false, error: { code: 'shape', path: '' } });
  });

  it('the 50 MB limit is in UTF-8 bytes, not string length', () => {
    // 18M code units of a 3-byte character: under 50M in length, 54M in bytes.
    const text = `{"x":"${'界'.repeat(18_000_000)}"}`;
    expect(text.length).toBeLessThan(50 * 1024 * 1024);
    expect(parseBackup(text)).toEqual({ ok: false, error: { code: 'size', path: '' } });
  });

  it('numeric-looking column keys keep code-unit order', () => {
    expect(canonicalJson({ '2': 'b', '10': 'a', a: 1 })).toBe('{\n  "10": "a",\n  "2": "b",\n  "a": 1\n}\n');
    expect(canonicalJson({ a: [], b: {}, c: [{}] })).toBe('{\n  "a": [],\n  "b": {},\n  "c": [\n    {}\n  ]\n}\n');
    const s = baseState();
    s.columns = { '10': { label: 'X', title: '' }, '2': { label: 'Y', title: '' } };
    s.columnOrder = ['2', '10'];
    s.records = { 'a.com': rec({ stats: { '2': 'y', '10': 'x' } }) };
    const text = makeBackup(s, CLOCK);
    expect(text.indexOf('"10": {')).toBeLessThan(text.indexOf('"2": {'));
    expect(parsed(text)).toEqual(s);
  });

  it('the error path points at the field', () => {
    expect(error((b) => (b.records['a.com'].lastSource = WL))?.path).toBe('records["a.com"].lastSource');
  });
});

describe('merge table (Ф27)', () => {
  const sources = { [SRC]: 'Deleted', [WL]: 'Watchlist' };
  const columns = { bl: { label: 'BL', title: '' }, dp: { label: 'DP', title: '' }, le: { label: 'LE', title: '' } };
  const state = (records: Record<string, DomainRecord>, extra: Partial<State> = {}): State => ({
    records,
    sources,
    columns,
    columnOrder: ['bl', 'dp', 'le'],
    settings: defaultSettings(),
    ...extra,
  });

  it('domain on one side is taken as is', () => {
    const { state: s } = mergeState(state({ 'a.com': rec() }), state({ 'b.com': rec({ note: 'x' }) }));
    expect(Object.keys(s.records).sort()).toEqual(['a.com', 'b.com']);
    expect(s.records['b.com'].note).toBe('x');
  });

  it('firstSeen min; lastSeen/lastSource/stats from the newer; equal lastSeen keeps local', () => {
    const local = rec({ firstSeen: 500, lastSeen: 2000, stats: { bl: 'local' } });
    const newer = rec({ firstSeen: 100, lastSeen: 3000, lists: [WL], lastSource: WL, stats: { dp: 'incoming' } });
    const m = mergeState(state({ 'a.com': local }), state({ 'a.com': newer })).state.records['a.com'];
    expect(m).toEqual({ firstSeen: 100, lastSeen: 3000, lists: [SRC, WL], lastSource: WL, stats: { dp: 'incoming' } });
    const tie = rec({ lastSeen: 2000, lists: [WL], lastSource: WL, stats: { dp: 'incoming' } });
    const t = mergeState(state({ 'a.com': local }), state({ 'a.com': tie })).state.records['a.com'];
    expect(t).toMatchObject({ lastSeen: 2000, lastSource: SRC, stats: { bl: 'local' }, lists: [SRC, WL] });
  });

  it('status: local unless new; note: local unless empty', () => {
    const m = mergeState(
      state({ 'a.com': rec({ status: 'rejected' }), 'b.com': rec(), 'c.com': rec({ note: 'mine' }) }),
      state({
        'a.com': rec({ status: 'bought' }),
        'b.com': rec({ status: 'shortlist', note: 'theirs' }),
        'c.com': rec({ note: 'theirs' }),
      }),
    ).state.records;
    expect(m['a.com'].status).toBe('rejected');
    expect(m['b.com']).toMatchObject({ status: 'shortlist', note: 'theirs' });
    expect(m['c.com'].note).toBe('mine');
  });

  it('tags: case-insensitive union, local first, capped at 20 with an overflow count', () => {
    const local = Array.from({ length: 19 }, (_, i) => `l${i}`);
    const r = mergeState(
      state({ 'a.com': rec({ tags: local }), 'b.com': rec({ tags: ['Client'] }) }),
      state({ 'a.com': rec({ tags: ['L0', 'x', 'y'] }), 'b.com': rec({ tags: ['client', 'New'] }) }),
    );
    expect(r.state.records['a.com'].tags).toEqual([...local, 'x']);
    expect(r.state.records['b.com'].tags).toEqual(['Client', 'New']);
    expect(r.tagsOverflow).toBe(1);
  });

  it('sources/columns: union, local wins; columnOrder: local then new keys in incoming order', () => {
    const local = state(
      {},
      { sources: { [SRC]: 'Local label' }, columns: { bl: { label: 'BL', title: 'local' } }, columnOrder: ['bl'] },
    );
    const incoming = state(
      {},
      {
        sources: { [SRC]: 'Their label', [WL]: 'Watchlist' },
        columns: {
          le: { label: 'LE', title: '' },
          bl: { label: 'X', title: 'theirs' },
          dp: { label: 'DP', title: '' },
        },
        columnOrder: ['le', 'bl', 'dp'],
      },
    );
    const s = mergeState(local, incoming).state;
    expect({ ...s.sources }).toEqual({ [SRC]: 'Local label', [WL]: 'Watchlist' });
    expect(s.columns.bl).toEqual({ label: 'BL', title: 'local' });
    expect(s.columnOrder).toEqual(['bl', 'le', 'dp']);
  });

  it('settings: local flags and active preset; presets merged by name, id clash renumbered, over 20 skipped', () => {
    const local: State['settings'] = {
      autoCapture: true,
      panelCollapsed: true,
      activePreset: 'p1',
      filterPresets: [
        { id: 'p1', name: 'Same', filter: { minBl: 1 } },
        { id: 'p2', name: 'Other', filter: {} },
      ],
    };
    const incoming: State['settings'] = {
      autoCapture: false,
      panelCollapsed: false,
      activePreset: 'p2',
      filterPresets: [
        { id: 'p7', name: 'same', filter: { minBl: 99 } },
        { id: 'p2', name: 'Clash', filter: { minDp: 5 } },
        { id: 'p3', name: 'Fresh', filter: {} },
      ],
    };
    const r = mergeState(state({}, { settings: local }), state({}, { settings: incoming }));
    expect(r.state.settings).toEqual({
      autoCapture: true,
      panelCollapsed: true,
      activePreset: 'p1',
      filterPresets: [
        { id: 'p1', name: 'Same', filter: { minBl: 1 } },
        { id: 'p2', name: 'Other', filter: {} },
        { id: 'p4', name: 'Clash', filter: { minDp: 5 } },
        { id: 'p3', name: 'Fresh', filter: {} },
      ],
    });
    const full = Array.from({ length: 20 }, (_, i) => ({ id: `p${i + 1}`, name: `n${i}`, filter: {} }));
    const capped = mergeState(
      state({}, { settings: { ...local, filterPresets: full } }),
      state({}, { settings: incoming }),
    );
    expect(capped.state.settings.filterPresets).toHaveLength(20);
    expect(capped.presetsSkipped).toBe(3); // local names are n0…n19, so none of the three matches by name
  });

  it('the merged state is itself a valid backup', () => {
    const r = mergeState(baseState(), { ...baseState(), records: { 'c.com': rec({ lists: [SRC] }) } });
    expect(parseBackup(makeBackup(r.state, CLOCK)).ok).toBe(true);
  });
});
