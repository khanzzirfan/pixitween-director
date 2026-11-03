import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import type { ToolCtx } from '@shared/tools';
import { choosesFlat, defaultFinish, boardPrompt, checkBeatSheet, defaultBeatSheet, effectiveAngles, effectiveSizes, floorBoard, floorSet, isFailureText, parseBoard, planBoard, reviewBoard, totalSeconds, type BeatSheet } from './beatsheet';
import { TEXT_RULES } from './cinematic-rules';
import { FORM_VERDICTS, verdictLines } from './form-verdicts';
import { floorElements } from './ingredients';
import { EXAMPLES, filmLines, nearestFilms, pickExamples, referenceDeck } from './reference-deck';
import type { FilmSnapshot } from '../corpus/films';

const els = floorElements('Coffee Co. Cold Brew', 'drinks');
const sheetOf = (beats: BeatSheet['beats']): BeatSheet => ({ beats });

describe('defaultBeatSheet', () => {
  it('passes its own checker for the coffee set, a bare set and a set Muse might choose', () => {
    expect(checkBeatSheet(defaultBeatSheet(els), els)).toEqual([]);
    const bare = floorElements('Stone Mug', 'home');
    expect(checkBeatSheet(defaultBeatSheet(bare), bare)).toEqual([]);
    const lemon = floorElements('Citrus Soda', 'soda');
    expect(checkBeatSheet(defaultBeatSheet(lemon), lemon)).toEqual([]);
  });
  it('uses every element, up to five of any mix, each in a shot that can play it', () => {
    const mk = (id: string, use: 'solid' | 'card', extra: object = {}) => ({ id, name: id, use, look: `${id} piece in plain words here`, pieces: 1, sizeM: 0.03, ...extra });
    const sets = [
      [mk('a', 'solid'), mk('b', 'solid'), mk('c', 'solid'), mk('d', 'solid'), mk('e', 'solid')],
      [mk('a', 'card'), mk('b', 'card', { pieces: 3 }), mk('c', 'card'), mk('d', 'solid'), mk('e', 'solid', { glass: true })],
      [mk('a', 'solid', { glass: true })],
    ] as Array<ReturnType<typeof mk>[]>;
    for (const set of sets.slice(0, 2)) expect(checkBeatSheet(defaultBeatSheet(set), set)).toEqual([]);
    // a single element cannot fill two shots, so the checker asks for a second; the floor sheet still plays it
    expect(defaultBeatSheet(sets[2]!).beats.filter((b) => b.ingredient)).toHaveLength(1);
  });
  it('runs 8 s, ends on a hold, and uses only the elements it was given', () => {
    const s = defaultBeatSheet(els);
    expect(totalSeconds(s)).toBe(8);
    const last = s.beats.at(-1)!;
    expect(last.move).toBe('hold');
    expect(last.seconds / 8).toBeGreaterThanOrEqual(0.1);
    expect(last.seconds / 8).toBeLessThanOrEqual(0.5);
    for (const b of s.beats) if (b.ingredient) expect(els.map((e) => e.id)).toContain(b.ingredient.kind);
  });
});

describe('checkBeatSheet', () => {
  const ok = defaultBeatSheet(els);
  const mutate = (fn: (b: BeatSheet['beats']) => void): BeatSheet => {
    const c = structuredClone(ok);
    fn(c.beats);
    return c;
  };
  it.each([
    ['a shot is too short', (b: BeatSheet['beats']) => (b[1]!.seconds = 0.2), /shot 2 lasts/],
    ['the last shot is not a hold', (b: BeatSheet['beats']) => (b.at(-1)!.move = 'push'), /must be a hold/],
    ['the hold is too short', (b: BeatSheet['beats']) => (b.at(-1)!.seconds = 0.5), /end hold/],
    ['a shot uses an unknown element', (b: BeatSheet['beats']) => (b[0]!.ingredient = { kind: 'dragon', action: 'fall' }), /not one of the elements/],
    ['a liquid is asked to fall', (b: BeatSheet['beats']) => (b[1]!.ingredient = { kind: 'splash', action: 'fall' }), /a liquid element \("splash"\) can only splash, pour, swirl/],
    ['the last shot has an element', (b: BeatSheet['beats']) => (b.at(-1)!.ingredient = { kind: 'bean', action: 'drift' }), /last shot clear/],
  ])('flags: %s', (_name, fn, re) => {
    expect(checkBeatSheet(mutate(fn), els).join('|')).toMatch(re);
  });
  it('keeps the size rules of a hold and a dolly-zoom for the camera, and checks no taste', () => {
    expect(effectiveSizes(sheetOf([{ size: 'close', move: 'push', seconds: 1 }, { size: 'wide', move: 'hold', seconds: 1 }]))).toEqual(['close', 'close']);
    expect(effectiveSizes(sheetOf([{ size: 'close', move: 'push', seconds: 1 }, { size: 'wide', move: 'orbit', seconds: 1 }]))).toEqual(['close', 'wide']);
  });
  it('lets Muse choose the shape: three same-size shots, no macro, no wide, no truck, no push, a dolly-zoom first, an element nobody uses, a long hook', () => {
    const s = sheetOf([
      { size: 'wide', move: 'dolly-zoom', seconds: 3 },
      { size: 'wide', move: 'orbit', seconds: 2, ingredient: { kind: 'bean', action: 'drift' } },
      { size: 'wide', move: 'pull', seconds: 2 },
      { size: 'wide', move: 'hold', seconds: 2 },
    ]);
    expect(checkBeatSheet(s, els)).toEqual([]);
    expect(checkBeatSheet(sheetOf([{ size: 'macro', move: 'orbit', seconds: 3, ingredient: { kind: 'bean', action: 'drift' }, text: 'Look closer' }, { size: 'medium', move: 'hold', seconds: 2 }, { size: 'medium', move: 'hold', seconds: 2 }]), els).filter((x) => /macro|text/.test(x))).toEqual([]);
  });
  it('still stops what would break the film: too few shots, too short a film, a bad element', () => {
    expect(checkBeatSheet(sheetOf([{ size: 'wide', move: 'push', seconds: 1 }, { size: 'wide', move: 'hold', seconds: 1 }]), els).join('|')).toMatch(/use 3 to 14 shots/);
    expect(checkBeatSheet(sheetOf([{ size: 'wide', move: 'push', seconds: 0.5 }, { size: 'wide', move: 'push', seconds: 0.5 }, { size: 'wide', move: 'hold', seconds: 0.5 }]), els).join('|')).toMatch(/at least|must run 4/);
  });
});

