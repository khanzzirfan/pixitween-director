import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { SET_AIR, SET_HELP, SET_LOOKS, SET_TEXTURES, WALL, groundColor, renderBackdrop, renderDot } from './set-art';

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

describe("Muse's palette", () => {
  const px = async (o: Parameters<typeof renderBackdrop>[0], x: number, y: number) => {
    const r = await renderBackdrop(o);
    const { data, info } = await sharp(r.png).raw().toBuffer({ resolveWithObject: true });
    return [0, 1, 2].map((c) => data[(y * info.width + x) * info.channels + c]!);
  };
  it('its sky colours replace the look\'s: a red world is red where the night look is blue', async () => {
    const night = await px({ look: 'night', ratio: 9 / 16 }, 40, 900);
    const wine = await px({ look: 'night', ratio: 9 / 16, palette: { top: '#4a0a1c', horizon: '#c23a52' } }, 40, 900);
    expect(night[2]).toBeGreaterThan(night[0]!);
    expect(wine[0]).toBeGreaterThan(wine[2]!);
  });
  it('its floor replaces the look\'s and the film\'s light still moves it', () => {
    expect(groundColor('beach', undefined, undefined, { ground: '#7a1020' })).toBe('#7a1020');
    const lum = (h: string) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);
    expect(lum(groundColor('beach', 'warm', 'low', { ground: '#7a1020' }))).toBeLessThan(lum('#7a1020'));
  });
  it('a glow, a band and each texture change the picture, and every picture is the same each time', async () => {
    const plain = await renderBackdrop({ look: 'studio', ratio: 9 / 16 });
    const glow = await renderBackdrop({ look: 'studio', ratio: 9 / 16, palette: { glow: { x: 0.5, y: 0.8, color: '#ff3b8d', size: 0.4 } } });
    expect(glow.png.equals(plain.png)).toBe(false);
    const band = await renderBackdrop({ look: 'studio', ratio: 9 / 16, palette: { band: { color: '#102030', height: 0.2 } } });
    expect(band.png.equals(plain.png)).toBe(false);
    for (const texture of SET_TEXTURES.filter((t) => t !== 'none')) {
      const a = await renderBackdrop({ look: 'night', ratio: 9 / 16, palette: { texture, accent: '#ffb347' } });
      const b = await renderBackdrop({ look: 'night', ratio: 9 / 16, palette: { texture, accent: '#ffb347' } });
      expect(a.png.equals(b.png), texture).toBe(true);
      if (texture !== 'clouds') expect(a.png.equals((await renderBackdrop({ look: 'night', ratio: 9 / 16 })).png), texture).toBe(false);
    }
  });
  it('a look with no palette is exactly as before', async () => {
    const a = await renderBackdrop({ look: 'beach', ratio: 9 / 16 });
    const b = await renderBackdrop({ look: 'beach', ratio: 9 / 16, palette: {} });
    expect(a.png.equals(b.png)).toBe(true);
  });
});
