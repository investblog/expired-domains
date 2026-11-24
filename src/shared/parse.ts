// Listing parser (SPEC Ф5, Ф6, section 5, Е1). A pure function of the document: it reads only
// `#listing`, never `location`, and never mutates the page (I2, I6).

import { toDomain } from './domain';
import { isValidColumnKey, MAX_COLUMN_LABEL, MAX_COLUMN_TITLE, MAX_STAT_VALUE, truncateCodePoints } from './limits';
import type { ColumnMeta } from './types';

export type ParseCode = 'ok' | 'no_listing' | 'no_table' | 'no_domain_column' | 'no_rows' | 'too_many_rejected';

export interface ParsedRow {
  domain: string;
  stats: Record<string, string>;
}

export interface ParsedColumn extends ColumnMeta {
  key: string;
}

export interface Pager {
  page: number;
  pages: number;
}

export interface Diagnostics {
  code: ParseCode;
  /** Rows with `td.field_domain`; service rows are not counted (Д1а). */
  dataRows: number;
  accepted: number;
  rejected: number;
  /** First three reasons, e.g. `invalid: foo..com`. */
  reasons: string[];
  /** Header keys outside the column-key grammar (section 6); their cells are skipped. */
  skippedColumns: string[];
}

export interface ParseResult {
  rows: ParsedRow[];
  columns: ParsedColumn[];
  pager: Pager | null;
  diagnostics: Diagnostics;
}

/** Above this share of rejected data rows the layout is treated as unrecognized (Е2). */
export const MAX_REJECTED_SHARE = 0.2;

/** Columns that are UI controls or the record key, not statistics (Д3). */
const UI_COLUMNS = new Set(['domain', 'watchlist', 'dislikes', 'relatedlinks']);
/** Cell junk removed before reading a value (Д7). */
const JUNK_SELECTOR = '.favicons, .kmenucontent, .smenu';

const CREATION_DATE_RE = /^Whois Creation Date: (\d{4}-\d{2}-\d{2})$/;
const DROPPED_RE = /^Dropped .+ \((\d{4}-\d{2}-\d{2})\)$/;
const PAGEINFO_RE = /Page\s+([\d,]+)\s+of\s+([\d,]+)/;

/** Computed column from the `whois2` tooltip (Д8в). Its label is data, like the site's header text. */
export const DROPPED_COLUMN: ParsedColumn = { key: 'dropped', label: 'Dropped date', title: '' };

const normalizeSpace = (s: string): string => s.replace(/\s+/g, ' ').trim();

function fieldKey(el: Element, prefix: 'head_' | 'field_'): string | null {
  for (const cls of el.classList) if (cls.startsWith(prefix)) return cls.slice(prefix.length);
  return null;
}

/** Д7: text without service links and menus, whitespace normalized. Reads a detached clone. */
function cellText(td: Element): string {
  const copy = td.cloneNode(true) as Element;
  for (const junk of copy.querySelectorAll(JUNK_SELECTOR)) junk.remove();
  return normalizeSpace(copy.textContent ?? '');
}

function firstLinkTitle(td: Element): string | null {
  return td.querySelector('a')?.getAttribute('title') ?? null;
}

/** The domain's own link in `td.field_domain`: the first one that is not a registrar favicon (Д4). */
const domainLink = (cell: Element): Element | undefined =>
  Array.from(cell.querySelectorAll('a')).find((a) => !a.classList.contains('favicons'));

