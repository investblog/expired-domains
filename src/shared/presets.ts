// Filter presets and settings (SPEC Ф26, section 6). Pure: every function returns new settings.

import { filterError } from './filter';
import { codePointLength } from './limits';
import type { Filter, FilterPreset, Settings } from './types';

export const BUILTIN_PRESETS: readonly { readonly id: string; readonly filter: Filter }[] = [
  // The default view of the list (Ф13): everything except rejected.
  { id: 'all', filter: { statuses: ['new', 'shortlist', 'bought'] } },
  { id: 'working-drops', filter: { availability: 'available', freshHours: 24, statuses: ['new', 'shortlist'] } },
  { id: 'working-auctions', filter: { auctionActive: true, freshHours: 24, statuses: ['new', 'shortlist'] } },
];
export const DEFAULT_PRESET_ID = 'all';
export const RESERVED_ID_PREFIX = 'working-';
export const MAX_PRESETS = 20;
export const MAX_PRESET_NAME = 40;

const PRESET_ID_RE = /^[a-z0-9-]{1,40}$/;

export function defaultSettings(): Settings {
  return {
    autoCapture: false,
    panelCollapsed: false,
    filterPresets: [],
    activePreset: DEFAULT_PRESET_ID,
    pageMarks: true,
    dimRejected: true,
  };
}

/** The page-mark switches with their defaults; settings stored by 0.1 have neither key (SPEC 4.7, Ф32). */
export const pageMarkSettings = (s: Partial<Settings>): { pageMarks: boolean; dimRejected: boolean } => ({
  pageMarks: s.pageMarks ?? true,
  dimRejected: s.dimRejected ?? true,
});

export const isBuiltinPreset = (id: string): boolean => BUILTIN_PRESETS.some((p) => p.id === id);

export function presetFilter(settings: Settings, id: string): Filter | null {
  const preset = BUILTIN_PRESETS.find((p) => p.id === id) ?? settings.filterPresets.find((p) => p.id === id);
  return preset ? structuredClone(preset.filter) : null;
}

/** Smallest free `p<N>`; deterministic, so tests and merges are reproducible. */
export function nextPresetId(used: Iterable<string>): string {
  const taken = new Set(used);
  let n = 1;
  while (taken.has(`p${n}`)) n++;
  return `p${n}`;
}

export type PresetError = 'name' | 'name_taken' | 'limit' | 'not_found' | 'builtin' | 'filter';
export type PresetResult = { ok: true; settings: Settings; id: string } | { ok: false; error: PresetError };

const nameKey = (name: string): string => name.toLowerCase();

/**
 * `reservedNames` are the built-in presets' display names in the UI languages; they come from
 * i18n, which shared code does not import.
 */
function checkName(
  settings: Settings,
  raw: string,
  reservedNames: readonly string[],
  exceptId?: string,
): { ok: true; name: string } | { ok: false; error: PresetError } {
  const name = raw.trim();
  const n = codePointLength(name);
  if (n < 1 || n > MAX_PRESET_NAME) return { ok: false, error: 'name' };
  const key = nameKey(name);
  const taken =
    reservedNames.some((r) => nameKey(r) === key) ||
    settings.filterPresets.some((p) => p.id !== exceptId && nameKey(p.name) === key);
  return taken ? { ok: false, error: 'name_taken' } : { ok: true, name };
}

export function addPreset(
  settings: Settings,
  rawName: string,
  filter: Filter,
  reservedNames: readonly string[] = [],
): PresetResult {
  if (settings.filterPresets.length >= MAX_PRESETS) return { ok: false, error: 'limit' };
  if (filterError(filter) !== null) return { ok: false, error: 'filter' };
  const name = checkName(settings, rawName, reservedNames);
  if (!name.ok) return name;
  const id = nextPresetId(settings.filterPresets.map((p) => p.id));
  const preset: FilterPreset = { id, name: name.name, filter: structuredClone(filter) };
  return { ok: true, id, settings: { ...settings, filterPresets: [...settings.filterPresets, preset] } };
}

