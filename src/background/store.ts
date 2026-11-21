// The single writer (SPEC Ф9–Ф11, Ф15, Ф27). Every mutation runs in one sequential queue,
// reads what it needs from storage.local inside the queue (no state in globals), and ends by
// writing `meta` with `rev + 1`. Multi-key mutations follow the `pending` protocol of Ф11.

import { backupState, mergeState, parseBackup } from '@/shared/backup';
import { defaultSettings, settingsError } from '@/shared/presets';
import {
  applyPatch,
  type Capture,
  captureError,
  captureMeta,
  captureRecord,
  emptyMeta,
  normalizePatch,
  RECORD_PREFIX,
  rebuildMeta,
  recordKey,
} from '@/shared/records';
import type { DomainRecord, Meta, Settings, State } from '@/shared/types';

/** The part of `storage.local` the store uses; injectable for tests. */
export interface StorageArea {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

/** Legacy draft key (section 6): removed at start, never migrated. */
const LEGACY_KEY = 'eds:v1';

export class StoreError extends Error {}

export interface AddResult {
  added: number;
  updated: number;
  total: number;
}
export interface UpdateResult {
  changed: number;
  overflow: number;
}
export interface DeleteResult {
  deleted: number;
  /** clearList only: domains also found in other lists, kept with this list taken off. */
  kept: number;
}
export type RestoreMode = 'merge' | 'replace';
export interface RestoreResult {
  total: number;
  tagsOverflow: number;
  presetsSkipped: number;
}

const isRecordKey = (k: string): boolean => k.startsWith(RECORD_PREFIX);

/** Records of a full read, keyed by domain. */
function recordsOf(all: Record<string, unknown>): Map<string, DomainRecord> {
  const out = new Map<string, DomainRecord>();
  for (const [k, v] of Object.entries(all))
    if (isRecordKey(k)) out.set(k.slice(RECORD_PREFIX.length), v as DomainRecord);
  return out;
}

export function createStore(area: StorageArea, clock: () => number = Date.now) {
  let tail: Promise<unknown> = Promise.resolve();

  /** Run `task` after every earlier one; a failure rejects only its own caller. */
  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(task);
    tail = run.catch(() => undefined);
    return run;
  }

  /**
   * Read `keys` plus `meta` (or everything for null). If an earlier mutation of this worker run
   * failed mid-protocol (`pending`) or `meta` is gone, reconcile first (Ф11) and read again.
   */
  async function read(keys: string[] | null): Promise<{ got: Record<string, unknown>; meta: Meta }> {
    const get = () => area.get(keys === null ? null : ['meta', ...keys]);
    let got = await get();
    const meta = got.meta as Meta | undefined;
    if (meta && meta.pending !== true) return { got, meta };
    await ensureReadyTask();
    got = await get();
    if (!got.meta) throw new StoreError('meta missing');
    return { got, meta: got.meta as Meta };
  }

  async function ensureReadyTask(): Promise<void> {
    const got = await area.get(['meta', 'settings', LEGACY_KEY]);
    if (got[LEGACY_KEY] !== undefined) await area.remove(LEGACY_KEY);
    const meta = got.meta as Meta | undefined;
    const settingsPatch = got.settings === undefined ? { settings: defaultSettings() } : {};

    if (meta && meta.pending !== true) {
      // Fast path: only meta and settings were read.
      if (got.settings === undefined) await area.set(settingsPatch);
      return;
    }
    const all = await area.get(null);
    const records = recordsOf(all);
    if (!meta && records.size === 0) {
      await area.set({ ...settingsPatch, meta: emptyMeta(0) });
      return;
    }
    await area.set({ ...settingsPatch, meta: rebuildMeta(meta, records.values()) });
  }