const lemonBoard = () => ({
  concept: 'A lemon soda can bursting with citrus and fizz',
  mood: 'bright, cold, glossy',
  elements: [
    { id: 'lemon-slice', name: 'lemon slice', use: 'solid', look: 'thin lemon slice, cut across, glistening, seen face on', pieces: 1, sizeM: 0.04 },
    { id: 'ice', name: 'ice cube', use: 'solid', glass: true, look: 'clear ice cube with frosted edges', pieces: 1, sizeM: 0.03 },
    { id: 'fizz', name: 'fizz splash', use: 'card', look: 'bright fizzy splash growing then falling, pale yellow, with bubbles', pieces: 3, sizeM: 0.3 },
  ],
  beats: [
    { size: 'wide', move: 'push', seconds: 1, ingredient: { kind: 'lemon-slice', action: 'fall' } },
    { size: 'medium', move: 'push', seconds: 0.9, ingredient: { kind: 'fizz', action: 'splash' } },
    { size: 'macro', move: 'push', seconds: 0.9 },
    { size: 'close', move: 'orbit', seconds: 1.1, ingredient: { kind: 'ice', action: 'orbit' } },
    { size: 'wide', move: 'truck', seconds: 1.1 },
    { size: 'medium', move: 'dolly-zoom', seconds: 1 },
    { size: 'medium', move: 'hold', seconds: 2 },
  ],
});

describe('parseBoard', () => {
  it('reads a board object or fenced JSON, keeping glass and the concept', () => {
    const r = parseBoard('```json\n' + JSON.stringify(lemonBoard()) + '\n```');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.board.concept).toMatch(/lemon soda/);
      expect(r.board.elements.map((e) => e.id)).toEqual(['lemon-slice', 'ice', 'fizz']);
      expect(r.board.elements[1]!.glass).toBe(true);
      expect(checkBeatSheet(r.board.sheet, r.board.elements)).toEqual([]);
    }
  });
  it('drops an element with a brand name or a bad shape and says why, but keeps the board', () => {
    const b = lemonBoard();
    b.elements.push({ id: 'cola', name: 'coke bottle', use: 'solid', look: 'a red coke bottle with a white label', pieces: 1, sizeM: 0.05 });
    (b.elements as unknown[]).push({ id: 'Bad Id', name: 'x' });
    const r = parseBoard(b);
    expect(r.ok && r.board.elements).toHaveLength(3);
    expect(r.ok && r.dropped.join('|')).toMatch(/cola: brand-name "coke"/);
    expect(r.ok && r.dropped.join('|')).toMatch(/element 5/);
  });
  it('keeps the form and traits Muse wrote, and drops a bad value', () => {
    const r = parseBoard({ ...lemonBoard(), form: '2d', traits: { rigid: false, sits: 'lying', edge: 'fuzzy', sells: 'softness' } });
    expect(r.ok && r.board.form).toBe('2d');
    expect(r.ok && r.board.traits).toEqual({ rigid: false, sits: 'lying', edge: 'fuzzy', sells: 'softness' });
    const bad = parseBoard({ ...lemonBoard(), form: 'hologram', traits: { sits: 'floating' } });
    expect(bad.ok && bad.board.form).toBeUndefined();
    expect(bad.ok && bad.board.traits).toBeUndefined();
    const none = parseBoard(lemonBoard());
    expect(none.ok && none.board.form).toBeUndefined();
  });

  it("keeps the body's axis Muse wrote, and drops a bad one", () => {
    const r = parseBoard({ ...lemonBoard(), body: { depth: 0.8, section: 2, axis: 'across' } });
    expect(r.ok && r.board.body).toEqual({ depth: 0.8, section: 2, axis: 'across' });
    const bad = parseBoard({ ...lemonBoard(), body: { depth: 0.8, axis: 'sideways' } });
    expect(bad.ok && bad.board.body?.axis).toBeUndefined();
    expect(boardPrompt({ title: 'Loaf', seconds: 8 }).system).toMatch(/"axis" is how it is built/);
  });
  it("keeps the surface Muse wrote and drops one it does not know", () => {
    expect((parseBoard({ ...lemonBoard(), surface: 'matte' }) as { board: { surface?: string } }).board.surface).toBe('matte');
    const bad = parseBoard({ ...lemonBoard(), surface: 'velvet' });
    expect(bad.ok && bad.board.surface).toBeUndefined();
    expect(boardPrompt({ title: 'Cold brew', seconds: 8 }).system).toMatch(/THE PRODUCT'S SURFACE/);
  });
  it('trusts a 2d choice only when its own traits give the reason', () => {
    expect(choosesFlat({ form: '2d', traits: { rigid: false, sits: 'lying', edge: 'fuzzy' } })).toBe(true);
    expect(choosesFlat({ form: '2d', traits: { rigid: true, sits: 'upright', edge: 'fuzzy' } })).toBe(true);
    expect(choosesFlat({ form: '2d', traits: { rigid: true, sits: 'upright', edge: 'crisp' } })).toBe(false);
    expect(choosesFlat({ form: '2d' })).toBe(false);
    expect(choosesFlat({ form: '3d', traits: { rigid: false } })).toBe(false);
    expect(choosesFlat({})).toBe(false);
  });

  it('teaches the choice of form in the prompt, with the owner\'s verdicts as examples', () => {
    const p = boardPrompt({ title: 'Cold brew', seconds: 10 }).system;
    expect(p).toMatch(/3D OR 2D/);
    for (const line of verdictLines()) expect(p).toContain(line);
    expect(FORM_VERDICTS.some((v) => v.form === '2d')).toBe(true);
    expect(FORM_VERDICTS.some((v) => v.form === '3d')).toBe(true);
  });

  it('drops words that say the model could not see the product, from a shot and from the tagline', () => {
    const b = lemonBoard() as { beats: Array<Record<string, unknown>>; tagline?: string };
    b.beats[1]!.text = 'No pack visible';
    b.beats[0]!.text = 'Sun pool repeat';
    b.tagline = 'Label not readable';
    const r = parseBoard(b);
    expect(r.ok && r.board.sheet.beats[1]!.text).toBeUndefined();
    expect(r.ok && r.board.sheet.beats[0]!.text).toBe('Sun pool repeat');
    expect(r.ok && r.board.tagline).toBeUndefined();
    expect(r.ok && r.notes.join('|')).toMatch(/No pack visible/);
  });
  it('tells a failure to see from copy', () => {
    for (const bad of ['NO PACK VISIBLE', 'not visible', 'Product not found', 'Unknown', 'N/A', 'label is not readable', 'Unable to read', "can't see the can"]) expect(isFailureText(bad), bad).toBe(true);
    for (const good of ['Carry the sunshine', 'No ice, no compromise', 'Nothing beats cold', 'Not just coffee', 'Seen on every beach', 'Find your shade']) expect(isFailureText(good), good).toBe(false);
  });
  it('makes a solid one piece, clamps sizes and gives glass no picture', () => {
    const b = lemonBoard();
    b.elements[0]!.pieces = 4;
    b.elements[0]!.sizeM = 0.5;
    b.elements[2]!.sizeM = 0.01;
    const r = parseBoard(b);
    expect(r.ok && r.board.elements[0]).toMatchObject({ pieces: 1, sizeM: 0.08 });
    expect(r.ok && r.board.elements[2]).toMatchObject({ pieces: 3, sizeM: 0.15 });
  });
  it('reads null as none: a shot with "ingredient": null and no note', () => {
    const b = lemonBoard() as { beats: Array<Record<string, unknown>> };
    for (const beat of b.beats) {
      beat.ingredient ??= null;
      beat.note = null;
    }
    const r = parseBoard(JSON.stringify(b));
    expect(r.ok && checkBeatSheet(r.board.sheet, r.board.elements)).toEqual([]);
  });
  it('rejects non-JSON, empty and wrong shapes', () => {
    expect(parseBoard(undefined).ok).toBe(false);
    expect(parseBoard('hello').ok).toBe(false);
    expect(parseBoard({ beats: [{ size: 'huge', move: 'push', seconds: 1 }], elements: [] }).ok).toBe(false);
  });
});

