import type { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import type { ToolCtx } from '@shared/tools';
import { buildCinematicFilm, type CinematicInput } from '../../authoring/cinematic-film';
import type { Beat } from '../../authoring/beatsheet';
import type { IngredientAsset } from '../../authoring/ingredients';
import type { TurnaroundViews } from '../../product3d/turnaround';
import { drawSheets } from './render';

const pic = (id: string, w = 128, h = 64) => ({ id, src: `/api/assets/${id}`, width: w, height: h });
const beat = (extra: Partial<Beat> = {}): Beat => ({ size: 'medium', move: 'push', seconds: 2, angle: 'eye', phase: 'build', product: 'still', blur: 0.3, ...extra });
const ingredients: Record<string, IngredientAsset> = {
  raspberry: { kind: 'raspberry', use: 'solid', sizeM: 0.02, frames: [pic('ast_rasp')], contour: [[0, 10], [60, 0], [120, 10], [60, 60]], side: '#8a1c3c' },
  honey: { kind: 'honey', use: 'card', sizeM: 0.3, frames: [pic('ast_honey', 512, 512)] },
};
const input = (withElements: boolean): CinematicInput => ({
  aspect: '9:16',
  sheet: withElements
    ? { beats: [beat({ phase: 'hook' }), beat({ ingredient: { kind: 'raspberry', action: 'fall', scale: 1 } }), beat({ ingredient: { kind: 'honey', action: 'drift', scale: 1 } }), beat({ phase: 'close', move: 'hold' })] }
    : { beats: [beat({ phase: 'hook' }), beat({ phase: 'close', move: 'hold' })] },
  texture: { ...pic('ast_label', 2048, 1024), kind: 'label' },
  shape: 'can',
  side: '#e8e0ce',
  productAspect: 3,
  title: 'Pure Spoonful',
  accent: '#c27a3a',
  ...(withElements ? { ingredients } : {}),
});

const png = (c: string) => sharp({ create: { width: 90, height: 120, channels: 3, background: c } }).png().toBuffer();
function fakeCtx() {
  const puts: Array<{ mime: string; meta: unknown }> = [];
  const events: Array<{ type: string; asset?: { role?: string; id: string } }> = [];
  const ctx = {
    filmId: 'film_aaaaaaaaaaaa',
    assets: { put: vi.fn(async (_b: Buffer, mime: string, meta: unknown) => { puts.push({ mime, meta }); return { id: `ast_${'0'.repeat(31)}${puts.length}`, url: '/x', mime, ...(meta as object) }; }) },
    emit: (e: { type: string; asset?: { role?: string; id: string } }) => events.push(e),
  } as unknown as ToolCtx;
  return { ctx, puts, events };
}
const fakeRender = () => vi.fn(async (_c: unknown, times: number[]) => Promise.all(times.map(() => png('#336699'))));

describe('drawSheets', () => {
  it('renders three sheets for a film with a product and elements, saving each with role sheet', async () => {
    const { ctx, puts, events } = fakeCtx();
    const render = fakeRender();
    const r = await drawSheets(ctx, { film: buildCinematicFilm(input(true)), photo: await png('#ffffff'), render });
    expect(render).toHaveBeenCalledTimes(3);
    expect(puts).toHaveLength(3);
    expect(puts.every((p) => p.mime === 'image/jpeg' && (p.meta as { role: string }).role === 'sheet')).toBe(true);
    expect(r.product && r.elements && r.set).toBeTruthy();
    expect(r.assetIds).toHaveLength(3);
    const assetEvents = events.filter((e) => e.type === 'art.asset');
    expect(assetEvents.map((e) => e.asset!.role)).toEqual(['sheet', 'sheet', 'sheet']);
    expect(assetEvents.map((e) => e.asset!.id)).toEqual(r.assetIds);
  });
  it('saves two sheets for a film without elements', async () => {
    const { ctx, puts } = fakeCtx();
    const render = fakeRender();
    const r = await drawSheets(ctx, { film: buildCinematicFilm(input(false)), photo: await png('#ffffff'), render });
    expect(render).toHaveBeenCalledTimes(2);
    expect(puts).toHaveLength(2);
    expect(r.elements).toBeUndefined();
    expect(r.product).toBeDefined();
    expect(r.set).toBeDefined();
  });
  it('keeps the sheets that drew when one fails, and says which was skipped', async () => {
    const { ctx, puts } = fakeCtx();
    let n = 0;
    const render = vi.fn(async (_c: unknown, times: number[]) => {
      if (++n === 3) throw new Error('the 3D product did not finish drawing');
      return Promise.all(times.map(() => png('#336699')));
    });
    const r = await drawSheets(ctx, { film: buildCinematicFilm(input(true)), photo: await png('#ffffff'), render });
    expect(puts).toHaveLength(2);
    expect(r.product && r.elements).toBeTruthy();
    expect(r.set).toBeUndefined();
    expect(r.skipped).toEqual(['set: the 3D product did not finish drawing']);
  });
  it('throws when no sheet could be drawn', async () => {
    const { ctx } = fakeCtx();
    const render = vi.fn(async () => { throw new Error('down'); });
    await expect(drawSheets(ctx, { film: buildCinematicFilm(input(true)), photo: await png('#ffffff'), render })).rejects.toThrow(/product: down/);
  });
});

describe('drawSheets with a turnaround', () => {
  const views = async () => ({ front: await png('#cc3355'), side: await png('#3355cc'), back: await png('#55cc33') });
  const panelCounts = async (turnaround?: { views: TurnaroundViews; sheet?: Buffer }) => {
    const compose = await import('./compose');
    const spy = vi.spyOn(compose, 'composeSheet');
    const { ctx, puts, events } = fakeCtx();
    const r = await drawSheets(ctx, { film: buildCinematicFilm(input(false)), photo: await png('#ffffff'), render: fakeRender(), ...(turnaround ? { turnaround } : {}) });
    const product = spy.mock.calls.find((c) => /Product sheet/.test(c[0].title))![0].panels.length;
    spy.mockRestore();
    return { product, r, puts, events };
  };
  it('saves the turnaround sheet first, and its product sheet composes 3 more panels', async () => {
    const without = await panelCounts();
    const withViews = await panelCounts({ views: await views(), sheet: await png('#ffffff') });
    expect(withViews.product).toBe(without.product + 3);
    expect(withViews.puts).toHaveLength(without.puts.length + 1);
    expect(withViews.r.turnaround).toBeDefined();
    expect(withViews.events.map((e) => e.asset!.role)).toEqual(['sheet', 'sheet', 'sheet']);
    expect(withViews.events[0]!.asset!.id).toBe(withViews.r.assetIds[0]);
  });
  it('builds the same assets and product sheet panels as before when the film has no views', async () => {
    const a = await panelCounts();
    expect(a.r.turnaround).toBeUndefined();
    expect(a.puts).toHaveLength(2);
  });
  it('shows a supplied back as two views and saves no turnaround sheet', async () => {
    const { front, back } = await views();
    const none = await panelCounts();
    const supplied = await panelCounts({ views: { front, back } });
    expect(supplied.product).toBe(none.product + 2);
    expect(supplied.puts).toHaveLength(none.puts.length);
  });
});
