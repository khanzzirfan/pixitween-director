import { describe, expect, it } from 'vitest';
import { buildCinematicFilm, type CinematicInput } from '../../authoring/cinematic-film';
import { defaultBeatSheet, totalSeconds, type Beat } from '../../authoring/beatsheet';
import { floorElements } from '../../authoring/ingredients';
import type { Obj } from '../../authoring/types';
import { framingProblems, jsonRules, sameFrame } from './json-rules';

const els = floorElements('Pure Spoonful Berry Yoghurt', 'food');
const withWords = (): CinematicInput['sheet'] => {
  const sheet = defaultBeatSheet(els);
  return { beats: sheet.beats.map((b, i): Beat => (i === 1 ? { ...b, text: 'Taste the berry' } : b)) };
};
const input = (): CinematicInput => ({
  aspect: '9:16',
  sheet: withWords(),
  texture: { id: 'ast_label', src: '/a', width: 2048, height: 1024, kind: 'label' },
  shape: 'can',
  side: '#e8e0ce',
  productAspect: 2,
  title: 'Pure Spoonful',
  accent: '#c27a3a',
  price: 4.5,
  currency: 'USD',
});
const asked = (c: CinematicInput) => Math.round(totalSeconds(c.sheet));

describe('jsonRules', () => {
  it('passes a clean film', () => {
    const i = input();
    expect(jsonRules(buildCinematicFilm(i), { askedSeconds: totalSeconds(i.sheet), aspect: '9:16' })).toEqual([]);
  });
  it('names the length when the film runs longer than asked', () => {
    const i = input();
    const total = totalSeconds(i.sheet);
    const problems = jsonRules(buildCinematicFilm(i), { askedSeconds: total - 2, aspect: '9:16' });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(String(total));
    expect(problems[0]).toContain(String(total - 2));
    expect(asked(i)).toBeGreaterThan(0);
  });
  it('names a title moved off the frame', () => {
    const i = input();
    const film = buildCinematicFilm(i) as Obj;
    const title = film.precomps.cine.layers.find((l: Obj) => l.kind === 'prop3d' && l.source?.type === 'text3d');
    title.position = [9, title.position[1], title.position[2]];
    const problems = jsonRules(film as ReturnType<typeof buildCinematicFilm>, { askedSeconds: totalSeconds(i.sheet), aspect: '9:16' });
    expect(problems.some((p) => p.includes(String(title.source.text)) && /edge|outside|past/.test(p))).toBe(true);
  });
  it('names a title that covers the product at the middle of a shot', () => {
    const i = input();
    const film = buildCinematicFilm(i) as Obj;
    const title = film.precomps.cine.layers.find((l: Obj) => l.kind === 'prop3d' && l.source?.type === 'text3d');
    title.position = [0, 0, title.position[2]];
    title.source.size = 0.8;
    title.source.enter = { ...title.source.enter, atFrame: 0 };
    title.outPoint = film.durationInFrames;
    delete title.source.exit;
    const problems = jsonRules(film as ReturnType<typeof buildCinematicFilm>, { askedSeconds: totalSeconds(i.sheet), aspect: '9:16' });
    expect(problems.some((p) => /cover/.test(p))).toBe(true);
  });
});

describe('framingProblems', () => {
  // a world whose camera sits at these points (x, y, z from a product at the origin), one still shot each, with a clear jump at every cut
  const worldOf = (points: Array<[number, number, number]>) => {
    const position = points.flatMap((p, i) => [{ t: i * 30, v: p }, { t: i * 30 + 29, v: p, hold: true }]);
    return { camera: { position, target: [0, 0, 0], fov: 30 } } as Obj;
  };
  const product = { size: 0.16 } as Obj;
  const shots = (n: number) => Array.from({ length: n }, (_, i) => ({ start: i * 30, end: i * 30 + 29 }));

  it('names three straight-on shots in a row at one size as one shot (the tub, 4 Nov)', () => {
    const w = worldOf([[0, 0, 0.6], [0.1, 0, 0.6], [-0.1, 0, 0.6], [0, 0.05, 0.6], [0, 0.6, 0.3]]);
    const problems = framingProblems(w, product, shots(5));
    expect(problems.some((p) => p.startsWith('shots 1, 2, 3 and 4 frame the product the same way'))).toBe(true);
  });
  it('passes shots that change size, angle or side at every cut', () => {
    const w = worldOf([[0, 0, 1.6], [0, 0, 0.5], [0, 0.4, 0.4], [0.6, 0, 0], [0, 0, 1]]);
    expect(framingProblems(w, product, shots(5))).toEqual([]);
  });
  it('names a jump cut where the camera moves a little but the framing stays', () => {
    // shot 1 pushes in to 0.6; shot 2 starts a step to the side of there and pushes on in
    const position = [{ t: 0, v: [0, 0, 1.5] }, { t: 29, v: [0, 0, 0.6], hold: true }, { t: 30, v: [0.06, 0, 0.6] }, { t: 59, v: [0, 0, 0.3], hold: true }, { t: 60, v: [0, 0.5, 0.5] }, { t: 89, v: [0, 0.5, 0.5], hold: true }];
    const w = { camera: { position, target: [0, 0, 0], fov: 30 } } as Obj;
    expect(framingProblems(w, product, shots(3))).toEqual([expect.stringContaining('the cut from shot 1 to shot 2 is a jump cut')]);
  });
  it('does not name a shot that carries on the camera of the one before', () => {
    const position = [{ t: 0, v: [0, 0, 0.6] }, { t: 29, v: [0, 0, 0.6], hold: true }, { t: 30, v: [0, 0, 0.6] }, { t: 59, v: [0, 0, 0.6], hold: true }, { t: 60, v: [0, 0.5, 0.5] }, { t: 89, v: [0, 0.5, 0.5], hold: true }];
    expect(framingProblems({ camera: { position, target: [0, 0, 0], fov: 30 } } as Obj, product, shots(3))).toEqual([]);
  });
  it('reads a turn round the product across the back as a small one', () => {
    const f = (around: number) => ({ fill: 0.5, up: 0, around, pos: [0, 0, 0] as [number, number, number], dist: 1 });
    expect(sameFrame(f(175), f(-175))).toBe(true);
    expect(sameFrame(f(0), f(45))).toBe(false);
  });
});
