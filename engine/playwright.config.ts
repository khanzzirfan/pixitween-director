import { defineConfig, devices } from '@playwright/test';

// Own Vite server on its own port, so this never collides with the root e2e suite's servers or dev work on 5173.
const WEB_PORT = 5290;

export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  outputDir: '../test-results/engine',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx vite --config web/vite.config.ts',
    cwd: '..',
    port: WEB_PORT,
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
    // The lab is a dev page: React's `jsx-dev-runtime` only exports `jsxDEV` in the development
    // build, so a shell that exports NODE_ENV=production would leave every page blank.
    env: { DIRECTOR_WEB_PORT: String(WEB_PORT), NODE_ENV: 'development' },
  },
});
