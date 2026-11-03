import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import type { ToolCtx } from '@shared/tools';
import { floorBoard, totalSeconds } from '../authoring/beatsheet';
import sharp from 'sharp';
import { burntShare, washedShare, critiquePrompt, isBurnt, judgeFrames, keyTimes, measureExposure, measureFrames, middleSaturation, parseCritique, REVIEW_FRAMES, reviewFrames, surroundGap } from './frame-review';

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

describe('the burnt-out check', () => {
  const field = (bg: string, mid: string) => sharp({ create: { width: 96, height: 96, channels: 3, background: bg } }).composite([{ input: { create: { width: 40, height: 48, channels: 3 as const, background: mid } }, left: 28, top: 24 }]).png().toBuffer();
  const solid = (c: string) => sharp({ create: { width: 64, height: 64, channels: 3, background: c } }).png().toBuffer();
  it('measures the share of pure white', async () => {
    expect(await burntShare(await solid('#ffffff'))).toBe(1);
    expect(await burntShare(await solid('#202020'))).toBe(0);
    expect(await burntShare(await solid('#f0f0f0'))).toBe(0);
  });
  it('flags a film with two or more burnt frames, and not one with a single bright frame', async () => {
    const white = await field('#ffffff', '#ffffff');
    const dark = await field('#202020', '#808080');
    expect((await measureFrames([dark, white, white, dark]))[0]).toMatch(/burnt out: frame 2 is 100% pure white, frame 3/);
    expect(await measureFrames([dark, white, dark])).toEqual([]);
    expect(await measureFrames([jpg, jpg])).toEqual([]);
  });
  it('measures the gap between the middle of the picture and its surround, and flags a product lost in its set', async () => {
    const cream = '#e8e2d6';
    const lost = await field(cream, '#efe9de');
    const clear = await field('#10202e', '#b8b2a6');
    expect(await surroundGap(lost)).toBeLessThan(0.05);
    expect(await surroundGap(clear)).toBeGreaterThan(0.4);
    expect((await measureFrames([lost, lost, clear, clear]))[0]).toMatch(/no contrast: in frames 1, 2/);
    expect(await measureFrames([lost, clear, clear, clear])).toEqual([]);
  });
  it('flags a film whose product is pushed to full saturation, and says what its photo was', async () => {
    const loud = await field('#10202e', '#ff0040');
    const plain = await field('#10202e', '#b06070');
    expect(await middleSaturation(loud)).toBeGreaterThan(0.85);
    expect(await middleSaturation(plain)).toBeLessThan(0.6);
    const r = await measureFrames([loud, loud, plain, plain], plain);
    expect(r.join('|')).toMatch(/over-saturated: the middle of frames 1, 2 is at 100% colour saturation \(its photo is 45%\)/);
    expect(await measureFrames([loud, plain, plain, plain], plain)).toEqual([]);
  });
});

