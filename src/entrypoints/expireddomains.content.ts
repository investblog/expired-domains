import { mountPanel, type PanelHandle } from '@/content/panel';
import { t } from '@/shared/i18n';
import { type Request, sendRequest } from '@/shared/messages';
import { defaultSettings } from '@/shared/presets';
import { pageSource } from '@/shared/source';
import { isTabRequest, type PageState, TAB_READY, type TabSaveResult } from '@/shared/tab-messages';
import type { Settings } from '@/shared/types';

export default defineContentScript({
  matches: ['*://expireddomains.net/*', '*://*.expireddomains.net/*'],
  runAt: 'document_idle',
  async main() {
    let handle: PanelHandle | null = null;

    // Ф13в: on every page of the site the side panel may ask what is open here and press
    // "Save page" for the user. Nothing is shown and nothing else is read on pages without
    // `#listing` (Ф1). Any other message is left to its own receiver (undefined).
    browser.runtime.onMessage.addListener((msg: unknown) => {
      if (!isTabRequest(msg)) return undefined;
      if (msg.type === 'edsTab:state') {
        const state: PageState = handle ? { listing: true, ...handle.state() } : { listing: false };
        return Promise.resolve(state);
      }
      return handle ? handle.save() : Promise.resolve<TabSaveResult>({ ok: false, error: 'no_listing' });
    });
    const announce = () => {
      try {
        void browser.runtime.sendMessage({ type: TAB_READY }).catch(() => undefined);
      } catch {
        // extension reloaded under this page
      }
    };

    // Ф1: no panel and no further work on pages without the listing block.
    if (!document.querySelector('#listing')) {
      announce();
      return;
    }

    const contextInvalidated = () => {
      try {
        return !browser.runtime?.id;
      } catch {
        return true;
      }
    };
    const send = <R extends Request>(msg: R) => sendRequest((m: R) => browser.runtime.sendMessage(m), msg);

    // Reading is allowed outside background; only background writes (Ф9).
    let settings: Settings = defaultSettings();
    try {
      const got = await browser.storage.local.get('settings');
      if (got.settings) settings = got.settings as Settings;
    } catch {
      // keep defaults; saving still goes through the background
    }

    handle = mountPanel({
      doc: document,
      // Д10 / I6: only host, path, the search `q` and the title are used.
      source: pageSource(location.href, document.title),
      settings,
      windowWidth: window.innerWidth,
      t,
      add: (capture) => send({ type: 'eds:add', capture }),
      setSettings: (partial) => send({ type: 'eds:setSettings', settings: partial }),
      contextInvalidated,
    });
    // Auto-capture may be switched in the side panel too; keep this page's checkbox in step.
    browser.storage.onChanged.addListener((changes, area) => {
      const next = changes.settings?.newValue as Settings | undefined;
      if (area === 'local' && next && handle) handle.setAutoCapture(next.autoCapture);
    });
    announce();
  },
});
