import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import type { ToolCtx } from '@shared/tools';
import { drawTurnaround, referenceCanvas, turnaroundPrompt, TURNAROUND_SIZE } from './turnaround';

const rect = (w: number, h: number, colour = '#cc3355') => sharp({ create: { width: w, height: h, channels: 4, background: colour } }).png().toBuffer();
/** the box of pixels that are not white, in a canvas */
async function inkBox(png: Buffer) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let [x0, y0, x1, y1] = [info.width, info.height, -1, -1];
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 3;
      if (data[i]! < 250 || data[i + 1]! < 250 || data[i + 2]! < 250) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
    }
  return { x0, y0, x1, y1 };
}

describe('referenceCanvas', () => {
  it('is a 1536 x 1024 white canvas with the product only in the left third', async () => {
    const { png } = await referenceCanvas(await rect(200, 400));
    const m = await sharp(png).metadata();
    expect([m.width, m.height]).toEqual([TURNAROUND_SIZE.width, TURNAROUND_SIZE.height]);
    expect((await inkBox(png)).x1).toBeLessThan(512);
  });
  it('centres the product across the third and stands it on a floor line at 95 % of the height', async () => {
    const { png, panel } = await referenceCanvas(await rect(200, 400));
    const box = await inkBox(png);
    expect(Math.abs((box.x0 + box.x1 + 1) / 2 - 256)).toBeLessThanOrEqual(4);
    expect(Math.abs(box.y1 + 1 - 1024 * 0.95)).toBeLessThanOrEqual(4);
    expect((await sharp(panel).metadata()).width).toBe(512);
  });
  it('fits a wide product inside 88 % of the third', async () => {
    const box = await inkBox((await referenceCanvas(await rect(800, 200))).png);
    expect(box.x1 - box.x0 + 1).toBeLessThanOrEqual(Math.round(512 * 0.88) + 1);
  });
});

describe('turnaroundPrompt', () => {
  it('asks for the right side and the back, keeps the front, and a pure white background', () => {
    const p = turnaroundPrompt({ what: 'a bottle' });
    for (const s of ['right side', 'back', 'kept exactly', 'pure white background']) expect(p).toContain(s);
    expect(p).not.toContain('left side');
    expect(p).toContain('Do not repeat the front picture');
  });
  it('leaves a brand term out', () => {
    const p = turnaroundPrompt({ what: 'a tall bottle of Lattafa Habik perfume' });
    expect(p).not.toMatch(/Lattafa|Habik/);
    expect(p).toContain('perfume');
  });
});

describe('drawTurnaround', () => {
  const fake = (edit: (prompt: string, refs: Buffer[], size?: string) => Promise<Buffer>) => {
    const calls: Array<{ prompt: string; refs: Buffer[]; size?: string }> = [];
    const adds: Array<[string, string, number]> = [];
    const ctx = {
      filmId: 'f1',
      meta: { image: { edit: async (prompt: string, refs: Buffer[], size?: string) => { calls.push({ prompt, refs, size }); return edit(prompt, refs, size); } } },
      ledger: { add: (_f: string, model: string, units: string, usd: number) => adds.push([model, units, usd]) },
    } as unknown as ToolCtx;
    return { ctx, calls, adds };
  };
  it('calls the image model once with the reference canvas then the photo, at 1536x1024, and charges 0.04', async () => {
    const { ctx, calls, adds } = fake(async () => Buffer.from('sheet'));
    const photo = await rect(50, 50);
    const out = await drawTurnaround(ctx, { cut: await rect(200, 400), photo, what: 'a bottle' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.refs).toHaveLength(2);
    expect(calls[0]!.refs[0]).toEqual(out.reference.png);
    expect(calls[0]!.refs[1]).toEqual(photo);
    expect(calls[0]!.size).toBe('1536x1024');
    expect(adds).toEqual([['muse-image-1.0', 'turnaround', 0.04]]);
  });
  it('adds the problems of the last drawing to the prompt', async () => {
    const { ctx, calls } = fake(async () => Buffer.from('sheet'));
    await drawTurnaround(ctx, { cut: await rect(200, 400), photo: await rect(50, 50), what: 'a bottle', extra: ['the back has a stray lump'] });
    expect(calls[0]!.prompt).toContain('the back has a stray lump');
  });
  it("turns an image error into one that starts 'turnaround: ' and charges nothing", async () => {
    const { ctx, adds } = fake(async () => { throw new Error('quota'); });
    await expect(drawTurnaround(ctx, { cut: await rect(200, 400), photo: await rect(50, 50), what: 'a bottle' })).rejects.toThrow(/^turnaround: quota/);
    expect(adds).toEqual([]);
  });
});
