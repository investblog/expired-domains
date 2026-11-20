import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing';

// Projects:
// - unit: node, with WXT's fake browser (WxtVitest);
// - dom (*.dom.test.ts): jsdom without WxtVitest — its esbuild breaks under jsdom's TextEncoder;
// - tz-* (*.tz.test.ts): date logic run twice, in UTC and in a DST zone (SPEC A13).
const alias = { '@': fileURLToPath(new URL('./src', import.meta.url)) };
const tz = (zone: string, name: string) => ({
  resolve: { alias },
  test: { name, environment: 'node', include: ['tests/**/*.tz.test.ts'], env: { TZ: zone } },
});

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [WxtVitest()],
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
          exclude: ['**/*.dom.test.ts', '**/*.tz.test.ts', '**/node_modules/**'],
        },
      },
      { resolve: { alias }, test: { name: 'dom', environment: 'jsdom', include: ['tests/**/*.dom.test.ts'] } },
      tz('UTC', 'tz-utc'),
      tz('America/New_York', 'tz-new-york'),
    ],
  },
});
