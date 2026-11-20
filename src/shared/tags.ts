// Tag names (SPEC Ф21): trimmed, inner whitespace collapsed, 1–40 code points, compared
// case-insensitively; the spelling of the first input is kept.

import { codePointLength } from './limits';

export const MAX_TAG_LENGTH = 40;
export const MAX_TAGS = 20;

/** Normalized tag, or null when it is empty or too long. */
export function normalizeTag(raw: string): string | null {
  const s = raw.trim().replace(/\s+/g, ' ');
  const n = codePointLength(s);
  // `,` separates tags in the input fields and `;` in the CSV `tags` column (Ф17), so a tag
  // containing either could not survive a round trip.
  return n >= 1 && n <= MAX_TAG_LENGTH && !/[,;]/.test(s) ? s : null;
}

export const isNormalizedTag = (s: string): boolean => normalizeTag(s) === s;

/** Comparison key: case-insensitive. */
export const tagKey = (tag: string): string => tag.toLowerCase();
