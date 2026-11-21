#!/usr/bin/env node
// Store screenshot harness (SPEC М7): serves the built Chrome package on 127.0.0.1 with a fake
// `chrome` API and invented, neutral demo data — no real site, no account, nothing personal.
//   npm run build && node scripts/store-harness.mjs [port]
// Pages:
//   /sidepanel.html?lang=en|ru&theme=light|dark&act=filters|editor|select   the side panel
//   /welcome.html?lang=en|ru&theme=…&act=fit                                the welcome page
//   /shot.html?n=1..3&lang=…&theme=…    a 1280×800 store frame: caption left, live side panel right
// Take the screenshots with any browser at a 1280×800 viewport; stop the server with Ctrl+C.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist', 'chrome-mv3');
const port = Number(process.argv[2] ?? 5179);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

const messages = (lang) => readFileSync(join(dist, '_locales', lang, 'messages.json'), 'utf8');

// ---------------------------------------------------------------- demo data (invented)

const LISTS = {
  'member.expireddomains.net/domains/expiredcom/': 'Deleted .com Domains',
  'member.expireddomains.net/domains/pendingdelete/': 'Pending Delete Domains',
  'member.expireddomains.net/domains/godaddyauctionswithbids/': 'GoDaddy Auctions with Bids',
};
const NAMES = [
  'brightharbor.com', 'oakandpine.com', 'quietlakecabins.ca', 'citybikeworks.net', 'learnspanishdaily.es',
  'solarhomeguide.de', 'petvetcorner.com', 'mountaintrailmaps.ch', 'freshcrumbbakery.com', 'smartgardenkit.net',
  'nordicknits.se', 'tinyhousetales.co.uk', 'urbanpotter.com', 'coastalkayaks.net', 'mindfulmornings.io',
  'retroarcadehub.com', 'greenlanefarm.nl', 'paperplanestudio.net', 'silverbirchlodge.com', 'homebrewlab.org',
  'wildflowerweddings.fr', 'clearviewoptics.net', 'saltandstone.com', 'buildyourdeck.com.au', 'nightskyphoto.org',
  'bookcornercafe.com', 'everydayyoga.net', 'lakesidedental.com', 'vintagemaps.org', 'sparkcodeacademy.com',
];
function demoData() {
  const now = Date.now();
  const ids = Object.keys(LISTS);
  const data = {
    meta: {
      schema: 2, sources: LISTS, rev: 1, domainCount: NAMES.length, columnOrder: ['bl', 'domainpop', 'abirth', 'whois', 'endtime'],
      columns: {
        bl: { label: 'BL', title: 'Backlinks' }, domainpop: { label: 'DP', title: 'Domain Pop' },
        abirth: { label: 'ABY', title: 'Archive Birth Year' }, whois: { label: 'Status', title: '' },
        endtime: { label: 'End Date', title: '' },
      },
    },
    settings: { autoCapture: true, panelCollapsed: false, filterPresets: [{ id: 'p1', name: 'Short .com, BL 50+', filter: { zones: ['com'], minBl: 50, maxNameLength: 14 } }], activePreset: 'all' },
  };
  NAMES.forEach((name, i) => {
    const list = ids[i % 3];
    const auction = list.includes('godaddy');
    const r = {
      firstSeen: now - (i + 2) * 3600e3, lastSeen: now - (i % 5) * 600e3, lists: [list], lastSource: list,
      stats: auction
        ? { bl: String(40 + i * 23), domainpop: String(8 + i * 3), abirth: String(2004 + (i % 15)), endtime: `${(i % 9) + 1}h ${10 + i}m` }
        : { bl: String(12 + i * 17), domainpop: String(3 + i * 2), abirth: String(2002 + (i % 18)), whois: 'available' },
    };
    if ([1, 4, 9, 13, 21].includes(i)) r.status = 'shortlist';
    if ([6, 17].includes(i)) r.status = 'bought';
    if ([11].includes(i)) r.status = 'rejected';
    if ([1, 4, 13].includes(i)) r.tags = ['client-a'];
    if ([9, 21].includes(i)) r.tags = ['travel', 'review'];
    if ([4, 17].includes(i)) r.note = 'Check the Web Archive history first';
    data[`d:${name}`] = r;
  });
  return data;
}