  async function addTask(capture: Capture): Promise<AddResult> {
    const bad = captureError(capture);
    if (bad !== null) throw new StoreError(`invalid capture: ${bad}`);
    const keys = capture.rows.map((r) => recordKey(r.domain));
    const { got, meta } = await read(keys);
    const now = clock();
    const records: Record<string, DomainRecord> = {};
    let added = 0;
    for (const row of capture.rows) {
      const existing = got[recordKey(row.domain)] as DomainRecord | undefined;
      if (!existing) added++;
      records[recordKey(row.domain)] = captureRecord(existing, row, capture.sourceId, now);
    }
    const next = captureMeta(meta, capture, added);
    await area.set({ meta: { ...meta, pending: true } });
    await area.set(records);
    await area.set({ meta: next });
    return { added, updated: capture.rows.length - added, total: next.domainCount };
  }

  async function clearTask(): Promise<void> {
    const { got, meta } = await read(null);
    await area.set({ meta: { ...meta, pending: true } });
    const keys = Object.keys(got).filter(isRecordKey);
    if (keys.length) await area.remove(keys);
    await area.set({ meta: emptyMeta(meta.rev + 1) });
  }

  /**
   * Ф15а: delete some records (and/or rewrite others) by the `pending` protocol of Ф11. Step 3
   * rebuilds `meta` from what is left, so labels no record refers to any more are dropped.
   */
  async function removeTask(
    decide: (domain: string, rec: DomainRecord) => 'delete' | 'keep' | DomainRecord,
  ): Promise<DeleteResult> {
    const { got, meta } = await read(null);
    const records = recordsOf(got);
    const removed: string[] = [];
    const rewritten: Record<string, DomainRecord> = {};
    for (const [domain, rec] of records) {
      const verdict = decide(domain, rec);
      if (verdict === 'delete') {
        removed.push(recordKey(domain));
        records.delete(domain);
      } else if (verdict !== 'keep') {
        rewritten[recordKey(domain)] = verdict;
        records.set(domain, verdict);
      }
    }
    const kept = Object.keys(rewritten).length;
    if (removed.length === 0 && kept === 0) {
      await area.set({ meta: { ...meta, rev: meta.rev + 1 } });
      return { deleted: 0, kept: 0 };
    }
    await area.set({ meta: { ...meta, pending: true } });
    if (removed.length) await area.remove(removed);
    if (kept) await area.set(rewritten);
    await area.set({ meta: rebuildMeta(meta, records.values()) });
    return { deleted: removed.length, kept };
  }

  function deleteTask(domains: unknown): Promise<DeleteResult> {
    if (!Array.isArray(domains) || !domains.every((d) => typeof d === 'string'))
      throw new StoreError('invalid domains');
    const wanted = new Set(domains);
    return removeTask((domain) => (wanted.has(domain) ? 'delete' : 'keep'));
  }

  /**
   * Clear one site list: domains seen only there are deleted; a domain also seen in other lists
   * stays with this list taken off. Its stats snapshot stays, and if it came from this list the
   * last remaining list becomes its source (`lastSource ∈ lists`, Ф7).
   */
  function clearListTask(sourceId: unknown): Promise<DeleteResult> {
    if (typeof sourceId !== 'string' || sourceId === '') throw new StoreError('invalid list');
    return removeTask((_, rec) => {
      if (!rec.lists.includes(sourceId)) return 'keep';
      const lists = rec.lists.filter((s) => s !== sourceId);
      if (lists.length === 0) return 'delete';
      return { ...rec, lists, lastSource: rec.lastSource === sourceId ? lists[lists.length - 1] : rec.lastSource };
    });
  }

  async function setSettingsTask(partial: Partial<Settings>): Promise<Settings> {
    const { got, meta } = await read(['settings']);
    const settings = { ...(got.settings as Settings), ...partial };
    const bad = settingsError(settings);
    if (bad !== null) throw new StoreError(`invalid settings: ${bad}`);
    await area.set({ settings, meta: { ...meta, rev: meta.rev + 1 } });
    return settings;
  }