/** Д4/Д5: full name from the link `title`; fallback `/domain/<name>` (absent on public pages). */
function rawDomainName(row: Element, cell: Element): string | null {
  const title = domainLink(cell)?.getAttribute('title');
  if (title?.trim()) return title;
  const href = row.querySelector('a[href^="/domain/"]')?.getAttribute('href');
  if (!href) return null;
  const name = href.slice('/domain/'.length).split(/[/?#]/)[0];
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

function parsePager(listing: Element): Pager | null {
  const text = listing.querySelector('.pageinfo')?.textContent ?? '';
  const m = PAGEINFO_RE.exec(text);
  if (!m) return null;
  const page = Number(m[1].replace(/,/g, ''));
  const pages = Number(m[2].replace(/,/g, ''));
  return Number.isSafeInteger(page) && Number.isSafeInteger(pages) && page >= 1 && pages >= page
    ? { page, pages }
    : null;
}

function empty(code: ParseCode, pager: Pager | null = null): ParseResult {
  return {
    rows: [],
    columns: [],
    pager,
    diagnostics: { code, dataRows: 0, accepted: 0, rejected: 0, reasons: [], skippedColumns: [] },
  };
}

const listingTable = (doc: Document): Element | null => doc.querySelector('#listing table.base1');
const dataRowsOf = (table: Element): Element[] =>
  Array.from(table.querySelectorAll('tr')).filter((tr) => tr.querySelector('td.field_domain'));

export interface DomainRow {
  tr: Element;
  /** The domain link; the page marks are placed after it (SPEC Ф28). */
  link: Element;
  domain: string;
}

/**
 * Data rows with a valid domain, in page order, duplicates kept: the same rows and names
 * `parseListing` reads (Д1а, Д4, Д5), with their elements, for the page marks (SPEC 4.7).
 */
export function domainRows(doc: Document): DomainRow[] {
  const table = listingTable(doc);
  if (!table) return [];
  const out: DomainRow[] = [];
  for (const tr of dataRowsOf(table)) {
    const cell = tr.querySelector('td.field_domain') as Element;
    const link = domainLink(cell);
    const raw = rawDomainName(tr, cell);
    const result = raw === null ? null : toDomain(raw);
    if (link && result?.ok) out.push({ tr, link, domain: result.domain });
  }
  return out;
}

export function parseListing(doc: Document): ParseResult {
  const listing = doc.querySelector('#listing');
  if (!listing) return empty('no_listing');
  const pager = parsePager(listing);
  const table = listingTable(doc);
  if (!table) return empty('no_table', pager);

  // Columns by class key, in header order (Д2).
  const columns: ParsedColumn[] = [];
  const skippedColumns: string[] = [];
  let hasDomainHead = false;
  for (const th of table.querySelectorAll('th')) {
    const key = fieldKey(th, 'head_');
    if (key === null) continue;
    if (key === 'domain') hasDomainHead = true;
    if (UI_COLUMNS.has(key) || columns.some((c) => c.key === key)) continue;
    if (!isValidColumnKey(key)) {
      skippedColumns.push(key);
      continue;
    }
    columns.push({
      key,
      label: truncateCodePoints(normalizeSpace(th.textContent ?? ''), MAX_COLUMN_LABEL),
      title: truncateCodePoints(th.querySelector('[title]')?.getAttribute('title') ?? '', MAX_COLUMN_TITLE),
    });
  }
  if (!hasDomainHead) return { ...empty('no_domain_column', pager), columns };

  const bodyRows = Array.from(table.querySelectorAll('tr')).filter((tr) => tr.querySelector('td'));
  const dataRows = dataRowsOf(table);
  if (dataRows.length === 0) {
    // A body row with data cells (`td.field_*`) but no domain cell is layout drift; a row
    // without any `field_*` cell ("no Domains found", Д1а) is the real empty result.
    const hasFieldCells = bodyRows.some((tr) =>
      Array.from(tr.querySelectorAll('td')).some((td) => fieldKey(td, 'field_')),
    );
    return { ...empty(hasFieldCells ? 'no_domain_column' : 'no_rows', pager), columns };
  }

  const known = new Set(columns.map((c) => c.key));
  const rows: ParsedRow[] = [];
  const seen = new Set<string>();
  const reasons: string[] = [];
  let rejected = 0;
  let anyDropped = false;

  for (const tr of dataRows) {
    const cell = tr.querySelector('td.field_domain') as Element;
    const raw = rawDomainName(tr, cell);
    const result = raw === null ? null : toDomain(raw);
    if (!result?.ok) {
      rejected++;
      if (reasons.length < 3) reasons.push(`${result ? result.reason : 'no_name'}: ${normalizeSpace(raw ?? '')}`);
      continue;
    }
    if (seen.has(result.domain)) continue;
    seen.add(result.domain);

    const stats: Record<string, string> = {};
    for (const td of tr.querySelectorAll('td')) {
      const key = fieldKey(td, 'field_');
      if (key === null || !known.has(key) || Object.hasOwn(stats, key)) continue;
      let value = cellText(td);
      if (key === 'creationdate') {
        const m = CREATION_DATE_RE.exec(firstLinkTitle(td) ?? '');
        if (m) value = m[1];
      } else if (key === 'whois2' && !known.has('dropped')) {
        const m = DROPPED_RE.exec(firstLinkTitle(td) ?? '');
        if (m) {
          stats.dropped = m[1];
          anyDropped = true;
        }
      }
      stats[key] = truncateCodePoints(value, MAX_STAT_VALUE);
    }
    rows.push({ domain: result.domain, stats });
  }

  if (anyDropped && !known.has('dropped')) {
    const at = columns.findIndex((c) => c.key === 'whois2');
    columns.splice(at + 1, 0, { ...DROPPED_COLUMN });
  }

  const tooMany = rejected > dataRows.length * MAX_REJECTED_SHARE;
  return {
    rows,
    columns,
    pager,
    diagnostics: {
      code: tooMany ? 'too_many_rejected' : 'ok',
      dataRows: dataRows.length,
      accepted: rows.length,
      rejected,
      reasons,
      skippedColumns,
    },
  };
}
