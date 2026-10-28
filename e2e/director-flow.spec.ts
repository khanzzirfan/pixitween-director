import path from 'node:path';
import { expect, test } from '@playwright/test';

// Playwright runs from the project root, so this resolves to the repo's seed photo.
const PRODUCT = path.resolve('fixtures/seed/mug-product.png');

test('prompt to film, chat edit, undo and redo, layer select', async ({ page }) => {
  await page.goto('/');

  // Brief: upload a product photo and describe the film.
  await page.getByLabel('Product photo').setInputFiles(PRODUCT);
  await page.getByRole('textbox', { name: 'Brief', exact: true }).fill('A morning ritual with a ceramic mug, warm sunrise light');
  await page.getByRole('button', { name: 'Create my storyboard →' }).click();

  // The fake director builds the film; the URL picks up the film id and the status reaches ready.
  await expect(page).toHaveURL(/[?&]film=film_/);
  await expect(page.getByTestId('film-status')).toHaveText('ready', { timeout: 60_000 });

  // Chat edit: the fake edit backend scales the headline and replies.
  const undo = page.getByRole('button', { name: 'Undo' });
  const redo = page.getByRole('button', { name: 'Redo' });
  await page.getByLabel('Edit request').fill('make the headline bigger');
  await page.getByRole('button', { name: 'Send request →' }).click();
  await expect(page.getByText('Changes applied')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('scaleLayer s1:headline')).toBeVisible();
  await expect(undo).toBeEnabled();
  await expect(redo).toBeDisabled();

  // Undo reverts the edit, which makes redo available; redo applies it again.
  await undo.click();
  await expect(redo).toBeEnabled({ timeout: 15_000 });
  await redo.click();
  await expect(redo).toBeDisabled({ timeout: 15_000 });
  await expect(undo).toBeEnabled();

  // Layer select: picking the headline in the Layers list sets the editing target.
  await page.getByText('Layers', { exact: true }).click();
  await page.getByRole('button', { name: /s1:headline/ }).click();
  await expect(page.getByText(/Editing: s1:headline/)).toBeVisible();
});
