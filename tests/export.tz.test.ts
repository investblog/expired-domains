// SPEC Ф17–Ф19 and the CSV part of A7 (round trip, injections). Runs in two zones for Ф19.
import { describe, expect, it } from 'vitest';
import { exportFileName, guardFormula, toCsv, toTxt } from '@/shared/export';
import { applyFilter } from '@/shared/filter';
import type { DomainRecord } from '@/shared/types';

const SRC_A = 'member.expireddomains.net/domains/expiredcom/';
const SRC_B = 'member.expireddomains.net/domains/watchlist/';
const meta = {
  sources: { [SRC_A]: 'Deleted .com Domains', [SRC_B]: 'Watchlist Domains' },
  columns: {
    bl: { label: 'BL', title: '' },
    whois: { label: 'Status', title: '' },
    whois2: { label: 'Status', title: '' },
    length: { label: '', title: '' },
  },
  columnOrder: ['length', 'bl', 'whois2', 'whois'],
};
const T = Date.UTC(2026, 10, 19, 12, 30, 0);
const rec = (stats: Record<string, string>, extra: Partial<DomainRecord> = {}): DomainRecord => ({
  firstSeen: T,
  lastSeen: T + 1000,
  lists: [SRC_A],
  lastSource: SRC_A,
  stats,
  ...extra,
});

/** Minimal RFC 4180 reader for the round-trip check. */
function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
    } else field += ch;
  }
  return rows;
}

describe('toCsv (Ф17)', () => {
  const records: [string, DomainRecord][] = [
    ['b.com', rec({ bl: '383', whois: 'available' }, { status: 'shortlist', tags: ['x', 'Client A'], note: 'n' })],
    ['a.com', rec({ length: '1', whois2: 'Available' }, { lists: [SRC_A, SRC_B], lastSource: SRC_B })],
  ];
  const csv = toCsv(records, meta);
  const rows = readCsv(csv.slice(1));

  it('BOM, CRLF, header order, duplicate labels disambiguated, empty label → key', () => {
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.slice(1).split('\r\n')).toHaveLength(4);
    expect(rows[0]).toEqual([
      'domain',
      'status',
      'tags',
      'note',
      'lists',
      'last_source',
      'first_seen',
      'last_seen',
      'length',
      'BL',
      'Status (whois2)',
      'Status (whois)',
    ]);
  });

  it('rows sorted by domain; codes, labels, ISO UTC dates, empty cells for missing columns', () => {
    expect(rows[1]).toEqual([
      'a.com',
      'new',
      '',
      '',
      'Deleted .com Domains; Watchlist Domains',
      'Watchlist Domains',
      '2026-11-19T12:30:00.000Z',
      '2026-11-19T12:30:01.000Z',
      '1',
      '',
      'Available',
      '',
    ]);
    expect(rows[2].slice(0, 4)).toEqual(['b.com', 'shortlist', 'x; Client A', 'n']);
  });

  it('only columns present in the selection', () => {
    const one = readCsv(toCsv([records[0]], meta).slice(1));
    expect(one[0].slice(8)).toEqual(['BL', 'Status']);
  });

  it('round trip without loss, injection prefix only where needed (A7)', () => {
    // [input, expected after reading the CSV back] — written out by hand, not via guardFormula.
    const tricky: [string, string][] = [
      ['quote " inside', 'quote " inside'],
      ['comma, inside', 'comma, inside'],
      ['line\r\nbreak', 'line\r\nbreak'],
      ['lf\nonly', 'lf\nonly'],
      ['tab\tinside', 'tab\tinside'],
      ['  leading spaces', '  leading spaces'],
      ['=SUM(A1)', "'=SUM(A1)"],
      ['+1', "'+1"],
      ['-1', "'-1"],
      ['@cmd', "'@cmd"],
      [' \t=hidden', "' \t=hidden"],
      ['\u0001+ctrl', "'\u0001+ctrl"],
      ['\u0085=1+1', "'\u0085=1+1"],
      ['​@x', "'​@x"],
      ['-', '-'],
      ['a=b', 'a=b'],
      ['plain', 'plain'],
    ];
    const recs: [string, DomainRecord][] = tricky.map(([v], i) => [
      `d${String(i).padStart(2, '0')}.com`,
      rec({ bl: v }, { note: v, tags: [`t${i}`] }),
    ]);
    const back = readCsv(toCsv(recs, meta).slice(1));
    expect(back[0].slice(8)).toEqual(['BL']);
    expect(back).toHaveLength(tricky.length + 1);
    tricky.forEach(([, expected], i) => {
      expect(back[i + 1][3]).toBe(expected);
      expect(back[i + 1][8]).toBe(expected);
    });
    expect(guardFormula('-')).toBe('-');
  });
});

describe('filter → export (A9, pure part)', () => {
  it('CSV and TXT contain exactly the selection, in its order', () => {
    const records: [string, DomainRecord][] = [
      ['c.com', rec({ whois: 'available' })],
      ['a.com', rec({ whois: 'registered' })],
      ['b.com', rec({ whois: 'available' }, { status: 'rejected' })],
      ['d.com', rec({})],
      ['e.com', rec({ whois: 'available' })],
    ];
    const byDomain = new Map(records);
    const sel = applyFilter(records, { availability: 'available', statuses: ['new'] }, T + 2000);
    expect(sel.domains).toEqual(['c.com', 'e.com']);
    const csvDomains = readCsv(
      toCsv(
        sel.domains.map((d) => [d, byDomain.get(d) as DomainRecord]),
        meta,
      ).slice(1),
    )
      .slice(1)
      .map((r) => r[0]);
    expect(csvDomains).toEqual(sel.domains);
    expect(toTxt(sel.domains)).toBe('c.com\ne.com\n');
  });
});

describe('toTxt (Ф18)', () => {
  it('one domain per line, LF, code-unit order', () => {
    expect(toTxt(['b.com', 'a.com'])).toBe('a.com\nb.com\n');
    expect(toTxt([])).toBe('');
  });
});

describe('exportFileName (Ф19)', () => {
  it('uses the local date', () => {
    const lateEvening = new Date(2026, 10, 19, 23, 59);
    expect(exportFileName('csv', lateEvening)).toBe('expired-domains-2026-11-19.csv');
    expect(exportFileName('txt', lateEvening)).toBe('expired-domains-2026-11-19.txt');
    expect(exportFileName('backup', new Date(2026, 0, 2, 0, 1))).toBe('expired-domains-backup-2026-01-02.json');
  });
});
