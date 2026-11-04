import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { viewsAgree } from './agree';

const rect = (w: number, h: number, colour = '#cc3355') => sharp({ create: { width: w, height: h, channels: 4, background: colour } }).png().toBuffer();
const triangle = (w: number, h: number, colour = '#cc3355') =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><polygon points="${w / 2},0 ${w},${h} 0,${h}" fill="${colour}"/></svg>`)).png().toBuffer();

describe('viewsAgree', () => {
  it('passes three same-colour views of the same outline, and reads the depth from the side', async () => {
    const out = await viewsAgree({ views: { front: await rect(100, 300), side: await rect(96, 300), back: await rect(100, 300) }, frontKept: 0.02 });
    expect(out.ok).toBe(true);
    expect(out.problems).toEqual([]);
    expect(Math.abs(out.depthShare! - 0.96)).toBeLessThan(0.01);
  });
  it('refuses a back that is another shape', async () => {
    const out = await viewsAgree({ views: { front: await rect(100, 300), side: await rect(96, 300), back: await triangle(100, 300) }, frontKept: 0 });
    expect(out.ok).toBe(false);
    expect(out.problems.join(' ')).toMatch(/back.*shape/);
  });
  it('refuses a back of another colour', async () => {
    const out = await viewsAgree({ views: { front: await rect(100, 300), side: await rect(96, 300), back: await rect(100, 300, '#33aa33') }, frontKept: 0 });
    expect(out.problems.join(' ')).toMatch(/back.*colour/);
  });
  it('refuses a redrawn front and a side three times too wide', async () => {
    const a = await viewsAgree({ views: { front: await rect(100, 300), side: await rect(96, 300), back: await rect(100, 300) }, frontKept: 0.2 });
    expect(a.problems.join(' ')).toMatch(/front/);
    const b = await viewsAgree({ views: { front: await rect(100, 300), side: await rect(300, 300), back: await rect(100, 300) }, frontKept: 0 });
    expect(b.ok).toBe(false);
    expect(b.problems.join(' ')).toMatch(/side/);
  });
  it('refuses a view that is mostly empty inside its box', async () => {
    const hollow = await sharp({ create: { width: 100, height: 300, channels: 4, background: '#00000000' } }).composite([{ input: await rect(8, 8), left: 0, top: 0 }, { input: await rect(8, 8), left: 92, top: 292 }]).png().toBuffer();
    const out = await viewsAgree({ views: { front: await rect(100, 300), side: hollow, back: await rect(100, 300) }, frontKept: 0 });
    expect(out.problems.join(' ')).toMatch(/side view is mostly empty/);
  });
  it('skips the rules that need a side when there is none', async () => {
    const out = await viewsAgree({ views: { front: await rect(100, 300), back: await rect(100, 300) }, frontKept: 0 });
    expect(out).toMatchObject({ ok: true, problems: [] });
    expect(out.depthShare).toBeUndefined();
  });
});