describe('parseBoard finish', () => {
  const base = () => lemonBoard();
  it('reads the finish Muse chose, mends a bad word to a default and leaves it absent when not asked', () => {
    const a = parseBoard({ ...base(), finish: { glow: 'strong', grain: 'heavy', vignette: 'none', fringe: true, floor: 'mirror', wet: 'heavy', caustics: 'bright' } });
    expect(a.ok && a.board.finish).toEqual({ glow: 'strong', grain: 'heavy', vignette: 'none', fringe: true, floor: 'mirror', wet: 'heavy', caustics: 'bright' });
    const b = parseBoard({ ...base(), finish: { glow: 'blinding', grain: 'fine', vignette: 'soft' } });
    expect(b.ok && b.board.finish).toEqual({ glow: 'soft', grain: 'fine', vignette: 'soft', fringe: false, floor: 'matte', wet: 'none', caustics: 'none' });
    const c = parseBoard(base());
    expect(c.ok && c.board.finish).toBeUndefined();
    expect(defaultFinish('low').glow).toBe('strong');
    expect(defaultFinish('high').vignette).toBe('none');
  });
});

describe('parseBoard tagline', () => {
  it('drops a tagline over the rule book\'s word count instead of cutting it mid-phrase', () => {
    const board = floorBoard({ title: 'Beach Towel', category: 'summer' });
    const raw = { concept: 'c', mood: 'm', tagline: 'Ride every wave all summer long with us', elements: board.elements, beats: board.sheet.beats };
    const r = parseBoard(raw);
    expect(r.ok && r.board.tagline).toBeUndefined();
    expect(r.ok && r.notes.join('|')).toMatch(/tagline/);
    const fits = parseBoard({ ...raw, tagline: 'Ride   every wave' });
    expect(fits.ok && fits.board.tagline).toBe('Ride every wave');
    expect(TEXT_RULES.taglineWords).toBeGreaterThanOrEqual(3);
  });
});

describe('reference deck', () => {
  it.each(EXAMPLES.map((e) => [e.product.slice(0, 24), e] as const))('the worked board for %s parses and passes the checker', (_n, e) => {
    const r = parseBoard(e.board);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.dropped).toEqual([]);
      expect(checkBeatSheet(r.board.sheet, r.board.elements)).toEqual([]);
    }
  });
});

