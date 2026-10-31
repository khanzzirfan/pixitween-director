import path from 'node:path';
import { expect, test } from '@playwright/test';

// Runs with `npm run e2e:cartoon` (DIRECTOR_FAKE=1, CARTOON_MODE=true): the fake toy-studio crew casts, blocks three shots and the film plays, with no model and no forge.
const PRODUCT = path.resolve('fixtures/seed/mug-product.png');

test('cartoon studio: three blocked shots, a stage per scene, and the film plays', async ({ page }) => {
  const hosts = new Set<string>();
  const errors: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.protocol.startsWith('http')) hosts.add(u.hostname);
  });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('/');
  await expect(page.getByRole('log', { name: 'Conversation' })).toBeVisible();
  await page.getByLabel('Product photo').setInputFiles(PRODUCT);
  await page.getByLabel('Message').fill('A toy cartoon: Pip waves, walks and jumps for joy');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page).toHaveURL(/[?&]film=film_/);

  // the plan has the three shots and the film finishes
  await page.getByTestId('rail-plan').click();
  await expect(page.locator('[data-scene]')).toHaveCount(3, { timeout: 30_000 });
  await expect(page.getByTestId('film-status')).toHaveText('ready', { timeout: 90_000 });

  // the film the server holds has a stage3d world with an actor in each scene, and a cast that is ready
  const filmId = new URL(page.url()).searchParams.get('film')!;
  const film = await (await page.request.get(`/api/films/${filmId}`)).json();
  const comp = film.composition ?? film.film?.composition;
  for (const id of ['s1', 's2', 's3']) {
    const kinds = (comp.precomps[id].layers as Array<{ kind: string }>).map((l) => l.kind);
    expect(kinds).toEqual(expect.arrayContaining(['stage3d', 'actor3d']));
  }
  const cast = (film.cast ?? film.film?.cast) as Array<{ status: string }>;
  expect(cast.length).toBeGreaterThan(0);
  expect(cast.every((m) => m.status === 'ready')).toBe(true);

  // play to half way: the player draws, there is one canvas (the stage renders offscreen), and nothing errored
  const player = page.getByTestId('slot-player');
  await player.getByRole('button', { name: 'Play' }).click();
  await expect(player.getByTestId('player-time')).not.toHaveText('0:00.0', { timeout: 15_000 });
  await expect.poll(async () => player.getByTestId('player-time').textContent(), { timeout: 30_000 }).toMatch(/0:0[5-9]|0:1/);
  await player.getByRole('button', { name: 'Pause' }).click();
  expect(await player.locator('canvas').count()).toBeLessThanOrEqual(2);
  const painted = await player.locator('canvas').first().evaluate((c: HTMLCanvasElement) => {
    const small = document.createElement('canvas');
    small.width = 16;
    small.height = 9;
    const ctx = small.getContext('2d')!;
    ctx.drawImage(c, 0, 0, 16, 9);
    const d = ctx.getImageData(0, 0, 16, 9).data;
    return new Set(Array.from({ length: 144 }, (_, i) => `${d[i * 4]},${d[i * 4 + 1]},${d[i * 4 + 2]}`)).size > 1;
  });
  expect(painted).toBe(true);
  expect(errors.filter((e) => !/favicon|DevTools/i.test(e))).toEqual([]);
  expect([...hosts].filter((h) => h !== 'localhost' && h !== '127.0.0.1')).toEqual([]);
});
