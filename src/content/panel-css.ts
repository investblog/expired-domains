// Panel styles (SPEC Ф3): a string inserted as <style> into the closed shadow root. Tokens are a
// small subset of the 301.st theme, declared on :host, in px (rem follows the site's root), and
// the theme follows prefers-color-scheme only (the site's localStorage is not ours).
// Positioning and the reset of the host itself are inline `!important` styles (HOST_STYLE in
// panel.ts), because page styles can match the host element.
export const PANEL_CSS = `
:host {
  --font-sans: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --bg: #ffffff;
  --text: #111111;
  --muted: #5b5f66;
  --border: #e5e5e4;
  --primary: #0055dc;
  --primary-hover: #003682;
  --on-primary: #ffffff;
  --danger: #c0213f;
  --success: #0e8a58;
  --warning-bg: #fff4e0;
  --warning-fg: #8a4b00;
  --shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
  --radius: 8px;
  font: 13px/1.45 var(--font-sans);
  color: var(--text);
}
@media (prefers-color-scheme: dark) {
  :host {
    --bg: #181a1f;
    --text: #e7e9ee;
    --muted: #a0a4af;
    --border: rgba(255, 255, 255, 0.14);
    --primary: #3475c0;
    --primary-hover: #4da3ff;
    --danger: #ff4f6e;
    --success: #18c27a;
    --warning-bg: #38240a;
    --warning-fg: #ffb347;
    --shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
  }
}
* { box-sizing: border-box; margin: 0; font: inherit; color: inherit; }
.panel {
  width: 240px;
  padding: 10px 12px 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}
.head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.title { flex: 1; font-weight: 600; font-size: 13px; }
.icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; padding: 0; border: 0; border-radius: 6px;
  background: transparent; color: var(--muted); cursor: pointer;
}
.icon-btn:hover { color: var(--text); background: color-mix(in srgb, var(--text) 8%, transparent); }
.info { color: var(--muted); font-size: 12px; margin-bottom: 8px; }
.save {
  width: 100%; height: 32px; padding: 0 10px; border: 0; border-radius: 6px;
  background: var(--primary); color: var(--on-primary); font-weight: 600; cursor: pointer;
}
.save:hover:not(:disabled) { background: var(--primary-hover); }
.save:disabled { opacity: 0.5; cursor: default; }
.auto { display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 12px; cursor: pointer; user-select: none; }
.auto input { margin: 0; accent-color: var(--primary); }
.status { margin-top: 8px; min-height: 17px; font-size: 12px; }
.status[data-kind="ok"] { color: var(--success); }
.status[data-kind="error"] { color: var(--danger); }
.warning { margin-bottom: 8px; padding: 6px 8px; border-radius: 6px; background: var(--warning-bg); color: var(--warning-fg); font-size: 12px; }
.collapsed {
  display: flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; padding: 0; border: 1px solid var(--border); border-radius: 50%;
  background: var(--bg); color: var(--primary); box-shadow: var(--shadow); cursor: pointer;
}
/* Ф3а: auto-capture on — the launcher is filled with the primary colour (white icon: 6.3:1 light,
   4.7:1 dark), so the mode is visible while the panel is collapsed. Hover darkens rather than
   using --primary-hover, which is lighter in the dark theme (white on it ≈ 2.6:1). */
.collapsed--auto { background: var(--primary); border-color: var(--primary); color: var(--on-primary); }
.collapsed--auto:hover { background: color-mix(in srgb, var(--primary) 85%, #000); }
/* Auto-capture added new domains: one light sweep across the launcher (collapsed) or "Save page"
   (expanded), 1.2s = SHIMMER_MS in panel.ts. overflow clips the sweep to the control's shape;
   the control's own shadow is not clipped. */
.collapsed, .save { position: relative; overflow: hidden; }
.shimmer::after {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  /* In the text/icon colour: white on a filled control, primary on the plain launcher. */
  background: linear-gradient(110deg, transparent 30%, color-mix(in srgb, currentColor 55%, transparent) 50%, transparent 70%);
  transform: translateX(-100%);
  animation: eds-shimmer 1.2s ease-in-out;
}
@keyframes eds-shimmer { to { transform: translateX(100%); } }
/* Reduced motion: no sweep, a short glow that fades in place instead. */
@media (prefers-reduced-motion: reduce) {
  .shimmer::after {
    background: color-mix(in srgb, currentColor 35%, transparent); transform: none;
    animation: eds-glow 1.2s ease-out forwards;
  }
}
@keyframes eds-glow { from { opacity: 1; } to { opacity: 0; } }
/* Icons are copies of sprite symbols (src/assets/icons/mono.svg): paint comes with them. */
svg { display: block; width: 16px; height: 16px; fill: currentColor; }
.collapsed svg { width: 18px; height: 18px; }
[hidden] { display: none !important; }
`;
