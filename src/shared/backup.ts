// Backup and restore (SPEC Ф27): canonical JSON, full validation before any write, merge table.
// Validated dictionaries are null-prototype objects; forbidden keys are rejected outright.

import { isNormalizedDomain } from './domain';
import { compareCodeUnits } from './filter';
import {
  codePointLength,
  isForbiddenKey,
  isValidColumnKey,
  isValidSourceId,
  MAX_COLUMN_LABEL,
  MAX_COLUMN_TITLE,
  MAX_SOURCE_LABEL,
  MAX_STAT_VALUE,
} from './limits';
import { MAX_PRESETS, nextPresetId, settingsError } from './presets';
import { isNormalizedTag, MAX_TAGS, tagKey } from './tags';
import type { ColumnMeta, DomainRecord, FilterPreset, State } from './types';

export const BACKUP_FORMAT = 'expired-domains-backup';
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
export const MAX_NOTE_LENGTH = 1000;

export interface Backup extends State {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
}

const TOP_KEYS = ['format', 'version', 'exportedAt', 'records', 'sources', 'columns', 'columnOrder', 'settings'];
const RECORD_REQUIRED = ['firstSeen', 'lastSeen', 'lists', 'lastSource', 'stats'];
const RECORD_OPTIONAL = new Set(['status', 'tags', 'note']);
const STORED_STATUSES = new Set(['shortlist', 'rejected', 'bought']);

// ---------------------------------------------------------------- canonical JSON

/**
 * Same layout as `JSON.stringify(v, null, 2)`, but object keys are written in code-unit order.
 * A sorted object is not enough: JSON.stringify always lists integer-like keys ("2", "10") first
 * and numerically, and such keys are valid column keys.
 */
function write(v: unknown, indent: string): string | undefined {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  const inner = `${indent}  `;
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    return `[\n${v.map((x) => inner + (write(x, inner) ?? 'null')).join(',\n')}\n${indent}]`;
  }
  const parts: string[] = [];
  for (const k of Object.keys(v).sort(compareCodeUnits)) {
    const s = write((v as Record<string, unknown>)[k], inner);
    if (s !== undefined) parts.push(`${inner}${JSON.stringify(k)}: ${s}`);
  }
  return parts.length ? `{\n${parts.join(',\n')}\n${indent}}` : '{}';
}

/** Keys sorted by code units at every level, 2-space indent, LF, trailing newline, no BOM. */
export function canonicalJson(v: unknown): string {
  return `${write(v, '')}\n`;
}

export function makeBackup(state: State, exportedAt: Date): string {
  const backup: Backup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: exportedAt.toISOString(),
    ...state,
  };
  return canonicalJson(backup);
}

// ---------------------------------------------------------------- validation

export type BackupErrorCode =
  | 'size'
  | 'json'
  | 'shape'
  | 'format'
  | 'version'
  | 'exported_at'
  | 'forbidden_key'
  | 'sources'
  | 'columns'
  | 'column_order'
  | 'record'
  | 'settings';

export interface BackupError {
  code: BackupErrorCode;
  /** Where in the file, e.g. `records["example.com"].lastSource`. */
  path: string;
}

class Invalid extends Error {
  constructor(
    readonly code: BackupErrorCode,
    readonly path: string,
  ) {
    super(`${code} at ${path}`);
  }
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isStringWithin = (v: unknown, max: number, min = 0): v is string =>
  typeof v === 'string' && codePointLength(v) >= min && codePointLength(v) <= max;

/** Own keys of a dictionary; any forbidden key rejects the whole file. */
function dictKeys(v: unknown, code: BackupErrorCode, path: string): string[] {
  if (!isPlainObject(v)) throw new Invalid(code, path);
  const keys = Object.keys(v);
  const bad = keys.find(isForbiddenKey);
  if (bad !== undefined) throw new Invalid('forbidden_key', `${path}[${JSON.stringify(bad)}]`);
  return keys;
}

function checkSources(v: unknown): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  for (const id of dictKeys(v, 'sources', 'sources')) {
    const label = (v as Record<string, unknown>)[id];
    if (!isValidSourceId(id) || !isStringWithin(label, MAX_SOURCE_LABEL)) {
      throw new Invalid('sources', `sources[${JSON.stringify(id)}]`);
    }
    out[id] = label;
  }
  return out;
}

function checkColumns(v: unknown): Record<string, ColumnMeta> {
  const out: Record<string, ColumnMeta> = Object.create(null);
  for (const key of dictKeys(v, 'columns', 'columns')) {
    const col = (v as Record<string, unknown>)[key];
    const ok =
      isValidColumnKey(key) &&
      isPlainObject(col) &&
      Object.keys(col).length === 2 &&
      isStringWithin(col.label, MAX_COLUMN_LABEL) &&
      isStringWithin(col.title, MAX_COLUMN_TITLE);
    if (!ok) throw new Invalid('columns', `columns[${JSON.stringify(key)}]`);
    out[key] = { label: col.label as string, title: col.title as string };
  }
  return out;
}

