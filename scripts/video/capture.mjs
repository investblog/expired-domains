#!/usr/bin/env node
// Frame-exact capture of a web page for the promo video: our own headless Chrome (a scratch
// profile, never the user's browser), driven over CDP with virtual time, so every frame is
// 1000/fps ms of page time no matter how slow the screenshot is.
//   node scripts/video/capture.mjs <url> <seconds> <outDir> [--fps 30] [--chrome <path>]
// The page may define `window.__videoReady` (a promise) to finish loading before t = 0 and
// `window.__videoStart()` to start its timeline at t = 0.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const fps = Number(opt('fps', 30));
const chromePath = opt('chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
const [url, seconds, outDir] = args;
if (!url || !seconds || !outDir) {
  console.error('usage: capture.mjs <url> <seconds> <outDir> [--fps 30]');
  process.exit(2);
}
const frames = Math.round(Number(seconds) * fps);
const step = 1000 / fps;
mkdirSync(outDir, { recursive: true });

const profile = mkdtempSync(join(tmpdir(), 'eds-video-'));
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--hide-scrollbars',
    '--mute-audio',
    '--disable-gpu-vsync',
    '--run-all-compositor-stages-before-draw',
    // Compositor-thread animations run on wall time; on the main thread they follow virtual time.
    '--disable-threaded-animation',
    '--disable-threaded-scrolling',
    '--disable-checker-imaging',
    'about:blank',
  ],
  { stdio: 'ignore' },
);
console.log(`chrome pid ${chrome.pid}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function devtoolsUrl() {
  const file = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100; i++) {
    if (existsSync(file)) {
      const [port, path] = readFileSync(file, 'utf8').split('\n');
      if (port && path) return `ws://127.0.0.1:${port.trim()}${path.trim()}`;
    }
    await sleep(100);
  }
  throw new Error('Chrome did not open a DevTools port');
}

// The animation clock is not virtual time (it runs ahead, and iframes drift), so CSS
// animations and transitions are paused as soon as they appear and moved one frame per frame.
// Covers the page, same-origin iframes and open shadow roots.
function stepAnimations(dt) {
  const roots = [];
  const walk = (doc) => {
    roots.push(doc);
    for (const el of doc.querySelectorAll('*')) if (el.shadowRoot) roots.push(el.shadowRoot);
    for (const f of doc.querySelectorAll('iframe')) {
      try {
        if (f.contentDocument) walk(f.contentDocument);
      } catch {}
    }
  };
  walk(document);
  const seen = new Set();
  for (const root of roots)
    for (const a of root.getAnimations()) {
      if (seen.has(a)) continue;
      seen.add(a);
      if (!a.__vt) {
        a.__vt = true;
        a.pause();
      } else if (a.playState === 'paused') a.currentTime = (a.currentTime ?? 0) + dt;
    }
}

const pageLog = [];
let ws;
let nextId = 1;
const pending = new Map();
const waiters = [];
function cdp(method, params = {}, sessionId) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject, method }));
}
function once(method) {
  return new Promise((resolve) => waiters.push({ method, resolve }));
}

async function main() {
  ws = new WebSocket(await devtoolsUrl());
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method) {
      for (let i = waiters.length - 1; i >= 0; i--)
        if (waiters[i].method === msg.method) waiters.splice(i, 1)[0].resolve(msg.params);
      if (msg.method === 'Runtime.consoleAPICalled') {
        const line = msg.params.args.map((a) => a.value ?? a.description).join(' ');
        pageLog.push(line); // saved as <outDir>/console.log: render.mjs reads the narration cues
        console.log('[page]', line);
      }
      if (msg.method === 'Runtime.exceptionThrown')
        console.log('[page error]', msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text);
    }
  };

  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
  const { sessionId: s } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  await cdp('Runtime.enable', {}, s);
  await cdp('Page.enable', {}, s);
  // 1280×720 CSS pixels at 1.5× = a 1920×1080 frame.
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1.5, mobile: false }, s);

  const advance = async (ms) => {
    const done = once('Emulation.virtualTimeBudgetExpired');
    await cdp('Emulation.setVirtualTimePolicy', { policy: 'pauseIfNetworkFetchesPending', budget: ms }, s);
    await done;
  };

  await cdp('Emulation.setVirtualTimePolicy', { policy: 'pause' }, s);
  await cdp('Page.navigate', { url }, s);
  // Load: give the page virtual time until its own ready promise settles (or 10 s).
  for (let waited = 0; waited < 10000; waited += 250) {
    await advance(250);
    const { result } = await cdp(
      'Runtime.evaluate',
      { expression: 'document.readyState === "complete" && (window.__videoIsReady ?? !window.__videoReady)', returnByValue: true },
      s,
    );
    if (result.value === true) break;
  }
  await cdp('Runtime.evaluate', { expression: 'window.__videoStart && window.__videoStart()' }, s);

  const t0 = Date.now();
  for (let f = 0; f < frames; f++) {
    if (f > 0) {
      await advance(step);
      await cdp('Runtime.evaluate', { expression: `(${stepAnimations})(${step})` }, s);
    }
    const { data } = await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 92, optimizeForSpeed: true }, s);
    writeFileSync(join(outDir, `${String(f).padStart(5, '0')}.jpg`), Buffer.from(data, 'base64'));
    if (f % fps === 0) process.stdout.write(`\r${f}/${frames} frames`);
  }
  writeFileSync(join(outDir, 'console.log'), `${pageLog.join('\n')}\n`);
  console.log(`\r${frames}/${frames} frames in ${((Date.now() - t0) / 1000).toFixed(1)} s → ${outDir}`);
}

try {
  await main();
} finally {
  // Browser.close ends the whole tree; killing only the top process leaves its renderers behind.
  try {
    await Promise.race([cdp('Browser.close'), sleep(3000)]);
  } catch {}
  try {
    ws?.close();
  } catch {}
  await sleep(500);
  if (process.platform === 'win32') spawn('taskkill', ['/T', '/F', '/PID', String(chrome.pid)], { stdio: 'ignore' });
  else chrome.kill();
  await sleep(1000);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {}
}