describe('pickExamples', () => {
  it('shows a coffee product other products, not a coffee maker', () => {
    const shown = pickExamples('home Pour-over coffee maker glass steel coffee').map((e) => e.product);
    expect(shown.join('|')).not.toMatch(/coffee maker/i);
    expect(shown).toHaveLength(2);
  });
  it('shows a running shoe other products, not a shoe', () => {
    expect(pickExamples('sport running shoe white mesh sole').map((e) => e.product).join('|')).not.toMatch(/shoe/i);
  });
  it('is stable, and different products meet different examples, never one fixed pair', () => {
    expect(pickExamples('x')).toEqual(pickExamples('x'));
    const pairs = new Set(['candle', 'laptop', 'sofa', 'handbag', 'toothpaste', 'skateboard', 'tea', 'lamp'].map((w) => pickExamples(`gadget ${w}`).map((e) => e.product).join('|')));
    expect(pairs.size).toBeGreaterThan(2);
  });
  it('the worked boards differ in shape: shot counts, lengths and the moves they use', () => {
    const shape = EXAMPLES.map((e) => `${e.board.beats.length}`);
    expect(new Set(shape).size).toBeGreaterThan(2);
    expect(EXAMPLES.filter((e) => e.board.beats.some((b) => (b as { camera?: unknown }).camera)).length).toBeGreaterThan(2);
  });
});

const film = (slug: string, subject: string, moves: string[]): FilmSnapshot => ({
  slug, title: 'pin title', fps: 30, width: 720, height: 1280, duration_s: moves.length, frames: 0, arc: {}, moves: {},
  review: { kind: 'product-ad', subject, summary: `${subject}, shot in a dark studio.`, beats: [], shot_labels: moves.map((_m, i) => ({ shot: i + 1, scale: 'close', beat: 'hook', note: `shot ${i + 1} note` })), learn: ['one idea per film'] },
  shots: moves.map((move, i) => ({ idx: i + 1, start_s: i, end_s: i + 1, dur_s: 1, enters_via: 'cut', move, ease: 'none', zoom_pct: 0, pan_pct: 0, tilt_pct: 0, jitter: 0, luma: 0, contrast: 0, saturation: 0, warmth: 1, key_style: 'low-key', temperature: 'warm', hue: 'amber', dof_ratio: 0 })),
});

describe('nearestFilms', () => {
  const films = [
    film('a', 'Black oud perfume bottle with smoke', ['push-in', 'static', 'pull-out']),
    film('b', 'Orange sneaker floating on grey', ['push-in', 'pan left', 'pull-out', 'tilt up']),
    film('c', 'Iced coffee can with beans', ['push-in', 'push-in', 'push-in']),
  ];
  it('picks the films whose subject shares the most words with the product, from any kind of product', () => {
    expect(nearestFilms('Oud Noir perfume bottles, dark and warm', 1, films)[0]!.slug).toBe('a');
    expect(nearestFilms('running sneakers', 1, films)[0]!.slug).toBe('b');
    expect(nearestFilms('cold brew coffee', 1, films)[0]!.slug).toBe('c');
  });
  it('shows the most varied films when nothing matches, and is stable', () => {
    expect(nearestFilms('camping stove', 1, films)[0]!.slug).toBe('b');
    expect(nearestFilms('camping stove', 3, films)).toEqual(nearestFilms('camping stove', 3, films));
  });
  it('writes each film as its measured shots and lessons, and says when none match', () => {
    const lines = filmLines(films[1]!);
    expect(lines).toContain('Real film: Orange sneaker floating on grey');
    expect(lines).toContain('1.0s close pan left [hook]: shot 2 note');
    expect(lines).toContain('Lesson: one idea per film');
    expect(referenceDeck('perfume bottle', films)).toContain('REAL FILMS NEAREST THIS PRODUCT');
    expect(referenceDeck('camping stove', films)).toContain('the corpus has none of this kind of product');
  });
});

describe('boardPrompt: options, not orders', () => {
  const p = boardPrompt({ title: 'Citrus Soda', seconds: 8 }).system;
  it('offers the camera as numbers Muse writes, with what each means', () => {
    for (const w of ['THE CAMERA is yours', 'camera.from', 'fill', 'height', 'around', 'lens', 'side', 'camera.ease', 'camera.focus', 'place', 'scale']) expect(p).toContain(w);
  });
  it('orders no shape: no required macro, wide, push share, move mix, dolly-zoom reveal, peak position or hook length', () => {
    for (const bad of [/include a (label )?macro/i, /at least one wide/i, /most moving shots push/i, /at least \d different (camera )?moves/i, /use the dolly-zoom once/i, /exactly one shot is peak/i, /at most 1\.5 s/, /never three of the same size/i]) expect(p).not.toMatch(bad);
    expect(p).toMatch(/Everything else is yours/);
  });
});

describe('boardPrompt', () => {
  it('asks Muse to look at the photo and pick elements, with the rules, and repeats broken rules on a retry', () => {
    const p = boardPrompt({ title: 'Citrus Soda', brand: 'Zest', category: 'soda', seconds: 8 });
    expect(p.system).toMatch(/shown the product photo/);
    expect(p.system).toMatch(/2 to 4 real things that belong round THIS product/);
    expect(p.system).toMatch(/3-14 shots/);
    // the reference deck: observations to choose from and worked boards that themselves pass the checker
    expect(p.system).toMatch(/WHAT THE BEST ADS DO/);
    expect(p.system).toMatch(/not rules/);
    expect(p.system).toMatch(/WORKED BOARDS/);
    expect(p.system).toMatch(/REAL FILMS/);
    expect(p.user).toContain('Citrus Soda by Zest (soda)');
    expect(boardPrompt({ title: 'x', seconds: 8, violations: ['use 3 to 14 shots (got 2)'] }).user).toContain('- use 3 to 14 shots (got 2)');
  });
});

const lemon = (): BeatSheet => parseBoardOrThrow(lemonBoard()).sheet;
const parseBoardOrThrow = (b: unknown) => {
  const r = parseBoard(JSON.stringify(b));
  if (!r.ok) throw new Error(r.reason);
  return r.board;
};

