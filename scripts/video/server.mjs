#!/usr/bin/env node
// Promo video stage: the built Chrome package with a fake `chrome` API whose storage is shared
// by every frame of /video.html, so "Save page" on a demo list really fills the side panel.
// Invented, neutral data only — no real site, no account, nothing personal.
//   npm run build && node scripts/video/server.mjs [port]
// Pages:
//   /video.html                 the whole video timeline (scripts/video/video.html)
//   /sidepanel.html?theme=…     the side panel, storage from parent.__demo
//   /demo-list.html?page=1|2    a plain demo table with the real on-page panel
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const dist = join(root, 'dist', 'chrome-mv3');
const here = join(root, 'scripts', 'video');
const art = join(root, 'store-assets', 'video', 'art');
const port = Number(process.argv[2] ?? 5180);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

// ---------------------------------------------------------------- demo lists (invented names)

const LIST_ID = '127.0.0.1/demo-list.html';
const PAGES = [
  [
    'brightharbor.com', 'oakandpine.com', 'quietlakecabins.ca', 'citybikeworks.net', 'learnspanishdaily.es',
    'solarhomeguide.de', 'petvetcorner.com', 'mountaintrailmaps.ch', 'freshcrumbbakery.com', 'smartgardenkit.net',
    'nordicknits.se', 'tinyhousetales.co.uk', 'urbanpotter.com', 'coastalkayaks.net', 'mindfulmornings.io',
    'retroarcadehub.com', 'greenlanefarm.nl', 'paperplanestudio.net', 'silverbirchlodge.com', 'homebrewlab.org',
    'wildflowerweddings.fr', 'clearviewoptics.net', 'saltandstone.com', 'buildyourdeck.com.au', 'nightskyphoto.org',
  ],
  [
    'bookcornercafe.com', 'everydayyoga.net', 'lakesidedental.com', 'vintagemaps.org', 'sparkcodeacademy.com',
    'harborlightinn.com', 'pixelpinecraft.com', 'sunnysidegrocer.com', 'bluefinsurfschool.com.au', 'maplecreekfarm.ca',
    'quickfixplumbing.net', 'artisanloaves.de', 'trailrunnerclub.org', 'cozyreadingnook.com', 'oceanbreezevillas.es',
    'tinytechtoys.com', 'redbarnantiques.com', 'alpinecheese.ch', 'fjordviewcabins.no', 'goldenhourstudio.net',
    'zenteahouse.com', 'campfirestories.org', 'cleanairfilters.com', 'woolandwillow.co.uk', 'starlightcinema.com',
  ],
];
const stats = (name, page, i) => {
  const k = page * 25 + i;
  return { bl: 12 + ((k * 37) % 480), domainpop: 3 + ((k * 13) % 90), abirth: 2001 + ((k * 7) % 21) };
};

