import { createMarks } from '@/content/marks';
import { mountPanel, type PanelHandle } from '@/content/panel';
import { t } from '@/shared/i18n';
import { type Request, sendRequest } from '@/shared/messages';
import { domainRows, parseListing } from '@/shared/parse';
import { defaultSettings, pageMarkSettings } from '@/shared/presets';
import { recordKey } from '@/shared/records';
import { pageSource } from '@/shared/source';
import { isTabRequest, type PageState, TAB_READY, type TabSaveResult } from '@/shared/tab-messages';
import type { DomainRecord, Meta, Settings } from '@/shared/types';

/** The stored records among `got`, by domain; a domain without a record is not in the collection. */
function recordsByDomain(got: Record<string, unknown>, domains: string[]): Map<string, DomainRecord> {
  const out = new Map<string, DomainRecord>();
  for (const d of domains) {
    const r = got[recordKey(d)];
    if (r && typeof r === 'object') out.set(d, r as DomainRecord);
  }
  return out;
}

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
    // Settings and this page's records are read in one call, before the panel mounts: the
    // auto-capture it starts must not hide which domains were new when the page opened (Ф31).
    const readRecords = async (domains: string[]) => {
      const got = await browser.storage.local.get(domains.map(recordKey));
      return recordsByDomain(got, domains);
    };
    let settings: Settings = defaultSettings();
    let records = new Map<string, DomainRecord>();
    const initial = parseListing(document);
    const ready = initial.diagnostics.code === 'ok';
    const pageDomains = domainRows(document).map((r) => r.domain);
    try {
      const got = await browser.storage.local.get(['settings', ...(ready ? pageDomains.map(recordKey) : [])]);
      if (got.settings) settings = got.settings as Settings;
      records = recordsByDomain(got, pageDomains);
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
    const panel = handle;

    // SPEC 4.7: marks in the table, only on a table the parser accepts (Ф28).
    const marks =
      panel && ready
        ? createMarks(
            {
              doc: document,
              t,
              read: readRecords,
              saveRow: (domain) => panel.saveRow(domain),
              setStatus: async (domain, status) =>
                (await send({ type: 'eds:update', domains: [domain], patch: { status } })).ok,
              failed: () => panel.failed(),
            },
            { records, switches: pageMarkSettings(settings) },
          )
        : null;

    // Settings may be switched in the side panel too; keep this page in step. Every finished
    // mutation writes a new `meta` without `pending` (Ф11): then the marks re-read (Ф32).
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !panel) return;
      const next = changes.settings?.newValue as Settings | undefined;
      if (next) {
        panel.setAutoCapture(next.autoCapture);
        panel.setMarkSwitches(pageMarkSettings(next));
        marks?.configure(pageMarkSettings(next));
      }
      const meta = changes.meta?.newValue as Meta | undefined;
      if (marks && meta && meta.pending !== true) void marks.refresh();
    });
    announce();
  },
});
