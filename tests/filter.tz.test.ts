// SPEC A13 part 2 (Ф25 truth tables, presets Ф26). Runs in TZ=UTC and TZ=America/New_York.
import { describe, expect, it } from 'vitest';
import { applyFilter, compileRestrictedRegex, filterError } from '@/shared/filter';
import {
  addPreset,
  BUILTIN_PRESETS,
  DEFAULT_PRESET_ID,
  defaultSettings,
  deletePreset,
  MAX_PRESETS,
  presetFilter,
  renamePreset,
  setActivePreset,
  settingsError,
} from '@/shared/presets';
import type { DomainRecord, Filter, Settings } from '@/shared/types';

const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const NOW = local(2026, 11, 19, 15, 0);
const HOUR = 3_600_000;
const SRC = 'member.expireddomains.net/domains/expiredcom/';

const rec = (stats: Record<string, string> = {}, extra: Partial<DomainRecord> = {}): DomainRecord => ({
  firstSeen: NOW - HOUR,
  lastSeen: NOW,
  lists: [SRC],
  lastSource: SRC,
  stats,
  ...extra,
});

/** Run one filter over named records; returns matching names and the no-data count. */
function run(filter: Filter, records: Record<string, DomainRecord>, now = NOW) {
  const sel = applyFilter(Object.entries(records), filter, now);
  return { pass: sel.domains, noData: sel.excludedNoData, textError: sel.textError };
}

describe('restricted regex (Ф25)', () => {
  it.each([
    ['(a+)+', 'group_quantifier'],
    ['(a|aa)+$', 'group_quantifier'],
    ['(foo){2,}', 'group_quantifier'],
    ['(?=a)', 'lookaround'],
    ['(?!a)', 'lookaround'],
    ['(?<=a)b', 'lookaround'],
    ['(?<!a)b', 'lookaround'],
    ['(a)\\1', 'backreference'],
    ['(?<x>a)\\k<x>', 'backreference'],
    ['a*b*c*d*e*f*', 'quantifiers'],
    ['a'.repeat(101), 'length'],
    ['[a-', 'syntax'],
    ['^[a.]*[a-z.]*[a.]*$', 'quantifiers'],
    ['a+b{2,}c{1,3}', 'quantifiers'],
  ])('rejects %s (%s)', (body, error) => {
    expect(compileRestrictedRegex(body)).toEqual({ ok: false, error });
  });

  it.each(['^[a-z]{3,5}$', 'bet|casino', 'a?b?c{2}d*e+', 'a+b{2,}', 'a'.repeat(100), '[(+*?]x', '(?:ab)c', 'a+?b'])(
    'accepts %s',
    (body) => {
      expect(compileRestrictedRegex(body).ok).toBe(true);
    },
  );

  it('works through the text condition with flag i', () => {
    const records = { 'betway.com': rec(), 'casino.net': rec(), 'abc.org': rec(), 'abcdef.com': rec() };
    expect(run({ text: '/bet|casino/' }, records).pass).toEqual(['betway.com', 'casino.net']);
    expect(run({ text: '/^[A-Z]{3,5}\\./' }, records).pass).toEqual(['abc.org']);
    expect(run({ text: 'ABC' }, records).pass).toEqual(['abc.org', 'abcdef.com']);
  });

  it('a rejected regex is reported and not applied', () => {
    const records = { 'a.com': rec(), 'b.com': rec() };
    expect(run({ text: '/(a+)+/' }, records)).toEqual({
      pass: ['a.com', 'b.com'],
      noData: 0,
      textError: 'group_quantifier',
    });
    expect(run({ text: '/abc/i' }, records).textError).toBe('flags');
  });
});

