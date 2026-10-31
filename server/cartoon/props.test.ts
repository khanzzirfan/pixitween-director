import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { propModel, propSrc } from './props';

describe('the toy prop library', () => {
  it.each([
    ['cold-brew-can', 'q-sodacan'],
    ['alarm clock', 'clock'],
    ['bedside lamp', 'q-light-desk'],
    ['tiny bed', 'q-bed-single'],
    ['kitchen counter', 'q-kitchen-2drawers'],
    ['the fridge', 'q-kitchen-fridge'],
    ['sunny window', 'q-window-large1'],
    ['red rug', 'q-carpet-round'],
    ['coffee mug', 'mug'],
    ['mystery thing', 'crate'],
  ])('%s is the %s model', (name, model) => {
    expect(propModel(name)).toBe(model);
  });

  it('every model it can name is a file the web app serves', () => {
    const quaternius = ['sodacan', 'nightstand-1', 'bed-single', 'light-desk', 'light-floor1', 'carpet-round', 'houseplant-1', 'kitchen-fridge', 'kitchen-oven', 'kitchen-sink', 'kitchen-2drawers', 'kitchen-cabinet1', 'couch-small1', 'bookshelf', 'window-large1', 'curtains-double', 'table-roundsmall', 'chair-1', 'stool', 'trashcan-small1', 'plate-1', 'cake', 'cupcake', 'milkshake', 'pizza', 'icecream'].map((n) => `q-${n}`);
    for (const m of [...quaternius, 'can', 'clock', 'lamp', 'bed', 'counter', 'table', 'window', 'rug', 'plant', 'mug', 'books', 'chair', 'ball', 'crate']) {
      expect(existsSync(new URL(`../../web/public${propSrc(m)}`, import.meta.url)), m).toBe(true);
    }
  });
});