// ---------------------------------------------------------------- fake chrome API + scripted states

function stub(lang, theme, act) {
  const demo = demoData();
  if (act === 'empty') {
    // sidepanel.html?act=empty: a fresh install — the onboarding empty state.
    for (const k of Object.keys(demo)) if (k.startsWith('d:')) delete demo[k];
    demo.meta = { ...demo.meta, sources: {}, columns: {}, columnOrder: [], domainCount: 0 };
  }
  return `<script>
(() => {
  const M = ${messages(lang)};
  const data = ${JSON.stringify(demo)};
  try { localStorage.setItem('expired_domains_theme', ${JSON.stringify(theme)}); } catch {}
  const fmt = (key, subs) => { const m = M[key]; if (!m) return key; let s = m.message;
    for (const [p, v] of Object.entries(m.placeholders || {})) { const i = Number(v.content.slice(1)) - 1; s = s.split('$' + p + '$').join((subs || [])[i] ?? ''); }
    return s; };
  // webextension-polyfill (WXT 0.19, Chromium build) calls chrome.* with a trailing callback.
  const api = (value) => (...args) => {
    const cb = args.find((a) => typeof a === 'function');
    const v = typeof value === 'function' ? value() : value;
    if (cb) { setTimeout(() => cb(v), 0); return undefined; }
    return Promise.resolve(v);
  };
  window.chrome = {
    runtime: { id: 'demo', lastError: undefined, getURL: (p) => p, sendMessage: api({ ok: true, result: { changed: 0, overflow: 0 } }) },
    i18n: { getMessage: (k, s) => fmt(k, Array.isArray(s) ? s : s === undefined ? [] : [s]), getUILanguage: () => ${JSON.stringify(lang)} },
    storage: { local: { get: api(() => JSON.parse(JSON.stringify(data))), set: api(undefined), remove: api(undefined) },
      onChanged: { addListener: () => {}, removeListener: () => {}, hasListener: () => false } },
  };
  const act = ${JSON.stringify(act)};
  if (!act) return;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  window.addEventListener('load', async () => {
    await wait(300);
    const q = (s) => document.querySelector(s);
    if (act === 'filters') {
      q('.filter-btn').click();
      await wait(50);
      const num = [...document.querySelectorAll('[data-drawer="filters"] input[type="number"]')];
      num[3].value = '50'; num[3].dispatchEvent(new Event('input', { bubbles: true }));
      const z = q('[data-drawer="filters"] input[placeholder="com, net, co.uk"]');
      z.value = 'com'; z.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (act === 'editor') document.querySelectorAll('.row__main')[1].click();
    // welcome.html?act=fit: the explanation and all four steps in one 1280×800 frame.
    if (act === 'fit') { document.body.style.zoom = '0.84'; document.documentElement.style.overflow = 'hidden'; }
    if (act === 'select') for (const b of [...document.querySelectorAll('.row > input')].slice(0, 4)) { b.checked = true; b.dispatchEvent(new Event('change')); }
  });
})();
</script>`;
}

// ---------------------------------------------------------------- 1280×800 store frames

