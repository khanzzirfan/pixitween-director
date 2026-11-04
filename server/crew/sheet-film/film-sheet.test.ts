import { Buffer } from 'node:buffer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import type { ToolCtx } from '@shared/tools';
import type { Comp } from '../../authoring/types';
import { defaultBeatSheet, planBoard, type CinematicBoard } from '../../authoring/beatsheet';
import { floorElements } from '../../authoring/ingredients';

vi.mock('../../authoring/beatsheet', async (orig) => ({ ...(await orig<Record<string, unknown>>()), planBoard: vi.fn() }));
vi.mock('../frame-review', async (orig) => ({ ...(await orig<Record<string, unknown>>()), measureFrames: vi.fn(async () => []) }));

const { filmLookPrompt, filmSheetLabels, filmSheetTimes, keptSet, lookAtFilm, recoloured } = await import('./film-sheet');

const elements = floorElements('Coffee Co. Cold Brew', 'drinks');
const board: CinematicBoard = { concept: 'cold brew', mood: 'dark', elements, sheet: defaultBeatSheet(elements) };
const threeBeats = (): CinematicBoard => ({ ...board, sheet: { beats: [1, 2, 3].map((seconds) => ({ size: 'wide' as const, move: 'push' as const, seconds, blur: 0.3 })) } });
const png = () => sharp({ create: { width: 60, height: 100, channels: 3, background: '#445566' } }).png().toBuffer();

function setup(reply: unknown) {
  const reviewImages = vi.fn(async () => reply);
  const put = vi.fn(async (_b: Buffer, mime: string, meta: object) => ({ id: 'ast_' + 'a'.repeat(32), url: '/x', mime, ...meta }));
  const emit = vi.fn();
  const ctx = { filmId: 'f', meta: { spark: { reviewImages } }, ledger: { add: vi.fn() }, assets: { put }, emit } as unknown as ToolCtx;
  const build = vi.fn((_b: CinematicBoard) => ({}) as Comp);
  const render = vi.fn(async (_c: Comp, times: number[]) => Promise.all(times.map(() => png())));
  return { ctx, reviewImages, put, build, render, input: { board, title: 'Cold Brew', photo: Buffer.from('photo'), askedSeconds: 8, build, render, jsonProblems: () => [] as string[], log: vi.fn() } };
}

beforeEach(() => vi.mocked(planBoard).mockReset());

describe('filmSheetTimes and filmSheetLabels', () => {
  it('takes two frames a shot, just in and just before it leaves, so every cut is seen from both sides; the last is the end card', () => {
    // shots of 1, 2 and 3 s: in 20% (at most 0.4 s), out 15% (at most 0.3 s) before the end
    const t = filmSheetTimes(threeBeats());
    [0.2, 0.85, 1.4, 2.7, 3.4, 5.97].forEach((v, i) => expect(Math.abs(t[i]! - v)).toBeLessThan(0.02));
  });
  it('labels each frame with its shot, and the in frame with the cut into it', () => {
    const labels = filmSheetLabels({ ...threeBeats(), sheet: { beats: threeBeats().sheet.beats.map((b, i) => (i === 1 ? { ...b, cut: 'defocus' as const } : b)) } });
    expect(labels).toHaveLength(6);
    expect(labels[0]).toBe('shot 1 in [0.2s] wide push');
    expect(labels[2]).toBe('shot 2 in [1.4s] wide push, after a defocus cut');
    expect(labels[5]).toBe('shot 3 end card [6.0s]');
  });
  it("asks as the cinematographer too, and names the chosen idea's world", () => {
    const p = filmLookPrompt({ board: threeBeats(), title: 'Tub', measured: [], photo: true, idea: { name: 'Frost Hymn at Dawn', world: 'a frosted garden before dawn', mood: '', light: '', colour: '', camera: 'rises from the frost', elements: '', ending: '' } });
    expect(p).toMatch(/cinematographer/);
    expect(p).toMatch(/jump cut/);
    expect(p).toMatch(/"words leaving".*not a crop/);
    expect(p).toContain('"Frost Hymn at Dawn", set in a frosted garden before dawn');
    expect(p).toMatch(/colours of the set/);
  });
});

describe('keptSet and recoloured', () => {
  const set = { look: 'garden' as const, air: 'dust' as const, palette: { top: '#221144', horizon: '#553366', ground: '#332244' } };
  it("keeps the set's look and air and takes the revision's colours", () => {
    const palette = { top: '#cfd8e8', horizon: '#f2c9d8', ground: '#e8eef5' };
    expect(keptSet(set, { look: 'night', air: 'bokeh', palette })).toEqual({ look: 'garden', air: 'dust', palette });
    expect(keptSet(set, { look: 'night', air: 'bokeh' })).toBe(set);
    expect(keptSet(set, undefined)).toBe(set);
  });
  it('is true when the palette, the tone or the key changed', () => {
    expect(recoloured({ ...board, set }, { ...board, set })).toBe(false);
    expect(recoloured({ ...board, set }, { ...board, set: { ...set, palette: { ...set.palette, top: '#ffffff' } } })).toBe(true);
    expect(recoloured({ ...board, set, key: 'low' }, { ...board, set, key: 'high' })).toBe(true);
  });
});