function checkColumnOrder(v: unknown, columns: Record<string, ColumnMeta>): string[] {
  const keys = Object.keys(columns);
  if (!Array.isArray(v) || v.length !== keys.length) throw new Invalid('column_order', 'columnOrder');
  const seen = new Set<string>();
  for (const [i, k] of v.entries()) {
    if (typeof k !== 'string' || !Object.hasOwn(columns, k) || seen.has(k)) {
      throw new Invalid('column_order', `columnOrder[${i}]`);
    }
    seen.add(k);
  }
  return [...v];
}

function checkRecord(
  domain: string,
  v: unknown,
  sources: Record<string, string>,
  columns: Record<string, ColumnMeta>,
): DomainRecord {
  const at = `records[${JSON.stringify(domain)}]`;
  const fail = (field: string): never => {
    throw new Invalid('record', field ? `${at}.${field}` : at);
  };
  if (!isNormalizedDomain(domain) || !isPlainObject(v)) fail('');
  const r = v as Record<string, unknown>;
  for (const k of Object.keys(r)) if (!RECORD_REQUIRED.includes(k) && !RECORD_OPTIONAL.has(k)) fail(k);
  for (const k of RECORD_REQUIRED) if (!Object.hasOwn(r, k)) fail(k);

  const { firstSeen, lastSeen, lists, lastSource } = r;
  if (!Number.isSafeInteger(firstSeen) || (firstSeen as number) <= 0) fail('firstSeen');
  if (!Number.isSafeInteger(lastSeen) || (lastSeen as number) < (firstSeen as number)) fail('lastSeen');
  if (
    !Array.isArray(lists) ||
    lists.length === 0 ||
    !lists.every((s) => typeof s === 'string' && Object.hasOwn(sources, s)) ||
    new Set(lists).size !== lists.length
  ) {
    fail('lists');
  }
  if (typeof lastSource !== 'string' || !(lists as string[]).includes(lastSource)) fail('lastSource');

  const stats: Record<string, string> = Object.create(null);
  for (const key of dictKeys(r.stats, 'record', `${at}.stats`)) {
    const value = (r.stats as Record<string, unknown>)[key];
    if (!Object.hasOwn(columns, key) || !isStringWithin(value, MAX_STAT_VALUE)) fail(`stats[${JSON.stringify(key)}]`);
    stats[key] = value as string;
  }

  const out: DomainRecord = {
    firstSeen: firstSeen as number,
    lastSeen: lastSeen as number,
    lists: [...(lists as string[])],
    lastSource: lastSource as string,
    stats,
  };
  if (Object.hasOwn(r, 'status')) {
    if (typeof r.status !== 'string' || !STORED_STATUSES.has(r.status)) fail('status');
    out.status = r.status as DomainRecord['status'];
  }
  if (Object.hasOwn(r, 'tags')) {
    const tags = r.tags;
    if (
      !Array.isArray(tags) ||
      tags.length === 0 ||
      tags.length > MAX_TAGS ||
      !tags.every((t) => typeof t === 'string' && isNormalizedTag(t)) ||
      new Set(tags.map(tagKey)).size !== tags.length
    ) {
      fail('tags');
    }
    out.tags = [...(tags as string[])];
  }
  if (Object.hasOwn(r, 'note')) {
    if (!isStringWithin(r.note, MAX_NOTE_LENGTH, 1)) fail('note');
    out.note = r.note as string;
  }
  return out;
}

function isCanonicalIso(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  const d = new Date(v);
  return !Number.isNaN(d.getTime()) && d.toISOString() === v;
}

export type ParseBackupResult = { ok: true; backup: Backup } | { ok: false; error: BackupError };

/** Validate a backup file completely; nothing may be written unless this returns ok (Ф27). */
export function parseBackup(text: string): ParseBackupResult {
  // Ф27 limits the file in bytes (UTF-8), not in UTF-16 code units.
  if (text.length > MAX_BACKUP_BYTES || new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) {
    return { ok: false, error: { code: 'size', path: '' } };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: { code: 'json', path: '' } };
  }
  try {
    if (!isPlainObject(raw)) throw new Invalid('shape', '');
    const keys = Object.keys(raw);
    if (keys.length !== TOP_KEYS.length || !TOP_KEYS.every((k) => Object.hasOwn(raw, k))) {
      throw new Invalid('shape', '');
    }
    if (raw.format !== BACKUP_FORMAT) throw new Invalid('format', 'format');
    if (raw.version !== BACKUP_VERSION) throw new Invalid('version', 'version');
    if (!isCanonicalIso(raw.exportedAt)) throw new Invalid('exported_at', 'exportedAt');

    const sources = checkSources(raw.sources);
    const columns = checkColumns(raw.columns);
    const columnOrder = checkColumnOrder(raw.columnOrder, columns);
    const records: Record<string, DomainRecord> = Object.create(null);
    for (const domain of dictKeys(raw.records, 'record', 'records')) {
      records[domain] = checkRecord(domain, (raw.records as Record<string, unknown>)[domain], sources, columns);
    }
    const badSettings = settingsError(raw.settings);
    if (badSettings !== null) throw new Invalid('settings', badSettings);

    return {
      ok: true,
      backup: {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        exportedAt: raw.exportedAt as string,
        records,
        sources,
        columns,
        columnOrder,
        settings: structuredClone(raw.settings) as State['settings'],
      },
    };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: { code: e.code, path: e.path } };
    throw e;
  }
}