describe('conditions (Ф25 exact semantics)', () => {
  it('statuses: missing status is new', () => {
    const records = {
      'a.com': rec(),
      'b.com': rec({}, { status: 'shortlist' }),
      'c.com': rec({}, { status: 'rejected' }),
    };
    expect(run({ statuses: ['new', 'shortlist'] }, records).pass).toEqual(['a.com', 'b.com']);
  });

  it('tags any/none, case-insensitive', () => {
    const records = { 'a.com': rec({}, { tags: ['Client A'] }), 'b.com': rec({}, { tags: ['other'] }), 'c.com': rec() };
    expect(run({ tagsAny: ['client a'] }, records).pass).toEqual(['a.com']);
    expect(run({ tagsNone: ['CLIENT A'] }, records).pass).toEqual(['b.com', 'c.com']);
  });

  it('lists: any membership', () => {
    const records = { 'a.com': rec({}, { lists: [SRC, 'x/'] }), 'b.com': rec() };
    expect(run({ lists: ['x/'] }, records).pass).toEqual(['a.com']);
  });

  it('availability: whois first, then whois2; other values are no data', () => {
    const records = {
      'a.com': rec({ whois: ' Available ' }),
      'b.com': rec({ whois2: 'available' }),
      'c.com': rec({ whois: 'registered', whois2: 'available' }),
      'd.com': rec({ whois: 'refused' }),
      'e.com': rec(),
    };
    expect(run({ availability: 'available' }, records)).toMatchObject({ pass: ['a.com', 'b.com'], noData: 2 });
    expect(run({ availability: 'registered' }, records)).toMatchObject({ pass: ['c.com'], noData: 2 });
  });

  it('freshHours: lastSeen ≥ now − N h, boundary included', () => {
    const records = {
      'a.com': rec({}, { lastSeen: NOW - 24 * HOUR }),
      'b.com': rec({}, { lastSeen: NOW - 24 * HOUR - 1 }),
    };
    expect(run({ freshHours: 24 }, records).pass).toEqual(['a.com']);
  });

  it('droppedWithinDays: changes relative to lastSeen, else dropped; from the start of day today − N', () => {
    const records = {
      'a.com': rec({ changes: '3 days' }),
      'b.com': rec({ changes: '4 days' }),
      'c.com': rec({ dropped: '2026-11-16' }),
      'd.com': rec({ dropped: '2026-11-15' }),
      'e.com': rec({ changes: '-', dropped: '2026-11-19' }),
      'f.com': rec(),
      'g.com': rec({ changes: 'Yesterday 14:00' }, { lastSeen: NOW - 2 * 24 * HOUR }),
      'h.com': rec({ changes: '999999999999999999 days' }),
    };
    expect(run({ droppedWithinDays: 3 }, records)).toMatchObject({ pass: ['a.com', 'c.com', 'g.com'], noData: 3 });
    expect(run({ droppedWithinDays: 0 }, { 'a.com': rec({ dropped: '2026-11-19' }) }).pass).toEqual(['a.com']);
  });

  it('deletesWithinDays: from the start of today to the end of today + N; past dates fail', () => {
    const records = {
      'a.com': rec({ enddate: '2026-11-19' }),
      'b.com': rec({ enddate: '2026-11-21' }),
      'c.com': rec({ enddate: '2026-11-22' }),
      'd.com': rec({ enddate: '2026-11-18' }),
      'e.com': rec({ enddate: '-' }),
      'f.com': rec(),
    };
    expect(run({ deletesWithinDays: 2 }, records)).toMatchObject({ pass: ['a.com', 'b.com'], noData: 2 });
  });

  it('auctionActive: end after now; no endtime or garbage fails', () => {
    const records = {
      'a.com': rec({ endtime: '5h 33m' }, { lastSeen: NOW - HOUR }),
      'b.com': rec({ endtime: '5h 33m' }, { lastSeen: NOW - 6 * HOUR }),
      'c.com': rec({ endtime: '-' }),
      'd.com': rec({ whois: 'available' }),
    };
    expect(run({ auctionActive: true }, records)).toMatchObject({ pass: ['a.com'], noData: 2 });
  });

  it('number thresholds: ≥ N, K/M and commas, unparsed is no data', () => {
    const records = {
      'a.com': rec({ bl: '93.2 K', domainpop: '58,270', aentries: '0' }),
      'b.com': rec({ bl: '93199', domainpop: '-', aentries: '10' }),
      'c.com': rec({ bl: 'junk' }),
    };
    expect(run({ minBl: 93200 }, records)).toMatchObject({ pass: ['a.com'], noData: 1 });
    expect(run({ minDp: 58270 }, records)).toMatchObject({ pass: ['a.com'], noData: 2 });
    expect(run({ minArchiveEntries: 0 }, records)).toMatchObject({ pass: ['a.com', 'b.com'], noData: 1 });
  });

  it('archiveFirstYearMax: first four digits of abirth ≤ Y', () => {
    const records = {
      'a.com': rec({ abirth: '2010' }),
      'b.com': rec({ abirth: '2011' }),
      'c.com': rec({ abirth: '-' }),
    };
    expect(run({ archiveFirstYearMax: 2010 }, records)).toMatchObject({ pass: ['a.com'], noData: 1 });
  });

  it('name conditions use the first label; zone is everything after the first dot', () => {
    const records = { 'abc.co.uk': rec(), 'ab-1.com': rec(), 'abcdef.com': rec(), 'x9.net': rec() };
    expect(run({ maxNameLength: 4 }, records).pass).toEqual(['ab-1.com', 'abc.co.uk', 'x9.net']);
    expect(run({ zones: ['co.uk', 'net'] }, records).pass).toEqual(['abc.co.uk', 'x9.net']);
    expect(run({ noDigits: true }, records).pass).toEqual(['abc.co.uk', 'abcdef.com']);
    expect(run({ noHyphens: true }, records).pass).toEqual(['abc.co.uk', 'abcdef.com', 'x9.net']);
  });

  it('conditions combine with AND; a real failure is not counted as no data', () => {
    const records = { 'a.com': rec({ bl: '5' }), 'b.com': rec({ bl: '-' }), 'bad-1.com': rec({ bl: '-' }) };
    expect(run({ minBl: 1, noDigits: true }, records)).toMatchObject({ pass: ['a.com'], noData: 1 });
  });

  it('calendar days across the DST end', () => {
    const now = local(2026, 11, 2, 12);
    const records = { 'a.com': rec({ dropped: '2026-10-31' }), 'b.com': rec({ dropped: '2026-10-30' }) };
    expect(run({ droppedWithinDays: 2 }, records, now).pass).toEqual(['a.com']);
  });

  it('output is sorted by code units', () => {
    const records = { 'b.com': rec(), 'B-a.com': rec(), 'a.com': rec(), '0.com': rec() };
    expect(run({}, records).pass).toEqual(['0.com', 'B-a.com', 'a.com', 'b.com']);
  });
});

