import { expect, it } from 'vitest';
import { inventPhotoPrompt } from './invent-photo';

it('describes a lone product on a plain backdrop from the brief', () => {
  const p = inventPhotoPrompt('a ceramic mug at sunrise');
  expect(p).toContain('ceramic mug at sunrise');
  expect(p).toMatch(/no text, no logos/);
});

it('takes brand names out of the description and still has something to draw', () => {
  expect(inventPhotoPrompt('Nike running shoes in blue')).not.toMatch(/nike/i);
  expect(inventPhotoPrompt('   ')).toContain('simple everyday product');
});