/** The state carried by a validated backup ("Replace all"). */
export function backupState(b: Backup): State {
  const { records, sources, columns, columnOrder, settings } = b;
  return { records, sources, columns, columnOrder, settings };
}

// ---------------------------------------------------------------- merge

export interface MergeResult {
  state: State;
  /** Domains where not every incoming tag fitted into 20. */
  tagsOverflow: number;
  /** Incoming presets not added because the limit of 20 was reached. */
  presetsSkipped: number;
}

function mergeTags(local: string[] = [], incoming: string[] = []): { tags: string[]; overflow: boolean } {
  const tags = [...local];
  const keys = new Set(local.map(tagKey));
  let overflow = false;
  for (const t of incoming) {
    if (keys.has(tagKey(t))) continue;
    if (tags.length >= MAX_TAGS) {
      overflow = true;
      continue;
    }
    tags.push(t);
    keys.add(tagKey(t));
  }
  return { tags, overflow };
}

function mergeRecord(local: DomainRecord, incoming: DomainRecord): { record: DomainRecord; overflow: boolean } {
  const newer = incoming.lastSeen > local.lastSeen ? incoming : local;
  const lists = [...local.lists, ...incoming.lists.filter((l) => !local.lists.includes(l))];
  const record: DomainRecord = {
    firstSeen: Math.min(local.firstSeen, incoming.firstSeen),
    lastSeen: newer.lastSeen,
    lists,
    lastSource: newer.lastSource,
    stats: { ...newer.stats },
  };
  const status = local.status ?? incoming.status;
  if (status) record.status = status;
  const { tags, overflow } = mergeTags(local.tags, incoming.tags);
  if (tags.length) record.tags = tags;
  const note = local.note || incoming.note;
  if (note) record.note = note;
  return { record, overflow };
}

function mergePresets(local: FilterPreset[], incoming: FilterPreset[]): { presets: FilterPreset[]; skipped: number } {
  const presets = local.map((p) => structuredClone(p));
  const names = new Set(local.map((p) => p.name.toLowerCase()));
  let skipped = 0;
  for (const p of incoming) {
    if (names.has(p.name.toLowerCase())) continue; // same name: the local preset stays
    if (presets.length >= MAX_PRESETS) {
      skipped++;
      continue;
    }
    const used = presets.map((x) => x.id);
    const id = used.includes(p.id) ? nextPresetId([...used, ...incoming.map((x) => x.id)]) : p.id;
    presets.push({ ...structuredClone(p), id });
    names.add(p.name.toLowerCase());
  }
  return { presets, skipped };
}

/** "Merge" (default restore mode): the table of Ф27, local side wins ties. */
export function mergeState(local: State, incoming: State): MergeResult {
  const records: Record<string, DomainRecord> = Object.create(null);
  let tagsOverflow = 0;
  for (const [d, r] of Object.entries(local.records)) records[d] = structuredClone(r);
  for (const [d, r] of Object.entries(incoming.records)) {
    if (!Object.hasOwn(records, d)) {
      records[d] = structuredClone(r);
      continue;
    }
    const merged = mergeRecord(records[d], r);
    records[d] = merged.record;
    if (merged.overflow) tagsOverflow++;
  }

  const sources: Record<string, string> = Object.assign(Object.create(null), incoming.sources, local.sources);
  const columns: Record<string, ColumnMeta> = Object.create(null);
  for (const [k, c] of Object.entries(incoming.columns)) columns[k] = { ...c };
  for (const [k, c] of Object.entries(local.columns)) columns[k] = { ...c };
  const columnOrder = [...local.columnOrder, ...incoming.columnOrder.filter((k) => !local.columnOrder.includes(k))];

  const { presets, skipped } = mergePresets(local.settings.filterPresets, incoming.settings.filterPresets);
  return {
    state: {
      records,
      sources,
      columns,
      columnOrder,
      settings: { ...local.settings, filterPresets: presets },
    },
    tagsOverflow,
    presetsSkipped: skipped,
  };
}
