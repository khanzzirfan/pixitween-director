import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import type { ToolCtx } from '@shared/tools';
import { boardPrompt, checkBeatSheet, defaultBeatSheet, effectiveAngles, effectiveSizes, floorBoard, floorSet, parseBoard, planBoard, reviewBoard, totalSeconds, type BeatSheet } from './beatsheet';
import { TEXT_RULES } from './cinematic-rules';
import { floorElements } from './ingredients';
import { EXAMPLES, pickExamples, referenceDeck } from './reference-deck';

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
  it('runs 8 s, ends on a hold of 12-37 %, and uses only the elements it was given', () => {
    const s = defaultBeatSheet(els);
    expect(totalSeconds(s)).toBe(8);
    const last = s.beats.at(-1)!;
    expect(last.move).toBe('hold');
    expect(last.seconds / 8).toBeGreaterThanOrEqual(0.12);
    expect(last.seconds / 8).toBeLessThanOrEqual(0.37);
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
    ['the first shot is too long', (b: BeatSheet['beats']) => (b[0]!.seconds = 2), /hook/],
    ['a shot is too short', (b: BeatSheet['beats']) => (b[1]!.seconds = 0.2), /shot 2 lasts/],
    ['the last shot is not a hold', (b: BeatSheet['beats']) => (b.at(-1)!.move = 'push'), /must be a hold/],
    ['the hold is too short', (b: BeatSheet['beats']) => (b.at(-1)!.seconds = 0.5), /end hold/],
    ['a shot uses an unknown element', (b: BeatSheet['beats']) => (b[0]!.ingredient = { kind: 'dragon', action: 'fall' }), /not one of the elements/],
    ['a card is asked to fall', (b: BeatSheet['beats']) => (b[1]!.ingredient = { kind: 'splash', action: 'fall' }), /can only splash, swirl/],
    ['the macro carries an element', (b: BeatSheet['beats']) => (b[2]!.ingredient = { kind: 'bean', action: 'drift' }), /label macro/],
    ['the last shot has an element', (b: BeatSheet['beats']) => (b.at(-1)!.ingredient = { kind: 'bean', action: 'drift' }), /last shot clear/],
    ['the opener is a dolly-zoom', (b: BeatSheet['beats']) => (b[0]!.move = 'dolly-zoom'), /not the opener/],
    ['an element is never used', (b: BeatSheet['beats']) => (b[4]!.ingredient = undefined), /"milk" is never used/],
  ])('flags: %s', (_name, fn, re) => {
    expect(checkBeatSheet(mutate(fn), els).join('|')).toMatch(re);
  });
  it('flags three shots of the same size in a row, not counting a hold or a dolly-zoom, which continue the shot before', () => {
    const s = sheetOf([
      { size: 'wide', move: 'push', seconds: 1 },
      { size: 'wide', move: 'push', seconds: 1, ingredient: { kind: 'bean', action: 'fall' } },
      { size: 'wide', move: 'push', seconds: 1, ingredient: { kind: 'ice', action: 'orbit' } },
      { size: 'macro', move: 'push', seconds: 1 },
      { size: 'wide', move: 'push', seconds: 1 },
      { size: 'wide', move: 'hold', seconds: 2 },
    ]);
    expect(checkBeatSheet(s, els).join('|')).toMatch(/shots 1 to 3 are all wide/);
    expect(effectiveSizes(sheetOf([{ size: 'close', move: 'push', seconds: 1 }, { size: 'wide', move: 'hold', seconds: 1 }]))).toEqual(['close', 'close']);
    expect(effectiveSizes(sheetOf([{ size: 'close', move: 'push', seconds: 1 }, { size: 'wide', move: 'orbit', seconds: 1 }]))).toEqual(['close', 'wide']);
    const run = sheetOf([
      { size: 'wide', move: 'push', seconds: 1, ingredient: { kind: 'bean', action: 'fall' } },
      { size: 'macro', move: 'push', seconds: 1 },
      { size: 'medium', move: 'push', seconds: 1, ingredient: { kind: 'ice', action: 'orbit' } },
      { size: 'medium', move: 'dolly-zoom', seconds: 1 },
      { size: 'medium', move: 'hold', seconds: 2 },
    ]);
    expect(checkBeatSheet(run, els).join('|')).not.toMatch(/alternate/);
  });
  it('requires a macro, a wide and push-in to lead', () => {
    const s = mutate((b) => b.forEach((x) => { if (x.move === 'push') x.move = 'pull'; }));
    expect(checkBeatSheet(s, els).join('|')).toMatch(/push-in leads/);
    const noMacro = mutate((b) => (b[2]!.size = 'close'));
    expect(checkBeatSheet(noMacro, els).join('|')).toMatch(/label macro shot/);
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
  it('shows a coffee product the seasoning and the yogurt, not the latte', () => {
    const shown = pickExamples('drinks Coffee Co. Cold Brew coffee latte').map((e) => e.product);
    expect(shown.join('|')).not.toMatch(/latte/i);
    expect(shown).toHaveLength(2);
  });
  it('shows a yogurt product the latte and the seasoning', () => {
    expect(pickExamples('dairy fruit yogurt cup berry').map((e) => e.product).join('|')).not.toMatch(/yogurt/i);
  });
  it('is stable, and puts only the chosen examples in the prompt', () => {
    expect(pickExamples('x')).toEqual(pickExamples('x'));
    const deck = referenceDeck('drinks Coffee Co. Cold Brew coffee latte');
    expect(deck).toMatch(/Emberhouse/);
    expect(deck).not.toMatch(/Nocturne/);
  });
});

