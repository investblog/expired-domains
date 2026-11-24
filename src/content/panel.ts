// On-page panel (SPEC Ф1–Ф4, С1, С2, С4, Е2, Е3). Reads only `#listing` and page metadata
// (I6), never clicks, focuses or scrolls site elements (I2), never navigates (I3).
// Dependencies are injected so the panel runs in tests without the extension runtime.

import type { AddResult } from '@/background/store';
import { inlineIcon } from '@/shared/icons';
import type { Response } from '@/shared/messages';
import { type ParseResult, parseListing } from '@/shared/parse';
import { pageMarkSettings } from '@/shared/presets';
import type { Capture } from '@/shared/records';
import type { Source } from '@/shared/source';
import type { PageMode, TabSaveResult } from '@/shared/tab-messages';
import type { Settings } from '@/shared/types';
import type { MarkSwitches } from './marks';
import { PANEL_CSS } from './panel-css';

export const PANEL_HOST_ID = 'expired-domains-panel-301st';
/** Below this window width the panel starts collapsed (Ф3). */
export const NARROW_WIDTH = 1000;
/** Length of the launcher sweep after new domains were added (Ф3а); matches panel-css.ts. */
export const SHIMMER_MS = 1200;

export interface PanelDeps {
  doc: Document;
  source: Source;
  settings: Pick<Settings, 'autoCapture' | 'panelCollapsed'> & Partial<MarkSwitches>;
  windowWidth: number;
  t: (key: string, ...subs: string[]) => string;
  add: (capture: Capture) => Promise<Response<AddResult>>;
  setSettings: (partial: Partial<Settings>) => Promise<Response<unknown>>;
  /** True once the extension was reloaded under this page (Е3). */
  contextInvalidated: () => boolean;
}

export interface PanelHandle {
  host: HTMLElement;
  /** Shadow root reference for tests; the root itself is closed. */
  root: ShadowRoot;
  /** Resolves when the automatic capture (if any) has finished. */
  autoDone: Promise<void>;
  /** The table as it is now: mode and row count (Ф13в, asked by the side panel). */
  state: () => { mode: PageMode; rows: number };
  /** The "Save page" button's own path, for the side panel's button (Ф13в). */
  save: () => Promise<TabSaveResult>;
  /** Follow an auto-capture change made in the side panel. */
  setAutoCapture: (on: boolean) => void;
  /** Follow the page-mark switches changed in the side panel (Ф32). */
  setMarkSwitches: (switches: MarkSwitches) => void;
  /** Ф30: save one row of this page, re-read now, with the same columns as "Save page". */
  saveRow: (domain: string) => Promise<boolean>;
  /** Show that a page-mark action was not stored (Ф30). */
  failed: () => void;
}

/** Host element styles, applied inline with `!important` (`all` first, longhands after it). */
export const HOST_STYLE: [string, string][] = [
  ['all', 'initial'],
  ['display', 'block'],
  ['position', 'fixed'],
  ['top', '64px'],
  ['right', '12px'],
  ['left', 'auto'],
  ['bottom', 'auto'],
  ['z-index', '2147483647'],
  ['width', 'auto'],
  ['height', 'auto'],
  ['margin', '0'],
  ['padding', '0'],
  ['border', '0'],
  ['transform', 'none'],
  ['opacity', '1'],
  ['visibility', 'visible'],
  ['pointer-events', 'auto'],
  // No paint containment: it clips the button's and the panel's shadow to the host box.
  ['contain', 'layout style'],
  ['font', '13px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'],
  ['color-scheme', 'light dark'],
  ['color', 'var(--text)'],
];

function modeOf(result: ParseResult): PageMode {
  switch (result.diagnostics.code) {
    case 'ok':
      return 'ready';
    case 'no_rows':
      return 'empty';
    default:
      return 'broken';
  }
}

