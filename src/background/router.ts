// Message dispatch to the store. The answer is sent only after the storage promises resolved (Ф10).

import type { Request, Response } from '@/shared/messages';
import type { Store } from './store';

export async function handleRequest(store: Store, msg: Request): Promise<Response<unknown>> {
  try {
    switch (msg.type) {
      case 'eds:ensureReady':
        await store.ensureReady();
        return { ok: true, result: null };
      case 'eds:add':
        return { ok: true, result: await store.add(msg.capture) };
      case 'eds:clear':
        await store.clear();
        return { ok: true, result: null };
      case 'eds:setSettings':
        return { ok: true, result: await store.setSettings(msg.settings) };
      case 'eds:update':
        return { ok: true, result: await store.update(msg.domains, msg.patch) };
      case 'eds:restore':
        return { ok: true, result: await store.restore(msg.text, msg.mode) };
      default:
        return { ok: false, error: 'unknown_request' };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Badge text (Ф12): exact below 1000, then `1.2k`, then `12k`; empty for 0. */
export function badgeText(count: number): string {
  if (count <= 0) return '';
  if (count < 1000) return String(count);
  if (count < 10_000) return `${Math.floor(count / 100) / 10}k`;
  return `${Math.floor(count / 1000)}k`;
}