const CAPTIONS = {
  en: [
    ['Every list you browse, in one place', 'Save expireddomains.net list pages as you go — no duplicates, all columns, up to 10,000 domains.', ['Side panel stays open beside the site', 'Updates live while you browse', 'Zone, flag and status at a glance']],
    ['Filter the whole collection', 'Text or /regex/, lists, availability, drop and deletion dates, auctions, BL/DP, archive age, zones.', ['Conditions in a slide-out panel', 'Built-in and your own presets', 'Export exactly what you filtered']],
    ['Mark, tag and export', 'Shortlist, reject or mark as bought; add tags and notes; export to CSV, TXT or the clipboard.', ['Bulk edit or delete the selection', 'CSV opens in Excel', 'Backup and restore as JSON']],
  ],
  ru: [
    ['Все просмотренные списки — в одном месте', 'Сохраняйте страницы списков expireddomains.net по ходу просмотра — без дублей, со всеми колонками, до 10 000 доменов.', ['Боковая панель рядом с сайтом', 'Обновляется по ходу просмотра', 'Зона, флаг и статус — сразу видны']],
    ['Фильтруйте всю коллекцию', 'Текст или /regex/, списки, свободен/занят, даты освобождения и удаления, аукционы, BL/DP, возраст в архиве, зоны.', ['Условия в выезжающей панели', 'Встроенные и свои подборки', 'Выгрузка ровно того, что отфильтровано']],
    ['Отмечайте, тегируйте, выгружайте', 'Отбирайте, отклоняйте, отмечайте купленные; теги и заметки; выгрузка в CSV, TXT или буфер обмена.', ['Массовая правка и удаление выбранных', 'CSV открывается в Excel', 'Резервная копия и восстановление в JSON']],
  ],
};
const ACTS = [null, 'filters', 'select'];
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function shot(n, lang, theme) {
  const [title, text, bullets] = CAPTIONS[lang][n - 1];
  const act = ACTS[n - 1];
  const dark = theme === 'dark';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:1280px;height:800px;overflow:hidden}
  body{font:16px/1.5 system-ui,"Segoe UI",sans-serif;color:#E7E9EE;
    background:radial-gradient(1200px 700px at 0% 0%,#123a6e 0%,#0b1626 45%,#0a0f18 100%);display:flex;align-items:center;gap:64px;padding:0 72px;box-sizing:border-box}
  .copy{flex:1;min-width:0}
  .brand{display:flex;align-items:center;gap:12px;margin-bottom:28px;font-weight:600;font-size:20px}
  .brand img{width:40px;height:40px}
  h1{margin:0 0 16px;font-size:38px;line-height:1.15;font-weight:700;letter-spacing:-.01em}
  p{margin:0 0 28px;color:#A0A4AF;font-size:19px}
  ul{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:12px}
  li{display:flex;gap:12px;align-items:center;font-size:18px}
  li::before{content:"";width:10px;height:10px;border-radius:50%;background:#4DA3FF;flex-shrink:0}
  .unofficial{margin-top:36px;font-size:13px;color:#7A7E87}
  .frame{width:430px;height:720px;border-radius:14px;overflow:hidden;flex-shrink:0;
    box-shadow:0 30px 80px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,${dark ? '.10' : '.18'})}
  iframe{width:100%;height:100%;border:0;display:block;background:${dark ? '#111' : '#fff'}}
  </style></head><body>
  <div class="copy">
    <div class="brand"><img src="/icons/128.png" alt="">Expired Domains</div>
    <h1>${esc(title)}</h1><p>${esc(text)}</p>
    <ul>${bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
    <div class="unofficial">${lang === 'ru' ? 'Неофициальное расширение, не связано с ExpiredDomains.net' : 'Unofficial. Not affiliated with ExpiredDomains.net'}</div>
  </div>
  <div class="frame"><iframe src="/sidepanel.html?lang=${lang}&theme=${theme}${act ? `&act=${act}` : ''}"></iframe></div>
  </body></html>`;
}

// ---------------------------------------------------------------- server

if (!existsSync(join(dist, 'sidepanel.html'))) {
  console.error('dist/chrome-mv3 is missing — run `npm run build` first');
  process.exit(1);
}
createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const lang = url.searchParams.get('lang') === 'ru' ? 'ru' : 'en';
  const theme = url.searchParams.get('theme') === 'light' ? 'light' : 'dark';
  const path = normalize(decodeURIComponent(url.pathname)).replace(/^[\\/]+/, '');
  if (path === 'shot.html') {
    const n = Math.min(3, Math.max(1, Number(url.searchParams.get('n')) || 1));
    res.writeHead(200, { 'content-type': TYPES['.html'] }).end(shot(n, lang, theme));
    return;
  }
  const file = join(dist, path || 'sidepanel.html');
  if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  let body = readFileSync(file);
  if (path === 'sidepanel.html' || path === 'welcome.html') {
    // A replacer function: the stub contains `$'`, which a replacement string would expand.
    const script = stub(lang, theme, url.searchParams.get('act'));
    body = Buffer.from(body.toString('utf8').replace('<head>', () => `<head>${script}`));
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
}).listen(port, '127.0.0.1', () => console.log(`store harness: http://127.0.0.1:${port}/shot.html?n=1`));
