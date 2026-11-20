#!/usr/bin/env node
// SPEC A1 + A2: a cheap barrier, not a proof (I1 is proved by A8, I2 by manual review).
// A1 scans src/ and the built dist/* for network APIs, external URLs, storage writes outside
// the background and site control outside the allowed contexts. A2 compares each built
// manifest with scripts/expected-manifests/<browser>.json.
// Run after `npm run build:all`. Exit code 1 on any finding.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BUILDS = { chrome: 'dist/chrome-mv3', edge: 'dist/edge-mv3', firefox: 'dist/firefox-mv2' };
const findings = [];
const fail = (where, what) => findings.push(`${where}: ${what}`);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const rel = (p) => relative(ROOT, p).split(sep).join('/');

/** Which extension context a file belongs to. */
function contextOf(path) {
  if (/^src\/(background\/|entrypoints\/background\.ts)/.test(path) || /^dist\/[^/]+\/background\.js$/.test(path)) {
    return 'background';
  }
  if (/^src\/(content\/|entrypoints\/[^/]+\.content\.ts)/.test(path) || /^dist\/[^/]+\/content-scripts\//.test(path)) {
    return 'content';
  }
  if (
    /^src\/(sidepanel\/|entrypoints\/sidepanel\/|assets\/css\/)/.test(path) ||
    /^dist\/[^/]+\/(chunks\/sidepanel-|sidepanel\.html|assets\/)/.test(path)
  ) {
    return 'sidepanel';
  }
  if (/^src\/entrypoints\/welcome\//.test(path) || /^dist\/[^/]+\/(chunks\/welcome-|welcome\.html)/.test(path)) {
    return 'welcome';
  }
  if (/^dist\/[^/]+\/manifest\.json$/.test(path)) return 'manifest';
  return 'shared'; // src/shared and anything else is bundled everywhere: strictest rules
}

// ---------------------------------------------------------------- A1 rules

