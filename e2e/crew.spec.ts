import path from 'node:path';
import { expect, test } from '@playwright/test';

// Runs with `npm run e2e:crew` (crew mode on, fake workers slowed to 1.2 s so four lanes overlap).
const PRODUCT = path.resolve('fixtures/seed/mug-product.png');

test('crew studio: four builders at once, a mid-build message adds a scene, the film finishes', async ({ page }) => {
  const hosts = new Set<string>();
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.protocol.startsWith('http')) hosts.add(u.hostname);
  });

  await page.goto('/');
  // the chat intake replaces the form in crew mode
  await expect(page.getByRole("log", { name: "Conversation" })).toBeVisible();
  await page.getByLabel("Product photo").setInputFiles(PRODUCT);
  await page.getByLabel('Message').fill('A morning ritual with a ceramic mug, warm sunrise light');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page).toHaveURL(/[?&]film=film_/);

  const studio = page.getByTestId('crew-studio');
  await expect(studio).toBeVisible();

  // the crew board sits behind the Crew tab of the rail; four builder lanes are working at the same moment
  await page.getByTestId('rail-crew').click();
  const working = page.locator('.lane-builder .state-pill.st-working');
  await expect(working).toHaveCount(4, { timeout: 30_000 });

  // the map shows the same four builders lit
  await page.getByRole('tab', { name: 'Map' }).click();
  await expect(page.locator('[data-node^="builder:"].is-lit')).toHaveCount(4, { timeout: 15_000 });
  await page.getByRole('tab', { name: 'Lanes' }).click();

  // the hero scene is a 3D scene: its card says so, and the plan shows the reason on hover
  await page.getByTestId('rail-plan').click();
  await expect(page.locator('[data-scene="s1"] .tag.mode-3d')).toHaveText('3D');
  await expect(page.locator('[data-scene="s2"] .tag.mode-motion')).toHaveText('motion');
  await page.getByTestId('rail-crew').click();

  // a message while they work lands in the same thread; the plan grows
  await page.getByLabel('Message').fill('add a sunset scene after scene 2');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.bubble.you', { hasText: 'add a sunset scene after scene 2' })).toBeVisible();
  await expect.poll(async () => page.locator('[data-scene]').evaluateAll((els) => els.map((e) => e.getAttribute('data-scene'))), { timeout: 10_000 }).toHaveLength(5);
  const order = await page.locator('[data-scene]').evaluateAll((els) => els.map((e) => e.getAttribute('data-scene')));
  expect(order.indexOf('s5')).toBe(2); // third from the end of five: after s2

  // the showrunner answers under it, and the film finishes
  await expect(page.locator('.bubble.crew', { hasText: /sunset/i }).first()).toBeVisible();
  await expect(page.getByTestId('film-status')).toHaveText('ready', { timeout: 90_000 });
  await expect(page.locator('[data-scene]')).toHaveCount(5);
  await expect(page.locator('.bubble.k-ready')).toBeVisible();

  // the player draws something once it plays (the first frame is the bare background)
  await page.getByTestId('slot-player').getByRole('button', { name: 'Play' }).click();
  const painted = () =>
    page.locator('[data-testid="slot-player"] canvas').first().evaluate((c: HTMLCanvasElement) => {
      const small = document.createElement('canvas');
      small.width = 16;
      small.height = 9;
      const ctx = small.getContext('2d')!;
      ctx.drawImage(c, 0, 0, 16, 9);
      const d = ctx.getImageData(0, 0, 16, 9).data;
      return new Set(Array.from({ length: 144 }, (_, i) => `${d[i * 4]},${d[i * 4 + 1]},${d[i * 4 + 2]}`)).size > 1;
    });
  await expect.poll(painted, { timeout: 15_000 }).toBe(true);

  expect([...hosts].filter((h) => h !== 'localhost' && h !== '127.0.0.1')).toEqual([]);

  // the film just made can be watched being made: the same log played back, read-only, from the gallery's address
  const filmId = new URL(page.url()).searchParams.get('film')!;
  await page.goto(`/?film=${filmId}&replay=1`);
  await expect(page.getByRole('group', { name: 'Replay' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Watch again' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByLabel('Message')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Cancel/ })).toHaveCount(0);
  await page.getByTestId('rail-crew').click();
  await expect(page.locator('.lane-builder').first()).toBeVisible();
});
