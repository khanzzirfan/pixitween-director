import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import type { SamObject } from '@shared/ports';
import type { ToolCtx } from '@shared/tools';
import { frontDifference, splitTurnaround } from './turnaround';

/** a ctx whose asset store keeps the pictures in memory; `sam` answers segmentImage */
function fakeCtx(sam: (img: Buffer, noun?: string) => Promise<SamObject[]> = async () => []): ToolCtx {
  const store = new Map<string, Buffer>();
  return {
    filmId: 'f1',
    emit: () => {},
    ledger: { add: () => {} },
    meta: { sam: { segmentImage: sam } },
    assets: {
      put: async (bytes: Buffer, mime: string, meta: Record<string, unknown>) => {
        const id = `ast_${store.size}`;
        store.set(id, bytes);
        return { id, mime, ...meta };
      },
      read: async (id: string) => store.get(id)!,
    },
  } as unknown as ToolCtx;
}

type Shape = { left: number; width: number; colour: string };
const BAR_TOP = 0.2;
const BAR_H = 0.7;
/** a sheet of `w` x `h` with the given coloured bars standing on white */
async function sheetOf(shapes: Shape[], w = 1536, h = 1024) {
  return sharp({ create: { width: w, height: h, channels: 3, background: '#ffffff' } })
    .composite(await Promise.all(shapes.map(async (s) => ({ input: await sharp({ create: { width: s.width, height: Math.round(h * BAR_H), channels: 3, background: s.colour } }).png().toBuffer(), left: s.left, top: Math.round(h * BAR_TOP) }))))
    .png()
    .toBuffer();
}
const three: Shape[] = [{ left: 150, width: 200, colour: '#cc2244' }, { left: 660, width: 140, colour: '#2244cc' }, { left: 1160, width: 200, colour: '#22aa44' }];
const cutOf = (colour: string, w = 200, h = 700) => sharp({ create: { width: w, height: h, channels: 4, background: colour } }).png().toBuffer();

/** SAM's answer for bars on a 1536 x 1024 sheet: one object per bar, its alpha the bar's box */
const samFor = (shapes: Shape[], only?: string[]) => async (_img?: Buffer, noun?: string): Promise<SamObject[]> =>
  only && !only.includes(noun ?? '') ? [] :
  shapes.map((s, i) => {
    const [top, bottom] = [Math.round(1024 * BAR_TOP), Math.round(1024 * BAR_TOP) + Math.round(1024 * BAR_H)];
    const alpha = Buffer.alloc(1536 * 1024);
    for (let y = top; y < bottom; y++) alpha.fill(255, y * 1536 + s.left, y * 1536 + s.left + s.width);
    return { objectId: `o${i}`, confidence: 0.9, bounds: { left: s.left, top, right: s.left + s.width, bottom }, alpha };
  });

