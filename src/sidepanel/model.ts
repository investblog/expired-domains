// Pure helpers of the popup / side panel (SPEC Ф13, Ф21, Ф25). No DOM, no browser API.

import { compareCodeUnits } from '@/shared/filter';
import { defaultSettings } from '@/shared/presets';
import { emptyMeta, RECORD_PREFIX } from '@/shared/records';
import { normalizeTag, tagKey } from '@/shared/tags';
import type { DomainRecord, Meta, Settings, State } from '@/shared/types';

export interface Data {
  records: Map<string, DomainRecord>;
  meta: Meta;
  settings: Settings;
}

/** Split one full `storage.local.get(null)` read (section 6 "Popup"). */
export function readData(all: Record<string, unknown>): Data {
  const records = new Map<string, DomainRecord>();
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith(RECORD_PREFIX)) records.set(k.slice(RECORD_PREFIX.length), v as DomainRecord);
  }
  return {
    records,
    meta: (all.meta as Meta | undefined) ?? emptyMeta(0),
    settings: (all.settings as Settings | undefined) ?? defaultSettings(),
  };
}

export function stateOf(data: Data): State {
  return {
    records: Object.fromEntries(data.records),
    sources: data.meta.sources,
    columns: data.meta.columns,
    columnOrder: data.meta.columnOrder,
    settings: data.settings,
  };
}

export interface ListCount {
  sourceId: string;
  label: string;
  count: number;
}

/** Per-list breakdown (Ф13): labels from meta.sources, membership from `lists`; biggest first. */
export function listBreakdown(data: Data): ListCount[] {
  const counts = new Map<string, number>();
  for (const r of data.records.values()) for (const s of r.lists) counts.set(s, (counts.get(s) ?? 0) + 1);
  return [...counts]
    .map(([sourceId, count]) => ({
      sourceId,
      count,
      label: (Object.hasOwn(data.meta.sources, sourceId) ? data.meta.sources[sourceId] : '') || sourceId,
    }))
    .sort((a, b) => b.count - a.count || compareCodeUnits(a.label, b.label));
}

export interface TagCount {
  tag: string;
  count: number;
}

/** Tags with counts, computed from the records (Ф21); a tag with no domains disappears by itself. */
export function tagCounts(records: Iterable<DomainRecord>): TagCount[] {
  const byKey = new Map<string, TagCount>();
  for (const r of records) {
    for (const t of r.tags ?? []) {
      const entry = byKey.get(tagKey(t));
      if (entry) entry.count++;
      else byKey.set(tagKey(t), { tag: t, count: 1 });
    }
  }
  return [...byKey.values()].sort((a, b) => compareCodeUnits(tagKey(a.tag), tagKey(b.tag)));
}

/** Domains carrying a tag (case-insensitive), for "delete tag" (Ф21). */
export function domainsWithTag(records: Map<string, DomainRecord>, tag: string): string[] {
  const key = tagKey(tag);
  return [...records].filter(([, r]) => (r.tags ?? []).some((t) => tagKey(t) === key)).map(([d]) => d);
}

/** Comma-separated tag input → normalized unique tags; invalid ones are reported. */
export function parseTagList(input: string): { tags: string[]; invalid: string[] } {
  const tags: string[] = [];
  const invalid: string[] = [];
  for (const raw of input.split(',')) {
    if (raw.trim() === '') continue;
    const tag = normalizeTag(raw);
    if (tag === null) invalid.push(raw.trim());
    else if (!tags.some((t) => tagKey(t) === tagKey(tag))) tags.push(tag);
  }
  return { tags, invalid };
}

/** Zone input: "com, .co.uk" → ["com", "co.uk"] (lowercase, no leading dot, unique). */
export function parseZoneList(input: string): string[] {
  const zones: string[] = [];
  for (const raw of input.split(/[,\s]+/)) {
    const z = raw.trim().toLowerCase().replace(/^\.+/, '');
    if (z && !zones.includes(z)) zones.push(z);
  }
  return zones;
}
