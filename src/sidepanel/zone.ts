// Zone badge (SPEC Ф8): the zone of a name, and the country whose flag marks it. Generic zones —
// gTLDs, the country codes Google treats as generic, city and regional gTLDs — get no country and
// are shown with a globe.

import { FLAG_CODES } from './flag-codes';

/** The zone of a registrable name as the site lists it: everything after the first dot. */
export function zoneOf(domain: string): string {
  const dot = domain.indexOf('.');
  return dot > 0 ? domain.slice(dot) : '';
}

// Google Search Central, "Managing multi-regional and multilingual sites": country codes it
// treats as generic, not as targeting the country (the list "may change").
const GENERIC_CC = new Set([
  'ad',
  'ai',
  'as',
  'bz',
  'cc',
  'cd',
  'co',
  'dj',
  'fm',
  'io',
  'la',
  'me',
  'ms',
  'nu',
  'sc',
  'sr',
  'su',
  'tv',
  'tk',
  'ws',
]);

// Country-code zones whose flag code differs, and internationalised (IDN) country codes.
const ALIASES: Record<string, string> = {
  uk: 'gb',
  'xn--p1ai': 'ru', // .рф
  'xn--j1amh': 'ua', // .укр
  'xn--90ais': 'by', // .бел
  'xn--90a3ac': 'rs', // .срб
  'xn--80ao21a': 'kz', // .қаз
  'xn--d1alf': 'mk', // .мкд
};

export interface ZoneCountry {
  /** Two-letter code (`.co.uk` → `gb`), also for a country code used as generic. */
  code: string;
  /** Shown with a flag; false for generic country codes and codes without a flag. */
  flag: boolean;
}

/** The country of a country-code zone, or null for a gTLD. */
export function zoneCountry(zone: string): ZoneCountry | null {
  const top = zone.slice(zone.lastIndexOf('.') + 1).toLowerCase();
  const code = ALIASES[top] ?? top;
  if (!/^[a-z]{2}$/.test(code)) return null;
  return { code, flag: !GENERIC_CC.has(code) && FLAG_CODES.has(code) };
}