describe('built-in presets (Ф26)', () => {
  const godaddyLot = rec({ price: '898 USD', bids: '100', changetimer: '1d 11h 50m', endtime: '5h 33m' });
  const deletedDrop = rec({ changes: '32 days', whois: 'available' });
  const records = {
    'lot.org': godaddyLot,
    'drop.com': deletedDrop,
    'old.com': rec({ whois: 'available' }, { lastSeen: NOW - 25 * HOUR }),
  };

  it('a GoDaddy lot is only in "working auctions", a deleted drop only in "working drops"', () => {
    const settings = defaultSettings();
    const drops = presetFilter(settings, 'working-drops') as Filter;
    const auctions = presetFilter(settings, 'working-auctions') as Filter;
    expect(run(drops, records).pass).toEqual(['drop.com']);
    expect(run(auctions, records).pass).toEqual(['lot.org']);
  });

  it('rejected and bought are excluded', () => {
    const drops = presetFilter(defaultSettings(), 'working-drops') as Filter;
    const hidden = {
      'a.com': rec({ whois: 'available' }, { status: 'rejected' }),
      'b.com': rec({ whois: 'available' }, { status: 'bought' }),
    };
    expect(run(drops, hidden).pass).toEqual([]);
  });

  it('built-in filters are valid Filters', () => {
    for (const p of BUILTIN_PRESETS) expect(filterError(p.filter)).toBeNull();
  });
});

describe('own presets (Ф26)', () => {
  const reserved = ['Рабочие — дропы', 'Working — drops'];

  it('create, rename, delete; active preset falls back to the default view', () => {
    let s: Settings = defaultSettings();
    const added = addPreset(s, '  Fresh .com ', { zones: ['com'], freshHours: 48 }, reserved);
    expect(added).toMatchObject({ ok: true, id: 'p1' });
    if (!added.ok) return;
    s = added.settings;
    expect(s.filterPresets).toEqual([{ id: 'p1', name: 'Fresh .com', filter: { zones: ['com'], freshHours: 48 } }]);
    s = (setActivePreset(s, 'p1') as { settings: Settings }).settings;
    expect(s.activePreset).toBe('p1');
    const renamed = renamePreset(s, 'p1', 'Fresh', reserved);
    expect(renamed.ok && renamed.settings.filterPresets[0].name).toBe('Fresh');
    const deleted = deletePreset(s, 'p1');
    expect(deleted.ok && deleted.settings.activePreset).toBe(DEFAULT_PRESET_ID);
    expect(deleted.ok && deleted.settings.filterPresets).toEqual([]);
  });

  it('names: 1–40, unique case-insensitively, not a built-in name', () => {
    const s = (addPreset(defaultSettings(), 'One', {}) as { settings: Settings }).settings;
    expect(addPreset(s, 'ONE', {})).toEqual({ ok: false, error: 'name_taken' });
    expect(addPreset(s, 'рабочие — дропы', {}, reserved)).toEqual({ ok: false, error: 'name_taken' });
    expect(addPreset(s, '   ', {})).toEqual({ ok: false, error: 'name' });
    expect(addPreset(s, 'x'.repeat(41), {})).toEqual({ ok: false, error: 'name' });
    expect(renamePreset(s, 'p1', 'one').ok).toBe(true);
  });

  it('at most 20; invalid filter refused', () => {
    let s = defaultSettings();
    for (let i = 0; i < MAX_PRESETS; i++) s = (addPreset(s, `n${i}`, {}) as { settings: Settings }).settings;
    expect(addPreset(s, 'extra', {})).toEqual({ ok: false, error: 'limit' });
    expect(addPreset(defaultSettings(), 'bad', { zones: [] })).toEqual({ ok: false, error: 'filter' });
  });

  it('built-ins cannot be renamed or deleted', () => {
    expect(renamePreset(defaultSettings(), 'working-drops', 'x')).toEqual({ ok: false, error: 'builtin' });
    expect(deletePreset(defaultSettings(), 'working-auctions')).toEqual({ ok: false, error: 'builtin' });
    expect(deletePreset(defaultSettings(), 'all')).toEqual({ ok: false, error: 'builtin' });
  });

  it('a preset filter is a copy', () => {
    const f = presetFilter(defaultSettings(), 'working-drops') as Filter;
    f.statuses?.push('bought');
    expect(BUILTIN_PRESETS.find((p) => p.id === 'working-drops')?.filter.statuses).toEqual(['new', 'shortlist']);
  });

  it('the default view "all" hides only rejected domains (Ф13) and is the default active preset', () => {
    expect(defaultSettings().activePreset).toBe('all');
    const records = {
      'a.com': rec(),
      'b.com': rec({}, { status: 'shortlist' }),
      'c.com': rec({}, { status: 'bought' }),
      'd.com': rec({}, { status: 'rejected' }),
    };
    expect(run(presetFilter(defaultSettings(), 'all') as Filter, records).pass).toEqual(['a.com', 'b.com', 'c.com']);
  });

  it('own presets cannot take a built-in id', () => {
    const s = { ...defaultSettings(), filterPresets: [{ id: 'all', name: 'Mine', filter: {} }] };
    expect(settingsError(s)).toBe('settings.filterPresets[0].id');
  });
});

