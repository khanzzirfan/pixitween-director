import { describe, expect, it } from 'vitest';
import { rowCheckSchema } from '@shared/catalog-run';
import { buildRow, loadPlateMap, type RowBuild } from './row';

// The tabletop plate's read, recorded in the repo: the table top runs from 63.4% to 85% down the
// plate, across its full width. Plain assets only: this story spends nothing and calls no art.
const PLATE_ID = 'ast_04d50dc418756070b185948227520d4f';

const hero = (o: Partial<RowBuild> = {}): RowBuild => ({
  aspect: '9:16',
  look: 'tabletop-hero',
  plate: { id: PLATE_ID, src: '/api/assets/ast_plate.jpg', width: 720, height: 1280 },
  plateMap: loadPlateMap(PLATE_ID),
  product: { id: 'ast_prod', src: '/api/assets/ast_prod.png', width: 256, height: 752 },
  title: 'Stone Mug 350ml',
  price: 19,
  brand: 'Hearth',
  accent: '#0a7a3d',
  ...o,
});

describe('buildRow', () => {
  it('builds a tabletop row that passes in one round and says so', () => {
    const r = buildRow(hero());
    expect(r.status).toBe('ready');
    expect(r.check?.ok).toBe(true);
    expect(r.check?.rounds).toBe(1);
    expect(r.check?.blocking).toEqual([]);
  });

  it('fixes a pack that hangs above the table, and says what it moved', () => {
    // the caller asks for a base line well above the table: the pack hangs in front of the wall
    const r = buildRow(hero({ baseY: 0.5 }));
    expect(r.status).toBe('fixed');
    expect(r.check?.rounds).toBe(2);
    expect(r.check?.applied[0]).toMatch(/^baseY 0\.5 -> /);
    expect(r.check?.blocking).toEqual([]);
  });

  it('hands back the base line the clip was actually built from', () => {
    const r = buildRow(hero({ baseY: 0.5 }));
    const fixed = Number(r.check!.applied[0]!.match(/-> (\d+(?:\.\d+)?)/)![1]);
    expect(r.build.baseY).toBe(fixed);
    expect(r.build.baseY!).toBeGreaterThan(0.634);
    expect(r.build.baseY!).toBeLessThan(0.84);
  });

  it('is deterministic: the same build gives the same clip and the same verdict twice', () => {
    const build = hero({ baseY: 0.5 });
    const first = buildRow(build);
    const second = buildRow(build);
    expect(first.comp).toEqual(second.comp);
    expect(first.check).toEqual(second.check);
    expect(first.status).toBe(second.status);
  });

  it('checks a price promo row, which draws its own world and needs no plate', () => {
    const r = buildRow(hero({ look: 'price-promo', plate: undefined, plateMap: undefined, price: 12, wasPrice: 19 }));
    expect(r.comp).toBeTruthy();
    expect(r.check).not.toBeNull();
    expect(r.check?.rounds).toBe(1);
  });

  it('gives a check the shared row contract accepts', () => {
    const r = buildRow(hero({ baseY: 0.5 }));
    expect(rowCheckSchema.safeParse(r.check).success).toBe(true);
  });
});

describe('loadPlateMap', () => {
  it('reads the surfaces, the busy grid and the quadrants of a plate that has a read', () => {
    const map = loadPlateMap(PLATE_ID)!;
    expect(map.surfaces).toHaveLength(1);
    expect(map.surfaces[0]!.name).toMatch(/table/i);
    expect(map.busy).toHaveLength(144);
    expect(map.quadrants?.Q3).toMatch(/table/i);
  });

  it('has nothing for a plate that has no read', () => {
    expect(loadPlateMap('ast_0000000000000000000000000000')).toBeUndefined();
  });

  it('refuses a plate id that points out of the fixtures folder', () => {
    expect(() => loadPlateMap('../secrets')).toThrow(RangeError);
  });
});
