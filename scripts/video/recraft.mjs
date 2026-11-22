#!/usr/bin/env node
// Text-free art for the promo video from the Recraft API (titles and captions are HTML on top).
//   node scripts/video/recraft.mjs balance
//   node scripts/video/recraft.mjs generate <spec.json> <outDir>
//   node scripts/video/recraft.mjs upscale <in.png> <out.png>
// The token is RECRAFT_API_TOKEN, read from the environment or the project's local env file;
// it is only ever sent in the Authorization header and never printed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const envFile = join(root, '.env.local');
if (!process.env.RECRAFT_API_TOKEN && existsSync(envFile)) process.loadEnvFile(envFile);
const token = process.env.RECRAFT_API_TOKEN;
if (!token) {
  console.error('RECRAFT_API_TOKEN is not set');
  process.exit(2);
}
const API = 'https://external.api.recraft.ai/v1';
const auth = { Authorization: `Bearer ${token}` };

// The store frames' palette (scripts/store-harness.mjs).
const PALETTE = [
  [10, 15, 24],
  [18, 58, 110],
  [77, 163, 255],
  [231, 233, 238],
];

async function call(path, init) {
  const res = await fetch(`${API}${path}`, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

async function download(url, out) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download: HTTP ${res.status}`);
  writeFileSync(out, Buffer.from(await res.arrayBuffer()));
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === 'balance') {
  const me = await call('/users/me', { headers: auth });
  console.log(`credits: ${me.credits}`);
} else if (cmd === 'generate') {
  // spec: [{ name, prompt, n?, size?, model?, colors? (false = no palette) }]
  const spec = JSON.parse(readFileSync(a, 'utf8'));
  mkdirSync(b, { recursive: true });
  let spent = 0;
  for (const item of spec) {
    const body = {
      prompt: item.prompt,
      model: item.model ?? 'recraftv4_1',
      size: item.size ?? '16:9',
      n: item.n ?? 2,
      image_format: 'png',
    };
    if (item.colors !== false) body.controls = { colors: PALETTE.map((rgb) => ({ rgb })) };
    const res = await call('/images/generations', {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    spent += res.credits ?? 0;
    for (const [i, img] of res.data.entries()) {
      const out = join(b, `${item.name}-${i + 1}.png`);
      await download(img.url, out);
      console.log(out);
    }
  }
  console.log(`credits spent: ${spent}`);
} else if (cmd === 'upscale') {
  const form = new FormData();
  form.append('file', new Blob([readFileSync(a)]), 'in.png');
  form.append('image_format', 'png');
  const res = await call('/images/crispUpscale', { method: 'POST', headers: auth, body: form });
  await download(res.image.url, b);
  console.log(`${b} (credits: ${res.credits ?? '?'})`);
} else {
  console.error('usage: recraft.mjs balance | generate <spec.json> <outDir> | upscale <in> <out>');
  process.exit(2);
}
