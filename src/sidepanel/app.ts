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
import { tagKey } from '@/shared/tags';
import { type DomainRecord, type Filter, type Patch, type Settings, STATUSES, type Status } from '@/shared/types';
import { button, downloadText, h, icon, iconButton, logo301, nodes } from './dom';
import { createDrawer } from './drawer';
import { createFilterForm, statusLabel } from './filter-form';
import { type Data, domainsWithTag, listBreakdown, parseTagList, readData, stateOf, tagCounts } from './model';
import { applyTheme, cycleTheme, getThemePreference } from './theme';

const MAX_ROWS = 500;
const BUILTIN_NAMES: Record<string, string> = {
  all: 'presetAll',
  'working-drops': 'presetWorkingDrops',
  'working-auctions': 'presetWorkingAuctions',
};
const REPO_ISSUES = 'https://github.com/investblog/expired-domains/issues';

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
const statusSelect = (value: Status = 'new') => {
  const s = h('select', {}, ...STATUSES.map((x) => h('option', { text: statusLabel(t, x), attrs: { value: x } })));
  s.value = value;
  return s;
};

export async function startApp(root: HTMLElement): Promise<void> {
  document.documentElement.lang = browser.i18n.getUILanguage().startsWith('ru') ? 'ru' : 'en';
  document.title = t('extName');
  applyTheme(getThemePreference());

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

  const themeBtn = iconButton('auto', t('popupTheme'), () => {
    const pref = cycleTheme();
    themeBtn.replaceChildren(icon(pref === 'light' ? 'sun' : pref === 'dark' ? 'moon' : 'auto'));
  });
  themeBtn.replaceChildren(
    icon(getThemePreference() === 'light' ? 'sun' : getThemePreference() === 'dark' ? 'moon' : 'auto'),
  );

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
      logo301(),
    ),
    h('h1', { class: 'title', text: t('extName') }),
    h(
      'div',
      { class: 'header__actions' },
      iconButton('database', t('dataTitle'), () => dataDrawer.open()),
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
  const searchIcon = icon('search');
  searchIcon.classList.add('search__icon');
  const search = h(
    'div',
    { class: 'search' },
    searchIcon,
    textInput,
    iconButton(
      'close',
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
    icon('sliders'),
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
    h(
      'div',
      { class: 'actions__row empty__more' },
      outLink(t('welcomeLink'), browser.runtime.getURL('/welcome.html'), 'btn btn--link'),
      button(t('emptyRestore'), () => dataDrawer.open(), 'btn btn--link'),
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
    const main = h(
      'div',
      { class: 'row__main', attrs: { role: 'button', tabindex: '0', 'aria-haspopup': 'dialog' } },
      h(
        'div',
        { class: 'row__line' },
        h('span', { class: 'row__domain', text: domain }),
        status !== 'new' ? h('span', { class: `badge badge--${status}`, text: statusLabel(t, status) }) : null,
        ...(r.tags ?? []).map((x) => h('span', { class: 'tag', text: x })),
        r.note ? h('span', { class: 'row__note', title: r.note }, icon('note')) : null,
      ),
      // Ф8: the stats snapshot comes from the last list the domain was captured from.
      h('div', { class: 'row__sub', text: data.meta.sources[r.lastSource] || r.lastSource }),
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
      ),
    );
    editDrawer.footer.replaceChildren(
      button(t('editorSave'), () => void save(), 'btn btn--primary'),
      button(t('editorCancel'), () => editDrawer.close(), 'btn btn--ghost'),
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
                'close',
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

  const clearBox = h('div', { class: 'confirm' });
  clearBox.hidden = true;
  function showClearConfirm() {
    clearBox.hidden = false;
    clearBox.replaceChildren(
      h('p', { text: t('clearQuestion', String(data.records.size)) }),
      h('p', { class: 'muted', text: t('clearWarning') }),
      h(
        'div',
        { class: 'actions__row' },
        button(
          t('clearConfirm', String(data.records.size)),
          async () => {
            const res = await send({ type: 'eds:clear' });
            clearBox.hidden = true;
            toast(res.ok ? t('clearDone') : t('popupNotSaved'), res.ok ? 'ok' : 'error');
          },
          'btn btn--danger',
        ),
        button(t('clearBackupFirst'), backup),
        button(
          t('editorCancel'),
          () => {
            clearBox.hidden = true;
          },
          'btn btn--link',
        ),
      ),
    );
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

  const link = (text: string, href: string) => h('a', { text, attrs: { href, target: '_blank', rel: 'noopener' } });
  const footer = h(
    'footer',
    { class: 'footer' },
    link(t('welcomeLink'), browser.runtime.getURL('/welcome.html')),
    link(t('footerRate'), storeReviewUrl()),
    link('301.st', 'https://301.st/?utm_source=expired-domains&utm_medium=extension&utm_campaign=footer'),
    link(t('footerIssues'), REPO_ISSUES),
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