describe('planBoard', () => {
  const ctx = (replies: Array<unknown | Error>) => {
    const next = () => {
      const r = replies.shift();
      if (r instanceof Error) throw r;
      return r;
    };
    const reviewImages = vi.fn(async () => next());
    const chat = vi.fn(async () => ({ content: next() as string, toolCalls: [], ms: 1, model: 'spark' }));
    const add = vi.fn();
    return { ctx: { filmId: 'f', meta: { spark: { chat, reviewImages } }, ledger: { add } } as unknown as ToolCtx, chat, reviewImages, add };
  };
  const photo = Buffer.from('x');
  it('shows Muse the photo and takes its board when it passes', async () => {
    const c = ctx([lemonBoard()]);
    const r = await planBoard(c.ctx, { title: 'Citrus Soda', category: 'soda', photo });
    expect(r.source).toBe('muse');
    expect(r.board.elements.map((e) => e.id)).toEqual(['lemon-slice', 'ice', 'fizz']);
    expect(c.reviewImages).toHaveBeenCalledTimes(1);
    expect(c.chat).not.toHaveBeenCalled();
    expect(c.add).toHaveBeenCalledWith('f', 'muse-spark-1.3-contributor', '1 call', 0.005);
  });
  it('asks with words alone when there is no photo', async () => {
    const c = ctx([JSON.stringify(lemonBoard())]);
    const r = await planBoard(c.ctx, { title: 'Citrus Soda' });
    expect(r.source).toBe('muse');
    expect(c.chat).toHaveBeenCalledTimes(1);
  });
  it('asks once more with the broken rules, then takes the second board', async () => {
    const bad = { ...lemonBoard(), beats: [{ size: 'wide', move: 'push', seconds: 1 }] };
    const c = ctx([bad, lemonBoard()]);
    const r = await planBoard(c.ctx, { title: 'Citrus Soda', photo });
    expect(r.source).toBe('muse');
    expect(c.reviewImages).toHaveBeenCalledTimes(2);
    expect((c.reviewImages.mock.calls[1] as unknown as [unknown, string])[1]).toContain('broke these rules');
  });
  it('takes Muse\'s board as written when it only breaks taste: no truck, no macro, an unused element', async () => {
    const odd = lemonBoard();
    odd.beats = odd.beats.map((b) => ({ ...b, move: b.move === 'truck' ? 'push' : b.move, size: b.size === 'macro' ? 'close' : b.size }));
    odd.elements.push({ id: 'mint', name: 'mint leaf', use: 'solid', look: 'fresh mint leaf with fine veins, slightly curled', pieces: 1, sizeM: 0.035 });
    const c = ctx([odd]);
    const r = await planBoard(c.ctx, { title: 'Citrus Soda', photo });
    expect(r.source).toBe('muse');
    expect(c.reviewImages).toHaveBeenCalledTimes(1);
    expect(r.violations).toEqual([]);
    expect(r.board.sheet.beats.map((b) => b.move)).toEqual(odd.beats.map((b) => b.move));
  });
  it('flags more than three cuts that are not a plain cut: each renders the world twice', () => {
    const many: BeatSheet = { beats: lemon().beats.map((b, n) => (n >= 1 && n <= 4 ? { ...b, cut: 'swirl' as const } : b)) };
    const v = checkBeatSheet(many, parseBoardOrThrow(lemonBoard()).elements);
    expect(v.join(' ')).toContain('at most 3 cuts that are not a plain cut');
  });
  it('falls back to the floor board after two bad boards or a failed call', async () => {
    const bad = { ...lemonBoard(), beats: [{ size: 'wide', move: 'push', seconds: 1 }] };
    const a = await planBoard(ctx([bad, bad]).ctx, { title: 'Coffee Co. Cold Brew', category: 'drinks', photo });
    expect(a.source).toBe('floor');
    expect(a.violations.length).toBeGreaterThan(0);
    expect(a.board.elements.map((e) => e.id)).toEqual(['bean', 'ice', 'splash', 'milk']);
    expect(checkBeatSheet(a.board.sheet, a.board.elements)).toEqual([]);
    expect((await planBoard(ctx([new Error('down')]).ctx, { title: 'x', photo })).source).toBe('floor');
  });
  it('tries a failed call once more before falling back', async () => {
    const c = ctx([new Error('busy'), lemonBoard()]);
    const r = await planBoard(c.ctx, { title: 'Citrus Soda', photo });
    expect(r.source).toBe('muse');
    expect(c.reviewImages).toHaveBeenCalledTimes(2);
    const down = await planBoard(ctx([new Error('down'), new Error('down')]).ctx, { title: 'x', photo });
    expect(down.source).toBe('floor');
    expect(down.violations.join(' ')).toContain('the call failed: down');
  });
  it('the floor board names the product and passes the checker', () => {
    const b = floorBoard({ title: 'Coffee Co. Mocha Cold Brew' });
    expect(b.concept).toMatch(/Mocha/);
    expect(checkBeatSheet(b.sheet, b.elements)).toEqual([]);
  });
});

describe('shot fields (angle, phase, product, cut)', () => {
  const base = () => structuredClone(defaultBeatSheet(els));
  it('a dolly-zoom plays the size it names; a hold keeps the size and height before', () => {
    const s = base();
    s.beats[5]!.size = 'wide';
    expect(effectiveSizes(s)[5]).toBe('wide');
    expect(effectiveSizes(s)[6]).toBe('wide');
    expect(effectiveAngles(s)[6]).toBe(s.beats[5]!.angle);
  });
  it('lets an old sheet without phases pass, and keeps the product still in the last shot', () => {
    const s = base();
    for (const b of s.beats) delete b.phase;
    expect(checkBeatSheet(s, els)).toEqual([]);
    s.beats.at(-1)!.product = 'drop';
    expect(checkBeatSheet(s, els).join('|')).toMatch(/holds still in the last shot/);
  });
  it('no longer asks for a hook, a peak or a close phase', () => {
    const s = base();
    s.beats[0]!.phase = 'build';
    s.beats[4]!.phase = 'build';
    expect(checkBeatSheet(s, els)).toEqual([]);
  });
});

