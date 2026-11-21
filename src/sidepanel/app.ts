// Side panel (SPEC Ф13–Ф27, Ф13а, Ф16, Ф16а): the only extension page — no popup; the toolbar
// icon opens this panel in every browser. Reads storage directly (read only, Ф9); every change goes to the background as a message.
//
// Layout (as in the other 301.st extensions): a fixed shell where only the domain list scrolls —
// toolbar (search, preset, filter button, status chips) on top, export docked at the bottom.
// Forms live in drawers: the filter conditions and presets, the row editor, bulk actions, and
// the data drawer (tags, backup, restore, clear).

import { MAX_NOTE_LENGTH, makeBackup, parseBackup } from '@/shared/backup';
import { exportFileName, toCsv, toTxt } from '@/shared/export';
import { applyFilter, type Selection } from '@/shared/filter';
import { t } from '@/shared/i18n';
import { codePointLength } from '@/shared/limits';
import { type Request, sendRequest } from '@/shared/messages';
import { addPreset, deletePreset, isBuiltinPreset, presetFilter, renamePreset } from '@/shared/presets';
import { watchMeta } from '@/shared/refresh';
import { type IconId, STORE_ICON } from '@/shared/sprite';
import { tagKey } from '@/shared/tags';
import { type DomainRecord, type Filter, type Patch, type Settings, STATUSES, type Status } from '@/shared/types';
import { button, downloadText, h, icon, iconButton, nodes } from './dom';
import { createDrawer } from './drawer';
import { createFilterForm, statusLabel } from './filter-form';
import { type ListKind, listKind } from './list-kind';
import { type Data, domainsWithTag, listBreakdown, parseTagList, readData, stateOf, tagCounts } from './model';
import { initTheme, type Theme, toggleTheme, watchSystemTheme } from './theme';
import { zoneCountry, zoneOf } from './zone';

const MAX_ROWS = 500;
const BUILTIN_NAMES: Record<string, string> = {
  all: 'presetAll',
  'working-drops': 'presetWorkingDrops',
  'working-auctions': 'presetWorkingAuctions',
};
const REPO_ISSUES = 'https://github.com/investblog/expired-domains/issues';
const SUPPORT_CHAT = 'https://t.me/traffic301';

const BROWSER: string = (import.meta as any).env?.BROWSER ?? 'chrome';

const send = <R extends Request>(msg: R) => sendRequest((m: R) => browser.runtime.sendMessage(m), msg);

function storeReviewUrl(): string {
  const id = browser.runtime.id;
  if (BROWSER === 'firefox') return `https://addons.mozilla.org/firefox/addon/${encodeURIComponent(id)}/`;
  if (BROWSER === 'edge') return `https://microsoftedge.microsoft.com/addons/detail/${id}`;
  return `https://chromewebstore.google.com/detail/${id}/reviews`;
}

const field = (label: string, control: HTMLElement) =>
  h('label', { class: 'field' }, h('span', { class: 'field__label', text: t(label) }), control);
const group = (legend: string, ...children: (HTMLElement | null)[]) =>
  h('fieldset', { class: 'fieldset-group' }, h('legend', { text: t(legend) }), ...children);
const KIND_LABEL: Record<ListKind, string> = {
  pending: 'kindPending',
  deleted: 'kindDeleted',
  expired: 'kindExpired',
  auction: 'kindAuction',
  sale: 'kindSale',
  watchlist: 'kindWatchlist',
  search: 'kindSearch',
};
const STATUS_ICON: Record<Exclude<Status, 'new'>, IconId> = {
  shortlist: 'mono-star',
  rejected: 'mono-close',
  bought: 'mono-check',
};
/** A status as a small coloured icon; the name is its tooltip and accessible name. */
const statusBadge = (status: Exclude<Status, 'new'>) => {
  const label = statusLabel(t, status);
  return h(
    'span',
    { class: `badge badge--icon badge--${status}`, title: label, attrs: { role: 'img', 'aria-label': label } },
    icon(STATUS_ICON[status]),
  );
};
const regionNames = (() => {
  try {
    return new Intl.DisplayNames([browser.i18n.getUILanguage()], { type: 'region', fallback: 'none' });
  } catch {
    return null;
  }
})();
/**
 * The zone's country flag, or a globe for a generic zone. The zone itself is in the name, so the
 * mark carries no text; the country (or "generic zone") is its tooltip and accessible name.
 */
