import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { newPrepareCache } from '../product3d/prepare';
import { stripedCan, triangle, type Rgba } from '../product3d/test-images';
import { makeTestFilm } from '../test-utils/film';
import { buildCatalogClip, prepareRound } from './catalog-clip';
import { pickLook } from './looks';

const png = (img: Rgba) => sharp(Buffer.from(img.data.buffer), { raw: { width: img.width, height: img.height, channels: 4 } }).png().toBuffer();
async function cutOf(img: Rgba) {
  const t = await makeTestFilm();
  const a = await t.assets.put(await png(img), 'image/png', { role: 'cutout', width: img.width, height: img.height });
  return { assets: t.assets, cut: { id: a.id, width: img.width, height: img.height } };
}
const copy = { aspect: '9:16' as const, title: 'Coffee Co. Cold Brew', brand: 'Coffee Co.', price: 4.5, currency: 'USD', accent: '#c27a3a' };
const layers = (c: any): any[] => Object.values(c.precomps).flatMap((p: any) => p.layers);

describe('prepareRound', () => {
  it('unwraps a tall can into a label', async () => {
    const { assets, cut } = await cutOf(stripedCan().img);
    const p = await prepareRound(assets, cut, 'can', newPrepareCache());
    expect(p?.shape).toBe('can');
    expect(p?.textureKind).toBe('label');
  });
  it('skips a class with no round shape, a pack that is not tall, and a cut-out with no straight body', async () => {
    const { assets, cut } = await cutOf(stripedCan().img);
    expect(await prepareRound(assets, cut, 'mug', newPrepareCache())).toBeUndefined();
    expect(await prepareRound(assets, { ...cut, width: 800, height: 800 }, 'can', newPrepareCache())).toBeUndefined();
    const tri = await cutOf(triangle());
    expect(await prepareRound(tri.assets, { ...tri.cut, width: 300, height: 600 }, 'can', newPrepareCache())).toBeUndefined();
  });
});

describe('buildCatalogClip', () => {
  const product = { id: 'ast_cut', src: '/api/assets/ast_cut', width: 300, height: 500 };
  it('builds the 3D hero for a round pack the director picked it for', async () => {
    const { assets, cut } = await cutOf(stripedCan().img);
    const prepared = await prepareRound(assets, cut, 'can', newPrepareCache());
    const pick = pickLook({ title: copy.title, category: 'drinks', width: cut.width, height: cut.height, round: prepared !== undefined });
    expect(pick.look).toBe('hero-3d');
    const c = buildCatalogClip({ ...copy, look: pick.look, prepared, product });
    const m = layers(c).find((l) => l.kind === 'model3d');
    expect(m.textures.label).toBe(prepared!.texture.id);
  });
  it('builds the 2D retail clip for any other look', () => {
    const c = buildCatalogClip({ ...copy, look: 'tabletop-hero', product, plate: { id: 'ast_plate', src: '/p.png', width: 720, height: 1280 } });
    expect(layers(c).some((l) => l.kind === 'model3d')).toBe(false);
    expect(layers(c).some((l) => l.kind === 'image')).toBe(true);
  });
  it('refuses hero-3d without a prepared round pack', () => {
    expect(() => buildCatalogClip({ ...copy, look: 'hero-3d', product })).toThrow(/round pack/);
  });
});
