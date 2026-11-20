import { describe, expect, it } from 'vitest';
import { isNormalizedDomain, splitDomain, toDomain } from '@/shared/domain';
import { fnv1a32, MAX_SOURCE_ID, truncateCodePoints } from '@/shared/limits';
import { pageSource } from '@/shared/source';

describe('toDomain (Ф7)', () => {
  it('normalizes case, spaces and one trailing dot', () => {
    expect(toDomain('  Clean-HoodsExpress.com. ')).toEqual({ ok: true, domain: 'clean-hoodsexpress.com' });
  });

  it('accepts punycode and multi-label zones', () => {
    expect(toDomain('xn--mnchen-3ya.de')).toEqual({ ok: true, domain: 'xn--mnchen-3ya.de' });
    expect(toDomain('foo.co.uk').ok).toBe(true);
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['münchen.de', 'idn'],
    ['localhost', 'invalid'],
    ['-foo.com', 'invalid'],
    ['foo-.com', 'invalid'],
    ['foo..com', 'invalid'],
    ['foo_bar.com', 'invalid'],
    ['HillCoatsCarolinaHomeImproveme...com', 'invalid'],
    [`${'a'.repeat(64)}.com`, 'invalid'],
    [`${'a.'.repeat(126)}com`, 'invalid'],
  ])('rejects %j as %s', (raw, reason) => {
    expect(toDomain(raw)).toEqual({ ok: false, reason });
  });

  it('accepts 63-char labels and 253-char names', () => {
    expect(toDomain(`${'a'.repeat(63)}.com`).ok).toBe(true);
    const name = `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`;
    expect(name).toHaveLength(253);
    expect(toDomain(name).ok).toBe(true);
  });

  it('isNormalizedDomain', () => {
    expect(isNormalizedDomain('example.com')).toBe(true);
    expect(isNormalizedDomain('Example.COM')).toBe(false);
    expect(isNormalizedDomain('example.com.')).toBe(false);
  });

  it('splitDomain: name is the first label, zone the rest', () => {
    expect(splitDomain('foo.co.uk')).toEqual({ name: 'foo', zone: 'co.uk' });
  });
});

describe('limits', () => {
  it('fnv1a32 known vectors', () => {
    expect(fnv1a32('')).toBe('811c9dc5');
    expect(fnv1a32('a')).toBe('e40c292c');
    expect(fnv1a32('foobar')).toBe('bf9cf968');
  });

  it('truncateCodePoints keeps surrogate pairs whole', () => {
    expect(truncateCodePoints('a😀b', 2)).toBe('a😀');
    expect(truncateCodePoints('abc', 5)).toBe('abc');
  });
});

describe('pageSource (Д10)', () => {
  it('host + path; query dropped; label up to » or |', () => {
    expect(
      pageSource(
        'https://member.expireddomains.net/domains/expiredcom202611/?start=25&savedsearch_id=0#listing',
        'Deleted .com Domains » ExpiredDomains.net',
      ),
    ).toEqual({
      sourceId: 'member.expireddomains.net/domains/expiredcom202611/',
      sourceLabel: 'Deleted .com Domains',
    });
    expect(
      pageSource('https://www.expireddomains.net/deleted-com-domains/', 'Deleted .com Domains | Now Available')
        .sourceLabel,
    ).toBe('Deleted .com Domains');
  });

  it('Watchlist', () => {
    expect(
      pageSource('https://member.expireddomains.net/domains/watchlist/', 'Watchlist Domains » ExpiredDomains.net'),
    ).toEqual({ sourceId: 'member.expireddomains.net/domains/watchlist/', sourceLabel: 'Watchlist Domains' });
  });

  it('search: each q is its own list, canonical encoding', () => {
    expect(
      pageSource(
        'https://member.expireddomains.net/domain-name-search/?q=red%20irect&start=25',
        'Domain Name Search » X',
      ),
    ).toEqual({
      sourceId: 'member.expireddomains.net/domain-name-search/?q=red+irect',
      sourceLabel: 'Domain Name Search: red irect',
    });
    expect(pageSource('https://member.expireddomains.net/domain-name-search/?q=', 'Search').sourceId).toBe(
      'member.expireddomains.net/domain-name-search/',
    );
  });

  it('long q is cut with an FNV suffix; long searches with a common prefix stay apart', () => {
    const qa = `${'x'.repeat(1990)}aaaaaaaaaa`;
    const qb = `${'x'.repeat(1990)}bbbbbbbbbb`;
    const a = pageSource(`https://member.expireddomains.net/domain-name-search/?q=${qa}`, 'S').sourceId;
    const b = pageSource(`https://member.expireddomains.net/domain-name-search/?q=${qb}`, 'S').sourceId;
    expect(a.length).toBeLessThanOrEqual(MAX_SOURCE_ID);
    expect(a.length).toBeGreaterThan(MAX_SOURCE_ID - 3);
    expect(a.endsWith(`~${fnv1a32(qa)}`)).toBe(true);
    expect(a).not.toBe(b);
  });

  it('labels are cut to 200 code points', () => {
    const { sourceLabel } = pageSource('https://member.expireddomains.net/domains/x/', `${'é'.repeat(300)} » X`);
    expect(Array.from(sourceLabel)).toHaveLength(200);
  });
});
