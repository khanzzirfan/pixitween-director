import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RetailClipInput } from './retail-clip';
import { checkRetailClip, MAX_ROUNDS, verifyRetailClip } from './verify-clip';
import { buildRetailClip } from './retail-clip';

// the tabletop plate's read: the table top runs from 63.4% to 85% down the plate, across its full width
const table = { surfaces: [{ name: 'table top', top: 0.634, bottom: 0.85, left: 0, right: 1 }], busy: new Array(144).fill(0.1) };

const input = (o: Partial<RetailClipInput> = {}): RetailClipInput => ({
  aspect: '9:16',
  plate: { id: 'ast_plate', src: '/p.png', width: 720, height: 1280, map: table },
  product: { id: 'ast_prod', src: '/c.png', width: 256, height: 752 },
  title: 'Stone Mug 350ml',
  subtitle: '350 ml',
  price: 19,
  brand: 'Hearth',
  ...o,
});

describe('verifyRetailClip', () => {
  it('passes a clip built from the read in one round, with nothing to fix', () => {
    const r = verifyRetailClip(input());
    expect(r.ok).toBe(true);
    expect(r.rounds).toHaveLength(1);
    expect(r.rounds[0]!.groups).toEqual([]);
  });

  it('passes text size and pops to the critic as warnings, not blockers', () => {
    const r = verifyRetailClip(input());
    expect(r.rounds[0]!.warnings.some((g) => g.kind === 'TINY_TEXT')).toBe(true);
  });

  it('finds a floating pack from the JSON alone and fixes it on the input, not the film', () => {
    // the caller asks for a base line well above the table: the pack hangs in front of the wall
    const r = verifyRetailClip(input({ baseY: 0.5 }));
    expect(r.rounds[0]!.groups.some((g) => g.kind === 'NOT_GROUNDED')).toBe(true);
    expect(r.rounds[0]!.applied[0]).toMatch(/^baseY 0\.5 -> /);
    expect(r.ok).toBe(true);
    expect(r.rounds.length).toBeLessThanOrEqual(MAX_ROUNDS);
    expect(r.input.baseY!).toBeGreaterThan(0.634);
    expect(r.input.baseY!).toBeLessThan(0.84);
    // the comp it hands back is the one built from the fixed input
    expect(r.comp).toEqual(buildRetailClip(r.input));
  });

  it('checks only the frame rules when the plate is unread: it cannot tell what is a surface', () => {
    const c = input({ plate: { id: 'ast_plate', src: '/p.png', width: 720, height: 1280 }, baseY: 0.5 });
    const r = checkRetailClip(buildRetailClip(c), c);
    expect(r.groups.some((g) => g.kind === 'NOT_GROUNDED')).toBe(false);
    expect(r.moves).toEqual([]);
  });

  it('hands back what it cannot fix, with the hint, instead of looping', () => {
    // a read whose only surface is a sliver of shelf at the top-left: nothing under the frame centre to stand on
    const shelf = { surfaces: [{ name: 'shelf', top: 0.1, bottom: 0.15, left: 0, right: 0.2 }], busy: [] };
    const r = verifyRetailClip(input({ plate: { id: 'ast_plate', src: '/p.png', width: 720, height: 1280, map: shelf } }));
    expect(r.ok).toBe(false);
    expect(r.rounds.length).toBeLessThanOrEqual(MAX_ROUNDS);
    const g = r.rounds.at(-1)!.groups.find((x) => x.kind === 'NOT_GROUNDED')!;
    expect(g.cause).toMatch(/clip_product/);
  });
});

describe('verifyRetailClip: the stack', () => {
  const kinds = (r: ReturnType<typeof verifyRetailClip>) => r.rounds[0]!.groups.map((g) => g.kind);

  it('every look keeps the price numbers inside their ring on every frame, drawn after it', () => {
    for (const look of ['tabletop-hero', 'flat-lay', 'studio-pedestal', 'lifestyle-room', 'ingredient-orbit', 'price-promo'] as const) {
      const r = verifyRetailClip(input({ look, wasPrice: 5, price: 3.5 }));
      expect(kinds(r).filter((k) => k === 'LAYER_ORDER' || k === 'NOT_CONTAINED'), look).toEqual([]);
    }
  });

  it('catches the numbers drawn behind the ring: the ring layer is moved after the price in the built clip', () => {
    const c = input({ wasPrice: 5, price: 3.5 });
    const comp = buildRetailClip(c) as any;
    const layout = comp.meta.layout as { contains: Array<{ container: string; content: string }> };
    const { container, content } = layout.contains[0]!;
    const layers = comp.precomps.clip.layers as Array<{ id: string }>;
    const at = layers.findIndex((l) => l.id === container);
    const [ring] = layers.splice(at, 1);
    layers.push(ring!);
    expect(layers.findIndex((l) => l.id === content)).toBeLessThan(layers.findIndex((l) => l.id === container));
    const r = checkRetailClip(comp, c);
    expect(r.groups.some((g) => g.kind === 'LAYER_ORDER' && g.subject.includes('caption'))).toBe(true);
  });
});

describe('verifyRetailClip: the read plates', () => {
  const read = (id: string) => JSON.parse(readFileSync(`fixtures/plates/${id}.json`, 'utf8'));
  const plates = {
    'tabletop-hero': 'ast_04d50dc418756070b185948227520d4f',
    'lifestyle-room': 'ast_68b3384c20af9d5f439e96cf898dfa21',
    'studio-pedestal': 'ast_add1f1d051aba8d1c18e86ebf97f837c',
    'flat-lay': 'ast_e7b2d1aa618305df4333d651eef26655',
  } as const;

  it('every look stands its pack on its own read plate in one round, with nothing blocking', () => {
    for (const [look, id] of Object.entries(plates)) {
      const r = verifyRetailClip(input({ look: look as keyof typeof plates, plate: { id, src: '/p.jpg', width: 720, height: 1280, map: read(id) } }));
      expect(r.rounds.at(-1)!.groups.map((g) => `${g.kind} ${g.subject}`), look).toEqual([]);
      expect(r.rounds, look).toHaveLength(1);
    }
  });

  it('grounds the pack itself on the pedestal, not its reflection (which shares the asset)', () => {
    const id = plates['studio-pedestal'];
    const c = input({ look: 'studio-pedestal', plate: { id, src: '/p.jpg', width: 720, height: 1280, map: read(id) } });
    const comp = buildRetailClip(c) as any;
    expect(comp.meta.layout.grounded).toEqual(['clip:product']);
    expect(checkRetailClip(comp, c).moves).toEqual([]);
  });
});
