// SPEC Н2 regression barrier for pure functions on 10,000 synthetic records with 27 stats
// columns: the limit is twice the release target (the target itself is measured in Chrome).
import { describe, expect, it } from 'vitest';
import { makeBackup, mergeState, parseBackup } from '@/shared/backup';
import { toCsv } from '@/shared/export';
import { applyFilter } from '@/shared/filter';
import { defaultSettings, presetFilter } from '@/shared/presets';
import type { DomainRecord, Filter, State } from '@/shared/types';

const N = 10_000;
const KEYS = Array.from({ length: 27 }, (_, i) => `col${i}`);
const SRC = 'member.expireddomains.net/domains/expiredcom/';
const NOW = Date.UTC(2026, 10, 20, 12);

function synthetic(): State {
  const records: Record<string, DomainRecord> = {};
  for (let i = 0; i < N; i++) {
    const stats: Record<string, string> = {};
    for (const k of KEYS) stats[k] = String((i * 7919 + k.length) % 100000);
    stats.whois = i % 3 ? 'available' : 'registered';
    stats.bl = `${(i % 900) / 10} K`;
    stats.changes = `${i % 40} days`;
    records[`domain-${i.toString(36)}.com`] = {
      firstSeen: NOW - 100 * 3_600_000,
      lastSeen: NOW - (i % 48) * 3_600_000,
      lists: [SRC],
      lastSource: SRC,
      stats,
      ...(i % 10 === 0 ? { status: 'shortlist' as const, tags: ['Client A', 'drop'] } : {}),
    };
  }
  const allKeys = [...KEYS, 'whois', 'bl', 'changes'];
  return {
    records,
    sources: { [SRC]: 'Deleted .com Domains' },
    columns: Object.fromEntries(allKeys.map((k) => [k, { label: k.toUpperCase(), title: '' }])),
    columnOrder: allKeys,
    settings: defaultSettings(),
  };
}

const time = (fn: () => void): number => {
  const t = performance.now();
  fn();
  return performance.now() - t;
};

describe('Н2 barrier at 10k records', () => {
  const state = synthetic();
  const entries = Object.entries(state.records);

  it('filter recount ≤ 200 ms (target 100)', () => {
    const filters: Filter[] = [
      presetFilter(state.settings, 'working-drops') as Filter,
      { text: '/^domain-[a-z]{2,3}\\./', minBl: 10_000, droppedWithinDays: 10, zones: ['com'], noDigits: true },
    ];
    for (const f of filters) {
      applyFilter(entries, f, NOW); // warm-up
      expect(time(() => applyFilter(entries, f, NOW))).toBeLessThan(200);
    }
  });

  it('backup ≤ 2 s (target 1), restore parse + merge ≤ 6 s (target 3)', () => {
    let text = '';
    expect(time(() => (text = makeBackup(state, new Date(NOW))))).toBeLessThan(2000);
    expect(
      time(() => {
        const r = parseBackup(text);
        if (!r.ok) throw new Error(r.error.code);
        mergeState(state, r.backup);
      }),
    ).toBeLessThan(6000);
  });

  it('CSV of the whole set ≤ 2 s', () => {
    expect(time(() => toCsv(entries, state))).toBeLessThan(2000);
  });
});
