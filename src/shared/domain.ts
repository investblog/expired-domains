// Domain normalization and validation (SPEC Ф7).

export type DomainRejectReason = 'empty' | 'idn' | 'invalid';

export type DomainResult = { ok: true; domain: string } | { ok: false; reason: DomainRejectReason };

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Trim, lowercase, drop one trailing dot, then validate. Unicode names are rejected, not converted. */
export function toDomain(raw: string): DomainResult {
  let s = raw.trim().toLowerCase();
  if (s.endsWith('.')) s = s.slice(0, -1);
  if (s === '') return { ok: false, reason: 'empty' };
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the ASCII range is the point
  if (/[^\x00-\x7f]/.test(s)) return { ok: false, reason: 'idn' };
  if (s.length > 253) return { ok: false, reason: 'invalid' };
  const labels = s.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL_RE.test(l))) return { ok: false, reason: 'invalid' };
  return { ok: true, domain: s };
}

/** True when `s` is already in the normalized Ф7 form (used for backup keys, which are never fixed up). */
export function isNormalizedDomain(s: string): boolean {
  const r = toDomain(s);
  return r.ok && r.domain === s;
}

/** First label (the "name", like the site's LE column) and the zone after the first dot (Ф25). */
export function splitDomain(domain: string): { name: string; zone: string } {
  const dot = domain.indexOf('.');
  return { name: domain.slice(0, dot), zone: domain.slice(dot + 1) };
}
