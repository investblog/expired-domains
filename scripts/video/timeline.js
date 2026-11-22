// Promo video timeline: a shared demo store for every frame, then the scripted scenes.
// Times are page time; capture.mjs steps virtual time, so the result is frame-exact.
(() => {
  // The real list path, so the side panel shows its "Deleted" kind and list name.
  const LIST = 'member.expireddomains.net/domains/expiredcom/';
  const clone = (v) => JSON.parse(JSON.stringify(v));

  // ---------------------------------------------------------------- shared demo store

  const data = {
    meta: { schema: 2, sources: {}, rev: 1, domainCount: 0, columnOrder: [], columns: {} },
    settings: {
      autoCapture: false,
      panelCollapsed: false,
      filterPresets: [{ id: 'p1', name: 'Short .com, BL 50+', filter: { zones: ['com'], minBl: 50, maxNameLength: 14 } }],
      activePreset: 'all',
    },
  };
  const listeners = new Set();
  const changed = () => {
    data.meta.rev += 1;
    data.meta.domainCount = Object.keys(data).filter((k) => k.startsWith('d:')).length;
    const changes = { meta: { newValue: clone(data.meta) } };
    for (const l of listeners)
      setTimeout(() => {
        try {
          l(changes, 'local');
        } catch {
          listeners.delete(l); // a frame that navigated away
        }
      }, 0);
  };
  const ok = (result) => ({ ok: true, result });

  window.__demo = {
    listeners,
    get(keys) {
      if (keys == null) return clone(data);
      const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const out = {};
      for (const k of list) if (k in data) out[k] = clone(data[k]);
      return out;
    },
    handle(msg) {
      const now = Date.now();
      switch (msg.type) {
        case 'eds:add': {
          const c = msg.capture;
          data.meta.sources[LIST] = c.sourceLabel;
          for (const col of c.columns) {
            if (col.key === 'domain') continue;
            data.meta.columns[col.key] = { label: col.label, title: col.title };
            if (!data.meta.columnOrder.includes(col.key)) data.meta.columnOrder.push(col.key);
          }
          let added = 0;
          let updated = 0;
          for (const row of c.rows) {
            const key = `d:${row.domain}`;
            const r = data[key];
            if (r) {
              Object.assign(r, { lastSeen: now, lastSource: LIST, stats: row.stats });
              if (!r.lists.includes(LIST)) r.lists.push(LIST);
              updated++;
            } else {
              data[key] = { firstSeen: now, lastSeen: now, lists: [LIST], lastSource: LIST, stats: row.stats };
              added++;
            }
          }
          changed();
          return ok({ added, updated, total: data.meta.domainCount });
        }
        case 'eds:update': {
          const p = msg.patch;
          for (const d of msg.domains) {
            const r = data[`d:${d}`];
            if (!r) continue;
            if (p.status !== undefined) r.status = p.status;
            if (p.note !== undefined) r.note = p.note;
            if (p.addTags) r.tags = [...new Set([...(r.tags ?? []), ...p.addTags])];
          }
          changed();
          return ok({ changed: msg.domains.length, overflow: 0 });
        }
        case 'eds:setSettings':
          Object.assign(data.settings, msg.settings);
          changed();
          return ok(null);
        default:
          return ok({ changed: 0, overflow: 0, deleted: 0, kept: 0 });
      }
    },
  };

  // ---------------------------------------------------------------- helpers

  const $ = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const doc = (frame) => $(frame).contentDocument;
  const panelRoot = () => doc('page').getElementById('expired-domains-panel-301st').shadowRoot;
  const byText = (root, sel, text) => [...root.querySelectorAll(sel)].find((e) => e.textContent.trim() === text);
  const scene = (id) => {
    for (const s of document.querySelectorAll('.scene')) s.classList.toggle('on', s.id === id);
  };

  /** Centre of an element inside a (possibly scaled) iframe, in page coordinates. */
  const at = (frame, el) => {
    const f = $(frame);
    const fr = f.getBoundingClientRect();
    const s = fr.width / f.offsetWidth;
    const r = el.getBoundingClientRect();
    return [fr.left + (r.left + r.width / 2) * s, fr.top + (r.top + r.height / 2) * s];
  };
  const cursor = $('cursor');
  const moveTo = async ([x, y], ms = 800) => {
    cursor.classList.add('on');
    cursor.style.transitionDuration = `${ms}ms, .3s`;
    cursor.style.transform = `translate(${x - 3}px, ${y - 2}px)`;
    await wait(ms);
  };
  const jump = ([x, y]) => {
    cursor.style.transitionDuration = '0s, .3s';
    cursor.style.transform = `translate(${x - 3}px, ${y - 2}px)`;
  };
  const ripple = ([x, y]) => {
    const r = document.createElement('div');
    r.className = 'ripple';
    r.style.left = `${x}px`;
    r.style.top = `${y}px`;
    document.body.append(r);
    setTimeout(() => r.remove(), 700);
  };
  /** Move to an element, then click it. */
  const press = async (frame, el, ms = 800) => {
    const p = at(frame, el);
    await moveTo(p, ms);
    await wait(150);
    ripple(p);
    el.click();
    await wait(250);
  };
  const type = async (el, text, every = 120) => {
    el.focus();
    for (const ch of text) {
      el.value += ch;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(every);
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const step = async (n, text) => {
    const span = $('step-text');
    span.style.opacity = '0';
    await wait(350);
    $('step-n').textContent = String(n);
    span.textContent = text;
    span.style.opacity = '1';
  };
  const scrollBy = async (el, px, ms) => {
    const start = el.scrollTop;
    const frames = Math.round(ms / (1000 / 30));
    for (let i = 1; i <= frames; i++) {
      const k = i / frames;
      el.scrollTop = start + px * (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
      await wait(1000 / 30);
    }
  };

  // ---------------------------------------------------------------- preload

  const loaded = (id, src) =>
    new Promise((r) => {
      $(id).addEventListener('load', r, { once: true });
      $(id).src = src;
    });
  window.__videoReady = Promise.all([
    loaded('page', '/demo-list.html?page=1'),
    loaded('side1', '/sidepanel.html?theme=dark'),
    loaded('side2', '/sidepanel.html?theme=dark'),
    loaded('side3', '/sidepanel.html?theme=dark'),
  ])
    .then(() => wait(800))
    .then(() => {
      window.__videoIsReady = true;
    });

  // ---------------------------------------------------------------- the timeline

  async function run() {
    const t0 = performance.now();
    window.__t0 = t0;
    // Scene times below count from the intro; the 301.st card plays before it.
    const STUDIO = 2200;
    const until = (ms) => {
      const late = performance.now() - t0 - STUDIO - ms;
      if (late > 0) console.log(`late by ${Math.round(late)} ms for ${ms}`);
      return wait(Math.max(0, -late));
    };
    // Narration cue: scripts/video/render.mjs places the line `id` at this time (+ lead).
    const cue = (id, lead = 250) => console.log(`cue ${id} at ${Math.round(performance.now() - t0 + lead)} ms`);

    // Scene times are fitted to the narration (scripts/video/narration.json, ljspeech):
    // each scene lasts at least its line + 250 ms lead-in + 900 ms pause.
    // 0 — the 301.st card, already on screen at frame 0
    $('studio').classList.add('grow');
    await until(0);
    // A — intro
    scene('intro');
    cue('intro');
    await until(6700);
    // B — the idea
    scene('idea');
    cue('idea');
    await until(14700);

    // C — save a page, turn on auto-capture, the next page saves itself
    scene('browse');
    log('browse');
    cue('save');
    jump([980, 640]);
    await until(15400);
    await zoomPanel(true);
    await press('page', panelRoot().querySelector('.save'), 700);
    await until(18400);
    await zoomPanel(false);
    await until(19800);
    await step(2, 'Turn on auto-capture — every list page you open is saved');
    cue('auto', 0);
    await zoomPanel(true);
    await press('page', panelRoot().querySelector('.auto input'), 700);
    await wait(500);
    await moveTo([600, 640], 600);
    $('url').textContent = 'demo list page · page 2 of 3';
    $('page').src = '/demo-list.html?page=2';
    await until(25400);
    await zoomPanel(false);
    await step(3, 'The side panel updates live while you browse');
    cue('live', 0);
    const list1 = doc('side1').querySelector('.list-scroll');
    await moveTo(at('side1', list1), 700);
    await scrollBy(list1, 420, 1600);
    await until(30000);

    // D — filters
    cursor.classList.remove('on');
    scene('filter');
    log('filter');
    cue('filter');
    const d2 = doc('side2');
    jump([760, 600]);
    await until(30800);
    await press('side2', d2.querySelector('.filter-btn'), 800);
    await wait(400);
    const drawer = d2.querySelector('[data-drawer="filters"]');
    const zones = drawer.querySelector('input[placeholder="com, net, co.uk"]');
    zones.scrollIntoView({ block: 'center' });
    await wait(100);
    await press('side2', zones, 600);
    await type(zones, 'com');
    const minBl = [...drawer.querySelectorAll('input[type="number"]')][3];
    await press('side2', minBl, 500);
    await type(minBl, '100');
    await wait(500);
    await press('side2', drawer.querySelector('.drawer__footer .btn--primary'), 600);
    await until(39000);

    // E — select, bulk status, export
    cursor.classList.remove('on');
    scene('mark');
    log('mark');
    cue('mark');
    const d3 = doc('side3');
    const msg = (k) => d3.defaultView.chrome.i18n.getMessage(k);
    jump([760, 620]);
    await until(39800);
    const boxes = [...d3.querySelectorAll('.row > input')];
    await press('side3', boxes[0], 700);
    await press('side3', boxes[2], 300);
    await press('side3', boxes[3], 300);
    await wait(200);
    await press('side3', byText(d3, 'button', msg('bulkEdit')), 600);
    await wait(400);
    const bulk = d3.querySelector('[data-drawer="bulk"]') ?? d3;
    const select = bulk.querySelector('select');
    await press('side3', select, 600);
    select.value = 'shortlist';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(300);
    await press('side3', byText(bulk, 'button', msg('bulkSetStatus')), 500);
    await wait(700);
    await press('side3', bulk.querySelector('.drawer__close'), 500);
    await wait(800);
    const exportBar = d3.querySelector('.exportbar__actions');
    await moveTo(at('side3', exportBar), 700);
    const f = $('side3').getBoundingClientRect();
    const r = exportBar.getBoundingClientRect();
    const ring = document.createElement('div');
    ring.className = 'ring';
    Object.assign(ring.style, { left: `${f.left + r.left - 6}px`, top: `${f.top + r.top - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` });
    $('mark').append(ring);
    await until(51200);

    // F — outro
    cursor.classList.remove('on');
    scene('outro');
    log('outro');
    cue('outro');
  }

  /** Camera: move in on the on-page panel (2×, centred) or back out to the whole window. */
  const zoomPanel = async (into) => {
    const win = document.querySelector('.win');
    win.style.transition = 'transform 1s cubic-bezier(.45,.05,.25,1)';
    if (into) {
      win.style.transform = 'none';
      const w = win.getBoundingClientRect();
      const [px, py] = at('page', panelRoot().querySelector('.panel'));
      win.style.transformOrigin = `${px - w.left}px ${py - w.top}px`;
      win.style.transform = `translate(${640 - px}px, ${400 - py}px) scale(2)`;
    } else {
      win.style.transform = 'none';
    }
    await wait(1050);
  };
  const log = (what) => console.log(`${what} at ${Math.round(performance.now() - window.__t0)} ms`);

  let started = false;
  window.__videoStart = () => {
    if (started) return;
    started = true;
    void run().catch((e) => console.log('timeline error:', e?.stack ?? String(e)));
  };
  // Opened by hand: play once loaded. capture.mjs opens /video.html?hold and starts it itself.
  if (!/[?&]hold\b/.test(location.search)) window.__videoReady.then(() => window.__videoStart());
})();
