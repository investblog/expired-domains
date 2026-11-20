// Pure record and meta transitions used by the background mutation queue: capture (Ф8),
// user-field patch (Ф23), meta rebuild (Ф11), capture validation (section 6 common limits).

import { MAX_NOTE_LENGTH } from './backup';
import { isNormalizedDomain } from './domain';
import { compareCodeUnits } from './filter';
import {
  codePointLength,
  isValidColumnKey,
  isValidSourceId,
  MAX_COLUMN_LABEL,
  MAX_COLUMN_TITLE,
  MAX_SOURCE_LABEL,
  MAX_STAT_VALUE,
} from './limits';
import type { ParsedColumn, ParsedRow } from './parse';
import { MAX_TAGS, normalizeTag, tagKey } from './tags';
import { type ColumnMeta, type DomainRecord, type Meta, type Patch, STATUSES } from './types';

export const RECORD_PREFIX = 'd:';
export const recordKey = (domain: string): string => RECORD_PREFIX + domain;

export function emptyMeta(rev: number): Meta {
  return { schema: 2, sources: {}, columns: {}, columnOrder: [], domainCount: 0, rev };
}

// ---------------------------------------------------------------- capture

/** One page capture as sent by the content script (Ф5 output plus Д10 context). */
export interface Capture {
  sourceId: string;
  sourceLabel: string;
  columns: ParsedColumn[];
  rows: ParsedRow[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const within = (v: unknown, max: number): v is string => typeof v === 'string' && codePointLength(v) <= max;

/** Section 6: a capture must satisfy the same limits that backup validation enforces. Returns the bad part or null. */
export function captureError(v: unknown): string | null {
  if (!isObject(v)) return 'capture';
  if (typeof v.sourceId !== 'string' || !isValidSourceId(v.sourceId)) return 'sourceId';
  if (!within(v.sourceLabel, MAX_SOURCE_LABEL)) return 'sourceLabel';
  if (!Array.isArray(v.columns) || !Array.isArray(v.rows)) return 'capture';
  const keys = new Set<string>();
  for (const c of v.columns) {
    if (!isObject(c) || typeof c.key !== 'string' || !isValidColumnKey(c.key) || keys.has(c.key)) return 'columns';
    if (!within(c.label, MAX_COLUMN_LABEL) || !within(c.title, MAX_COLUMN_TITLE)) return 'columns';
    keys.add(c.key);
  }
  const domains = new Set<string>();
  for (const r of v.rows) {
    if (!isObject(r) || typeof r.domain !== 'string' || !isNormalizedDomain(r.domain) || domains.has(r.domain)) {
      return 'rows';
    }
    if (!isObject(r.stats)) return 'rows';
    for (const [k, value] of Object.entries(r.stats)) if (!keys.has(k) || !within(value, MAX_STAT_VALUE)) return 'rows';
    domains.add(r.domain);
  }
  return null;
}

/** Ф8: firstSeen kept; lastSeen, lastSource and the whole stats snapshot replaced; user fields untouched. */
export function captureRecord(
  existing: DomainRecord | undefined,
  row: ParsedRow,
  sourceId: string,
  now: number,
): DomainRecord {
  if (!existing)
    return { firstSeen: now, lastSeen: now, lists: [sourceId], lastSource: sourceId, stats: { ...row.stats } };
  return {
    ...existing,
    lastSeen: Math.max(now, existing.firstSeen),
    lists: existing.lists.includes(sourceId) ? [...existing.lists] : [...existing.lists, sourceId],
    lastSource: sourceId,
    stats: { ...row.stats },
  };
}

/** Labels from the page replace stored ones (including rebuild fallbacks); new keys go to the end of the order. */
export function captureMeta(meta: Meta, capture: Capture, addedDomains: number): Meta {
  const columns: Record<string, ColumnMeta> = { ...meta.columns };
  const columnOrder = [...meta.columnOrder];
  for (const c of capture.columns) {
    columns[c.key] = { label: c.label, title: c.title };
    if (!columnOrder.includes(c.key)) columnOrder.push(c.key);
  }
  return {
    schema: 2,
    sources: { ...meta.sources, [capture.sourceId]: capture.sourceLabel },
    columns,
    columnOrder,
    domainCount: meta.domainCount + addedDomains,
    rev: meta.rev + 1,
  };
}

// ---------------------------------------------------------------- patch (Ф23)

/** Normalized patch, or null when it is invalid (unknown status, bad tag, note too long). */
export function normalizePatch(v: unknown): Patch | null {
  if (!isObject(v)) return null;
  for (const k of Object.keys(v)) if (!['status', 'note', 'addTags', 'removeTags'].includes(k)) return null;
  const out: Patch = {};
  if (v.status !== undefined) {
    if (!(STATUSES as readonly unknown[]).includes(v.status)) return null;
    out.status = v.status as Patch['status'];
  }
  if (v.note !== undefined) {
    if (typeof v.note !== 'string' || codePointLength(v.note) > MAX_NOTE_LENGTH) return null;
    out.note = v.note;
  }
  for (const field of ['addTags', 'removeTags'] as const) {
    const raw = v[field];
    if (raw === undefined) continue;
    if (!Array.isArray(raw)) return null;
    const tags: string[] = [];
    for (const t of raw) {
      const tag = typeof t === 'string' ? normalizeTag(t) : null;
      if (tag === null) return null;
      if (!tags.some((x) => tagKey(x) === tagKey(tag))) tags.push(tag);
    }
    out[field] = tags;
  }
  return out;
}

/**
 * Apply a normalized patch. Idempotent. Never stores `status: 'new'`, empty `tags` or an empty
 * `note`, so storage only holds what backup validation accepts.
 */
export function applyPatch(
  rec: DomainRecord,
  patch: Patch,
): { record: DomainRecord; changed: boolean; overflow: boolean } {
  const next: DomainRecord = { ...rec };
  if (patch.status !== undefined) {
    if (patch.status === 'new') delete next.status;
    else next.status = patch.status;
  }
  if (patch.note !== undefined) {
    if (patch.note === '') delete next.note;
    else next.note = patch.note;
  }
  let overflow = false;
  if (patch.addTags || patch.removeTags) {
    const remove = new Set((patch.removeTags ?? []).map(tagKey));
    const tags = (rec.tags ?? []).filter((t) => !remove.has(tagKey(t)));
    for (const t of patch.addTags ?? []) {
      if (tags.some((x) => tagKey(x) === tagKey(t))) continue;
      if (tags.length >= MAX_TAGS) {
        overflow = true;
        continue;
      }
      tags.push(t);
    }
    if (tags.length) next.tags = tags;
    else delete next.tags;
  }
  return { record: next, changed: !sameUserFields(rec, next), overflow };
}

function sameUserFields(a: DomainRecord, b: DomainRecord): boolean {
  return (
    a.status === b.status &&
    a.note === b.note &&
    (a.tags ?? []).length === (b.tags ?? []).length &&
    (a.tags ?? []).every((t, i) => t === b.tags?.[i])
  );
}

// ---------------------------------------------------------------- rebuild (Ф11)

/**
 * Rebuild `meta` from the records alone (after an interrupted mutation or without `meta`):
 * referenced labels kept, unreferenced dropped, missing ones get fallbacks; order kept for
 * referenced keys, missing keys appended in code-unit order; `rev` grows.
 */
export function rebuildMeta(prev: Meta | undefined, records: Iterable<DomainRecord>): Meta {
  const sourceIds = new Set<string>();
  const columnKeys = new Set<string>();
  let count = 0;
  for (const r of records) {
    count++;
    for (const s of r.lists) sourceIds.add(s);
    sourceIds.add(r.lastSource);
    for (const k of Object.keys(r.stats)) columnKeys.add(k);
  }
  const old = prev ?? emptyMeta(0);
  const sources: Record<string, string> = {};
  for (const id of [...sourceIds].sort(compareCodeUnits)) {
    sources[id] = Object.hasOwn(old.sources, id) ? old.sources[id] : id;
  }
  const columns: Record<string, ColumnMeta> = {};
  for (const k of [...columnKeys].sort(compareCodeUnits)) {
    columns[k] = Object.hasOwn(old.columns, k) ? { ...old.columns[k] } : { label: k, title: '' };
  }
  const kept = old.columnOrder.filter((k, i) => columnKeys.has(k) && old.columnOrder.indexOf(k) === i);
  const missing = [...columnKeys].filter((k) => !kept.includes(k)).sort(compareCodeUnits);
  return {
    schema: 2,
    sources,
    columns,
    columnOrder: [...kept, ...missing],
    domainCount: count,
    rev: old.rev + 1,
  };
}
