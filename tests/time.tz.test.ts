// SPEC A13 part 1. Runs in two projects: TZ=UTC and TZ=America/New_York (vitest.config.ts).
import { describe, expect, it } from 'vitest';
import { parseLocalDate, parseRelativeTime, parseSiteNumber, startOfLocalDay } from '@/shared/time';

const zone = process.env.TZ;
const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const fmt = (ms: number | null) => {
  if (ms === null) return null;
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

describe(`time zone guard (${zone})`, () => {
  it('the configured zone is really in effect', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone === 'UTC' ? 'UTC' : zone);
    const jan = new Date(2026, 0, 15).getTimezoneOffset();
    const jul = new Date(2026, 6, 15).getTimezoneOffset();
    if (zone === 'UTC') expect([jan, jul]).toEqual([0, 0]);
    else expect([jan, jul]).toEqual([300, 240]);
  });
});

describe(`parseRelativeTime (${zone})`, () => {
  const capturedAt = local(2026, 11, 19, 15, 0);

  it.each([
    ['32 days', 'past', '2026-10-18 15:00'],
    ['1 day', 'past', '2026-11-18 15:00'],
    ['Yesterday 13:59', 'past', '2026-11-18 13:59'],
    ['Today 08:00', 'past', '2026-11-19 08:00'],
    ['5h 33m', 'future', '2026-11-19 20:33'],
    ['1d 11h 50m', 'future', '2026-11-21 02:50'],
    ['1d 11h 50m', 'past', '2026-11-18 03:10'],
    ['2h 59m', 'past', '2026-11-19 12:01'],
    ['3d', 'future', '2026-11-22 15:00'],
    ['2026-11-21', 'future', '2026-11-21 00:00'],
    ['2026-10-13', 'past', '2026-10-13 00:00'],
  ] as const)('%s (%s) → %s', (text, kind, expected) => {
    expect(fmt(parseRelativeTime(text, kind, capturedAt))).toBe(expected);
  });

  it.each([
    '-',
    '',
    'garbage',
    'Yesterday 25:00',
    '2026-02-30',
    '5 hours',
    '898 USD',
    'd h m',
    '999999999999999999 days',
    '99999999999d',
  ])('%j → unknown', (text) => {
    expect(parseRelativeTime(text, 'past', capturedAt)).toBeNull();
  });

  it('calendar days across the DST end (2026-11-01 in New York)', () => {
    expect(fmt(parseRelativeTime('2 days', 'past', local(2026, 11, 2, 12)))).toBe('2026-10-31 12:00');
    expect(fmt(parseRelativeTime('1 day', 'future', local(2026, 3, 7, 12)))).toBe('2026-03-08 12:00');
    expect(fmt(startOfLocalDay(local(2026, 11, 2, 12), -2))).toBe('2026-10-31 00:00');
    expect(fmt(startOfLocalDay(local(2026, 3, 7, 23, 30), 1))).toBe('2026-03-08 00:00');
  });

  it('parseLocalDate rejects impossible dates', () => {
    expect(parseLocalDate('2026-13-01')).toBeNull();
    expect(fmt(parseLocalDate('2024-02-29'))).toBe('2024-02-29 00:00');
  });
});

describe('parseSiteNumber', () => {
  it.each([
    ['383', 383],
    ['93.2 K', 93200],
    ['6.8 M', 6800000],
    ['848.8 K', 848800],
    ['58,270', 58270],
    ['1.8K', 1800],
  ])('%s → %d', (text, n) => {
    expect(parseSiteNumber(text)).toBe(n);
  });

  it.each(['-', '', 'abc', '898 USD', '1.2.3'])('%j → null', (text) => {
    expect(parseSiteNumber(text)).toBeNull();
  });
});
