import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { SET_AIR, SET_HELP, SET_LOOKS, WALL, groundColor, renderBackdrop, renderDot } from './set-art';

describe('the set vocabulary', () => {
  it('describes every look for Muse, and offers five kinds of air', () => {
    expect(Object.keys(SET_HELP).sort()).toEqual([...SET_LOOKS].sort());
    expect(SET_AIR).toEqual(['none', 'dust', 'bokeh', 'spray', 'smoke']);
  });
});

describe('renderBackdrop', () => {
  for (const look of SET_LOOKS) {
    it(`draws the ${look} look, wider than the frame it stands behind`, async () => {
      const r = await renderBackdrop({ look, ratio: 9 / 16 });
      const meta = await sharp(r.png).metadata();
      expect([meta.width, meta.height]).toEqual([r.width, r.height]);
      expect(r.width / r.height).toBeGreaterThan((9 / 16) * 2);
    });
  }
  it('stays within 2400 px however wide the frame', async () => {
    expect((await renderBackdrop({ look: 'beach', ratio: 16 / 9 })).width).toBe(2400);
  });
  it('is the same picture every time, and the light changes it', async () => {
    const a = await renderBackdrop({ look: 'sky', ratio: 9 / 16 });
    const b = await renderBackdrop({ look: 'sky', ratio: 9 / 16 });
    expect(a.png.equals(b.png)).toBe(true);
    const low = await renderBackdrop({ look: 'sky', ratio: 9 / 16, key: 'low' });
    expect(low.png.equals(a.png)).toBe(false);
  });
  it('puts the horizon at the bottom edge: the beach ends in the sea band', async () => {
    const r = await renderBackdrop({ look: 'beach', ratio: 9 / 16 });
    const { data, info } = await sharp(r.png).raw().toBuffer({ resolveWithObject: true });
    const px = (y: number) => [0, 1, 2].map((c) => data[(y * info.width + 10) * info.channels + c]!);
    const bottom = px(info.height - 10);
    expect(bottom[2]).toBeGreaterThan(bottom[0]!); // blue water, not sand
  });
});

describe('groundColor and the dot', () => {
  it('a low key darkens the floor', () => {
    const lum = (h: string) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);
    expect(lum(groundColor('beach', 'warm', 'low'))).toBeLessThan(lum(groundColor('beach', 'warm', 'high')));
  });
  it('the wall is 4 m high and 3.2 m back', () => {
    expect(WALL).toEqual({ distance: 3.2, height: 4 });
  });
  it('draws a soft dot', async () => {
    const d = await renderDot('#ffd7a3');
    expect([d.width, d.height]).toEqual([128, 128]);
  });
});
