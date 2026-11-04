import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import type { AssetRef, FilmState } from '@shared/composition';
import { imageSize } from '../media/image';
import { readSeedBuffer } from '../test-utils/fixtures';
import { makeTestFilm } from '../test-utils/film';
import { prepareSourceStill, selectSource } from './source-still';
import { buildComp } from './test-helpers';

const film = (assets: AssetRef[] = []) => ({ id: 'film_aaaaaaaaaaaa', aspect: '16:9', brief: { text: '', productAssetId: 'ast_p' }, assets }) as unknown as FilmState;

describe('selectSource', () => {
  it('prefers a still, then flatten, then plate, then the product photo', () => {
    const still: AssetRef = { id: 'ast_s', url: '', mime: 'image/jpeg', role: 'still', sceneId: 's1' };
    const both = buildComp([{ id: 's1', layers: [{ id: 's1:bg', role: 'bg', assetId: 'ast_bg' }, { id: 's1:product', role: 'product', assetId: 'ast_pr' }] }]);
    const bgOnly = buildComp([{ id: 's1', layers: [{ id: 's1:bg', role: 'bg', assetId: 'ast_bg' }] }]);
    const none = buildComp([{ id: 's1', layers: [{ id: 's1:bg', role: 'bg' }] }]);
    expect(selectSource(film([still]), both, 's1').kind).toBe('still');
    expect(selectSource(film(), both, 's1').kind).toBe('flatten');
    expect(selectSource(film(), bgOnly, 's1').kind).toBe('plate');
    expect(selectSource(film(), none, 's1').kind).toBe('product-photo');
  });
});

describe('prepareSourceStill', () => {
  it('crops the product photo to the aspect and reuses the result', async () => {
    const t = await makeTestFilm({ composition: buildComp([{ id: 's1', layers: [{ id: 's1:bg', role: 'bg' }] }]) });
    const cafe = await t.assets.put(readSeedBuffer('cafe-with-mug.jpg'), 'image/jpeg', { role: 'plate' });
    await t.ctx.films.get(t.filmId); // sanity
    const comp = buildComp([{ id: 's1', layers: [{ id: 's1:bg', role: 'bg', assetId: cafe.id }] }]);
    await t.films.commit(t.filmId, comp, 'user');

    const portrait = await prepareSourceStill(t.ctx, 's1', '9:16');
    expect(portrait.kind).toBe('plate');
    expect(portrait.asset).toMatchObject({ mime: 'image/jpeg', role: 'still', sceneId: 's1' });
    expect(await imageSize(await t.assets.read(portrait.asset.id))).toMatchObject({ width: 864, height: 1536, mime: 'image/jpeg' });

    const put = vi.spyOn(t.ctx.assets, 'put');
    const again = await prepareSourceStill(t.ctx, 's1', '9:16');
    expect(again.asset.id).toBe(portrait.asset.id);
    expect(put).not.toHaveBeenCalled();

    const wide = await prepareSourceStill(t.ctx, 's1', '16:9');
    expect(await imageSize(await t.assets.read(wide.asset.id))).toMatchObject({ width: 1536, height: 864 });
  });
  it('flattens bg and product when no still exists', async () => {
    const t = await makeTestFilm();
    const bg = await t.assets.put(await sharp({ create: { width: 1920, height: 1080, channels: 3, background: '#ff0000' } }).png().toBuffer(), 'image/png');
    const pr = await t.assets.put(await sharp({ create: { width: 400, height: 400, channels: 3, background: '#0000ff' } }).png().toBuffer(), 'image/png');
    await t.films.commit(t.filmId, buildComp([{ id: 's1', layers: [
      { id: 's1:bg', role: 'bg', assetId: bg.id, anchor: [960, 540] }, { id: 's1:product', role: 'product', assetId: pr.id, anchor: [200, 200] },
    ] }]), 'user');
    const r = await prepareSourceStill(t.ctx, 's1', '16:9');
    expect(r.kind).toBe('flatten');
    const { data, info } = await sharp(await t.assets.read(r.asset.id)).raw().toBuffer({ resolveWithObject: true });
    const centre = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
    expect(data[centre + 2]!).toBeGreaterThan(200); // blue product in the middle
  });
});
