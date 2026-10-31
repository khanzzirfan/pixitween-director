import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const shared = fileURLToPath(new URL('./shared', import.meta.url));
const engine = fileURLToPath(new URL('./engine/src', import.meta.url));

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias: { '@shared': shared, '@engine': engine } },
        test: {
          name: 'server',
          environment: 'node',
          // existing film tests run the single director; the crew tests turn the crew on themselves
          setupFiles: ['./server/test-setup.ts'],
          include: ['server/**/*.test.ts', 'shared/**/*.test.ts', 'scripts/**/*.test.ts', 'deploy/**/*.test.ts'],
        },
      },
      {
        resolve: {
          alias: { '@shared': shared, '@engine': engine },
          dedupe: ['react', 'react-dom', 'pixi.js', '@pixi/react', 'gsap', 'three'],
        },
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['web/**/*.test.{ts,tsx}', 'fixtures/**/*.test.ts', 'engine/**/*.test.{ts,tsx}'], // fixture tests may import the engine, which needs the jsdom project
          setupFiles: ['./web/src/test-setup.ts'],
          server: { deps: { inline: ['@pixi/react', 'reacthub-pixitweenjs'] } },
        },
      },
    ],
  },
});
