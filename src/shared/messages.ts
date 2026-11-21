// Messages to the single writer (SPEC Ф9–Ф11). The content script and the popup never write
// storage themselves; they send one of these and wait for the answer.

import type { AddResult, DeleteResult, RestoreMode, RestoreResult, UpdateResult } from '@/background/store';
import type { Capture } from './records';
import type { Patch, Settings } from './types';

export type Request =
  | { type: 'eds:ensureReady' }
  | { type: 'eds:add'; capture: Capture }
  | { type: 'eds:clear' }
  | { type: 'eds:delete'; domains: string[] }
  | { type: 'eds:clearList'; sourceId: string }
  | { type: 'eds:setSettings'; settings: Partial<Settings> }
  | { type: 'eds:update'; domains: string[]; patch: Patch }
  | { type: 'eds:restore'; text: string; mode: RestoreMode };

export interface ResultOf {
  'eds:ensureReady': null;
  'eds:add': AddResult;
  'eds:clear': null;
  'eds:delete': DeleteResult;
  'eds:clearList': DeleteResult;
  'eds:setSettings': Settings;
  'eds:update': UpdateResult;
  'eds:restore': RestoreResult;
}

export type Response<T> = { ok: true; result: T } | { ok: false; error: string };

export const isRequest = (v: unknown): v is Request =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as { type?: unknown }).type === 'string' &&
  (v as { type: string }).type.startsWith('eds:');

/**
 * Send a request. A `{ error }` answer and a rejected or closed channel (worker stopped before
 * answering) are the same failure for the caller (Ф11 "Отправитель").
 */
export async function sendRequest<R extends Request>(
  send: (msg: R) => Promise<unknown>,
  msg: R,
): Promise<Response<ResultOf[R['type']]>> {
  try {
    const res = (await send(msg)) as Response<ResultOf[R['type']]> | undefined;
    if (!res || typeof res !== 'object' || !('ok' in res)) return { ok: false, error: 'no_response' };
    return res;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
