// Welcome page (SPEC Ф13б): renders the explanation, the four steps with the sign-up link, and
// opens the side panel / sidebar from the button. Fake `browser`; the page sends nothing.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ browser: {} as Record<string, unknown> }));
vi.mock('wxt/browser', () => ({ browser: fake.browser }));

const calls: string[] = [];

async function load(extra: Record<string, unknown>) {
  for (const k of Object.keys(fake.browser)) delete fake.browser[k];
  Object.assign(fake.browser, {
    runtime: { id: 'test-id', getURL: (p: string) => `chrome-extension://test-id${p}` },
    i18n: { getMessage: (key: string) => key, getUILanguage: () => 'en' },
    ...extra,
  });
  (globalThis as Record<string, unknown>).browser = fake.browser;
  document.body.innerHTML = '<main id="app" class="welcome"></main>';
  vi.resetModules();
  await import('@/entrypoints/welcome/main');
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
  return document.getElementById('app') as HTMLElement;
}

beforeEach(() => {
  calls.length = 0;
});

describe('welcome page', () => {
  it('explains the site, then four steps; the first one links to the free sign-up', async () => {
    const app = await load({});
    expect(app.querySelector('h1')?.textContent).toBe('extName');
    const steps = Array.from(app.querySelectorAll('.welcome-step__title')).map((x) => x.textContent);
    expect(steps).toEqual(['welStepAccountTitle', 'welStepListTitle', 'welStepSaveTitle', 'welStepPanelTitle']);
    const register = Array.from(app.querySelectorAll('a')).find((a) => a.textContent === 'linkRegister');
    expect(register?.getAttribute('href')).toBe('https://www.expireddomains.net/register/');
    for (const a of app.querySelectorAll('a')) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener');
    }
    expect(app.textContent).toContain('welUnofficial');
  });

  it('the button opens the Chromium side panel in the current window', async () => {
    const app = await load({
      windows: { getCurrent: async () => ({ id: 7 }) },
      sidePanel: {
        open: async (o: { windowId: number }) => {
          calls.push(`sidePanel.open:${o.windowId}`);
        },
      },
    });
    (app.querySelector('.welcome-btn') as HTMLButtonElement).click();
    expect(calls).toEqual(['sidePanel.open:7']);
  });

  it('the button opens the Firefox sidebar; without either API it explains where the icon is', async () => {
    let app = await load({
      sidebarAction: {
        open: async () => {
          calls.push('sidebarAction.open');
        },
      },
    });
    (app.querySelector('.welcome-btn') as HTMLButtonElement).click();
    expect(calls).toEqual(['sidebarAction.open']);

    app = await load({});
    (app.querySelector('.welcome-btn') as HTMLButtonElement).click();
    expect(app.querySelector('.welcome__hint')?.textContent).toBe('welOpenPanelManual');
  });
});
