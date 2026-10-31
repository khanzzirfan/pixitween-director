import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import type { ToolCtx } from '@shared/tools';
import { floorBoard, reviewBoard } from './beatsheet';
import { CRITERIA, applyFixes, criticPrompt, critiqueFilm, frameTimes, parseCritique } from './critic';

const board = floorBoard({ title: 'Coffee Co. Cold Brew', category: 'drinks' });
const scores = { product: 4, idea: 4, peak: 4, light: 4, price: 4, variety: 4 };
const good = (extra: object = {}) => ({ scores, issues: [], fixes: [], ...extra });

describe('critic', () => {
  it('the floor board is a valid starting point', () => {
    expect(reviewBoard(board).violations).toEqual([]);
  });
  it('takes one frame time per shot, the last just before the end', () => {
    const t = frameTimes(board);
    expect(t).toHaveLength(board.sheet.beats.length);
    expect(t[0]).toBeCloseTo(board.sheet.beats[0]!.seconds / 2, 2);
    expect(t.at(-1)).toBeGreaterThan(t.at(-2)!);
  });
  it('puts the rubric, the shots and the allowed fixes in the prompt', () => {
    const p = criticPrompt(board, frameTimes(board));
    for (const c of CRITERIA) expect(p).toContain(`- ${c}:`);
    expect(p).toContain('frame 1 at');
    expect(p).toMatch(/angle: low\|eye\|high/);
  });
  it('passes on a good grade and fails when one criterion is low', () => {
    const a = parseCritique(good(), board);
    expect(a.ok && a.critique.pass && a.critique.mean).toBe(4);
    const b = parseCritique(good({ scores: { ...scores, price: 2 } }), board);
    expect(b.ok && b.critique.pass).toBe(false);
  });
  it('reads JSON text, refuses a missing score and drops ungrounded issues and fixes', () => {
    expect(parseCritique(JSON.stringify(good()), board).ok).toBe(true);
    expect(parseCritique({ scores: { product: 4 } }, board)).toMatchObject({ ok: false, reason: 'no score for idea' });
    const r = parseCritique(
      good({
        issues: [{ shot: 99, criterion: 'peak', evidence: 'a long enough note' }, { shot: 2, criterion: 'peak', evidence: 'the can is behind the splash' }, { shot: 1, criterion: 'peak', evidence: 'short' }],
        fixes: [{ shot: 2, field: 'angle', value: 'high' }, { shot: 40, field: 'angle', value: 'high' }, { shot: 2, field: 'angle', value: 'sideways' }, { shot: 2, field: 'colour', value: 'red' }, { shot: 0, field: 'tone', value: 'cool' }, { shot: 0, field: 'key', value: 'loud' }],
      }),
      board,
    );
    if (!r.ok) throw new Error(r.reason);
    expect(r.critique.issues.map((i) => i.shot)).toEqual([2]);
    expect(r.critique.fixes.map((f) => `${f.field}=${f.value}`)).toEqual(['angle=high', 'tone=cool']);
    expect(r.critique.dropped).toHaveLength(4);
  });
  it('applies a fix that keeps the board passing and refuses one that breaks a rule', () => {
    const n = board.sheet.beats.length;
    const ok = applyFixes(board, [{ shot: 0, field: 'tone', value: 'warm' }]);
    expect(ok.applied).toHaveLength(1);
    expect(ok.board.tone).toBe('warm');
    // the last shot must be a still product; a drop there breaks a rule
    const bad = applyFixes(board, [{ shot: n, field: 'product', value: 'drop' }]);
    expect(bad.applied).toEqual([]);
    expect(bad.refused[0]!.because.join(' ')).toMatch(/still/);
    expect(bad.board).toBe(board);
  });
  it('makes one Spark call with one frame per shot and bills it', async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } }).png().toBuffer();
    const reviewImages = vi.fn(async () => good());
    const ledger = { add: vi.fn() };
    const ctx = { filmId: 'f', ledger, meta: { spark: { reviewImages } } } as unknown as ToolCtx;
    const frames = board.sheet.beats.map(() => png);
    const c = await critiqueFilm(ctx, { board, frames, times: frameTimes(board) });
    expect(c.pass).toBe(true);
    expect(reviewImages).toHaveBeenCalledTimes(1);
    expect(ledger.add).toHaveBeenCalledWith('f', 'muse-spark-1.3-contributor', `${frames.length} frames`, 0.005);
    await expect(critiqueFilm(ctx, { board, frames: frames.slice(1), times: [] })).rejects.toThrow(/one frame per shot/);
  });
});
