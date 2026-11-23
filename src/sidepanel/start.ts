// Live start steps in the empty state (SPEC Ф13в). The side panel asks the content script of
// the active tab what is open there — no `tabs` or host permission: tabs.query gives the id, and
// tabs.sendMessage reaches only our own script. No answer means "not on the site yet", which also
// covers a site tab that was open before the extension was installed (no script there until the
// page is reloaded).

import { t } from '@/shared/i18n';
import { isPageState, isTabReady, type PageState, type TabSaveResult } from '@/shared/tab-messages';
import { h, icon } from './dom';

/** A first list to open: Deleted .com, the site's best-known list (member area, sign-in needed). */
export const FIRST_LIST_URL = 'https://member.expireddomains.net/domains/expiredcom/';
const SITE_URL = 'https://www.expireddomains.net/';
const REGISTER_URL = 'https://www.expireddomains.net/register/';

export type Probe = { kind: 'off' } | { kind: 'site'; tabId: number; page: PageState };

/** Which step is current: 1 — open the site, 2 — open a list, 3 — save the page. */
export function currentStep(probe: Probe): 1 | 2 | 3 {
  if (probe.kind === 'off') return 1;
  return probe.page.listing ? 3 : 2;
}

export interface StartDeps {
  autoCapture: () => boolean;
  setAutoCapture: (on: boolean) => Promise<boolean>;
  toast: (text: string, kind: 'ok' | 'error') => void;
}

type Tabs = {
  query: (q: { active: boolean; currentWindow: boolean }) => Promise<{ id?: number }[]>;
  sendMessage: (tabId: number, msg: unknown) => Promise<unknown>;
  onActivated?: { addListener: (fn: () => void) => void };
  onUpdated?: { addListener: (fn: (tabId: number, info: { status?: string }) => void) => void };
};

export function createStart(deps: StartDeps) {
  const tabs = (browser as unknown as { tabs?: Partial<Tabs> }).tabs;
  const canAsk = typeof tabs?.query === 'function' && typeof tabs?.sendMessage === 'function';
  const steps = h('ol', { class: 'start' });
  let probe: Probe = { kind: 'off' };
  let seq = 0;

  async function ask(): Promise<Probe> {
    if (!canAsk || !tabs?.query || !tabs.sendMessage) return { kind: 'off' };
    try {
      const [tab] = await tabs.query({ active: true, currentWindow: true });
      if (tab?.id === undefined) return { kind: 'off' };
      const page = await tabs.sendMessage(tab.id, { type: 'edsTab:state' });
      return isPageState(page) ? { kind: 'site', tabId: tab.id, page } : { kind: 'off' };
    } catch {
      return { kind: 'off' };
    }
  }

  const outLink = (text: string, href: string, cls: string) =>
    h('a', { class: cls, text, attrs: { href, target: '_blank', rel: 'noopener' } });

  async function saveHere(button: HTMLButtonElement) {
    if (probe.kind !== 'site' || !tabs?.sendMessage) return;
    button.disabled = true;
    let res: TabSaveResult;
    try {
      res = (await tabs.sendMessage(probe.tabId, { type: 'edsTab:save' })) as TabSaveResult;
    } catch {
      res = { ok: false, error: 'closed' };
    }
    button.disabled = false;
    if (res?.ok) {
      const { added, updated, total } = res.result;
      deps.toast(t('panelSaved', String(added), String(updated), String(total)), 'ok');
    } else {
      deps.toast(t('startSaveFailed'), 'error');
      void refresh();
    }
  }

  function step(n: 1 | 2 | 3, title: string, ...body: (Node | null)[]) {
    const now = currentStep(probe);
    const state = n < now ? 'done' : n === now ? 'now' : 'next';
    return h(
      'li',
      { class: `start__step start__step--${state}` },
      h(
        'span',
        { class: 'start__mark', attrs: { 'aria-hidden': 'true' } },
        state === 'done' ? icon('mono-check') : String(n),
      ),
      h(
        'div',
        { class: 'start__body' },
        h('div', { class: 'start__title', text: title }),
        ...(state === 'now' ? body : []),
      ),
    );
  }

  function render() {
    const page = probe.kind === 'site' ? probe.page : null;
    const auto = h('input', { attrs: { type: 'checkbox' } });
    auto.checked = deps.autoCapture();
    auto.addEventListener('change', async () => {
      const wanted = auto.checked;
      if (!(await deps.setAutoCapture(wanted))) auto.checked = !wanted;
    });
    const save = h('button', { class: 'btn btn--primary', text: t('startSaveHere'), attrs: { type: 'button' } });
    save.addEventListener('click', () => void saveHere(save));
    const ready = page?.listing === true && page.mode === 'ready';
    save.disabled = !ready;

    steps.replaceChildren(
      step(
        1,
        probe.kind === 'site' ? t('startSiteOpen') : t('startOpenSite'),
        h('p', { class: 'muted', text: t('emptyStepAccount') }),
        h(
          'div',
          { class: 'actions__row' },
          outLink(t('linkSiteOpen'), SITE_URL, 'btn btn--primary'),
          outLink(t('linkRegister'), REGISTER_URL, 'btn'),
        ),
        h('p', { class: 'muted start__hint', text: t('startReloadHint') }),
      ),
      step(
        2,
        page?.listing ? t('startListOpen') : t('startOpenList'),
        h('div', { class: 'actions__row' }, outLink(t('startFirstList'), FIRST_LIST_URL, 'btn btn--primary')),
        h('p', { class: 'muted start__hint', text: t('startListHint') }),
      ),
      step(
        3,
        t('startSave'),
        page?.listing
          ? h(
              'p',
              { class: ready ? '' : 'error' },
              ready
                ? t('panelOnPage', String(page.rows))
                : page.mode === 'empty'
                  ? t('startPageEmpty')
                  : t('panelLayoutUnknown'),
            )
          : null,
        h('div', { class: 'actions__row' }, save),
        h('label', { class: 'check start__auto' }, auto, h('span', { text: t('panelAutoCapture') })),
        h('p', { class: 'muted start__hint', text: t('startSaveHint') }),
      ),
    );
  }

  async function refresh() {
    if (!steps.isConnected) return;
    const mine = ++seq;
    const next = await ask();
    if (mine !== seq) return;
    probe = next;
    render();
  }

  render();
  if (canAsk) {
    tabs?.onActivated?.addListener(() => void refresh());
    tabs?.onUpdated?.addListener((_id, info) => {
      if (info.status) void refresh();
    });
    browser.runtime.onMessage.addListener((msg: unknown) => {
      if (isTabReady(msg)) void refresh();
      return undefined;
    });
  }
  return { element: steps, refresh, rerender: render };
}
