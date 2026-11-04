import { Buffer } from 'node:buffer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import type { ToolCtx } from '@shared/tools';
import type { Comp } from '../../authoring/types';
import { defaultBeatSheet, planBoard, type CinematicBoard } from '../../authoring/beatsheet';
import { floorElements } from '../../authoring/ingredients';

vi.mock('../../authoring/beatsheet', async (orig) => ({ ...(await orig<Record<string, unknown>>()), planBoard: vi.fn() }));
vi.mock('../frame-review', async (orig) => ({ ...(await orig<Record<string, unknown>>()), measureFrames: vi.fn(async () => []) }));

const { filmSheetLabels, filmSheetTimes, lookAtFilm } = await import('./film-sheet');

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
  it('takes the middle of each shot and the last frame of the last', () => {
    const t = filmSheetTimes(threeBeats());
    [0.5, 2, 5.97].forEach((v, i) => expect(Math.abs(t[i]! - v)).toBeLessThan(0.05));
  });
  it('labels every shot with its time, size, move and cut', () => {
    const labels = filmSheetLabels(threeBeats());
    expect(labels).toHaveLength(3);
    expect(labels.every((l) => l.startsWith('[0.0-') || l.startsWith('[1.0-') || l.startsWith('[3.0-'))).toBe(true);
    expect(labels[0]).toBe('[0.0-1.0s] wide push, hard cut');
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
  it('keeps the first board when the revision comes from the floor', async () => {
    const s = setup({ fine: false, problems: ['too dark'] });
    vi.mocked(planBoard).mockResolvedValue({ board: { ...board, concept: 'floor' }, source: 'floor', violations: [], dropped: [] });
    const r = await lookAtFilm(s.ctx, s.input);
    expect(r.revised).toBe(false);
    expect(r.board).toBe(board);
    expect(r.problems).toEqual(['too dark']);
  });
});