describe('boardPrompt', () => {
  it('asks Muse to look at the photo and pick elements, with the rules, and repeats broken rules on a retry', () => {
    const p = boardPrompt({ title: 'Citrus Soda', brand: 'Zest', category: 'soda', seconds: 8 });
    expect(p.system).toMatch(/shown the product photo/);
    expect(p.system).toMatch(/2 to 4 real things that belong round THIS product/);
    expect(p.system).toMatch(/hook of at most 1.5 s/);
    // the reference deck: craft rules and two worked boards that themselves pass the checker
    expect(p.system).toMatch(/HOW THE BEST ADS ARE CUT/);
    expect(p.system).toMatch(/ONE idea/);
    expect(p.system).toMatch(/TWO WORKED BOARDS/);
    expect(p.user).toContain('Citrus Soda by Zest (soda)');
    expect(boardPrompt({ title: 'x', seconds: 8, violations: ['use 5 to 10 shots (got 3)'] }).user).toContain('- use 5 to 10 shots (got 3)');
  });
});

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
  it('sends a board with an element nobody uses back for a fix', async () => {
    const unused = lemonBoard();
    unused.elements.push({ id: 'mint', name: 'mint leaf', use: 'solid', look: 'fresh mint leaf with fine veins, slightly curled', pieces: 1, sizeM: 0.035 });
    const c = ctx([unused, lemonBoard()]);
    const r = await planBoard(c.ctx, { title: 'Citrus Soda', photo });
    expect(r.source).toBe('muse');
    expect((c.reviewImages.mock.calls[1] as unknown as [unknown, string])[1]).toContain('"mint" is never used');
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
  it('two shots alike in size, height and move are one shot with a jump', () => {
    const s = base();
    s.beats[1] = { ...s.beats[0]!, ingredient: s.beats[1]!.ingredient };
    s.beats[1]!.phase = 'build';
    expect(checkBeatSheet(s, els).join('|')).toMatch(/shots 1 and 2 look the same/);
  });
  it('wants more than one camera height once any shot names one', () => {
    const s = base();
    for (const b of s.beats) b.angle = 'eye';
    s.beats[1]!.size = 'close';
    expect(checkBeatSheet(s, els).join('|')).toMatch(/vary the camera height/);
  });
  it('holds the phases to the hook-peak-close shape, the peak at 35-80 %', () => {
    const s = base();
    s.beats[0]!.phase = 'build';
    expect(checkBeatSheet(s, els).join('|')).toMatch(/phase hook/);
    const t = base();
    t.beats[4]!.phase = 'build';
    expect(checkBeatSheet(t, els).join('|')).toMatch(/exactly one shot has the phase peak/);
    const u = base();
    u.beats[4]!.phase = 'build';
    u.beats[1]!.phase = 'peak';
    expect(checkBeatSheet(u, els).join('|')).toMatch(/peak shot starts at 1\d%/);
  });
  it('lets an old sheet without phases pass, and keeps the product still in the last shot', () => {
    const s = base();
    for (const b of s.beats) delete b.phase;
    expect(checkBeatSheet(s, els)).toEqual([]);
    s.beats.at(-1)!.product = 'drop';
    expect(checkBeatSheet(s, els).join('|')).toMatch(/holds still in the last shot/);
  });
  it('a macro that plays inside a push counts for the no-element rule by its played size; a dolly-zoom is a close, so it takes elements', () => {
    const s = base();
    s.beats[5]!.size = 'macro';
    expect(checkBeatSheet(s, els).join('|')).not.toMatch(/shot 6 is a label macro/);
    s.beats[5]!.ingredient = { kind: 'ice', action: 'drift' };
    expect(checkBeatSheet(s, els).join('|')).not.toMatch(/shot 6 is a label macro/);
    s.beats[1]!.size = 'macro';
    s.beats[1]!.ingredient = { kind: 'ice', action: 'drift' };
    expect(checkBeatSheet(s, els).join('|')).toMatch(/shot 2 is a label macro/);
  });
});

describe('reviewBoard and the mending retry', () => {
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
  it('allows only the rule book\'s few shots with words, never the last or a macro', () => {
    expect(checkBeatSheet(withText({ 0: 'One', 1: 'Two', 3: 'Three' }), els3).join('|')).toMatch(new RegExp(`at most ${TEXT_RULES.maxShots} shots carry text`));
    expect(checkBeatSheet(withText({ 6: 'Buy it now' }), els3).join('|')).toMatch(/last shot carries no text/);
    const macro = base.beats.findIndex((b) => b.size === 'macro');
    expect(checkBeatSheet(withText({ [macro]: 'Look closer' }), els3).join('|')).toMatch(/label macro; keep words out/);
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