  async function updateTask(domains: string[], rawPatch: unknown): Promise<UpdateResult> {
    const patch = normalizePatch(rawPatch);
    if (patch === null || !Array.isArray(domains) || !domains.every((d) => typeof d === 'string'))
      throw new StoreError('invalid patch');
    const keys = [...new Set(domains)].map(recordKey);
    const { got, meta } = await read(keys);
    const writes: Record<string, unknown> = {};
    let changed = 0;
    let overflow = 0;
    for (const key of keys) {
      const rec = got[key] as DomainRecord | undefined;
      if (!rec) continue; // domains missing from storage are skipped
      const r = applyPatch(rec, patch);
      if (r.overflow) overflow++;
      if (!r.changed) continue;
      changed++;
      writes[key] = r.record;
    }
    // One set: records plus meta.rev only (no pending protocol for update, Ф11).
    await area.set({ ...writes, meta: { ...meta, rev: meta.rev + 1 } });
    return { changed, overflow };
  }

  async function restoreTask(text: string, mode: RestoreMode): Promise<RestoreResult> {
    // Messages are untyped at runtime: an unknown mode must never fall through to "replace".
    if (mode !== 'merge' && mode !== 'replace') throw new StoreError('invalid restore mode');
    if (typeof text !== 'string') throw new StoreError('invalid backup: json');
    const parsed = parseBackup(text);
    if (!parsed.ok) throw new StoreError(`invalid backup: ${parsed.error.code} ${parsed.error.path}`);
    const { got: all, meta } = await read(null);
    const localRecords = recordsOf(all);
    const incoming = backupState(parsed.backup);
    let target: State;
    let tagsOverflow = 0;
    let presetsSkipped = 0;
    if (mode === 'merge') {
      const local: State = {
        records: Object.fromEntries(localRecords),
        sources: meta.sources,
        columns: meta.columns,
        columnOrder: meta.columnOrder,
        settings: all.settings as Settings,
      };
      const m = mergeState(local, incoming);
      target = m.state;
      tagsOverflow = m.tagsOverflow;
      presetsSkipped = m.presetsSkipped;
    } else {
      target = incoming;
    }
    // structuredClone turns validated null-prototype dictionaries into plain objects.
    const plain = structuredClone(target);
    const labels = { sources: plain.sources, columns: plain.columns, columnOrder: plain.columnOrder };
    // Step 1: pending together with the final labels and order (Ф11), so a rebuild keeps them.
    await area.set({ meta: { ...meta, ...labels, pending: true } });
    // Step 2.
    if (mode === 'replace') {
      const stale = [...localRecords.keys()].filter((d) => !Object.hasOwn(plain.records, d)).map(recordKey);
      if (stale.length) await area.remove(stale);
    }
    const writes: Record<string, unknown> = { settings: plain.settings };
    for (const [d, r] of Object.entries(plain.records)) writes[recordKey(d)] = r;
    await area.set(writes);
    // Step 3: meta only.
    const total = Object.keys(plain.records).length;
    await area.set({ meta: { schema: 2, ...labels, domainCount: total, rev: meta.rev + 1 } satisfies Meta });
    return { total, tagsOverflow, presetsSkipped };
  }

  // ensureReady is the first task of the queue; every mutation waits for it (Ф11).
  const ready = enqueue(ensureReadyTask);
  ready.catch(() => undefined);

  return {
    ensureReady: () => enqueue(ensureReadyTask),
    add: (capture: Capture) => enqueue(() => addTask(capture)),
    clear: () => enqueue(clearTask),
    delete: (domains: string[]) => enqueue(() => deleteTask(domains)),
    clearList: (sourceId: string) => enqueue(() => clearListTask(sourceId)),
    setSettings: (partial: Partial<Settings>) => enqueue(() => setSettingsTask(partial)),
    update: (domains: string[], patch: unknown) => enqueue(() => updateTask(domains, patch)),
    restore: (text: string, mode: RestoreMode) => enqueue(() => restoreTask(text, mode)),
  };
}

export type Store = ReturnType<typeof createStore>;