describe('reviewBoard and the mending retry', () => {
  it('a shot that used an element the safety pass dropped plays without it, and the board stands', () => {
    const b = parseBoardOrThrow(lemonBoard());
    const withBad = { ...b, elements: [...b.elements.filter((e) => e.id !== 'ice'), { id: 'ice', name: 'Nike ice', use: 'solid' as const, look: 'a Nike logo ice cube, clear', pieces: 1, sizeM: 0.03 }] };
    const r = reviewBoard(withBad);
    expect(r.dropped.join(' ')).toContain('ice');
    expect(r.hard).toEqual([]);
    expect(r.board.sheet.beats.some((x) => x.ingredient?.kind === 'ice')).toBe(false);
    expect(r.board.sheet.beats.some((x) => x.ingredient?.kind === 'lemon-slice')).toBe(true);
  });

  it('passes a good board and names what a hand edit broke', () => {
    const b = floorBoard({ title: 'Coffee Co. Cold Brew', category: 'drinks' });
    expect(reviewBoard(b).violations).toEqual([]);
    b.sheet.beats.at(-1)!.move = 'push';
    b.elements[0]!.look = 'a can of Coca-Cola brand cola soda tin';
    const r = reviewBoard(b);
    expect(r.violations.join('|')).toMatch(/last shot must be a hold/);
    expect(r.dropped.length).toBeGreaterThan(0);
  });
  it('the second ask carries the first board and its broken rules', async () => {
    const reviewImages = vi.fn(async () => JSON.stringify({ concept: 'x', mood: 'y', elements: [], beats: [{ size: 'wide', move: 'push', seconds: 1 }] }));
    const ctx = { filmId: 'f', meta: { spark: { reviewImages } }, ledger: { add: vi.fn() } } as unknown as ToolCtx;
    await planBoard(ctx, { title: 'Citrus Soda', photo: Buffer.from('x') });
    const second = (reviewImages.mock.calls[1] as unknown as [unknown, string])[1];
    expect(second).toContain('Your last board:');
    expect(second).toContain('"concept":"x"');
  });
  it('a saved board that fails starts the retry from itself', async () => {
    const reviewImages = vi.fn(async () => 'not json');
    const ctx = { filmId: 'f', meta: { spark: { reviewImages } }, ledger: { add: vi.fn() } } as unknown as ToolCtx;
    const board = floorBoard({ title: 'Coffee Co. Cold Brew', category: 'drinks' });
    await planBoard(ctx, { title: 'x', photo: Buffer.from('x'), prior: { board, violations: ['use a hold at the end'] } });
    const first = (reviewImages.mock.calls[0] as unknown as [unknown, string])[1];
    expect(first).toContain('use a hold at the end');
    expect(first).toContain('Your last board:');
  });
  it('keeps the reason a call failed', async () => {
    const reviewImages = vi.fn(async () => {
      throw new Error('quota out');
    });
    const ctx = { filmId: 'f', meta: { spark: { reviewImages } }, ledger: { add: vi.fn() } } as unknown as ToolCtx;
    const r = await planBoard(ctx, { title: 'x', photo: Buffer.from('x') });
    expect(r.violations.join('|')).toContain('quota out');
  });
  it('reads tone and key from a reply and ignores a value it does not know', () => {
    const base = { concept: 'c', mood: 'm', elements: [], beats: [{ size: 'wide', move: 'push', seconds: 1 }] };
    const ok = parseBoard({ ...base, tone: 'warm', key: 'low' });
    expect(ok.ok && ok.board.tone).toBe('warm');
    expect(ok.ok && ok.board.key).toBe('low');
    const odd = parseBoard({ ...base, tone: 'purple' });
    expect(odd.ok && odd.board.tone).toBeUndefined();
  });
});

describe('the set on a board', () => {
  const withSet = (set: unknown) => ({ ...JSON.parse(JSON.stringify({ concept: 'c', mood: 'm', elements: floorElements('Stone Mug', 'home'), beats: defaultBeatSheet(floorElements('Stone Mug', 'home')).beats })), set });
  it('reads the look and the air, and a bad air becomes none', () => {
    const ok = parseBoard(withSet({ look: 'beach', air: 'spray' }));
    expect(ok.ok && ok.board.set).toEqual({ look: 'beach', air: 'spray' });
    const bad = parseBoard(withSet({ look: 'beach', air: 'confetti' }));
    expect(bad.ok && bad.board.set).toEqual({ look: 'beach', air: 'none' });
  });
  it('drops a look it does not know, and a board without one has none', () => {
    const unknown = parseBoard(withSet({ look: 'moon', air: 'dust' }));
    expect(unknown.ok && unknown.board.set).toBeUndefined();
    const none = parseBoard(withSet(undefined));
    expect(none.ok && none.board.set).toBeUndefined();
  });
  it('the floor board picks a set from the words: a beach for summer things, a garden for green ones, else a studio', () => {
    expect(floorSet('beach summer Wave Rider Longboard').look).toBe('beach');
    expect(floorSet('home herbal tea').look).toBe('garden');
    expect(floorSet('home Stone Mug').look).toBe('studio');
    expect(floorBoard({ title: 'Swim Goggles', category: 'summer' }).set?.look).toBe('beach');
  });
  it('the prompt teaches the looks, the air and the idea of depth', () => {
    const p = boardPrompt({ title: 'Mug', seconds: 8 }).system;
    for (const w of ['beach', 'pool', 'sunset', 'night', 'bokeh', 'spray', 'parallax']) expect(p).toContain(w);
  });
});

