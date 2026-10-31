import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// The e2e run uses its own ports and data dir, so it never touches a dev server or ./data.
// E2E_CREW=1 runs the crew studio flow (crew on, slower fake workers) on its own ports; the default run is the classic director.
const cartoon = process.env.E2E_CARTOON === '1';
const crew = process.env.E2E_CREW === '1' || cartoon;
const API_PORT = cartoon ? 8797 : crew ? 8798 : 8799;
const WEB_PORT = cartoon ? 5197 : crew ? 5198 : 5199;
const dataDir = mkdtempSync(join(tmpdir(), 'director-e2e-'));

export default defineConfig({
  testDir: 'e2e',
  testMatch: cartoon ? 'cartoon.spec.ts' : crew ? 'crew.spec.ts' : /^(?!.*(crew|cartoon)).*\.spec\.ts$/,
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
        DIRECTOR_FAKE_DELAY_MS: cartoon ? '300' : crew ? '1200' : '50',
        CREW_ENABLED: crew ? 'true' : 'false', // crew mode is on by default; the classic flow tests the single director
        PRODUCT_3D: crew && !cartoon ? 'true' : 'false',
        CARTOON_MODE: cartoon ? 'true' : 'false', // the toy-studio crew: fixture forge, fake blockers, a stage per scene // the crew run has a 3d hero scene, so the 3D path is rehearsed offline
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
