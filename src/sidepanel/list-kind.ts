// List kind badge (SPEC Ф8): the kind of site list the stats snapshot came from, read from the
// list's page title (the site is in English). The zone badge is in zone.ts.

export type ListKind = 'pending' | 'deleted' | 'expired' | 'auction' | 'sale' | 'watchlist' | 'search';

// Order matters: "Pending Delete" before "Deleted".
const KINDS: [ListKind, RegExp][] = [
  ['search', /\bsearch\b/i],
  ['watchlist', /\bwatchlist\b/i],
  ['pending', /\bpending\b|\bpre-?release\b/i],
  ['deleted', /\bdeleted\b/i],
  ['auction', /\bauctions?\b/i],
  ['sale', /\bbuy ?now\b|\bfor sale\b|\bcloseouts?\b/i],
  ['expired', /\bexpired\b/i],
];

/** The kind of list a source label names, or null when it is not one we know. */
export function listKind(label: string): ListKind | null {
  for (const [kind, re] of KINDS) if (re.test(label)) return kind;
  return null;
}
