import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// The compact studio: one full-height page, a rail, resizable panels, no page scroll on desktop, no sideways scroll on a phone.
const PRODUCT = path.resolve('fixtures/seed/mug-product.png');

async function makeFilm(page: Page) {
  await page.goto('/');
  await page.getByLabel('Product photo').setInputFiles(PRODUCT);
  await page.getByRole('textbox', { name: 'Brief', exact: true }).fill('A morning ritual with a ceramic mug, warm sunrise light');
  await page.getByRole('button', { name: 'Create my storyboard →' }).click();
  await expect(page).toHaveURL(/[?&]film=film_/);
  await expect(page.getByTestId('film-status')).toHaveText('ready', { timeout: 60_000 });
}

test('desktop: no page scroll, player and filmstrip in view, panels resize and remember, rail collapses', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await makeFilm(page);

  const doc = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(doc.sh).toBeLessThanOrEqual(doc.ch);
  expect(doc.sw).toBeLessThanOrEqual(doc.cw);

  const canvas = page.locator('[data-testid="slot-player"] canvas').first();
  const box = (await canvas.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(900);
  await expect(page.locator('[data-scene-chip]').first()).toBeInViewport();

  // dragging the left handle changes the left panel width, and a reload keeps it
  const left = page.locator('[data-panel][id="left"]');
  const before = (await left.boundingBox())!.width;
  const handle = page.locator('[data-panel-resize-handle-id]').first();
  const h = (await handle.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + 200);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + 120, h.y + 200, { steps: 6 });
  await page.mouse.up();
  const after = (await left.boundingBox())!.width;
  expect(after).toBeGreaterThan(before + 60);
  await page.waitForTimeout(400); // the panel library saves the layout on a short debounce
  await page.reload();
  await expect(left).toBeVisible();
  await expect.poll(async () => Math.abs((await left.boundingBox())!.width - after), { timeout: 5000 }).toBeLessThan(3);

  // the stepper follows the status, and the active rail tab collapses the left panel
  await expect(page.locator('.sh-steps li[aria-current="step"]')).toHaveText(/Export/);
  await page.getByTestId('rail-plan').click();
  await expect.poll(async () => (await left.boundingBox())?.width ?? 0).toBeLessThan(4);
  await page.getByTestId('rail-plan').click();
  await expect.poll(async () => (await left.boundingBox())?.width ?? 0).toBeGreaterThan(150);
});

test('phone: no sideways scroll and the bottom tab bar is visible', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await makeFilm(page);
  const doc = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(doc.sw).toBeLessThanOrEqual(doc.cw);
  await expect(page.getByTestId('rail-plan')).toBeInViewport();
});
