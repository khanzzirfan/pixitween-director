import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

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
          include: ['server/**/*.test.ts', 'shared/**/*.test.ts', 'scripts/**/*.test.ts', 'deploy/**/*.test.ts', 'engine/fixtures/**/*.test.ts'],
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
          exclude: [...configDefaults.exclude, 'engine/fixtures/**'], // the engine fixtures test reads web/public with node:fs, so it runs in the node project
          setupFiles: ['./web/src/test-setup.ts'],
          server: { deps: { inline: ['@pixi/react', 'reacthub-pixitweenjs'] } },
        },
      },
    ],
  },
});