describe('handheld on a board', () => {
  const body = (handheld: unknown) => ({ concept: 'c', mood: 'm', handheld, elements: floorElements('Stone Mug', 'home'), beats: defaultBeatSheet(floorElements('Stone Mug', 'home')).beats });
  it('reads true and false, and anything else is left unset (the film then shakes a little)', () => {
    const off = parseBoard(body(false));
    expect(off.ok && off.board.handheld).toBe(false);
    const on = parseBoard(body(true));
    expect(on.ok && on.board.handheld).toBe(true);
    const bad = parseBoard(body('yes please'));
    expect(bad.ok && bad.board.handheld).toBeUndefined();
  });
  it('the prompt asks for it and teaches the cut', () => {
    const sys = boardPrompt({ title: 'Mug', seconds: 8 }).system;
    expect(sys).toContain('handheld');
    expect(sys).toContain('a cut should land while the camera is moving');
  });
});

describe('the words on a board', () => {
  const els3 = floorElements('Stone Mug', 'home');
  const base = defaultBeatSheet(els3);
  const withText = (texts: Record<number, string>) => ({ beats: base.beats.map((b, i) => (texts[i] !== undefined ? { ...b, text: texts[i] } : b)) });
  it('the floor sheet has none, and a hook line and a feeling pass', () => {
    expect(base.beats.some((b) => b.text)).toBe(false);
    expect(checkBeatSheet(withText({ 0: 'Pack the car', 3: 'Feel the summer' }), els3)).toEqual([]);
  });
  it('allows only the rule book\'s few shots with words, never the last', () => {
    expect(checkBeatSheet(withText({ 0: 'One', 1: 'Two', 3: 'Three' }), els3).join('|')).toMatch(new RegExp(`at most ${TEXT_RULES.maxShots} shots carry text`));
    expect(checkBeatSheet(withText({ 6: 'Buy it now' }), els3).join('|')).toMatch(/last shot carries no text/);
  });
  it('holds the words to what a shot can say: the rule book\'s most, and about three a second', () => {
    expect(checkBeatSheet(withText({ 0: 'one two three four five six' }), els3).join('|')).toMatch(new RegExp(`at most ${TEXT_RULES.maxWords} words`));
    const short = { beats: base.beats.map((b, i) => (i === 1 ? { ...b, seconds: 0.6, text: 'one two three four' } : b)) };
    expect(checkBeatSheet(short, els3).join('|')).toMatch(/can take only 2 words/);
  });
  it('keeps the price out of a shot', () => {
    expect(checkBeatSheet(withText({ 0: 'Now $29 only' }), els3).join('|')).toMatch(/price never goes in/);
    expect(checkBeatSheet(withText({ 0: 'Save 50 today' }), els3).join('|')).toMatch(/price never goes in/);
    expect(checkBeatSheet(withText({ 0: 'Five colours, one board' }), els3).join('|')).not.toMatch(/price never goes in/);
    expect(checkBeatSheet(withText({ 0: 'Now 9 off' }), els3).join('|')).toMatch(/price never goes in/);
  });
  it('reads the tagline and the shot words from Muse, and the prompt teaches them', () => {
    const b = { concept: 'c', mood: 'm', tagline: ' Summer, packed. ', elements: els3, beats: withText({ 0: 'Pack the car' }).beats };
    const r = parseBoard(b);
    expect(r.ok && r.board.tagline).toBe('Summer, packed.');
    expect(r.ok && r.board.sheet.beats[0]!.text).toBe('Pack the car');
    const sys = boardPrompt({ title: 'Mug', seconds: 8 }).system;
    expect(sys).toContain('THE WORDS');
    expect(sys).toContain('tagline');
  });
});

describe('a dolly-zoom is never framed as a macro', () => {
  it('reads as a close, and so does the hold after it', () => {
    const sheet = sheetOf([
      { size: 'wide', move: 'push', seconds: 1 },
      { size: 'macro', move: 'dolly-zoom', seconds: 1 },
      { size: 'wide', move: 'hold', seconds: 2 },
    ]);
    expect(effectiveSizes(sheet)).toEqual(['wide', 'close', 'close']);
  });
});

