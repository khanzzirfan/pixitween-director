import { describe, expect, it } from 'vitest';
import { buildCinematicFilm, type CinematicInput } from '../../authoring/cinematic-film';
import { defaultBeatSheet, totalSeconds, type Beat } from '../../authoring/beatsheet';
import { floorElements } from '../../authoring/ingredients';
import type { Obj } from '../../authoring/types';
import { jsonRules } from './json-rules';

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
