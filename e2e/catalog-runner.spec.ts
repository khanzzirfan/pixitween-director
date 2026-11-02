import { expect, test } from '@playwright/test';

// The catalog flow on fake art (the e2e server runs with DIRECTOR_FAKE=1): demo feed to a full wall, then a price edit.
test('demo feed fills the wall, and a price edit updates the Stone Mug clip', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  // Catalog is the default tab of a studio with no film; clicking the active tab would collapse it.
  const demo = page.getByRole('button', { name: 'Use demo feed (6 products)' });
  if (!(await demo.isVisible())) await page.getByTestId('rail-catalog').click();
  await demo.click();
  await expect(page).toHaveURL(/[?&]catalog=cat_/);

  const head = page.getByTestId('catalog-head');
  await expect(head).toHaveText(/^6\/6 done/, { timeout: 60_000 });
  await expect(page.locator('[data-row]')).toHaveCount(6);

  // the Stone Mug starts at $19.00, on sale from $24.00
  const stone = page.locator('[data-row]', { hasText: 'Stone Mug' });
  await expect(stone).toContainText('$19.00');
  await stone.getByRole('button', { name: /Stone Mug/ }).click();
  await expect(page.locator('[data-testid="slot-player"] canvas').first()).toBeVisible();

  // the row has a hero film (Muse's board, here the floor board on fake art); the edit is checked on the tile, which the
  // software renderer of the test browser plays at speed (a real GPU plays the film at about 70 fps)
  await expect(stone.getByRole('button', { name: 'Film' })).toHaveAttribute('aria-pressed', 'true');
  await stone.getByRole('button', { name: 'Tile' }).click();
  await stone.getByLabel('on sale').uncheck();
  const price = stone.getByLabel('Price of Stone Mug');
  await price.fill('21');
  await price.press('Enter');
  await expect(stone).toContainText('$21.00', { timeout: 5000 });
  await expect(stone).toContainText('updated in', { timeout: 5000 });
  await expect(head).toHaveText(/^6\/6 done/);

  await page.screenshot({ path: 'debug/app/catalog-runner.png' });
  expect(errors.filter((e) => /WebGL|context lost/i.test(e))).toEqual([]);
});
