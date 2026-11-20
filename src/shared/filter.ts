// Filter (SPEC Ф25): restricted regex, exact condition semantics, the "excluded for no data"
// counter, and strict validation of a stored Filter (presets Ф26, backup Ф27).

import { splitDomain } from './domain';
import { isValidSourceId } from './limits';
import { isNormalizedTag, tagKey } from './tags';
import { parseLocalDate, parseRelativeTime, parseSiteNumber, startOfLocalDay } from './time';
import { type DomainRecord, type Filter, STATUSES, type Status } from './types';

// ---------------------------------------------------------------- regex

export const MAX_REGEX_LENGTH = 100;
export const MAX_REGEX_QUANTIFIERS = 5;
/** Of those, `*`, `+`, `{n,}` and `{n,m}` with m > n (everything except `?` and `{n}`). */
export const MAX_REGEX_VARIABLE_QUANTIFIERS = 2;

function isVariableQuantifier(q: string): boolean {
  if (q === '*' || q === '+') return true;
  const m = /^\{(\d+)(,(\d*))?\}$/.exec(q);
  return m !== null && m[2] !== undefined && (m[3] === '' || Number(m[3]) > Number(m[1]));
}

export type RegexError = 'length' | 'quantifiers' | 'group_quantifier' | 'backreference' | 'lookaround' | 'syntax';

/**
 * Check a regex body against the restricted grammar of Ф25 and compile it with flag `i`.
 * This lowers the risk of catastrophic backtracking; it does not prove its absence.
 */
export function compileRestrictedRegex(body: string): { ok: true; re: RegExp } | { ok: false; error: RegexError } {
  if (body.length > MAX_REGEX_LENGTH) return { ok: false, error: 'length' };
  let quantifiers = 0;
  let variable = 0;
  let prevWasGroupEnd = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    let isGroupEnd = false;
    if (ch === '\\') {
      const next = body[i + 1] ?? '';
      if (/[1-9]/.test(next) || next === 'k') return { ok: false, error: 'backreference' };
      i++;
    } else if (ch === '[') {
      // Skip the character class: quantifier characters inside it are literals.
      for (i++; i < body.length && body[i] !== ']'; i++) if (body[i] === '\\') i++;
    } else if (ch === '(') {
      if (/^\(\?(?:=|!|<=|<!)/.test(body.slice(i, i + 4))) return { ok: false, error: 'lookaround' };
      if (body[i + 1] === '?') i++; // `(?:` / `(?<name>`: this `?` is group syntax, not a quantifier
    } else if (ch === ')') {
      isGroupEnd = true;
    } else {
      const len = quantifierLength(body, i);
      if (len > 0) {
        if (prevWasGroupEnd) return { ok: false, error: 'group_quantifier' };
        if (++quantifiers > MAX_REGEX_QUANTIFIERS) return { ok: false, error: 'quantifiers' };
        // Several adjacent variable-length quantifiers backtrack polynomially (n^k); keep k small.
        if (isVariableQuantifier(body.slice(i, i + len)) && ++variable > MAX_REGEX_VARIABLE_QUANTIFIERS) {
          return { ok: false, error: 'quantifiers' };
        }
        i += len - 1;
        if (body[i + 1] === '?') i++; // lazy modifier belongs to the same quantifier
      }
    }
    prevWasGroupEnd = isGroupEnd;
  }
  try {
    return { ok: true, re: new RegExp(body, 'i') };
  } catch {
    return { ok: false, error: 'syntax' };
  }
}

function quantifierLength(s: string, i: number): number {
  const ch = s[i];
  if (ch === '*' || ch === '+' || ch === '?') return 1;
  if (ch === '{') {
    const m = /^\{\d+(?:,\d*)?\}/.exec(s.slice(i));
    return m ? m[0].length : 0;
  }
  return 0;
}

export type TextMatcher = { ok: true; test: (domain: string) => boolean } | { ok: false; error: RegexError | 'flags' };

/** `text` of a filter: `/body/` is a regex (flag `i` only), anything else a case-insensitive substring. */
export function compileText(text: string): TextMatcher {
  if (text.startsWith('/')) {
    if (text.length < 2 || !text.endsWith('/')) return { ok: false, error: 'flags' };
    const r = compileRestrictedRegex(text.slice(1, -1));
    return r.ok ? { ok: true, test: (d) => r.re.test(d) } : r;
  }
  const needle = text.toLowerCase();
  return { ok: true, test: (d) => d.includes(needle) };
}

