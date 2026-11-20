// SPEC A3 (real fixtures, section 5) and A4 (derived drift fixtures, built by editing the parsed copy).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseListing } from '@/shared/parse';
import { captureError } from '@/shared/records';
import { pageSource } from '@/shared/source';

const FIXTURES = [
  'deleted-com-p1',
  'deleted-com-p2',
  'keyword-search',
  'pendingdelete',
  'godaddy-auctions',
  'sedo-buynow',
  'watchlist',
  'search-empty',
  'public-deleted-com',
] as const;
type Fixture = (typeof FIXTURES)[number];

const UI = new Set(['domain', 'watchlist', 'dislikes', 'relatedlinks']);

const load = (name: Fixture): Document =>
  new DOMParser().parseFromString(readFileSync(resolve('tests/fixtures', `${name}.html`), 'utf8'), 'text/html');

const fieldKeys = (tr: Element): string[] =>
  Array.from(tr.querySelectorAll('td'))
    .flatMap((td) => Array.from(td.classList))
    .filter((c) => c.startsWith('field_'))
    .map((c) => c.slice('field_'.length));

const dataRows = (doc: Document): Element[] =>
  Array.from(doc.querySelectorAll('#listing table.base1 tr')).filter((tr) => tr.querySelector('td.field_domain'));

