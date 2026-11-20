// CSV / TXT export and file names (SPEC Ф17–Ф19). Headers and values are never localized.

import { compareCodeUnits } from './filter';
import type { ColumnMeta, DomainRecord } from './types';

export interface ExportMeta {
  sources: Record<string, string>;
  columns: Record<string, ColumnMeta>;
  columnOrder: string[];
}

const FIXED_HEADERS = ['domain', 'status', 'tags', 'note', 'lists', 'last_source', 'first_seen', 'last_seen'];
const BOM = '﻿';

/** CSV-injection guard: prefix `'` when the first significant character is `= + - @` (value `-` excepted). */
export function guardFormula(value: string): string {
  if (value === '-') return value;
  // Skipped while looking for the first significant character: whitespace, C0/DEL/C1 controls
  // and invisible format characters (zero-width space/joiners, word joiner, BOM).
  // biome-ignore lint/suspicious/noControlCharactersInRegex: leading control characters are skipped on purpose
  const first = /^[\s\x00-\x1f\x7f-\x9f​-‍⁠﻿]*(.)/u.exec(value)?.[1];
  return first !== undefined && '=+-@'.includes(first) ? `'${value}` : value;
}

/** RFC 4180 quoting for fields with `"`, `,`, CR or LF. */
export function quoteCsv(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const cell = (value: string): string => quoteCsv(guardFormula(value));

const sortedEntries = (records: Iterable<[string, DomainRecord]>): [string, DomainRecord][] =>
  Array.from(records).sort((a, b) => compareCodeUnits(a[0], b[0]));

/** Stats columns present in the selection, in `columnOrder`; unknown keys after them by code units. */
function statColumns(rows: [string, DomainRecord][], columnOrder: string[]): string[] {
  const present = new Set<string>();
  for (const [, r] of rows) for (const key of Object.keys(r.stats)) present.add(key);
  const ordered = columnOrder.filter((k) => present.has(k));
  const rest = [...present].filter((k) => !columnOrder.includes(k)).sort(compareCodeUnits);
  return [...ordered, ...rest];
}

function statHeaders(keys: string[], columns: Record<string, ColumnMeta>): string[] {
  const label = (k: string) => (Object.hasOwn(columns, k) ? columns[k].label : '') || k;
  const counts = new Map<string, number>();
  for (const k of keys) counts.set(label(k), (counts.get(label(k)) ?? 0) + 1);
  return keys.map((k) => ((counts.get(label(k)) ?? 0) > 1 ? `${label(k)} (${k})` : label(k)));
}

export function toCsv(records: Iterable<[string, DomainRecord]>, meta: ExportMeta): string {
  const rows = sortedEntries(records);
  const keys = statColumns(rows, meta.columnOrder);
  const sourceLabel = (id: string) => (Object.hasOwn(meta.sources, id) ? meta.sources[id] : '') || id;
  const lines = [[...FIXED_HEADERS, ...statHeaders(keys, meta.columns)].map(cell).join(',')];
  for (const [domain, r] of rows) {
    const fixed = [
      domain,
      r.status ?? 'new',
      (r.tags ?? []).join('; '),
      r.note ?? '',
      r.lists.map(sourceLabel).join('; '),
      sourceLabel(r.lastSource),
      new Date(r.firstSeen).toISOString(),
      new Date(r.lastSeen).toISOString(),
    ];
    const stats = keys.map((k) => (Object.hasOwn(r.stats, k) ? r.stats[k] : ''));
    lines.push([...fixed, ...stats].map(cell).join(','));
  }
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

export function toTxt(domains: Iterable<string>): string {
  const list = Array.from(domains).sort(compareCodeUnits);
  return list.length ? `${list.join('\n')}\n` : '';
}

const localDate = (at: Date): string => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}`;
};

export function exportFileName(kind: 'csv' | 'txt' | 'backup', at: Date): string {
  return kind === 'backup'
    ? `expired-domains-backup-${localDate(at)}.json`
    : `expired-domains-${localDate(at)}.${kind}`;
}