// ---------------------------------------------------------------- evaluation

/** Result of one condition: passes, fails on real data, or fails because the data is missing or unparsed. */
type Verdict = 'pass' | 'fail' | 'nodata';

type Condition = (domain: string, rec: DomainRecord) => Verdict;

const verdict = (ok: boolean): Verdict => (ok ? 'pass' : 'fail');

function statNumber(rec: DomainRecord, key: string): number | null {
  const v = rec.stats[key];
  return v === undefined ? null : parseSiteNumber(v);
}

/** Release date (Ф24): `changes` relative to `lastSeen`; without the `changes` key — `dropped`. */
function droppedAt(rec: DomainRecord): number | null {
  if (Object.hasOwn(rec.stats, 'changes')) return parseRelativeTime(rec.stats.changes, 'past', rec.lastSeen);
  return Object.hasOwn(rec.stats, 'dropped') ? parseLocalDate(rec.stats.dropped) : null;
}

function statTime(rec: DomainRecord, key: string, kind: 'past' | 'future'): number | null {
  return Object.hasOwn(rec.stats, key) ? parseRelativeTime(rec.stats[key], kind, rec.lastSeen) : null;
}

function buildConditions(filter: Filter, now: number): { conditions: Condition[]; textError: TextMatcher | null } {
  const c: Condition[] = [];
  let textError: TextMatcher | null = null;

  if (filter.text !== undefined) {
    const m = compileText(filter.text);
    if (m.ok) c.push((d) => verdict(m.test(d)));
    else textError = m; // an invalid regex is highlighted and not applied
  }
  if (filter.statuses) {
    const set = new Set<Status>(filter.statuses);
    c.push((_, r) => verdict(set.has(r.status ?? 'new')));
  }
  if (filter.tagsAny) {
    const set = new Set(filter.tagsAny.map(tagKey));
    c.push((_, r) => verdict((r.tags ?? []).some((t) => set.has(tagKey(t)))));
  }
  if (filter.tagsNone) {
    const set = new Set(filter.tagsNone.map(tagKey));
    c.push((_, r) => verdict(!(r.tags ?? []).some((t) => set.has(tagKey(t)))));
  }
  if (filter.lists) {
    const set = new Set(filter.lists);
    c.push((_, r) => verdict(r.lists.some((l) => set.has(l))));
  }
  if (filter.availability) {
    const want = filter.availability;
    c.push((_, r) => {
      const raw = Object.hasOwn(r.stats, 'whois') ? r.stats.whois : r.stats.whois2;
      const v = raw?.trim().toLowerCase();
      if (v !== 'available' && v !== 'registered') return 'nodata';
      return verdict(v === want);
    });
  }
  if (filter.freshHours !== undefined) {
    const since = now - filter.freshHours * 3_600_000;
    c.push((_, r) => verdict(r.lastSeen >= since));
  }
  if (filter.droppedWithinDays !== undefined) {
    const from = startOfLocalDay(now, -filter.droppedWithinDays);
    c.push((_, r) => {
      const t = droppedAt(r);
      return t === null ? 'nodata' : verdict(t >= from);
    });
  }
  if (filter.deletesWithinDays !== undefined) {
    const from = startOfLocalDay(now);
    const until = startOfLocalDay(now, filter.deletesWithinDays + 1);
    c.push((_, r) => {
      const t = statTime(r, 'enddate', 'future');
      return t === null ? 'nodata' : verdict(t >= from && t < until);
    });
  }
  if (filter.auctionActive) {
    c.push((_, r) => {
      const t = statTime(r, 'endtime', 'future');
      return t === null ? 'nodata' : verdict(t > now);
    });
  }
  const threshold = (min: number | undefined, key: string) => {
    if (min === undefined) return;
    c.push((_, r) => {
      const n = statNumber(r, key);
      return n === null ? 'nodata' : verdict(n >= min);
    });
  };
  threshold(filter.minBl, 'bl');
  threshold(filter.minDp, 'domainpop');
  threshold(filter.minArchiveEntries, 'aentries');
  if (filter.archiveFirstYearMax !== undefined) {
    const max = filter.archiveFirstYearMax;
    c.push((_, r) => {
      const m = /^(\d{4})/.exec(r.stats.abirth ?? '');
      return m ? verdict(Number(m[1]) <= max) : 'nodata';
    });
  }
  if (filter.maxNameLength !== undefined) {
    const max = filter.maxNameLength;
    c.push((d) => verdict(splitDomain(d).name.length <= max));
  }
  if (filter.zones) {
    const set = new Set(filter.zones);
    c.push((d) => verdict(set.has(splitDomain(d).zone)));
  }
  if (filter.noDigits) c.push((d) => verdict(!/\d/.test(splitDomain(d).name)));
  if (filter.noHyphens) c.push((d) => verdict(!splitDomain(d).name.includes('-')));

  return { conditions: c, textError };
}

