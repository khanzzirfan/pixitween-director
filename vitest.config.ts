import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const shared = fileURLToPath(new URL('./shared', import.meta.url));

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias: { '@shared': shared } },
        test: {
          name: 'server',
          environment: 'node',
          include: ['server/**/*.test.ts', 'shared/**/*.test.ts', 'scripts/**/*.test.ts', 'deploy/**/*.test.ts'],
        },
      },
      {
        resolve: {
          alias: { '@shared': shared },
          dedupe: ['react', 'react-dom', 'pixi.js', '@pixi/react', 'gsap', 'three'],
        },
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['web/**/*.test.{ts,tsx}', 'fixtures/**/*.test.ts'], // fixture tests may import the engine, which needs the jsdom project
          setupFiles: ['./web/src/test-setup.ts'],
          server: { deps: { inline: ['@pixi/react', 'reacthub-pixitweenjs'] } },
        },
      },
    ],
  },
});
