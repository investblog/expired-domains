// Page-mark styles (SPEC 4.7). MARK_CSS goes inside every badge's closed shadow root (badge and
// its popover menu); pageCss() is the one <style> we add to the site's document: rules only for
// our own attributes (`data-eds` on rows, `data-eds-mark` on our badge hosts), no site class is
// restyled (Ф29). Colours follow the side panel's status badges (Ф13) and prefers-color-scheme
// (Ф33). The host's inline `all: initial !important` beats :host declarations except custom
// properties, so font and colour are set on our own elements, tokens on :host.

export const MARK_CSS = `
:host {
  --bg: #ffffff;
  --text: #111111;
  --muted: #5b5f66;
  --border: #e5e5e4;
  --primary: #0055dc;
  --primary-soft: #e6eefc;
  --danger: #c0213f;
  --danger-bg: #fbe9ec;
  --success: #0e8a58;
  --success-bg: #e3f5ec;
  --shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
}
@media (prefers-color-scheme: dark) {
  :host {
    --bg: #181a1f;
    --text: #e7e9ee;
    --muted: #a0a4af;
    --border: rgba(255, 255, 255, 0.14);
    --primary: #4da3ff;
    --primary-soft: rgba(77, 163, 255, 0.18);
    --danger: #ff4f6e;
    --danger-bg: rgba(255, 79, 110, 0.18);
    --success: #18c27a;
    --success-bg: rgba(24, 194, 122, 0.18);
    --shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
  }
}
* { box-sizing: border-box; margin: 0; }
.wrap, .menu { font: 12px/1.3 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--text); }
svg { display: block; width: 10px; height: 10px; fill: currentColor; }
[hidden] { display: none !important; }

.wrap { display: inline-flex; align-items: center; gap: 3px; vertical-align: middle; }
.mark {
  position: relative; display: inline-flex; align-items: center; justify-content: center;
  width: 16px; height: 16px; padding: 0; border: 0; border-radius: 50%;
  background: transparent; color: var(--muted); cursor: pointer; font: inherit;
}
.mark:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; }
/* Not in the collection: an empty ring, shown while the row is hovered, the mark has focus or
   its menu is open. --eds-reveal is set on our host by the page rule for a hovered row (pageCss). */
.mark[data-s="none"] { box-shadow: inset 0 0 0 1px var(--muted); opacity: var(--eds-reveal, 0); }
.mark[data-s="none"]:focus-visible, .mark[data-s="none"][aria-expanded="true"] { opacity: 1; }
.mark[data-s="saved"]::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--muted); }
.mark[data-s="shortlist"] { background: var(--success-bg); color: var(--success); }
.mark[data-s="rejected"] { background: var(--danger-bg); color: var(--danger); }
.mark[data-s="bought"] { background: var(--primary-soft); color: var(--primary); }
/* Tags or a note: a small dot on the mark's corner. */
.mark[data-extra]::after {
  content: ""; position: absolute; top: -1px; right: -1px; width: 5px; height: 5px;
  border-radius: 50%; background: var(--primary); box-shadow: 0 0 0 1px var(--bg);
}
.new {
  padding: 0 4px; border-radius: 4px; background: var(--primary-soft); color: var(--primary);
  font-size: 10px; font-weight: 600; line-height: 14px; white-space: nowrap;
}

/* The status menu: a popover in the top layer, placed by marks.ts next to its badge. */
.menu {
  position: fixed; inset: auto; margin: 0; min-width: 150px; padding: 4px; overflow: visible;
  background: var(--bg); border: 1px solid var(--border); border-radius: 8px; box-shadow: var(--shadow);
}
.item {
  display: flex; align-items: center; gap: 8px; width: 100%; padding: 5px 8px; border: 0; border-radius: 6px;
  background: transparent; color: inherit; text-align: left; cursor: pointer; font: inherit; font-size: 13px;
}
.item:hover:not(:disabled), .item:focus-visible { background: color-mix(in srgb, var(--text) 8%, transparent); outline: none; }
.item:disabled { opacity: 0.45; cursor: default; }
.item[aria-checked="true"] { font-weight: 600; }
.dot { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 50%; }
.item[data-s="shortlist"] .dot { background: var(--success-bg); color: var(--success); }
.item[data-s="rejected"] .dot { background: var(--danger-bg); color: var(--danger); }
.item[data-s="new"] .dot { box-shadow: inset 0 0 0 1px var(--muted); }
`;

/** The document rules for the switches that are on; empty when both are off (Ф29, Ф32). */
export function pageCss(opts: { pageMarks: boolean; dimRejected: boolean }): string {
  const rules: string[] = [];
  if (opts.pageMarks) {
    // The bar is an inset shadow on the row's first cell: borders and shadows on <tr> are
    // unreliable across table layouts.
    rules.push(
      'tr[data-eds~="shortlist"] > td:first-child { box-shadow: inset 3px 0 0 #0e8a58 !important; }',
      '@media (prefers-color-scheme: dark) { tr[data-eds~="shortlist"] > td:first-child { box-shadow: inset 3px 0 0 #18c27a !important; } }',
      'tr:hover [data-eds-mark] { --eds-reveal: 1; }',
    );
  }
  if (opts.dimRejected) rules.push('tr[data-eds~="rejected"] { opacity: 0.45 !important; }');
  return rules.join('\n');
}