export function renamePreset(
  settings: Settings,
  id: string,
  rawName: string,
  reservedNames: readonly string[] = [],
): PresetResult {
  if (isBuiltinPreset(id)) return { ok: false, error: 'builtin' };
  if (!settings.filterPresets.some((p) => p.id === id)) return { ok: false, error: 'not_found' };
  const name = checkName(settings, rawName, reservedNames, id);
  if (!name.ok) return name;
  const filterPresets = settings.filterPresets.map((p) => (p.id === id ? { ...p, name: name.name } : p));
  return { ok: true, id, settings: { ...settings, filterPresets } };
}

export function deletePreset(settings: Settings, id: string): PresetResult {
  if (isBuiltinPreset(id)) return { ok: false, error: 'builtin' };
  if (!settings.filterPresets.some((p) => p.id === id)) return { ok: false, error: 'not_found' };
  return {
    ok: true,
    id,
    settings: {
      ...settings,
      filterPresets: settings.filterPresets.filter((p) => p.id !== id),
      activePreset: settings.activePreset === id ? DEFAULT_PRESET_ID : settings.activePreset,
    },
  };
}

export function setActivePreset(settings: Settings, id: string): PresetResult {
  if (!isBuiltinPreset(id) && !settings.filterPresets.some((p) => p.id === id))
    return { ok: false, error: 'not_found' };
  return { ok: true, id, settings: { ...settings, activePreset: id } };
}

// ---------------------------------------------------------------- validation (Ф27)

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const hasExactKeys = (o: Record<string, unknown>, keys: readonly string[]): boolean => {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(o, k));
};

const SETTINGS_KEYS = ['autoCapture', 'panelCollapsed', 'filterPresets', 'activePreset'];
/** Added in 0.2 (SPEC 4.7): optional, so settings and backups written by 0.1 stay valid. */
const OPTIONAL_SETTINGS_KEYS = ['pageMarks', 'dimRejected'] as const;

/** Path of the first invalid part of stored settings, or null. Built-in names are checked by the UI. */
export function settingsError(v: unknown): string | null {
  if (!isPlainObject(v)) return 'settings';
  const present = OPTIONAL_SETTINGS_KEYS.filter((k) => Object.hasOwn(v, k));
  if (!hasExactKeys(v, [...SETTINGS_KEYS, ...present])) return 'settings';
  if (typeof v.autoCapture !== 'boolean') return 'settings.autoCapture';
  if (typeof v.panelCollapsed !== 'boolean') return 'settings.panelCollapsed';
  for (const k of present) if (typeof v[k] !== 'boolean') return `settings.${k}`;
  const presets = v.filterPresets;
  if (!Array.isArray(presets) || presets.length > MAX_PRESETS) return 'settings.filterPresets';
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const [i, p] of presets.entries()) {
    const at = `settings.filterPresets[${i}]`;
    if (!isPlainObject(p) || !hasExactKeys(p, ['id', 'name', 'filter'])) return at;
    const { id, name, filter } = p;
    if (
      typeof id !== 'string' ||
      !PRESET_ID_RE.test(id) ||
      id.startsWith(RESERVED_ID_PREFIX) ||
      isBuiltinPreset(id) ||
      ids.has(id)
    ) {
      return `${at}.id`;
    }
    if (typeof name !== 'string' || name !== name.trim()) return `${at}.name`;
    const n = codePointLength(name);
    if (n < 1 || n > MAX_PRESET_NAME || names.has(nameKey(name))) return `${at}.name`;
    const bad = filterError(filter);
    if (bad !== null) return `${at}.filter.${bad}`;
    ids.add(id);
    names.add(nameKey(name));
  }
  if (typeof v.activePreset !== 'string' || !(isBuiltinPreset(v.activePreset) || ids.has(v.activePreset))) {
    return 'settings.activePreset';
  }
  return null;
}