/** Mount the panel, or return null on pages without `#listing` (Ф1, Е2). */
export function mountPanel(deps: PanelDeps): PanelHandle | null {
  const { doc, t } = deps;
  if (!doc.querySelector('#listing') || doc.getElementById(PANEL_HOST_ID)) return null;

  const initial = parseListing(doc);
  const host = doc.createElement('div');
  host.id = PANEL_HOST_ID;
  // Shadow DOM protects the descendants, not the host: page styles still match the host
  // element. Inline `!important` declarations win over any author stylesheet, `!important`
  // included (Ф3, A8 hostile-style check).
  for (const [prop, value] of HOST_STYLE) host.style.setProperty(prop, value, 'important');
  const root = host.attachShadow({ mode: 'closed' });
  const style = doc.createElement('style');
  style.textContent = PANEL_CSS;
  root.append(style);

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  // Collapsed icon.
  const collapsedBtn = el('button', 'collapsed');
  collapsedBtn.type = 'button';
  collapsedBtn.append(inlineIcon(doc, 'list'));
  // Ф3а: while auto-capture is on the launcher is filled and says so, so a collapsed panel does
  // not hide the mode. Both labels are read now, while the extension context is alive.
  const LAUNCHER_LABEL = `${t('extName')} — ${t('panelExpand')}`;
  const LAUNCHER_AUTO_LABEL = `${t('extName')} — ${t('panelAutoOn')} — ${t('panelExpand')}`;
  let autoOn = deps.settings.autoCapture;
  const showAutoMode = (on: boolean) => {
    autoOn = on;
    collapsedBtn.classList.toggle('collapsed--auto', on);
    collapsedBtn.title = on ? LAUNCHER_AUTO_LABEL : LAUNCHER_LABEL;
    collapsedBtn.setAttribute('aria-label', collapsedBtn.title);
  };
  showAutoMode(autoOn);

  // Expanded panel.
  const panel = el('div', 'panel');
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', t('extName'));
  const head = el('div', 'head');
  const title = el('div', 'title', t('extName'));
  const collapseBtn = el('button', 'icon-btn');
  collapseBtn.type = 'button';
  collapseBtn.append(inlineIcon(doc, 'minus'));
  collapseBtn.title = t('panelCollapse');
  collapseBtn.setAttribute('aria-label', collapseBtn.title);
  head.append(title, collapseBtn);

  const warning = el('div', 'warning');
  const info = el('div', 'info');
  const save = el('button', 'save', t('panelSave'));
  save.type = 'button';
  const auto = el('label', 'auto');
  const autoBox = el('input');
  autoBox.type = 'checkbox';
  autoBox.checked = deps.settings.autoCapture;
  auto.append(autoBox, el('span', undefined, t('panelAutoCapture')));
  // Ф32: the page-mark switches; the change reaches the marks through storage, like the side panel's.
  const switchBox = (key: keyof MarkSwitches, label: string) => {
    const row = el('label', 'auto');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = pageMarkSettings(deps.settings)[key];
    row.append(box, el('span', undefined, label));
    box.addEventListener('change', async () => {
      const wanted = box.checked;
      if (!(await storeSetting({ [key]: wanted }))) box.checked = !wanted;
    });
    return { row, box };
  };
  const marksSwitch = switchBox('pageMarks', t('panelPageMarks'));
  const dimSwitch = switchBox('dimRejected', t('panelDimRejected'));
  const status = el('div', 'status');
  status.setAttribute('role', 'status');
  panel.append(head, warning, info, save, auto, marksSwitch.row, dimSwitch.row, status);
  root.append(collapsedBtn, panel);

  // Read while the extension is alive: after it is reloaded or updated, this orphaned script's
  // i18n.getMessage throws "Extension context invalidated", and these are the texts shown then.
  const RELOAD = t('panelReload');
  const NOT_SAVED = t('panelNotSaved');
  const failText = () => (deps.contextInvalidated() ? RELOAD : NOT_SAVED);

  const setStatus = (text: string, kind: 'ok' | 'error' | '' = '') => {
    status.textContent = text;
    status.dataset.kind = kind;
  };

  function render(result: ParseResult) {
    const mode = modeOf(result);
    const parts = [t('panelOnPage', String(result.rows.length))];
    if (result.pager) parts.push(t('panelPage', String(result.pager.page), String(result.pager.pages)));
    info.textContent = parts.join(' · ');
    warning.hidden = mode === 'ready';
    warning.textContent = mode === 'empty' ? t('panelEmpty') : mode === 'broken' ? t('panelLayoutUnknown') : '';
    save.disabled = mode !== 'ready';
  }

  let collapsed = deps.settings.panelCollapsed || deps.windowWidth < NARROW_WIDTH;
  const applyCollapsed = () => {
    panel.hidden = collapsed;
    collapsedBtn.hidden = !collapsed;
  };

  /**
   * Ф3а: in auto-capture mode, a capture that added new domains (never for 0 new) sends one sweep
   * across the control on screen — the launcher when collapsed, "Save page" when expanded.
   */
  let shimmerTimer: ReturnType<typeof setTimeout> | undefined;
  const shimmer = () => {
    const targets = [collapsedBtn, save];
    for (const x of targets) x.classList.add('shimmer');
    clearTimeout(shimmerTimer);
    shimmerTimer = setTimeout(() => {
      for (const x of targets) x.classList.remove('shimmer');
    }, SHIMMER_MS);
  };

  let busy = false;
  async function capture(): Promise<TabSaveResult> {
    if (busy) return { ok: false, error: 'busy' };
    if (deps.contextInvalidated()) {
      setStatus(RELOAD, 'error');
      return { ok: false, error: 'reload' };
    }
    // С2: the table is re-read at the moment of saving.
    const result = parseListing(doc);
    render(result);
    if (modeOf(result) !== 'ready') return { ok: false, error: modeOf(result) };
    busy = true;
    save.disabled = true;
    setStatus(t('panelSaving'));
    try {
      const res = await deps.add({
        sourceId: deps.source.sourceId,
        sourceLabel: deps.source.sourceLabel,
        columns: result.columns,
        rows: result.rows,
      });
      if (res.ok) {
        const { added, updated, total } = res.result;
        setStatus(t('panelSaved', String(added), String(updated), String(total)), 'ok');
        if (autoOn && added > 0) shimmer();
      } else {
        setStatus(failText(), 'error');
      }
      return res;
    } finally {
      busy = false;
      save.disabled = false;
    }
  }

  save.addEventListener('click', () => void capture());
  /** A setting that was not stored is reported, never shown as applied (Ф11 "Отправитель"). */
  async function storeSetting(partial: Partial<Settings>): Promise<boolean> {
    const res = await deps.setSettings(partial).catch((): Response<unknown> => ({ ok: false, error: 'closed' }));
    if (res.ok) return true;
    setStatus(failText(), 'error');
    return false;
  }
  autoBox.addEventListener('change', async () => {
    // Applies from the next page the user opens (С2); this page is saved with the button.
    const wanted = autoBox.checked;
    if (await storeSetting({ autoCapture: wanted })) showAutoMode(wanted);
    else autoBox.checked = !wanted;
  });
  const toggle = (value: boolean) => {
    collapsed = value;
    applyCollapsed();
    // The panel still collapses on this page; if the choice was not stored, the status says so.
    void storeSetting({ panelCollapsed: value });
  };
  collapseBtn.addEventListener('click', () => toggle(true));
  collapsedBtn.addEventListener('click', () => toggle(false));

  render(initial);
  applyCollapsed();
  doc.body.append(host);

  const autoDone =
    deps.settings.autoCapture && modeOf(initial) === 'ready' ? capture().then(() => undefined) : Promise.resolve();
  const state = () => {
    const now = parseListing(doc);
    return { mode: modeOf(now), rows: now.rows.length };
  };
  const setAutoCapture = (on: boolean) => {
    autoBox.checked = on;
    showAutoMode(on);
  };
  const setMarkSwitches = (s: MarkSwitches) => {
    marksSwitch.box.checked = s.pageMarks;
    dimSwitch.box.checked = s.dimRejected;
  };
  async function saveRow(domain: string): Promise<boolean> {
    if (deps.contextInvalidated()) return false;
    // С2: the row is read at the moment of saving, from a table the parser accepts.
    const result = parseListing(doc);
    const row = result.rows.find((r) => r.domain === domain);
    if (modeOf(result) !== 'ready' || !row) return false;
    const res = await deps.add({
      sourceId: deps.source.sourceId,
      sourceLabel: deps.source.sourceLabel,
      columns: result.columns,
      rows: [row],
    });
    return res.ok;
  }
  const failed = () => setStatus(failText(), 'error');
  return { host, root, autoDone, state, save: capture, setAutoCapture, setMarkSwitches, saveRow, failed };
}
