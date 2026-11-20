#!/usr/bin/env node
// Rasterises src/public/icons/icon.svg into the PNG sizes the manifests and stores need
// (SPEC М7), with @resvg/resvg-js — no browser involved.
//   npm run icons
// Output: src/public/icons/{16,32,48,128}.png and store-assets/logo-300.png (Edge logo).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = fileURLToPath(new URL('..', import.meta.url));
const icons = join(root, 'src', 'public', 'icons');
const store = join(root, 'store-assets');
const svg = readFileSync(join(icons, 'icon.svg'), 'utf8');

function render(size, file) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size }, background: 'rgba(0,0,0,0)' }).render().asPng();
  writeFileSync(file, png);
  console.log('wrote', file.slice(root.length));
}

mkdirSync(store, { recursive: true });
for (const size of [16, 32, 48, 128]) render(size, join(icons, `${size}.png`));
render(300, join(store, 'logo-300.png'));