describe('parseListing on real fixtures (A3)', () => {
  const expectedCount: Record<Fixture, number> = {
    'deleted-com-p1': 25,
    'deleted-com-p2': 25,
    'keyword-search': 25,
    pendingdelete: 25,
    'godaddy-auctions': 25,
    'sedo-buynow': 25,
    watchlist: 12,
    'search-empty': 0,
    'public-deleted-com': 25,
  };

  for (const name of FIXTURES) {
    describe(name, () => {
      const doc = load(name);
      const before = doc.documentElement.outerHTML;
      const result = parseListing(doc);

      it('does not mutate the page', () => {
        expect(doc.documentElement.outerHTML).toBe(before);
      });

      it(`yields ${expectedCount[name]} domains`, () => {
        expect(result.rows).toHaveLength(expectedCount[name]);
        expect(result.diagnostics.rejected).toBe(0);
        expect(result.diagnostics.code).toBe(name === 'search-empty' ? 'no_rows' : 'ok');
      });

      it('stats keys are the row field_* classes minus UI columns (+ dropped only in keyword-search)', () => {
        const rows = dataRows(doc);
        result.rows.forEach((row, i) => {
          const expected = fieldKeys(rows[i]).filter((k) => !UI.has(k));
          if (name === 'keyword-search') expected.splice(expected.indexOf('whois2') + 1, 0, 'dropped');
          expect(Object.keys(row.stats).sort()).toEqual([...expected].sort());
        });
        const columnKeys = result.columns.map((c) => c.key);
        expect(columnKeys.includes('dropped')).toBe(name === 'keyword-search');
        for (const key of columnKeys) expect(UI.has(key)).toBe(false);
      });

      it('no service-link junk in values (Д7)', () => {
        for (const row of result.rows) {
          for (const value of Object.values(row.stats)) {
            expect(value).not.toMatch(/Majestic\.com|SEOkicks\.de/);
            expect(value).toBe(value.trim());
          }
        }
      });

      it('creationdate is the full tooltip date or the cell text (Д8а)', () => {
        for (const row of result.rows) {
          if ('creationdate' in row.stats) expect(row.stats.creationdate).toMatch(/^(\d{4}-\d{2}-\d{2}|-)$/);
        }
      });

      const clipboard = doc.querySelector('.copyclipboard[data-clipboard-text]');
      if (clipboard) {
        it('matches the site copy button list (Д11)', () => {
          const site = (clipboard.getAttribute('data-clipboard-text') ?? '')
            .split(/\s+/)
            .filter(Boolean)
            .map((s) => s.toLowerCase());
          expect(new Set(result.rows.map((r) => r.domain))).toEqual(new Set(site));
        });
      }
    });
  }

  it('pager (Д9)', () => {
    const pager = (name: Fixture) => parseListing(load(name)).pager;
    expect(pager('deleted-com-p1')).toEqual({ page: 1, pages: 58270 });
    expect(pager('deleted-com-p2')).toEqual({ page: 2, pages: 58270 });
    expect(pager('keyword-search')).toEqual({ page: 1, pages: 1377 });
    expect(pager('sedo-buynow')).toEqual({ page: 1, pages: 128793 });
    expect(pager('watchlist')).toEqual({ page: 1, pages: 1 });
    expect(pager('public-deleted-com')).toBeNull();
  });

  it('first row of deleted-com-p1 has bl 383 and a full creation date occurs', () => {
    const { rows } = parseListing(load('deleted-com-p1'));
    expect(rows[0].stats.bl).toBe('383');
    expect(rows.some((r) => r.stats.creationdate === '2025-08-06')).toBe(true);
  });

  it('creationdate "-" stays "-" in keyword-search and pendingdelete', () => {
    for (const name of ['keyword-search', 'pendingdelete'] as const) {
      expect(parseListing(load(name)).rows.some((r) => r.stats.creationdate === '-')).toBe(true);
    }
  });

  it('truncated link text does not lose the domain (Д4)', () => {
    const domains = parseListing(load('deleted-com-p2')).rows.map((r) => r.domain);
    expect(domains).toContain('hillcoatscarolinahomeimprovements.com');
    const doc = load('pendingdelete');
    const truncated = dataRows(doc).filter((tr) =>
      tr.querySelector('td.field_domain a:not(.favicons)')?.textContent?.includes('...'),
    );
    expect(truncated).toHaveLength(2);
  });

  it('rows without the namelinks class are parsed (Д4)', () => {
    const withoutClass = (name: Fixture) =>
      dataRows(load(name)).filter((tr) => !tr.querySelector('td.field_domain a.namelinks')).length;
    expect(withoutClass('pendingdelete')).toBe(6);
    expect(withoutClass('godaddy-auctions')).toBe(25);
    expect(withoutClass('sedo-buynow')).toBe(25);
    expect(withoutClass('watchlist')).toBe(1);
  });

  it('keyword-search: dropped date from the whois2 tooltip, whois2 untouched (Д8в)', () => {
    const doc = load('keyword-search');
    const { rows, columns } = parseListing(doc);
    const cells = dataRows(doc).map((tr) => tr.querySelector('td.field_whois2')?.textContent?.trim());
    rows.forEach((row, i) => {
      expect(row.stats.dropped).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(row.stats.whois2).toBe(cells[i]);
    });
    const keys = columns.map((c) => c.key);
    expect(keys.indexOf('dropped')).toBe(keys.indexOf('whois2') + 1);
    expect(columns.find((c) => c.key === 'dropped')).toEqual({ key: 'dropped', label: 'Dropped date', title: '' });
  });

  it('list-specific columns', () => {
    const keys = (name: Fixture) => parseListing(load(name)).columns.map((c) => c.key);
    expect(keys('watchlist')).toEqual(expect.arrayContaining(['adddate', 'domainlists']));
    expect(keys('godaddy-auctions')).toEqual(expect.arrayContaining(['price', 'bids', 'endtime']));
    expect(keys('pendingdelete')).toContain('enddate');
    expect(keys('public-deleted-com')).toEqual([
      'bl',
      'domainpop',
      'abirth',
      'aentries',
      'dmoz',
      'statuscom',
      'statusnet',
      'statusorg',
      'statusde',
      'statustld_registered',
      'related_cnobi',
      'changes',
      'whois',
    ]);
  });

  it('public page has no /domain/ links and still yields every row (Д5)', () => {
    const doc = load('public-deleted-com');
    expect(doc.querySelector('a[href^="/domain/"]')).toBeNull();
    expect(parseListing(doc).rows).toHaveLength(25);
  });

  it('column label and title come from the header (Д2)', () => {
    const bl = parseListing(load('deleted-com-p1')).columns.find((c) => c.key === 'bl');
    expect(bl?.label).toBe('BL');
    expect(bl?.title).toMatch(/^Majestic External Backlinks/);
  });

  it('a sentinel outside #listing never reaches the output', () => {
    const doc = load('deleted-com-p1');
    const decoy = doc.createElement('div');
    decoy.innerHTML =
      '<div class="pageinfo">Page 9 of 9</div><table class="base1"><thead><tr><th class="head_domain">Domain</th>' +
      '<th class="head_bl">SENTINEL_ACCOUNT</th></tr></thead><tbody><tr><td class="field_domain">' +
      '<a title="sentinel-account.com">x</a></td><td class="field_bl">SENTINEL_ACCOUNT</td></tr></tbody></table>';
    doc.body.prepend(decoy);
    const out = JSON.stringify(parseListing(doc));
    expect(out).not.toMatch(/SENTINEL_ACCOUNT|sentinel-account/);
    expect(parseListing(doc).pager).toEqual({ page: 1, pages: 58270 });
  });
});

describe('fallback name source /domain/<name> (Д5)', () => {
  const stripTitles = (doc: Document) => {
    for (const a of doc.querySelectorAll('td.field_domain a')) a.removeAttribute('title');
  };

  for (const name of FIXTURES.filter((f) => f !== 'public-deleted-com' && f !== 'search-empty')) {
    it(`${name}: without link titles every row is recovered with the same name`, () => {
      const doc = load(name);
      const byTitle = parseListing(doc).rows.map((r) => r.domain);
      stripTitles(doc);
      const { rows, diagnostics } = parseListing(doc);
      expect(rows.map((r) => r.domain)).toEqual(byTitle);
      expect(diagnostics.rejected).toBe(0);
    });
  }

  it('public page: a row without a title is rejected as no_name', () => {
    const doc = load('public-deleted-com');
    doc.querySelector('td.field_domain a')?.removeAttribute('title');
    const { rows, diagnostics } = parseListing(doc);
    expect(rows).toHaveLength(24);
    expect(diagnostics).toMatchObject({ code: 'ok', rejected: 1, reasons: ['no_name: '] });
  });
});

