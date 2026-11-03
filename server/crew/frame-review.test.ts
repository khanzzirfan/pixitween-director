import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import type { ToolCtx } from '@shared/tools';
import { floorBoard, totalSeconds } from '../authoring/beatsheet';
import { critiquePrompt, keyTimes, parseCritique, REVIEW_FRAMES, reviewFrames } from './frame-review';

const board = floorBoard({ title: 'Citrus Soda', category: 'soda' });
const jpg = Buffer.from('jpeg');

describe('which frames Muse sees', () => {
  it('takes the middle of shots spread over the film and the end card, ascending and never more than six', () => {
    const t = keyTimes(board);
    expect(t.length).toBeLessThanOrEqual(REVIEW_FRAMES);
    expect(t.length).toBeGreaterThanOrEqual(2);
    expect([...t].sort((a, b) => a - b)).toEqual(t);
    expect(t[0]).toBeCloseTo(board.sheet.beats[0]!.seconds / 2, 2);
    expect(t.at(-1)).toBeLessThan(totalSeconds(board.sheet));
    expect(t.at(-1)).toBeGreaterThan(totalSeconds(board.sheet) - 0.2);
  });
  it('a one-shot film is seen at its middle and its end', () => {
    const one = { ...board, sheet: { beats: [{ ...board.sheet.beats[0]!, seconds: 4 }] } };
    expect(keyTimes(one)).toEqual([2, 3.9]);
  });
  it('the prompt names the concept, the shots and the moments', () => {
    const p = critiquePrompt(board, [1, 2]);
    expect(p).toContain(board.concept);
    expect(p).toContain('at 1s, 2s');
    expect(p).toContain('"fine"');
  });
});

describe('reading the critique', () => {
  it('reads problems, trims them and caps them at four', () => {
    const c = parseCritique({ fine: false, problems: [' shot 2 crops the label ', 'b', 'c', 'd', 'e', 5, ''] });
    expect(c.fine).toBe(false);
    expect(c.problems).toEqual(['shot 2 crops the label', 'b', 'c', 'd']);
  });
  it('treats a fine film, no problems and an unreadable reply as fine', () => {
    expect(parseCritique({ fine: true, problems: [] }).fine).toBe(true);
    expect(parseCritique({ fine: false, problems: [] }).fine).toBe(true);
    expect(parseCritique('not json').fine).toBe(true);
    expect(parseCritique(JSON.parse('{"problems":["x"]}')).fine).toBe(false);
  });
});

describe('reviewFrames', () => {
  const setup = (replies: unknown[]) => {
    const reviewImages = vi.fn(async () => replies.shift());
    const chat = vi.fn(async () => ({ content: JSON.stringify(replies.shift()), toolCalls: [], ms: 1, model: 'spark' }));
    const add = vi.fn();
    return { ctx: { filmId: 'f', meta: { spark: { chat, reviewImages } }, ledger: { add } } as unknown as ToolCtx, reviewImages, chat, add };
  };
  const revisedReply = () => ({ concept: 'a calmer take', mood: 'soft', elements: board.elements, beats: board.sheet.beats.map((b, i) => (i === 1 ? { ...b, move: 'hold' } : b)) });
  const input = (render = vi.fn(async (t: number[]) => t.map(() => jpg))) => ({ board, title: 'Citrus Soda', flat: false, render });

  it('shows Muse the frames in order and keeps the board when it is happy', async () => {
    const c = setup([{ fine: true, problems: [] }]);
    const render = vi.fn(async (t: number[]) => t.map(() => jpg));
    const r = await reviewFrames(c.ctx, input(render));
    expect(r).toMatchObject({ board, revised: false });
    expect(render).toHaveBeenCalledWith(keyTimes(board));
    expect(c.reviewImages).toHaveBeenCalledTimes(1);
    expect((c.reviewImages.mock.calls[0] as unknown[])[0]).toHaveLength(keyTimes(board).length);
    expect(c.chat).not.toHaveBeenCalled();
  });
  it('asks for one revised board when Muse names problems, and keeps the elements and the set', async () => {
    const c = setup([{ fine: false, problems: ['shot 2 crops the label: pull back'] }, revisedReply()]);
    const log = vi.fn();
    const r = await reviewFrames(c.ctx, { ...input(), log });
    expect(r.revised).toBe(true);
    expect(r.board.concept).toBe('a calmer take');
    expect(r.board.elements).toEqual(board.elements);
    expect(r.problems).toEqual(['shot 2 crops the label: pull back']);
    // the second ask carries what Muse saw, as words, and the board it is revising
    const ask = (c.chat.mock.calls[0] as unknown as [{ messages: Array<{ content: string }> }])[0].messages[1]!.content;
    expect(ask).toContain('shot 2 crops the label: pull back');
    expect(ask).toContain('keep the elements and the set');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('revised the board'));
  });
  it('keeps the board when the frames cannot be drawn, the reply is unreadable or the revision fails', async () => {
    const down = vi.fn(async () => {
      throw new Error('no browser');
    });
    const a = await reviewFrames(setup([]).ctx, input(down));
    expect(a).toMatchObject({ board, revised: false });
    const b = await reviewFrames(setup(['garbage']).ctx, input());
    expect(b.revised).toBe(false);
    const c = setup([{ fine: false, problems: ['x'] }, { nonsense: true }, { nonsense: true }]);
    expect((await reviewFrames(c.ctx, input())).revised).toBe(false);
  });
  it('charges the review to the film', async () => {
    const c = setup([{ fine: true }]);
    await reviewFrames(c.ctx, input());
    expect(c.add).toHaveBeenCalledWith('f', 'muse-spark-1.3-contributor', 'frame review', 0.006);
  });
});
