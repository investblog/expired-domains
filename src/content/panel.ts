// On-page panel (SPEC Ф1–Ф4, С1, С2, С4, Е2, Е3). Reads only `#listing` and page metadata
// (I6), never clicks, focuses or scrolls site elements (I2), never navigates (I3).
// Dependencies are injected so the panel runs in tests without the extension runtime.

import type { AddResult } from '@/background/store';
import type { Response } from '@/shared/messages';
import { type ParseResult, parseListing } from '@/shared/parse';
import type { Capture } from '@/shared/records';
import type { Source } from '@/shared/source';
import { type SvgShape, svgIcon } from '@/shared/svg';
import type { Settings } from '@/shared/types';
import { PANEL_CSS } from './panel-css';

export const PANEL_HOST_ID = 'expired-domains-panel-301st';
/** Below this window width the panel starts collapsed (Ф3). */
export const NARROW_WIDTH = 1000;

export interface PanelDeps {
  doc: Document;
  source: Source;
  settings: Pick<Settings, 'autoCapture' | 'panelCollapsed'>;
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
}
const ICON_LIST: SvgShape[] = [['path', { d: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01' }]];
const ICON_MINUS: SvgShape[] = [['path', { d: 'M5 12h14' }]];

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
  ['contain', 'content'],
  ['font', '13px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'],
  ['color-scheme', 'light dark'],
  ['color', 'var(--text)'],
];

type Mode = 'ready' | 'empty' | 'broken';

function modeOf(result: ParseResult): Mode {
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
  collapsedBtn.append(svgIcon(doc, ICON_LIST, undefined, ''));
  collapsedBtn.title = `${t('extName')} — ${t('panelExpand')}`;
  collapsedBtn.setAttribute('aria-label', collapsedBtn.title);

  // Expanded panel.
  const panel = el('div', 'panel');
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', t('extName'));
  const head = el('div', 'head');
  const title = el('div', 'title', t('extName'));
  const collapseBtn = el('button', 'icon-btn');
  collapseBtn.type = 'button';
  collapseBtn.append(svgIcon(doc, ICON_MINUS, undefined, ''));
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
  const status = el('div', 'status');
  status.setAttribute('role', 'status');
  panel.append(head, warning, info, save, auto, status);
  root.append(collapsedBtn, panel);

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

  let busy = false;
  async function capture(): Promise<void> {
    if (busy) return;
    if (deps.contextInvalidated()) {
      setStatus(t('panelReload'), 'error');
      return;
    }
    // С2: the table is re-read at the moment of saving.
    const result = parseListing(doc);
    render(result);
    if (modeOf(result) !== 'ready') return;
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
      } else {
        setStatus(deps.contextInvalidated() ? t('panelReload') : t('panelNotSaved'), 'error');
      }
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
    setStatus(deps.contextInvalidated() ? t('panelReload') : t('panelNotSaved'), 'error');
    return false;
  }
  autoBox.addEventListener('change', async () => {
    // Applies from the next page the user opens (С2); this page is saved with the button.
    const wanted = autoBox.checked;
    if (!(await storeSetting({ autoCapture: wanted }))) autoBox.checked = !wanted;
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

  const autoDone = deps.settings.autoCapture && modeOf(initial) === 'ready' ? capture() : Promise.resolve();
  return { host, root, autoDone };
}