describe('lookAtFilm', () => {
  it('makes no planBoard call when the look is clean, and saves one sheet', async () => {
    const s = setup({ fine: true, problems: [] });
    const r = await lookAtFilm(s.ctx, s.input);
    expect(planBoard).not.toHaveBeenCalled();
    expect(r.revised).toBe(false);
    expect(s.put).toHaveBeenCalledTimes(1);
    expect((s.put.mock.calls[0] as unknown[])[2]).toEqual({ role: 'sheet' });
    expect(s.reviewImages).toHaveBeenCalledTimes(1);
  });
  it('asks for one revised board when Muse names a problem, and draws again', async () => {
    const s = setup({ fine: false, problems: ['shot 2 crops the label: pull back'] });
    vi.mocked(planBoard).mockResolvedValue({ board: { ...board, concept: 'a calmer take' }, source: 'muse', violations: [], dropped: [] });
    const r = await lookAtFilm(s.ctx, { ...s.input, flat: true });
    expect(planBoard).toHaveBeenCalledTimes(1);
    expect(vi.mocked(planBoard).mock.calls[0]![1].flat).toBe(true);
    expect(r.revised).toBe(true);
    expect(r.board.concept).toBe('a calmer take');
    expect(s.build).toHaveBeenCalledTimes(2);
    expect(s.put).toHaveBeenCalledTimes(1);
    expect(s.reviewImages).toHaveBeenCalledTimes(1);
  });
  it('mends what the part sheets showed in the same one revision, even when the film sheet looks clean', async () => {
    const s = setup({ fine: true, problems: [] });
    vi.mocked(planBoard).mockResolvedValue({ board: { ...board, concept: 'mended' }, source: 'muse', violations: [], dropped: [] });
    const r = await lookAtFilm(s.ctx, { ...s.input, fromSheets: ['the cream is a flat disc'] });
    expect(planBoard).toHaveBeenCalledTimes(1);
    expect(vi.mocked(planBoard).mock.calls[0]![1].prior!.violations[0]).toBe('seen on the part sheets: the cream is a flat disc');
    expect(r.revised).toBe(true);
  });
  it("lets the revision repaint the set's colours, keeps its look, and writes it from the idea", async () => {
    const s = setup({ fine: false, problems: ['the world is navy night, not a frosted dawn: repaint it'] });
    const set = { look: 'garden' as const, air: 'dust' as const, palette: { top: '#110a33', horizon: '#2a1a55', ground: '#1a1033' } };
    const dawn = { top: '#cfd8e8', horizon: '#f2c9d8', ground: '#e8eef5' };
    vi.mocked(planBoard).mockResolvedValue({ board: { ...board, set: { look: 'night', air: 'smoke', palette: dawn } }, source: 'muse', violations: [], dropped: [] });
    const restage = vi.fn(async () => {});
    const idea = { name: 'Frost Hymn at Dawn', world: 'a frosted garden', mood: '', light: '', colour: '', camera: '', elements: '', ending: '' };
    const r = await lookAtFilm(s.ctx, { ...s.input, board: { ...board, set }, idea, restage });
    const call = vi.mocked(planBoard).mock.calls[0]![1];
    expect(call.idea).toEqual(idea);
    expect(call.solid).toBe(true);
    expect(call.prior!.violations.at(-1)).toMatch(/set.palette/);
    expect(r.board.set).toEqual({ look: 'garden', air: 'dust', palette: dawn });
    expect(restage).toHaveBeenCalledWith(r.board);
  });
  it('does not repaint the set when the revision keeps its colours', async () => {
    const s = setup({ fine: false, problems: ['shot 2 crops the label'] });
    vi.mocked(planBoard).mockResolvedValue({ board: { ...board, concept: 'tighter' }, source: 'muse', violations: [], dropped: [] });
    const restage = vi.fn(async () => {});
    await lookAtFilm(s.ctx, { ...s.input, restage });
    expect(restage).not.toHaveBeenCalled();
  });
  it('keeps the first board when the revision comes from the floor', async () => {
    const s = setup({ fine: false, problems: ['too dark'] });
    vi.mocked(planBoard).mockResolvedValue({ board: { ...board, concept: 'floor' }, source: 'floor', violations: [], dropped: [] });
    const r = await lookAtFilm(s.ctx, s.input);
    expect(r.revised).toBe(false);
    expect(r.board).toBe(board);
    expect(r.problems).toEqual(['too dark']);
  });
});
