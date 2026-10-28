import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// The e2e run uses its own ports and data dir, so it never touches a dev server or ./data.
const API_PORT = 8799;
const WEB_PORT = 5199;
const dataDir = mkdtempSync(join(tmpdir(), 'director-e2e-'));

export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npx tsx server/main.ts',
      port: API_PORT,
      reuseExistingServer: false,
      stdout: 'ignore',
      stderr: 'pipe',
      env: {
        DIRECTOR_FAKE: '1',
        DIRECTOR_FAKE_DELAY_MS: '50',
        PORT: String(API_PORT),
        DATA_DIR: dataDir,
      },
    },
    {
      command: 'npx vite --config web/vite.config.ts',
      port: WEB_PORT,
      reuseExistingServer: false,
      stdout: 'ignore',
      stderr: 'pipe',
      env: {
        DIRECTOR_WEB_PORT: String(WEB_PORT),
        DIRECTOR_API_URL: `http://localhost:${API_PORT}`,
      },
    },
  ],
});
