// Live refresh of an open list (SPEC Ф16): only final `meta` changes (no `pending`) trigger a
// re-read; a re-read is never run in parallel, and one more runs afterwards if `rev` grew.
// A failed re-read is retried a few times, so the list does not stay stale until the next change.

import type { Meta } from './types';

type StorageChange = { newValue?: unknown };
export type ChangeListener = (changes: Record<string, StorageChange>, areaName: string) => void;

export const RETRY_DELAYS_MS = [500, 2000, 5000];

export function watchMeta(
  subscribe: (listener: ChangeListener) => () => void,
  reload: () => Promise<void>,
  initialRev = -1,
  schedule: (fn: () => void, ms: number) => void = (fn, ms) => void setTimeout(fn, ms),
): () => void {
  let latestRev = initialRev;
  let loadedRev = initialRev;
  let running = false;
  let failures = 0;

  async function drain(): Promise<void> {
    if (running) return;
    running = true;
    try {
      while (loadedRev < latestRev) {
        const target = latestRev;
        await reload();
        loadedRev = target;
        failures = 0;
      }
    } catch {
      if (failures < RETRY_DELAYS_MS.length) schedule(() => void drain(), RETRY_DELAYS_MS[failures++]);
    } finally {
      running = false;
    }
  }

  return subscribe((changes, areaName) => {
    if (areaName !== 'local' || !changes.meta) return;
    const meta = changes.meta.newValue as Meta | undefined;
    if (!meta || meta.pending === true) return;
    // `clear` writes a fresh meta with a higher rev, so rev only grows within a session.
    if (meta.rev <= latestRev) return;
    latestRev = meta.rev;
    failures = 0;
    void drain();
  });
}
