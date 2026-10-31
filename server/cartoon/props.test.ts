import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { propModel, propSrc } from './props';

describe('the toy prop library', () => {
  it.each([
    ['cold-brew-can', 'can'],
    ['alarm clock', 'clock'],
    ['bedside lamp', 'lamp'],
    ['tiny bed', 'bed'],
    ['kitchen counter', 'counter'],
    ['sunny window', 'window'],
    ['red rug', 'rug'],
    ['mystery thing', 'crate'],
  ])('%s is the %s model', (name, model) => {
    expect(propModel(name)).toBe(model);
  });

  it('every model it can name is a file the web app serves', () => {
    for (const m of ['can', 'clock', 'lamp', 'bed', 'counter', 'table', 'window', 'rug', 'plant', 'mug', 'books', 'chair', 'ball', 'crate']) {
      expect(existsSync(new URL(`../../web/public${propSrc(m)}`, import.meta.url)), m).toBe(true);
    }
  });
});
