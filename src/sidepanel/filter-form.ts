// Filter controls (SPEC Ф25): every condition of the Filter type. Statuses are toggle chips that
// live in the toolbar (`statusChips`); the rest is grouped for the filter drawer (`element`).
// read() gives the Filter (invalid fields are left out and marked); write() loads a preset.

import { type Filter, STATUSES, type Status } from '@/shared/types';
import { h } from './dom';
import { type ListCount, parseTagList, parseZoneList } from './model';

type T = (key: string, ...subs: string[]) => string;

type NumberField =
  | 'freshHours'
  | 'droppedWithinDays'
  | 'deletesWithinDays'
  | 'minBl'
  | 'minDp'
  | 'minArchiveEntries'
  | 'archiveFirstYearMax'
  | 'maxNameLength';

const NUMBER_FIELDS: { key: NumberField; label: string; min: number; max: number }[] = [
  { key: 'freshHours', label: 'filterFreshHours', min: 1, max: Number.MAX_SAFE_INTEGER },
  { key: 'droppedWithinDays', label: 'filterDroppedWithinDays', min: 0, max: Number.MAX_SAFE_INTEGER },
  { key: 'deletesWithinDays', label: 'filterDeletesWithinDays', min: 0, max: Number.MAX_SAFE_INTEGER },
  { key: 'minBl', label: 'filterMinBl', min: 0, max: Number.MAX_SAFE_INTEGER },
  { key: 'minDp', label: 'filterMinDp', min: 0, max: Number.MAX_SAFE_INTEGER },
  { key: 'minArchiveEntries', label: 'filterMinArchiveEntries', min: 0, max: Number.MAX_SAFE_INTEGER },
  { key: 'archiveFirstYearMax', label: 'filterArchiveFirstYearMax', min: 1990, max: 2100 },
  { key: 'maxNameLength', label: 'filterMaxNameLength', min: 1, max: 63 },
];

const STATUS_LABEL: Record<Status, string> = {
  new: 'statusNew',
  shortlist: 'statusShortlist',
  rejected: 'statusRejected',
  bought: 'statusBought',
};
export const statusLabel = (t: T, s: Status): string => t(STATUS_LABEL[s]);

export interface FilterForm {
  /** Drawer content: lists, timing, metrics, name, tags. */
  element: HTMLElement;
  /** Toolbar chips for the status condition. */
  statusChips: HTMLElement;
  read(): Omit<Filter, 'text'>;
  write(filter: Filter): void;
  /** Clears the drawer conditions; statuses and text stay. */
  reset(): void;
  /** Number of drawer conditions in effect (statuses and text are visible outside). */
  activeCount(): number;
  setLists(lists: ListCount[]): void;
}

/** A pressed/unpressed toggle chip. */
function chip(text: string, title?: string): HTMLButtonElement {
  return h('button', { class: 'chip', text, title, attrs: { type: 'button', 'aria-pressed': 'false' } });
}
const pressed = (b: HTMLButtonElement) => b.getAttribute('aria-pressed') === 'true';
const press = (b: HTMLButtonElement, on: boolean) => b.setAttribute('aria-pressed', String(on));