const zoneMark = (zone: string) => {
  const country = zoneCountry(zone);
  let name: string | undefined;
  try {
    name = country ? regionNames?.of(country.code.toUpperCase()) : undefined;
  } catch {
    name = undefined;
  }
  const label = [zone, name, country?.flag ? '' : t('zoneGeneric')].filter(Boolean).join(' · ');
  const mark = country?.flag
    ? h('img', { class: 'zone-flag', attrs: { src: `/flags/${country.code}.svg`, alt: '', width: '16', height: '12' } })
    : icon('mono-web', 'icon zone-globe');
  return h('span', { class: 'row__zone-mark', title: label, attrs: { role: 'img', 'aria-label': label } }, mark);
};
const MAX_ROW_TAGS = 2;
/** Up to two tags, the rest folded into "+N" whose tooltip lists them all. */
const rowTags = (tags: string[]) => {
  const shown = tags.slice(0, MAX_ROW_TAGS).map((x) => h('span', { class: 'tag', text: x, title: x }));
  if (tags.length <= MAX_ROW_TAGS) return shown;
  return [
    ...shown,
    h('span', { class: 'tag tag--more', text: `+${tags.length - MAX_ROW_TAGS}`, title: tags.join(', ') }),
  ];
};
const statusSelect = (value: Status = 'new') => {
  const s = h('select', {}, ...STATUSES.map((x) => h('option', { text: statusLabel(t, x), attrs: { value: x } })));
  s.value = value;
  return s;
};

