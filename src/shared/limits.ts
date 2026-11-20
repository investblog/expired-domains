// Common limits (SPEC section 6): one set of rules for capture and for restore, so anything a
// capture can produce passes backup validation (Ф27) and vice versa.

export const MAX_SOURCE_ID = 500;
export const MAX_SOURCE_LABEL = 200;
export const MAX_COLUMN_LABEL = 200;
export const MAX_COLUMN_TITLE = 1000;
export const MAX_STAT_VALUE = 1000;

const COLUMN_KEY_RE = /^[a-z0-9_]{1,64}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Keys that must never become dictionary keys (prototype pollution). */
export function isForbiddenKey(key: string): boolean {
  return FORBIDDEN_KEYS.has(key);
}

export function isValidColumnKey(key: string): boolean {
  return COLUMN_KEY_RE.test(key) && !isForbiddenKey(key);
}

export function isValidSourceId(id: string): boolean {
  return id.length > 0 && id.length <= MAX_SOURCE_ID && !isForbiddenKey(id);
}

/** Number of Unicode code points (not UTF-16 units). */
export function codePointLength(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** Truncate to at most `max` code points, never splitting a surrogate pair. */
export function truncateCodePoints(s: string, max: number): string {
  if (s.length <= max) return s;
  let out = '';
  let n = 0;
  for (const ch of s) {
    if (n === max) break;
    out += ch;
    n++;
  }
  return out;
}

/** FNV-1a 32-bit over the UTF-8 bytes of `s`, as 8 lowercase hex digits. */
export function fnv1a32(s: string): string {
  let h = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(s)) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