describe('the gate on a burnt or unfaithful film', () => {
  const flat = (hex: string) => sharp({ create: { width: 40, height: 70, channels: 3, background: hex } }).jpeg().toBuffer();
  const ctxWith = (reply: unknown) => {
    const reviewImages = vi.fn(async () => reply);
    return { ctx: { filmId: 'f', meta: { spark: { reviewImages } }, ledger: { add: vi.fn() } } as unknown as ToolCtx, reviewImages };
  };

  it('measures the mean brightness and the near-white share of the frames, and unreadable frames add nothing', async () => {
    expect(await measureExposure([await flat('#202020'), Buffer.from('not a picture')])).toEqual({ mean: 0.13, hot: 0 });
    expect(await measureExposure([await flat('#ffffff')])).toEqual({ mean: 1, hot: 1 });
  });

  it('calls only a truly burnt picture burnt: a bright scene with its detail is not', () => {
    expect(isBurnt({ mean: 0.92, hot: 0.7 })).toBe(true);
    expect(isBurnt({ mean: 0.79, hot: 0.4 })).toBe(false);
    expect(isBurnt({ mean: 0.6, hot: 0.65 })).toBe(true);
  });

  it('does not ship burnt frames even when Muse says they are fine, and says why', async () => {
    const { ctx } = ctxWith({ fine: true, problems: [] });
    const j = await judgeFrames(ctx, { board, times: [1, 2], frames: [await flat('#ffffff'), await flat('#fefefe')] });
    expect(j.ship).toBe(false);
    expect(j.problems[0]).toMatch(/burnt out/);
  });

  it('ships frames Muse finds fine, and holds back ones it names problems with', async () => {
    const frames = [await flat('#556677')];
    expect((await judgeFrames(ctxWith({ fine: true, problems: [] }).ctx, { board, times: [1], frames })).ship).toBe(true);
    const bad = await judgeFrames(ctxWith({ fine: false, problems: ['the towel is a puck'] }).ctx, { board, times: [1], frames });
    expect(bad).toMatchObject({ ship: false, problems: ['the towel is a puck'] });
  });

  it('shows Muse the real photo first, with the measured brightness, and asks the final look to beat the plain film', async () => {
    const { ctx, reviewImages } = ctxWith({ fine: true, problems: [] });
    const photo = await flat('#aa8844');
    await judgeFrames(ctx, { board, times: [1], frames: [await flat('#556677')], photo, final: true });
    const [images, prompt] = reviewImages.mock.calls[0] as unknown as [Buffer[], string];
    expect(images[0]).toBe(photo);
    expect(images).toHaveLength(2);
    expect(prompt).toContain('real photo of the product');
    expect(prompt).toContain('Measured on the frames');
    expect(prompt).toContain('better advertisement');
  });
});

describe('the washed-out check and the second revision', () => {
  const field = (bg: string, mid: string) => sharp({ create: { width: 96, height: 96, channels: 3, background: bg } }).composite([{ input: { create: { width: 40, height: 48, channels: 3 as const, background: mid } }, left: 28, top: 24 }]).png().toBuffer();
  it('measures the near-white share, and flags a film washed in a bright set while leaving a lit product on a dark one alone', async () => {
    const wash = await field('#f2e6a0', '#f6efb0');
    const dark = await field('#101820', '#e8e2d6');
    expect(await washedShare(wash)).toBeGreaterThan(0.9);
    expect(await washedShare(dark)).toBeLessThan(0.2 + 0.01);
    const r = await measureFrames([wash, wash, wash, dark]);
    expect(r.join('|')).toMatch(/washed out: frame 1 is \d+% near white, frame 2/);
    expect(await measureFrames([wash, dark, dark, dark])).toEqual([]);
    expect(await measureFrames([dark, dark, dark])).toEqual([]);
  });
  it('asks for a second revision when the revised frames still measure washed, and keeps the first revision when they are clean', async () => {
    const wash = await field('#f2e6a0', '#f6efb0');
    const dark = await field('#101820', '#808890');
    const revisedReply = (concept: string) => ({ concept, mood: 'soft', elements: board.elements, beats: board.sheet.beats });
    const run = async (secondFrames: Buffer) => {
      const replies: unknown[] = [{ fine: false, problems: ['x'] }, revisedReply('first take'), revisedReply('second take')];
      const reviewImages = vi.fn(async () => replies.shift());
      const chat = vi.fn(async () => ({ content: JSON.stringify(replies.shift()), toolCalls: [], ms: 1, model: 'spark' }));
      const ctx = { filmId: 'f', meta: { spark: { chat, reviewImages } }, ledger: { add: vi.fn() } } as unknown as ToolCtx;
      let call = 0;
      const render = vi.fn(async (t: number[]) => t.map(() => (call++ === 0 ? dark : secondFrames)));
      const log = vi.fn();
      const r = await reviewFrames(ctx, { board, title: 'Citrus Soda', flat: false, render, log });
      return { r, chat, log };
    };
    const washed = await run(wash);
    expect(washed.chat).toHaveBeenCalledTimes(2);
    expect(washed.r.board.concept).toBe('second take');
    expect(washed.log).toHaveBeenCalledWith(expect.stringContaining('after its revision: washed out'));
    const clean = await run(dark);
    expect(clean.chat).toHaveBeenCalledTimes(1);
    expect(clean.r.board.concept).toBe('first take');
  });
});
