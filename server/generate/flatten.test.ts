import sharp from 'sharp';
import { expect, it } from 'vitest';
import type { ToolCtx } from '@shared/tools';
import { staticBox, flattenScene } from './flatten';
import { buildComp } from './test-helpers';

const solid = (w: number, h: number, c: string) => sharp({ create: { width: w, height: h, channels: 3, background: c } }).png().toBuffer();
const px = async (png: Buffer, x: number, y: number) => {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const o = (y * info.width + x) * info.channels;
  return [data[o]!, data[o + 1]!, data[o + 2]!];
};
const near = (got: number[], want: number[]) => got.forEach((v, i) => expect(Math.abs(v - want[i]!)).toBeLessThanOrEqual(8));

it('computes static boxes', () => {
  const layer = (scale: [number, number]) => ({ transform: { position: [960, 540] as [number, number], anchor: [200, 200] as [number, number], scale } });
  expect(staticBox(layer([1, 1]), { width: 400, height: 400 }, { width: 1920, height: 1080 })).toEqual({ left: 760, top: 340, width: 400, height: 400 });
  expect(staticBox(layer([0.5, 0.5]), { width: 400, height: 400 }, { width: 1920, height: 1080 })).toEqual({ left: 860, top: 440, width: 200, height: 200 });
  const kf = { transform: { position: [{ t: 0, v: [100, 100] as [number, number] }, { t: 10, v: [200, 100] as [number, number] }], anchor: [0, 0] as [number, number], scale: [1, 1] as [number, number] } };
  expect(staticBox(kf, { width: 10, height: 10 }, { width: 1, height: 1 }, 5).left).toBe(150);
});

async function ctxWith(hidden = false) {
  const store = new Map<string, Buffer>([['ast_bg', await solid(1920, 1080, '#ff0000')], ['ast_pr', await solid(400, 400, '#0000ff')]]);
  const comp = buildComp([{ id: 's1', layers: [
    { id: 's1:bg', role: 'bg', assetId: 'ast_bg', position: [960, 540], anchor: [960, 540] },
    { id: 's1:product', role: 'product', assetId: 'ast_pr', position: [960, 540], anchor: [200, 200], hidden },
  ] }]);
  return { ctx: { assets: { read: async (id: string) => store.get(id)! } } as unknown as ToolCtx, comp };
}

it('flattens bg and product', async () => {
  const { ctx, comp } = await ctxWith();
  const out = await flattenScene(ctx, comp, 's1', { width: 1920, height: 1080 });
  const meta = await sharp(out).metadata();
  expect([meta.width, meta.height]).toEqual([1920, 1080]);
  near(await px(out, 960, 540), [0, 0, 255]);
  near(await px(out, 10, 10), [255, 0, 0]);
});
it('skips a hidden layer', async () => {
  const { ctx, comp } = await ctxWith(true);
  near(await px(await flattenScene(ctx, comp, 's1', { width: 1920, height: 1080 }), 960, 540), [255, 0, 0]);
});