describe('splitTurnaround', () => {
  it('returns three views in left-to-right order', async () => {
    const out = await splitTurnaround(fakeCtx(), { sheet: await sheetOf(three), cut: await cutOf('#cc2244') });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const widths = await Promise.all([out.views.front, out.views.side, out.views.back].map(async (v) => (await sharp(v).metadata()).width!));
    expect(widths[0]).toBeGreaterThan(widths[1]!);
    expect(widths[2]).toBeGreaterThan(widths[1]!);
    expect((await sharp(out.views.front).removeAlpha().raw().toBuffer())[0]).toBeGreaterThan(150);
  });
  it('says how many views it found when there are not three', async () => {
    const out = await splitTurnaround(fakeCtx(), { sheet: await sheetOf(three.slice(0, 2)), cut: await cutOf('#cc2244') });
    expect(out).toMatchObject({ ok: false });
    expect(out.ok ? '' : out.reason).toContain('fewer than 3 views');
  });
  it('is not ok for a blank sheet', async () => {
    expect((await splitTurnaround(fakeCtx(), { sheet: await sheetOf([]), cut: await cutOf('#cc2244') })).ok).toBe(false);
  });
  it('scores a kept front near 0, and splits a smaller copy like the full-size sheet', async () => {
    const sheet = await sheetOf(three);
    const full = await splitTurnaround(fakeCtx(), { sheet, cut: await cutOf('#cc2244') });
    expect(full.ok && full.frontKept).toBeLessThan(0.03);
    const small = await splitTurnaround(fakeCtx(), { sheet: await sharp(sheet).resize(1024, 683, { fit: 'fill' }).png().toBuffer(), cut: await cutOf('#cc2244') });
    expect(small.ok).toBe(true);
    if (!full.ok || !small.ok) return;
    const w = async (v: Buffer) => (await sharp(v).metadata()).width!;
    expect(Math.abs((await w(small.views.side)) / (await w(small.views.front)) - (await w(full.views.side)) / (await w(full.views.front)))).toBeLessThan(0.1);
  });
  it("keeps a white product's white parts by cutting the views with SAM (the white tub lost its rim to the white key, 4 Nov)", async () => {
    const white: Shape[] = three.map((s) => ({ ...s, colour: '#fbfbfb' }));
    const sheet = await sheetOf(white);
    const keyed = await splitTurnaround(fakeCtx(), { sheet, cut: await cutOf('#fbfbfb') });
    expect(keyed.ok).toBe(false);
    const cut = await splitTurnaround(fakeCtx(samFor(white)), { sheet, cut: await cutOf('#fbfbfb'), noun: 'tub' });
    expect(cut.ok).toBe(true);
    if (cut.ok) expect((await sharp(cut.views.back).metadata()).height).toBeGreaterThan(600);
  });
  it("joins SAM's objects by the third they sit in: a cup and its sleeve found apart are one view", async () => {
    // each bar comes back as two objects, its top half and its bottom half
    const halves = async (): Promise<SamObject[]> =>
      three.flatMap((s, i) => {
        const top = Math.round(1024 * BAR_TOP);
        const mid = top + Math.round((1024 * BAR_H) / 2);
        const bottom = top + Math.round(1024 * BAR_H);
        return [[top, mid], [mid, bottom]].map(([a, b], k) => {
          const alpha = Buffer.alloc(1536 * 1024);
          for (let y = a!; y < b!; y++) alpha.fill(255, y * 1536 + s.left, y * 1536 + s.left + s.width);
          return { objectId: `o${i}${k}`, confidence: 0.9, bounds: { left: s.left, top: a!, right: s.left + s.width, bottom: b! }, alpha };
        });
      });
    const out = await splitTurnaround(fakeCtx(halves), { sheet: await sheetOf(three), cut: await cutOf('#cc2244'), noun: 'cup' });
    expect(out).toMatchObject({ ok: true, by: 'sam' });
    if (out.ok) for (const v of [out.views.front, out.views.side, out.views.back]) expect((await sharp(v).metadata()).height).toBeGreaterThan(700);
  });
  it('keeps a white product whose outline is drawn when keying the backdrop (no SAM)', async () => {
    const outlined = await sharp({ create: { width: 1536, height: 1024, channels: 3, background: '#ffffff' } })
      .composite(await Promise.all(three.map(async (s) => ({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${s.width}" height="700"><rect x="3" y="3" width="${s.width - 6}" height="694" fill="#fbfbfb" stroke="#555555" stroke-width="6"/></svg>`), left: s.left, top: 200 }))))
      .png()
      .toBuffer();
    const out = await splitTurnaround(fakeCtx(), { sheet: outlined, cut: await cutOf('#fbfbfb') });
    expect(out).toMatchObject({ ok: true, by: 'key' });
    if (!out.ok) return;
    // the white inside the outline is kept, opaque
    const { data, info } = await sharp(out.views.back).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(data[(Math.round(info.height / 2) * info.width + Math.round(info.width / 2)) * 4 + 3]).toBeGreaterThan(200);
  });
  it('tries the last word of the noun when SAM finds nothing for the whole noun ("yoghurt cup" found none, "cup" found three, 4 Nov)', async () => {
    const asked: string[] = [];
    const sam = samFor(three, ['cup']);
    const out = await splitTurnaround(fakeCtx(async (img, noun) => { asked.push(noun ?? ''); return sam(img, noun); }), { sheet: await sheetOf(three), cut: await cutOf('#cc2244'), noun: 'yoghurt cup' });
    expect(out).toMatchObject({ ok: true, by: 'sam' });
    expect(asked).toEqual(['yoghurt cup', 'cup']);
  });
  it('falls back to the white key when SAM does not find three views', async () => {
    const out = await splitTurnaround(fakeCtx(samFor(three.slice(0, 1))), { sheet: await sheetOf(three), cut: await cutOf('#cc2244'), noun: 'bottle' });
    expect(out.ok).toBe(true);
  });
});

describe('frontDifference', () => {
  it('is 0 for the same product whatever its size, and high for another colour or shape', async () => {
    expect(await frontDifference(await cutOf('#cc2244'), await cutOf('#cc2244', 100, 350))).toBeLessThan(0.01);
    expect(await frontDifference(await cutOf('#cc2244'), await cutOf('#2244cc'))).toBeGreaterThan(0.3);
    const triangle = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="700"><polygon points="100,0 200,700 0,700" fill="#cc2244"/></svg>')).png().toBuffer();
    expect(await frontDifference(await cutOf('#cc2244'), triangle)).toBeGreaterThan(0.3);
  });
  it('does not count the backdrop: a drawn front on an off-white field scores like one on white', async () => {
    const onField = (bg: string) => sharp({ create: { width: 300, height: 800, channels: 4, background: '#00000000' } }).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="800"><rect width="300" height="800" fill="${bg}" fill-opacity="0"/><rect x="50" y="50" width="200" height="700" fill="#cc2244"/></svg>`), left: 0, top: 0 }]).png().toBuffer();
    expect(await frontDifference(await cutOf('#cc2244'), await onField('#f0ece4'))).toBeLessThan(0.01);
  });
});
