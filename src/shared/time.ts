// Relative time and numbers from cell values (SPEC Ф24, Ф25). Day boundaries use calendar
// arithmetic in the user's local zone (setDate), never multiples of 24 h, so DST days are exact.

/** Which way a relative value counts from the capture moment (Ф24). */
export type TimeKind = 'past' | 'future';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const DAYS_RE = /^(\d+)\s+days?$/i;
const DHM_RE = /^(?:(\d+)d)?\s*(?:(\d+)h)?\s*(?:(\d+)m)?$/i;
const DAY_TIME_RE = /^(Today|Yesterday)\s+(\d{1,2}):(\d{2})$/i;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Absolute time (epoch ms) of a cell value, or null when the format is unknown. `capturedAt`
 * is the record's `lastSeen`; absolute dates are local midnight.
 */
export function parseRelativeTime(text: string, kind: TimeKind, capturedAt: number): number | null {
  const t = rawRelativeTime(text, kind, capturedAt);
  // Absurd values ("999999999999999999 days") overflow Date: that is "unknown", not a time.
  return t !== null && Number.isFinite(t) ? t : null;
}

function rawRelativeTime(text: string, kind: TimeKind, capturedAt: number): number | null {
  const s = text.trim();
  const sign = kind === 'past' ? -1 : 1;

  let m = DAYS_RE.exec(s);
  if (m) {
    const d = new Date(capturedAt);
    d.setDate(d.getDate() + sign * Number(m[1]));
    return d.getTime();
  }

  m = DHM_RE.exec(s);
  if (m && (m[1] || m[2] || m[3])) {
    const d = new Date(capturedAt);
    d.setDate(d.getDate() + sign * Number(m[1] ?? 0));
    return d.getTime() + sign * (Number(m[2] ?? 0) * HOUR + Number(m[3] ?? 0) * MINUTE);
  }

  m = DAY_TIME_RE.exec(s);
  if (m) {
    const [hh, mm] = [Number(m[2]), Number(m[3])];
    if (hh > 23 || mm > 59) return null;
    const d = new Date(capturedAt);
    d.setDate(d.getDate() - (m[1].toLowerCase() === 'yesterday' ? 1 : 0));
    d.setHours(hh, mm, 0, 0);
    return d.getTime();
  }

  return parseLocalDate(s);
}

/** `YYYY-MM-DD` as local midnight; null for anything else or an impossible date. */
export function parseLocalDate(text: string): number | null {
  const m = DATE_RE.exec(text.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const date = new Date(y, mo, d);
  return date.getFullYear() === y && date.getMonth() === mo && date.getDate() === d ? date.getTime() : null;
}

/** Local midnight of the day `offsetDays` away from the day of `at`. */
export function startOfLocalDay(at: number, offsetDays = 0): number {
  const d = new Date(at);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offsetDays).getTime();
}

const NUMBER_RE = /^(\d+(?:\.\d+)?)\s*([KM])?$/i;

/** Site numbers: `383`, `58,270`, `93.2 K` → 93200, `6.8 M` → 6800000; anything else → null. */
export function parseSiteNumber(text: string): number | null {
  const m = NUMBER_RE.exec(text.trim().replace(/,/g, ''));
  if (!m) return null;
  const scale = m[2] ? (m[2].toUpperCase() === 'K' ? 1e3 : 1e6) : 1;
  return Math.round(Number(m[1]) * scale);
}
