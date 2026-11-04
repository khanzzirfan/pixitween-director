import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import type { Comp } from '../../authoring/types';
import { contrast, leavingAt, wordContrast, wordTimes, WORD_CONTRAST_MIN } from './words';

/** A 10 s film at 30 fps with one line of 3D words: in from frame 30 (fully in by about 1.2 s), leaving from frame 120, gone at 150. */
const film = (color = '#ffffff'): Comp =>
  ({
    width: 1080,
    height: 1920,
    fps: 30,
    durationInFrames: 300,
    precomps: {
      cine: {
        layers: [
          {
            id: 'cine:title-words-1',
            kind: 'prop3d',
            stage: 'cine:titles',
            outPoint: 150,
            position: [0, 0, 0],
            material: { color },
            source: { type: 'text3d', text: 'softly wakes morning', font: 'font-optimer_regular', size: 0.12, enter: { style: 'rise', atFrame: 30, each: 0.02, seconds: 0.4 }, exit: { atFrame: 120 } },
          },
        ],
      },
    },
  }) as unknown as Comp;

const plain = (r: number, g: number, b: number) => sharp({ create: { width: 540, height: 960, channels: 3, background: { r, g, b } } }).png().toBuffer();

describe('leavingAt', () => {
  it('is true only while the words are on their way out', () => {
    expect(leavingAt(film(), 2)).toBe(false);
    expect(leavingAt(film(), 4.5)).toBe(true);
    expect(leavingAt(film(), 5.5)).toBe(false);
  });
});

describe('contrast', () => {
  it('is 21 for black on white and 1 for one colour', () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 0);
    expect(contrast([200, 100, 50], [200, 100, 50])).toBe(1);
  });
});

describe('wordContrast', () => {
  it('names white words on the blush set of 4 Nov (1.59:1), read on a frame where they are fully in', async () => {
    const problems = await wordContrast([await plain(222, 199, 206), await plain(222, 199, 206)], [0.5, 2], film());
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"softly wakes morning" barely show at 2.0 s');
    expect(problems[0]).toMatch(/plate/);
  });
  it('passes white words on a deeper pink (2:1, which read) and on a dark set', async () => {
    expect(contrast([255, 255, 255], [224, 167, 184])).toBeGreaterThan(WORD_CONTRAST_MIN);
    expect(await wordContrast([await plain(224, 167, 184)], [2], film())).toEqual([]);
    expect(await wordContrast([await plain(30, 20, 40)], [2], film())).toEqual([]);
  });
  it('does not judge words that are coming in or leaving', async () => {
    expect(await wordContrast([await plain(222, 199, 206), await plain(222, 199, 206)], [1, 4.5], film())).toEqual([]);
  });
});

describe('wordTimes', () => {
  it('asks for a frame where the words are fully in only when the sheet has none', () => {
    expect(wordTimes(film(), [0.4, 4.5])).toEqual([1.3]);
    expect(wordTimes(film(), [0.4, 2, 4.5])).toEqual([]);
  });
});

describe('wordContrast on the letters as drawn', () => {
  it('passes flat-gold words that are drawn with deep shading on a cream set', async () => {
    const cream = { r: 225, g: 217, b: 207 };
    // the box of the words in the 1080 x 1920 film is about 700 x 60 at y 1505; in a 540 x 960 frame, half that
    const letters = await sharp({ create: { width: 300, height: 20, channels: 3, background: { r: 120, g: 80, b: 20 } } }).png().toBuffer();
    const frame = await sharp({ create: { width: 540, height: 960, channels: 3, background: cream } }).composite([{ input: letters, left: 120, top: 740 }]).png().toBuffer();
    expect(await wordContrast([frame], [2], film('#f2c463'))).toEqual([]);
  });
});