function demoList(page) {
  const names = PAGES[page - 1];
  const rows = names
    .map((n, i) => {
      const s = stats(n, page - 1, i);
      return `<tr><td class="field_domain"><a href="#" title="${n}">${n}</a></td><td class="field_bl">${s.bl}</td><td class="field_domainpop">${s.domainpop}</td><td class="field_abirth">${s.abirth}</td><td class="field_whois">available</td></tr>`;
    })
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Deleted .com Domains » demo</title>
<script>
// Demo only: the panel's closed shadow root is opened so the video can press its buttons.
const attach = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (init) { return attach.call(this, { ...init, mode: 'open' }); };
</script>
${stub()}
<style>
  html,body{margin:0;background:#f4f5f7;color:#2b2f36;font:14px/1.4 system-ui,"Segoe UI",sans-serif}
  .top{height:56px;background:#e3e6eb;display:flex;align-items:center;padding:0 24px;color:#7a808a;font-weight:600;letter-spacing:.02em}
  main{padding:20px 24px}
  h1{font-size:20px;margin:0 0 4px}
  .pageinfo{color:#7a808a;margin-bottom:12px}
  table{border-collapse:collapse;width:100%;background:#fff;box-shadow:0 1px 0 #e3e6eb}
  th,td{text-align:left;padding:7px 12px;border-bottom:1px solid #eceef2}
  th{background:#eef0f3;font-size:13px;color:#5a606b}
  td a{color:#2563c9;text-decoration:none}
  tr:nth-child(even) td{background:#fafbfc}
</style></head><body>
<div class="top">DEMO LIST PAGE</div>
<main><div id="listing">
  <h1>Deleted .com Domains</h1>
  <div class="pageinfo">Page ${page} of 3</div>
  <table class="base1"><thead><tr><th class="head_domain"><a title="Domain Name">Domain</a></th><th class="head_bl"><a title="Backlinks">BL</a></th><th class="head_domainpop"><a title="Domain Pop">DP</a></th><th class="head_abirth"><a title="Archive Birth Year">ABY</a></th><th class="head_whois"><a title="">Status</a></th></tr></thead>
  <tbody>${rows}</tbody></table>
</div></main>
<script src="/content-scripts/expireddomains.js"></script>
</body></html>`;
}

// ---------------------------------------------------------------- fake chrome API → parent.__demo

function stub() {
  const messages = readFileSync(join(dist, '_locales', 'en', 'messages.json'), 'utf8');
  return `<script>
(() => {
  const M = ${messages};
  const D = parent.__demo;
  try { localStorage.setItem('expired_domains_theme', new URLSearchParams(location.search).get('theme') || 'dark'); } catch {}
  const fmt = (key, subs) => { const m = M[key]; if (!m) return key; let s = m.message;
    for (const [p, v] of Object.entries(m.placeholders || {})) { const i = Number(v.content.slice(1)) - 1; s = s.split('$' + p + '$').join((subs || [])[i] ?? ''); }
    return s; };
  // webextension-polyfill (WXT, Chromium build) calls chrome.* with a trailing callback.
  const api = (fn) => (...args) => {
    const cb = args.find((a) => typeof a === 'function');
    const v = fn(...args.filter((a) => typeof a !== 'function'));
    if (cb) { setTimeout(() => cb(v), 0); return undefined; }
    return Promise.resolve(v);
  };
  window.chrome = {
    runtime: { id: 'demo', lastError: undefined, getURL: (p) => p, sendMessage: api((msg) => D.handle(msg)),
      onMessage: { addListener() {}, removeListener() {}, hasListener: () => false } },
    i18n: { getMessage: (k, s) => fmt(k, Array.isArray(s) ? s : s === undefined ? [] : [s]), getUILanguage: () => 'en' },
    storage: { local: { get: api((keys) => D.get(keys)), set: api(() => undefined), remove: api(() => undefined) },
      onChanged: { addListener: (l) => D.listeners.add(l), removeListener: (l) => D.listeners.delete(l), hasListener: (l) => D.listeners.has(l) } },
  };
})();
</script>`;
}

// ---------------------------------------------------------------- server

if (!existsSync(join(dist, 'sidepanel.html'))) {
  console.error('dist/chrome-mv3 is missing — run `npm run build` first');
  process.exit(1);
}
createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const path = normalize(decodeURIComponent(url.pathname)).replace(/^[\\/]+/, '').replace(/\\/g, '/');
  const send = (type, body) => res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }).end(body);
  if (path === 'demo-list.html') {
    const page = url.searchParams.get('page') === '2' ? 2 : 1;
    return send(TYPES['.html'], demoList(page));
  }
  if (path === 'demo-pages.json') return send(TYPES['.json'], JSON.stringify({ listId: LIST_ID, pages: PAGES }));
  let file;
  if (path === 'video.html' || path.startsWith('video/')) file = join(here, path === 'video.html' ? 'video.html' : path.slice(6));
  else if (path.startsWith('art/')) file = join(art, path.slice(4));
  else file = join(dist, path || 'sidepanel.html');
  if (![dist, here, art].some((d) => file.startsWith(d)) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  let body = readFileSync(file);
  if (path === 'sidepanel.html') {
    // A replacer function: the stub contains `$'`, which a replacement string would expand.
    body = Buffer.from(body.toString('utf8').replace('<head>', () => `<head>${stub()}`));
  }
  send(TYPES[extname(file)] ?? 'application/octet-stream', body);
}).listen(port, '127.0.0.1', () => console.log(`video stage: http://127.0.0.1:${port}/video.html`));
