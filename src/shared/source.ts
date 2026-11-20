// List identity of a page (SPEC Д10) with the common limits of section 6. Pure: the content
// script passes `location.href` and `document.title`.

import { fnv1a32, MAX_SOURCE_ID, MAX_SOURCE_LABEL, truncateCodePoints } from './limits';

export interface Source {
  sourceId: string;
  sourceLabel: string;
}

const SEARCH_PATH = '/domain-name-search/';

export function pageSource(href: string, documentTitle: string): Source {
  const url = new URL(href);
  const base = url.host + url.pathname;
  const label = documentTitle.split(/ » | \| /)[0].trim();
  const q = url.pathname === SEARCH_PATH ? (url.searchParams.get('q') ?? '') : '';
  if (q === '') return { sourceId: truncateSourceId(base), sourceLabel: truncateCodePoints(label, MAX_SOURCE_LABEL) };
  return {
    sourceId: searchSourceId(base, q),
    sourceLabel: truncateCodePoints(`${label}: ${q}`, MAX_SOURCE_LABEL),
  };
}

const encodeQ = (q: string): string => new URLSearchParams({ q }).toString();

function searchSourceId(base: string, q: string): string {
  const full = `${base}?${encodeQ(q)}`;
  if (full.length <= MAX_SOURCE_ID) return full;
  // Cut `q` (by code points) until base + "?q=…" + "~<8 hex>" fits; the hash of the full `q`
  // keeps different long searches with a common prefix apart.
  const suffix = `~${fnv1a32(q)}`;
  const chars = Array.from(q);
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const id = `${base}?${encodeQ(chars.slice(0, mid).join(''))}${suffix}`;
    if (id.length <= MAX_SOURCE_ID) lo = mid;
    else hi = mid - 1;
  }
  return truncateSourceId(`${base}?${encodeQ(chars.slice(0, lo).join(''))}${suffix}`);
}

/** Host + path are ASCII after URL parsing; a path over the limit is cut (not expected on the site). */
function truncateSourceId(id: string): string {
  return id.length <= MAX_SOURCE_ID ? id : id.slice(0, MAX_SOURCE_ID);
}
