import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import type { ToolCtx } from '@shared/tools';
import type { FilmStore } from '@shared/ports';
import { commitCuts, keeps3d, parsePick, pickForm, pickPrompt, PICK_FRAMES, PICK_SHARES, threeDFirst } from './form-pick';

const frames = (tag: string) => Array.from({ length: PICK_FRAMES }, (_, i) => Buffer.from(`${tag}${i}`));
const ctxWith = (answer: unknown, seen: Buffer[][] = []) =>
  ({
    filmId: 'film_x',
    ledger: { add: () => {} },
    meta: { spark: { reviewImages: async (images: Buffer[]) => (seen.push(images), answer) } },
  }) as unknown as ToolCtx;

describe('the 2D or 3D pick', () => {
  it('maps A and B back to the forms, whichever was shown first', () => {
    expect(parsePick({ better: 'A', clear: true, why: 'x' }, true)).toEqual({ better: '3d', clear: true, why: 'x' });
    expect(parsePick({ better: 'A', clear: true }, false).better).toBe('2d');
    expect(parsePick({ better: 'b', clear: false }, true).better).toBe('2d');
    expect(parsePick('```json\n{"better":"B","clear":true}\n```', false)).toMatchObject({ better: '3d', clear: true });
  });
  it('reads anything unclear as a tie, which keeps the 3D film', () => {
    expect(parsePick('no idea', true).better).toBe('tie');
    expect(parsePick({ better: 'both' }, true).better).toBe('tie');
    expect(parsePick({ better: 'A', clear: 'yes' }, true).clear).toBe(false);
    expect(keeps3d(parsePick(undefined, true))).toBe(true);
  });
  it('takes the film back to 2D only on a clear 2D win', () => {
    expect(keeps3d({ better: '2d', clear: true, why: '' })).toBe(false);
    expect(keeps3d({ better: '2d', clear: false, why: '' })).toBe(true);
    expect(keeps3d({ better: '3d', clear: false, why: '' })).toBe(true);
    expect(keeps3d({ better: 'tie', clear: true, why: '' })).toBe(true);
  });
  it('tells Muse the client prefers the 3D world and that looking like the photo is not a reason for 2D', () => {
    const p = pickPrompt({ title: 'Cold Brew', withPhoto: true });
    expect(p).toMatch(/loves a cinematic 3D world/);
    expect(p).toMatch(/do not prefer it for that/);
  });
  it('fixes the order per film, and shows 3D first for about half of all films', () => {
    expect(threeDFirst('film_a77e3de64d49')).toBe(threeDFirst('film_a77e3de64d49'));
    const firsts = Array.from({ length: 200 }, (_, i) => threeDFirst(`film_${i.toString(16).padStart(12, '0')}`)).filter(Boolean).length;
    expect(firsts).toBeGreaterThan(70);
    expect(firsts).toBeLessThan(130);
  });
  it('shows the photo, then film A, then film B, and names them in the prompt', async () => {
    const seen: Buffer[][] = [];
    const photo = Buffer.from('photo');
    const shares: Array<readonly number[]> = [];
    const pick = await pickForm(ctxWith({ better: 'A', clear: true }, seen), {
      filmId: 'film_x',
      title: 'Cold Brew',
      photo,
      render2d: async (s) => (shares.push(s), frames('flat')),
      render3d: async () => frames('solid'),
    });
    const aIs3d = threeDFirst('film_x');
    expect(seen[0]![0]).toBe(photo);
    expect(seen[0]![1]!.toString()).toBe(aIs3d ? 'solid0' : 'flat0');
    expect(seen[0]![1 + PICK_FRAMES]!.toString()).toBe(aIs3d ? 'flat0' : 'solid0');
    expect(pick.better).toBe(aIs3d ? '3d' : '2d');
    expect(shares[0]).toEqual(PICK_SHARES);
    expect(pickPrompt({ title: 'Cold Brew', withPhoto: true })).toContain(`pictures 2 to ${PICK_FRAMES + 1}`);
  });
  it('keeps the 3D film when the frames cannot be drawn, as before the check', async () => {
    const fail = await pickForm(ctxWith({ better: 'A' }), { filmId: 'f', title: 't', render2d: async () => { throw new Error('no server'); }, render3d: async () => frames('s') });
    expect(keeps3d(fail)).toBe(true);
    const short = await pickForm(ctxWith({ better: 'A' }), { filmId: 'f', title: 't', render2d: async () => [], render3d: async () => frames('s') });
    expect(keeps3d(short)).toBe(true);
  });
});

describe('the burnt floor', () => {
  it('sends a measurably burnt 3D cut back to 2D without asking Muse', async () => {
    const sharp = (await import('sharp')).default;
    const white = await sharp({ create: { width: 40, height: 70, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
    const seen: Buffer[][] = [];
    const pick = await pickForm(ctxWith({ better: 'A', clear: true }, seen), { filmId: 'f', title: 't', render2d: async () => frames('flat'), render3d: async () => Array.from({ length: PICK_FRAMES }, () => white) });
    expect(pick).toMatchObject({ better: '2d', clear: true });
    expect(pick.why).toMatch(/burnt out/);
    expect(seen).toHaveLength(0);
    expect(keeps3d(pick)).toBe(false);
  });
});

describe('saving both cuts', () => {
  const flat = { id: 'flat' } as never;
  const solid = { id: 'solid' } as never;
  const store = (refuse: string[] = []) => {
    const log: string[] = [];
    const films = {
      commit: async (_id: string, c: { id: string }, _src: string, note: string) => {
        if (refuse.includes(c.id)) return { ok: false as const, issues: ['refused'] };
        log.push(`${c.id}: ${note.split(':')[0]}`);
        return { ok: true as const, version: log.length };
      },
      undo: async () => (log.push('undo'), 0),
    } as unknown as FilmStore;
    return { films, log };
  };
  it('plays the 3D cut and keeps the 2D film one version back', async () => {
    const { films, log } = store();
    expect(await commitCuts(films, 'f', { flat, solid, keep: '3d' })).toBe(true);
    expect(log).toEqual(['flat: alternative cut, not chosen', 'solid: cinematic cut']);
  });
  it('plays the 2D cut and keeps the 3D film one version back', async () => {
    const { films, log } = store();
    expect(await commitCuts(films, 'f', { flat, solid, keep: '2d' })).toBe(true);
    expect(log).toEqual(['solid: alternative cut, not chosen', 'flat: finish']);
  });
  it('commits only the 3D cut when there is no 2D cut', async () => {
    const { films, log } = store();
    expect(await commitCuts(films, 'f', { solid, keep: '3d' })).toBe(true);
    expect(log).toEqual(['solid: cinematic cut']);
  });
  it('never leaves a refused cut as the head', async () => {
    const a = store(['solid']);
    // the 3D cut is refused after the 2D was kept: the film plays the finished 2D cut
    expect(await commitCuts(a.films, 'f', { flat, solid, keep: '3d' })).toBe(true);
    expect(a.log).toEqual(['flat: alternative cut, not chosen']);
    const b = store(['flat']);
    // the 2D cut is refused after the 3D was kept as the alternative: step back off it and let the caller finish the 2D film
    expect(await commitCuts(b.films, 'f', { flat, solid, keep: '2d' })).toBe(false);
    expect(b.log).toEqual(['solid: alternative cut, not chosen', 'undo']);
    const c = store(['solid']);
    expect(await commitCuts(c.films, 'f', { solid, keep: '3d' })).toBe(false);
  });
});
