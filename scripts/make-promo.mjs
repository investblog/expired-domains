#!/usr/bin/env node
// Store promo tiles (SPEC М7): CWS / Edge small tile 440×280 and marquee 1400×560, drawn as SVG
// and rasterised with @resvg/resvg-js (no browser). The marquee shows the real side panel, cut
// from store-assets/screenshot-1-list-1280x800.png (make it first with scripts/store-harness.mjs).
//   npm run promo
// Output is a 24-bit PNG without alpha (CWS accepts JPEG or 24-bit PNG): resvg's RGBA is
// flattened and re-encoded here with node:zlib.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { Resvg } from '@resvg/resvg-js';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'store-assets');
const FONT = "'Segoe UI', 'Inter', Arial, sans-serif";

// The icon's inner shapes, re-used inside the tiles (comments dropped: `--` is not allowed in them).
const iconSvg = readFileSync(join(root, 'src/public/icons/icon.svg'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const iconInner = iconSvg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const icon = (x, y, size) => `<g transform="translate(${x} ${y}) scale(${size / 128})">${iconInner}</g>`;

const background = (w, h) => `
  <defs>
    <radialGradient id="bg" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse"
      gradientTransform="translate(0 0) scale(${w * 0.95} ${h * 1.1})">
      <stop offset="0" stop-color="#123a6e"/><stop offset="0.5" stop-color="#0b1626"/><stop offset="1" stop-color="#0a0f18"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>`;

const chips = (x, y, items, size) => {
  let cx = x;
  return items
    .map((text) => {
      const w = Math.round(text.replace(/&amp;/g, '&').length * size * 0.56 + size * 1.6);
      const s = `<rect x="${cx}" y="${y}" width="${w}" height="${size * 1.9}" rx="${size * 0.95}" fill="#4DA3FF" fill-opacity="0.12" stroke="#4DA3FF" stroke-opacity="0.55"/>
        <text x="${cx + w / 2}" y="${y + size * 1.32}" font-size="${size}" font-weight="600" fill="#cfe4ff" text-anchor="middle">${text}</text>`;
      cx += w + size * 0.6;
      return s;
    })
    .join('');
};

function small() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="280" viewBox="0 0 440 280" font-family="${FONT}">
  ${background(440, 280)}
  ${icon(32, 36, 64)}
  <text x="110" y="66" font-size="30" font-weight="700" fill="#E7E9EE">Expired Domains</text>
  <text x="110" y="92" font-size="14" fill="#A0A4AF">for expireddomains.net lists</text>
  <text x="32" y="150" font-size="19" font-weight="600" fill="#E7E9EE">Collect every list page you browse.</text>
  <text x="32" y="176" font-size="19" font-weight="600" fill="#E7E9EE">Filter, tag, export to CSV.</text>
  ${chips(32, 202, ['Side panel', 'Filters', 'Tags', 'CSV / TXT'], 12)}
  <text x="32" y="262" font-size="10.5" fill="#7A7E87">Unofficial. Not affiliated with ExpiredDomains.net</text>
</svg>`;
}

function marquee() {
  const shot = readFileSync(join(out, 'screenshot-1-list-1280x800.png')).toString('base64');
  // The panel sits at x 778–1208, y 40–760 in the 1280×800 frame; scale it to 486 px high.
  const s = 0.675;
  const px = 1030;
  const py = 37;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1400" height="560" viewBox="0 0 1400 560" font-family="${FONT}">
  ${background(1400, 560)}
  ${icon(80, 92, 96)}
  <text x="200" y="146" font-size="54" font-weight="700" fill="#E7E9EE">Expired Domains</text>
  <text x="200" y="182" font-size="20" fill="#A0A4AF">for expireddomains.net lists</text>
  <text x="80" y="268" font-size="34" font-weight="600" fill="#E7E9EE">Every list page you browse — in one place.</text>
  <text x="80" y="312" font-size="34" font-weight="600" fill="#E7E9EE">Filter, tag and export to CSV or TXT.</text>
  ${chips(80, 352, ['Side panel', 'Filters &amp; presets', 'Statuses &amp; tags', 'CSV · TXT · JSON'], 17)}
  <text x="80" y="474" font-size="16" fill="#7A7E87">No requests, no tracking — data stays in your browser.</text>
  <text x="80" y="500" font-size="14" fill="#7A7E87">Unofficial. Not affiliated with ExpiredDomains.net</text>
  <defs><clipPath id="panel"><rect x="${px}" y="${py}" width="${430 * s}" height="${720 * s}" rx="10"/></clipPath></defs>
  <rect x="${px - 1}" y="${py - 1}" width="${430 * s + 2}" height="${720 * s + 2}" rx="11" fill="#000" fill-opacity="0.35"/>
  <g clip-path="url(#panel)">
    <image x="${px - 778 * s}" y="${py - 40 * s}" width="${1280 * s}" height="${800 * s}" xlink:href="data:image/png;base64,${shot}"/>
  </g>
  <rect x="${px}" y="${py}" width="${430 * s}" height="${720 * s}" rx="10" fill="none" stroke="#ffffff" stroke-opacity="0.12"/>
</svg>`;
}

/** RGBA → 24-bit RGB PNG (colour type 2, no alpha), composited over `bg`. */
function rgbPng(rgba, width, height, bg = [10, 15, 24]) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = rgba[i + 3] / 255;
      const o = y * (width * 3 + 1) + 1 + x * 3;
      for (let c = 0; c < 3; c++) raw[o + c] = Math.round(rgba[i + c] * a + bg[c] * (1 - a));
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function render(svg, file) {
  const img = new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' } }).render();
  writeFileSync(join(out, file), rgbPng(img.pixels, img.width, img.height));
  console.log('wrote', `store-assets/${file}`, `${img.width}×${img.height}`);
}

render(small(), 'promo-small-440x280.png');
render(marquee(), 'promo-marquee-1400x560.png');