export async function startApp(root: HTMLElement): Promise<void> {
  document.documentElement.lang = browser.i18n.getUILanguage().startsWith('ru') ? 'ru' : 'en';
  document.title = t('extName');
  const theme = initTheme();

  let data: Data = readData({});
  let selection: Selection = { domains: [], excludedNoData: 0, textError: null };
  const checked = new Set<string>();
  let editing: string | null = null;

  const filterDrawer = createDrawer('filters', t('drawerClose'));
  const editDrawer = createDrawer('editor', t('drawerClose'), () => {
    editing = null;
    markActiveRow();
  });
  const bulkDrawer = createDrawer('bulk', t('drawerClose'));
  const dataDrawer = createDrawer('data', t('drawerClose'));
  filterDrawer.setTitle(t('filterTitle'));
  dataDrawer.setTitle(t('dataTitle'));

  // ---------------------------------------------------------------- header

  const themeIcon = (current: Theme) => icon(current === 'dark' ? 'mono-moon' : 'mono-sun');
  const themeBtn = iconButton(theme === 'dark' ? 'mono-moon' : 'mono-sun', t('popupTheme'), () => {
    themeBtn.replaceChildren(themeIcon(toggleTheme()));
  });
  // Until the user picks a theme the page follows the system; keep the icon in step with it.
  watchSystemTheme((current) => themeBtn.replaceChildren(themeIcon(current)));

  const header = h(
    'header',
    { class: 'header' },
    h(
      'a',
      {
        class: 'brand',
        attrs: {
          href: `https://301.st/?utm_source=${BROWSER}_ext&utm_medium=sidepanel_logo&utm_campaign=expired_domains`,
          target: '_blank',
          rel: 'noopener',
          'aria-label': '301.st',
        },
      },
      icon('brand-301', 'logo'),
    ),
    h('h1', { class: 'title', text: t('extName') }),
    h(
      'div',
      { class: 'header__actions' },
      iconButton('mono-cog', t('dataTitle'), () => dataDrawer.open()),
      themeBtn,
    ),
  );

  // ---------------------------------------------------------------- toolbar: search, preset, filters

  const textInput = h('input', {
    class: 'search__input',
    attrs: {
      type: 'text',
      placeholder: t('filterTextPlaceholder'),
      'aria-label': t('filterTextPlaceholder'),
      autocomplete: 'off',
      spellcheck: 'false',
    },
  });
  const searchIcon = icon('mono-magnify', 'icon search__icon');
  const search = h(
    'div',
    { class: 'search' },
    searchIcon,
    textInput,
    iconButton(
      'mono-close',
      t('searchClear'),
      () => {
        textInput.value = '';
        recompute();
        textInput.focus();
      },
      'search__clear',
    ),
  );
  textInput.addEventListener('input', () => recompute());
  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && textInput.value) {
      e.preventDefault();
      textInput.value = '';
      recompute();
    }
  });

  const presetSelect = h('select', { class: 'preset', attrs: { 'aria-label': t('filterPreset') } });
  const form = createFilterForm(t, () => recompute());
  const filterBadge = h('span', { class: 'filter-btn__badge' });
  const filterBtn = h(
    'button',
    { class: 'icon-btn filter-btn', attrs: { type: 'button', 'aria-haspopup': 'dialog' } },
    icon('mono-filter'),
    filterBadge,
  );
  filterBtn.addEventListener('click', () => filterDrawer.open());
  const filterHint = h('div', { class: 'hint' });
  const tagsDatalist = h('datalist', { attrs: { id: 'eds-tags' } });

  const toolbar = h(
    'section',
    { class: 'toolbar' },
    h('div', { class: 'toolbar__row' }, search, presetSelect, filterBtn),
    form.statusChips,
    filterHint,
    tagsDatalist,
  );

  const currentFilter = (): Filter => {
    const f: Filter = { ...form.read() };
    const text = textInput.value.trim();
    if (text) f.text = text;
    return f;
  };

  // ---------------------------------------------------------------- filter drawer: conditions + presets

  // No maxlength: it counts UTF-16 units, the limits are in code points (checked on save).
  const presetName = h('input', {
    attrs: { type: 'text', placeholder: t('presetNamePlaceholder'), 'aria-label': t('presetNamePlaceholder') },
  });
  const presetBar = h('div', { class: 'preset-bar' });
  const showBtn = button('', () => filterDrawer.close(), 'btn btn--primary');
  filterDrawer.body.append(form.element, group('filterPreset', presetBar));
  filterDrawer.footer.append(
    button(
      t('filterReset'),
      () => {
        form.reset();
        recompute();
      },
      'btn btn--ghost',
    ),
    showBtn,
  );

  const presetLabel = (id: string): string => {
    if (BUILTIN_NAMES[id]) return t(BUILTIN_NAMES[id]);
    return data.settings.filterPresets.find((p) => p.id === id)?.name ?? id;
  };
  const reservedNames = () => Object.values(BUILTIN_NAMES).map((k) => t(k));

  function renderPresets() {
    const ids = [...Object.keys(BUILTIN_NAMES), ...data.settings.filterPresets.map((p) => p.id)];
    presetSelect.replaceChildren(...ids.map((id) => h('option', { text: presetLabel(id), attrs: { value: id } })));
    presetSelect.value = data.settings.activePreset;
    const own = !isBuiltinPreset(data.settings.activePreset);
    presetBar.replaceChildren(
      ...nodes(
        h('div', { class: 'preset-bar__current', text: presetLabel(data.settings.activePreset) }),
        presetName,
        h(
          'div',
          { class: 'actions__row' },
          button(t('presetSaveAs'), () => void savePresetAs()),
          own ? button(t('presetRename'), () => void renameActive()) : null,
          own ? button(t('presetDelete'), () => void deleteActive(), 'btn btn--danger-ghost') : null,
        ),
      ),
    );
  }

  function loadPreset(id: string) {
    const f = presetFilter(data.settings, id) ?? presetFilter(data.settings, 'all') ?? {};
    form.write(f);
    textInput.value = f.text ?? '';
  }

  async function saveSettings(partial: Partial<Settings>, okText?: string) {
    const res = await send({ type: 'eds:setSettings', settings: partial });
    if (!res.ok) toast(t('popupNotSaved'), 'error');
    else if (okText) toast(okText, 'ok');
    return res.ok;
  }

  async function savePresetAs() {
    const r = addPreset(data.settings, presetName.value, currentFilter(), reservedNames());
    if (!r.ok) return toast(t(`presetError_${r.error}`), 'error');
    presetName.value = '';
    await saveSettings({ filterPresets: r.settings.filterPresets, activePreset: r.id }, t('presetSaved'));
  }
  async function renameActive() {
    const r = renamePreset(data.settings, data.settings.activePreset, presetName.value, reservedNames());
    if (!r.ok) return toast(t(`presetError_${r.error}`), 'error');
    presetName.value = '';
    await saveSettings({ filterPresets: r.settings.filterPresets });
  }
  async function deleteActive() {
    const r = deletePreset(data.settings, data.settings.activePreset);
    if (!r.ok) return toast(t(`presetError_${r.error}`), 'error');
    loadPreset(r.settings.activePreset);
    await saveSettings({ filterPresets: r.settings.filterPresets, activePreset: r.settings.activePreset });
    recompute();
  }

  presetSelect.addEventListener('change', () => {
    loadPreset(presetSelect.value);
    recompute();
    void saveSettings({ activePreset: presetSelect.value });
  });

  // ---------------------------------------------------------------- results

  const resultsHead = h('div', { class: 'results__head' });
  const list = h('ul', { class: 'list' });
  const more = h('div', { class: 'muted more' });
  const listScroll = h('div', { class: 'list-scroll' }, list, more);
  // Ф13: the empty state is the first thing a new user sees — say what the site is, that an
  // account helps, and the three steps; the welcome page has the long version.
  const outLink = (text: string, href: string, cls = '') =>
    h('a', { class: cls, text, attrs: { href, target: '_blank', rel: 'noopener' } });
  const empty = h(
    'section',
    { class: 'empty' },
    h('h2', { class: 'empty__title', text: t('emptyTitle') }),
    h('p', { class: 'muted', text: t('emptyText') }),
    h(
      'ol',
      { class: 'empty__steps' },
      h('li', { text: t('emptyStepAccount') }),
      h('li', { text: t('emptyStepList') }),
      h('li', { text: t('emptyStepSave') }),
    ),
    h(
      'div',
      { class: 'actions__row' },
      outLink(t('linkRegister'), 'https://www.expireddomains.net/register/', 'btn btn--primary'),
      outLink(t('linkSiteOpen'), 'https://www.expireddomains.net/', 'btn'),
    ),
    // Secondary actions: 301-ui `.link--muted.link--icon`, one per line under a divider.
    h(
      'div',
      { class: 'empty__more' },
      h(
        'a',
        {
          class: 'link link--muted link--icon',
          attrs: { href: browser.runtime.getURL('/welcome.html'), target: '_blank', rel: 'noopener' },
        },
        icon('mono-help-circle'),
        t('welcomeLink'),
      ),
      h(
        'button',
        { class: 'link link--muted link--icon', attrs: { type: 'button' }, on: { click: () => dataDrawer.open() } },
        icon('mono-upload'),
        t('emptyRestore'),
      ),
    ),
  );

  function recompute() {
    const f = currentFilter();
    selection = applyFilter(data.records, f, Date.now());
    textInput.classList.toggle('invalid', selection.textError !== null);
    search.classList.toggle('has-value', textInput.value.length > 0);
    filterHint.replaceChildren();
    if (selection.textError) filterHint.append(h('span', { class: 'error', text: t('filterRegexInvalid') }));
    if (selection.excludedNoData)
      filterHint.append(h('span', { text: t('filterExcludedNoData', String(selection.excludedNoData)) }));
    filterHint.hidden = filterHint.childElementCount === 0;
    const active = form.activeCount();
    filterBadge.textContent = active ? String(active) : '';
    filterBadge.hidden = active === 0;
    filterBtn.classList.toggle('active', active > 0);
    const label = active ? t('filterTitleActive', String(active)) : t('filterTitle');
    filterBtn.title = label;
    filterBtn.setAttribute('aria-label', label);
    showBtn.textContent = t('filterShow', String(selection.domains.length));
    renderResults();
  }

  function renderHead() {
    for (const d of checked) if (!data.records.has(d)) checked.delete(d);
    if (!checked.size && bulkDrawer.isOpen()) bulkDrawer.close();
    const n = selection.domains.length;
    // Ф23: selects the whole filter result, including rows beyond the 500 shown.
    const selectAll =
      n > 0 && selection.domains.some((d) => !checked.has(d))
        ? button(
            t('popupSelectAll', String(n)),
            () => {
              for (const d of selection.domains) checked.add(d);
              renderResults();
            },
            'btn btn--link',
          )
        : null;
    resultsHead.classList.toggle('results__head--bulk', checked.size > 0);
    if (!checked.size) {
      resultsHead.replaceChildren(
        ...nodes(
          h('span', { class: 'results__count', text: t('popupShown', String(n), String(data.records.size)) }),
          selectAll,
        ),
      );
      return;
    }
    resultsHead.replaceChildren(
      ...nodes(
        h('span', { class: 'bulk__count', text: t('bulkSelected', String(checked.size)) }),
        button(t('bulkEdit'), openBulk, 'btn btn--primary btn--sm'),
        selectAll,
        button(
          t('bulkClear'),
          () => {
            checked.clear();
            renderResults();
          },
          'btn btn--link',
        ),
      ),
    );
  }

  function renderResults() {
    renderHead();
    const n = selection.domains.length;
    const shown = selection.domains.slice(0, MAX_ROWS);
    list.replaceChildren(...shown.map((d) => row(d, data.records.get(d) as DomainRecord)));
    more.textContent = n > MAX_ROWS ? t('popupMoreRows', String(n - MAX_ROWS)) : '';
    exportCount.textContent = t('popupExportCount', String(n), String(data.records.size));
    for (const b of exportButtons) b.disabled = n === 0;
  }

  function markActiveRow() {
    for (const li of list.querySelectorAll<HTMLElement>('.row')) {
      li.classList.toggle('row--active', li.dataset.domain === editing);
    }
  }

  function row(domain: string, r: DomainRecord): HTMLLIElement {
    const box = h('input', { attrs: { type: 'checkbox', 'aria-label': domain } });
    box.checked = checked.has(domain);
    const status: Status = r.status ?? 'new';
    // Ф8: the stats snapshot comes from the last list the domain was captured from; the row shows
    // its kind and the zone's flag, the full list name is the row's tooltip. Layout as the 301-ui
    // domains table: the name is the row's identity and wraps inside its column (no ellipsis),
    // the badge column on the right is never pushed; status, tags and note get a second line
    // only when there is one.
    const source = data.meta.sources[r.lastSource] || r.lastSource;
    const kind = listKind(source);
    const zone = zoneOf(domain);
    const extra = [
      status !== 'new' ? statusBadge(status) : null,
      ...rowTags(r.tags ?? []),
      r.note ? h('span', { class: 'row__note', title: r.note }, icon('mono-note')) : null,
    ].filter((x): x is HTMLElement => x !== null);
    const main = h(
      'div',
      { class: 'row__main', title: source, attrs: { role: 'button', tabindex: '0', 'aria-haspopup': 'dialog' } },
      h(
        'span',
        { class: 'row__domain' },
        h('span', { class: 'row__name', text: domain.slice(0, domain.length - zone.length) }),
        zone ? h('span', { class: 'row__zone', text: zone }) : null,
      ),
      h(
        'span',
        { class: 'row__meta' },
        kind ? h('span', { class: 'badge badge--kind', text: t(KIND_LABEL[kind]) }) : null,
        zone ? zoneMark(zone) : null,
      ),
      extra.length ? h('span', { class: 'row__extra' }, ...extra) : null,
    );
    const li = h('li', { class: 'row', attrs: { 'data-domain': domain } }, box, main);
    li.classList.toggle('row--selected', box.checked);
    li.classList.toggle('row--active', editing === domain);
    box.addEventListener('change', () => {
      if (box.checked) checked.add(domain);
      else checked.delete(domain);
      li.classList.toggle('row--selected', box.checked);
      renderHead();
    });
    main.addEventListener('click', () => openEditor(domain));
    main.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
        e.preventDefault();
        openEditor(domain);
      }
    });
    return li;
  }

  // ---------------------------------------------------------------- row editor drawer (Ф20–Ф22)

  function openEditor(domain: string) {
    const r = data.records.get(domain);
    if (!r) return;
    editing = domain;
    editDrawer.setTitle(domain);
    const status = statusSelect(r.status ?? 'new');
    const tags = h('input', { attrs: { type: 'text', list: 'eds-tags', value: (r.tags ?? []).join(', ') } });
    const note = h('textarea', { attrs: { rows: '4' } });
    note.value = r.note ?? '';
    const deleteBox = confirmBox();
    const save = async () => {
      const parsed = parseTagList(tags.value);
      if (parsed.invalid.length) return toast(t('tagInvalid', parsed.invalid[0]), 'error');
      if (codePointLength(note.value) > MAX_NOTE_LENGTH) return toast(t('noteTooLong'), 'error');
      const current = data.records.get(domain)?.tags ?? [];
      const keep = new Set(parsed.tags.map(tagKey));
      const patch: Patch = {
        status: status.value as Status,
        note: note.value,
        removeTags: current.filter((x) => !keep.has(tagKey(x))),
        addTags: parsed.tags,
      };
      const res = await send({ type: 'eds:update', domains: [domain], patch });
      if (!res.ok) return toast(t('popupNotSaved'), 'error');
      if (res.result.overflow) toast(t('tagsOverflow', String(res.result.overflow)), 'error');
      editDrawer.close();
    };
    editDrawer.body.replaceChildren(
      h(
        'div',
        { class: 'editor' },
        h('div', { class: 'muted', text: data.meta.sources[r.lastSource] || r.lastSource }),
        field('editorStatus', status),
        field('editorTags', tags),
        field('editorNote', note),
        deleteBox,
      ),
    );
    editDrawer.footer.replaceChildren(
      button(t('editorSave'), () => void save(), 'btn btn--primary'),
      button(t('editorCancel'), () => editDrawer.close(), 'btn btn--ghost'),
      // Ф15а; the drawer closes by itself once the record is gone (reload).
      button(t('editorDelete'), () => askDelete(deleteBox, [domain]), 'btn btn--danger-ghost editor__delete'),
    );
    editDrawer.open();
    markActiveRow();
  }

  // ---------------------------------------------------------------- bulk drawer (Ф23)

  function openBulk() {
    bulkDrawer.setTitle(t('bulkSelected', String(checked.size)));
    const status = statusSelect();
    const tag = h('input', {
      attrs: { type: 'text', list: 'eds-tags', placeholder: t('bulkTagPlaceholder'), 'aria-label': t('editorTags') },
    });
    const run = async (patch: Patch) => {
      const res = await send({ type: 'eds:update', domains: [...checked], patch });
      if (!res.ok) return toast(t('popupNotSaved'), 'error');
      toast(
        res.result.overflow
          ? t('tagsOverflow', String(res.result.overflow))
          : t('bulkDone', String(res.result.changed)),
        res.result.overflow ? 'error' : 'ok',
      );
    };
    const tagPatch = (kind: 'addTags' | 'removeTags') => {
      const parsed = parseTagList(tag.value);
      if (parsed.invalid.length || !parsed.tags.length) return toast(t('tagInvalid', tag.value.trim()), 'error');
      void run({ [kind]: parsed.tags });
    };
    const deleteBox = confirmBox();
    bulkDrawer.body.replaceChildren(
      h(
        'div',
        { class: 'bulk' },
        group(
          'editorStatus',
          h(
            'div',
            { class: 'inline-form' },
            status,
            button(t('bulkSetStatus'), () => void run({ status: status.value as Status })),
          ),
        ),
        group(
          'filterGroupTags',
          h(
            'div',
            { class: 'inline-form' },
            tag,
            button(t('bulkAddTag'), () => tagPatch('addTags')),
            button(t('bulkRemoveTag'), () => tagPatch('removeTags')),
          ),
        ),
        group(
          'bulkDeleteLegend',
          h(
            'div',
            { class: 'actions__row' },
            button(
              t('bulkDelete', String(checked.size)),
              () =>
                askDelete(deleteBox, [...checked], () => {
                  checked.clear();
                  bulkDrawer.close();
                  renderResults();
                }),
              'btn btn--danger-ghost',
            ),
          ),
          deleteBox,
        ),
      ),
    );
    bulkDrawer.footer.replaceChildren(
      button(
        t('bulkClear'),
        () => {
          checked.clear();
          bulkDrawer.close();
          renderResults();
        },
        'btn btn--ghost',
      ),
    );
    bulkDrawer.open();
  }

  // ---------------------------------------------------------------- export bar (Ф14, Ф17–Ф19)

  const exportCount = h('span', { class: 'exportbar__count' });
  const selectedRecords = (): [string, DomainRecord][] =>
    selection.domains.map((d) => [d, data.records.get(d) as DomainRecord]);
  const exportButtons = [
    button(
      t('exportCopy'),
      async () => {
        try {
          await navigator.clipboard.writeText(selection.domains.join('\n'));
          toast(t('exportCopied', String(selection.domains.length)), 'ok');
        } catch {
          toast(t('exportCopyFailed'), 'error');
        }
      },
      'btn btn--primary btn--sm',
    ),
    button(
      'CSV',
      () => downloadText(exportFileName('csv', new Date()), toCsv(selectedRecords(), data.meta), 'text/csv'),
      'btn btn--sm',
    ),
    button(
      'TXT',
      () => downloadText(exportFileName('txt', new Date()), toTxt(selection.domains), 'text/plain'),
      'btn btn--sm',
    ),
  ];
  const exportBar = h(
    'section',
    { class: 'exportbar' },
    exportCount,
    h('div', { class: 'exportbar__actions' }, ...exportButtons),
  );

  // ---------------------------------------------------------------- data drawer: tags, backup, restore, clear

  const tagsSection = h('div', { class: 'tag-chips' });
  const tagsGroup = group('filterGroupTags', tagsSection);
  let tagToDelete: string | null = null;
  function renderTags() {
    const tags = tagCounts(data.records.values());
    tagsDatalist.replaceChildren(...tags.map((x) => h('option', { attrs: { value: x.tag } })));
    tagsGroup.hidden = tags.length === 0;
    tagsSection.replaceChildren(
      ...tags.map((x) => {
        const confirming = tagToDelete !== null && tagKey(tagToDelete) === tagKey(x.tag);
        return h(
          'span',
          { class: confirming ? 'tag-chip tag-chip--confirm' : 'tag-chip' },
          h('span', { text: `${x.tag} · ${x.count}` }),
          confirming
            ? button(t('tagDeleteConfirm'), () => void deleteTag(x.tag), 'tag-chip__btn tag-chip__btn--danger')
            : iconButton(
                'mono-close',
                t('tagDelete', x.tag),
                () => {
                  tagToDelete = x.tag;
                  renderTags();
                },
                'tag-chip__btn',
              ),
        );
      }),
    );
  }
  async function deleteTag(tag: string) {
    tagToDelete = null;
    const res = await send({
      type: 'eds:update',
      domains: domainsWithTag(data.records, tag),
      patch: { removeTags: [tag] },
    });
    toast(res.ok ? t('tagDeleted', tag) : t('popupNotSaved'), res.ok ? 'ok' : 'error');
  }

  const backup = () =>
    downloadText(exportFileName('backup', new Date()), makeBackup(stateOf(data), new Date()), 'application/json');

  /**
   * Inline confirmation inside a drawer for every deletion (Ф15, Ф15а): the question, the notes,
   * the danger button, "Save a backup first" and Cancel.
   */
  function showConfirm(box: HTMLElement, lines: string[], confirmLabel: string, run: () => Promise<void>) {
    box.hidden = false;
    box.replaceChildren(
      ...lines.map((text, i) => h('p', { class: i ? 'muted' : undefined, text })),
      h(
        'div',
        { class: 'actions__row' },
        button(
          confirmLabel,
          async () => {
            box.hidden = true;
            await run();
          },
          'btn btn--danger',
        ),
        button(t('clearBackupFirst'), backup),
        button(
          t('editorCancel'),
          () => {
            box.hidden = true;
          },
          'btn btn--link',
        ),
      ),
    );
  }
  const confirmBox = () => {
    const box = h('div', { class: 'confirm' });
    box.hidden = true;
    return box;
  };

  const clearBox = confirmBox();
  function showClearConfirm() {
    const n = String(data.records.size);
    showConfirm(clearBox, [t('clearQuestion', n), t('clearWarning')], t('clearConfirm', n), async () => {
      if (String(data.records.size) !== n) return showClearConfirm(); // the count changed meanwhile
      const res = await send({ type: 'eds:clear' });
      toast(res.ok ? t('clearDone') : t('popupNotSaved'), res.ok ? 'ok' : 'error');
    });
  }

  /** Ф15а: delete the given domains after the inline confirmation in `box`. */
  function askDelete(box: HTMLElement, domains: string[], after: () => void = () => {}) {
    const n = String(domains.length);
    const question = domains.length === 1 ? t('deleteOneQuestion', domains[0]) : t('deleteQuestion', n);
    showConfirm(box, [question, t('deleteWarning')], t('clearConfirm', n), async () => {
      const res = await send({ type: 'eds:delete', domains });
      if (!res.ok) return toast(t('popupNotSaved'), 'error');
      toast(t('deleteDone', String(res.result.deleted)), 'ok');
      after();
    });
  }

  // Ф15а: one site list at a time; a domain also captured from other lists stays.
  const listsSection = h('div', { class: 'data-lists' });
  const listsBox = confirmBox();
  const listsGroup = group('dataListsLegend', listsSection, listsBox);
  function renderDataLists() {
    const lists = listBreakdown(data);
    listsGroup.hidden = lists.length === 0;
    listsSection.replaceChildren(
      ...lists.map((l) => {
        const clear = button(
          t('listClear'),
          () => askClearList(l.sourceId, l.label),
          'btn btn--sm btn--danger-ghost',
          t('listClearLabel', l.label),
        );
        // Every row's button says "Clear": the accessible name carries the list.
        clear.setAttribute('aria-label', t('listClearLabel', l.label));
        return h(
          'div',
          { class: 'data-list' },
          h('span', { class: 'data-list__name', text: l.label, title: l.label }),
          h('span', { class: 'data-list__count', text: String(l.count) }),
          clear,
        );
      }),
    );
  }
  function listCounts(sourceId: string): [only: number, shared: number] {
    let only = 0;
    let shared = 0;
    for (const r of data.records.values()) {
      if (!r.lists.includes(sourceId)) continue;
      if (r.lists.length === 1) only++;
      else shared++;
    }
    return [only, shared];
  }
  function askClearList(sourceId: string, label: string) {
    const [only, shared] = listCounts(sourceId);
    const lines = [t('listClearQuestion', label, String(only))];
    if (shared) lines.push(t('listClearKept', String(shared)));
    lines.push(t('deleteWarning'));
    showConfirm(listsBox, lines, t('listClearConfirm'), async () => {
      // Auto-capture in another tab may have changed the list while the question was open:
      // never delete more than was announced — ask again with the new numbers.
      const [nowOnly, nowShared] = listCounts(sourceId);
      if (nowOnly !== only || nowShared !== shared) return askClearList(sourceId, label);
      const res = await send({ type: 'eds:clearList', sourceId });
      if (!res.ok) return toast(t('popupNotSaved'), 'error');
      toast(t('listClearDone', String(res.result.deleted), String(res.result.kept)), 'ok');
    });
  }

  const restoreBox = h('div', { class: 'restore' });
  function renderRestore() {
    const input = h('input', {
      class: 'visually-hidden',
      attrs: { type: 'file', accept: '.json,application/json', id: 'eds-restore-file' },
    });
    const pick = h('label', { class: 'btn', text: t('restoreChoose'), attrs: { for: 'eds-restore-file' } });
    const info = h('div', { class: 'restore__info' });
    restoreBox.replaceChildren(pick, input, info);
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      if (file.size > 50 * 1024 * 1024) return showRestoreError(info, 'size');
      const text = await file.text();
      const parsed = parseBackup(text);
      if (!parsed.ok) return showRestoreError(info, `${parsed.error.code} ${parsed.error.path}`.trim());
      const count = Object.keys(parsed.backup.records).length;
      let replaceArmed = false;
      const doRestore = async (mode: 'merge' | 'replace') => {
        const res = await send({ type: 'eds:restore', text, mode });
        if (!res.ok) return showRestoreError(info, res.error);
        info.replaceChildren(
          h(
            'p',
            { class: 'ok' },
            t(
              'restoreDone',
              String(res.result.total),
              String(res.result.tagsOverflow),
              String(res.result.presetsSkipped),
            ),
          ),
        );
      };
      const replaceBtn = button(t('restoreReplace'), () => {
        if (!replaceArmed) {
          replaceArmed = true;
          replaceBtn.textContent = t('restoreReplaceConfirm', String(data.records.size));
          replaceBtn.className = 'btn btn--danger';
          return;
        }
        void doRestore('replace');
      });
      info.replaceChildren(
        h('p', { text: t('restoreFileInfo', file.name, String(count), parsed.backup.exportedAt) }),
        h(
          'div',
          { class: 'actions__row' },
          button(t('restoreMerge'), () => void doRestore('merge'), 'btn btn--primary'),
          replaceBtn,
        ),
      );
    });
  }
  function showRestoreError(info: HTMLElement, detail: string) {
    info.replaceChildren(h('p', { class: 'error', text: t('restoreInvalid', detail) }));
  }

  const clearGroup = group(
    'dataClearLegend',
    h('div', { class: 'actions__row' }, button(t('clearAll'), showClearConfirm, 'btn btn--danger-ghost')),
    clearBox,
  );
  dataDrawer.body.append(
    tagsGroup,
    group('dataBackupLegend', h('div', { class: 'actions__row' }, button(t('backupDownload'), backup)), restoreBox),
    listsGroup,
    clearGroup,
  );

  // ---------------------------------------------------------------- toast, footer

  const toastEl = h('div', { class: 'toast', attrs: { role: 'status', 'aria-live': 'polite' } });
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  function toast(text: string, kind: 'ok' | 'error') {
    toastEl.textContent = text;
    toastEl.dataset.kind = kind;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.hidden = true;
    }, 4000);
  }
  toastEl.hidden = true;

  // Icon links, as in the other 301.st extensions: label in title + aria-label.
  const link = (id: IconId, label: string, href: string) =>
    h(
      'a',
      { title: label, attrs: { href, target: '_blank', rel: 'noopener', 'aria-label': label } },
      icon(id, 'footer__icon'),
    );
  const sep = () => h('span', { class: 'footer__sep', attrs: { 'aria-hidden': 'true' } });
  const footer = h(
    'footer',
    { class: 'footer' },
    link('mono-help-circle', t('welcomeLink'), browser.runtime.getURL('/welcome.html')),
    sep(),
    link(STORE_ICON, t('footerRate'), storeReviewUrl()),
    link('brand-github', t('footerIssues'), REPO_ISSUES),
    sep(),
    link('brand-301', '301.st', 'https://301.st/?utm_source=expired-domains&utm_medium=extension&utm_campaign=footer'),
    link('brand-telegram', t('footerSupport'), SUPPORT_CHAT),
  );

  // ---------------------------------------------------------------- data loading (Ф11, Ф16)

  const body = h('main', { class: 'body' });
  root.replaceChildren(
    header,
    body,
    footer,
    filterDrawer.element,
    editDrawer.element,
    bulkDrawer.element,
    dataDrawer.element,
    toastEl,
  );

  const renderLists = () => form.setLists(listBreakdown(data));

  function renderAll() {
    renderPresets();
    renderLists();
    renderTags();
    renderDataLists();
    const hasData = data.records.size > 0;
    clearGroup.hidden = !hasData;
    body.replaceChildren(...(hasData ? [toolbar, resultsHead, listScroll, exportBar] : [empty]));
    renderRestore();
    recompute();
  }

  const filterKey = (settings: Settings, id: string) => JSON.stringify(presetFilter(settings, id));

  async function reload() {
    const prev = data.settings;
    data = readData(await browser.storage.local.get(null));
    renderPresets();
    renderLists(); // rebuilds the list chips before a preset is loaded into the form
    renderTags();
    renderDataLists();
    // Reload the form when the active preset changed or its stored filter changed (restore).
    const id = data.settings.activePreset;
    if (id !== prev.activePreset || filterKey(prev, id) !== filterKey(data.settings, id)) loadPreset(id);
    if (editing && !data.records.has(editing)) editDrawer.close();
    const hasData = data.records.size > 0;
    clearGroup.hidden = !hasData;
    if (hasData !== body.contains(toolbar)) renderAll();
    else recompute();
  }

  // Subscribe before the first read, so a change committed in between is not lost (Ф16); a
  // change arriving early just causes one more re-read after the first load.
  let markLoaded: () => void = () => undefined;
  const loaded = new Promise<void>((r) => {
    markLoaded = r;
  });
  watchMeta(
    (listener) => {
      const l = listener as Parameters<typeof browser.storage.onChanged.addListener>[0];
      browser.storage.onChanged.addListener(l);
      return () => browser.storage.onChanged.removeListener(l);
    },
    async () => {
      await loaded;
      await reload();
    },
  );

  // Ф11: reconcile before reading; if that fails, show nothing rather than a half-written state.
  const ready = await send({ type: 'eds:ensureReady' });
  if (!ready.ok) {
    body.replaceChildren(h('section', { class: 'empty' }, h('p', { class: 'error', text: t('popupNotReady') })));
    return;
  }
  data = readData(await browser.storage.local.get(null));
  renderPresets();
  renderLists();
  loadPreset(data.settings.activePreset);
  renderAll();
  markLoaded();
}
