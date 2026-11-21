// Row badges (SPEC Ф8): the list kind from the site's page titles; the zone and its flag.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FLAG_CODES } from '@/sidepanel/flag-codes';
import { listKind } from '@/sidepanel/list-kind';
import { zoneCountry, zoneOf } from '@/sidepanel/zone';

describe('listKind', () => {
  it.each([
    ['Deleted .com Domains', 'deleted'],
    ['Deleted .gd Domains', 'deleted'],
    ['Pending Delete Domains', 'pending'],
    ['GoDaddy Auctions With Bids', 'auction'],
    ['Sedo Buy Now Domains', 'sale'],
    ['Watchlist Domains', 'watchlist'],
    ['Keyword Domain Search: shop', 'search'],
    ['Expired Domains', 'expired'],
    ['member.expireddomains.net/domains/unknown/', null], // no label stored: the bare address
    ['Something Else', null],
  ])('%s → %s', (label, kind) => {
    expect(listKind(label)).toBe(kind);
  });
});

describe('zone', () => {
  it('is everything after the first dot', () => {
    expect(zoneOf('28.gd')).toBe('.gd');
    expect(zoneOf('shop.co.uk')).toBe('.co.uk');
    expect(zoneOf('localhost')).toBe('');
  });

  it.each([
    ['.gd', { code: 'gd', flag: true }],
    ['.de', { code: 'de', flag: true }],
    ['.co.uk', { code: 'gb', flag: true }],
    ['.eu', { code: 'eu', flag: true }],
    ['.ac', { code: 'ac', flag: true }],
    ['.xn--p1ai', { code: 'ru', flag: true }], // .рф
    ['.io', { code: 'io', flag: false }], // Google treats it as generic
    ['.ai', { code: 'ai', flag: false }],
    ['.co', { code: 'co', flag: false }],
    ['.su', { code: 'su', flag: false }],
    ['.com', null],
    ['.shop', null],
    ['.berlin', null],
  ])('%s → %o', (zone, country) => {
    expect(zoneCountry(zone)).toEqual(country);
  });

  it('every listed flag has its file, and the flag-icons licence ships with them', () => {
    const files = readdirSync('src/public/flags').filter((f) => f.endsWith('.svg'));
    expect(files.map((f) => f.slice(0, -4)).sort()).toEqual([...FLAG_CODES].sort());
    expect(existsSync('src/public/flags/LICENSE.txt')).toBe(true);
    for (const f of files) {
      const svg = readFileSync(`src/public/flags/${f}`, 'utf8');
      expect(svg).not.toMatch(/<script|\bon\w+=|<image|<foreignObject/i);
      // Only the SVG namespace names (A1: no address outside the extension).
      const urls = new Set(svg.match(/https?:\/\/[^"'\s)]+/g));
      for (const u of urls) expect(u).toMatch(/^http:\/\/www\.w3\.org\/(2000\/svg|1999\/xlink)$/);
    }
  });
});
