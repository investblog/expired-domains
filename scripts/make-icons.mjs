#!/usr/bin/env node
// Rasterises src/public/icons/icon.svg into the PNG sizes the manifests and stores need
// (SPEC М7), with @resvg/resvg-js — no browser involved.
//   npm run icons
// Output: src/public/icons/{16,32,48,128}.png, store-assets/logo-300.png (Edge logo) and
// store-assets/icon-128.png (Chrome Web Store icon, padded).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = fileURLToPath(new URL('..', import.meta.url));
const icons = join(root, 'src', 'public', 'icons');
const store = join(root, 'store-assets');
const svg = readFileSync(join(icons, 'icon.svg'), 'utf8');

function render(size, file, source = svg) {
  const png = new Resvg(source, { fitTo: { mode: 'width', value: size }, background: 'rgba(0,0,0,0)' }).render().asPng();
  writeFileSync(file, png);
  console.log('wrote', file.slice(root.length));
}

mkdirSync(store, { recursive: true });
for (const size of [16, 32, 48, 128]) render(size, join(icons, `${size}.png`));
render(300, join(store, 'logo-300.png'));
// Chrome Web Store icon: 128×128 with the artwork at 96×96 and 16 px of transparent padding.
render(128, join(store, 'icon-128.png'), svg.replace('viewBox="0 0 128 128"', 'viewBox="-21.33 -21.33 170.67 170.67"'));
