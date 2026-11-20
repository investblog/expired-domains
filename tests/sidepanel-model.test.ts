import { describe, expect, it } from 'vitest';
import { defaultSettings } from '@/shared/presets';
import { emptyMeta } from '@/shared/records';
import type { DomainRecord } from '@/shared/types';
import { domainsWithTag, listBreakdown, parseTagList, parseZoneList, readData, tagCounts } from '@/sidepanel/model';

const A = 'member.expireddomains.net/domains/expiredcom/';
const B = 'member.expireddomains.net/domains/watchlist/';
const rec = (extra: Partial<DomainRecord> = {}): DomainRecord => ({
  firstSeen: 1,
  lastSeen: 1,
  lists: [A],
  lastSource: A,
  stats: {},
  ...extra,
});

describe('popup model', () => {
  it('readData splits records, meta and settings; defaults when storage is empty', () => {
    const d = readData({ 'd:a.com': rec(), meta: { ...emptyMeta(3), sources: { [A]: 'Deleted' } }, other: 1 });
    expect([...d.records.keys()]).toEqual(['a.com']);
    expect(d.meta.rev).toBe(3);
    expect(d.settings).toEqual(defaultSettings());
    expect(readData({}).meta).toEqual(emptyMeta(0));
  });

  it('list breakdown: labels from meta, missing label → sourceId, biggest first', () => {
    const d = readData({
      'd:a.com': rec({ lists: [A, B] }),
      'd:b.com': rec({ lists: [B] }),
      meta: { ...emptyMeta(1), sources: { [B]: 'Watchlist Domains' } },
    });
    expect(listBreakdown(d)).toEqual([
      { sourceId: B, label: 'Watchlist Domains', count: 2 },
      { sourceId: A, label: A, count: 1 },
    ]);
  });

  it('tag counts are case-insensitive with the first spelling; domainsWithTag finds them', () => {
    const records = new Map([
      ['a.com', rec({ tags: ['Client A', 'x'] })],
      ['b.com', rec({ tags: ['client a'] })],
      ['c.com', rec()],
    ]);
    expect(tagCounts(records.values())).toEqual([
      { tag: 'Client A', count: 2 },
      { tag: 'x', count: 1 },
    ]);
    expect(domainsWithTag(records, 'CLIENT A')).toEqual(['a.com', 'b.com']);
  });

  it('tag and zone inputs', () => {
    expect(parseTagList(' a ,  b  c, A,, ')).toEqual({ tags: ['a', 'b c'], invalid: [] });
    expect(parseTagList(`ok, ${'x'.repeat(41)}`).invalid).toEqual(['x'.repeat(41)]);
    expect(parseZoneList('COM, .co.uk  net,com')).toEqual(['com', 'co.uk', 'net']);
    expect(parseTagList('a;b').invalid).toEqual(['a;b']);
  });
});