describe('stored Filter / Settings validation', () => {
  it.each([
    [{ foo: 1 }, 'foo'],
    [{ zones: [] }, 'zones'],
    [{ zones: ['.com'] }, 'zones'],
    [{ zones: ['COM'] }, 'zones'],
    [{ zones: ['com', 'com'] }, 'zones'],
    [{ tagsAny: ['A', 'a'] }, 'tagsAny'],
    [{ tagsNone: [' a'] }, 'tagsNone'],
    [{ statuses: ['new', 'maybe'] }, 'statuses'],
    [{ freshHours: 0 }, 'freshHours'],
    [{ minBl: 1.5 }, 'minBl'],
    [{ archiveFirstYearMax: 1989 }, 'archiveFirstYearMax'],
    [{ maxNameLength: 64 }, 'maxNameLength'],
    [{ auctionActive: false }, 'auctionActive'],
    [{ text: '' }, 'text'],
    [{ lists: [''] }, 'lists'],
  ])('%j → %s', (filter, field) => {
    expect(filterError(filter)).toBe(field);
  });

  it('accepts a full valid filter', () => {
    const f: Filter = {
      text: '/^[a-z]{3,5}$/',
      statuses: ['new'],
      tagsAny: ['Client A'],
      tagsNone: ['x'],
      lists: [SRC],
      availability: 'available',
      freshHours: 1,
      droppedWithinDays: 0,
      deletesWithinDays: 0,
      auctionActive: true,
      minBl: 0,
      minDp: 0,
      minArchiveEntries: 0,
      archiveFirstYearMax: 2100,
      maxNameLength: 63,
      zones: ['co.uk', 'xn--p1ai'],
      noDigits: true,
      noHyphens: true,
    };
    expect(filterError(f)).toBeNull();
  });

  it('settings: exact keys, reserved ids, unique ids and names, activePreset known', () => {
    const ok = {
      autoCapture: true,
      panelCollapsed: false,
      filterPresets: [{ id: 'p1', name: 'A', filter: {} }],
      activePreset: 'p1',
    };
    expect(settingsError(ok)).toBeNull();
    expect(settingsError(defaultSettings())).toBeNull();
    expect(settingsError({ ...ok, extra: 1 })).toBe('settings');
    expect(settingsError({ ...ok, activePreset: 'p2' })).toBe('settings.activePreset');
    expect(settingsError({ ...ok, filterPresets: [{ id: 'working-x', name: 'A', filter: {} }] })).toBe(
      'settings.filterPresets[0].id',
    );
    expect(
      settingsError({
        ...ok,
        filterPresets: [
          { id: 'p1', name: 'A', filter: {} },
          { id: 'p2', name: 'a', filter: {} },
        ],
      }),
    ).toBe('settings.filterPresets[1].name');
    expect(settingsError({ ...ok, filterPresets: [{ id: 'p1', name: 'A', filter: { x: 1 } }] })).toBe(
      'settings.filterPresets[0].filter.x',
    );
  });
});
