// Welcome page (SPEC Ф13б): opened once on install, and from the side panel ("How it works").
// Explains what the site is, why an account helps, and the four steps — for someone who has
// never seen expireddomains.net. Links only; the page sends no requests (I1).

import { t } from '@/shared/i18n';
import { svgIcon } from '@/shared/svg';
import { applyTheme, getThemePreference } from '@/sidepanel/theme';

const BROWSER: string = (import.meta as any).env?.BROWSER ?? 'chrome';
const SITE_URL = 'https://www.expireddomains.net/';
const REGISTER_URL = 'https://www.expireddomains.net/register/';
const URL_301 = 'https://301.st/?utm_source=expired-domains&utm_medium=extension&utm_campaign=welcome';
const REPO_URL = 'https://github.com/investblog/expired-domains';

function storeReviewUrl(): string {
  const id = browser.runtime.id;
  if (BROWSER === 'firefox') return `https://addons.mozilla.org/firefox/addon/${encodeURIComponent(id)}/`;
  if (BROWSER === 'edge') return `https://microsoftedge.microsoft.com/addons/detail/${id}`;
  return `https://chromewebstore.google.com/detail/${id}/reviews`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}

function link(text: string, href: string, cls: string): HTMLAnchorElement {
  const a = el('a', cls, text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

const PANEL_ICON = 'M4 3h16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2m10 2H4v14h10zm2 0v14h4V5z';

// sidePanel.open must run while the click's user gesture is active: the window id is read at load.
let windowId: number | undefined;
void (browser as any).windows
  ?.getCurrent()
  .then((w: { id?: number }) => {
    windowId = w.id;
  })
  .catch(() => undefined);

/** Opens the side panel (Chromium) or the sidebar (Firefox); false if neither API is there. */
function openPanel(): boolean {
  const b = browser as any;
  if (b.sidePanel?.open && windowId !== undefined) {
    b.sidePanel.open({ windowId }).catch(() => undefined);
    return true;
  }
  if (b.sidebarAction?.open) {
    b.sidebarAction.open().catch(() => undefined);
    return true;
  }
  return false;
}

function render(app: HTMLElement): void {
  const header = el('header', 'welcome__header');
  const icon = el('img', 'welcome__icon');
  icon.src = '/icons/48.png';
  icon.alt = '';
  const head = el('div', '');
  head.append(el('h1', 'welcome__title', t('extName')), el('p', 'welcome__tagline', t('welTagline')));
  header.append(icon, head);

  const what = el('section', 'welcome-card');
  what.append(
    el('h2', 'welcome-card__title', t('welWhatTitle')),
    el('p', 'welcome-card__text', t('welWhatSite')),
    el('p', 'welcome-card__text', t('welWhatExt')),
  );

  const steps = el('ol', 'welcome__steps');
  const stepData: [string, string, HTMLElement | null][] = [
    [
      t('welStepAccountTitle'),
      t('welStepAccountText'),
      (() => {
        const row = el('div', 'welcome__links');
        row.append(
          link(t('linkRegister'), REGISTER_URL, 'welcome-chip welcome-chip--primary'),
          link(t('linkSiteOpen'), SITE_URL, 'welcome-chip'),
        );
        return row;
      })(),
    ],
    [t('welStepListTitle'), t('welStepListText'), null],
    [t('welStepSaveTitle'), t('welStepSaveText'), null],
    [t('welStepPanelTitle'), t('welStepPanelText'), null],
  ];
  stepData.forEach(([title, text, extra], i) => {
    const step = el('li', 'welcome-step');
    step.append(
      el('span', 'welcome-step__num', String(i + 1)),
      el('h3', 'welcome-step__title', title),
      el('p', 'welcome-step__text', text),
    );
    if (extra) step.append(extra);
    steps.append(step);
  });

  const hero = el('section', 'welcome-card');
  const openBtn = el('button', 'welcome-btn');
  openBtn.type = 'button';
  openBtn.append(svgIcon(document, [['path', { d: PANEL_ICON, fill: 'currentColor' }]]), t('welOpenPanel'));
  const openHint = el('p', 'welcome__hint', t('welPinHint'));
  openBtn.addEventListener('click', () => {
    if (!openPanel()) openHint.textContent = t('welOpenPanelManual');
  });
  hero.append(el('h2', 'welcome-card__title', t('welPanelTitle')), el('p', 'welcome-card__text', t('welPanelText')));
  const features = el('ul', 'welcome__features');
  for (const key of [
    'welFeatureFilters',
    'welFeaturePresets',
    'welFeatureMarks',
    'welFeatureExport',
    'welFeatureBackup',
  ]) {
    features.append(el('li', '', t(key)));
  }
  hero.append(features, openBtn, openHint);

  const privacy = el('section', 'welcome-card');
  const links = el('div', 'welcome__links');
  links.append(
    link(t('footerRate'), storeReviewUrl(), 'welcome-chip'),
    link('GitHub', REPO_URL, 'welcome-chip'),
    link('301.st', URL_301, 'welcome-chip'),
  );
  privacy.append(
    el('h2', 'welcome-card__title', t('welPrivacyTitle')),
    el('p', 'welcome-card__text', t('welPrivacyText')),
    el('p', 'welcome-card__text welcome__unofficial', t('welUnofficial')),
    links,
  );

  app.replaceChildren(header, what, steps, hero, privacy);
}

document.documentElement.lang = browser.i18n.getUILanguage().startsWith('ru') ? 'ru' : 'en';
document.title = t('extName');
applyTheme(getThemePreference());
const root = document.getElementById('app');
if (root) render(root);