const NETWORK = [
  [/\bfetch\s*\(/, 'fetch()'],
  [/XMLHttpRequest/, 'XMLHttpRequest'],
  [/sendBeacon/, 'sendBeacon'],
  [/\bWebSocket\b/, 'WebSocket'],
  [/\bEventSource\b/, 'EventSource'],
  [/importScripts/, 'importScripts'],
  [/url\(\s*['"]?https?:/i, 'CSS url() with an external address'],
  [/\beval\s*\(|new Function\s*\(/, 'eval / new Function (I5)'],
];

/** Site control (I2). Each rule lists the contexts where it is allowed, plus named WXT runtime spots. */
const CONTROL = [
  { re: /\.click\(\)/g, name: 'element.click()', allowIn: ['sidepanel'] }, // own download link only (I2 exception)
  { re: /\.focus\(/g, name: 'focus()', allowIn: ['sidepanel'] },
  { re: /\bscroll(IntoView|To|By)\b|\.scroll\(/g, name: 'scroll*', allowIn: [] },
  { re: /window\.open\s*\(/g, name: 'window.open', allowIn: [] },
  // Only the background opens a tab: the extension's own welcome page, once on install (Ф13б).
  { re: /tabs\.create\s*\(/g, name: 'tabs.create', allowIn: ['background'] },
  { re: /location\.(assign|replace|reload)\s*\(|location\.href\s*=[^=]/g, name: 'location change', allowIn: [] },
  { re: /history\.(pushState|replaceState|back|forward|go)\s*\(/g, name: 'history.*', allowIn: [] },
  { re: /\.submit\(\)|requestSubmit/g, name: 'form submit', allowIn: [] },
  {
    re: /dispatchEvent/g,
    name: 'dispatchEvent',
    allowIn: [],
    // WXT content-script runtime: its own `wxt:locationchange` event on window (SPEC section 2).
    runtime: (ctx) => /new URL\(location\.href\)/.test(ctx) && /setInterval/.test(ctx),
  },
  {
    re: /postMessage/g,
    name: 'postMessage',
    allowIn: [],
    // WXT content-script runtime: stops an older copy of the script after an update (SPEC section 2).
    runtime: (ctx) => /SCRIPT_STARTED_MESSAGE_TYPE/.test(ctx),
  },
];

/** External addresses: allowed per context (Ф16а links in the side panel and the welcome page,
 *  homepage_url in the manifest). All are plain links the user clicks — never requests. */
const URL_RE = /https?:\/\/[^\s'"`)<>\\]+/g;
const PAGE_LINKS = [
  /^https:\/\/301\.st\/\?utm_source=/,
  // store pages for "Rate" (the extension id is filled in at run time)
  /^https:\/\/chromewebstore\.google\.com\/detail\//,
  /^https:\/\/microsoftedge\.microsoft\.com\/addons\/detail\//,
  /^https:\/\/addons\.mozilla\.org\/firefox\/addon\//,
  // onboarding (Ф13, Ф13б): the site's home page and its free sign-up page
  /^https:\/\/www\.expireddomains\.net\/(register\/)?$/,
];
const URL_ALLOW = {
  any: [/^http:\/\/www\.w3\.org\/2000\/svg$/], // SVG namespace, not a request
  sidepanel: [...PAGE_LINKS, /^https:\/\/github\.com\/investblog\/expired-domains\/issues$/],
  welcome: [...PAGE_LINKS, /^https:\/\/github\.com\/investblog\/expired-domains$/],
  manifest: [/^https:\/\/301\.st$/],
};

const STORAGE_WRITE = /storage\.local\.(set|remove|clear)\b/g;

function scan(path) {
  const ctx = contextOf(path);
  let text = readFileSync(join(ROOT, path), 'utf8');
  if (path.startsWith('src/')) text = text.replace(/^\s*\/\/.*$/gm, ''); // line comments in sources
  for (const [re, name] of NETWORK) if (re.test(text)) fail(path, `${name} (I1)`);
  for (const rule of CONTROL) {
    for (const m of text.matchAll(rule.re)) {
      if (rule.allowIn.includes(ctx)) continue;
      const around = text.slice(Math.max(0, m.index - 300), m.index + 300);
      if (rule.runtime && ctx === 'content' && path.startsWith('dist/') && rule.runtime(around)) continue;
      fail(path, `${rule.name} in ${ctx} context (I2)`);
    }
  }
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0];
    const allowed = [...URL_ALLOW.any, ...(URL_ALLOW[ctx] ?? [])].some((re) => re.test(url));
    if (!allowed) fail(path, `external URL ${url} in ${ctx} context`);
  }
  if (ctx !== 'background') for (const m of text.matchAll(STORAGE_WRITE)) fail(path, `${m[0]} outside background (Ф9)`);
}

const sources = walk(join(ROOT, 'src'))
  .map(rel)
  .filter((p) => /\.(ts|html|css)$/.test(p) && !/\.test\.ts$/.test(p));
const built = Object.values(BUILDS).flatMap((dir) => {
  try {
    return walk(join(ROOT, dir)).map(rel).filter((p) => /\.(js|html|css|json)$/.test(p) && !p.includes('/_locales/'));
  } catch {
    fail(dir, 'missing — run `npm run build:all` first');
    return [];
  }
});
for (const p of [...sources, ...built]) scan(p);

// ---------------------------------------------------------------- A2

function project(m) {
  const sorted = (xs) => [...(xs ?? [])].sort();
  const action = m.action ?? m.browser_action;
  return {
    manifest_version: m.manifest_version,
    name: m.name,
    description: m.description,
    default_locale: m.default_locale,
    homepage_url: m.homepage_url,
    author: m.author,
    minimum_chrome_version: m.minimum_chrome_version ?? null,
    permissions: sorted(m.permissions),
    content_script_matches: sorted((m.content_scripts ?? []).flatMap((c) => c.matches)),
    background: m.background?.service_worker
      ? { kind: 'service_worker', type: m.background.type ?? null }
      : { kind: 'scripts', persistent: m.background?.persistent ?? null },
    action_key: m.action ? 'action' : m.browser_action ? 'browser_action' : null,
    action_default_popup: action?.default_popup ?? null,
    action_default_title: action?.default_title ?? null,
    commands: m.commands ?? null,
    side_panel: m.side_panel ?? null,
    sidebar_action: m.sidebar_action ?? null,
    browser_specific_settings: m.browser_specific_settings ?? null,
    absent: Object.fromEntries(
      [
        'host_permissions',
        'optional_permissions',
        'optional_host_permissions',
        'web_accessible_resources',
        'content_security_policy',
        'externally_connectable',
      ].map((k) => [k, !(k in m)]),
    ),
    has_tabs_permission: (m.permissions ?? []).includes('tabs'),
  };
}

const canon = (v) =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x,
  );

for (const [browser, dir] of Object.entries(BUILDS)) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(ROOT, dir, 'manifest.json'), 'utf8'));
  } catch {
    continue; // reported by the A1 walk
  }
  const expected = JSON.parse(readFileSync(join(ROOT, 'scripts/expected-manifests', `${browser}.json`), 'utf8'));
  const actual = project(manifest);
  for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
    if (canon(actual[key]) !== canon(expected[key])) {
      fail(`${dir}/manifest.json`, `${key}: expected ${canon(expected[key])}, got ${canon(actual[key])} (A2)`);
    }
  }
}

if (findings.length) {
  console.error(`check-invariants: ${findings.length} finding(s)`);
  for (const f of findings) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`check-invariants: OK (${sources.length} source files, ${built.length} built files, 3 manifests)`);