export interface Selection {
  /** Matching domains in export order: by code units, ascending (Ф17). */
  domains: string[];
  /** Domains excluded only because some condition had no data: no condition failed on real data. */
  excludedNoData: number;
  /** Set when `text` is a rejected regex; the condition is then not applied. */
  textError: RegexError | 'flags' | null;
}

export function applyFilter(records: Iterable<[string, DomainRecord]>, filter: Filter, now: number): Selection {
  const { conditions, textError } = buildConditions(filter, now);
  const domains: string[] = [];
  let excludedNoData = 0;
  for (const [domain, rec] of records) {
    let failed = false;
    let noData = false;
    for (const cond of conditions) {
      const v = cond(domain, rec);
      if (v === 'fail') {
        failed = true;
        break;
      }
      if (v === 'nodata') noData = true;
    }
    if (failed) continue;
    if (noData) excludedNoData++;
    else domains.push(domain);
  }
  domains.sort(compareCodeUnits);
  return { domains, excludedNoData, textError: textError && !textError.ok ? textError.error : null };
}

export const compareCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// ---------------------------------------------------------------- validation

const FILTER_KEYS = new Set<keyof Filter>([
  'text',
  'statuses',
  'tagsAny',
  'tagsNone',
  'lists',
  'availability',
  'freshHours',
  'droppedWithinDays',
  'deletesWithinDays',
  'auctionActive',
  'minBl',
  'minDp',
  'minArchiveEntries',
  'archiveFirstYearMax',
  'maxNameLength',
  'zones',
  'noDigits',
  'noHyphens',
]);

const ZONE_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const intIn = (v: unknown, min: number, max = Number.MAX_SAFE_INTEGER): boolean =>
  Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;

function uniqueArray(v: unknown, item: (x: unknown) => boolean, key: (x: string) => string = (x) => x): boolean {
  if (!Array.isArray(v) || v.length === 0 || !v.every(item)) return false;
  return new Set(v.map((x) => key(x as string))).size === v.length;
}

/** Strict check of a stored Filter: known fields only, exact types and ranges (Ф25). Returns the bad field or null. */
export function filterError(v: unknown): string | null {
  if (!isPlainObject(v)) return 'filter';
  for (const [k, x] of Object.entries(v)) {
    if (!FILTER_KEYS.has(k as keyof Filter)) return k;
    const ok = (() => {
      switch (k as keyof Filter) {
        case 'text':
          return typeof x === 'string' && x !== '';
        case 'statuses':
          return uniqueArray(x, (s) => (STATUSES as readonly unknown[]).includes(s));
        case 'tagsAny':
        case 'tagsNone':
          return uniqueArray(x, (t) => typeof t === 'string' && isNormalizedTag(t), tagKey);
        case 'lists':
          return uniqueArray(x, (s) => typeof s === 'string' && isValidSourceId(s));
        case 'availability':
          return x === 'available' || x === 'registered';
        case 'freshHours':
          return intIn(x, 1);
        case 'droppedWithinDays':
        case 'deletesWithinDays':
        case 'minBl':
        case 'minDp':
        case 'minArchiveEntries':
          return intIn(x, 0);
        case 'archiveFirstYearMax':
          return intIn(x, 1990, 2100);
        case 'maxNameLength':
          return intIn(x, 1, 63);
        case 'zones':
          return uniqueArray(x, (z) => typeof z === 'string' && z.length <= 253 && ZONE_RE.test(z));
        case 'auctionActive':
        case 'noDigits':
        case 'noHyphens':
          return x === true;
      }
    })();
    if (!ok) return k;
  }
  return null;
}