export function createFilterForm(t: T, onChange: () => void): FilterForm {
  const field = (label: string, control: HTMLElement, wide = false) =>
    h(
      'label',
      { class: wide ? 'field field--wide' : 'field' },
      h('span', { class: 'field__label', text: t(label) }),
      control,
    );
  const group = (legend: string, ...children: HTMLElement[]) =>
    h('fieldset', { class: 'fieldset-group' }, h('legend', { text: t(legend) }), ...children);
  const toggleOnClick = (container: HTMLElement) =>
    container.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button.chip') as HTMLButtonElement | null;
      if (!b) return;
      press(b, !pressed(b));
      onChange();
    });

  const statusBoxes = new Map<Status, HTMLButtonElement>();
  const statusChips = h('div', { class: 'chips', attrs: { role: 'group', 'aria-label': t('filterStatuses') } });
  for (const s of STATUSES) {
    const b = chip(statusLabel(t, s));
    statusBoxes.set(s, b);
    statusChips.append(b);
  }
  toggleOnClick(statusChips);

  const availability = h(
    'select',
    {},
    h('option', { text: t('filterAny'), attrs: { value: '' } }),
    h('option', { text: t('filterAvailable'), attrs: { value: 'available' } }),
    h('option', { text: t('filterRegistered'), attrs: { value: 'registered' } }),
  );
  const tagsAny = h('input', { attrs: { type: 'text', list: 'eds-tags', placeholder: t('filterTagsPlaceholder') } });
  const tagsNone = h('input', { attrs: { type: 'text', list: 'eds-tags', placeholder: t('filterTagsPlaceholder') } });
  const zones = h('input', { attrs: { type: 'text', placeholder: 'com, net, co.uk' } });
  const numbers = new Map<NumberField, HTMLInputElement>();
  for (const f of NUMBER_FIELDS) {
    numbers.set(f.key, h('input', { attrs: { type: 'number', min: String(f.min), max: String(f.max), step: '1' } }));
  }
  const num = (key: NumberField) =>
    field(NUMBER_FIELDS.find((f) => f.key === key)?.label ?? key, numbers.get(key) as HTMLInputElement);
  const flag = (label: string) => {
    const box = h('input', { attrs: { type: 'checkbox' } });
    return { box, el: h('label', { class: 'check' }, box, t(label)) };
  };
  const auction = flag('filterAuctionActive');
  const noDigits = flag('filterNoDigits');
  const noHyphens = flag('filterNoHyphens');
  const listsRow = h('div', { class: 'chips' });
  const listBoxes = new Map<string, HTMLButtonElement>();
  toggleOnClick(listsRow);

  const element = h(
    'div',
    { class: 'filter-form' },
    group('filterLists', listsRow),
    group(
      'filterGroupTime',
      h(
        'div',
        { class: 'grid' },
        field('filterAvailability', availability),
        num('freshHours'),
        num('droppedWithinDays'),
        num('deletesWithinDays'),
      ),
      h('div', { class: 'checks' }, auction.el),
    ),
    group(
      'filterGroupMetrics',
      h('div', { class: 'grid' }, num('minBl'), num('minDp'), num('minArchiveEntries'), num('archiveFirstYearMax')),
    ),
    group(
      'filterGroupName',
      h('div', { class: 'grid' }, field('filterZones', zones), num('maxNameLength')),
      h('div', { class: 'checks' }, noDigits.el, noHyphens.el),
    ),
    group(
      'filterGroupTags',
      h('div', { class: 'grid' }, field('filterTagsAny', tagsAny), field('filterTagsNone', tagsNone)),
    ),
  );
  element.addEventListener('input', onChange);
  element.addEventListener('change', onChange);

  const mark = (el: HTMLElement, bad: boolean) => el.classList.toggle('invalid', bad);

  function read(): Omit<Filter, 'text'> {
    const f: Omit<Filter, 'text'> = {};
    const statuses = STATUSES.filter((s) => pressed(statusBoxes.get(s) as HTMLButtonElement));
    if (statuses.length) f.statuses = statuses;
    const lists = [...listBoxes].filter(([, b]) => pressed(b)).map(([id]) => id);
    if (lists.length) f.lists = lists;
    if (availability.value === 'available' || availability.value === 'registered') f.availability = availability.value;
    for (const spec of NUMBER_FIELDS) {
      const input = numbers.get(spec.key) as HTMLInputElement;
      const raw = input.value.trim();
      const n = Number(raw);
      const ok = raw === '' || (Number.isSafeInteger(n) && n >= spec.min && n <= spec.max);
      mark(input, !ok);
      if (raw !== '' && ok) f[spec.key] = n;
    }
    for (const [input, key] of [
      [tagsAny, 'tagsAny'],
      [tagsNone, 'tagsNone'],
    ] as const) {
      const { tags, invalid } = parseTagList(input.value);
      mark(input, invalid.length > 0);
      if (tags.length) f[key] = tags;
    }
    const z = parseZoneList(zones.value);
    const zonesOk = z.every((x) => /^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(x));
    mark(zones, !zonesOk);
    if (z.length && zonesOk) f.zones = z;
    if (auction.box.checked) f.auctionActive = true;
    if (noDigits.box.checked) f.noDigits = true;
    if (noHyphens.box.checked) f.noHyphens = true;
    return f;
  }

  function write(filter: Filter): void {
    for (const [s, b] of statusBoxes) press(b, filter.statuses?.includes(s) ?? false);
    for (const [id, b] of listBoxes) press(b, filter.lists?.includes(id) ?? false);
    availability.value = filter.availability ?? '';
    for (const spec of NUMBER_FIELDS) {
      const input = numbers.get(spec.key) as HTMLInputElement;
      input.value = filter[spec.key] === undefined ? '' : String(filter[spec.key]);
      mark(input, false);
    }
    tagsAny.value = (filter.tagsAny ?? []).join(', ');
    tagsNone.value = (filter.tagsNone ?? []).join(', ');
    zones.value = (filter.zones ?? []).join(', ');
    for (const el of [tagsAny, tagsNone, zones]) mark(el, false);
    auction.box.checked = filter.auctionActive === true;
    noDigits.box.checked = filter.noDigits === true;
    noHyphens.box.checked = filter.noHyphens === true;
  }

  function reset(): void {
    const statuses = read().statuses;
    write(statuses ? { statuses } : {});
  }

  function activeCount(): number {
    const { statuses: _statuses, ...rest } = read();
    return Object.keys(rest).length;
  }

  function setLists(lists: ListCount[]): void {
    const on = new Set([...listBoxes].filter(([, b]) => pressed(b)).map(([id]) => id));
    listBoxes.clear();
    listsRow.replaceChildren();
    for (const l of lists) {
      const b = chip(`${l.label} · ${l.count}`, l.sourceId);
      press(b, on.has(l.sourceId));
      listBoxes.set(l.sourceId, b);
      listsRow.append(b);
    }
    if (!lists.length) listsRow.append(h('span', { class: 'muted', text: '—' }));
  }

  return { element, statusChips, read, write, reset, activeCount, setLists };
}
