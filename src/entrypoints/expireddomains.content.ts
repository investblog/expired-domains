import { mountPanel } from '@/content/panel';
import { t } from '@/shared/i18n';
import { type Request, sendRequest } from '@/shared/messages';
import { defaultSettings } from '@/shared/presets';
import { pageSource } from '@/shared/source';
import type { Settings } from '@/shared/types';

export default defineContentScript({
  matches: ['*://expireddomains.net/*', '*://*.expireddomains.net/*'],
  runAt: 'document_idle',
  async main() {
    // Ф1: no panel and no further work on pages without the listing block.
    if (!document.querySelector('#listing')) return;

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

    mountPanel({
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
  },
});