describe('the set palette and the end card on a board', () => {
  const board = (extra: object) => ({ ...lemonBoard(), ...extra });
  it('reads a palette: colours lower-cased, numbers pulled into range, a bad colour dropped', () => {
    const r = parseBoard(board({ set: { look: 'night', air: 'none', palette: { top: '#4A0A1C', horizon: 'red', ground: '#101010', glow: { x: 4, y: 0.1, color: '#FF3B8D', size: 9 }, band: { color: '#102030', height: 0.9 }, texture: 'rays', accent: '#ffb347' } } }));
    expect(r.ok && r.board.set?.palette).toEqual({ top: '#4a0a1c', ground: '#101010', glow: { x: 1, y: 0.3, color: '#ff3b8d', size: 0.7 }, band: { color: '#102030', height: 0.3 }, texture: 'rays', accent: '#ffb347' });
  });
  it('a bad texture or palette is dropped and the set stands', () => {
    const r = parseBoard(board({ set: { look: 'beach', air: 'dust', palette: { texture: 'lasers' } } }));
    expect(r.ok && r.board.set).toEqual({ look: 'beach', air: 'dust', palette: {} });
    const bad = parseBoard(board({ set: { look: 'beach', air: 'dust', palette: 'pink' } }));
    expect(bad.ok && bad.board.set).toEqual({ look: 'beach', air: 'dust' });
  });
  it('reads a speed ramp, holding wild points to their range, and drops one that is not a list', () => {
    const r = parseBoard(board({ beats: [{ size: 'wide', move: 'push', seconds: 2, ramp: [{ at: -1, rate: 1 }, { at: 0.4, rate: 0.01 }, { at: 3, rate: 9 }] }, { size: 'medium', move: 'hold', seconds: 2, ramp: 'slow' }] }));
    expect(r.ok && r.board.sheet.beats[0]!.ramp).toEqual([{ at: 0, rate: 1 }, { at: 0.4, rate: 0.05 }, { at: 1, rate: 4 }]);
    expect(r.ok && r.board.sheet.beats[1]!.ramp).toBeUndefined();
  });
  it('reads the product spin, the light and the blur, holding wild numbers to their range', () => {
    const r = parseBoard(board({ light: { key: '#FFD7A3', rim: '#22CCDD' }, blur: 3, beats: [{ size: 'wide', move: 'push', seconds: 2, spin: { degrees: 900, ease: 'whip', tilt: -80, roll: 10, lift: 1 }, light: { from: -80, to: 70, elevation: 200, key: 0.5, rim: 2.5 }, blur: 0.8 }, { size: 'medium', move: 'hold', seconds: 2 }] }));
    expect(r.ok && r.board.light).toEqual({ key: '#ffd7a3', rim: '#22ccdd' });
    expect(r.ok && r.board.blur).toBe(1);
    expect(r.ok && r.board.sheet.beats[0]).toMatchObject({ spin: { degrees: 720, ease: 'whip', tilt: -40, roll: 10, lift: 1 }, light: { from: -80, to: 70, elevation: 85, key: 0.5, rim: 2.5 }, blur: 0.8 });
    const odd = parseBoard(board({ light: { key: 'gold' }, beats: [{ size: 'wide', move: 'push', seconds: 2, spin: 'fast', light: 'bright' }, { size: 'medium', move: 'hold', seconds: 2 }] }));
    expect(odd.ok && odd.board.light).toBeUndefined();
    expect(odd.ok && odd.board.sheet.beats[0]!.spin).toBeUndefined();
  });
  it('reads the end card choices and ignores the ones it does not know', () => {
    const r = parseBoard(board({ endCard: { plate: 'bar', price: 'tag', align: 'left', text: 'upper', weight: 'light', accent: '#E0AA3E', pulse: false, mood: 'x' } }));
    expect(r.ok && r.board.endCard).toEqual({ plate: 'bar', price: 'tag', align: 'left', text: 'upper', weight: 'light', accent: '#e0aa3e', pulse: false });
    const odd = parseBoard(board({ endCard: { plate: 'neon', price: 'coin' } }));
    expect(odd.ok && odd.board.endCard).toBeUndefined();
  });
  it('the prompt offers the palette and the end card as options', () => {
    const p = boardPrompt({ title: 'Mug', seconds: 8 }).system;
    for (const w of ["THE WORLD'S COLOURS are yours", 'set.palette', 'glow', 'texture', 'THE END CARD is styled by you', 'plate', 'price', 'align', 'pulse']) expect(p).toContain(w);
    expect(p).toMatch(/do not default to blue/);
  });
});

describe('the camera written out: waypoints, a focus pull, a seeded tremor, the lens', () => {
  const board = (extra: object) => ({ ...lemonBoard(), ...extra });
  const beats = (camera: unknown) => [{ size: 'wide', move: 'push', seconds: 2, camera }, { size: 'medium', move: 'hold', seconds: 2 }];
  it('reads waypoints (at most 3, held to range) and a shot\'s own shake', () => {
    const r = parseBoard(board({ beats: beats({ via: [{ around: 400, fill: 0.5 }, {}, { height: 90 }, { lens: 5 }, { side: 3 }], shake: 9 }) }));
    const cam = r.ok && r.board.sheet.beats[0]!.camera;
    expect(cam && cam.via).toHaveLength(3);
    expect(cam && cam.via![0]).toMatchObject({ around: 180, fill: 0.5 });
    expect(cam && cam.shake).toBe(3);
  });
  it('reads a focus word or a focus pull, and drops a focus that is neither', () => {
    const pull = parseBoard(board({ beats: beats({ focus: { from: 'far', to: 'near', aperture: 4 } }) }));
    expect(pull.ok && pull.board.sheet.beats[0]!.camera!.focus).toEqual({ from: 'far', to: 'near', aperture: 1 });
    const word = parseBoard(board({ beats: beats({ focus: 'rack' }) }));
    expect(word.ok && word.board.sheet.beats[0]!.camera!.focus).toBe('rack');
    const bad = parseBoard(board({ beats: beats({ focus: 'everywhere' }) }));
    expect(bad.ok && bad.board.sheet.beats[0]!.camera!.focus).toBeUndefined();
  });
  it('reads the tremor as a flag or an object, and the lens', () => {
    const o = parseBoard(board({ handheld: { amount: 5, keys: 40, seed: 12.4 }, bokeh: 2, aperture: -1, beats: beats(undefined) }));
    expect(o.ok && o.board.handheld).toEqual({ amount: 3, keys: 6, seed: 12 });
    expect(o.ok && o.board.bokeh).toBe(1);
    expect(o.ok && o.board.aperture).toBe(0);
    const f = parseBoard(board({ handheld: false, beats: beats(undefined) }));
    expect(f.ok && f.board.handheld).toBe(false);
  });
});

describe('the colour grade on a board', () => {
  const board = (extra: object) => ({ ...lemonBoard(), ...extra });
  it('reads a grade, holding numbers to range and dropping a bad colour, and none when it names nothing', () => {
    const r = parseBoard(board({ grade: { exposure: 2, contrast: -1, saturation: 0.4, hue: 90, shadows: '#0A5A6A', highlights: 'orange', split: 3, streak: { color: '#88AAFF', strength: 9, reach: 0.01 }, halation: 0.5, letterbox: 5 } }));
    expect(r.ok && r.board.grade).toEqual({ exposure: 0.3, contrast: 0, saturation: 0.4, hue: 40, shadows: '#0a5a6a', split: 1, streak: { color: '#88aaff', strength: 2, reach: 0.02 }, halation: 0.5, letterbox: 2.6 });
    const none = parseBoard(board({ grade: {} }));
    expect(none.ok && none.board.grade).toBeUndefined();
  });
});
