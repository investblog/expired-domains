import type { Runtime } from 'webextension-polyfill';
import { badgeText, handleRequest } from '@/background/router';
import { createStore } from '@/background/store';
import { isRequest } from '@/shared/messages';
import type { Meta } from '@/shared/types';

export default defineBackground(() => {
  // Ф13б: the welcome page, once, on a fresh install (not on update or browser update). Keyed on
  // the install reason, not on a storage flag: storage holds only the section 6 keys.
  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason !== 'install') return;
    void browser.tabs.create({ url: browser.runtime.getURL('/welcome.html') }).catch(() => undefined);
  });

  // Listeners are registered synchronously in main() (Ф11 "Порядок"); the store's first queued
  // task is ensureReady, so every message waits for reconciliation.
  const store = createStore(browser.storage.local);

  browser.runtime.onMessage.addListener((msg: unknown, sender: Runtime.MessageSender) => {
    if (sender.id !== browser.runtime.id || !isRequest(msg)) return undefined;
    return handleRequest(store, msg);
  });

  // Ф12: the badge follows the final meta (never a pending one).
  const action = browser.action ?? browser.browserAction;
  const showCount = (meta: Meta | undefined) => {
    if (!meta || meta.pending === true) return;
    void action?.setBadgeText({ text: badgeText(meta.domainCount) }).catch(() => undefined);
  };
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.meta) showCount(changes.meta.newValue as Meta | undefined);
  });
  void store
    .ensureReady()
    .then(() => browser.storage.local.get('meta'))
    .then(({ meta }) => showCount(meta as Meta | undefined))
    .catch(() => undefined);

  // Toolbar icon, no popup (SPEC Ф13а): Chromium opens the side panel; Firefox opens the sidebar
  // straight from the click (sidebarAction.open needs the user gesture). setPanelBehavior runs on
  // every worker start, not only on install.
  const b = browser as any;
  b.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true })?.catch?.(() => undefined);
  if (b.sidebarAction && b.browserAction) {
    b.browserAction.onClicked.addListener(() => {
      b.sidebarAction.open().catch(() => undefined);
    });
  }
});