describe('tooltip fallbacks (A3 derived)', () => {
  it('creationdate falls back to the cell text when the tooltip format differs', () => {
    const doc = load('deleted-com-p1');
    const link = doc.querySelector('td.field_creationdate a[title^="Whois Creation Date"]') as Element;
    const text = link.textContent?.trim();
    link.setAttribute('title', 'Whois Creation Date: unknown');
    const row = link.closest('tr') as Element;
    const domain = row.querySelector('td.field_domain a')?.getAttribute('title')?.toLowerCase();
    const parsed = parseListing(doc).rows.find((r) => r.domain === domain);
    expect(parsed?.stats.creationdate).toBe(text);
  });

  it('whois2 without the Dropped tooltip gives no dropped key', () => {
    const doc = load('keyword-search');
    const link = doc.querySelector('td.field_whois2 a') as Element;
    link.setAttribute('title', 'Register now');
    const domain = link.closest('tr')?.querySelector('td.field_domain a')?.getAttribute('title')?.toLowerCase();
    const parsed = parseListing(doc).rows.find((r) => r.domain === domain);
    expect(parsed).toBeDefined();
    expect(parsed && 'dropped' in parsed.stats).toBe(false);
  });
});

describe('capture output fits the common limits (section 6)', () => {
  for (const name of FIXTURES) {
    it(`${name}: parse + pageSource passes captureError`, () => {
      const doc = load(name);
      const { rows, columns } = parseListing(doc);
      const source = pageSource(`https://member.expireddomains.net/domains/${name}/`, doc.title);
      expect(captureError({ ...source, rows, columns })).toBeNull();
    });
  }
});

describe('drift fixtures derived from deleted-com-p1 (A4)', () => {
  const code = (edit: (doc: Document) => void) => {
    const doc = load('deleted-com-p1');
    edit(doc);
    return parseListing(doc).diagnostics.code;
  };

  it('no #listing → no_listing', () => {
    expect(code((d) => d.querySelector('#listing')?.removeAttribute('id'))).toBe('no_listing');
  });

  it('table.base1 removed or renamed → no_table', () => {
    expect(code((d) => d.querySelector('table.base1')?.remove())).toBe('no_table');
    expect(code((d) => d.querySelector('table.base1')?.classList.replace('base1', 'base2'))).toBe('no_table');
  });

  it('no th.head_domain → no_domain_column', () => {
    expect(code((d) => d.querySelector('th.head_domain')?.classList.remove('head_domain'))).toBe('no_domain_column');
  });

  it('no td.field_domain → no_domain_column', () => {
    expect(
      code((d) => {
        for (const td of d.querySelectorAll('td.field_domain')) td.classList.remove('field_domain');
      }),
    ).toBe('no_domain_column');
  });

  it('empty tbody → no_rows', () => {
    expect(
      code((d) => {
        const tbody = d.querySelector('table.base1 tbody');
        if (tbody) tbody.innerHTML = '';
      }),
    ).toBe('no_rows');
  });

  it('30% garbage domains → too_many_rejected, with reasons', () => {
    const doc = load('deleted-com-p1');
    const links = Array.from(doc.querySelectorAll('td.field_domain a.namelinks'));
    for (const a of links.slice(0, 8)) a.setAttribute('title', 'not a domain');
    const { diagnostics, rows } = parseListing(doc);
    expect(diagnostics.code).toBe('too_many_rejected');
    expect(diagnostics.dataRows).toBe(25);
    expect(diagnostics.rejected).toBe(8);
    expect(rows).toHaveLength(17);
    expect(diagnostics.reasons).toHaveLength(3);
    expect(diagnostics.reasons[0]).toBe('invalid: not a domain');
  });

  it('a Unicode name is rejected and counted (Ф7)', () => {
    const doc = load('deleted-com-p1');
    doc.querySelector('td.field_domain a.namelinks')?.setAttribute('title', 'münchen.de');
    const { diagnostics } = parseListing(doc);
    expect(diagnostics.rejected).toBe(1);
    expect(diagnostics.code).toBe('ok');
    expect(diagnostics.reasons).toEqual(['idn: münchen.de']);
  });

  it('a column key outside the grammar is skipped and reported (section 6)', () => {
    const doc = load('deleted-com-p1');
    doc.querySelector('th.head_bl')?.classList.replace('head_bl', 'head_BL-x');
    for (const td of doc.querySelectorAll('td.field_bl')) td.classList.replace('field_bl', 'field_BL-x');
    const { diagnostics, rows } = parseListing(doc);
    expect(diagnostics.skippedColumns).toEqual(['BL-x']);
    expect('BL-x' in rows[0].stats).toBe(false);
  });
});
