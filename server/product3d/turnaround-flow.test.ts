import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolCtx } from '@shared/tools';

const m = vi.hoisted(() => ({
  draw: vi.fn(),
  split: vi.fn(),
  agree: vi.fn(),
  check: vi.fn(),
  cutout: vi.fn(),
}));
vi.mock('./turnaround', () => ({ drawTurnaround: m.draw, splitTurnaround: m.split }));
vi.mock('./agree', () => ({ viewsAgree: m.agree }));
vi.mock('./turnaround-check', () => ({ checkTurnaround: m.check }));
vi.mock('../art/cutout', () => ({ cutout: m.cutout }));

import { clearTurnaroundCache, suppliedBack, turnaroundFor } from './turnaround-flow';

const buf = (s: string) => Buffer.from(s);
const views = { front: buf('f'), side: buf('s'), back: buf('b') };
const adds: Array<[string, number]> = [];
const ctxWith = (reply: unknown = { back: null }): ToolCtx =>
  ({ filmId: 'f1', ledger: { add: (_f: string, _m: string, u: string, usd: number) => adds.push([u, usd]) }, meta: { spark: { reviewImages: vi.fn(async () => reply) } }, assets: { read: vi.fn(async () => buf('cutback')) } }) as unknown as ToolCtx;
let n = 0;
const input = (extra: Record<string, unknown> = {}) => ({ photo: buf(`photo${n++}`), cut: buf('cut'), what: 'a bottle', log: vi.fn(), ...extra });

beforeEach(() => {
  process.env.TURNAROUND = '1';
  clearTurnaroundCache();
  adds.length = 0;
  for (const f of Object.values(m)) f.mockReset();
  m.draw.mockResolvedValue({ sheet: buf('sheet'), reference: { png: buf('r'), panel: buf('p') } });
  m.split.mockResolvedValue({ ok: true, views, frontKept: 0.01 });
  m.agree.mockResolvedValue({ ok: true, problems: [], depthShare: 0.96 });
  m.check.mockResolvedValue({ ok: true, problems: [] });
});
afterEach(() => {
  delete process.env.TURNAROUND;
});

describe('turnaroundFor', () => {
  it('returns the views and the depth when the first sheet passes, with one draw and one check', async () => {
    const out = await turnaroundFor(ctxWith(), input());
    expect(out?.depthShare).toBe(0.96);
    expect(out?.views.back).toEqual(views.back);
    expect(out?.views.front).toEqual(buf('cut'));
    expect(m.draw).toHaveBeenCalledTimes(1);
    expect(m.check).toHaveBeenCalledTimes(1);
  });
  it('redraws once with the first problem when code refuses the first sheet, and checks only the second', async () => {
    m.agree.mockResolvedValueOnce({ ok: false, problems: ['the back is another shape'], depthShare: 0.9 });
    const out = await turnaroundFor(ctxWith(), input());
    expect(out).toBeDefined();
    expect(m.draw).toHaveBeenCalledTimes(2);
    expect(m.draw.mock.calls[1]![1].extra).toEqual(['the back is another shape']);
    expect(m.check).toHaveBeenCalledTimes(1);
    expect(m.split.mock.calls[0]![1]).toMatchObject({ cut: buf('cut') });
  });
  it("redraws when Muse's look says no", async () => {
    m.check.mockResolvedValueOnce({ ok: false, problems: ['a stray lump on the back'] });
    expect(await turnaroundFor(ctxWith(), input())).toBeDefined();
    expect(m.draw).toHaveBeenCalledTimes(2);
    expect(m.draw.mock.calls[1]![1].extra).toEqual(['a stray lump on the back']);
  });
  it('is undefined with a log line when both sheets fail, and a failure is not kept', async () => {
    m.agree.mockResolvedValue({ ok: false, problems: ['bad'], depthShare: 0.9 });
    const i = input();
    expect(await turnaroundFor(ctxWith(), i)).toBeUndefined();
    expect(i.log.mock.calls.map((c) => c[0]).join('\n')).toContain('single-photo body');
    expect(m.draw).toHaveBeenCalledTimes(2);
    m.agree.mockResolvedValue({ ok: true, problems: [], depthShare: 0.9 });
    expect(await turnaroundFor(ctxWith(), i)).toBeDefined();
  });
  it('is undefined with a log line when the draw rejects, and does not redraw', async () => {
    m.draw.mockRejectedValue(new Error('turnaround: quota'));
    const i = input();
    expect(await turnaroundFor(ctxWith(), i)).toBeUndefined();
    expect(i.log.mock.calls.map((c) => c[0]).join('\n')).toMatch(/quota.*single-photo body/);
    expect(m.draw).toHaveBeenCalledTimes(1);
  });
  it('draws a photo once: a second call after a success makes no new draw', async () => {
    const i = input();
    await turnaroundFor(ctxWith(), i);
    await turnaroundFor(ctxWith(), i);
    expect(m.draw).toHaveBeenCalledTimes(1);
  });
  it('tells onAttempt about every drawing, the refused one too, with its scores', async () => {
    m.agree.mockResolvedValueOnce({ ok: false, problems: ['the back is another shape'], scores: { frontKept: 0.05, outline: 0.6, colour: 9 } });
    const seen: Array<{ n: number; passed: boolean; problems: string[] }> = [];
    await turnaroundFor(ctxWith(), input({ onAttempt: (a: { n: number; passed: boolean; problems: string[] }) => seen.push(a) }));
    expect(seen.map((a) => [a.n, a.passed])).toEqual([[1, false], [2, true]]);
    expect(seen[0]!.problems).toEqual(['the back is another shape']);
  });
  it('does nothing with TURNAROUND off', async () => {
    delete process.env.TURNAROUND;
    expect(await turnaroundFor(ctxWith(), input())).toBeUndefined();
    expect(m.draw).not.toHaveBeenCalled();
  });
});

describe('a supplied back photo', () => {
  it('is cut out and used, and nothing is drawn', async () => {
    m.cutout.mockResolvedValue({ cutout: { id: 'ast_back' } });
    const out = await turnaroundFor(ctxWith({ back: 1 }), input({ others: [buf('other')] }));
    expect(m.cutout).toHaveBeenCalledTimes(1);
    expect(m.draw).not.toHaveBeenCalled();
    expect(out?.views).toEqual({ front: buf('cut'), back: buf('cutback') });
    expect(out?.depthShare).toBeUndefined();
  });
  it('falls through to drawing on {"back": null} or an unreadable reply', async () => {
    expect(await turnaroundFor(ctxWith({ back: null }), input({ others: [buf('o')] }))).toBeDefined();
    expect(m.draw).toHaveBeenCalledTimes(1);
    expect(await turnaroundFor(ctxWith('what?'), input({ others: [buf('o')] }))).toBeDefined();
    expect(m.draw).toHaveBeenCalledTimes(2);
    expect(m.cutout).not.toHaveBeenCalled();
  });
  it('adds exactly one ledger entry and makes no look without other pictures', async () => {
    expect(await suppliedBack(ctxWith({ back: null }), { photo: buf('p'), others: [buf('o')], noun: 'bottle' })).toBeUndefined();
    expect(adds).toHaveLength(1);
    expect(await suppliedBack(ctxWith(), { photo: buf('p'), others: [], noun: 'bottle' })).toBeUndefined();
    expect(adds).toHaveLength(1);
  });
});
